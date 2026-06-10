#!/usr/bin/env node

// tests/unit/lab/manage-promote-crossrun.test.js
//
// v3.6 Wave 2c — CROSS-RUN destructive mints. RED-first. The W2b.1 `cross-run-deferred-w2c` refusal is
// LIFTED: a human-approved proposal whose targets span MULTIPLE runs promotes by PARTITIONING targets by run
// and minting ONE COMMITTED op per run (each naming that run's subset). Covers (per the VERIFY folds):
//   - the LOOP across runs: every target reported tombstoned/superseded regardless of which run it lives in.
//   - per-(proposal,run) idempotency (D2): re-promote -> every run DEDUPS (no double-mint).
//   - the `{mints:[...]}` contract (clean-break): one entry per run; promotion-level operation_class + targets.
//   - partial-failure (D4): a poisoned run FAILS -> honest {failed:'partial-cross-run', minted, unminted};
//     idempotent retry completes after a transient failure clears.
//   - the PREDICTIVE breaker (H1/F2): refuse `breaker-would-exceed` (ZERO mints) if denials_in_window + K > threshold.
//   - `ambiguous` (one target id in >1 run) STAYS refused (D7).
//   - `loadRecordsForTarget` (D6/M2): locate-then-load; UNION on ambiguous; [] on absent/non-hex.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const LAB_TMP = path.join(os.tmpdir(), 'mpx-lab-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = LAB_TMP; // BEFORE the requires
fs.mkdirSync(LAB_TMP, { recursive: true });

const REPO = path.join(__dirname, '..', '..', '..');
const P = (...a) => path.join(REPO, 'packages', ...a);
const { promoteProposal } = require(P('lab', 'manage-proposal', 'promote.js'));
const { listProposals, updateDisposition, LEDGER_PATH } = require(P('lab', 'manage-proposal', 'store.js'));
const { cullRecord, mergeRecord } = require(P('lab', 'manage-proposal', 'manage-ops.js'));
const { manageLifecycleStatus } = require(P('lab', 'manage-proposal', 'lifecycle.js'));
const { loadRecordsForTarget } = require(P('lab', 'manage-proposal', 'crossrun-load.js'));
const { buildSpawnRecord } = require(P('kernel', '_lib', 'quarantine-promote.js'));
const { buildManageOpRecord } = require(P('kernel', '_lib', 'manage-op-record.js'));
const { computePostStateHash, canonicalJsonSerialize } = require(P('kernel', '_lib', 'transaction-record.js'));
const { appendRecord, listByRun } = require(P('kernel', '_lib', 'record-store.js'));

const hx = (ch) => ch.repeat(64);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const T0 = '2026-06-08T00:00:00.000Z';
let seq = 0;

