#!/usr/bin/env node

// tests/unit/lab/causal-edge/item-source.test.js
//
// v-next MV-W3a — deriveItemSource maps a lesson node to its trust-weight SOURCE by membership in the C-W1
// authenticatedEdgeIds (ed25519-signed) lane. THE AUTHORIZATION SEAM: signed -> 'signed-lane' (the admitted
// token the MV-W2 weight-source-gate keys on); else / keyless / forged -> 'mock' (FAIL-CLOSED). This is the
// one net-new piece MV-W2's VALIDATE flagged plausible-but-unverified; proving the source-DERIVATION seam
// responds to signed provenance (the source is now DERIVED, not a caller string). The END-TO-END discharge of
// "a real signal needs zero new machinery" (source -> buildRankingWeights -> retriever) is the W3d rig.
// MECHANICS not TRUST (OQ-NS-6): deriving the source proves the wire RESPONDS to signed provenance; it never
// asserts trust. opts-ONLY + ENV-BLIND: a missing key -> 'mock' even with LOOM_EDGE_VERIFY_KEY set. CI-safe.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const REPO = path.join(__dirname, '..', '..', '..', '..');
const { deriveItemSource, SIGNED_LANE_SOURCE, MOCK_SOURCE } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'item-source.js'));
const { writeEdge, listEdges } = require(path.join(REPO, 'packages', 'lab', 'attribution', 'recall-edge-store.js'));
const { generateEdgeKeypair, signEdgeId } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'edge-attestation.js'));
const { SOURCE_MOCK } = require(path.join(REPO, 'packages', 'lab', 'persona-consumer', 'hardening-signal-store.js'));

// Hermetic (the C-W1 lesson): never let an ambient key flip the lane.
delete process.env.LOOM_EDGE_SIGNING_KEY;
delete process.env.LOOM_EDGE_VERIFY_KEY;

const NODE = 'a'.repeat(64);
const KEYS = generateEdgeKeypair();   // throwaway test keypair, injected via opts (NEVER env)

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-itemsrc-')); }
function signedEdges(dir, fromNode = NODE) {
  writeEdge(
    { from_node_id: fromNode, to_delta_ref: 'b'.repeat(64), edge_type: 'confirmed-by', fail_to_pass: ['t_a'], recorded_at: '2026-06-16T00:00:00.000Z' },
    { dir, signer: (id) => signEdgeId(id, { privateKeyPem: KEYS.privateKeyPem }) },
  );
  return listEdges({ dir });
}
function unsignedEdges(dir, fromNode = NODE) {
  writeEdge({ from_node_id: fromNode, to_delta_ref: 'b'.repeat(64), edge_type: 'confirmed-by', fail_to_pass: ['t_a'], recorded_at: '2026-06-16T00:00:00.000Z' }, { dir });
  return listEdges({ dir });
}

let passed = 0; let failed = 0;
const _tests = [];
function test(name, fn) { _tests.push({ name, fn }); }

test('a node in the SIGNED lane (valid sig + verify key) -> signed-lane', () => {
  assert.strictEqual(deriveItemSource(NODE, signedEdges(tmp()), { verifyKey: KEYS.publicKeyPem }), SIGNED_LANE_SOURCE);
});

test('accepts a node OBJECT ({node_id}) as well as a bare id', () => {
  assert.strictEqual(deriveItemSource({ node_id: NODE }, signedEdges(tmp()), { verifyKey: KEYS.publicKeyPem }), SIGNED_LANE_SOURCE);
});

test('NO verify key -> mock (fail-closed; the keyless-prod firewall — the real path stays keyless)', () => {
  assert.strictEqual(deriveItemSource(NODE, signedEdges(tmp()), {}), MOCK_SOURCE);
});

