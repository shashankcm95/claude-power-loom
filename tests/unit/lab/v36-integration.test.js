#!/usr/bin/env node

// tests/unit/lab/v36-integration.test.js
//
// v3.6 PHASE-LEVEL integration pin (the standalone regression the phase-close Principal-SDE lens flagged as
// missing). The per-wave suites test each wave in isolation; THIS file exercises the COMPOSED W1->W2c pipeline as
// single end-to-end scenarios, so a future reshape that breaks the SEAM between waves is caught by one test —
// not only when all the per-wave edge tests happen to still pass individually. Mirrors the live dogfood.
//
// The integrated loop: seed target -> create cull proposal -> human approves -> promote (shadow REFUSE without
// the flag; COMMITTED TOMBSTONE with LOOM_MANAGE_ENFORCE=1) -> the W1 reader (via the W2c cross-run loader)
// reports `tombstoned` -> re-promote DEDUPS. Plus the cross-run seam, the breaker halt, and the safety refusals.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const LAB_TMP = path.join(os.tmpdir(), 'v36int-lab-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = LAB_TMP; // BEFORE the requires
fs.mkdirSync(LAB_TMP, { recursive: true });

const REPO = path.join(__dirname, '..', '..', '..');
const P = (...a) => path.join(REPO, 'packages', ...a);
const { cullRecord } = require(P('lab', 'manage-proposal', 'manage-ops.js'));
const { updateDisposition, listProposals } = require(P('lab', 'manage-proposal', 'store.js'));
const { promoteProposal } = require(P('lab', 'manage-proposal', 'promote.js'));
const { manageLifecycleStatus } = require(P('lab', 'manage-proposal', 'lifecycle.js'));
const { loadRecordsForTarget } = require(P('lab', 'manage-proposal', 'crossrun-load.js'));
const { buildSpawnRecord } = require(P('kernel', '_lib', 'quarantine-promote.js'));
const { computePostStateHash } = require(P('kernel', '_lib', 'transaction-record.js'));
const { appendRecord, listByRun } = require(P('kernel', '_lib', 'record-store.js'));

