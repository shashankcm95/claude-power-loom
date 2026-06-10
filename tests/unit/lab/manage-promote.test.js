#!/usr/bin/env node

// tests/unit/lab/manage-promote.test.js
//
// v3.6 Wave 2a + W2b.1 — the human-gated manage-promote LOOP + its security contract (the leave-shadow MINT).
// This is the SAFETY PROOF for the first WAL mutation: every CLOSED hacker VERIFY/VALIDATE finding has a
// coverage test across the suite (this file + record-locate.test.js); the ACCEPTED residuals (OQ-E forge,
// same-uid self-approval) are documented, not tested (a cooperative-model acceptance cannot be test-proven).
//   - the LOOP: approved cull -> COMMITTED TOMBSTONE in the target's run -> the W1 reader reports `tombstoned`.
//   - shadow-default (flag off) REFUSES; not-approved / unknown-id REFUSE (TOCTOU).
//   - scope guards: quarantine REFUSES (recall-layer v3.8a, not a kernel op).
//   - phantom target REFUSE; IDOR (kernel-owned / manage-op target) REFUSE.
//   - INV-22 re-promote DEDUPS (post-condition still passes).
//   - the CRITICAL: an INV-22 poison-key decoy -> POST-CONDITION FAILS (no silent fail-open).
//
// W2b.1 (multi-target single-run generalization): content-dedup/merge -> SUPERSEDE + multi-target cull;
// exact-SET-equality post-condition (superset/subset/dup-pad decoys FAIL); per-target eligibility (one
// kernel-owned target refuses the whole op); canonicalize-at-the-boundary (a planted authentic non-canonical row
// promotes correctly, no self-DoS); blast-radius re-cap (a planted over-MAX_TARGETS row REFUSES).
// W2c LIFTED the cross-run refusal: targets spanning runs now SUCCEED (one mint per run; full coverage in
// manage-promote-crossrun.test.js). The success contract is {mints:[...]} (no single-run transaction_id alias).
//
// Two stores: the proposal ledger (LOOM_LAB_STATE_DIR, set before require) + the kernel record-store (a
// per-test stateDir passed in). LOOM_MANAGE_ENFORCE is the opt-in flag (set per enforcing test).

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const LAB_TMP = path.join(os.tmpdir(), 'mp-lab-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = LAB_TMP; // BEFORE the requires
fs.mkdirSync(LAB_TMP, { recursive: true });

const REPO = path.join(__dirname, '..', '..', '..');
const P = (...a) => path.join(REPO, 'packages', ...a);
const { promoteProposal } = require(P('lab', 'manage-proposal', 'promote.js'));
const { listProposals, updateDisposition, LEDGER_PATH, computeProposalId, MAX_TARGETS } = require(P('lab', 'manage-proposal', 'store.js'));
const { cullRecord, quarantineRecord, contentDedupRecord, mergeRecord } = require(P('lab', 'manage-proposal', 'manage-ops.js'));
const { manageLifecycleStatus } = require(P('lab', 'manage-proposal', 'lifecycle.js'));
const { buildSpawnRecord } = require(P('kernel', '_lib', 'quarantine-promote.js'));
const { buildManageOpRecord } = require(P('kernel', '_lib', 'manage-op-record.js'));
const { computePostStateHash, canonicalJsonSerialize } = require(P('kernel', '_lib', 'transaction-record.js'));
const { appendRecord, listByRun } = require(P('kernel', '_lib', 'record-store.js'));

const hx = (ch) => ch.repeat(64);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const T0 = '2026-06-08T00:00:00.000Z';
let seq = 0;

// Seed a target record (a CREATE provenance record) into a run; returns its transaction_id.
function seedTarget(runId, stateDir, persona = 'p1') {
  seq += 1;
  const rec = buildSpawnRecord({ agentId: 'agent' + seq, personaId: persona, schemaVersion: 'v6', postStateHash: computePostStateHash(hx('f')) });
  appendRecord(rec, { runId, stateDir });
  return rec.transaction_id;
}
// Parametrized approve helper (DRY over cull/content-dedup/merge — all take { targets }). Returns the
// approved proposal_id.
function approvedOp(builderFn, targets) {
  const p = builderFn({ targets, justification: 'stale', origin: 'test' });
  updateDisposition(p.proposal_id, 'approved');
  return p.proposal_id;
}
const approvedCull = (targets) => approvedOp(cullRecord, targets);
// Plant a directly-written AUTHENTIC proposal row (bypasses createProposal's canonicalize + MAX_TARGETS cap)
// — the same-uid p-writescope attacker class the post-condition + boundary canonicalize/re-cap defend.
function plantProposal(opType, targetRecords) {
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  const row = {
    node_type: 'manage-proposal', op_type: opType, target_records: targetRecords, disposition: 'approved',
    proposal_id: computeProposalId(opType, targetRecords), justification: 'x', proposer_origin: 't',
    recorded_at: T0, schema_version: 'v3.5',
  };
  fs.appendFileSync(LEDGER_PATH, JSON.stringify(row) + '\n');
  return row.proposal_id;
}
function freshState() {
  try { fs.rmSync(LEDGER_PATH, { force: true }); } catch { /* none */ }
  const dir = path.join(os.tmpdir(), 'mp-rec-' + crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

let passed = 0; let failed = 0;
function test(name, fn) {
  process.env.LOOM_MANAGE_ENFORCE = '1'; // default ON; the shadow test deletes it
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; } catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// -- 1. The LOOP: approved cull -> TOMBSTONE -> the W1 reader reports `tombstoned`.
test('THE LOOP: approved cull -> COMMITTED TOMBSTONE -> manageLifecycleStatus reports tombstoned', () => {
  const dir = freshState();
  const t = seedTarget('runX', dir);
  const res = promoteProposal(approvedCull([t]), { stateDir: dir, nowIso: T0 });
  assert.strictEqual(res.ok, true, JSON.stringify(res));
  assert.strictEqual(res.operation_class, 'TOMBSTONE');
  const reader = manageLifecycleStatus(t, { records: listByRun({ runId: res.mints[0].runId, stateDir: dir }), nowMs: Date.parse(T0) });
  assert.strictEqual(reader.kernel_state, 'tombstoned'); // the loop closes
});

// -- 2. Shadow-default: no flag -> REFUSE (the mint never fires).
test('shadow-default: LOOM_MANAGE_ENFORCE unset -> REFUSE (no mint)', () => {
  const dir = freshState();
  delete process.env.LOOM_MANAGE_ENFORCE;
  const t = seedTarget('runX', dir);
  const res = promoteProposal(approvedCull([t]), { stateDir: dir, nowIso: T0 });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.refused, 'shadow-default');
  assert.strictEqual(listByRun({ runId: 'runX', stateDir: dir }).filter((r) => r.operation_class === 'TOMBSTONE').length, 0);
});

// -- 3. TOCTOU: not-approved + unknown id REFUSE.
test('not-approved (pending) -> REFUSE; unknown proposal-id -> REFUSE', () => {
  const dir = freshState();
  const t = seedTarget('runX', dir);
  const pending = cullRecord({ targets: [t], justification: 'x', origin: 'test' }); // left pending
  assert.strictEqual(promoteProposal(pending.proposal_id, { stateDir: dir, nowIso: T0 }).refused, 'not-approved');
  assert.strictEqual(promoteProposal(hx('0'), { stateDir: dir, nowIso: T0 }).refused, 'proposal-not-found');
});

// -- 4. Scope guard: quarantine REFUSES (a recall-layer suppression, NOT a kernel op).
test('scope: quarantine -> REFUSE (recall-layer v3.8a, not a kernel op)', () => {
  const dir = freshState();
  const t = seedTarget('runX', dir);
  const q = quarantineRecord({ target: t, justification: 'x', origin: 'test' });
  updateDisposition(q.proposal_id, 'approved');
  assert.strictEqual(promoteProposal(q.proposal_id, { stateDir: dir, nowIso: T0 }).refused, 'op-not-supported');
});

// -- 4b (W2b). Multi-target cull -> COMMITTED TOMBSTONE on ALL targets (the W2a single-target refusal lifted).
test('W2b multi-target cull -> COMMITTED TOMBSTONE -> every target tombstoned', () => {
  const dir = freshState();
  const [a, b, c] = [seedTarget('runX', dir), seedTarget('runX', dir), seedTarget('runX', dir)];
  const res = promoteProposal(approvedOp(cullRecord, [a, b, c]), { stateDir: dir, nowIso: T0 });
  assert.strictEqual(res.ok, true, JSON.stringify(res));
  assert.strictEqual(res.operation_class, 'TOMBSTONE');
  const recs = listByRun({ runId: res.mints[0].runId, stateDir: dir });
  for (const t of [a, b, c]) {
    assert.strictEqual(manageLifecycleStatus(t, { records: recs, nowMs: Date.parse(T0) }).kernel_state, 'tombstoned');
  }
});

// -- 4c (W2b). content-dedup + merge -> COMMITTED SUPERSEDE (the op-map extension); reader reports superseded.
test('W2b merge -> COMMITTED SUPERSEDE -> every target superseded', () => {
  const dir = freshState();
  const [a, b] = [seedTarget('runX', dir), seedTarget('runX', dir)];
  const res = promoteProposal(approvedOp(mergeRecord, [a, b]), { stateDir: dir, nowIso: T0 });
  assert.strictEqual(res.ok, true, JSON.stringify(res));
  assert.strictEqual(res.operation_class, 'SUPERSEDE');
  const recs = listByRun({ runId: res.mints[0].runId, stateDir: dir });
  assert.strictEqual(manageLifecycleStatus(a, { records: recs, nowMs: Date.parse(T0) }).kernel_state, 'superseded');
  assert.strictEqual(manageLifecycleStatus(b, { records: recs, nowMs: Date.parse(T0) }).kernel_state, 'superseded');
});

test('W2b content-dedup -> COMMITTED SUPERSEDE (op-map)', () => {
  const dir = freshState();
  const [a, b] = [seedTarget('runX', dir), seedTarget('runX', dir)];
  const res = promoteProposal(approvedOp(contentDedupRecord, [a, b]), { stateDir: dir, nowIso: T0 });
  assert.strictEqual(res.ok, true, JSON.stringify(res));
  assert.strictEqual(res.operation_class, 'SUPERSEDE');
});

// -- 4d (W2b CRITICAL): the exact-SET post-condition rejects superset / subset / dup-pad decoys (the NEW-1
// generalization). Each decoy shares the idempotency_key (same proposalId) but a different affected_records.
test('W2b CRITICAL: superset / subset / dup-pad poison decoys all FAIL the exact-SET post-condition', () => {
  for (const decoyOf of [
    (a, b) => [a, b, hx('9')], // SUPERSET — a subset .includes would launder the victim
    (a) => [a],                // SUBSET — the mint only half-happened
    (a) => [a, a],             // DUP-PAD — right length, wrong cardinality
  ]) {
    const dir = freshState();
    const [a, b] = [seedTarget('runX', dir), seedTarget('runX', dir)];
    const pid = approvedOp(mergeRecord, [a, b]);
    const proposal = listProposals().find((p) => p.proposal_id === pid);
    const axiom = sha256(canonicalJsonSerialize(proposal));
    const decoy = buildManageOpRecord({ operationClass: 'SUPERSEDE', affectedRecords: decoyOf(a, b), proposalId: pid, runId: 'runX', approvalAxiomHash: axiom, schemaVersion: 'v6', nowIso: '2026-01-01T00:00:00.000Z' });
    assert.strictEqual(appendRecord(decoy, { runId: 'runX', stateDir: dir }).ok, true);
    const res = promoteProposal(pid, { stateDir: dir, nowIso: T0 });
    assert.strictEqual(res.ok, false, `decoy ${JSON.stringify(decoyOf(a, b))} should FAIL`);
    assert.strictEqual(res.failed, 'post-condition-mismatch');
    assert.strictEqual(res.deduped, true); // the same-key collision is real
  }
});

// -- 4e (W2b IDOR): per-target eligibility — ONE kernel-owned target (SAME run, else cross-run short-circuits)
// refuses the WHOLE op; no partial mint.
test('W2b IDOR: a multi-target set with one kernel-owned target -> REFUSE whole op, no mint', () => {
  const dir = freshState();
  const ok = seedTarget('runX', dir);
  const kernelOwned = seedTarget('runX', dir, 'kernel-loom-integrator');
  const res = promoteProposal(approvedOp(mergeRecord, [ok, kernelOwned]), { stateDir: dir, nowIso: T0 });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.refused, 'target-kernel-owned');
  assert.strictEqual(listByRun({ runId: 'runX', stateDir: dir }).filter((r) => r.operation_class === 'SUPERSEDE').length, 0);
});

// -- 4f (W2c): targets spanning runs now SUCCEED — one mint per run (the cross-run-deferred-w2c refusal is
// LIFTED in W2c). Full cross-run coverage lives in manage-promote-crossrun.test.js; this is the in-file smoke.
test('W2c cross-run: targets in different runs -> SUCCEED with one mint per run', () => {
  const dir = freshState();
  const a = seedTarget('runX', dir);
  const b = seedTarget('runY', dir);
  const res = promoteProposal(approvedOp(mergeRecord, [a, b]), { stateDir: dir, nowIso: T0 });
  assert.strictEqual(res.ok, true, JSON.stringify(res));
  assert.strictEqual(res.mints.length, 2);
  assert.deepStrictEqual(res.mints.map((m) => m.runId).sort(), ['runX', 'runY']);
});

// -- 4g (W2b INV-22): re-promoting a multi-target proposal DEDUPS (one SUPERSEDE).
test('W2b INV-22: re-promoting a multi-target proposal DEDUPS (one SUPERSEDE)', () => {
  const dir = freshState();
  const [a, b] = [seedTarget('runX', dir), seedTarget('runX', dir)];
  const pid = approvedOp(mergeRecord, [a, b]);
  const r1 = promoteProposal(pid, { stateDir: dir, nowIso: T0 });
  const r2 = promoteProposal(pid, { stateDir: dir, nowIso: '2026-06-09T00:00:00.000Z' });
  assert.strictEqual(r1.ok && r2.ok, true, JSON.stringify([r1, r2]));
  assert.strictEqual(r2.mints[0].deduped, true);
  assert.strictEqual(r1.mints[0].transaction_id, r2.mints[0].transaction_id);
  assert.strictEqual(listByRun({ runId: 'runX', stateDir: dir }).filter((r) => r.operation_class === 'SUPERSEDE').length, 1);
});

// -- 4h (W2b hacker HIGH): canonicalize-at-the-boundary — a planted AUTHENTIC but NON-canonical row
// (unsorted + duplicate) must promote correctly (not self-DoS the legit approval).
test('W2b canonicalize self-DoS: a planted authentic non-canonical [t2,t1,t1] row promotes to {t1,t2}', () => {
  const dir = freshState();
  const t1 = seedTarget('runX', dir);
  const t2 = seedTarget('runX', dir);
  const pid = plantProposal('merge', [t2, t1, t1]); // non-canonical, but proposal_id canonicalizes internally
  const res = promoteProposal(pid, { stateDir: dir, nowIso: T0 });
  assert.strictEqual(res.ok, true, JSON.stringify(res));
  assert.strictEqual(res.operation_class, 'SUPERSEDE');
  const recs = listByRun({ runId: res.mints[0].runId, stateDir: dir });
  assert.strictEqual(manageLifecycleStatus(t1, { records: recs, nowMs: Date.parse(T0) }).kernel_state, 'superseded');
  assert.strictEqual(manageLifecycleStatus(t2, { records: recs, nowMs: Date.parse(T0) }).kernel_state, 'superseded');
});

// -- 4i (W2b hacker MEDIUM): blast-radius re-cap — a planted authentic row over MAX_TARGETS REFUSES
// (the create-time cap is bypassed by the direct ledger write).
test('W2b too-many-targets: a planted authentic over-MAX_TARGETS row -> REFUSE too-many-targets', () => {
  const dir = freshState();
  const many = Array.from({ length: MAX_TARGETS + 1 }, (_, i) => sha256('t' + i));
  const pid = plantProposal('cull', many);
  const res = promoteProposal(pid, { stateDir: dir, nowIso: T0 });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.refused, 'too-many-targets');
});

