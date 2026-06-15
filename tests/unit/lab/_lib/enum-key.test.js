#!/usr/bin/env node

// tests/unit/lab/_lib/enum-key.test.js
//
// v3.11 W1 — the shared closed-set key primitive (extracted from trajectory-friction
// so the friction key + the lesson key share one inward dependency). PURE; CI-safe.

'use strict';

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const { safeEnumKey, INVALID } = require(path.join(REPO, 'packages', 'lab', '_lib', 'enum-key.js'));

let passed = 0; let failed = 0;
const _tests = [];
function test(name, fn) { _tests.push({ name, fn }); }

test('an in-set string passes through verbatim (array set)', () => {
  assert.strictEqual(safeEnumKey('editing', ['localization', 'editing', 'validation']), 'editing');
});

test('an in-set string passes through verbatim (Set set)', () => {
  assert.strictEqual(safeEnumKey('editing', new Set(['localization', 'editing'])), 'editing');
});

test('an off-enum string collapses to INVALID', () => {
  assert.strictEqual(safeEnumKey('bogus', ['editing']), INVALID);
  assert.strictEqual(INVALID, 'INVALID');
});

test('a non-string never coerces into a match (boolean / number / object / array)', () => {
  // String(true) === 'true'; a set containing 'true' must still reject the boolean.
  assert.strictEqual(safeEnumKey(true, ['true']), INVALID);
  assert.strictEqual(safeEnumKey(1, ['1']), INVALID);
  assert.strictEqual(safeEnumKey({ toString: () => 'editing' }, ['editing']), INVALID);
  assert.strictEqual(safeEnumKey(['editing'], ['editing']), INVALID);
});

test('null / undefined collapse to INVALID', () => {
  assert.strictEqual(safeEnumKey(null, ['editing']), INVALID);
  assert.strictEqual(safeEnumKey(undefined, ['editing']), INVALID);
});

test('a malformed set arg never throws (returns INVALID)', () => {
  assert.strictEqual(safeEnumKey('editing', null), INVALID);
  assert.strictEqual(safeEnumKey('editing', undefined), INVALID);
  assert.strictEqual(safeEnumKey('editing', 'editing'), INVALID); // a string is not a valid set
});

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && e.message}`); }
  }
  console.log(`\nenum-key: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
