#!/usr/bin/env node

// tests/unit/lab/causal-edge/lesson-derive.test.js
//
// v3.11 W1 — the lesson derivation leg (mocked-leg RED set). PURE; CI-safe. Pins:
// a valid mocked leg yields a model lesson with a derived signature; an off-floor enum,
// an empty/null return, and a thrown leg all fail-closed to harness_fallback; a
// lesson_body that leaks the sealed accepted_diff fails-closed (the whole output, not
// just the body); async + sync legs both work.

'use strict';

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const { deriveLesson } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'lesson-derive.js'));

let passed = 0; let failed = 0;
const _tests = [];
function test(name, fn) { _tests.push({ name, fn }); }

const VALID = { trigger_class: 'boundary-contract', gotcha_class: 'unguarded-edge-case', corrective_class: 'fail-closed', lesson_body: 'Raise on the empty edge rather than yield a degenerate value.' };
const INPUT = { problem_statement_digest: 'abc', candidate_patch: '+  raise ValueError', accepted_diff: 'def f(x):\n    if x == 0: raise ValueError' };

test('a valid mocked leg -> a model lesson with a derived signature', async () => {
  const r = await deriveLesson(INPUT, () => ({ ...VALID }));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.outcome_source, 'model');
  assert.strictEqual(r.lesson.lesson_signature, 'lesson:boundary-contract|unguarded-edge-case|fail-closed');
  assert.strictEqual(r.lesson.lesson_body, VALID.lesson_body);
});

test('an off-floor enum fails-closed to harness_fallback (no INVALID-keyed lesson)', async () => {
  const r = await deriveLesson(INPUT, () => ({ ...VALID, gotcha_class: 'mock-not-real' }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.outcome_source, 'harness_fallback');
  assert.strictEqual(r.fallback_reason, 'off-floor-enum');
  assert.strictEqual(r.lesson, null);
});

test('an empty / null / non-object leg return fails-closed', async () => {
  assert.strictEqual((await deriveLesson(INPUT, () => null)).fallback_reason, 'derive-empty');
  assert.strictEqual((await deriveLesson(INPUT, () => 'nope')).fallback_reason, 'derive-empty');
  assert.strictEqual((await deriveLesson(INPUT, null)).fallback_reason, 'derive-empty');
});

test('a thrown leg fails-closed (report-only isolation)', async () => {
  const r = await deriveLesson(INPUT, () => { throw new Error('claude unavailable'); });
  assert.strictEqual(r.fallback_reason, 'derive-threw');
});

test('a lesson_body that leaks the sealed accepted_diff fails-closed the WHOLE output', async () => {
  const accepted = 'def fix(seq):\n    return reticulate_the_splines(seq)';
  const leakyBody = 'The fix is to reticulate_the_splines exactly as the reference does.'; // shares a >12 run
  const r = await deriveLesson({ ...INPUT, accepted_diff: accepted }, () => ({ ...VALID, lesson_body: leakyBody }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.fallback_reason, 'lesson-leak', 'a leaked body discredits the whole leg, not just the body');
});

test('an async leg is awaited', async () => {
  const r = await deriveLesson(INPUT, async () => ({ ...VALID }));
  assert.strictEqual(r.ok, true);
});

// VALIDATE-hacker M1: an oversize lesson_body is abnormal (a malfunctioning/adversarial leg) and
// is rejected BEFORE the O(body x accepted) leak scan, bounding the DoS surface.
test('M1: an oversize lesson_body fails-closed before the leak scan', async () => {
  const huge = 'x'.repeat(5000); // > LESSON_BODY_MAX (4096)
  const r = await deriveLesson(INPUT, () => ({ ...VALID, lesson_body: huge }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.fallback_reason, 'lesson-body-oversize');
});

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && e.message}`); }
  }
  console.log(`\nlesson-derive: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
