#!/usr/bin/env node

// tests/unit/lab/recall-suppression.test.js
//
// v3.8a W3 — the recall-class retrieval-suppression VIEW (the manage loop's read edge).
// RED-first. The BEHAVIORAL SPEC pinned by the 2-lens VERIFY (plan
// 2026-06-12-v3.8a-w3-k4-live-recall.md, Pre-Approval Verification):
//
//   recallSuppression(txids, {stateDir, proposals, nowMs, retentionDays, loadRecordsFn})
//     -> frozen { surfaced:[{txid, kernel_state, reason?}],
//                 suppressed:[{txid, reason}],
//                 flagged:[{txid, reasons:[{op_type, disposition, proposal_id}]}],
//                 advisory: true }
//
//   - suppressed = kernel-COMMITTED destructive facts ONLY (tombstoned | superseded).
//   - flagged    = approved-but-unpromoted destructive intent UNION pending quarantine
//                  (the architect-HIGH fix: quarantinedRecords' `candidate` tier must be
//                  consumed — the approved-only lifecycle path alone is blind to it);
//                  approved quarantine -> flagged, DEDUPED (it appears in both projections).
//   - surfaced   = the explicit DEFAULT branch (active/stale/archived/unknown AND
//                  aborted/informational/candidate — age/outcome projections are NOT
//                  destructive facts; suppressing them is silent memory loss).
//   - PRECEDENCE: a committed fact wins — a tombstoned txid with quarantine intent lands
//     in suppressed ONLY (the partition is exhaustive + pairwise-DISJOINT over the input).
//   - Fail-soft per ELEMENT (never dropped): absent txid -> surfaced reason 'no-records';
//     records-present-but-unindexed -> 'unresolved'; non-hex element -> 'invalid-txid'.
//     STRUCTURAL errors throw: non-array input, an oversized set (>256).
//   - Advisory + SHADOW: pure read; deep-frozen; never gates anything.
//
// House idiom: imperative assert + hand-rolled runner; ENV-BEFORE-REQUIRE for the lab store.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const TMP = path.join(os.tmpdir(), 'recall-sup-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = TMP; // BEFORE requires
fs.mkdirSync(TMP, { recursive: true });

// Reset the shared lab ledger between store-backed cases (CodeRabbit #303: the E2E case
// persists proposals into TMP; without a reset the CLI cases run against leftovers —
// order-dependent even when it happens to pass).
function resetLabState() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
}

const REPO = path.join(__dirname, '..', '..', '..');
const P = (...a) => path.join(REPO, 'packages', ...a);
const { recallSuppression } = require(P('lab', 'manage-proposal', 'recall-suppression.js'));
const CLI = P('lab', 'manage-proposal', 'cli.js');

const hx = (ch) => ch.repeat(64);
const A = hx('a'); const B = hx('b'); const C = hx('c'); const D = hx('d');
const E = hx('e'); const F = hx('f'); const H = hx('1');
const NOW = Date.parse('2026-06-12T00:00:00.000Z');
const recent = '2026-06-05T00:00:00.000Z'; // 7d < 90d retention -> not archivable
const old = '2026-01-01T00:00:00.000Z';    // >90d -> archivable

// Fixture idioms mirror manage-lifecycle-consumer.test.js.
const committed = (txid, ts = recent, extra = {}) => ({
  transaction_id: txid, operation_class: 'CREATE', commit_outcome: 'COMMITTED', intent_recorded_at: ts, ...extra,
});
const destructiveOp = (txid, opClass, targets) => ({
  transaction_id: txid, operation_class: opClass, commit_outcome: 'COMMITTED', affected_records: targets,
  intent_recorded_at: recent, evidence_refs: ['ROOT_TASK_RECORD:t'],
});
const proposal = (opType, targets, disposition, id = 'pid-' + opType + '-' + disposition) => ({
  node_type: 'manage-proposal', proposal_id: id, op_type: opType, target_records: targets,
  disposition, justification: 'why ' + opType, proposer_origin: 'test',
});
// The injectable records seam: a Map of txid -> the record set its run would load.
const loaderFor = (byTxid) => (txid) => byTxid.get(txid) || [];

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; } catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}
const txidsOf = (arr) => arr.map((e) => e.txid).sort();

