#!/usr/bin/env node
// tests/unit/bench/router-v2/w2-borderline-backtest.test.js — the W2 descriptive
// backtest. House idiom: imperative assert + hand-rolled runner + exit code.
'use strict';

const assert = require('assert');
const { backtestBorderline, buildReport } = require('../../../../packages/specs/bench/router-v2/w2-borderline-backtest.js');
const { auditReportWording } = require('../../../../packages/specs/bench/router-v2/shadow-eval.js');

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

const fixture = [
  { id: 'b1', band: 'borderline', correct_route: 'route', scorer_score: 0.45 },
  { id: 'b2', band: 'borderline', correct_route: 'route', scorer_score: 0.5 },
  { id: 'b3', band: 'borderline', correct_route: 'root', scorer_score: 0.35 },   // over-escalate
  { id: 'r1', band: 'root', correct_route: 'route', scorer_score: 0.1 },         // NOT in W2's slice
  { id: 'r2', band: 'root', correct_route: 'root', scorer_score: 0.0 },          // NOT in W2's slice
];

test('backtest fires ONLY on the scorer-borderline band (ignores root-band rows)', () => {
  const r = backtestBorderline(fixture);
  assert.strictEqual(r.n, 3); // only b1,b2,b3 — the root-band rows are excluded
});

test('label split + route-match + over-escalate are correct', () => {
  const r = backtestBorderline(fixture);
  assert.deepStrictEqual(r.labelSplit, { route: 2, borderline: 0, root: 1 });
  assert.strictEqual(r.routeMatch, 2);     // b1,b2 labeled route -> matched
  assert.strictEqual(r.overEscalate, 1);   // b3 labeled root -> over-escalated
});

test('every backtest row records correct_route, resolved, matched', () => {
  const r = backtestBorderline(fixture);
  const b3 = r.rows.find((x) => x.id === 'b3');
  assert.strictEqual(b3.resolved, 'route');     // W2 escalates it
  assert.strictEqual(b3.correct_route, 'root');
  assert.strictEqual(b3.matched, false);
});

test('an injected resolver is honored (testability seam)', () => {
  const alwaysRoot = () => ({ resolved_recommendation: 'root' });
  const r = backtestBorderline(fixture, alwaysRoot);
  assert.strictEqual(r.routeMatch, 1); // only b3 (labeled root) now matches
});

test('empty / non-array input', () => {
  assert.strictEqual(backtestBorderline([]).n, 0);
  assert.throws(() => backtestBorderline(null), /must be an array/);
});

test('the report passes the narrows-only wording gate (no trust+pass-rate co-location)', () => {
  const r = backtestBorderline(fixture);
  assert.deepStrictEqual(auditReportWording(buildReport(r)), []);
});

process.stdout.write(`\nw2-borderline-backtest.test: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
