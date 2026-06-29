#!/usr/bin/env node

// tests/unit/kernel/_lib/world-anchor-edge-id.test.js
//
// PR-A2b W2a - the SINGLE-SOURCE world-anchor edge-id seal (relocated kernel-ward so BOTH the lab
// store [writer/verifier] and the kernel egress bind [recompute] import ONE recipe; byte-parity by
// construction). deriveWorldAnchorEdgeId content-addresses an edge over EXACTLY {from_node_id,
// to_delta_ref, edge_type} via the kernel's canonicalJsonSerialize.
//
// Behavioral SPEC. PURE; CI-safe (no fs, no I/O, no claude). The async-collector harness mirrors the
// kernel-suite convention (the runner `xargs -0 -n1 node` executes each file as a plain script;
// node:assert + a self-counting harness is the in-repo convention - see lesson-commitment.test.js).

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const { deriveWorldAnchorEdgeId } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'world-anchor-edge-id.js'));
const { canonicalJsonSerialize } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'canonical-json.js'));

let passed = 0; let failed = 0;
const _tests = [];
function test(name, fn) { _tests.push({ name, fn }); }

const HEX64 = /^[0-9a-f]{64}$/;

const FROM = 'a'.repeat(64);
const TO = 'b'.repeat(64);
const TYPE = 'world-anchored-by';

// ---- BYTE-PARITY PIN (F3): a future recipe change is a deliberate test-break --------------------
// The frozen 64-hex is computed from the canonical recipe and hardcoded. If the recipe (the field
// order, the null->'' coercion, the canonical serializer's bytes) ever changes, this fails LOUDLY -
// the same INV-22 / M1 forward-coupling guard the lab store + the kernel bind both depend on.
test('byte-parity PIN: the canonical {from,to,type} vector hashes to the frozen 64-hex', () => {
  const got = deriveWorldAnchorEdgeId({ from_node_id: FROM, to_delta_ref: TO, edge_type: TYPE });
  assert.strictEqual(got, '8a238c9d201c0cb373c06dc1effed63466fe202694187104a3af163a6adfa028',
    'a recipe / canonical-json byte drift would change this frozen digest (deliberate test-break)');
});

// ---- a second vector: lowercase 64-hex + stable across two calls --------------------------------
test('a second distinct vector -> a stable lowercase 64-hex (deterministic)', () => {
  const rec = { from_node_id: 'c'.repeat(64), to_delta_ref: 'd'.repeat(64), edge_type: 'world-anchored-by' };
  const a = deriveWorldAnchorEdgeId(rec);
  const b = deriveWorldAnchorEdgeId(rec);
  assert.ok(HEX64.test(a), 'the digest is lowercase 64-hex');
  assert.strictEqual(a, b, 'two identical inputs must hash identically');
  // distinct from the pinned vector (proves the inputs actually flow into the digest)
  assert.notStrictEqual(a, '8a238c9d201c0cb373c06dc1effed63466fe202694187104a3af163a6adfa028',
    'a different from/to recomputes to a different id');
});

// ---- null/undefined fields coerce to '' (the VERBATIM store recipe) -----------------------------
test('null/undefined fields coerce to "" (an absent field === an explicit-empty field)', () => {
  const absent = deriveWorldAnchorEdgeId({ to_delta_ref: TO, edge_type: TYPE });            // from_node_id absent
  const empty = deriveWorldAnchorEdgeId({ from_node_id: '', to_delta_ref: TO, edge_type: TYPE });
  assert.strictEqual(absent, empty, 'an absent from_node_id coerces to "" exactly like an explicit empty string');
  // null is the same as absent (the `== null` guard catches both undefined and null)
  const nul = deriveWorldAnchorEdgeId({ from_node_id: null, to_delta_ref: TO, edge_type: TYPE });
  assert.strictEqual(nul, empty, 'a null from_node_id coerces to "" too');
});

// ---- output shape: always lowercase HEX64 -------------------------------------------------------
test('output is a lowercase 64-hex for varied inputs', () => {
  const vectors = [
    { from_node_id: FROM, to_delta_ref: TO, edge_type: TYPE },
    { from_node_id: 'e'.repeat(64), to_delta_ref: 'f'.repeat(64), edge_type: 'some-other-type' },
    {},
    { edge_type: 'x' },
  ];
  for (const v of vectors) assert.ok(HEX64.test(deriveWorldAnchorEdgeId(v)), `lowercase 64-hex for ${JSON.stringify(v)}`);
});

// ---- the digest equals sha256(canonicalJsonSerialize([from, to, type])) -------------------------
// Pins the EXACT recipe (the array-of-three canonical serialization), so a refactor that silently
// changed the basis shape (e.g. an object instead of an array) is caught here, not just by the PIN.
test('the digest equals sha256 over the canonical [from, to, type] array serialization', () => {
  const expected = crypto
    .createHash('sha256')
    .update(canonicalJsonSerialize([FROM, TO, TYPE]))
    .digest('hex');
  const got = deriveWorldAnchorEdgeId({ from_node_id: FROM, to_delta_ref: TO, edge_type: TYPE });
  assert.strictEqual(got, expected, 'the helper is sha256(canonicalJsonSerialize([from, to, type]))');
});

// ---- a number field String-coerces (the recipe wraps with String()) -----------------------------
// Proves the recipe's String() wrap is present: a number 5 and the string "5" derive identically.
// (This is WHY the kernel bind's validateCtxShape must STRICT-type-check endpoints, not lean on the
// derive - the derive coerces; the bind's gate keeps the signable space == the store-acceptable space.)
test('a number field coerces via String() to its string form (derive(5) === derive("5"))', () => {
  const asNum = deriveWorldAnchorEdgeId({ from_node_id: 5, to_delta_ref: TO, edge_type: TYPE });
  const asStr = deriveWorldAnchorEdgeId({ from_node_id: '5', to_delta_ref: TO, edge_type: TYPE });
  assert.strictEqual(asNum, asStr, 'String()-coercion folds a number into its string form (recipe verbatim)');
});

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && (e.stack || e.message)}`); }
  }
  console.log(`\nworld-anchor-edge-id: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
