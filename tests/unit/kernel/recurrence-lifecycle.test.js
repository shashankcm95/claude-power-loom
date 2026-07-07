#!/usr/bin/env node

// tests/unit/kernel/recurrence-lifecycle.test.js
//
// The pure recurrence-classification leaf (ADR-0020) — the DETECTION half of the graduate/retire
// lifecycle, extracted from self-improve-store.js so the organ (below-threshold -> candidate ->
// graduate-eligible, with an optional cross-window convergence gate) is named ONCE. These tests pin
// the behavior-preserving semantics the store relied on inline (byte-identical on every input the store's own
// writer produces; strictly fail-closed-safer on a malformed external count -> below-threshold):
//   - candidate gate:   count >= candidateThreshold        (store :501 `count < threshold` -> skip)
//   - graduate gate:    lowRisk && count >= autoGraduate    (store :529/:562, verbatim dup)
//   - convergence gate: (lastSeenMs - firstSeenMs) > span   (store :318, STRICT `>`; NaN -> false)
//   - new-path order:   defer(cross-window) BEFORE graduate (store :543 before :562)
// Pure: no I/O, no Date, no mutation. CI-safe.

'use strict';

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..');
const LEAF = require(path.join(REPO, 'packages', 'kernel', '_lib', 'recurrence-lifecycle.js'));
const { STAGE, hasConverged, isGraduateEligible, classifyRecurrence } = LEAF;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Policy factories mirroring what self-improve-store builds from signalPolicy().
const lowRiskPolicy = (over = {}) => ({
  candidateThreshold: 5, autoGraduateThreshold: 10, lowRisk: true,
  requiresCrossWindow: false, crossWindowSpanMs: ONE_DAY_MS, ...over,
});
const driftPolicy = (over = {}) => ({
  candidateThreshold: 3, autoGraduateThreshold: 10, lowRisk: false,
  requiresCrossWindow: true, crossWindowSpanMs: ONE_DAY_MS, ...over,
});
const tally = (count, firstSeenMs = 1000, lastSeenMs = 1000) => ({ count, firstSeenMs, lastSeenMs });

const _tests = [];
let passed = 0; let failed = 0;
function test(name, fn) { _tests.push({ name, fn }); }

// ---- STAGE enum ----
test('STAGE is a frozen enum with the four stages', () => {
  assert.strictEqual(STAGE.BELOW_THRESHOLD, 'below-threshold');
  assert.strictEqual(STAGE.DEFERRED_CROSS_WINDOW, 'deferred-cross-window');
  assert.strictEqual(STAGE.CANDIDATE, 'candidate');
  assert.strictEqual(STAGE.GRADUATE_ELIGIBLE, 'graduate-eligible');
  assert.strictEqual(Object.isFrozen(STAGE), true);
});

// ---- classifyRecurrence: candidate threshold boundary ----
test('below candidateThreshold -> below-threshold', () => {
  assert.strictEqual(classifyRecurrence(tally(4), lowRiskPolicy()), STAGE.BELOW_THRESHOLD);
});
test('count === candidateThreshold -> candidate (>= gate, matches store :501 `<` skip)', () => {
  assert.strictEqual(classifyRecurrence(tally(5), lowRiskPolicy()), STAGE.CANDIDATE);
});
test('missing/zero count -> below-threshold (no throw)', () => {
  assert.strictEqual(classifyRecurrence({}, lowRiskPolicy()), STAGE.BELOW_THRESHOLD);
  assert.strictEqual(classifyRecurrence(null, lowRiskPolicy()), STAGE.BELOW_THRESHOLD);
});

// ---- classifyRecurrence: graduate boundary ----
test('low-risk count === autoGraduate -> graduate-eligible (>= gate, matches store :562)', () => {
  assert.strictEqual(classifyRecurrence(tally(10), lowRiskPolicy()), STAGE.GRADUATE_ELIGIBLE);
});
test('low-risk count 9 (one below autoGraduate) -> candidate', () => {
  assert.strictEqual(classifyRecurrence(tally(9), lowRiskPolicy()), STAGE.CANDIDATE);
});
test('high-risk count >= autoGraduate -> candidate, NEVER graduate (only low-risk graduates)', () => {
  // a converged drift signal at count 20: passes cross-window, high-risk so not graduate-eligible
  assert.strictEqual(
    classifyRecurrence(tally(20, 0, 3 * ONE_DAY_MS), driftPolicy()), STAGE.CANDIDATE);
});

