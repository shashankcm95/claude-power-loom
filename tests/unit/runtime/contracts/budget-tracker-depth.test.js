#!/usr/bin/env node

// tests/unit/runtime/budget-tracker-depth.test.js
//
// R10 (v3.2 Wave 0) — the budget envelope's recursion-depth dimension, added to
// budget-tracker.js as an IMPORT-FRIENDLY API (no process.exit) so the Pattern-A
// trampoline (R6, Wave 1) can bound recursion in-loop. Importing the module must
// be safe (require.main guard) and expose { enterDepth, exitDepth, getRecursion }.
//
// Run-state is isolated to a tmp HETS_RUN_STATE_DIR set BEFORE the import.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TMP = path.join(os.tmpdir(), 'budget-depth-' + crypto.randomBytes(6).toString('hex'));
process.env.HETS_RUN_STATE_DIR = TMP;
fs.mkdirSync(TMP, { recursive: true });

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
// If the module lacks a require.main guard, this import runs the CLI switch and
// process.exit()s the test — which is itself the RED signal before the fix.
const { enterDepth, exitDepth, getRecursion } = require(
  path.join(REPO_ROOT, 'packages', 'runtime', 'orchestration', 'budget-tracker.js'),
);

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

test('module exports the import-friendly depth API', () => {
  assert.strictEqual(typeof enterDepth, 'function');
  assert.strictEqual(typeof exitDepth, 'function');
  assert.strictEqual(typeof getRecursion, 'function');
});

test('enterDepth increments + not exhausted within max', () => {
  const r1 = enterDepth('run-A', 3);
  assert.strictEqual(r1.currentDepth, 1);
  assert.strictEqual(r1.maxDepth, 3);
  assert.strictEqual(r1.depthExhausted, false);
  const r2 = enterDepth('run-A', 3);
  assert.strictEqual(r2.currentDepth, 2);
  assert.strictEqual(r2.depthExhausted, false);
});

test('enterDepth past maxDepth => depthExhausted true (the abort signal)', () => {
  const ok = enterDepth('run-B', 1); // depth 1 == max, ok
  assert.strictEqual(ok.depthExhausted, false);
  const over = enterDepth('run-B', 1); // depth 2 > max 1
  assert.strictEqual(over.currentDepth, 2);
  assert.strictEqual(over.depthExhausted, true);
});

test('exitDepth decrements; floors at 0 (a stray exit never underflows)', () => {
  enterDepth('run-C', 5); enterDepth('run-C', 5); // depth 2
  assert.strictEqual(exitDepth('run-C').currentDepth, 1);
  assert.strictEqual(exitDepth('run-C').currentDepth, 0);
  assert.strictEqual(exitDepth('run-C').currentDepth, 0); // floor
});

test('peakDepth records the deepest level reached', () => {
  enterDepth('run-D', 9); enterDepth('run-D', 9); enterDepth('run-D', 9); // peak 3
  exitDepth('run-D'); exitDepth('run-D'); // back to current 1
  const rec = getRecursion('run-D');
  assert.strictEqual(rec.peakDepth, 3);
  assert.strictEqual(rec.currentDepth, 1);
});

test('getRecursion on an unknown run => zeroed (no throw)', () => {
  const r = getRecursion('run-NONE');
  assert.deepStrictEqual(r, { currentDepth: 0, peakDepth: 0, maxDepth: null });
});

test('depth state coexists with token budgets (record then depth on same run)', () => {
  // recursion lives alongside spawns[] in budgets.json; neither clobbers the other
  enterDepth('run-E', 4);
  const rec = getRecursion('run-E');
  assert.strictEqual(rec.currentDepth, 1);
  // budgets.json should still be a valid object with both keys reachable
  const raw = JSON.parse(fs.readFileSync(path.join(TMP, 'run-E', 'budgets.json'), 'utf8'));
  assert.ok(raw.recursion && typeof raw.spawns === 'object');
});

fs.rmSync(TMP, { recursive: true, force: true });
process.stdout.write(`\nbudget-tracker-depth.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
