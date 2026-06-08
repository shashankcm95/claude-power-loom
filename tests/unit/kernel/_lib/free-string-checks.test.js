#!/usr/bin/env node

// tests/unit/kernel/_lib/free-string-checks.test.js
//
// Unit for the shared free-string-checks leaf: nonEmptyString + hasControlChars. PURE - no env/state.
// Pins the EXACT control/format codepoint set the Lab stores reject (C0 / DEL+C1 / U+2028 / U+2029 /
// U+FEFF) + the hasControlChars NON-STRING precondition (architect VERIFY: it assumes a string; the caller
// gates it via nonEmptyString - a non-string throws on .length, NOT a clean error here).

'use strict';

const assert = require('assert');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const { nonEmptyString, hasControlChars } = require(path.join(REPO_ROOT, 'packages', 'kernel', '_lib', 'free-string-checks.js'));

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; } catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// -- nonEmptyString boundary.
test('nonEmptyString: a non-empty string is true; empty / non-string is false', () => {
  assert.strictEqual(nonEmptyString('x'), true);
  assert.strictEqual(nonEmptyString('  '), true, 'whitespace is non-empty');
  assert.strictEqual(nonEmptyString(''), false);
  for (const bad of [undefined, null, 0, 1, {}, [], true]) {
    assert.strictEqual(nonEmptyString(bad), false, `non-string ${String(bad)} -> false`);
  }
});

// -- hasControlChars: rejects the full control/format set; accepts ordinary ASCII + non-ASCII.
test('hasControlChars: rejects C0 / DEL+C1 / U+2028 / U+2029 / U+FEFF; accepts ASCII + ordinary non-ASCII', () => {
  assert.strictEqual(hasControlChars('a normal justification'), false, 'plain ASCII');
  assert.strictEqual(hasControlChars(`r${String.fromCharCode(0x00e9)}sum${String.fromCharCode(0x00e9)}`), false, 'ordinary non-ASCII (e-acute) accepted');
  assert.strictEqual(hasControlChars(`a${String.fromCharCode(0x4e2d)}b`), false, 'a CJK char (BMP non-ASCII) is fine');
  for (const cp of [0x00, 0x09, 0x0a, 0x0d, 0x1f, 0x7f, 0x85, 0x9f, 0x2028, 0x2029, 0xfeff]) {
    assert.strictEqual(hasControlChars(`a${String.fromCharCode(cp)}b`), true, `0x${cp.toString(16)} rejected`);
  }
  // Boundary: 0x20 (space) and 0xa0 (NBSP, just above the C1 range) are NOT rejected.
  assert.strictEqual(hasControlChars('a b'), false, '0x20 space is fine');
  assert.strictEqual(hasControlChars(`a${String.fromCharCode(0xa0)}b`), false, '0xa0 NBSP is above C1, not rejected');
});

// -- hasControlChars NON-STRING precondition (architect VERIFY required): it assumes a string; a non-string
//    throws on v.length (the caller's contract - nonEmptyString gates it upstream), NOT a clean error here.
test('hasControlChars: documented precondition - a non-string is the CALLER contract (throws on .length)', () => {
  assert.strictEqual(hasControlChars('plain'), false, 'the normal string path');
  assert.throws(() => hasControlChars(null), TypeError, 'null throws (precondition: caller passes a string)');
  assert.throws(() => hasControlChars(undefined), TypeError, 'undefined throws (precondition)');
});

process.stdout.write(`\nfree-string-checks.test.js (kernel/_lib): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
