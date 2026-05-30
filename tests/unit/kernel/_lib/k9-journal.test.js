#!/usr/bin/env node

// tests/unit/kernel/_lib/k9-journal.test.js
//
// K9 append-only reverse-cherrypick journal (PR 3 — ships DORMANT).
// TDD Phase 1: written FIRST, runs RED against the scaffolding stub
// (packages/kernel/_lib/k9-journal.js — bodies throw NOT_IMPLEMENTED). The
// journal RECORD SCHEMA is already real in the stub (closes the verify-plan
// HIGH "journal schema unspecified" TDD bootstrapping gap), so these schema
// assertions have a concrete contract to bind to.
//
// Covers:
//   - schema: required fields, outcome enum, reverse_op_description consistency
//   - INV-19-WALAppendOnly: appending an entry preserves prior bytes exactly
//   - torn-tail tolerance: a crash mid-append (un-terminated final line) is
//     discarded by readJournal, not fatal
//   - undo semantics: a PROMOTED entry's reverse_op_description is
//     `git revert <sha>` (DOCUMENTATION-only; never shell-executed — PR-4b
//     §recovery-replay renamed it from reverse_op to kill the CWE-78 temptation
//     at the schema level)
//   - PR-4b REVERTED outcome: rollbackPromotion appends a REVERTED entry that
//     validateJournalEntry must accept (INV-19 — without it the undo is
//     unrecoverable from the ledger)
//
// House test pattern: imperative assert + hand-rolled runner + exit code.
// atomic-write is REAL (the journal's durability primitive). Hermetic tmp dir.
//
// PR-4b MIGRATION: this file asserts the NEW field name reverse_op_description
// (the rename happens in impl; these tests are RED until then). A probe-style
// test asserts `grep reverse_op k9-journal.js` resolves to ZERO bare reverse_op
// occurrences (only reverse_op_description) after impl.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const journal = require('../../../../packages/kernel/_lib/k9-journal');
const { createTmpDir } = require('./_test-harness');
const crash = require('./_crash-harness');

