'use strict';

// tests/unit/kernel/egress/loom-edge-bind.test.js - the world-anchor-edge recompute-bind WHAT gate.
// Proves: re-derive the edge-id from the presented {from,to,type} ctx (never trust the argv claim;
// #273 verify-the-body), the exact-shape closed-set gate (an extra key collides under a bare === but
// is caught here - the F1 NON-VACUOUS case), STRICT endpoint/edge_type typing (a non-hex / number
// edge_type String-coerces through the derive to a valid id; the F2 coercion-collision case), and
// that the signed value is the RECOMPUTE, never the argv claim. PURE. Mirrors loom-broker-bind.test.js.

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const B = require(path.join(REPO, 'packages', 'kernel', 'egress', 'loom-edge-bind.js'));
const { deriveWorldAnchorEdgeId } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'world-anchor-edge-id.js'));

let passed = 0; let failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const FROM = 'a'.repeat(64);
const TO = 'b'.repeat(64);
const TYPE = 'world-anchored-by';

// A canonical honest 3-key ctx (the exact identity basis the derive hashes).
function ctxFor(over) { return Object.assign({ from_node_id: FROM, to_delta_ref: TO, edge_type: TYPE }, over || {}); }
function basisFor(ctx) { return deriveWorldAnchorEdgeId(ctx); }
function call(ctx, claimedBasis) {
  return B.authorizeRequest({ claimedBasis: claimedBasis !== undefined ? claimedBasis : basisFor(ctx), presentedCtxRaw: JSON.stringify(ctx) });
}
// Every deny MUST carry a null basis (a deny never yields a signable value).
function assertDeny(r, reason) {
  assert.strictEqual(r.decision, 'deny', `expected deny, got ${r.decision}`);
  if (reason !== undefined) assert.strictEqual(r.reason, reason, `expected reason ${reason}, got ${r.reason}`);
  assert.strictEqual(r.basisToSign, null, 'a deny must carry basisToSign:null');
}

// ---- ALLOW: a matching ctx -> allow, basisToSign === the recompute === the claim ----------------
test('a 3-key ctx that recomputes to the claimed basis -> allow; basisToSign === claimedBasis (the recompute)', () => {
  const ctx = ctxFor();
  const claimed = basisFor(ctx);
  const r = call(ctx, claimed);
  assert.strictEqual(r.decision, 'allow');
  assert.strictEqual(r.reason, 'authorized');
  assert.strictEqual(r.basisToSign, claimed, 'the signed value is the recompute (=== the claim by the gate)');
});

test('basisToSign is the RECOMPUTE (independently derived), not the raw argv claim', () => {
  const ctx = ctxFor();
  const independent = deriveWorldAnchorEdgeId({ from_node_id: FROM, to_delta_ref: TO, edge_type: TYPE });
  const r = call(ctx);
  assert.strictEqual(r.basisToSign, independent, 'the bind signs an independently recomputed id');
});

// ---- DENY non-vacuous (the security core): basis-mismatch ---------------------------------------
// A forged from_node_id whose recompute != the claimed basis (the claim is the OLD honest id). Inject
// the mismatch, watch it deny; the ALLOW case above confirms the matching ctx passes (non-vacuous).
test('basis-mismatch: a FORGED from_node_id (claim from the honest body) -> deny basis-mismatch', () => {
  const honestClaim = basisFor(ctxFor());                                   // id of the honest {from,to,type}
  const forged = ctxFor({ from_node_id: 'c'.repeat(64) });                  // a different, real-shaped from
  const r = call(forged, honestClaim);                                      // claim the honest id over a forged body
  assertDeny(r, 'basis-mismatch');
});

test('basis-mismatch: a SWAPPED to_delta_ref (claim from the honest body) -> deny basis-mismatch', () => {
  const honestClaim = basisFor(ctxFor());
  const swapped = ctxFor({ to_delta_ref: 'd'.repeat(64) });
  assertDeny(call(swapped, honestClaim), 'basis-mismatch');
});

