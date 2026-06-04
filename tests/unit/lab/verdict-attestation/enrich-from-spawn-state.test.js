#!/usr/bin/env node

// tests/unit/lab/verdict-attestation/enrich-from-spawn-state.test.js
//
// v3.4 Wave 1 — the enricher that resolves a verdict record's agentId → the kernel spawn-record's
// content-addressed transaction_id, by reading the kernel's spawn-state JOURNAL as a DATA FILE (the
// E1 pull pattern; no kernel STATE-module import). It is the in-wave CONSUMER that closes the shadow
// loop end-to-end. Plan: 2026-06-04-v3.4-wave1-evidence-record.md (HIGH-1/F1/F2/MEDIUM-4 folded).
//
// ENV-BEFORE-REQUIRE: the enricher captures LOOM_SPAWN_STATE_DIR + (via ./store) LOOM_LAB_STATE_DIR
// at module-load, so both temp dirs MUST be set before the require below.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const rid = crypto.randomBytes(6).toString('hex');
const SPAWN_TMP = path.join(os.tmpdir(), 'w1-spawnstate-' + rid);
const LAB_TMP = path.join(os.tmpdir(), 'w1-labstate-' + rid);
process.env.LOOM_SPAWN_STATE_DIR = SPAWN_TMP; // BEFORE require
process.env.LOOM_LAB_STATE_DIR = LAB_TMP;     // BEFORE require (store captures this)
fs.mkdirSync(SPAWN_TMP, { recursive: true });
fs.mkdirSync(LAB_TMP, { recursive: true });

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const enricher = require(path.join(REPO_ROOT, 'packages', 'lab', 'verdict-attestation', 'enrich-from-spawn-state.js'));
const store = require(path.join(REPO_ROOT, 'packages', 'lab', 'verdict-attestation', 'store.js'));

// Write a kernel-shaped journal at <SPAWN_TMP>/<runId>/resolver-journal-<agentId>.jsonl from an
// array of line objects (mirrors the real spawn-close-resolver journal: one JSON object per line).
function writeJournal(runId, agentId, lines) {
  const dir = path.join(SPAWN_TMP, runId);
  fs.mkdirSync(dir, { recursive: true });
  const body = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
  fs.writeFileSync(path.join(dir, `resolver-journal-${agentId}.jsonl`), body);
}
const verdictLine = (agentId) => ({ kind: 'shadow-resolver-verdict', event: 'spawn-close-shadow', spawn_id: agentId, action: 'PROMOTE', outcome: 'PROMOTED' });
const provLine = (agentId, txid, over) => ({ kind: 'shadow-provenance-record', event: 'spawn-close-shadow', spawn_id: agentId, transaction_id: txid, deduped: false, record_appended: true, ...over });
const skippedLine = (agentId) => ({ kind: 'shadow-provenance-skipped', event: 'spawn-close-shadow', spawn_id: agentId, observed_status: 'in_progress' });

