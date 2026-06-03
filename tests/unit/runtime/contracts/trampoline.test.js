#!/usr/bin/env node

// tests/unit/runtime/contracts/trampoline.test.js
//
// R6 (v3.2 Wave 1) — the Pattern-A persona-internal trampoline. Integrates R7
// (todo-checkpoint), R8 (decomposition-disciplines), R10 (budget-tracker recursion
// depth), and the kernel record path. Serial; descends one recursion level per
// leaf, building a nested folder hierarchy under the run scratch dir, bounded by
// the R10 depth budget. On budget exhaust it emits a `commit_outcome: ABORTED`
// transaction record (built DIRECTLY — NOT via buildSpawnRecord, which hardcodes
// COMMITTED — plan Q5 CRITICAL).
//
// THIS FILE CARRIES THE WAVE-1 EXIT DEMO (exit-criterion #1): a 3-leaf task
// completes within budget; an over-budget run aborts cleanly.
//
// Run-state + record store both isolated to a tmp dir (HETS_RUN_STATE_DIR for the
// checkpoint/folders; stateDir passed through for the canonical record store).

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TMP = path.join(os.tmpdir(), 'trampoline-' + crypto.randomBytes(6).toString('hex'));
process.env.HETS_RUN_STATE_DIR = TMP;
fs.mkdirSync(TMP, { recursive: true });

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const { runTrampoline } = require(path.join(
  REPO_ROOT, 'packages', 'runtime', 'orchestration', 'trampoline.js',
));
const { readCheckpoint } = require(path.join(
  REPO_ROOT, 'packages', 'runtime', 'orchestration', 'todo-checkpoint.js',
));
const { getRecursion } = require(path.join(
  REPO_ROOT, 'packages', 'runtime', 'orchestration', 'budget-tracker.js',
));
const { validateTransactionRecord } = require(path.join(
  REPO_ROOT, 'packages', 'kernel', '_lib', 'transaction-record.js',
));

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}
function throws(fn, re) {
  try { fn(); return false; } catch (e) { return re ? re.test(e.message) : true; }
}

const threeLeaves = () => [
  { id: 'step-1', content: 'first', discipline: 'spec-driven' },
  { id: 'step-2', content: 'second', discipline: 'tdd' },
  { id: 'step-3', content: 'third', discipline: 'spec-driven' },
];
const base = (over) => ({
  runId: over.runId,
  personaId: 'planner',
  schemaVersion: 'v3',
  taskId: 'root-task-42',
  leaves: over.leaves || threeLeaves(),
  maxDepth: over.maxDepth,
  stateDir: TMP,
});

test('exports runTrampoline', () => {
  assert.strictEqual(typeof runTrampoline, 'function');
});

// ---- EXIT DEMO #1: a 3-leaf task completes within budget (R6 + R7 + R10) ----
test('EXIT DEMO: 3-leaf task completes within budget', () => {
  const res = runTrampoline(base({ runId: 'demo-ok', maxDepth: 3 }));
  assert.strictEqual(res.outcome, 'COMPLETED');
  assert.strictEqual(res.leavesCompleted, 3);
  // R7: every leaf is completed in the checkpoint
  const cp = readCheckpoint('demo-ok');
  assert.deepStrictEqual(cp.leaves.map((l) => l.status), ['completed', 'completed', 'completed']);
  // R10: recursion fully unwound, peak reached 3
  const rec = getRecursion('demo-ok');
  assert.strictEqual(rec.currentDepth, 0, 'recursion unwound');
  assert.strictEqual(rec.peakDepth, 3, 'peak depth = leaf count');
  // folder hierarchy: nested decomposition/step-1/step-2/step-3 exists
  assert.ok(fs.existsSync(path.join(TMP, 'demo-ok', 'decomposition', 'step-1', 'step-2', 'step-3')));
});

// ---- EXIT DEMO #2: an over-budget run aborts cleanly with a valid ABORTED record ----
test('EXIT DEMO: over-budget run aborts; emits a valid ABORTED transaction record', () => {
  const res = runTrampoline(base({ runId: 'demo-abort', maxDepth: 2 }));
  assert.strictEqual(res.outcome, 'ABORTED');
  assert.strictEqual(res.abortedAtLeaf, 'step-3');
  // R7: leaves 1-2 completed, leaf 3 left pending (never processed)
  const cp = readCheckpoint('demo-abort');
  assert.deepStrictEqual(cp.leaves.map((l) => l.status), ['completed', 'completed', 'pending']);
  // the ABORTED record is well-formed + canonical
  const r = res.record;
  assert.strictEqual(r.commit_outcome, 'ABORTED');
  assert.strictEqual(r.abort_reason, 'budget-exhausted', 'canonical abort_reason (not recursion-depth-exhausted)');
  assert.strictEqual(r.operation_class, 'CREATE');
  assert.ok(/^ROOT_TASK_RECORD:/.test(r.evidence_refs[0]), 'bootstrap sentinel binds the root task');
  assert.strictEqual(validateTransactionRecord(r).valid, true, 'record passes validateTransactionRecord');
  // appendRecord accepted + persisted it
  assert.strictEqual(res.appendResult.ok, true);
  assert.ok(fs.existsSync(res.appendResult.file), 'record file persisted in the canonical store');
  // R10 unwound even on the abort path
  assert.strictEqual(getRecursion('demo-abort').currentDepth, 0);
  // folders: step-1/step-2 created, step-3 NOT (aborted before its mkdir)
  assert.ok(fs.existsSync(path.join(TMP, 'demo-abort', 'decomposition', 'step-1', 'step-2')));
  assert.ok(!fs.existsSync(path.join(TMP, 'demo-abort', 'decomposition', 'step-1', 'step-2', 'step-3')));
});