// ---- the suppressed tier: kernel-COMMITTED destructive facts ONLY ----

test('tombstoned -> suppressed (reason tombstoned)', () => {
  const load = loaderFor(new Map([[A, [committed(A), destructiveOp(B, 'TOMBSTONE', [A])]]]));
  const r = recallSuppression([A], { loadRecordsFn: load, proposals: [], nowMs: NOW });
  assert.deepStrictEqual(txidsOf(r.suppressed), [A]);
  assert.strictEqual(r.suppressed[0].reason, 'tombstoned');
  assert.deepStrictEqual(r.surfaced, []);
  assert.deepStrictEqual(r.flagged, []);
});

test('superseded -> suppressed (reason superseded)', () => {
  const load = loaderFor(new Map([[A, [committed(A), destructiveOp(B, 'SUPERSEDE', [A])]]]));
  const r = recallSuppression([A], { loadRecordsFn: load, proposals: [], nowMs: NOW });
  assert.strictEqual(r.suppressed[0].reason, 'superseded');
});

// ---- the flagged tier (the architect-HIGH lock: PENDING quarantine must be visible) ----

test('HIGH lock: a PENDING quarantine proposal -> flagged (disposition pending), NOT surfaced-clean', () => {
  const load = loaderFor(new Map([[A, [committed(A)]]]));
  const r = recallSuppression([A], { loadRecordsFn: load, proposals: [proposal('quarantine', [A], 'pending')], nowMs: NOW });
  assert.deepStrictEqual(txidsOf(r.flagged), [A], 'the undisposed quarantine MUST flag');
  const reasons = r.flagged[0].reasons;
  assert.strictEqual(reasons.length, 1);
  assert.strictEqual(reasons[0].op_type, 'quarantine');
  assert.strictEqual(reasons[0].disposition, 'pending');
});

test('approved quarantine -> flagged (never suppressed), DEDUPED to one reason despite both projections', () => {
  const load = loaderFor(new Map([[A, [committed(A)]]]));
  const r = recallSuppression([A], { loadRecordsFn: load, proposals: [proposal('quarantine', [A], 'approved')], nowMs: NOW });
  assert.deepStrictEqual(txidsOf(r.flagged), [A]);
  assert.deepStrictEqual(r.suppressed, [], 'quarantine mints no kernel op -> never suppressed');
  const qReasons = r.flagged[0].reasons.filter((x) => x.op_type === 'quarantine');
  assert.strictEqual(qReasons.length, 1, 'approved quarantine listed ONCE (deduped across projections)');
  assert.strictEqual(qReasons[0].disposition, 'approved');
});

test('approved cull (unpromoted) -> flagged with op_type cull', () => {
  const load = loaderFor(new Map([[A, [committed(A)]]]));
  const r = recallSuppression([A], { loadRecordsFn: load, proposals: [proposal('cull', [A], 'approved')], nowMs: NOW });
  assert.strictEqual(r.flagged[0].reasons[0].op_type, 'cull');
  assert.strictEqual(r.flagged[0].reasons[0].disposition, 'approved');
});

test('a REJECTED quarantine does NOT flag (surfaced clean)', () => {
  const load = loaderFor(new Map([[A, [committed(A)]]]));
  const r = recallSuppression([A], { loadRecordsFn: load, proposals: [proposal('quarantine', [A], 'rejected')], nowMs: NOW });
  assert.deepStrictEqual(r.flagged, []);
  assert.deepStrictEqual(txidsOf(r.surfaced), [A]);
});