// -- 4j (W2b VALIDATE hacker MEDIUM): the success result + its targets array are DEEPLY frozen — a shallow
// Object.freeze would leak a mutable derived array (the repo Testing-rule read-back-immutability class).
test('W2b immutability: the success result + its targets array are frozen', () => {
  const dir = freshState();
  const [a, b] = [seedTarget('runX', dir), seedTarget('runX', dir)];
  const res = promoteProposal(approvedOp(mergeRecord, [a, b]), { stateDir: dir, nowIso: T0 });
  assert.strictEqual(res.ok, true, JSON.stringify(res));
  assert.ok(Object.isFrozen(res) && Object.isFrozen(res.targets));
  // the new {mints:[...]} payload must be deep-frozen too (VALIDATE code-reviewer HIGH — the contract change moved
  // the primary payload into mints[]; a shallow freeze would leave the per-run entries + their targets mutable).
  assert.ok(Object.isFrozen(res.mints) && Object.isFrozen(res.mints[0]) && Object.isFrozen(res.mints[0].targets));
  assert.throws(() => res.targets.push('EVIL'), TypeError);
  assert.throws(() => res.mints.push('EVIL'), TypeError);
  assert.throws(() => res.mints[0].targets.push('EVIL'), TypeError);
});

// -- 4k (W2b VALIDATE hacker LOW): a planted op_type reaching the Object prototype (toString) -> REFUSE
// op-not-supported at promote's OWN boundary (not a truthy inherited Function slipping the !operationClass guard).
test('W2b op_type prototype-poison: a planted op_type=toString -> REFUSE op-not-supported', () => {
  const dir = freshState();
  const t = seedTarget('runX', dir);
  const pid = plantProposal('toString', [t]);
  assert.strictEqual(promoteProposal(pid, { stateDir: dir, nowIso: T0 }).refused, 'op-not-supported');
});