// ---- DENY extra-key (F1 NON-VACUOUS): the collision a bare === would miss ------------------------
// deriveWorldAnchorEdgeId IGNORES extra keys, so a {from,to,type,EVIL} ctx recomputes to the SAME id
// as the honest 3-key body - a bare recompute===claim would ALLOW it. The shape gate catches it FIRST.
test('extra-key (F1): a 4-key ctx {from,to,type,EVIL} whose recompute === the honest id -> deny ctx-shape-mismatch', () => {
  const honestClaim = basisFor(ctxFor());
  const evil = Object.assign(ctxFor(), { EVIL: 'x' });
  // sanity: the derive really does ignore the extra key (the collision is real)
  assert.strictEqual(deriveWorldAnchorEdgeId(evil), honestClaim, 'the derive ignores EVIL -> a bare === would pass');
  const r = B.authorizeRequest({ claimedBasis: honestClaim, presentedCtxRaw: JSON.stringify(evil) });
  assertDeny(r, 'ctx-shape-mismatch');
});

// ---- DENY missing-key (3 -> 2) ------------------------------------------------------------------
test('missing-key: a 2-key ctx (edge_type deleted) -> deny ctx-shape-mismatch', () => {
  const honestClaim = basisFor(ctxFor());
  const partial = ctxFor(); delete partial.edge_type;
  const r = B.authorizeRequest({ claimedBasis: honestClaim, presentedCtxRaw: JSON.stringify(partial) });
  assertDeny(r, 'ctx-shape-mismatch');
});

// ---- DENY non-HEX64 endpoints (F2 - the coercion-collision defense) ------------------------------
// A non-hex from_node_id String-coerces through the derive to a valid hex; without the strict gate the
// signable-id space would exceed the store-acceptable space. The gate keeps them equal.
test('non-HEX64 from_node_id -> deny from_node_id-not-hex64 (a non-hex coerces through the derive)', () => {
  const goodBasis = basisFor(ctxFor());
  const mk = (over) => B.authorizeRequest({ claimedBasis: goodBasis, presentedCtxRaw: JSON.stringify(ctxFor(over)) });
  assertDeny(mk({ from_node_id: 'not-hex' }), 'from_node_id-not-hex64');
  assertDeny(mk({ from_node_id: 'A'.repeat(64) }), 'from_node_id-not-hex64');   // UPPERCASE rejected (lowercase-only)
  assertDeny(mk({ from_node_id: 'a'.repeat(63) }), 'from_node_id-not-hex64');   // 63-hex rejected
  assertDeny(mk({ from_node_id: 5 }), 'from_node_id-not-hex64');                // number coerces in derive; gated here
});

test('non-HEX64 to_delta_ref -> deny to_delta_ref-not-hex64', () => {
  const goodBasis = basisFor(ctxFor());
  const mk = (over) => B.authorizeRequest({ claimedBasis: goodBasis, presentedCtxRaw: JSON.stringify(ctxFor(over)) });
  assertDeny(mk({ to_delta_ref: 'not-hex' }), 'to_delta_ref-not-hex64');
  assertDeny(mk({ to_delta_ref: 7 }), 'to_delta_ref-not-hex64');
});

// ---- DENY edge_type type/emptiness (F2 - NUMBER-valued is the coercion case) ---------------------
test('non-string / NUMBER-valued / empty edge_type -> deny edge_type-not-nonempty-string (F2 coercion-collision)', () => {
  const goodBasis = basisFor(ctxFor());
  const mk = (over) => B.authorizeRequest({ claimedBasis: goodBasis, presentedCtxRaw: JSON.stringify(ctxFor(over)) });
  // a NUMBER edge_type derives identically to its string form ('5' === 5 through String()): without the
  // strict type gate it would sign a id no store body (which gates edge_type as a string) could carry.
  assertDeny(mk({ edge_type: 5 }), 'edge_type-not-nonempty-string');
  assertDeny(mk({ edge_type: '' }), 'edge_type-not-nonempty-string');
  assertDeny(mk({ edge_type: null }), 'edge_type-not-nonempty-string');
});

test('F9 type-set asymmetry: a DIFFERENT non-empty edge_type string still ALLOWS at the bind (the store gates the set, not the bind)', () => {
  // The bind binds ctx<->basis CONSISTENCY only; it accepts ANY non-empty edge_type string. A
  // 'some-other-type' edge passes the bind (consistent), but is refused at the lab store write/read
  // (WORLD_ANCHOR_EDGE_TYPE = ['world-anchored-by']). bind-ALLOW != persistable edge.
  const ctx = ctxFor({ edge_type: 'some-other-type' });
  const r = call(ctx);
  assert.strictEqual(r.decision, 'allow', 'the bind accepts any non-empty edge_type string (consistency, not set-membership)');
  assert.strictEqual(r.basisToSign, basisFor(ctx));
});

