#!/usr/bin/env node

// tests/unit/lab/causal-edge/lesson-signature.test.js
//
// v3.11 W1 — the FROZEN lesson signature + key machinery (the RED set). PURE; CI-safe.
// Pins (board folds): the append-only floor is frozen (Object.isFrozen); lessonClusterKey
// is deterministic + INVALID on off-enum + carries the `lesson:` prefix; the namespace is
// disjoint from frictionClusterKey AND `:`/`|` are reserved across BOTH key spaces
// (architect MED — protect the colon symmetrically); lessonLeaks is the string-variant
// that rubricLeaks misses; groupByKey is a generic exact-key tally (not clusterFriction).

'use strict';

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const LS = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'lesson-signature.js'));
const {
  TRIGGER_CLASS, GOTCHA_CLASS, CORRECTIVE_CLASS, LESSON_PREFIX,
  lessonClusterKey, parseLessonClusterKey, isCanonicalLessonSignature,
  assertEnumDelimiterSafe, lessonLeaks, groupByKey,
} = LS;
const TF = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'trajectory-friction.js'));
const { frictionClusterKey, FRICTION_CLASS, FRICTION_PHASE, DETECTION_LEG } = TF;

let passed = 0; let failed = 0;
const _tests = [];
function test(name, fn) { _tests.push({ name, fn }); }

const SEED = { trigger_class: 'boundary-contract', gotcha_class: 'unguarded-edge-case', corrective_class: 'fail-closed' };

// --------------------------------------------------------------------------
// The freeze: enums frozen, the expected floor cardinality.
// --------------------------------------------------------------------------

test('the three enums are frozen (the one-way door)', () => {
  assert.ok(Object.isFrozen(TRIGGER_CLASS) && Object.isFrozen(GOTCHA_CLASS) && Object.isFrozen(CORRECTIVE_CLASS));
});

test('the floor cardinality is 4 / 3 / 2 (the minimal reachable set)', () => {
  assert.strictEqual(TRIGGER_CLASS.length, 4);
  assert.strictEqual(GOTCHA_CLASS.length, 3);
  assert.strictEqual(CORRECTIVE_CLASS.length, 2);
});

test('the gotcha gap the board surfaced is filled (unguarded-edge-case present)', () => {
  assert.ok(GOTCHA_CLASS.includes('unguarded-edge-case'));
});

test('the dropped meta-lessons are NOT in the floor (no claude-undriveable values)', () => {
  for (const dead of ['mock-not-real', 'harness-capability-assumed']) assert.ok(!GOTCHA_CLASS.includes(dead));
  for (const dead of ['probe-the-real-path', 'premise-probe-the-mitigation', 'narrow-not-block']) assert.ok(!CORRECTIVE_CLASS.includes(dead));
});

// --------------------------------------------------------------------------
// lessonClusterKey — determinism, prefix, INVALID on off-enum.
// --------------------------------------------------------------------------

test('lessonClusterKey is deterministic + carries the lesson: prefix', () => {
  const k = lessonClusterKey(SEED);
  assert.strictEqual(k, lessonClusterKey({ ...SEED }));
  assert.strictEqual(k, 'lesson:boundary-contract|unguarded-edge-case|fail-closed');
  assert.ok(k.startsWith(LESSON_PREFIX));
});

test('an off-enum / non-string component collapses to INVALID (never attacker bytes)', () => {
  assert.strictEqual(lessonClusterKey({ trigger_class: 'bogus', gotcha_class: 'silent-coercion', corrective_class: 'fail-closed' }), 'lesson:INVALID|silent-coercion|fail-closed');
  // a RAW block trying to inject extra separators via toString => INVALID component
  assert.strictEqual(lessonClusterKey({ trigger_class: { toString: () => 'x|y:z' }, gotcha_class: 'silent-coercion', corrective_class: 'fail-closed' }), 'lesson:INVALID|silent-coercion|fail-closed');
  assert.strictEqual(lessonClusterKey({}), 'lesson:INVALID|INVALID|INVALID');
  assert.strictEqual(lessonClusterKey(null), 'lesson:INVALID|INVALID|INVALID');
});

// --------------------------------------------------------------------------
// Namespace disjointness (the freeze guarantee) — assert the PREFIX and the reserved
// separators on BOTH key spaces, not merely != one friction tuple.
// --------------------------------------------------------------------------

test('every lessonClusterKey starts with lesson: ; no frictionClusterKey ever does', () => {
  // exhaustive over the lesson floor
  for (const t of TRIGGER_CLASS) for (const g of GOTCHA_CLASS) for (const c of CORRECTIVE_CLASS) {
    assert.ok(lessonClusterKey({ trigger_class: t, gotcha_class: g, corrective_class: c }).startsWith(LESSON_PREFIX));
  }
  // exhaustive over the friction key space: none collides into the lesson namespace
  for (const fc of FRICTION_CLASS) for (const fp of FRICTION_PHASE) for (const dl of DETECTION_LEG) {
    assert.ok(!frictionClusterKey({ friction_class: fc, friction_phase: fp, detection_leg: dl }).startsWith(LESSON_PREFIX));
  }
});

test('`:` and `|` are reserved: no value in EITHER key space contains them', () => {
  assert.ok(assertEnumDelimiterSafe([TRIGGER_CLASS, GOTCHA_CLASS, CORRECTIVE_CLASS, FRICTION_CLASS, FRICTION_PHASE, DETECTION_LEG]));
});