test('boundary: maxDepth == leaf count is WITHIN budget (depthExhausted is strict >)', () => {
  // 3 leaves, maxDepth 3 → depth reaches 3, 3 > 3 is false → COMPLETED (off-by-one guard)
  assert.strictEqual(runTrampoline(base({ runId: 'demo-boundary', maxDepth: 3 })).outcome, 'COMPLETED');
});

test('R8 integration: a leaf with an UNFROZEN discipline is rejected (Option A enforced)', () => {
  assert.ok(throws(() => runTrampoline(base({
    runId: 'demo-r8',
    leaves: [{ id: 'a', content: 'a', discipline: 'exploratory' }],
    maxDepth: 3,
  })), /discipline|exploratory|vocabulary/i), 'exploratory rejected per the frozen Option A set');
});

test('write-scope: a traversal leaf-id is rejected before mkdir', () => {
  assert.ok(throws(() => runTrampoline(base({
    runId: 'demo-scope',
    leaves: [{ id: '../escape', content: 'x', discipline: 'tdd' }],
    maxDepth: 3,
  })), /escape|scope|run-state|leaf/i), 'hostile leaf-id rejected');
  assert.ok(!fs.existsSync(path.join(TMP, '..', 'escape')), 'no escaping folder created');
});

test('rejects an unsafe runId (isSafeRunId contract for the record store)', () => {
  assert.ok(throws(() => runTrampoline(base({ runId: '../bad', maxDepth: 3 })), /run|escape|scope/i));
});

// --- VALIDATE regression: the runId-traversal cross-run clobber (hacker VULNERABLE) ---
test('SECURITY: an in-base traversal runId is rejected (no cross-run clobber)', () => {
  // A legit run leaves a 3-leaf completed checkpoint.
  runTrampoline(base({ runId: 'safe-run', maxDepth: 3 }));
  const before = readCheckpoint('safe-run').leaves.map((l) => l.id);
  // `safe-run/../safe-run` path.join-collapses to the SAME dir — must be rejected
  // on the RAW token (checkWithinRoot alone is blinded by the pre-normalization).
  assert.ok(throws(() => runTrampoline(base({
    runId: 'safe-run/../safe-run', maxDepth: 9,
    leaves: [{ id: 'X', content: 'x', discipline: 'tdd' }],
  })), /run|segment|separator|scope/i), 'traversal runId rejected');
  // the legit checkpoint is intact (NOT clobbered)
  assert.deepStrictEqual(readCheckpoint('safe-run').leaves.map((l) => l.id), before);
});

test('SECURITY: a runId collapsing to the run-state root is rejected', () => {
  assert.ok(throws(() => runTrampoline(base({
    runId: 'x/..', maxDepth: 3, leaves: [{ id: 'Y', content: 'y', discipline: 'tdd' }],
  })), /run|segment|separator|scope/i));
  assert.ok(!fs.existsSync(path.join(TMP, 'todo-checkpoint.json')), 'nothing written at the run-state root');
});

test('DoS guard: an over-large leaf count is rejected (bounded fs growth)', () => {
  const many = Array.from({ length: 65 }, (_, i) => ({ id: `n${i}`, content: 'x', discipline: 'tdd' }));
  assert.ok(throws(() => runTrampoline(base({ runId: 'demo-many', leaves: many, maxDepth: 100 })), /leaves|too many|exceed/i));
});

test('taskId is validated UP FRONT (no partial state on a bad taskId)', () => {
  const opts = base({ runId: 'demo-notask', maxDepth: 3 });
  opts.taskId = '';
  assert.ok(throws(() => runTrampoline(opts), /taskId|task id/i));
  assert.strictEqual(readCheckpoint('demo-notask'), null, 'no checkpoint written on a bad taskId');
});

fs.rmSync(TMP, { recursive: true, force: true });
process.stdout.write(`\ntrampoline.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