// never-throws (CodeRabbit Major): a same-uid PLANTED authentic row with a non-array target_records must
// REFUSE cleanly, not crash on `.length` (the contract is "never throws -- returns a frozen {ok,...}").
test('never-throws: a planted authentic proposal with non-array target_records -> REFUSE (not a throw)', () => {
  const dir = freshState();
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  // proposal_id content-addresses op_type + (canonicalized) targets; null targets canonicalize to [] -> a
  // stable, AUTHENTIC id, so listProposals serves the row (the store is not a sandbox -- p-writescope).
  const malformed = {
    node_type: 'manage-proposal', op_type: 'cull', target_records: null, disposition: 'approved',
    proposal_id: computeProposalId('cull', null), justification: 'x', proposer_origin: 't', recorded_at: T0, schema_version: 'v3.5',
  };
  fs.appendFileSync(LEDGER_PATH, JSON.stringify(malformed) + '\n');
  const res = promoteProposal(malformed.proposal_id, { stateDir: dir, nowIso: T0 });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.refused, 'invalid-proposal-shape'); // a clean refusal -- the never-throws contract holds
});

// -- 5. Phantom target REFUSE.
test('a phantom target (in no run) -> REFUSE (cannot tombstone what is not there)', () => {
  const dir = freshState();
  assert.strictEqual(promoteProposal(approvedCull([hx('e')]), { stateDir: dir, nowIso: T0 }).refused, 'target-not-found');
});