let passed = 0;
let failed = 0;
function test(name, fn) {
  const tmp = createTmpDir('k9-journal');
  try { fn(tmp); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
  finally { tmp.cleanup(); }
}

// A representative PROMOTED entry the impl's buildJournalEntry must produce.
function promotedFields() {
  return {
    promoted_sha: 'a'.repeat(40),
    pre_state_hash: 'b'.repeat(64),
    post_state_hash: 'c'.repeat(64),
    worktree_root: '/tmp/k9-parent-root',
    outcome: 'PROMOTED',
    abort_reason: null,
  };
}

// ── schema constants (PASS on stub — they assert exported data) ──────────────

test('JOURNAL_SCHEMA_VERSION is the v1 tag', () => {
  assert.strictEqual(journal.JOURNAL_SCHEMA_VERSION, 'k9-journal-v1');
});

test('JOURNAL_OUTCOMES enumerates PROMOTED / ABORTED / NOOP_ALREADY_PRESENT / REVERTED (PR-4b add)', () => {
  // PR-4b §recovery-replay: REVERTED is REQUIRED in the enum — without it
  // validateJournalEntry REJECTS the rollbackPromotion entry at runtime
  // ('invalid outcome: REVERTED'), the undo never journals, and the recovery is
  // unrecoverable from the ledger (INV-19 breach).
  assert.deepStrictEqual(
    journal.JOURNAL_OUTCOMES.slice().sort(),
    ['ABORTED', 'NOOP_ALREADY_PRESENT', 'PROMOTED', 'REVERTED']
  );
});

test('JOURNAL_REQUIRED_FIELDS pins the undo-ledger contract', () => {
  for (const f of ['schema_version', 'entry_id', 'promoted_sha', 'pre_state_hash', 'worktree_root', 'outcome', 'timestamp_iso']) {
    assert.ok(journal.JOURNAL_REQUIRED_FIELDS.includes(f), `required field ${f} missing from schema`);
  }
});

// ── buildJournalEntry (RED on stub) ─────────────────────────────────────────

test('buildJournalEntry fills schema_version + entry_id + reverse_op_description for PROMOTED', () => {
  const entry = journal.buildJournalEntry(promotedFields());
  assert.strictEqual(entry.schema_version, 'k9-journal-v1');
  assert.match(entry.entry_id, /^[a-f0-9]{64}$/, 'entry_id is a content sha256');
  assert.strictEqual(entry.promoted_sha, 'a'.repeat(40));
  // PR-4b rename: reverse_op → reverse_op_description (documentation-only label;
  // the rollback executor reads the promoted_sha FIELD, never this string).
  assert.strictEqual(entry.reverse_op_description, 'git revert ' + 'a'.repeat(40),
    'reverse_op_description documents the forward git revert of the promoted SHA');
  assert.strictEqual(entry.reverse_op, undefined, 'the legacy reverse_op field is gone (renamed)');
  assert.ok(typeof entry.timestamp_iso === 'string' && entry.timestamp_iso.length > 0);
});

test('SECURITY: buildJournalEntry REJECTS a non-hex / shell-metachar promoted_sha (poisoned-undo-ledger guard)', () => {
  // PR 3 security PRINCIPLE/LOW: reverse_op_description interpolates promoted_sha
  // (documentation string). A shell-metachar SHA reaching buildJournalEntry
  // directly (bypassing the orchestrator's admitPromoteRequest) must NOT be able
  // to mint a 'git revert ; rm -rf /' payload stored at rest. Validation is local
  // to the leaf (the DAG forbids importing path-guard) — fail-closed by throwing.
  assert.throws(
    () => journal.buildJournalEntry({ ...promotedFields(), promoted_sha: 'a'.repeat(64) + '; rm -rf /' }),
    /promoted_sha must be/, 'metachar SHA must be rejected'
  );
  assert.throws(
    () => journal.buildJournalEntry({ ...promotedFields(), promoted_sha: 'not-hex' }),
    /promoted_sha must be/, 'non-hex SHA must be rejected'
  );
  assert.throws(
    () => journal.buildJournalEntry({ ...promotedFields(), promoted_sha: 'ABCDEF' + '0'.repeat(58) }),
    /promoted_sha must be/, 'uppercase hex must be rejected'
  );
  // Sanity: a well-formed 40-hex SHA still builds (no false positive).
  const ok = journal.buildJournalEntry({ ...promotedFields(), promoted_sha: 'd'.repeat(40) });
  assert.strictEqual(ok.reverse_op_description, 'git revert ' + 'd'.repeat(40));
});

test('buildJournalEntry: ABORTED entry has null reverse_op_description + null post_state_hash + an abort_reason', () => {
  const entry = journal.buildJournalEntry({
    promoted_sha: 'a'.repeat(40),
    pre_state_hash: 'b'.repeat(64),
    post_state_hash: null,
    worktree_root: '/tmp/k9-parent-root',
    outcome: 'ABORTED',
    abort_reason: 'cherry-pick-conflict-aborted',
  });
  assert.strictEqual(entry.reverse_op_description, null, 'aborted promote has nothing to reverse');
  assert.strictEqual(entry.post_state_hash, null);
  assert.strictEqual(entry.abort_reason, 'cherry-pick-conflict-aborted');
});

// ── validateJournalEntry (RED on stub) ──────────────────────────────────────

test('validateJournalEntry accepts a well-formed PROMOTED entry', () => {
  const entry = journal.buildJournalEntry(promotedFields());
  const res = journal.validateJournalEntry(entry);
  assert.strictEqual(res.valid, true, 'errors: ' + JSON.stringify(res.errors));
});

test('validateJournalEntry rejects a missing required field', () => {
  const entry = journal.buildJournalEntry(promotedFields());
  delete entry.pre_state_hash;
  const res = journal.validateJournalEntry(entry);
  assert.strictEqual(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes('pre_state_hash')));
});

