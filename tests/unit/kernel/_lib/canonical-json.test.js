#!/usr/bin/env node

// tests/unit/kernel/_lib/canonical-json.test.js
//
// Tests for packages/kernel/_lib/canonical-json.js — the pure sorted-keys serializer
// EXTRACTED from transaction-record.js (v3.4 Wave 0). These lock the leaf's standalone
// contract; transaction-record.test.js separately proves the re-exported symbol still
// hashes byte-identically (INV-22 / M1). The identity test below proves the re-export
// is the SAME function object, not a re-implementation.

'use strict';

const assert = require('assert');
const { canonicalJsonSerialize, MAX_CANONICAL_DEPTH, MAX_CANONICAL_NODES } =
  require('../../../../packages/kernel/_lib/canonical-json');
const txn = require('../../../../packages/kernel/_lib/transaction-record');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// --- key-order determinism (the design-input-b property) ---
test('sorts object keys deterministically (insertion order does not matter)', () => {
  const a = canonicalJsonSerialize({ b: 2, a: 1, c: 3 });
  const b = canonicalJsonSerialize({ c: 3, a: 1, b: 2 });
  assert.strictEqual(a, b);
  assert.strictEqual(a, '{"a":1,"b":2,"c":3}');
});

test('recurses — nested objects + arrays are canonicalized at every depth', () => {
  const out = canonicalJsonSerialize({ y: [1, { z: 2, a: 3 }], x: 'foo' });
  assert.strictEqual(out, '{"x":"foo","y":[1,{"a":3,"z":2}]}');
});

test('null + primitives serialize as plain JSON', () => {
  assert.strictEqual(canonicalJsonSerialize(null), 'null');
  assert.strictEqual(canonicalJsonSerialize(42), '42');
  assert.strictEqual(canonicalJsonSerialize('hello'), '"hello"');
});

// --- the bounds throw a CONTROLLED TypeError (callers catch + fail-soft/closed) ---
test('depth bound: a chain deeper than MAX_CANONICAL_DEPTH throws a controlled TypeError', () => {
  const deep = {};
  let cur = deep;
  for (let i = 0; i < MAX_CANONICAL_DEPTH + 5; i++) { cur.n = {}; cur = cur.n; }
  assert.throws(() => canonicalJsonSerialize(deep), /max nesting depth exceeded/);
});

test('node bound: a structure wider than MAX_CANONICAL_NODES throws a controlled TypeError', () => {
  const wide = new Array(MAX_CANONICAL_NODES + 1).fill(1);
  assert.throws(() => canonicalJsonSerialize(wide), /max node budget exceeded/);
});

// --- back-compat: the re-export is the SAME function (not a divergent copy) ---
test('transaction-record re-exports the identical function object (byte-identity by construction)', () => {
  assert.strictEqual(txn.canonicalJsonSerialize, canonicalJsonSerialize,
    're-export must be the same reference so kernel hashing bytes are unchanged');
});

// --- #550 (mirror of PACT F1): the JSON-ABSENT scalar class matches native JSON.stringify ---

test('#550 NO-OP: a JSON-absent-free value is byte-stable (== native round-trip) — INV-22 preserved', () => {
  const v = { z: 1, a: [1, 2, { k: 'v' }], m: { b: true, a: null } };
  assert.strictEqual(canonicalJsonSerialize(v), '{"a":[1,2,{"k":"v"}],"m":{"a":null,"b":true},"z":1}');
  // the content-address invariant: canonical(x) === canonical(JSON.parse(JSON.stringify(x))) for clean x
  assert.strictEqual(canonicalJsonSerialize(v), canonicalJsonSerialize(JSON.parse(JSON.stringify(v))));
});

test('#550: a nested undefined OBJECT value is DROPPED (matches native), not a bareword', () => {
  assert.strictEqual(canonicalJsonSerialize({ a: 1, b: undefined }), '{"a":1}');
  assert.strictEqual(
    canonicalJsonSerialize({ a: 1, b: undefined }),
    canonicalJsonSerialize(JSON.parse(JSON.stringify({ a: 1, b: undefined }))),
  );
});

test('#550: a nested undefined ARRAY element becomes null (matches native), not an empty slot', () => {
  assert.strictEqual(canonicalJsonSerialize([1, undefined, 2]), '[1,null,2]');
  assert.strictEqual(canonicalJsonSerialize([1, undefined, 2]), JSON.stringify([1, undefined, 2]));
});

test('#550: a DEEP nested absent value is dropped/nulled at its own level', () => {
  assert.strictEqual(canonicalJsonSerialize({ a: { b: undefined, c: 2 } }), '{"a":{"c":2}}');
  assert.strictEqual(canonicalJsonSerialize({ a: [1, { d: undefined, e: 3 }] }), '{"a":[1,{"e":3}]}');
});

test('#550: function + symbol values (same JSON-absent class) are dropped in objects, null in arrays', () => {
  assert.strictEqual(canonicalJsonSerialize({ a: 1, f: function () {} }), '{"a":1}');
  assert.strictEqual(canonicalJsonSerialize([1, function () {}, 2]), '[1,null,2]');
  assert.strictEqual(canonicalJsonSerialize({ a: 1, s: Symbol('x') }), '{"a":1}');
  assert.strictEqual(canonicalJsonSerialize([1, Symbol('x'), 2]), '[1,null,2]');
});

test('#550: a getter returning undefined is read ONCE and dropped (deterministic, not a bareword)', () => {
  const o = { a: 1 };
  Object.defineProperty(o, 'b', { enumerable: true, get() { return undefined; } });
  assert.strictEqual(canonicalJsonSerialize(o), '{"a":1}');
});

test('#550: {a,b:undefined} and {a} hash identically — the native write path always collapsed them', () => {
  assert.strictEqual(canonicalJsonSerialize({ a: 1, b: undefined }), canonicalJsonSerialize({ a: 1 }));
});

test('#550: a SPARSE array hole serializes as null (matches native), not an invalid empty slot', () => {
  // Build the hole via index assignment (not a literal 2-comma array) so there is no
  // no-sparse-arrays lint to suppress (ADR-0006: zero lint suppressions). Index 1 stays a hole.
  const sparse = [1];
  sparse[2] = 2;
  assert.strictEqual(sparse.length, 3);
  assert.strictEqual(canonicalJsonSerialize(sparse), '[1,null,2]');
  assert.strictEqual(canonicalJsonSerialize(sparse), JSON.stringify(sparse));
});

test('#550: an array with a custom Symbol.iterator hashes BY INDEX (matches native), not via the iterator', () => {
  const a = [1, 2, 3];
  a[Symbol.iterator] = function* () { yield 9; yield 9; };
  assert.strictEqual(canonicalJsonSerialize(a), '[1,2,3]');
  assert.strictEqual(canonicalJsonSerialize(a), JSON.stringify(a));
});

test('#550: DoS guard intact — a wide all-ABSENT-key object STILL trips the node budget', () => {
  const wide = {};
  for (let i = 0; i < MAX_CANONICAL_NODES + 5; i++) wide['k' + i] = undefined;
  assert.throws(() => canonicalJsonSerialize(wide), /node budget|max/i);
});

process.stdout.write(`\ncanonical-json.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