// Seed a target (CREATE provenance record) into a run; returns its transaction_id.
function seedTarget(runId, stateDir, persona = 'p1') {
  seq += 1;
  const rec = buildSpawnRecord({ agentId: 'agent' + seq, personaId: persona, schemaVersion: 'v6', postStateHash: computePostStateHash(hx('f')) });
  appendRecord(rec, { runId, stateDir });
  return rec.transaction_id;
}
// Seed ONE record content into TWO runs (same txid in both) -> findRecordRun -> ambiguous.
function seedAmbiguous(runA, runB, stateDir) {
  seq += 1;
  const rec = buildSpawnRecord({ agentId: 'amb' + seq, personaId: 'p1', schemaVersion: 'v6', postStateHash: computePostStateHash(hx('e')) });
  appendRecord(rec, { runId: runA, stateDir });
  appendRecord(rec, { runId: runB, stateDir });
  return rec.transaction_id;
}
function approvedOp(builderFn, targets) {
  const p = builderFn({ targets, justification: 'stale', origin: 'test' });
  updateDisposition(p.proposal_id, 'approved');
  return p.proposal_id;
}
function freshState() {
  try { fs.rmSync(LEDGER_PATH, { force: true }); } catch { /* none */ }
  const dir = path.join(os.tmpdir(), 'mpx-rec-' + crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
// Count COMMITTED ops of a class across ALL runs in a store (for "no mint" assertions).
function countOps(stateDir, opClass) {
  let n = 0;
  for (const run of fs.readdirSync(stateDir)) {
    try { n += listByRun({ runId: run, stateDir }).filter((r) => r.operation_class === opClass).length; } catch { /* not a run */ }
  }
  return n;
}

let passed = 0; let failed = 0;
function test(name, fn) {
  process.env.LOOM_MANAGE_ENFORCE = '1';
  delete process.env.LOOM_BREAKER_GLOBAL_MAX_DENIALS;
  delete process.env.LOOM_DISABLE_CIRCUIT_BREAKER;
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; } catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// -- 1. THE CROSS-RUN LOOP: targets in different runs -> one TOMBSTONE per run -> every target tombstoned.
test('cross-run cull: targets across runX/runY/runZ -> one mint per run -> all tombstoned', () => {
  const dir = freshState();
  const a = seedTarget('runX', dir);
  const b = seedTarget('runY', dir);
  const c = seedTarget('runZ', dir);
  const res = promoteProposal(approvedOp(cullRecord, [a, b, c]), { stateDir: dir, nowIso: T0 });
  assert.strictEqual(res.ok, true, JSON.stringify(res));
  assert.strictEqual(res.operation_class, 'TOMBSTONE');
  // one mint per distinct run (3), each naming exactly that run's subset (one target each here)
  assert.strictEqual(res.mints.length, 3, JSON.stringify(res.mints));
  for (const m of res.mints) { assert.strictEqual(m.targets.length, 1); }
  // every target is reported tombstoned via its OWN run's records (the headline capability)
  for (const t of [a, b, c]) {
    const recs = loadRecordsForTarget(t, { stateDir: dir });
    assert.strictEqual(manageLifecycleStatus(t, { records: recs, nowMs: Date.parse(T0) }).kernel_state, 'tombstoned', `target ${t}`);
  }
});

// -- 2. A run with MULTIPLE targets gets ONE op naming that run's whole subset.
test('cross-run merge: runX has {a,b}, runY has {c} -> 2 mints, runX op names {a,b}', () => {
  const dir = freshState();
  const a = seedTarget('runX', dir);
  const b = seedTarget('runX', dir);
  const c = seedTarget('runY', dir);
  const res = promoteProposal(approvedOp(mergeRecord, [a, b, c]), { stateDir: dir, nowIso: T0 });
  assert.strictEqual(res.ok, true, JSON.stringify(res));
  assert.strictEqual(res.operation_class, 'SUPERSEDE');
  assert.strictEqual(res.mints.length, 2);
  const runXmint = res.mints.find((m) => m.runId === 'runX');
  assert.strictEqual(new Set(runXmint.targets).size, 2, 'runX op names BOTH a and b');
  for (const t of [a, b, c]) {
    const recs = loadRecordsForTarget(t, { stateDir: dir });
    assert.strictEqual(manageLifecycleStatus(t, { records: recs, nowMs: Date.parse(T0) }).kernel_state, 'superseded');
  }
});

// -- 3. per-(proposal,run) idempotency: re-promoting DEDUPS every run (no double-mint).
test('cross-run INV-22: re-promote -> every run DEDUPS, no second mint', () => {
  const dir = freshState();
  const a = seedTarget('runX', dir);
  const b = seedTarget('runY', dir);
  const pid = approvedOp(cullRecord, [a, b]);
  const r1 = promoteProposal(pid, { stateDir: dir, nowIso: T0 });
  const r2 = promoteProposal(pid, { stateDir: dir, nowIso: '2026-06-09T00:00:00.000Z' });
  assert.strictEqual(r1.ok && r2.ok, true, JSON.stringify([r1, r2]));
  assert.ok(r2.mints.every((m) => m.deduped === true), 'every run deduped on retry');
  // same transaction_id per run across the two promotions (per-(proposal,run) key is stable)
  const id1 = new Map(r1.mints.map((m) => [m.runId, m.transaction_id]));
  for (const m of r2.mints) { assert.strictEqual(m.transaction_id, id1.get(m.runId), `run ${m.runId} stable txid`); }
  assert.strictEqual(countOps(dir, 'TOMBSTONE'), 2, 'exactly 2 ops total (one per run), no doubles');
});

// -- 4. per-run keys are DISTINCT across runs (the D2 mechanism): the two runs' ops have different txids.
test('cross-run identity: the per-run mints have DISTINCT transaction_ids (runId folded into the key)', () => {
  const dir = freshState();
  const a = seedTarget('runX', dir);
  const b = seedTarget('runY', dir);
  const res = promoteProposal(approvedOp(cullRecord, [a, b]), { stateDir: dir, nowIso: T0 });
  assert.strictEqual(res.ok, true, JSON.stringify(res));
  assert.strictEqual(new Set(res.mints.map((m) => m.transaction_id)).size, 2, 'two distinct per-run txids');
});

// -- 5. PARTIAL-FAILURE (D4): a poison decoy in ONE run -> that run's post-condition FAILS -> honest partial.
test('cross-run partial-failure: a poisoned run -> {failed:partial-cross-run, minted, unminted}', () => {
  const dir = freshState();
  const a = seedTarget('runX', dir);
  const b = seedTarget('runY', dir);
  const pid = approvedOp(cullRecord, [a, b]);
  const proposal = listProposals().find((p) => p.proposal_id === pid);
  const axiom = sha256(canonicalJsonSerialize(proposal));
  // Plant a TOMBSTONE in runY with the SAME (proposalId, runY) key but a DIFFERENT affected_records -> runY's
  // mint dedups against it -> runY post-condition FAILS. runX still mints cleanly.
  const decoy = buildManageOpRecord({ operationClass: 'TOMBSTONE', affectedRecords: [hx('9')], proposalId: pid, runId: 'runY', approvalAxiomHash: axiom, schemaVersion: 'v6', nowIso: '2026-01-01T00:00:00.000Z' });
  assert.strictEqual(appendRecord(decoy, { runId: 'runY', stateDir: dir }).ok, true);
  const res = promoteProposal(pid, { stateDir: dir, nowIso: T0 });
  assert.strictEqual(res.ok, false, JSON.stringify(res));
  assert.strictEqual(res.failed, 'partial-cross-run');
  assert.strictEqual(res.cause, 'post-condition-mismatch');
  assert.deepStrictEqual(res.unminted, ['runY']);
  assert.strictEqual(res.minted.length, 1);
  assert.strictEqual(res.minted[0].runId, 'runX');
  // runX WAS minted (honest partial — no rollback); runY's real target is NOT tombstoned
  assert.strictEqual(manageLifecycleStatus(a, { records: loadRecordsForTarget(a, { stateDir: dir }), nowMs: Date.parse(T0) }).kernel_state, 'tombstoned');
  assert.notStrictEqual(manageLifecycleStatus(b, { records: loadRecordsForTarget(b, { stateDir: dir }), nowMs: Date.parse(T0) }).kernel_state, 'tombstoned');
});

// -- 6. idempotent retry COMPLETES after a transient per-run failure clears (D4 recovery).
test('cross-run retry: a transient run failure -> partial -> re-invoke completes (runX dedups, runY mints)', () => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) { process.stdout.write('    (skipped: root bypasses dir perms)\n'); return; }
  const dir = freshState();
  const a = seedTarget('runX', dir);
  const b = seedTarget('runY', dir);
  const pid = approvedOp(cullRecord, [a, b]);
  // Make runY's records dir unwritable so its append FAILS mid-loop (runX, sorted first, mints OK).
  const runYrecords = path.join(dir, 'runY', 'records');
  fs.chmodSync(runYrecords, 0o500);
  let r1;
  try { r1 = promoteProposal(pid, { stateDir: dir, nowIso: T0 }); } finally { fs.chmodSync(runYrecords, 0o700); }
  assert.strictEqual(r1.ok, false, JSON.stringify(r1));
  assert.strictEqual(r1.failed, 'partial-cross-run');
  assert.deepStrictEqual(r1.unminted, ['runY']);
  // retry now that runY is writable: runX dedups, runY mints -> full success
  const r2 = promoteProposal(pid, { stateDir: dir, nowIso: '2026-06-09T00:00:00.000Z' });
  assert.strictEqual(r2.ok, true, JSON.stringify(r2));
  const runXmint = r2.mints.find((m) => m.runId === 'runX');
  assert.strictEqual(runXmint.deduped, true, 'runX deduped on retry');
  for (const t of [a, b]) {
    assert.strictEqual(manageLifecycleStatus(t, { records: loadRecordsForTarget(t, { stateDir: dir }), nowMs: Date.parse('2026-06-09T00:00:00.000Z') }).kernel_state, 'tombstoned');
  }
});