test('validateJournalEntry rejects an unknown outcome', () => {
  const entry = journal.buildJournalEntry(promotedFields());
  entry.outcome = 'WAT';
  const res = journal.validateJournalEntry(entry);
  assert.strictEqual(res.valid, false);
});

test('validateJournalEntry rejects reverse_op_description present on a NOOP/ABORTED outcome', () => {
  const entry = journal.buildJournalEntry(promotedFields());
  entry.outcome = 'NOOP_ALREADY_PRESENT';
  // reverse_op_description left as the PROMOTED git-revert string — inconsistent
  // (NOOP/ABORTED have nothing to reverse). PR-4b: the consistency check covers
  // BOTH PROMOTED and REVERTED as the outcomes that REQUIRE a description.
  const res = journal.validateJournalEntry(entry);
  assert.strictEqual(res.valid, false, 'reverse_op_description must be present only for PROMOTED or REVERTED');
});

// ── INV-19 append-only (RED on stub) ────────────────────────────────────────

test('INV-19: appendJournalEntry preserves prior bytes byte-for-byte', (tmp) => {
  const jp = path.join(tmp.path, 'reverse-cherrypick.jsonl');
  journal.appendJournalEntry(jp, journal.buildJournalEntry(promotedFields()));
  const prefix = fs.readFileSync(jp, 'utf8');

  journal.appendJournalEntry(jp, journal.buildJournalEntry({
    ...promotedFields(), promoted_sha: 'd'.repeat(40), pre_state_hash: 'c'.repeat(64),
  }));
  const after = fs.readFileSync(jp, 'utf8');
  assert.strictEqual(after.slice(0, prefix.length), prefix, 'prior journal bytes must be immutable');
});

test('INV-19: line count equals number of appends', (tmp) => {
  const jp = path.join(tmp.path, 'reverse-cherrypick.jsonl');
  for (let i = 0; i < 5; i++) {
    journal.appendJournalEntry(jp, journal.buildJournalEntry({
      ...promotedFields(), promoted_sha: String(i).repeat(40).slice(0, 40),
    }));
  }
  const entries = journal.readJournal(jp);
  assert.strictEqual(entries.length, 5);
});

test('readJournal round-trips each appended entry', (tmp) => {
  const jp = path.join(tmp.path, 'reverse-cherrypick.jsonl');
  const e = journal.buildJournalEntry(promotedFields());
  journal.appendJournalEntry(jp, e);
  const back = journal.readJournal(jp);
  assert.strictEqual(back.length, 1);
  assert.strictEqual(back[0].promoted_sha, 'a'.repeat(40));
  assert.strictEqual(back[0].reverse_op_description, 'git revert ' + 'a'.repeat(40));
});

// ── torn-tail tolerance (crash mid-append) ──────────────────────────────────

test('readJournal tolerates a torn final line (crash mid-append) — discards the un-terminated tail', (tmp) => {
  const jp = path.join(tmp.path, 'reverse-cherrypick.jsonl');
  journal.appendJournalEntry(jp, journal.buildJournalEntry(promotedFields()));
  // Simulate a crash that appended only half of the next entry, no newline.
  crash.appendTornWALLine(jp, JSON.stringify(journal.buildJournalEntry({
    ...promotedFields(), promoted_sha: 'e'.repeat(40),
  })));
  const back = journal.readJournal(jp);
  assert.strictEqual(back.length, 1, 'the torn tail must be discarded, leaving 1 complete entry');
});

// ════════════════════════════════════════════════════════════════════════════
// PR-4b additions — REVERTED outcome + reverse_op_description rename probe.
// ADR-0011 §recovery-replay (journal co-updates). RED until impl adds REVERTED
// to JOURNAL_OUTCOMES + carries the consistency check for it + renames the field.
// ════════════════════════════════════════════════════════════════════════════