// -- 6. IDOR (hacker HIGH): a kernel-owned / manage-op target REFUSE.
test('IDOR: a kernel:-namespaced target -> REFUSE (target-kernel-owned)', () => {
  const dir = freshState();
  const t = seedTarget('runX', dir, 'kernel:gc-sweep'); // a kernel-owned record
  assert.strictEqual(promoteProposal(approvedCull([t]), { stateDir: dir, nowIso: T0 }).refused, 'target-kernel-owned');
});

test('IDOR: a target that is itself a manage-op (TOMBSTONE) -> REFUSE (target-is-a-manage-op)', () => {
  const dir = freshState();
  const op = buildManageOpRecord({ operationClass: 'TOMBSTONE', affectedRecords: [hx('a')], proposalId: hx('1'), runId: 'runX', approvalAxiomHash: hx('c'), schemaVersion: 'v6', nowIso: T0 });
  appendRecord(op, { runId: 'runX', stateDir: dir });
  assert.strictEqual(promoteProposal(approvedCull([op.transaction_id]), { stateDir: dir, nowIso: T0 }).refused, 'target-is-a-manage-op');
});

// -- 7. INV-22 re-promote dedups (post-condition still passes).
test('INV-22: re-promoting the same approved proposal DEDUPS (one TOMBSTONE), post-condition holds', () => {
  const dir = freshState();
  const t = seedTarget('runX', dir);
  const pid = approvedCull([t]);
  const r1 = promoteProposal(pid, { stateDir: dir, nowIso: T0 });
  const r2 = promoteProposal(pid, { stateDir: dir, nowIso: '2026-06-09T00:00:00.000Z' });
  assert.strictEqual(r1.ok && r2.ok, true);
  assert.strictEqual(r2.mints[0].deduped, true);
  assert.strictEqual(r1.mints[0].transaction_id, r2.mints[0].transaction_id); // same transaction
  assert.strictEqual(listByRun({ runId: 'runX', stateDir: dir }).filter((r) => r.operation_class === 'TOMBSTONE').length, 1);
});

