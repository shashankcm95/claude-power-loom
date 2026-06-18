#!/usr/bin/env node
'use strict';

// tests/unit/lab/persona-experiment/real-solve.test.js -- 3.1-W4b
//
// real-solve -- the REAL claude -p solve+grade driver (the injectable async solveFn the arm-loop
// seam awaits). This is the M1 FAIL-CLOSED PROOF (mocks only, NO real subprocess):
//   - the HARNESS-grade mapping (PASS/FAIL/UNAVAILABLE) via the pure mapBehavioral + a deterministic
//     injected grader (behavioralFnFactory) over a MockBackend;
//   - EVERY directly-reachable fail-closed path (claudeBin=null, no attested backend, actor !ok,
//     refused/FALLBACK, grade-missing/unrecognized) yields a NOT-PASS verdict. The oversize-diff cap
//     (MAX_PATCH_BYTES) sits BEHIND the live actor diff, so here it is covered TRANSITIVELY (any
//     reached run fails closed) + directly by the _spike on the real path -- not a direct unit
//     assertion (honesty LOW-1);
//   - cap.ok is the KEY for the actor gate (not "did we get a diff");
//   - NO real subprocess is spawned: child_process.execFileSync/spawn(Sync) are sabotaged at the top
//     so any accidental real spawn THROWS a tagged sentinel the assertions detect. The claudeBin=null
//     short-circuit returns BEFORE the lazy-require of child_process, so the driver never imports it.
//
// We exercise the post-actor grade/cap/size logic WITHOUT a real claude -p by driving the pure
// mapBehavioral (the three-way grade) + the driver's two front gates directly -- the real clone/
// actor/diff path is the _spike's job (Rule-2a-corollary), nondeterministic + slow, OUT of CI.

const assert = require('assert');
const path = require('path');
const child_process = require('child_process');

// SPAWN TRIPWIRE: replace the real spawners with throwers. If the driver ever reaches a real
// subprocess under these unit tests, it THROWS '__REAL_SPAWN__' -- which a fail-closed driver turns
// into an UNAVAILABLE (still NOT-PASS, the safety property), and which the dedicated test below
// asserts is NEVER triggered on the short-circuit path.
let spawnAttempts = 0;
function tripwire() { spawnAttempts += 1; const e = new Error('__REAL_SPAWN__'); e.__real_spawn__ = true; throw e; }
child_process.execFileSync = tripwire;
child_process.execFile = tripwire;
child_process.spawn = tripwire;
child_process.spawnSync = tripwire;

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const { makeRealSolve, mapBehavioral, VERDICT } = require(path.join(REPO_ROOT, 'packages', 'lab', 'persona-experiment', 'real-solve.js'));

let passed = 0;
let failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
async function runAll() {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
  }
}

// A minimal SEALED corpus record (the shape buildActorPrompt + makeBehavioralFn read).
const RECORD = Object.freeze({
  id: 'mock__issue',
  repo: 'https://github.com/example/mock',
  base_sha: '0'.repeat(40),
  problem_statement: 'A mock issue used only for the fail-closed unit proof.',
  test_patch: '--- a/test\n+++ b/test\n',
  fail_to_pass: ['tests/test_x.py::test_a'],
  pass_to_pass: [],
});

// A deterministic MockBackend: attested by default; its grading is supplied by an injected
// behavioralFnFactory, so the backend's own methods are never reached in these unit paths.
function mockBackend({ attested = true } = {}) {
  return { name: 'mock', containmentAttested: attested };
}

// A grader factory that always returns a fixed harness result (no real backend lifecycle).
function fixedGrader(graded) { return () => async () => graded; }

// =================================== TESTS ==================================================

// --- the pure three-way grade mapping (architect HIGH-1) ------------------------------------

test('mapBehavioral: a resolved PASS run -> BEHAVIORAL_PASS (the only path to PASS)', () => {
  const r = mapBehavioral({ issue_tests: 'PASS', test_tree_mutated: false, outcome_source: 'model' });
  assert.strictEqual(r.verdict, VERDICT.PASS, 'a resolved run is BEHAVIORAL_PASS');
});

test('mapBehavioral: a contained-but-failing run -> BEHAVIORAL_FAIL (never UNAVAILABLE-as-FAIL)', () => {
  const r = mapBehavioral({ issue_tests: 'FAIL', test_tree_mutated: false, outcome_source: 'model' });
  assert.strictEqual(r.verdict, VERDICT.FAIL, 'a contained-but-not-resolved run is BEHAVIORAL_FAIL');
});

test('mapBehavioral: a FALLBACK / not-contained run -> BEHAVIORAL_UNAVAILABLE (never FAIL, never PASS)', () => {
  for (const g of [
    { issue_tests: 'FALLBACK', outcome_source: 'harness_fallback' },
    { issue_tests: 'SKIPPED' },
    { issue_tests: 'unexpected-token' },
    {},
    null,
    'not-an-object',
  ]) {
    const r = mapBehavioral(g);
    assert.strictEqual(r.verdict, VERDICT.UNAVAILABLE, `grade ${JSON.stringify(g)} -> UNAVAILABLE`);
  }
});

test('mapBehavioral: the test_tree_mutated tamper signal (hacker C1) is surfaced report-only on PASS/FAIL', () => {
  assert.strictEqual(mapBehavioral({ issue_tests: 'PASS', test_tree_mutated: true }).test_tree_mutated, true, 'PASS carries the tamper signal');
  assert.strictEqual(mapBehavioral({ issue_tests: 'FAIL', test_tree_mutated: true }).test_tree_mutated, true, 'FAIL carries the tamper signal');
});

