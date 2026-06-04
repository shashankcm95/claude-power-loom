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

process.stdout.write(`\ncanonical-json.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