// ---- the surfaced DEFAULT branch (the M2 full-range fixtures) ----

test('active / archived / aborted / informational / candidate ALL surface (annotated), never suppress', () => {
  const load = loaderFor(new Map([
    [A, [committed(A)]],                                                      // active
    [B, [committed(B, old)]],                                                 // archived (age alone)
    [C, [{ transaction_id: C, operation_class: 'CREATE', commit_outcome: 'ABORTED', intent_recorded_at: recent }]],
    [D, [{ transaction_id: D, operation_class: 'CREATE', commit_outcome: 'NOT_APPLICABLE', intent_recorded_at: recent }]],
    [E, [{ transaction_id: E, operation_class: 'CREATE', commit_outcome: 'PENDING', intent_recorded_at: recent }]],
  ]));
  const r = recallSuppression([A, B, C, D, E], { loadRecordsFn: load, proposals: [], nowMs: NOW });
  assert.deepStrictEqual(txidsOf(r.surfaced), [A, B, C, D, E].sort(), 'all five surface');
  assert.deepStrictEqual(r.suppressed, []);
  const states = Object.fromEntries(r.surfaced.map((s) => [s.txid, s.kernel_state]));
  assert.strictEqual(states[A], 'active');
  assert.strictEqual(states[B], 'archived');
  assert.strictEqual(states[C], 'aborted');
  assert.strictEqual(states[D], 'informational');
  assert.strictEqual(states[E], 'candidate');
});

test('stale surfaces (VALIDATE L3 lock): a record whose evidence dependency was superseded is NOT suppressed', () => {
  // A's evidence_refs reference B; B is superseded by H -> A projects `stale` (a transitive
  // age/consistency annotation, NOT a destructive fact) and MUST surface; B suppresses.
  const records = [
    committed(A, recent, { evidence_refs: [B] }),
    committed(B),
    destructiveOp(H, 'SUPERSEDE', [B]),
  ];
  const load = loaderFor(new Map([[A, records], [B, records]]));
  const r = recallSuppression([A, B], { loadRecordsFn: load, proposals: [], nowMs: NOW });
  const byTxid = Object.fromEntries(r.surfaced.map((s) => [s.txid, s.kernel_state]));
  assert.strictEqual(byTxid[A], 'stale', 'the stale projection surfaces annotated');
  assert.deepStrictEqual(txidsOf(r.suppressed), [B], 'only the superseded record suppresses');
});

// ---- precedence + the partition locks ----

test('PRECEDENCE: tombstoned + quarantine intent -> suppressed ONLY (committed fact wins; disjoint)', () => {
  const load = loaderFor(new Map([[A, [committed(A), destructiveOp(B, 'TOMBSTONE', [A])]]]));
  const r = recallSuppression([A], { loadRecordsFn: load, proposals: [proposal('quarantine', [A], 'approved')], nowMs: NOW });
  assert.deepStrictEqual(txidsOf(r.suppressed), [A]);
  assert.deepStrictEqual(r.flagged, [], 'no double-listing: the partition is disjoint');
});

test('COMPLETENESS lock: input set == surfaced UNION suppressed UNION flagged, pairwise-disjoint', () => {
  const load = loaderFor(new Map([
    [A, [committed(A), destructiveOp(H, 'TOMBSTONE', [A])]],   // suppressed
    [B, [committed(B), destructiveOp(H, 'SUPERSEDE', [B])]],   // suppressed
    [C, [committed(C)]],                                        // flagged (pending quarantine below)
    [D, [committed(D)]],                                        // surfaced active
    [E, [committed(E, old)]],                                   // surfaced archived
    // F absent -> surfaced no-records
  ]));
  const input = [A, B, C, D, E, F];
  const r = recallSuppression(input, { loadRecordsFn: load, proposals: [proposal('quarantine', [C], 'pending')], nowMs: NOW });
  const all = [...txidsOf(r.surfaced), ...txidsOf(r.suppressed), ...txidsOf(r.flagged)].sort();
  assert.deepStrictEqual(all, [...input].sort(), 'every input txid appears EXACTLY once across the three sets');
});

