#!/usr/bin/env node

// tests/unit/lab/manage-lifecycle-consumer.test.js
//
// v3.6 Wave 1 (consumer-first, shadow): the manage-layer lifecycle READ consumer. Two units under test:
//   (1) approvedOpsByRecord(proposals)  - a Lab projection: APPROVED-only, ALL-op-type, tier-free
//       (a SIBLING of quarantinedRecords, NOT a superset). The "what approved manage-intent targets this
//       record" view that the v3.6 Wave 2 destructive mint will feed.
//   (2) manageLifecycleStatus(txid,{records,proposals,...}) - the composed consumer: the kernel's COMMITTED
//       lifecycle (projectLifecycleState, which takes a RECORD object - architect VERIFY CRITICAL-1) joined
//       with the manage-layer's approved intent. Tested as a DELTA (CRITICAL-2): there is no `live` state
//       (base = `active`); the {tombstoned,superseded,stale} branches light up ONLY when a COMMITTED
//       SUPERSEDE/TOMBSTONE is co-located in `records`.
//
// ADVISORY + SHADOW: the consumer only ANNOTATES (effective is a pure descriptive union, never a resolved
// suppress/delete/gate verdict - narrowing-safety). 0 hooks.json refs.
//
// ENV-BEFORE-REQUIRE: LOOM_LAB_STATE_DIR set before any require that may resolve store state (the CLI
// subprocess reads it; the pure units do not, but we set it uniformly for isolation).

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const TMP = path.join(os.tmpdir(), 'v36-lifecycle-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = TMP; // BEFORE the requires below
fs.mkdirSync(TMP, { recursive: true });

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const P = (...a) => path.join(REPO_ROOT, 'packages', ...a);
const { approvedOpsByRecord } = require(P('lab', 'manage-proposal', 'projections.js'));
const { manageLifecycleStatus } = require(P('lab', 'manage-proposal', 'lifecycle.js'));
const CLI = P('lab', 'manage-proposal', 'cli.js');

const hx = (ch) => ch.repeat(64);
const A = hx('a'); const B = hx('b'); const C = hx('c'); const D = hx('d');
const NOW = Date.parse('2026-06-08T00:00:00.000Z');
const recent = '2026-06-01T00:00:00.000Z'; // 7d < 90d retention -> not archivable
const old = '2026-01-01T00:00:00.000Z';     // ~158d > 90d -> archivable

// A plain COMMITTED kernel record (CREATE) for txid, with an injectable timestamp.
const committed = (txid, ts = recent) => ({
  transaction_id: txid, operation_class: 'CREATE', commit_outcome: 'COMMITTED', intent_recorded_at: ts,
});
// A COMMITTED destructive op naming `targets` in affected_records.
const destructiveOp = (txid, opClass, targets) => ({
  transaction_id: txid, operation_class: opClass, commit_outcome: 'COMMITTED', affected_records: targets,
  intent_recorded_at: recent, evidence_refs: ['ROOT_TASK_RECORD:t'],
});
// A manage-proposal literal (the projection is PURE over any array - no authentic proposal_id needed here).
const proposal = (opType, targets, disposition, id = 'pid-' + opType) => ({
  node_type: 'manage-proposal', proposal_id: id, op_type: opType, target_records: targets,
  disposition, justification: 'why ' + opType, proposer_origin: 'test',
});

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; } catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// ---- 1. approvedOpsByRecord: APPROVED-only, all-op-type, tier-free ----
test('approvedOpsByRecord: all 4 op_types surface for an approved proposal', () => {
  const ms = approvedOpsByRecord([
    proposal('quarantine', [A], 'approved'),
    proposal('content-dedup', [B], 'approved'),
    proposal('cull', [C], 'approved'),
    proposal('merge', [D], 'approved'),
  ]);
  assert.strictEqual(ms.get(A)[0].op_type, 'quarantine');
  assert.strictEqual(ms.get(B)[0].op_type, 'content-dedup');
  assert.strictEqual(ms.get(C)[0].op_type, 'cull');
  assert.strictEqual(ms.get(D)[0].op_type, 'merge');
});