const hx = (c) => c.repeat(64);
const T0 = '2026-06-10T00:00:00.000Z';
let seq = 0;
function freshState() {
  try { fs.rmSync(path.join(LAB_TMP, 'manage-proposals'), { recursive: true, force: true }); } catch { /* none */ }
  const dir = path.join(os.tmpdir(), 'v36int-rec-' + crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function seedTarget(runId, stateDir, persona = 'p1') {
  seq += 1;
  const rec = buildSpawnRecord({ agentId: 'int' + seq, personaId: persona, schemaVersion: 'v6', postStateHash: computePostStateHash(hx('f')) });
  appendRecord(rec, { runId, stateDir });
  return rec.transaction_id;
}
const approve = (targets) => { const p = cullRecord({ targets, justification: 'integration', origin: 'test' }); updateDisposition(p.proposal_id, 'approved'); return p.proposal_id; };
const readState = (txid, stateDir) => manageLifecycleStatus(txid, { records: loadRecordsForTarget(txid, { stateDir }), proposals: listProposals() }).kernel_state;

let passed = 0; let failed = 0;
function test(name, fn) {
  process.env.LOOM_MANAGE_ENFORCE = '1';
  delete process.env.LOOM_BREAKER_GLOBAL_MAX_DENIALS;
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; } catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

// -- 1. THE FULL SINGLE-TARGET LOOP, composed: shadow-refuse -> enforced mint -> reader tombstoned -> dedup.
test('the integrated loop: shadow-refuse -> enforced TOMBSTONE -> reader tombstoned -> re-promote dedups', () => {
  const dir = freshState();
  const t = seedTarget('runA', dir);
  const pid = approve([t]);

  // shadow default (flag off) REFUSES — nothing minted
  delete process.env.LOOM_MANAGE_ENFORCE;
  const shadow = promoteProposal(pid, { stateDir: dir, nowIso: T0 });
  assert.strictEqual(shadow.refused, 'shadow-default');
  assert.strictEqual(listByRun({ runId: 'runA', stateDir: dir }).filter((r) => r.operation_class === 'TOMBSTONE').length, 0, 'no mint under shadow');
  assert.strictEqual(readState(t, dir), 'active', 'still active under shadow');

  // flag on -> the real COMMITTED TOMBSTONE, with the A10 evidence sentinel
  process.env.LOOM_MANAGE_ENFORCE = '1';
  const mint = promoteProposal(pid, { stateDir: dir, nowIso: T0 });
  assert.strictEqual(mint.ok, true, JSON.stringify(mint));
  assert.strictEqual(mint.operation_class, 'TOMBSTONE');
  const stored = listByRun({ runId: 'runA', stateDir: dir }).find((r) => r.transaction_id === mint.mints[0].transaction_id);
  assert.ok(stored.evidence_refs[0].startsWith('USER_INTENT_AXIOM:'), 'A10 bootstrap evidence');

  // the W1 reader (fed by the W2c cross-run loader) reports tombstoned — the loop closes
  assert.strictEqual(readState(t, dir), 'tombstoned');

  // re-promote is an idempotent no-op (same txid)
  const re = promoteProposal(pid, { stateDir: dir, nowIso: '2026-06-11T00:00:00.000Z' });
  assert.strictEqual(re.mints[0].deduped, true);
  assert.strictEqual(re.mints[0].transaction_id, mint.mints[0].transaction_id);
  assert.strictEqual(listByRun({ runId: 'runA', stateDir: dir }).filter((r) => r.operation_class === 'TOMBSTONE').length, 1, 'still exactly one');
});

// -- 2. THE W1<->W2c SEAM: a cross-run promotion is reported per-target via the cross-run loader.
test('the cross-run seam: targets in runX+runY -> per-run mints -> each reported tombstoned via loadRecordsForTarget', () => {
  const dir = freshState();
  const a = seedTarget('runX', dir);
  const b = seedTarget('runY', dir);
  const res = promoteProposal(approve([a, b]), { stateDir: dir, nowIso: T0 });
  assert.strictEqual(res.ok, true, JSON.stringify(res));
  assert.deepStrictEqual(res.mints.map((m) => m.runId).sort(), ['runX', 'runY']);
  // the reader does NOT know which run each target lives in — loadRecordsForTarget locates it; both report tombstoned
  assert.strictEqual(readState(a, dir), 'tombstoned');
  assert.strictEqual(readState(b, dir), 'tombstoned');
});

// -- 3. THE BREAKER halts the integrated path once the windowed mint-rate is exceeded.
test('the breaker halts: with the threshold exceeded by prior mints, a further promotion is REFUSED (no mint)', () => {
  const dir = freshState();
  process.env.LOOM_BREAKER_GLOBAL_MAX_DENIALS = '2';
  // two committed mints in the window (each its own single-run cull)
  promoteProposal(approve([seedTarget('r1', dir)]), { stateDir: dir, nowIso: T0 });
  promoteProposal(approve([seedTarget('r2', dir)]), { stateDir: dir, nowIso: T0 });
  // a third promotion: the window now holds 2 >= threshold 2 -> the breaker is open
  const blocked = promoteProposal(approve([seedTarget('r3', dir)]), { stateDir: dir, nowIso: T0 });
  assert.strictEqual(blocked.ok, false);
  assert.ok(blocked.refused === 'breaker-open' || blocked.refused === 'breaker-would-exceed', `breaker halt, got ${blocked.refused}`);
  assert.strictEqual(listByRun({ runId: 'r3', stateDir: dir }).filter((r) => r.operation_class === 'TOMBSTONE').length, 0, 'the blocked op minted nothing');
});

// -- 4. SAFETY refusals compose: kernel-owned target + an unapproved (pending) proposal both REFUSE.
test('safety: a kernel-owned target -> target-kernel-owned; an unapproved proposal -> not-approved', () => {
  const dir = freshState();
  const kt = seedTarget('runK', dir, 'kernel-loom-integrator');
  assert.strictEqual(promoteProposal(approve([kt]), { stateDir: dir, nowIso: T0 }).refused, 'target-kernel-owned');
  // an approved-then-unapproved-style check: a pending proposal (never approved) refuses
  const pendingPid = cullRecord({ targets: [seedTarget('runP', dir)], justification: 'x', origin: 'test' }).proposal_id;
  assert.strictEqual(promoteProposal(pendingPid, { stateDir: dir, nowIso: T0 }).refused, 'not-approved');
});

// -- 5. SHADOW: the integrated surface has 0 hooks.json refs (a plugin-restart auto-triggers NOTHING).
test('* SHADOW: hooks.json has no manage-proposal / manage-promote / lab ref (no live auto-trigger)', () => {
  const hooks = fs.readFileSync(P('kernel', 'hooks.json'), 'utf8');
  assert.ok(!/manage-proposal/.test(hooks) && !/manage-promote/.test(hooks) && !/lab\//.test(hooks));
});

try { fs.rmSync(LAB_TMP, { recursive: true, force: true }); } catch { /* OS reclaims tmp */ }
process.stdout.write(`\nv36-integration.test.js (v3.6 phase-level pin): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