// -- 7b/7c. EC1 TOCTOU (v3.6 phase-close legibility): the approve->execute window is closed by the
// content-addressed proposal_id — it IS the "re-verify the approved content-hash against approval-time" check
// (no snapshot field, which updateDisposition being writer-unauthenticated would leave equally forgeable).
test('EC1 TOCTOU: a target-swap KEEPING the approved id -> proposal-not-found (inauthentic row, skipped)', () => {
  const dir = freshState();
  const t1 = seedTarget('runX', dir);
  const evil = seedTarget('runX', dir);
  const idP = computeProposalId('cull', [t1]); // the id the human approved (over [t1])
  // attacker rewrites the ledger row to carry idP but a SWAPPED target-set -> the body no longer hashes to idP.
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.appendFileSync(LEDGER_PATH, JSON.stringify({
    node_type: 'manage-proposal', op_type: 'cull', target_records: [t1, evil], disposition: 'approved',
    proposal_id: idP, justification: 'x', proposer_origin: 't', recorded_at: T0, schema_version: 'v3.5',
  }) + '\n');
  assert.strictEqual(promoteProposal(idP, { stateDir: dir, nowIso: T0 }).refused, 'proposal-not-found');
});

test('EC1 TOCTOU: a RE-DERIVED swapped proposal is a distinct identity the human never approved -> not-approved', () => {
  const dir = freshState();
  const t1 = seedTarget('runX', dir);
  const evil = seedTarget('runX', dir);
  approvedCull([t1]); // human approves the op over [t1]
  const swapped = cullRecord({ targets: [t1, evil], justification: 'x', origin: 'test' }); // re-derived, left PENDING
  assert.strictEqual(promoteProposal(swapped.proposal_id, { stateDir: dir, nowIso: T0 }).refused, 'not-approved');
});