// --- the driver fail-closed gates (NO real subprocess) --------------------------------------

test('FAIL-CLOSED: claudeBin=null short-circuits to UNAVAILABLE with NO child_process import (M1 + no-spawn proof)', async () => {
  const before = spawnAttempts;
  const solveFn = makeRealSolve({ record: RECORD, backend: mockBackend(), claudeBin: null, behavioralFnFactory: fixedGrader({ issue_tests: 'PASS' }) });
  const r = await solveFn({ arm: 'A', prompt: 'persona-framing-delta', task: 'Resolve the issue described above.' });
  assert.strictEqual(r.verdict, VERDICT.UNAVAILABLE, 'no actor binary -> UNAVAILABLE (never PASS)');
  assert.strictEqual(spawnAttempts, before, 'NO subprocess was spawned on the claudeBin=null path');
});

test('FAIL-CLOSED: an un-attested backend -> UNAVAILABLE (no grading is possible, never a silent PASS)', async () => {
  const before = spawnAttempts;
  const solveFn = makeRealSolve({ record: RECORD, backend: mockBackend({ attested: false }), claudeBin: '/path/to/claude', behavioralFnFactory: fixedGrader({ issue_tests: 'PASS' }) });
  const r = await solveFn({ arm: 'B', prompt: 'p', task: 't' });
  assert.strictEqual(r.verdict, VERDICT.UNAVAILABLE, 'no attested backend -> UNAVAILABLE');
  assert.strictEqual(spawnAttempts, before, 'the backend gate short-circuits BEFORE any spawn');
});

test('FAIL-CLOSED: a missing backend (undefined) -> UNAVAILABLE', async () => {
  const solveFn = makeRealSolve({ record: RECORD, backend: undefined, claudeBin: '/path/to/claude' });
  const r = await solveFn({ arm: 'C', prompt: 'p', task: 't' });
  assert.strictEqual(r.verdict, VERDICT.UNAVAILABLE, 'undefined backend -> UNAVAILABLE');
});

test('FAIL-CLOSED: a non-PASS grade can NEVER become PASS (the driver only PASSes a resolved harness run)', async () => {
  // drive the driver to the GRADE step deterministically: a truthy claudeBin + attested backend means
  // the actor/clone lazy-require fires. The spawn tripwire turns that real spawn into a thrown
  // sentinel, which the driver's catch turns into UNAVAILABLE -- still NOT-PASS. This proves the
  // safety property (no false PASS) even when the real actor path is reached, WITHOUT a live claude.
  for (const grade of [{ issue_tests: 'FAIL' }, { issue_tests: 'FALLBACK' }, {}]) {
    const solveFn = makeRealSolve({ record: RECORD, backend: mockBackend(), claudeBin: '/nonexistent/claude', behavioralFnFactory: fixedGrader(grade) });
    const r = await solveFn({ arm: 'A', prompt: 'p', task: 't' });
    assert.notStrictEqual(r.verdict, VERDICT.PASS, `grade ${JSON.stringify(grade)} never yields PASS (got ${r.verdict})`);
    assert.strictEqual(r.verdict, VERDICT.UNAVAILABLE, 'a reached-but-spawn-blocked run fails closed to UNAVAILABLE');
  }
});

test('cap.ok is the KEY for the actor gate: a spawn-blocked actor run -> UNAVAILABLE, never a graded PASS', async () => {
  // even if the injected grader WOULD return PASS, the actor-failed gate (cap.ok !== true, here via
  // the tripwire-thrown spawn -> driver catch) returns UNAVAILABLE before any grade is trusted.
  const before = spawnAttempts;
  const solveFn = makeRealSolve({ record: RECORD, backend: mockBackend(), claudeBin: '/nonexistent/claude', behavioralFnFactory: fixedGrader({ issue_tests: 'PASS' }) });
  const r = await solveFn({ arm: 'A', prompt: 'p', task: 't' });
  assert.strictEqual(r.verdict, VERDICT.UNAVAILABLE, 'a failed actor run never reaches a PASS grade');
  assert.ok(spawnAttempts > before, 'the actor path WAS reached (the tripwire fired) -- proving the gate, not the short-circuit');
});

test('the factory validates its record at construction (boundary-validation, fail loud)', () => {
  assert.throws(() => makeRealSolve({ record: null, backend: mockBackend(), claudeBin: null }), /record is required/);
  assert.throws(() => makeRealSolve({ record: { repo: 'x' }, backend: mockBackend(), claudeBin: null }), /repo and record.base_sha/);
});

test('the solveFn returns a FRESH result object (immutability; no shared verdict reference)', async () => {
  const solveFn = makeRealSolve({ record: RECORD, backend: mockBackend(), claudeBin: null });
  const a = await solveFn({ arm: 'A', prompt: 'p', task: 't' });
  const b = await solveFn({ arm: 'A', prompt: 'p', task: 't' });
  assert.notStrictEqual(a, b, 'each call returns a new object');
  assert.deepStrictEqual(a, b, 'but the same fail-closed shape');
});

runAll().then(() => {
  process.stdout.write('\n=== real-solve.test.js Summary ===\n');
  process.stdout.write(`  Passed: ${passed}\n  Failed: ${failed}\n`);
  if (failed > 0) process.exit(1);
}).catch((err) => { process.stderr.write(`real-solve.test harness threw: ${err && err.stack}\n`); process.exit(1); });
