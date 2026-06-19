#!/usr/bin/env node
// tests/unit/bench/router-v2/kappa.test.js — Fleiss' kappa + majorityLabel.
// House idiom: imperative assert + hand-rolled runner + exit code.
'use strict';

const assert = require('assert');
const { fleissKappa, majorityLabel } = require('../../../../packages/specs/bench/router-v2/kappa.js');

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('perfect per-item agreement (categories vary across items) -> kappa 1', () => {
  const r = fleissKappa([['route', 'route', 'route'], ['root', 'root', 'root'], ['borderline', 'borderline', 'borderline']]);
  near(r.observed, 1);
  near(r.kappa, 1);
  assert.strictEqual(r.nRaters, 3);
  assert.strictEqual(r.nItems, 3);
});

test('total per-item disorder (all 3 raters differ, 3 categories) -> kappa -0.5', () => {
  const r = fleissKappa([['route', 'root', 'borderline'], ['root', 'borderline', 'route']]);
  near(r.observed, 0);
  near(r.expected, 1 / 3);
  near(r.kappa, -0.5);
});

test('a 2/3-majority item computes the exact value', () => {
  // single item counts: route 2, borderline 1. sumSq=5, P_i=(5-3)/(3*2)=1/3.
  // p_route=2/3, p_borderline=1/3 -> P_e=4/9+1/9=5/9. kappa=(1/3-5/9)/(1-5/9).
  const r = fleissKappa([['route', 'route', 'borderline']]);
  near(r.observed, 1 / 3);
  near(r.expected, 5 / 9);
  near(r.kappa, (1 / 3 - 5 / 9) / (1 - 5 / 9));
});

test('P_e == 1 (every rater always one class) -> kappa null with a note', () => {
  const r = fleissKappa([['root', 'root', 'root'], ['root', 'root', 'root']]);
  assert.strictEqual(r.kappa, null);
  assert.ok(/P_e == 1/.test(r.note));
});

test('empty input -> null, no throw', () => {
  const r = fleissKappa([]);
  assert.strictEqual(r.kappa, null);
  assert.strictEqual(r.nItems, 0);
});

test('ragged rater counts throw (Fleiss requires a fixed rater count)', () => {
  assert.throws(() => fleissKappa([['route', 'route', 'route'], ['root', 'root']]), /fixed rater count/);
});

test('fewer than 2 raters throws', () => {
  assert.throws(() => fleissKappa([['route']]), />= 2/);
});

test('majorityLabel: clear majority', () => {
  const m = majorityLabel(['route', 'route', 'root']);
  assert.strictEqual(m.label, 'route');
  near(m.consensus, 2 / 3);
  assert.strictEqual(m.tie, false);
});

test('majorityLabel: 3-way tie flags contested', () => {
  const m = majorityLabel(['route', 'root', 'borderline']);
  near(m.consensus, 1 / 3);
  assert.strictEqual(m.tie, true);
});

process.stdout.write(`\nkappa.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