let passed = 0; let failed = 0;
function test(name, fn) {
  // Per-test isolation: clear both the spawn-state fixtures and the lab ledger.
  try { fs.rmSync(SPAWN_TMP, { recursive: true, force: true }); fs.mkdirSync(SPAWN_TMP, { recursive: true }); } catch { /* */ }
  try { fs.rmSync(store.LEDGER_PATH, { force: true }); } catch { /* */ }
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// ── 1. Resolve happy path: a real-shaped 2-line journal (verdict + provenance-record) → {runId, txid}.
test('resolveKernelRecord: verdict+provenance-record journal → {runId, transactionId, recordStatus:appended}', () => {
  const A = 'a104143b476ed011f';
  writeJournal('cde7d2eb042077c6', A, [verdictLine(A), provLine(A, 'tx_happy')]);
  const r = enricher.resolveKernelRecord(A);
  assert.ok(r, 'resolved');
  assert.strictEqual(r.runId, 'cde7d2eb042077c6', 'runId = the journal parent dir');
  assert.strictEqual(r.transactionId, 'tx_happy');
  assert.strictEqual(r.recordStatus, 'appended');
});

// ── 2. ★ Path-guard: an agentId with separators / .. never touches the fs (the #215/C1 trap-class).
test('★ path-guard: resolveKernelRecord rejects an unsafe agentId (no fs access)', () => {
  assert.throws(() => enricher.resolveKernelRecord('../../etc/passwd'), /safe path segment|unsafe|segment/i);
  assert.throws(() => enricher.resolveKernelRecord('a/b'), /safe path segment|unsafe|segment/i);
});

// ── 3. ★ Journal line-kind filter (F2/HIGH-2): only `shadow-provenance-record` carries the link.
test('★ line-kind filter: verdict-only/skipped-only → null; skipped-then-record → resolves; two records → LAST', () => {
  const A = 'a000000000000000a';
  // (a) verdict-only journal (a non-delta or pre-provenance close) → null
  writeJournal('run1', A, [verdictLine(A)]);
  assert.strictEqual(enricher.resolveKernelRecord(A), null, 'verdict-only → null (no committed work-record)');
  // (b) skipped-only (non-completed close) → null
  fs.rmSync(SPAWN_TMP, { recursive: true, force: true });
  writeJournal('run1', A, [skippedLine(A)]);
  assert.strictEqual(enricher.resolveKernelRecord(A), null, 'skipped-only → null');
  // (c) skipped THEN record → resolves to the record line
  fs.rmSync(SPAWN_TMP, { recursive: true, force: true });
  writeJournal('run1', A, [verdictLine(A), skippedLine(A), provLine(A, 'tx_after_skip')]);
  assert.strictEqual(enricher.resolveKernelRecord(A).transactionId, 'tx_after_skip');
  // (d) two provenance-record lines (a re-fire) → take the LAST
  fs.rmSync(SPAWN_TMP, { recursive: true, force: true });
  writeJournal('run1', A, [provLine(A, 'tx_old'), provLine(A, 'tx_new')]);
  assert.strictEqual(enricher.resolveKernelRecord(A).transactionId, 'tx_new', 'last provenance-record wins');
});

// ── 4. record_appended:false / deduped:true (LOW-6): still resolves the txid, recordStatus flagged.
test('record_appended:false + deduped → resolves transaction_id, recordStatus=deduped', () => {
  const A = 'a111111111111111b';
  writeJournal('run1', A, [provLine(A, 'tx_dedup', { record_appended: false, deduped: true })]);
  const r = enricher.resolveKernelRecord(A);
  assert.strictEqual(r.transactionId, 'tx_dedup');
  assert.strictEqual(r.recordStatus, 'deduped', 'a dedup-after-crash still has a valid link');
});

// ── 5. 0-hit (no journal anywhere for this agentId) → null (fail-soft; read-only/uncloseable spawn).
test('no journal for the agentId → null (fail-soft)', () => {
  assert.strictEqual(enricher.resolveKernelRecord('a999999999999999c'), null);
});

// ── 6. Collision: the SAME agentId journal under TWO runIds → return one, flagged collision:true.
test('2-file hit across runIds → collision:true (detectable, not silent)', () => {
  const A = 'a222222222222222d';
  writeJournal('runX', A, [provLine(A, 'tx_x')]);
  writeJournal('runY', A, [provLine(A, 'tx_y')]);
  const r = enricher.resolveKernelRecord(A);
  assert.ok(r, 'still resolves to one');
  assert.strictEqual(r.collision, true, 'collision flagged');
});

// ── 7. ★ enrichLedger end-to-end: an unenriched store record + a matching fixture journal → the
//        record's transaction_id is PERSISTED (the in-wave shadow loop, closed).
test('★ enrichLedger: unenriched record + matching journal → transaction_id persisted in the ledger', () => {
  const A = 'a333333333333333e';
  const rec = store.recordVerdict({ verdict: 'pass', subject: { persona: 'node-backend' }, verifier: { identity: 'orchestrator', kind: 'structural' }, agentId: A });
  assert.strictEqual(rec.evidence_refs.transaction_id, null, 'starts unenriched');
  writeJournal('runZ', A, [verdictLine(A), provLine(A, 'tx_e2e')]);
  const summary = enricher.enrichLedger();
  assert.strictEqual(summary.enriched, 1, 'one record enriched');
  const after = store.listVerdicts().find((r) => r.attestation_id === rec.attestation_id);
  assert.strictEqual(after.evidence_refs.transaction_id, 'tx_e2e', 'transaction_id durably persisted');
  assert.strictEqual(after.evidence_refs.run_id, 'runZ');
  // a record with no resolvable journal is left unenriched, not fatal
  store.recordVerdict({ verdict: 'fail', subject: { persona: 'x' }, verifier: { identity: 'orchestrator', kind: 'structural' }, agentId: 'a444444444444444f' });
  const s2 = enricher.enrichLedger();
  assert.ok(s2.unresolved >= 1, 'the unmatched record counts as unresolved, not a crash');
});

// ── 9. ★ VALIDATE hacker M1: an oversized journal is skipped (DoS guard), not read into memory.
test('★ journal-size guard: a journal larger than MAX_JOURNAL_BYTES is skipped → null', () => {
  const A = 'a555555555555555a';
  const dir = path.join(SPAWN_TMP, 'run-big');
  fs.mkdirSync(dir, { recursive: true });
  // a (MAX+1)-byte file whose content would otherwise resolve — must be skipped on SIZE alone
  const line = JSON.stringify(provLine(A, 'tx_big')) + '\n';
  const pad = 'x'.repeat(enricher.MAX_JOURNAL_BYTES + 1 - line.length);
  fs.writeFileSync(path.join(dir, `resolver-journal-${A}.jsonl`), line + pad);
  assert.strictEqual(enricher.resolveKernelRecord(A), null, 'oversized journal skipped (no unbounded read)');
});

// ── 10. ★ VALIDATE hacker M3: a symlinked run-dir is NOT followed (link-confusion guard).
test('★ symlink guard: a symlinked run-dir holding a forged journal is skipped → null', () => {
  const A = 'a666666666666666b';
  const realTarget = path.join(os.tmpdir(), 'w1-symtarget-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(realTarget, { recursive: true });
  fs.writeFileSync(path.join(realTarget, `resolver-journal-${A}.jsonl`), JSON.stringify(provLine(A, 'FORGED')) + '\n');
  try {
    fs.symlinkSync(realTarget, path.join(SPAWN_TMP, 'run-symlink'), 'dir');
  } catch { return; } // symlink unsupported (rare) → skip the test cleanly
  assert.strictEqual(enricher.resolveKernelRecord(A), null, 'symlinked run-dir not followed (no forged txid)');
  fs.rmSync(realTarget, { recursive: true, force: true });
});

// ── 11. A plain FILE masquerading as a run subdir is skipped (no crash; code-reviewer MEDIUM dir-guard).
test('file-as-runId: a regular file in the spawn-state base is skipped cleanly', () => {
  fs.writeFileSync(path.join(SPAWN_TMP, 'stale.log'), 'not a dir');
  assert.strictEqual(enricher.resolveKernelRecord('a777777777777777c'), null, 'no crash on a non-dir entry');
});

// ── 12. ★ collision → enrichLedger REFUSES to persist (ambiguous link = no link; the M3 safe default).
test('★ enrichLedger refuses to persist an ambiguous (collision) link', () => {
  const A = 'a888888888888888d';
  store.recordVerdict({ verdict: 'pass', subject: { persona: 'p' }, verifier: { identity: 'orchestrator', kind: 'structural' }, agentId: A });
  writeJournal('runP', A, [provLine(A, 'tx_p')]);
  writeJournal('runQ', A, [provLine(A, 'tx_q')]);
  const summary = enricher.enrichLedger();
  assert.strictEqual(summary.enriched, 0, 'a collision is NOT enriched');
  assert.ok(summary.skipped >= 1, 'the collision counts as skipped');
  const rec = store.listVerdicts().find((r) => r.evidence_refs.agent_id === A);
  assert.strictEqual(rec.evidence_refs.transaction_id, null, 'no ambiguous link persisted');
});

// ── 8. ★ Containment: the enricher require()s no kernel/identity STATE module (reads spawn-state by
//        PATH only). It MAY import kernel/_lib (path-canonicalize) + the sibling ./store.
test('★ containment: enrich-from-spawn-state.js imports no kernel/identity STATE module', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'packages', 'lab', 'verdict-attestation', 'enrich-from-spawn-state.js'), 'utf8');
  const requires = (src.match(/require\(['"][^'"]+['"]\)/g) || []);
  const forbidden = requires.filter((r) => /agent-identit|spawn-state\/|record-store|transaction-record|identity\//.test(r));
  assert.deepStrictEqual(forbidden, [], `enricher imports no kernel STATE module — found: ${forbidden.join(', ')}`);
});

process.stdout.write(`\nenrich-from-spawn-state.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