// -- 8. THE CRITICAL (hacker): an INV-22 poison-key decoy -> POST-CONDITION FAILS (no silent fail-open).
test('CRITICAL: a same-idempotency_key poison decoy -> POST-CONDITION FAILS (not a silent success)', () => {
  const dir = freshState();
  const t = seedTarget('runX', dir);
  const pid = approvedCull([t]);
  const proposal = listProposals().find((p) => p.proposal_id === pid);
  const axiom = sha256(canonicalJsonSerialize(proposal));
  // The attacker pre-plants a TOMBSTONE with the SAME idempotency_key (same proposalId -> same writer_spawn_id)
  // but affected_records:[decoy] (a DIFFERENT target). It is a valid record -> appends.
  const decoy = buildManageOpRecord({ operationClass: 'TOMBSTONE', affectedRecords: [hx('d')], proposalId: pid, runId: 'runX', approvalAxiomHash: axiom, schemaVersion: 'v6', nowIso: '2026-01-01T00:00:00.000Z' });
  assert.strictEqual(appendRecord(decoy, { runId: 'runX', stateDir: dir }).ok, true);
  // The human promotes -> appendRecord DEDUPS against the decoy (same key) -> writes nothing. The POST-CONDITION
  // catches that the stored op tombstones [decoy], NOT [t] -> HARD FAIL (the real target stays NOT tombstoned).
  const res = promoteProposal(pid, { stateDir: dir, nowIso: T0 });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.failed, 'post-condition-mismatch');
  const reader = manageLifecycleStatus(t, { records: listByRun({ runId: 'runX', stateDir: dir }), nowMs: Date.parse(T0) });
  assert.notStrictEqual(reader.kernel_state, 'tombstoned'); // the target was NEVER actually tombstoned
});

