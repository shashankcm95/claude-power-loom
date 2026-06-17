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

test('W1-C: a pre-frozen parent with an UNFROZEN child freezes the child (WeakSet cycle-guard, not isFrozen short-circuit)', () => {
  // The #266 recurrence class the deep-freeze header documents as latent: the old
  // `Object.isFrozen(value) -> return` termination short-circuits on an already-frozen
  // parent and NEVER examines its children. The WeakSet cycle-guard freezes the child
  // while still terminating real cycles.
  const child = { mutable: 1 };
  const parent = Object.freeze({ child }); // parent frozen, child NOT
  assert.ok(Object.isFrozen(parent) && !Object.isFrozen(child), 'precondition: parent frozen, child not');
  deepFreeze(parent);
  assert.ok(Object.isFrozen(child), 'the unfrozen child of a pre-frozen parent must be frozen');
  assert.throws(() => { child.mutable = 2; }, TypeError, 'child write must throw after deepFreeze');
});

test('W1-C: a cycle THROUGH an already-frozen node still terminates', () => {
  // Defense: a frozen node that is also part of a cycle must not loop forever.
  const a = { name: 'a' };
  const b = { name: 'b', back: a };
  a.fwd = b;
  Object.freeze(a); // a frozen, b not, cycle a<->b
  const out = deepFreeze(a); // must terminate AND freeze b
  assert.strictEqual(out, a);
  assert.ok(Object.isFrozen(b), 'unfrozen cycle member must be frozen');
});

test('W1-B H-W1-1: a >10K-deep graph freezes without a RangeError (iterative, not recursive)', () => {
  // JSON.parse can build a graph deeper than the ~10K JS recursion limit; the OLD
  // recursive deepFreeze stack-overflowed on it. The iterative explicit-stack walk
  // must handle it. Build 20000-deep nested objects, then arrays.
  const deepObj = JSON.parse('{"a":'.repeat(20000) + '1' + '}'.repeat(20000));
  let frozen;
  assert.doesNotThrow(() => { frozen = deepFreeze(deepObj); }, 'deep object must not RangeError');
  assert.ok(Object.isFrozen(frozen), 'the top of a deep object is frozen');
  const deepArr = JSON.parse('['.repeat(20000) + ']'.repeat(20000));
  assert.doesNotThrow(() => deepFreeze(deepArr), 'deep array must not RangeError');
  assert.ok(Object.isFrozen(deepArr), 'the top of a deep array is frozen');
});

process.stdout.write(`\ndeep-freeze.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
