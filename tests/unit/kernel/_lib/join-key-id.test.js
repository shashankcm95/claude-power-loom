#!/usr/bin/env node
'use strict';

// tests/unit/kernel/_lib/join-key-id.test.js
//
// The SINGLE-SOURCE join-key content-address primitive (extracted for PR-B B2). Guards: the KNOWN VECTOR
// (a byte-drift in canonicalJsonSerialize would change every join_key_id - the seal guard, mirroring
// lesson-commitment.test.js), the STORE RE-EXPORT identity (the store's deriveJoinKeyId IS this function -
// no fork), the null/absent -> '' coercion (never the literal token `undefined`), the '' vs 64-hex distinct
// bases (OQ-3 W3), and that ALL FIVE basis fields participate.

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const { deriveJoinKeyId } = require(path.join(REPO, 'packages/kernel/_lib/join-key-id.js'));
const store = require(path.join(REPO, 'packages/kernel/egress/join-key-store.js'));

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; process.stdout.write(`  PASS ${name}\n`); }
  catch (e) { failed += 1; process.stdout.write(`  FAIL ${name}: ${(e && e.message) || e}\n`); }
}

const REC = { repo: 'octo/widget', issueRef: 42, pr_number: 77, approval_hash: 'd'.repeat(64), lesson_commitment: 'e'.repeat(64) };
// The frozen seal vector. If this changes, EVERY persisted join_key_id has drifted - a breaking, must-know event.
const KNOWN_VECTOR = '6d766cd9e2be8312f8dcf7b64097edf83a5db0d45360762d904ac42d1858da77';

test('KNOWN VECTOR: the 5-tuple content-address is byte-stable (the seal guard)', () => {
  assert.strictEqual(deriveJoinKeyId(REC), KNOWN_VECTOR);
});

test('STORE RE-EXPORT identity: join-key-store.deriveJoinKeyId IS this primitive (no fork)', () => {
  assert.strictEqual(store.deriveJoinKeyId, deriveJoinKeyId);
  assert.strictEqual(store.deriveJoinKeyId(REC), KNOWN_VECTOR);
});

test('null/absent coercion: a missing field -> \'\' (never the literal token `undefined`)', () => {
  const base = { repo: 'r', issueRef: 1, pr_number: 1, approval_hash: 'a'.repeat(64) };
  // absent lesson_commitment coerces to '' -> identical to an explicit ''
  assert.strictEqual(deriveJoinKeyId(base), deriveJoinKeyId({ ...base, lesson_commitment: '' }));
  // null rec is tolerated (all-empties), never throws
  assert.strictEqual(typeof deriveJoinKeyId(null), 'string');
  assert.strictEqual(deriveJoinKeyId(null).length, 64);
});

test("OQ-3 W3 distinct bases: '' (no-lesson) and a 64-hex commitment are DIFFERENT ids", () => {
  const base = { repo: 'r', issueRef: 1, pr_number: 1, approval_hash: 'a'.repeat(64) };
  assert.notStrictEqual(deriveJoinKeyId({ ...base, lesson_commitment: '' }), deriveJoinKeyId({ ...base, lesson_commitment: 'e'.repeat(64) }));
});

test('all FIVE basis fields participate (changing any one changes the id)', () => {
  const baseId = deriveJoinKeyId(REC);
  for (const [k, v] of Object.entries({ repo: 'other/repo', issueRef: 43, pr_number: 78, approval_hash: 'c'.repeat(64), lesson_commitment: 'f'.repeat(64) })) {
    assert.notStrictEqual(deriveJoinKeyId({ ...REC, [k]: v }), baseId, `changing ${k} must change the id`);
  }
});

process.stdout.write(`\n=== join-key-id: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