// -- 7. PREDICTIVE breaker (H1/F2): denials_in_window + K > threshold -> refuse breaker-would-exceed, ZERO mints.
test('cross-run breaker-would-exceed: prior=2, K=2, threshold=3 -> refuse before ANY mint', () => {
  const dir = freshState();
  process.env.LOOM_BREAKER_GLOBAL_MAX_DENIALS = '3';
  // Pre-seed 2 committed destructive ops (recent mtime -> in the breaker window) in a spectator run.
  for (let i = 0; i < 2; i += 1) {
    const op = buildManageOpRecord({ operationClass: 'TOMBSTONE', affectedRecords: [hx('a')], proposalId: sha256('seed' + i), runId: 'seedrun', approvalAxiomHash: hx('c'), schemaVersion: 'v6', nowIso: T0 });
    appendRecord(op, { runId: 'seedrun', stateDir: dir });
  }
  const a = seedTarget('runX', dir);
  const b = seedTarget('runY', dir);            // K = 2 distinct runs
  const res = promoteProposal(approvedOp(cullRecord, [a, b]), { stateDir: dir, nowIso: T0 });
  assert.strictEqual(res.ok, false, JSON.stringify(res));
  assert.strictEqual(res.refused, 'breaker-would-exceed');
  assert.strictEqual(res.denials_in_window, 2);
  assert.strictEqual(res.threshold, 3);
  assert.strictEqual(res.k, 2);
  // ZERO mints landed (refused BEFORE the loop) — only the 2 pre-seeded remain
  assert.strictEqual(countOps(dir, 'TOMBSTONE'), 2, 'no new mint past the predictive bound');
});

