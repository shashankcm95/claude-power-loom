#!/usr/bin/env node

// tests/unit/runtime/contracts/todo-checkpoint.test.js
//
// R7 (v3.2 Wave 1) — the TodoWrite-as-checkpoint primitive: the durable ledger
// the Pattern-A trampoline (R6) writes against. NOT a TodoWrite tool-observer
// (TodoWrite is unhooked); a pure data primitive modeled on budget-tracker.js
// (import-friendly, atomic write, own per-file lock, no process.exit).
//
// Liskov invariant (mirrors TodoWrite): at most one leaf `in_progress` at a time.
// Run-state isolated to a tmp HETS_RUN_STATE_DIR set BEFORE the import.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TMP = path.join(os.tmpdir(), 'todo-checkpoint-' + crypto.randomBytes(6).toString('hex'));
process.env.HETS_RUN_STATE_DIR = TMP;
fs.mkdirSync(TMP, { recursive: true });

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const {
  writeCheckpoint,
  updateLeafStatus,
  readCheckpoint,
  CHECKPOINT_STATUSES,
} = require(path.join(
  REPO_ROOT, 'packages', 'runtime', 'orchestration', 'todo-checkpoint.js',
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

test('exports the API + the status vocabulary', () => {
  assert.strictEqual(typeof writeCheckpoint, 'function');
  assert.strictEqual(typeof updateLeafStatus, 'function');
  assert.strictEqual(typeof readCheckpoint, 'function');
  assert.deepStrictEqual([...CHECKPOINT_STATUSES], ['pending', 'in_progress', 'completed']);
});

test('writeCheckpoint persists leaves + stamps runId/createdAt/updatedAt', () => {
  const cp = writeCheckpoint('run-1', [
    { id: 'a', content: 'leaf a' },
    { id: 'b', content: 'leaf b' },
  ]);
  assert.strictEqual(cp.runId, 'run-1');
  assert.strictEqual(cp.leaves.length, 2);
  assert.ok(cp.createdAt && cp.updatedAt);
  assert.ok(fs.existsSync(path.join(TMP, 'run-1', 'todo-checkpoint.json')));
});

test('writeCheckpoint defaults missing status to pending', () => {
  const cp = writeCheckpoint('run-2', [{ id: 'x', content: 'x' }]);
  assert.strictEqual(cp.leaves[0].status, 'pending');
});

test('readCheckpoint round-trips; null for an unknown run', () => {
  writeCheckpoint('run-3', [{ id: 'a', content: 'a' }]);
  assert.strictEqual(readCheckpoint('run-3').leaves[0].id, 'a');
  assert.strictEqual(readCheckpoint('run-UNKNOWN'), null);
});

test('writeCheckpoint stores discipline OPAQUELY (R7 does not own the R8 vocabulary)', () => {
  // R7 is decoupled from R8 — it stores whatever discipline R6 hands it. R6/R9
  // own vocabulary validation. So even a non-frozen value persists here.
  const cp = writeCheckpoint('run-4', [{ id: 'a', content: 'a', discipline: 'exploratory' }]);
  assert.strictEqual(cp.leaves[0].discipline, 'exploratory');
});

test('writeCheckpoint rejects malformed leaves', () => {
  assert.ok(throws(() => writeCheckpoint('r', 'notarray'), /array/i), 'non-array leaves');
  assert.ok(throws(() => writeCheckpoint('r', [{ content: 'no id' }]), /id/i), 'missing id');
  assert.ok(throws(() => writeCheckpoint('r', [{ id: 'a', content: 'a' }, { id: 'a', content: 'b' }]), /unique|duplicate/i), 'dup ids');
  assert.ok(throws(() => writeCheckpoint('r', [{ id: 'a', content: 123 }]), /content/i), 'non-string content');
  assert.ok(throws(() => writeCheckpoint('r', [{ id: 'a', content: 'a', status: 'bogus' }]), /status/i), 'invalid status');
});

test('writeCheckpoint enforces at-most-one in_progress (Liskov: TodoWrite semantics)', () => {
  assert.ok(throws(() => writeCheckpoint('r', [
    { id: 'a', content: 'a', status: 'in_progress' },
    { id: 'b', content: 'b', status: 'in_progress' },
  ]), /in_progress/), 'two in_progress rejected');
});

test('updateLeafStatus advances a leaf pending->in_progress->completed + bumps updatedAt', () => {
  const cp0 = writeCheckpoint('run-5', [{ id: 'a', content: 'a' }, { id: 'b', content: 'b' }]);
  const before = cp0.updatedAt;
  const cp1 = updateLeafStatus('run-5', 'a', 'in_progress');
  assert.strictEqual(cp1.leaves.find((l) => l.id === 'a').status, 'in_progress');
  const cp2 = updateLeafStatus('run-5', 'a', 'completed');
  assert.strictEqual(cp2.leaves.find((l) => l.id === 'a').status, 'completed');
  assert.ok(cp2.updatedAt >= before);
});

test('updateLeafStatus to in_progress idempotent on the SAME leaf; rejects a 2nd concurrent leaf', () => {
  writeCheckpoint('run-6', [{ id: 'a', content: 'a' }, { id: 'b', content: 'b' }]);
  updateLeafStatus('run-6', 'a', 'in_progress');
  // same leaf again — fine
  updateLeafStatus('run-6', 'a', 'in_progress');
  // a different leaf while 'a' is in_progress — rejected
  assert.ok(throws(() => updateLeafStatus('run-6', 'b', 'in_progress'), /in_progress/), 'second concurrent in_progress rejected');
});

test('updateLeafStatus rejects unknown run / unknown leaf / invalid status', () => {
  assert.ok(throws(() => updateLeafStatus('run-NONE', 'a', 'completed'), /no checkpoint|not found/i), 'unknown run');
  writeCheckpoint('run-7', [{ id: 'a', content: 'a' }]);
  assert.ok(throws(() => updateLeafStatus('run-7', 'zzz', 'completed'), /leaf|not found/i), 'unknown leaf');
  assert.ok(throws(() => updateLeafStatus('run-7', 'a', 'bogus'), /status/i), 'invalid status');
});

test('write-scope guard: a traversal runId is rejected before touching the fs', () => {
  assert.ok(throws(() => writeCheckpoint('../escape', [{ id: 'a', content: 'a' }]), /escape|scope|run-state|segment|separator/i),
    'hostile runId rejected');
  // and nothing got written outside the tmp root
  assert.ok(!fs.existsSync(path.join(TMP, '..', 'escape')), 'no escaping write happened');
});

test('SECURITY: an in-base traversal runId is rejected directly (R7 self-defends)', () => {
  // R7 must NOT rely on R6 pre-validating — a direct caller with an LLM-sourced
  // runId like `safe/../safe` (path.join-collapses inside the base) is rejected on
  // the RAW token, else it clobbers a sibling run's checkpoint.
  writeCheckpoint('rt-safe', [{ id: 'a', content: 'a' }]);
  assert.ok(throws(() => writeCheckpoint('rt-safe/../rt-safe', [{ id: 'Z', content: 'z' }]), /segment|separator|run|scope/i));
  assert.deepStrictEqual(readCheckpoint('rt-safe').leaves.map((l) => l.id), ['a'], 'sibling run intact');
  // `x/..` collapsing to the root is rejected too
  assert.ok(throws(() => updateLeafStatus('x/..', 'a', 'completed'), /segment|separator|run|scope/i));
});

fs.rmSync(TMP, { recursive: true, force: true });
process.stdout.write(`\ntodo-checkpoint.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
