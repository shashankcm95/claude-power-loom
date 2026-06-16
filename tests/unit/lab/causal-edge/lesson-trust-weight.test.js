#!/usr/bin/env node

// tests/unit/lab/causal-edge/lesson-trust-weight.test.js
//
// v-next MV-W2 — lessonTrustWeight(verdict) -> the ranking-weight MAGNITUDE. PURE and source-FREE: HARDEN
// earns a positive tie-break weight; EVERY other verdict (incl. unknown / garbage / absent) earns EXACTLY
// 0, never negative (a negative weight is finite, survives the retriever's nullProtoWeights, and would
// SUPPRESS a sibling node — a distinct failure mode from "a non-HARDEN minted a positive weight"). The
// function takes NO source argument: provenance admission is the weight-source-gate's job (SRP), and a
// source must never be a free arg here (a caller could hand it the live marker — the #273 third face).
// CI-safe (no I/O).

'use strict';

const assert = require('assert');
const path = require('path');
const REPO = path.join(__dirname, '..', '..', '..', '..');
const { lessonTrustWeight, VERDICT } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'lesson-merge-lift.js'));

let passed = 0; let failed = 0;
const _tests = [];
function test(name, fn) { _tests.push({ name, fn }); }

test('HARDEN -> a positive weight', () => {
  assert.ok(lessonTrustWeight(VERDICT.HARDEN) > 0, 'HARDEN must earn a positive tie-break weight');
});

test('every non-HARDEN verdict -> exactly 0', () => {
  for (const v of [VERDICT.WITHHOLD, VERDICT.INSUFFICIENT, VERDICT.EXCLUDED]) {
    assert.strictEqual(lessonTrustWeight(v), 0, `${v} -> 0`);
  }
});

test('unknown / garbage / absent verdict -> 0 (fail-closed total function)', () => {
  for (const v of ['HARDENISH', 'harden', '', null, undefined, 0, {}, ['HARDEN']]) {
    assert.strictEqual(lessonTrustWeight(v), 0, `garbage ${JSON.stringify(v)} -> 0`);
  }
});

test('the weight is ALWAYS >= 0 (never a suppressing negative)', () => {
  for (const v of [VERDICT.HARDEN, VERDICT.WITHHOLD, VERDICT.INSUFFICIENT, VERDICT.EXCLUDED, 'x', null, undefined]) {
    assert.ok(lessonTrustWeight(v) >= 0, `weight for ${JSON.stringify(v)} must be >= 0`);
  }
});

test('takes NO source argument — a second arg cannot change the result (#273: source is not a free arg here)', () => {
  assert.strictEqual(
    lessonTrustWeight(VERDICT.HARDEN, 'verdict-attestation'),
    lessonTrustWeight(VERDICT.HARDEN),
    'a passed source must not alter the HARDEN magnitude',
  );
  assert.strictEqual(lessonTrustWeight(VERDICT.WITHHOLD, 'verdict-attestation'), 0, 'and cannot promote a non-HARDEN');
});

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && e.message}`); }
  }
  console.log(`\nlesson-trust-weight: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