// ---- classifyRecurrence: cross-window gate + ordering ----
test('drift requiresCrossWindow + not converged -> deferred-cross-window', () => {
  // span 0 (single arc) < 1 day
  assert.strictEqual(classifyRecurrence(tally(5, 1000, 1000), driftPolicy()), STAGE.DEFERRED_CROSS_WINDOW);
});
test('drift requiresCrossWindow + converged -> candidate (past the gate)', () => {
  assert.strictEqual(
    classifyRecurrence(tally(5, 0, 2 * ONE_DAY_MS), driftPolicy()), STAGE.CANDIDATE);
});
test('ORDER: defer BEFORE graduate — hypothetical low-risk+cross-window, not converged -> deferred (store :543 before :562)', () => {
  const p = lowRiskPolicy({ requiresCrossWindow: true, candidateThreshold: 3 });
  // count 10 (>= autoGraduate) but NOT converged: defer must win over graduate
  assert.strictEqual(classifyRecurrence(tally(10, 1000, 1000), p), STAGE.DEFERRED_CROSS_WINDOW);
});
test('ORDER: same policy, converged + count>=autoGraduate -> graduate-eligible', () => {
  const p = lowRiskPolicy({ requiresCrossWindow: true, candidateThreshold: 3 });
  assert.strictEqual(classifyRecurrence(tally(10, 0, 2 * ONE_DAY_MS), p), STAGE.GRADUATE_ELIGIBLE);
});

// ---- hasConverged (the span gate) ----
test('hasConverged: span > threshold -> true', () => {
  assert.strictEqual(hasConverged(tally(1, 0, 2 * ONE_DAY_MS), driftPolicy()), true);
});
test('hasConverged: span === threshold -> false (STRICT >, matches store :318)', () => {
  assert.strictEqual(hasConverged(tally(1, 0, ONE_DAY_MS), driftPolicy()), false);
});
test('hasConverged: span < threshold -> false', () => {
  assert.strictEqual(hasConverged(tally(1, 0, 1000), driftPolicy()), false);
});
test('hasConverged: non-finite timestamps -> false (fail-closed, matches store NaN->false)', () => {
  assert.strictEqual(hasConverged({ count: 1, firstSeenMs: NaN, lastSeenMs: 2 * ONE_DAY_MS }, driftPolicy()), false);
  assert.strictEqual(hasConverged({ count: 1 }, driftPolicy()), false);
  assert.strictEqual(hasConverged(null, driftPolicy()), false);
});

// ---- isGraduateEligible ----
test('isGraduateEligible: low-risk + count >= autoGraduate -> true', () => {
  assert.strictEqual(isGraduateEligible(tally(10), lowRiskPolicy()), true);
});
test('isGraduateEligible: low-risk + count < autoGraduate -> false', () => {
  assert.strictEqual(isGraduateEligible(tally(9), lowRiskPolicy()), false);
});
test('isGraduateEligible: high-risk (drift) -> false even at high count', () => {
  assert.strictEqual(isGraduateEligible(tally(50), driftPolicy()), false);
});

// ---- purity: inputs are not mutated ----
test('classifyRecurrence does not mutate its inputs', () => {
  const t = Object.freeze(tally(10, 0, 2 * ONE_DAY_MS));
  const p = Object.freeze(lowRiskPolicy());
  assert.doesNotThrow(() => classifyRecurrence(t, p)); // frozen -> a mutation would throw
  assert.strictEqual(classifyRecurrence(t, p), STAGE.GRADUATE_ELIGIBLE);
});

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && e.message}`); }
  }
  console.log(`\nrecurrence-lifecycle: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