test('REVERTED: buildJournalEntry({outcome:"REVERTED"}) passes validateJournalEntry (without it the undo is unrecoverable — INV-19)', () => {
  const entry = journal.buildJournalEntry({
    promoted_sha: 'a'.repeat(40),
    pre_state_hash: 'b'.repeat(64),
    post_state_hash: 'c'.repeat(64),
    worktree_root: '/tmp/k9-parent-root',
    outcome: 'REVERTED',
  });
  const res = journal.validateJournalEntry(entry);
  assert.strictEqual(res.valid, true, 'a REVERTED entry must validate; errors: ' + JSON.stringify(res.errors));
  assert.strictEqual(entry.outcome, 'REVERTED');
});

test('REVERTED: a REVERTED entry carries a reverse_op_description (consistency check covers PROMOTED + REVERTED)', () => {
  // §recovery-replay: the reverse_op_description consistency check fires for BOTH
  // PROMOTED and REVERTED (the two outcomes that have a meaningful forward op).
  const entry = journal.buildJournalEntry({
    promoted_sha: 'a'.repeat(40),
    pre_state_hash: 'b'.repeat(64),
    post_state_hash: 'c'.repeat(64),
    worktree_root: '/tmp/k9-parent-root',
    outcome: 'REVERTED',
  });
  assert.ok(typeof entry.reverse_op_description === 'string' && entry.reverse_op_description.length > 0,
    'a REVERTED entry must carry a non-empty reverse_op_description');
  // Stripping it must make validation fail (the consistency check is real for REVERTED).
  const stripped = { ...entry, reverse_op_description: null };
  const res = journal.validateJournalEntry(stripped);
  assert.strictEqual(res.valid, false, 'a REVERTED entry missing its reverse_op_description must be rejected');
});

test('REVERTED: round-trips through append + read (the rollback undo is recoverable from the ledger)', (tmp) => {
  const jp = path.join(tmp.path, 'reverse-cherrypick.jsonl');
  const entry = journal.buildJournalEntry({
    promoted_sha: 'a'.repeat(40),
    pre_state_hash: 'b'.repeat(64),
    post_state_hash: 'c'.repeat(64),
    worktree_root: '/tmp/k9-parent-root',
    outcome: 'REVERTED',
  });
  journal.appendJournalEntry(jp, entry);
  const back = journal.readJournal(jp);
  assert.strictEqual(back.length, 1);
  assert.strictEqual(back[0].outcome, 'REVERTED', 'the REVERTED entry survives the append-only ledger round-trip');
});

test('PROBE: grep reverse_op in k9-journal.js finds ZERO bare reverse_op occurrences (only reverse_op_description) post-impl', () => {
  // The rename probe (ADR-0011 §recovery-replay: "grep -c reverse_op
  // packages/kernel/_lib/k9-journal.js returns 0 after PR-4b"). Strip the
  // _description suffix tokens; any BARE reverse_op left is a missed rename site.
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', 'packages', 'kernel', '_lib', 'k9-journal.js'),
    'utf8'
  );
  const bare = src.replace(/reverse_op_description/g, '').match(/reverse_op/g) || [];
  assert.strictEqual(bare.length, 0,
    `every reverse_op site must be renamed to reverse_op_description; found ${bare.length} bare occurrence(s)`);
});

// ── DAG / acyclicity guard (PASSES on stub) ─────────────────────────────────

test('DAG: k9-journal does NOT import k9-promote-deltas (no back-edge)', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', 'packages', 'kernel', '_lib', 'k9-journal.js'),
    'utf8'
  );
  assert.ok(!/require\(['"]\.\/k9-promote-deltas['"]\)/.test(src),
    'journal must not import the orchestrator (orchestration -> leaves only)');
});

process.stdout.write(`\nk9-journal.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