test('assertEnumDelimiterSafe throws on a poisoned enum (a value with a reserved separator)', () => {
  assert.throws(() => assertEnumDelimiterSafe([['ok', 'bad:value']]), /reserved separator/);
  assert.throws(() => assertEnumDelimiterSafe([['ok', 'bad|value']]), /reserved separator/);
});

// --------------------------------------------------------------------------
// lessonLeaks — the string-variant rubricLeaks misses.
// --------------------------------------------------------------------------

test('lessonLeaks trips on a >=12-char normalized-alnum run shared with the sealed diff', () => {
  const accepted = 'def fix_the_quadratic_fallback(seq):\n    return sorted(seq)';
  const leaky = 'The lesson: avoid the_quadratic_fallback pattern entirely.'; // shares "thequadraticfallback" (>12)
  assert.strictEqual(lessonLeaks(leaky, accepted), true);
});

test('lessonLeaks passes a clean lesson (no long shared run) + empty/edge inputs', () => {
  const accepted = 'def f(x):\n    raise ValueError';
  assert.strictEqual(lessonLeaks('Raise on the empty edge case rather than yield.', accepted), false);
  assert.strictEqual(lessonLeaks('anything', ''), false); // empty sealed diff => no leak possible
  assert.strictEqual(lessonLeaks('', accepted), false);
});

test('lessonLeaks (unlike rubricLeaks) does NOT pass a flat string by type-guard', () => {
  // The bug it fixes: calibration-issue.js rubricLeaks returns false for a non-object;
  // a flat leaking string must be CAUGHT here.
  const { rubricLeaks } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'calibration-issue.js'));
  const accepted = 'reticulate_the_splines_carefully here';
  const leakyString = 'note: reticulate_the_splines_carefully when fixing';
  assert.strictEqual(rubricLeaks(leakyString, accepted), false, 'rubricLeaks silently passes a flat string (the gap)');
  assert.strictEqual(lessonLeaks(leakyString, accepted), true, 'lessonLeaks catches it');
});

// --------------------------------------------------------------------------
// groupByKey — generic exact-key tally; members are positional indices.
// --------------------------------------------------------------------------

test('groupByKey merges same-key blocks into one weighted group; members are indices', () => {
  const blocks = [
    { ...SEED },
    { trigger_class: 'data-parse', gotcha_class: 'silent-coercion', corrective_class: 'handle-edge-explicitly' },
    { ...SEED },
  ];
  const { groups, n } = groupByKey(blocks, lessonClusterKey);
  assert.strictEqual(n, 2);
  const seedKey = lessonClusterKey(SEED);
  assert.strictEqual(groups[seedKey].count, 2);
  assert.deepStrictEqual(groups[seedKey].members, [0, 2]);
});

test('groupByKey on [] / non-array is empty, not a throw', () => {
  assert.strictEqual(groupByKey([], lessonClusterKey).n, 0);
  assert.strictEqual(groupByKey(null, lessonClusterKey).n, 0);
});

test('groupByKey uses a null-proto map (a __proto__ key can not pollute)', () => {
  const { groups } = groupByKey([{ x: 1 }], () => '__proto__');
  assert.ok(Object.prototype.hasOwnProperty.call(groups, '__proto__'));
  assert.strictEqual(groups.__proto__.count, 1);
});

// --------------------------------------------------------------------------
// parseLessonClusterKey / isCanonicalLessonSignature — the symmetric VALIDATOR (PR-B B3 laundering guard).
// DIRECT enum membership, not a safeEnumKey round-trip (the 'INVALID' sentinel is a round-trip FIXPOINT).
// --------------------------------------------------------------------------

test('parseLessonClusterKey round-trips EVERY one of the 24 canonical cells (builder<->validator symmetry)', () => {
  let n = 0;
  for (const t of TRIGGER_CLASS) for (const g of GOTCHA_CLASS) for (const c of CORRECTIVE_CLASS) {
    const sig = lessonClusterKey({ trigger_class: t, gotcha_class: g, corrective_class: c });
    const parsed = parseLessonClusterKey(sig);
    assert.deepStrictEqual(parsed, { trigger_class: t, gotcha_class: g, corrective_class: c }, sig);
    assert.strictEqual(isCanonicalLessonSignature(sig), true);
    n += 1;
  }
  assert.strictEqual(n, 24, 'exactly the 4x3x2 floor');
});

test('parseLessonClusterKey REJECTS the INVALID-sentinel fixpoint (never a round-trip false-accept)', () => {
  for (const sig of ['lesson:INVALID|INVALID|INVALID', 'lesson:INVALID|unguarded-edge-case|fail-closed', 'lesson:boundary-contract|INVALID|fail-closed', 'lesson:boundary-contract|unguarded-edge-case|INVALID']) {
    assert.strictEqual(parseLessonClusterKey(sig), null, sig);
    assert.strictEqual(isCanonicalLessonSignature(sig), false, sig);
  }
});

test('parseLessonClusterKey REJECTS malformed shapes (4-part truncation trap, 2-part, missing prefix, empty, non-string)', () => {
  for (const sig of [
    'lesson:boundary-contract|unguarded-edge-case|fail-closed|EXTRA',   // split(NO limit) + length===3 catches it
    'lesson:boundary-contract|unguarded-edge-case',                     // 2-part
    'boundary-contract|unguarded-edge-case|fail-closed',                // missing prefix
    'lesson:', '', 'lesson:||', null, undefined, 42, {},
  ]) {
    assert.strictEqual(parseLessonClusterKey(sig), null, JSON.stringify(sig));
  }
});

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && e.message}`); }
  }
  console.log(`\nlesson-signature: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
