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
//   - schema: required fields, outcome enum, reverse_op consistency
//   - INV-19-WALAppendOnly: appending an entry preserves prior bytes exactly
//   - torn-tail tolerance: a crash mid-append (un-terminated final line) is
//     discarded by readJournal, not fatal
//   - undo semantics: a PROMOTED entry's reverse_op is `git revert <sha>`
//
// House test pattern: imperative assert + hand-rolled runner + exit code.
// atomic-write is REAL (the journal's durability primitive). Hermetic tmp dir.

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

test('JOURNAL_OUTCOMES enumerates PROMOTED / ABORTED / NOOP_ALREADY_PRESENT', () => {
  assert.deepStrictEqual(
    journal.JOURNAL_OUTCOMES.slice().sort(),
    ['ABORTED', 'NOOP_ALREADY_PRESENT', 'PROMOTED']
  );
});

test('JOURNAL_REQUIRED_FIELDS pins the undo-ledger contract', () => {
  for (const f of ['schema_version', 'entry_id', 'promoted_sha', 'pre_state_hash', 'worktree_root', 'outcome', 'timestamp_iso']) {
    assert.ok(journal.JOURNAL_REQUIRED_FIELDS.includes(f), `required field ${f} missing from schema`);
  }
});

// ── buildJournalEntry (RED on stub) ─────────────────────────────────────────

test('buildJournalEntry fills schema_version + entry_id + reverse_op for PROMOTED', () => {
  const entry = journal.buildJournalEntry(promotedFields());
  assert.strictEqual(entry.schema_version, 'k9-journal-v1');
  assert.match(entry.entry_id, /^[a-f0-9]{64}$/, 'entry_id is a content sha256');
  assert.strictEqual(entry.promoted_sha, 'a'.repeat(40));
  assert.strictEqual(entry.reverse_op, 'git revert ' + 'a'.repeat(40), 'undo is a forward git revert of the promoted SHA');
  assert.ok(typeof entry.timestamp_iso === 'string' && entry.timestamp_iso.length > 0);
});

test('SECURITY: buildJournalEntry REJECTS a non-hex / shell-metachar promoted_sha (poisoned-undo-ledger guard)', () => {
  // PR 3 security PRINCIPLE/LOW: reverse_op interpolates promoted_sha. A
  // shell-metachar SHA reaching buildJournalEntry directly (bypassing the
  // orchestrator's admitPromoteRequest) must NOT be able to mint a
  // 'git revert ; rm -rf /' payload stored at rest. Validation is local to the
  // leaf (the DAG forbids importing path-guard) — fail-closed by throwing.
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
  assert.strictEqual(ok.reverse_op, 'git revert ' + 'd'.repeat(40));
});

test('buildJournalEntry: ABORTED entry has null reverse_op + null post_state_hash + an abort_reason', () => {
  const entry = journal.buildJournalEntry({
    promoted_sha: 'a'.repeat(40),
    pre_state_hash: 'b'.repeat(64),
    post_state_hash: null,
    worktree_root: '/tmp/k9-parent-root',
    outcome: 'ABORTED',
    abort_reason: 'cherry-pick-conflict-aborted',
  });
  assert.strictEqual(entry.reverse_op, null, 'aborted promote has nothing to reverse');
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

test('validateJournalEntry rejects reverse_op present on a non-PROMOTED outcome', () => {
  const entry = journal.buildJournalEntry(promotedFields());
  entry.outcome = 'NOOP_ALREADY_PRESENT';
  // reverse_op left as the PROMOTED git-revert string — inconsistent.
  const res = journal.validateJournalEntry(entry);
  assert.strictEqual(res.valid, false, 'reverse_op must be present iff outcome is PROMOTED');
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
  assert.strictEqual(back[0].reverse_op, 'git revert ' + 'a'.repeat(40));
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
