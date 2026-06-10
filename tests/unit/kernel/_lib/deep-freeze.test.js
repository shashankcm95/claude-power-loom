#!/usr/bin/env node

// tests/unit/kernel/_lib/deep-freeze.test.js
//
// B3 (2026-06-10 chip): the pure recursive freeze utility. The #266 shallow-freeze
// class: a top-level Object.freeze leaves nested arrays/objects mutable. This util
// freezes recursively. Contract:
//   - primitives/null pass through
//   - nested arrays + objects are frozen (mutation throws in strict mode)
//   - returns the SAME reference (in-place)
//   - cycle-safe (no infinite recursion)

'use strict';

const assert = require('assert');
const path = require('path');

const { deepFreeze } = require(path.join(__dirname, '..', '..', '..', '..', 'packages', 'kernel', '_lib', 'deep-freeze.js'));

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

test('primitives + null pass through unchanged', () => {
  assert.strictEqual(deepFreeze(5), 5);
  assert.strictEqual(deepFreeze('x'), 'x');
  assert.strictEqual(deepFreeze(null), null);
  assert.strictEqual(deepFreeze(undefined), undefined);
});

test('returns the SAME reference (in-place freeze)', () => {
  const o = { a: 1 };
  assert.strictEqual(deepFreeze(o), o);
});

test('top-level object is frozen', () => {
  const o = deepFreeze({ a: 1 });
  assert.ok(Object.isFrozen(o));
  assert.throws(() => { o.a = 2; }, TypeError);
  assert.throws(() => { o.b = 3; }, TypeError);
});

test('NESTED arrays are frozen (the #266 class)', () => {
  const o = deepFreeze({ refs: ['A', 'B'] });
  assert.ok(Object.isFrozen(o.refs), 'nested array must be frozen');
  assert.throws(() => { o.refs[0] = 'X'; }, TypeError, 'element write must throw');
  assert.throws(() => { o.refs.push('C'); }, TypeError, 'push must throw');
});

test('DEEPLY nested objects are frozen', () => {
  const o = deepFreeze({ a: { b: { c: [1, { d: 2 }] } } });
  assert.ok(Object.isFrozen(o.a.b.c));
  assert.ok(Object.isFrozen(o.a.b.c[1]));
  assert.throws(() => { o.a.b.c[1].d = 9; }, TypeError);
});

test('cycle-safe (no infinite recursion)', () => {
  const a = { name: 'a' };
  const b = { name: 'b', back: a };
  a.fwd = b; // cycle a -> b -> a
  // Must terminate; both frozen.
  const out = deepFreeze(a);
  assert.strictEqual(out, a);
  assert.ok(Object.isFrozen(a) && Object.isFrozen(b));
  assert.throws(() => { a.name = 'z'; }, TypeError);
});

process.stdout.write(`\ndeep-freeze.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