test('DIRECTIONAL lock: a LIVE (active/unknown) record NEVER lands in suppressed', () => {
  const load = loaderFor(new Map([[A, [committed(A)]]])); // B absent -> unknown
  const r = recallSuppression([A, B], { loadRecordsFn: load, proposals: [], nowMs: NOW });
  assert.deepStrictEqual(r.suppressed, [], 'silent recall loss is the dangerous direction');
  assert.deepStrictEqual(txidsOf(r.surfaced), [A, B].sort());
});

// ---- fail-soft element diagnostics (never dropped) ----

test('absent txid -> surfaced reason no-records; records-present-but-unindexed -> unresolved', () => {
  const load = loaderFor(new Map([[B, [committed(C)]]])); // B's "run" loads records that lack B
  const r = recallSuppression([A, B], { loadRecordsFn: load, proposals: [], nowMs: NOW });
  const byTxid = Object.fromEntries(r.surfaced.map((s) => [s.txid, s]));
  assert.strictEqual(byTxid[A].kernel_state, 'unknown');
  assert.strictEqual(byTxid[A].reason, 'no-records', 'an empty load is visible as such');
  assert.strictEqual(byTxid[B].kernel_state, 'unknown');
  assert.strictEqual(byTxid[B].reason, 'unresolved', 'a present-but-unindexed txid is distinguishable');
});

test('a non-hex ELEMENT -> surfaced reason invalid-txid (never dropped); dupes deduped', () => {
  const r = recallSuppression(['not-hex', A, A], { loadRecordsFn: loaderFor(new Map()), proposals: [], nowMs: NOW });
  const byTxid = Object.fromEntries(r.surfaced.map((s) => [s.txid, s]));
  assert.strictEqual(byTxid['not-hex'].reason, 'invalid-txid');
  assert.strictEqual(r.surfaced.filter((s) => s.txid === A).length, 1, 'duplicate input deduped');
});

test('STRUCTURAL errors throw: non-array input; an oversized set (>256)', () => {
  assert.throws(() => recallSuppression('not-an-array', {}), /array/i);
  const big = Array.from({ length: 257 }, () => crypto.randomBytes(32).toString('hex'));
  assert.throws(() => recallSuppression(big, { loadRecordsFn: loaderFor(new Map()) }), /256|cap|max/i);
});

// ---- immutability + advisory + hostile shapes ----

test('the partition is DEEP-frozen and advisory:true', () => {
  const load = loaderFor(new Map([[A, [committed(A), destructiveOp(B, 'TOMBSTONE', [A])]]]));
  const r = recallSuppression([A, C], { loadRecordsFn: load, proposals: [proposal('quarantine', [C], 'pending')], nowMs: NOW });
  assert.strictEqual(r.advisory, true);
  assert.ok(Object.isFrozen(r) && Object.isFrozen(r.surfaced) && Object.isFrozen(r.suppressed) && Object.isFrozen(r.flagged));
  assert.ok(Object.isFrozen(r.suppressed[0]), 'rows frozen');
  assert.ok(Object.isFrozen(r.flagged[0].reasons) && Object.isFrozen(r.flagged[0].reasons[0]), 'nested reasons frozen (the #266 deep rule)');
  assert.throws(() => { r.suppressed.push({}); }, TypeError);
});

test('prototype-named hostile shapes stay clean (op_type toString / txid __proto__)', () => {
  const load = loaderFor(new Map([[A, [committed(A)]]]));
  const r = recallSuppression([A], {
    loadRecordsFn: load,
    proposals: [proposal('toString', [A], 'approved'), proposal('quarantine', ['__proto__'], 'pending')],
    nowMs: NOW,
  });
  assert.deepStrictEqual(txidsOf(r.surfaced), [A], 'the garbage op_type is excluded by the closed enum');
  assert.strictEqual(({}).polluted, undefined);
  assert.deepStrictEqual(r.flagged, [], 'a __proto__ target never reaches the partition (non-hex)');
});

