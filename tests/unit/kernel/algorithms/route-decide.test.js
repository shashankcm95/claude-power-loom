#!/usr/bin/env node

// tests/unit/kernel/algorithms/route-decide.test.js
//
// A4 unit test for the canonical kernel algorithm `route-decide.scoreTask`
// (v3.2 Wave 0 / K11). Before this file, the substrate's flagship deterministic
// kernel algorithm had ZERO unit coverage (only tests/smoke-ht.sh exercised the
// gate-helper/CLI) — a real A4 gap (deterministic kernel code must be unit-tested).
//
// WEIGHT-VERSION-RESILIENT by design (plan M-2): route-decide.js:11-13 declares
// weights/thresholds LOAD-BEARING and re-derivable only by an architect pass. So
// this test asserts BEHAVIORAL BANDS + structural invariants — NOT exact score
// floats. A drastic weight rebalance that breaks a band case is the SIGNAL (via
// the weights_version field) that the goldens need review, not a silent tax.
//
// Imports the CANONICAL module (packages/kernel/algorithms/route-decide.js — the
// one A4 governs + the manifest registers), NOT the _lib re-export (plan I-2).
//
// House idiom: imperative assert + hand-rolled runner + exit code.

'use strict';

const assert = require('assert');
const {
  scoreTask,
  ROUTE_THRESHOLD,
  ROOT_THRESHOLD,
} = require('../../../../packages/kernel/algorithms/route-decide');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

const RECS = new Set(['route', 'borderline', 'root']);

// A maximally-loaded task: stakes + audit + compound-strong + convergence +
// domain-novelty. Comfortably above ROUTE_THRESHOLD across plausible weight
// rebalances (5 strong dimensions). If a future architect pass drops this below
// route, the weights_version bump is the signal to revisit.
const CLEAR_ROUTE =
  'Design and architect a secure production authentication system requiring a database schema '
  + 'migration that affects payment processing; evaluate multiple competing architectural approaches '
  + 'with significant security and compliance stakes.';

// A task with no routing keywords on any dimension → zero signal → root
// (structural: 0 contributions → score 0 ≤ ROOT_THRESHOLD). Long enough to avoid
// the short-prompt branch.
const ZERO_SIGNAL =
  'Please take a quiet stroll around the garden and enjoy the pleasant afternoon weather today '
  + 'together with a few cheerful friends and a warm cup of tea.';

// ---------- contract / invariants (weight-independent) ----------

test('exported thresholds hold the documented contract (route 0.60 > root 0.30)', () => {
  assert.strictEqual(ROUTE_THRESHOLD, 0.60, 'ROUTE_THRESHOLD is the documented 0.60');
  assert.strictEqual(ROOT_THRESHOLD, 0.30, 'ROOT_THRESHOLD is the documented 0.30');
  assert.ok(ROUTE_THRESHOLD > ROOT_THRESHOLD, 'route threshold sits above root threshold');
});

test('output-shape contract: recommendation enum + numeric fields + metadata', () => {
  const out = scoreTask(CLEAR_ROUTE);
  assert.ok(RECS.has(out.recommendation), `recommendation ∈ {route,borderline,root}; got ${out.recommendation}`);
  assert.strictEqual(typeof out.score_total, 'number', 'score_total is numeric');
  assert.strictEqual(typeof out.confidence, 'number', 'confidence is numeric');
  assert.ok(out.confidence >= 0 && out.confidence <= 1, 'confidence ∈ [0,1]');
  assert.ok(out.thresholds && out.thresholds.route === ROUTE_THRESHOLD, 'thresholds echoed');
  assert.strictEqual(typeof out.weights_version, 'string', 'weights_version present (golden-review signal)');
});

test('determinism: same input → deeply-equal output', () => {
  assert.deepStrictEqual(scoreTask(CLEAR_ROUTE), scoreTask(CLEAR_ROUTE), 'pure function');
  assert.deepStrictEqual(scoreTask(ZERO_SIGNAL), scoreTask(ZERO_SIGNAL), 'pure function (zero-signal)');
});

// ---------- behavioral bands ----------

test('clear-route band: a multi-stakes architectural task → route', () => {
  const out = scoreTask(CLEAR_ROUTE);
  assert.strictEqual(out.recommendation, 'route',
    `expected route; got ${out.recommendation} (score ${out.score_total}, weights ${out.weights_version})`);
});

test('zero-signal band: a keyword-free task → root', () => {
  const out = scoreTask(ZERO_SIGNAL);
  assert.strictEqual(out.recommendation, 'root',
    `expected root; got ${out.recommendation} (score ${out.score_total})`);
  assert.strictEqual(out.score_total, 0, 'no keywords matched → zero score');
});

// ---------- force-flag overrides (weight-independent ground truth) ----------

test('--force-route overrides scoring: route + forced + confidence 1.0', () => {
  const out = scoreTask(ZERO_SIGNAL, { 'force-route': true });
  assert.strictEqual(out.recommendation, 'route', 'forced to route despite zero signal');
  assert.strictEqual(out.forced, true, 'forced flag set');
  assert.strictEqual(out.confidence, 1.0, 'forced confidence is ground-truth 1.0');
  assert.strictEqual(out.forced_by, 'force-route', 'forced_by names the flag');
});

test('--force-root overrides scoring: root + forced', () => {
  const out = scoreTask(CLEAR_ROUTE, { 'force-root': true });
  assert.strictEqual(out.recommendation, 'root', 'forced to root despite strong signal');
  assert.strictEqual(out.forced, true, 'forced flag set');
  assert.strictEqual(out.forced_by, 'force-root', 'forced_by names the flag');
});

// ---------- edge ----------

test('empty / whitespace task does not throw and yields a valid root verdict', () => {
  for (const t of ['', '   ', undefined]) {
    const out = scoreTask(t);
    assert.ok(RECS.has(out.recommendation), `valid recommendation for ${JSON.stringify(t)}`);
    assert.strictEqual(out.recommendation, 'root', 'no-signal empty task → root');
  }
});

// --- summary ---

process.stdout.write(`\nroute-decide.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