test('approvedOpsByRecord: pending + rejected are EXCLUDED (approved-only)', () => {
  const ms = approvedOpsByRecord([
    proposal('quarantine', [A], 'pending'),
    proposal('cull', [B], 'rejected'),
  ]);
  assert.strictEqual(ms.has(A), false, 'pending excluded');
  assert.strictEqual(ms.has(B), false, 'rejected excluded');
});

test('approvedOpsByRecord: one txid targeted by TWO approved op_types -> both listed', () => {
  const ms = approvedOpsByRecord([
    proposal('quarantine', [A], 'approved', 'pid-q'),
    proposal('cull', [A], 'approved', 'pid-c'),
  ]);
  const ops = ms.get(A).map((o) => o.op_type).sort();
  assert.deepStrictEqual(ops, ['cull', 'quarantine']);
});

test('approvedOpsByRecord: a garbage op_type is EXCLUDED (closed-enum membership)', () => {
  const ms = approvedOpsByRecord([proposal('evil', [A], 'approved')]);
  assert.strictEqual(ms.has(A), false);
});

test('approvedOpsByRecord: non-array / empty -> empty Map', () => {
  assert.strictEqual(approvedOpsByRecord(null).size, 0);
  assert.strictEqual(approvedOpsByRecord([]).size, 0);
});

test('approvedOpsByRecord: each entry carries op_type + proposal_id + justification', () => {
  const e = approvedOpsByRecord([proposal('merge', [A], 'approved', 'pid-xyz')]).get(A)[0];
  assert.strictEqual(e.proposal_id, 'pid-xyz');
  assert.strictEqual(e.justification, 'why merge');
});

// ---- 2. manageLifecycleStatus: the DELTA (kernel-half forward-correctness) ----
test('manageLifecycleStatus: a plain recent COMMITTED record -> kernel_state active (NOT live)', () => {
  const r = manageLifecycleStatus(A, { records: [committed(A)], proposals: [], nowMs: NOW });
  assert.strictEqual(r.kernel_state, 'active');
});

test('manageLifecycleStatus: inject a COMMITTED SUPERSEDE targeting A -> superseded', () => {
  const records = [committed(A), destructiveOp(B, 'SUPERSEDE', [A])];
  assert.strictEqual(manageLifecycleStatus(A, { records, nowMs: NOW }).kernel_state, 'superseded');
});

test('manageLifecycleStatus: inject a COMMITTED TOMBSTONE targeting A -> tombstoned', () => {
  const records = [committed(A), destructiveOp(B, 'TOMBSTONE', [A])];
  assert.strictEqual(manageLifecycleStatus(A, { records, nowMs: NOW }).kernel_state, 'tombstoned');
});

test('manageLifecycleStatus: record ABSENT from records -> kernel_state unknown (the run-seam default)', () => {
  assert.strictEqual(manageLifecycleStatus(A, { records: [], nowMs: NOW }).kernel_state, 'unknown');
  assert.strictEqual(manageLifecycleStatus(A, { proposals: [] }).kernel_state, 'unknown');
});

test('manageLifecycleStatus: an OLD COMMITTED record archives on age alone (architect CRITICAL-2)', () => {
  const r = manageLifecycleStatus(A, { records: [committed(A, old)], nowMs: NOW });
  assert.strictEqual(r.kernel_state, 'archived');
});

// ---- 3. manageLifecycleStatus: the manage-half + the narrowing-safe `effective` union ----
test('manageLifecycleStatus: approved manage-intent surfaces in approved_ops', () => {
  const r = manageLifecycleStatus(A, { records: [committed(A)], proposals: [proposal('cull', [A], 'approved')], nowMs: NOW });
  assert.strictEqual(r.approved_ops[0].op_type, 'cull');
});

test('manageLifecycleStatus: the CROSS-HALF composed case (kernel superseded + approved cull) - the W2 input shape', () => {
  const records = [committed(A), destructiveOp(B, 'SUPERSEDE', [A])];
  const r = manageLifecycleStatus(A, { records, proposals: [proposal('cull', [A], 'approved')], nowMs: NOW });
  assert.strictEqual(r.kernel_state, 'superseded');         // kernel reality
  assert.strictEqual(r.approved_ops[0].op_type, 'cull');    // human intent
  assert.strictEqual(r.effective.committed, 'superseded');  // the union carries BOTH, orthogonally
  assert.ok(r.effective.pending_intent.includes('cull'));
});