// ---- the END-TO-END path: the REAL producer (promoteProposal -> COMMITTED TOMBSTONE) ----

test('E2E: a real promoted cull (kernel TOMBSTONE mint) suppresses through the REAL cross-run loader', () => {
  resetLabState();
  process.env.LOOM_MANAGE_ENFORCE = '1';
  delete process.env.LOOM_DISABLE_CIRCUIT_BREAKER;
  try {
    const { promoteProposal } = require(P('lab', 'manage-proposal', 'promote.js'));
    const { cullRecord } = require(P('lab', 'manage-proposal', 'manage-ops.js'));
    const { updateDisposition, listProposals } = require(P('lab', 'manage-proposal', 'store.js'));
    const { buildSpawnRecord } = require(P('kernel', '_lib', 'quarantine-promote.js'));
    const { computePostStateHash } = require(P('kernel', '_lib', 'transaction-record.js'));
    const { appendRecord } = require(P('kernel', '_lib', 'record-store.js'));
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-sup-e2e-'));
    const rec = buildSpawnRecord({ agentId: 'rs1', personaId: 'p1', schemaVersion: 'v6', postStateHash: computePostStateHash(hx('9')) });
    appendRecord(rec, { runId: 'rsRun', stateDir });
    const p = cullRecord({ targets: [rec.transaction_id], justification: 'stale memory', origin: 'test' });
    updateDisposition(p.proposal_id, 'approved');
    const mint = promoteProposal(p.proposal_id, { stateDir });
    assert.strictEqual(mint.ok, true, `promote ok (${mint.refused || ''})`);
    const r = recallSuppression([rec.transaction_id], { stateDir, proposals: listProposals(), nowMs: Date.now() });
    assert.deepStrictEqual(txidsOf(r.suppressed), [rec.transaction_id], 'the real mint suppresses via the real loader');
    assert.strictEqual(r.suppressed[0].reason, 'tombstoned');
    fs.rmSync(stateDir, { recursive: true, force: true });
  } finally { delete process.env.LOOM_MANAGE_ENFORCE; }
});

// ---- the CLI surface ----

test('CLI recall-filter --txids A,B: empty store -> both surfaced (no-records), valid JSON partition', () => {
  resetLabState();
  const out = JSON.parse(execFileSync(process.execPath, [CLI, 'recall-filter', '--txids', `${A},${B}`], {
    env: { ...process.env, LOOM_LAB_STATE_DIR: TMP }, encoding: 'utf8',
  }));
  assert.strictEqual(out.advisory, true);
  assert.deepStrictEqual(txidsOf(out.surfaced), [A, B].sort());
  assert.deepStrictEqual(out.suppressed, []);
});

test('CLI recall-filter: missing --txids -> exit 1, clean message', () => {
  assert.throws(() => execFileSync(process.execPath, [CLI, 'recall-filter'], {
    env: { ...process.env, LOOM_LAB_STATE_DIR: TMP }, encoding: 'utf8', stdio: 'pipe',
  }), (e) => e.status === 1);
});

test('CLI recall-filter: an all-comma/whitespace --txids -> exit 1 (VALIDATE L2: no silent empty partition)', () => {
  assert.throws(() => execFileSync(process.execPath, [CLI, 'recall-filter', '--txids', ', ,'], {
    env: { ...process.env, LOOM_LAB_STATE_DIR: TMP }, encoding: 'utf8', stdio: 'pipe',
  }), (e) => e.status === 1);
});

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* OS reclaims tmp */ }
process.stdout.write(`\nrecall-suppression.test.js (v3.8a W3): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