// -- 7b. PREDICTIVE breaker boundary: prior + K == threshold is ALLOWED (matches the K=1 reach-the-cap rule).
test('cross-run breaker boundary: prior=1, K=2, threshold=3 -> ALLOWED (reaches but does not exceed)', () => {
  const dir = freshState();
  process.env.LOOM_BREAKER_GLOBAL_MAX_DENIALS = '3';
  const op = buildManageOpRecord({ operationClass: 'TOMBSTONE', affectedRecords: [hx('a')], proposalId: sha256('seedB'), runId: 'seedrun', approvalAxiomHash: hx('c'), schemaVersion: 'v6', nowIso: T0 });
  appendRecord(op, { runId: 'seedrun', stateDir: dir });   // prior = 1
  const a = seedTarget('runX', dir);
  const b = seedTarget('runY', dir);                         // K = 2 -> 1 + 2 = 3 == threshold -> allowed
  const res = promoteProposal(approvedOp(cullRecord, [a, b]), { stateDir: dir, nowIso: T0 });
  assert.strictEqual(res.ok, true, JSON.stringify(res));
  assert.strictEqual(res.mints.length, 2);
});

// -- 8. `ambiguous` (one target id in >1 run) STAYS refused (D7) — orthogonal to cross-run-different-targets.
test('cross-run scope: a target id duplicated across runs -> REFUSE target-in-multiple-runs-w2b', () => {
  const dir = freshState();
  const amb = seedAmbiguous('runX', 'runY', dir);
  const res = promoteProposal(approvedOp(cullRecord, [amb]), { stateDir: dir, nowIso: T0 });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.refused, 'target-in-multiple-runs-w2b');
  assert.strictEqual(countOps(dir, 'TOMBSTONE'), 0);
});

// -- 9. loadRecordsForTarget: locate-then-load returns the target's run; absent/non-hex -> [].
test('loadRecordsForTarget: locate-then-load (present run) | [] on absent | [] on non-hex', () => {
  const dir = freshState();
  const t = seedTarget('runX', dir);
  const recs = loadRecordsForTarget(t, { stateDir: dir });
  assert.ok(Array.isArray(recs) && recs.some((r) => r.transaction_id === t), 'returns the run holding the target');
  assert.deepStrictEqual(loadRecordsForTarget(hx('0'), { stateDir: dir }), [], 'absent txid -> []');
  assert.deepStrictEqual(loadRecordsForTarget('not-hex', { stateDir: dir }), [], 'non-hex txid -> []');
});

// -- 9b. loadRecordsForTarget M2: a target duplicated across runs (ambiguous) -> UNION (not a silent under-report).
test('loadRecordsForTarget M2: ambiguous txid -> UNION across the dup runs (sees a tombstone in either)', () => {
  const dir = freshState();
  const amb = seedAmbiguous('runX', 'runY', dir);
  // tombstone the ambiguous id in runY ONLY (a direct manage-op naming it, same-run)
  const op = buildManageOpRecord({ operationClass: 'TOMBSTONE', affectedRecords: [amb], proposalId: sha256('amb-tomb'), runId: 'runY', approvalAxiomHash: hx('c'), schemaVersion: 'v6', nowIso: T0 });
  appendRecord(op, { runId: 'runY', stateDir: dir });
  const recs = loadRecordsForTarget(amb, { stateDir: dir });
  // the UNION includes runY's tombstone -> the reader reports tombstoned (more honest than 'unknown')
  assert.strictEqual(manageLifecycleStatus(amb, { records: recs, nowMs: Date.parse(T0) }).kernel_state, 'tombstoned');
});

