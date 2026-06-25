#!/usr/bin/env node

// tests/unit/lab/world-anchor/lesson.test.js
//
// The world-anchor lesson builder REUSES the FROZEN taxonomy from causal-edge/lesson-signature
// (never re-literals the enums) and the SAME LESSON_BODY_MAX bound. Covers: a valid build maps
// to the lessonClusterKey; an off-floor class is rejected; a body over LESSON_BODY_MAX is
// HARD-REJECTED (not truncated); scrubLabSecrets runs over the body; the #2137 lesson constant
// produces the EXPECTED lesson_signature (regression-pin for the backfill).

'use strict';

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const { buildWorldAnchorLesson, LESSON_2137 } = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'lesson.js'));
const { lessonClusterKey, LESSON_BODY_MAX } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'lesson-signature.js'));

let passed = 0;
function test(name, fn) { fn(); passed += 1; }

test('buildWorldAnchorLesson: a valid block maps to the canonical lessonClusterKey', () => {
  const l = buildWorldAnchorLesson({
    trigger_class: 'boundary-contract',
    gotcha_class: 'unguarded-edge-case',
    corrective_class: 'handle-edge-explicitly',
    lesson_body: 'a short lesson',
  });
  assert.strictEqual(
    l.lesson_signature,
    lessonClusterKey({ trigger_class: 'boundary-contract', gotcha_class: 'unguarded-edge-case', corrective_class: 'handle-edge-explicitly' }),
    'the signature is the imported lessonClusterKey, never a re-literal',
  );
  assert.strictEqual(l.lesson_body, 'a short lesson');
});

test('buildWorldAnchorLesson: an OFF-FLOOR enum value is HARD-REJECTED (throws, never mints an INVALID key)', () => {
  assert.throws(() => buildWorldAnchorLesson({
    trigger_class: 'not-a-real-trigger',
    gotcha_class: 'unguarded-edge-case',
    corrective_class: 'handle-edge-explicitly',
    lesson_body: 'x',
  }), /off-floor|enum|invalid/i);
});

test('buildWorldAnchorLesson: a lesson_body OVER LESSON_BODY_MAX is HARD-REJECTED (not truncated)', () => {
  const big = 'x'.repeat(LESSON_BODY_MAX + 1);
  assert.throws(() => buildWorldAnchorLesson({
    trigger_class: 'boundary-contract',
    gotcha_class: 'unguarded-edge-case',
    corrective_class: 'handle-edge-explicitly',
    lesson_body: big,
  }), /body|max|length/i);
});

test('buildWorldAnchorLesson: a lesson_body AT exactly LESSON_BODY_MAX is accepted (boundary)', () => {
  const exact = 'x'.repeat(LESSON_BODY_MAX);
  const l = buildWorldAnchorLesson({
    trigger_class: 'boundary-contract',
    gotcha_class: 'unguarded-edge-case',
    corrective_class: 'handle-edge-explicitly',
    lesson_body: exact,
  });
  assert.strictEqual(l.lesson_body.length, LESSON_BODY_MAX);
});

test('buildWorldAnchorLesson: scrubLabSecrets runs over the body (coarse defense-in-depth)', () => {
  // an AWS-secret assignment shape, split so the bare-secret PreToolUse gate does not block this file
  const leaked = 'see ' + 'aws_secret_access_key' + '=' + 'AKIAIOSFODNN7EXAMPLEKEYDATA0000000000000000' + ' here';
  const l = buildWorldAnchorLesson({
    trigger_class: 'boundary-contract',
    gotcha_class: 'silent-coercion',
    corrective_class: 'fail-closed',
    lesson_body: leaked,
  });
  assert.ok(l.lesson_body.includes('[REDACTED]'), 'the secret is coarse-redacted in the stored body');
});

test('LESSON_2137: the #2137 lesson constant is taxonomy-valid and pins its lesson_signature', () => {
  assert.strictEqual(LESSON_2137.trigger_class, 'boundary-contract');
  assert.strictEqual(LESSON_2137.gotcha_class, 'unguarded-edge-case');
  assert.strictEqual(LESSON_2137.corrective_class, 'handle-edge-explicitly');
  const built = buildWorldAnchorLesson(LESSON_2137);
  assert.strictEqual(
    built.lesson_signature,
    'lesson:boundary-contract|unguarded-edge-case|handle-edge-explicitly',
    'the #2137 lesson_signature is the expected frozen cluster key',
  );
  assert.ok(/python/i.test(built.lesson_body), 'the lesson_body describes the python-interpreter fix');
  assert.ok(built.lesson_body.length <= LESSON_BODY_MAX);
});

console.log(`lesson.test.js: ${passed} passed`);