// ---- DENY unparseable / absent ctx --------------------------------------------------------------
test('unparseable / empty / whitespace / absent presentedCtxRaw -> deny with the right reason', () => {
  const goodBasis = basisFor(ctxFor());
  assertDeny(B.authorizeRequest({ claimedBasis: goodBasis, presentedCtxRaw: '{not json' }), 'ctx-unparseable');
  assertDeny(B.authorizeRequest({ claimedBasis: goodBasis, presentedCtxRaw: '   ' }), 'ctx-unparseable'); // whitespace -> JSON.parse throws
  assertDeny(B.authorizeRequest({ claimedBasis: goodBasis, presentedCtxRaw: '' }), 'no-ctx-presented');
  assertDeny(B.authorizeRequest({ claimedBasis: goodBasis, presentedCtxRaw: undefined }), 'no-ctx-presented');
  assertDeny(B.authorizeRequest({ claimedBasis: goodBasis, presentedCtxRaw: 42 }), 'no-ctx-presented'); // non-string
});

// ---- DENY non-object ctx (parses to a non-object) -----------------------------------------------
test('a ctx that parses to a non-object (array / scalar / null) -> deny ctx-not-an-object', () => {
  const goodBasis = basisFor(ctxFor());
  assertDeny(B.authorizeRequest({ claimedBasis: goodBasis, presentedCtxRaw: '[1,2,3]' }), 'ctx-not-an-object');
  assertDeny(B.authorizeRequest({ claimedBasis: goodBasis, presentedCtxRaw: '"scalar"' }), 'ctx-not-an-object');
  assertDeny(B.authorizeRequest({ claimedBasis: goodBasis, presentedCtxRaw: 'null' }), 'ctx-not-an-object');
});

// ---- DENY non-hex claimedBasis (the FIRST gate, before touching ctx) ----------------------------
test('a non-hex claimedBasis -> deny claimed-basis-not-hex64 (the FIRST gate, before parsing ctx)', () => {
  // even with a perfectly valid ctx, a bad claim is rejected before the ctx is touched
  assertDeny(B.authorizeRequest({ claimedBasis: 'not-hex', presentedCtxRaw: JSON.stringify(ctxFor()) }), 'claimed-basis-not-hex64');
  assertDeny(B.authorizeRequest({ claimedBasis: 'A'.repeat(64), presentedCtxRaw: JSON.stringify(ctxFor()) }), 'claimed-basis-not-hex64'); // UPPERCASE
  assertDeny(B.authorizeRequest({ claimedBasis: undefined, presentedCtxRaw: JSON.stringify(ctxFor()) }), 'claimed-basis-not-hex64');
  assertDeny(B.authorizeRequest({ claimedBasis: 5, presentedCtxRaw: JSON.stringify(ctxFor()) }), 'claimed-basis-not-hex64');
});

// ---- validateCtxShape exported + directly exercised ---------------------------------------------
test('validateCtxShape is exported and gates shape/type directly (ok on honest, fails on extra/missing/type)', () => {
  assert.strictEqual(typeof B.validateCtxShape, 'function');
  assert.deepStrictEqual(B.validateCtxShape(ctxFor()), { ok: true });
  assert.strictEqual(B.validateCtxShape(Object.assign(ctxFor(), { EVIL: 1 })).reason, 'ctx-shape-mismatch');
  assert.strictEqual(B.validateCtxShape('not-an-object').reason, 'ctx-not-an-object');
  assert.strictEqual(B.validateCtxShape([1, 2, 3]).reason, 'ctx-not-an-object');
});

test('CTX_KEYS is exported, exactly [from_node_id, to_delta_ref, edge_type], and FROZEN (policy cannot be mutated)', () => {
  assert.deepStrictEqual([...B.CTX_KEYS], ['from_node_id', 'to_delta_ref', 'edge_type']);
  // CodeRabbit Major: an exported MUTABLE policy array is a fail-closed-policy mutation vector (a consumer could
  // push a key -> a 4-key forged ctx then passes the length + every-hasOwnProperty gate). Freeze it.
  assert.strictEqual(Object.isFrozen(B.CTX_KEYS), true, 'CTX_KEYS must be frozen');
  // NON-VACUOUS: a mutation attempt must not widen the policy (a strict-mode push throws on a frozen array).
  assert.throws(() => { B.CTX_KEYS.push('evil'); }, 'pushing to the frozen policy array throws');
  assert.strictEqual(B.CTX_KEYS.length, 3, 'the policy set stays exactly 3 keys after a mutation attempt');
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== loom-edge-bind.test.js: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
})();
