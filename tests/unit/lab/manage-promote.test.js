#!/usr/bin/env node

// tests/unit/lab/manage-promote.test.js
//
// v3.6 Wave 2a — the human-gated manage-promote LOOP + its security contract (the leave-shadow MINT). This is
// the SAFETY PROOF for the first WAL mutation: every CLOSED hacker VERIFY/VALIDATE finding has a coverage test
// across the W2a suite (this file + record-locate.test.js); the ACCEPTED residuals (OQ-E forge, same-uid
// self-approval) are documented, not tested (a cooperative-model acceptance cannot be test-proven).
//   - the LOOP: approved cull -> COMMITTED TOMBSTONE in the target's run -> the W1 reader reports `tombstoned`.
//   - shadow-default (flag off) REFUSES; not-approved / unknown-id REFUSE (TOCTOU).
//   - scope guards: quarantine / content-dedup / merge / multi-target REFUSE.
//   - phantom target REFUSE; IDOR (kernel-owned / manage-op target) REFUSE.
//   - INV-22 re-promote DEDUPS (post-condition still passes).
//   - the CRITICAL: an INV-22 poison-key decoy -> POST-CONDITION FAILS (no silent fail-open).
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
const { listProposals, updateDisposition, LEDGER_PATH } = require(P('lab', 'manage-proposal', 'store.js'));
const { cullRecord, quarantineRecord, contentDedupRecord } = require(P('lab', 'manage-proposal', 'manage-ops.js'));
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
function approvedCull(targets) {
  const p = cullRecord({ targets, justification: 'stale', origin: 'test' });
  updateDisposition(p.proposal_id, 'approved');
  return p.proposal_id;
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
  const reader = manageLifecycleStatus(t, { records: listByRun({ runId: res.runId, stateDir: dir }), nowMs: Date.parse(T0) });
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

// -- 4. Scope guards: quarantine / content-dedup / merge / multi-target REFUSE.
test('scope: quarantine -> REFUSE (recall-layer); content-dedup/merge -> REFUSE (W2b)', () => {
  const dir = freshState();
  const t = seedTarget('runX', dir);
  const q = quarantineRecord({ target: t, justification: 'x', origin: 'test' });
  updateDisposition(q.proposal_id, 'approved');
  assert.strictEqual(promoteProposal(q.proposal_id, { stateDir: dir, nowIso: T0 }).refused, 'op-not-supported-in-w2a');
  const cd = contentDedupRecord({ targets: [t], justification: 'x', origin: 'test' });
  updateDisposition(cd.proposal_id, 'approved');
  assert.strictEqual(promoteProposal(cd.proposal_id, { stateDir: dir, nowIso: T0 }).refused, 'op-not-supported-in-w2a');
});

test('scope: a multi-target cull -> REFUSE (deferred to W2b)', () => {
  const dir = freshState();
  const [a, b] = [seedTarget('runX', dir), seedTarget('runX', dir)];
  assert.strictEqual(promoteProposal(approvedCull([a, b]), { stateDir: dir, nowIso: T0 }).refused, 'multi-target-deferred-w2b');
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
  const op = buildManageOpRecord({ operationClass: 'TOMBSTONE', affectedRecords: [hx('a')], proposalId: 'seed', approvalAxiomHash: hx('c'), schemaVersion: 'v6', nowIso: T0 });
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
  assert.strictEqual(r2.deduped, true);
  assert.strictEqual(r1.transaction_id, r2.transaction_id); // same transaction
  assert.strictEqual(listByRun({ runId: 'runX', stateDir: dir }).filter((r) => r.operation_class === 'TOMBSTONE').length, 1);
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
  const decoy = buildManageOpRecord({ operationClass: 'TOMBSTONE', affectedRecords: [hx('d')], proposalId: pid, approvalAxiomHash: axiom, schemaVersion: 'v6', nowIso: '2026-01-01T00:00:00.000Z' });
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
  const decoy = buildManageOpRecord({ operationClass: 'TOMBSTONE', affectedRecords: [t, hx('9')], proposalId: pid, approvalAxiomHash: axiom, schemaVersion: 'v6', nowIso: '2026-01-01T00:00:00.000Z' });
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
process.stdout.write(`\nmanage-promote.test.js (v3.6 W2a): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
