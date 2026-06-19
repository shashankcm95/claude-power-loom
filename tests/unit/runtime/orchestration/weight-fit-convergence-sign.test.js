#!/usr/bin/env node

// tests/unit/runtime/orchestration/weight-fit-convergence-sign.test.js
//
// Regression test for the convergence-abs-signflip bug: analyzeConvergence()
// applied Math.abs() to the empirically-fit weight, silently flipping a NEGATIVE
// empirical weight to positive and corrupting the convergence signal. A negative
// slope (convergence-agree correlating with FAILURE) is a real signal; the sign
// MUST survive. This test would FAIL against the old Math.abs() code.

'use strict';

const assert = require('assert');

const { analyzeConvergence } = require('../../../../packages/runtime/orchestration/weight-fit');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// Build a paired dataset where convergence='agree' (x=1) correlates with FAILURE
// (verdictBinary=0) and convergence='disagree' (x=0) correlates with PASS
// (verdictBinary=1). That yields a NEGATIVE regression slope, so the fit weight
// must be negative. n must be >= 5 to be fittable.
function negativeSlopePairs() {
  return [
    { qf: { convergence: 'agree' }, verdictBinary: 0 },
    { qf: { convergence: 'agree' }, verdictBinary: 0 },
    { qf: { convergence: 'agree' }, verdictBinary: 0 },
    { qf: { convergence: 'disagree' }, verdictBinary: 1 },
    { qf: { convergence: 'disagree' }, verdictBinary: 1 },
    { qf: { convergence: 'disagree' }, verdictBinary: 1 },
  ];
}

test('analyzeConvergence is fittable on a sufficient negative-slope dataset', () => {
  const result = analyzeConvergence(negativeSlopePairs(), 0.15);
  assert.strictEqual(result.fittable, true, 'expected dataset to be fittable (n>=5)');
  assert.ok(result.linear_slope < 0, `expected a negative empirical slope, got ${result.linear_slope}`);
});

test('analyzeConvergence preserves the NEGATIVE empirical sign (no Math.abs flip)', () => {
  const result = analyzeConvergence(negativeSlopePairs(), 0.15);
  // Old buggy code applied Math.abs() -> proposed weight would be POSITIVE.
  // Fixed code preserves the sign -> proposed weight must stay NEGATIVE.
  assert.ok(
    result.proposed_empirical_weight < 0,
    `sign flip: proposed_empirical_weight should be negative but was ${result.proposed_empirical_weight}`,
  );
});

test('analyzeConvergence delta reflects the preserved sign', () => {
  const theoryWeight = 0.15;
  const result = analyzeConvergence(negativeSlopePairs(), theoryWeight);
  // delta = proposed - theory; with a negative proposed and positive theory,
  // delta must be strictly negative (the old Math.abs code could not produce this).
  assert.ok(
    result.delta < 0,
    `expected a negative delta from a negative proposed weight, got ${result.delta}`,
  );
});

if (failed > 0) {
  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  process.exit(1);
}
process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