// -- 10. single-run still works under the new contract (mints.length === 1).
test('single-run under the new contract: one target -> mints.length===1, reader tombstoned', () => {
  const dir = freshState();
  const t = seedTarget('runX', dir);
  const res = promoteProposal(approvedOp(cullRecord, [t]), { stateDir: dir, nowIso: T0 });
  assert.strictEqual(res.ok, true, JSON.stringify(res));
  assert.strictEqual(res.mints.length, 1);
  assert.strictEqual(res.mints[0].runId, 'runX');
  assert.ok(Object.isFrozen(res) && Object.isFrozen(res.mints) && Object.isFrozen(res.mints[0]));
});

// -- 11. H1 (VALIDATE hacker): a partial near the breaker threshold RETRIES to completion. The predictive K is
// NET-NEW minting runs (not runIds.length), so an already-minted run is not double-counted (in denials AND K) —
// else the documented partial-retry recovery would WEDGE at breaker-would-exceed despite minting nothing new.
test('cross-run H1: a partial near threshold retries to completion (net-new K, no double-count wedge)', () => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) { process.stdout.write('    (skipped: root bypasses dir perms)\n'); return; }
  const dir = freshState();
  process.env.LOOM_BREAKER_GLOBAL_MAX_DENIALS = '3';
  // prior = 1 spectator destructive mint (recent mtime, in window)
  const seed = buildManageOpRecord({ operationClass: 'TOMBSTONE', affectedRecords: [hx('a')], proposalId: sha256('seedH1'), runId: 'seedrun', approvalAxiomHash: hx('c'), schemaVersion: 'v6', nowIso: T0 });
  appendRecord(seed, { runId: 'seedrun', stateDir: dir });
  const a = seedTarget('runX', dir);
  const b = seedTarget('runY', dir);
  const pid = approvedOp(cullRecord, [a, b]);            // K=2 net-new -> 1+2=3 == threshold -> allowed
  // force runY to fail mid-loop (a transient EACCES) -> partial (runX minted, runY not)
  const runYrecords = path.join(dir, 'runY', 'records');
  fs.chmodSync(runYrecords, 0o500);
  let r1;
  try { r1 = promoteProposal(pid, { stateDir: dir, nowIso: T0 }); } finally { fs.chmodSync(runYrecords, 0o700); }
  assert.strictEqual(r1.failed, 'partial-cross-run', JSON.stringify(r1));
  assert.deepStrictEqual(r1.unminted, ['runY']);
  // retry: denials now 2 (seed + runX); net-new K = 1 (runX dedups) -> 2+1=3 == threshold -> ALLOWED, not wedged.
  // (with the buggy K=runIds.length this would be 2+2=4 > 3 -> breaker-would-exceed -> the wedge.)
  const r2 = promoteProposal(pid, { stateDir: dir, nowIso: '2026-06-09T00:00:00.000Z' });
  assert.strictEqual(r2.ok, true, `retry must COMPLETE, not wedge: ${JSON.stringify(r2)}`);
  assert.strictEqual(r2.mints.find((m) => m.runId === 'runX').deduped, true, 'runX deduped on retry');
  assert.strictEqual(r2.mints.find((m) => m.runId === 'runY').deduped, false, 'runY freshly minted on retry');
});

// -- 12. F9 (honesty): evidence_refs is IDENTICAL across the K per-run mints (one approval = one axiom; the
// approvalAxiomHash is computed ONCE before the loop, not per-run — so all per-run ops justify from one approval).
test('cross-run F9: evidence_refs is constant across the per-run mints (the axiom is per-proposal)', () => {
  const dir = freshState();
  const a = seedTarget('runX', dir);
  const b = seedTarget('runY', dir);
  const res = promoteProposal(approvedOp(cullRecord, [a, b]), { stateDir: dir, nowIso: T0 });
  assert.strictEqual(res.ok, true, JSON.stringify(res));
  const evidence = res.mints.map((m) => {
    const recs = loadRecordsForTarget(m.targets[0], { stateDir: dir });
    return recs.find((r) => r.transaction_id === m.transaction_id).evidence_refs[0];
  });
  assert.strictEqual(new Set(evidence).size, 1, 'all per-run mints share ONE evidence_ref (the per-proposal axiom)');
  assert.ok(evidence[0].startsWith('USER_INTENT_AXIOM:'), 'the A10 bootstrap sentinel');
});

try { fs.rmSync(LAB_TMP, { recursive: true, force: true }); } catch { /* OS reclaims tmp */ }
process.stdout.write(`\nmanage-promote-crossrun.test.js (v3.6 W2c): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