test('ENV-BLIND (VALIDATE HIGH): a keyless call -> mock EVEN WHEN LOOM_EDGE_VERIFY_KEY is set in env', () => {
  const edges = signedEdges(tmp());
  process.env.LOOM_EDGE_VERIFY_KEY = KEYS.publicKeyPem;   // an ambient key the delegate would otherwise pick up
  try {
    assert.strictEqual(deriveItemSource(NODE, edges, {}), MOCK_SOURCE, 'no opts.verifyKey + env set must NOT admit');
    assert.strictEqual(deriveItemSource(NODE, edges), MOCK_SOURCE, 'no opts at all + env set must NOT admit');
    // ...but an EXPLICIT opts key still works (the guard is opts-only, not opts-broken):
    assert.strictEqual(deriveItemSource(NODE, edges, { verifyKey: KEYS.publicKeyPem }), SIGNED_LANE_SOURCE);
  } finally { delete process.env.LOOM_EDGE_VERIFY_KEY; }
});

test('an UNSIGNED (co-forgeable) edge -> mock (the lane requires a valid signature, not mere existence)', () => {
  assert.strictEqual(deriveItemSource(NODE, unsignedEdges(tmp()), { verifyKey: KEYS.publicKeyPem }), MOCK_SOURCE);
});

test('a node with NO edge -> mock', () => {
  assert.strictEqual(deriveItemSource('c'.repeat(64), signedEdges(tmp()), { verifyKey: KEYS.publicKeyPem }), MOCK_SOURCE);
});

test('REPLAY FORGE: a valid {edge_id,edge_sig} pair with a SWAPPED from_node_id -> mock (#273; re-derive rejects)', () => {
  const real = signedEdges(tmp())[0];                       // a genuinely-signed edge for NODE
  const forged = { ...real, from_node_id: 'd'.repeat(64) }; // keep the signature, swap the subject
  assert.strictEqual(deriveItemSource('d'.repeat(64), [forged], { verifyKey: KEYS.publicKeyPem }), MOCK_SOURCE);
  // discriminating power (honesty LOW): the GENUINE subject still passes under the SAME key + edge — proving
  // the rejection is specific to the swap, not a blanket-deny from a misconfigured key.
  assert.strictEqual(deriveItemSource(NODE, [real], { verifyKey: KEYS.publicKeyPem }), SIGNED_LANE_SOURCE);
});

test('a WRONG verify key -> mock (the signature does not verify under it)', () => {
  const other = generateEdgeKeypair();
  assert.strictEqual(deriveItemSource(NODE, signedEdges(tmp()), { verifyKey: other.publicKeyPem }), MOCK_SOURCE);
});

test('malformed inputs never throw -> mock (incl. a bare Array node + an adversarial throwing getter)', () => {
  assert.doesNotThrow(() => deriveItemSource(null, null, null));
  assert.strictEqual(deriveItemSource(null, null, null), MOCK_SOURCE);
  assert.strictEqual(deriveItemSource({}, [], {}), MOCK_SOURCE);
  assert.strictEqual(deriveItemSource(NODE, 'not-an-array', { verifyKey: KEYS.publicKeyPem }), MOCK_SOURCE);
  // an Array node must not reach .node_id (explicit !Array.isArray guard):
  assert.strictEqual(deriveItemSource([], signedEdges(tmp()), { verifyKey: KEYS.publicKeyPem }), MOCK_SOURCE);
  // never-throws against an adversarial property getter (auth-class fails CLOSED, not open):
  const boobyNode = Object.defineProperty({}, 'node_id', { get() { throw new Error('boom'); } });
  assert.doesNotThrow(() => deriveItemSource(boobyNode, [], { verifyKey: KEYS.publicKeyPem }));
  assert.strictEqual(deriveItemSource(boobyNode, [], { verifyKey: KEYS.publicKeyPem }), MOCK_SOURCE);
});

test('the signed-lane token is distinct from mock AND from the persona-track verdict-attestation marker', () => {
  assert.notStrictEqual(SIGNED_LANE_SOURCE, MOCK_SOURCE);
  assert.notStrictEqual(SIGNED_LANE_SOURCE, 'verdict-attestation');
});

test("MOCK_SOURCE agrees with hardening-signal-store's SOURCE_MOCK (catch a future cross-module token drift)", () => {
  assert.strictEqual(MOCK_SOURCE, SOURCE_MOCK, "the 'mock' lane token must match across modules");
});

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && e.message}`); }
  }
  console.log(`\nitem-source: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