test('manageLifecycleStatus: effective is a PURE UNION - no operation_class value, no suppress/delete/gate key', () => {
  const r = manageLifecycleStatus(A, { records: [committed(A)], proposals: [proposal('cull', [A], 'approved')], nowMs: NOW });
  assert.deepStrictEqual(Object.keys(r.effective).sort(), ['committed', 'pending_intent']);
  // pending_intent holds lab op_types, NEVER a kernel operation_class (SUPERSEDE/TOMBSTONE).
  assert.ok(r.effective.pending_intent.every((op) => op !== 'SUPERSEDE' && op !== 'TOMBSTONE'));
  // no actionable verdict key leaks (narrowing-safety: the consumer annotates, never instructs).
  const banned = ['suppress', 'delete', 'gate', 'verdict', 'action', 'enforce'];
  for (const k of banned) assert.ok(!(k in r.effective) && !(k in r), `no ${k} key`);
  assert.strictEqual(r.advisory, true);
});

test('manageLifecycleStatus: the returned verdict is frozen (immutability discipline)', () => {
  const r = manageLifecycleStatus(A, { records: [committed(A)], proposals: [proposal('cull', [A], 'approved')], nowMs: NOW });
  assert.ok(Object.isFrozen(r) && Object.isFrozen(r.approved_ops) && Object.isFrozen(r.effective)
    && Object.isFrozen(r.effective.pending_intent)); // the inner array too (freeze is shallow; #266 rule)
  assert.throws(() => { r.kernel_state = 'x'; }, TypeError);
});

// ---- 4. the CLI `lifecycle --txid <hex>` subcommand (the LIVE caller that closes the dark edge) ----
const runCli = (args) => execFileSync(process.execPath, [CLI, ...args], {
  env: { ...process.env, LOOM_LAB_STATE_DIR: TMP }, encoding: 'utf8',
});
test('CLI lifecycle --txid <hex>: valid -> JSON verdict (empty store -> unknown / [])', () => {
  const out = JSON.parse(runCli(['lifecycle', '--txid', A]));
  assert.strictEqual(out.txid, A);
  // W2c wired loadRecordsForTarget into the CLI (the run-seam is CLOSED); for an UNSEEDED txid the kernel store
  // holds no record -> [] -> 'unknown'. (The seeded loadRecordsForTarget -> 'tombstoned' path is covered
  // programmatically in manage-promote-crossrun.test.js tests 1-2; the CLI reads the real ~/.claude/spawn-state,
  // so a hermetic CLI-level kernel_state assertion isn't possible without a kernel-stateDir env — out of scope.)
  assert.strictEqual(out.kernel_state, 'unknown');
  assert.deepStrictEqual(out.approved_ops, []);
  assert.strictEqual(out.advisory, true);
});

test('CLI lifecycle: a non-hex --txid fails clean (exit 1, no stack dump)', () => {
  assert.throws(() => runCli(['lifecycle', '--txid', 'not-hex']), (e) => e.status === 1);
});

test('CLI lifecycle: a missing --txid fails clean (exit 1)', () => {
  assert.throws(() => runCli(['lifecycle']), (e) => e.status === 1);
});

test('CLI lifecycle: a bare --txid (no value -> parseArgs true) fails clean (exit 1)', () => {
  assert.throws(() => runCli(['lifecycle', '--txid']), (e) => e.status === 1);
});

// ---- 5. SHADOW: the new surface has 0 hooks.json refs ----
// NOTE: check `lab/` + `manage-proposal` (the consumer lives at lab/manage-proposal/lifecycle.js) - NOT a
// bare /lifecycle/, which false-positives on the kernel's UNRELATED hooks/lifecycle/ dir (pre-compact etc).
test('* SHADOW: hooks.json has no manage-proposal / lab ref', () => {
  const hooks = fs.readFileSync(P('kernel', 'hooks.json'), 'utf8');
  assert.ok(!/manage-proposal/.test(hooks), 'no manage-proposal ref');
  assert.ok(!/lab\//.test(hooks), 'no lab/ ref');
});

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* OS reclaims tmp */ }
process.stdout.write(`\nmanage-lifecycle-consumer.test.js (v3.6 W1): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
