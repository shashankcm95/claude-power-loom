#!/usr/bin/env node
// tests/unit/runtime/orchestration/borderline-resolver.test.js
// Router-V2 W2 — the borderline-seam runtime resolver. House idiom: imperative
// assert + hand-rolled runner + exit code.
'use strict';

const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveBorderline, FAIL_OPEN } = require('../../../../packages/runtime/orchestration/borderline-resolver.js');

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

// --- the NUDGE: borderline -> route (the core policy) ---
test('borderline -> escalated to route with the demote-if-trivial valve', () => {
  const r = resolveBorderline({ recommendation: 'borderline', score_total: 0.45, signals_matched: ['design', 'review'] });
  assert.strictEqual(r.resolved_recommendation, 'route');
  assert.strictEqual(r.escalated, true);
  assert.strictEqual(r.policy, 'borderline-escalate-to-hets');
  assert.ok(/genuinely trivial/i.test(r.reasoning), 'valve present');
  assert.ok(/design/.test(r.reasoning), 'signals surfaced');
});

test('zero-signal uncertain (rec root, uncertain true) -> escalated to route (policy distinct)', () => {
  const r = resolveBorderline({ recommendation: 'root', uncertain: true, score_total: 0.05 });
  assert.strictEqual(r.resolved_recommendation, 'route');
  assert.strictEqual(r.escalated, true);
  assert.strictEqual(r.policy, 'uncertain-escalate-to-hets');
  assert.ok(/genuinely trivial/i.test(r.reasoning));
});

// --- pass-through: W2 does NOT touch route/root (scope boundary) ---
test('route recommendation -> passthrough, NOT escalated', () => {
  const r = resolveBorderline({ recommendation: 'route', score_total: 0.8 });
  assert.strictEqual(r.resolved_recommendation, 'route');
  assert.strictEqual(r.escalated, false);
  assert.strictEqual(r.policy, 'passthrough');
});

test('root recommendation -> passthrough root (W2 never escalates the 555-row root class; W3 owns it)', () => {
  const r = resolveBorderline({ recommendation: 'root', score_total: 0.1 });
  assert.strictEqual(r.resolved_recommendation, 'root');
  assert.strictEqual(r.escalated, false);
  assert.strictEqual(r.policy, 'passthrough');
});

// --- META scoped OUT of the route-default (OQ-W2-4) ---
test('substrate_meta_detected ALONE (rec root, not uncertain) -> passthrough root, NOT escalated', () => {
  const r = resolveBorderline({ recommendation: 'root', substrate_meta_detected: true, uncertain: false, score_total: 0.2 });
  assert.strictEqual(r.resolved_recommendation, 'root');
  assert.strictEqual(r.escalated, false); // meta is a catch-22 artifact, not an under-routing signal
});

test('meta + borderline -> escalated (fires on the borderline band; meta is incidental)', () => {
  const r = resolveBorderline({ recommendation: 'borderline', substrate_meta_detected: true, score_total: 0.5 });
  assert.strictEqual(r.resolved_recommendation, 'route');
  assert.strictEqual(r.escalated, true);
  assert.strictEqual(r.policy, 'borderline-escalate-to-hets');
});

// --- FAIL-OPEN (W2-M2): never throw, never become an availability risk ---
test('fail-open on null / undefined / array / non-object -> route, not escalated', () => {
  for (const bad of [null, undefined, [], 'str', 42]) {
    const r = resolveBorderline(bad);
    assert.strictEqual(r.resolved_recommendation, 'route', `bad input ${JSON.stringify(bad)}`);
    assert.strictEqual(r.escalated, false);
    assert.strictEqual(r.policy, 'fail-open');
  }
});

test('fail-open on a missing/unknown recommendation -> route', () => {
  assert.strictEqual(resolveBorderline({}).policy, 'fail-open');
  assert.strictEqual(resolveBorderline({ recommendation: 'weird' }).policy, 'fail-open');
  assert.strictEqual(resolveBorderline({ recommendation: 'weird' }).resolved_recommendation, 'route');
});

test('borderline with missing score_total / signals does not crash', () => {
  const r = resolveBorderline({ recommendation: 'borderline' });
  assert.strictEqual(r.resolved_recommendation, 'route');
  assert.ok(/score null/.test(r.reasoning) || r.reasoning.length > 0);
});

test('FAIL_OPEN export is frozen + route', () => {
  assert.strictEqual(FAIL_OPEN.resolved_recommendation, 'route');
  assert.ok(Object.isFrozen(FAIL_OPEN));
});

// --- CLI: stdin pipe + --json flag + fail-open, always exit 0 ---
const MOD = path.resolve(__dirname, '../../../../packages/runtime/orchestration/borderline-resolver.js');
test('CLI --json: borderline -> route JSON on stdout, exit 0', () => {
  const out = execFileSync('node', [MOD, '--json', JSON.stringify({ recommendation: 'borderline', score_total: 0.5 })], { encoding: 'utf8' });
  const r = JSON.parse(out);
  assert.strictEqual(r.resolved_recommendation, 'route');
  assert.strictEqual(r.escalated, true);
});

test('CLI stdin pipe: malformed JSON -> fail-open route, exit 0', () => {
  const out = execFileSync('node', [MOD], { input: 'not json{{{', encoding: 'utf8' });
  const r = JSON.parse(out);
  assert.strictEqual(r.resolved_recommendation, 'route');
  assert.strictEqual(r.policy, 'fail-open');
});

test('CLI stdin pipe: valid route-decide JSON -> passthrough', () => {
  const out = execFileSync('node', [MOD], { input: JSON.stringify({ recommendation: 'root', score_total: 0.1 }), encoding: 'utf8' });
  assert.strictEqual(JSON.parse(out).resolved_recommendation, 'root');
});

process.stdout.write(`\nborderline-resolver.test: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