// -- 8b. THE CRITICAL NEW-1 (VALIDATE hacker): a SUPERSET decoy [target, victim] beats a subset .includes ->
//        the EXACT-equality post-condition rejects it (promote refuses to BLESS a laundered multi-target tombstone).
test('CRITICAL NEW-1: a SUPERSET poison decoy [target,victim] -> POST-CONDITION FAILS (exact-equality, not subset)', () => {
  const dir = freshState();
  const t = seedTarget('runX', dir);
  const pid = approvedCull([t]);
  const proposal = listProposals().find((p) => p.proposal_id === pid);
  const axiom = sha256(canonicalJsonSerialize(proposal));
  // The decoy carries the SAME idempotency_key (same proposalId) but affected_records:[t, victim] -- a SUPERSET
  // that a subset .includes(t) would bless. With OLD code promote returned ok:true (laundering the victim);
  // with EXACT-equality it returns failed. (The decoy itself standing in the store is the OQ-E forge residual.)
  const decoy = buildManageOpRecord({ operationClass: 'TOMBSTONE', affectedRecords: [t, hx('9')], proposalId: pid, runId: 'runX', approvalAxiomHash: axiom, schemaVersion: 'v6', nowIso: '2026-01-01T00:00:00.000Z' });
  assert.strictEqual(appendRecord(decoy, { runId: 'runX', stateDir: dir }).ok, true);
  const res = promoteProposal(pid, { stateDir: dir, nowIso: T0 });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.failed, 'post-condition-mismatch');
  assert.strictEqual(res.deduped, true); // it deduped against the decoy -> the same-key collision is real
});

// -- 8c. IDOR NEW-2 (VALIDATE hacker): the REAL kernel persona is 'kernel-loom-integrator' (hyphen, no colon);
//        the gate must catch 'kernel-' too, and normalize case/whitespace (MED-1).
test('IDOR NEW-2: the LIVE kernel persona (kernel-loom-integrator) + case/space evasions -> REFUSE', () => {
  const dir = freshState();
  const t = seedTarget('runX', dir, 'kernel-loom-integrator'); // the real integrator persona
  assert.strictEqual(promoteProposal(approvedCull([t]), { stateDir: dir, nowIso: T0 }).refused, 'target-kernel-owned');
  const t2 = seedTarget('runY', dir, ' KERNEL-Loom-X '); // case + whitespace evasion -> normalized
  assert.strictEqual(promoteProposal(approvedCull([t2]), { stateDir: dir, nowIso: T0 }).refused, 'target-kernel-owned');
});

// -- 9. CLI: `promote --proposal-id <id>` surfaces the result.
test('CLI promote --proposal-id: shadow-default REFUSE (no flag) -> exit 1 + structured result', () => {
  const dir = freshState();
  const t = seedTarget('runX', dir);
  const pid = approvedCull([t]);
  const env = { ...process.env, LOOM_LAB_STATE_DIR: LAB_TMP };
  delete env.LOOM_MANAGE_ENFORCE; // shadow
  let out; let status = 0;
  try { out = execFileSync(process.execPath, [P('lab', 'manage-proposal', 'cli.js'), 'promote', '--proposal-id', pid], { env, encoding: 'utf8' }); }
  catch (e) { out = e.stdout; status = e.status; }
  assert.strictEqual(status, 1);
  assert.strictEqual(JSON.parse(out).refused, 'shadow-default');
});

// -- 10. SHADOW: the promote surface has 0 hooks.json refs.
test('* SHADOW: hooks.json has no promote / manage-proposal / lab ref', () => {
  const hooks = fs.readFileSync(P('kernel', 'hooks.json'), 'utf8');
  assert.ok(!/manage-proposal/.test(hooks) && !/lab\//.test(hooks) && !/manage-promote/.test(hooks));
});

try { fs.rmSync(LAB_TMP, { recursive: true, force: true }); } catch { /* OS reclaims tmp */ }
process.stdout.write(`\nmanage-promote.test.js (v3.6 W2a + W2b.1): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
