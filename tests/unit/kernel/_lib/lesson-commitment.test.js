#!/usr/bin/env node

// tests/unit/kernel/_lib/lesson-commitment.test.js
//
// OQ-3 kernel-seal arc - the SINGLE-SOURCE lesson-commitment primitive (moved kernel-ward in W2, fold F2).
// computeLessonCommitment content-addresses a captured lesson over EXACTLY {lesson_signature, lesson_body} via the
// kernel's canonicalJsonSerialize, so the seal (W2/W3/PR-A2 + the gate) all key off ONE digest basis.
//
// Behavioral SPEC. PURE; CI-safe (no fs, no I/O, no claude). The async-collector harness mirrors the kernel-suite
// convention (the kernel runner `xargs -0 -n1 node` executes each file as a plain script; node:assert + a
// self-counting harness is the in-repo convention).

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const { computeLessonCommitment } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'lesson-commitment.js'));
const { canonicalJsonSerialize } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'canonical-json.js'));

let passed = 0; let failed = 0;
const _tests = [];
function test(name, fn) { _tests.push({ name, fn }); }

const HEX64 = /^[0-9a-f]{64}$/;

// A canonical, valid lesson pair (the capture branch derives one of these from a live solve).
const SIG = 'lesson:boundary-contract|unguarded-edge-case|fail-closed';
const BODY = 'Raise on the empty edge rather than yield a degenerate value.';

// ---- determinism + format ----------------------------------------------------
test('determinism: the same input yields the same 64-hex digest (matches /^[0-9a-f]{64}$/)', () => {
  const a = computeLessonCommitment({ lesson_signature: SIG, lesson_body: BODY });
  const b = computeLessonCommitment({ lesson_signature: SIG, lesson_body: BODY });
  assert.strictEqual(a, b, 'two identical inputs must hash identically');
  assert.ok(HEX64.test(a), 'the digest is lowercase 64-hex');
});

// ---- key-order independence (canonical JSON sorts keys) ----------------------
test('key-order independence: keys in a different literal order yield the same digest', () => {
  const inOrder = computeLessonCommitment({ lesson_signature: SIG, lesson_body: BODY });
  // construct the SAME object with the keys declared in the reverse literal order
  const reversed = {};
  reversed.lesson_body = BODY;
  reversed.lesson_signature = SIG;
  const outOfOrder = computeLessonCommitment(reversed);
  assert.strictEqual(outOfOrder, inOrder, 'canonical JSON sorts keys -> literal key order is irrelevant');
});

// ---- a body reword changes the digest (same signature) ----------------------
test('a lesson_body reword changes the digest (same signature)', () => {
  const a = computeLessonCommitment({ lesson_signature: SIG, lesson_body: BODY });
  const b = computeLessonCommitment({ lesson_signature: SIG, lesson_body: BODY + ' (reworded)' });
  assert.notStrictEqual(a, b, 'a body reword must change the commitment (the seal binds the body)');
});

// ---- field-swap distinctness: it commits BOTH fields, not just one ----------
test('field-swap distinctness: swapping the two field VALUES changes the digest', () => {
  // two non-empty strings; swap which one is the signature vs the body.
  const A = 'alpha-string-one';
  const B = 'beta-string-two';
  const straight = computeLessonCommitment({ lesson_signature: A, lesson_body: B });
  const swapped = computeLessonCommitment({ lesson_signature: B, lesson_body: A });
  assert.notStrictEqual(straight, swapped, 'swapping the values must change the digest (proves it commits BOTH fields)');
});

// ---- the undefined footgun: never silently hash a bad input -----------------
// canonicalJsonSerialize emits the LITERAL token `undefined` for an undefined-valued key, so the
// undefined / empty-string / key-absent cases are three DISTINCT canonical bases - silently hashing
// any of them would corrupt the future seal. The helper must THROW instead of producing a digest.
test('the undefined footgun: undefined / empty / null / non-string for EITHER field THROWS (never silently hash)', () => {
  const re = /lesson_signature and lesson_body must be non-empty strings/;
  // lesson_signature bad
  assert.throws(() => computeLessonCommitment({ lesson_signature: undefined, lesson_body: BODY }), re, 'undefined signature throws');
  assert.throws(() => computeLessonCommitment({ lesson_signature: '', lesson_body: BODY }), re, 'empty signature throws');
  assert.throws(() => computeLessonCommitment({ lesson_signature: null, lesson_body: BODY }), re, 'null signature throws');
  assert.throws(() => computeLessonCommitment({ lesson_signature: 7, lesson_body: BODY }), re, 'numeric signature throws');
  // lesson_body bad
  assert.throws(() => computeLessonCommitment({ lesson_signature: SIG, lesson_body: undefined }), re, 'undefined body throws');
  assert.throws(() => computeLessonCommitment({ lesson_signature: SIG, lesson_body: '' }), re, 'empty body throws');
  assert.throws(() => computeLessonCommitment({ lesson_signature: SIG, lesson_body: null }), re, 'null body throws');
  assert.throws(() => computeLessonCommitment({ lesson_signature: SIG, lesson_body: 13 }), re, 'numeric body throws');
  // both absent / a non-object arg
  assert.throws(() => computeLessonCommitment({}), re, 'an empty object throws');
  assert.throws(() => computeLessonCommitment(undefined), re, 'an undefined arg throws');
  assert.throws(() => computeLessonCommitment(null), re, 'a null arg throws');
});

// ---- the digest is exactly sha256(canonicalJsonSerialize({lesson_signature, lesson_body})) -----
test('the digest equals sha256 over the canonical {lesson_signature, lesson_body} serialization', () => {
  const expected = crypto
    .createHash('sha256')
    .update(canonicalJsonSerialize({ lesson_signature: SIG, lesson_body: BODY }))
    .digest('hex');
  const got = computeLessonCommitment({ lesson_signature: SIG, lesson_body: BODY });
  assert.strictEqual(got, expected, 'the helper is sha256(canonicalJsonSerialize(basis))');
});

// ---- a frozen known-vector (catches a future canonical-json byte drift) ------
// Computed once and hardcoded: if canonicalJsonSerialize ever changes its bytes, this fails LOUDLY
// (the same INV-22/M1 forward-coupling guard the canonical-json module warns about). Carried verbatim
// across the kernel-ward move (fold F2) so the seal's digest basis is provably unchanged.
test('known-vector: a fixed {lesson_signature, lesson_body} pair hashes to the frozen 64-hex', () => {
  const KNOWN = '9553275e3e16e84a850d3a8b9b323e9554d2e8fa95740739e983d7c33e3f77d4';
  const got = computeLessonCommitment({ lesson_signature: SIG, lesson_body: BODY });
  assert.strictEqual(got, KNOWN, 'a canonical-json byte drift would change this frozen digest');
});

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && (e.stack || e.message)}`); }
  }
  console.log(`\nlesson-commitment: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
