#!/usr/bin/env node
'use strict';

// tests/unit/lab/world-anchor/admit-world-anchor-node.test.js
//
// PR-B B2 - the commitment-gated world-anchor ADMISSION TAG (SHADOW). Verifies admitWorldAnchorNode
// re-verifies PR-A2a STEP 1 (broker_sig, custody-pinned) + STEP 2 (lesson-commitment + approval_hash
// bindings) against the content_hash-SEALED merge-outcome, joined UNIQUELY via deriveJoinKeyId. Real
// ed25519 crypto across the whole quadruple (node + signed edge + attestation + broker-signed outcome) -
// no mocked crypto, no faked stores; mirrors full-arc-capture-flow.test.js's fixture STYLE (LOOM_LAB_STATE_DIR
// pinned before requires, real mkdtemp dirs, node:assert + a light test() runner, [LOOM-EGRESS-ALERT] capture).
//
// The suite IS the behavioral contract (the plan's TDD list): happy path + every refuse token + the
// #273 SHADOW residual (a co-forged self-consistent quadruple ADMITS - integrity+key-possession, NOT
// provenance, proven bounded not assumed) + the OQ3-5 grandfather structural EXCLUDE + the edge-store extract.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Pin the lab-state base to a throwaway dir BEFORE the store modules load (they capture DEFAULT_DIR at require).
process.env.LOOM_LAB_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-test-labstate-b2admit-'));

const REPO = path.join(__dirname, '..', '..', '..', '..');
const { admitWorldAnchorNode } = require(path.join(REPO, 'packages/lab/world-anchor/admit-world-anchor-node.js'));
const { recordAttestation } = require(path.join(REPO, 'packages/lab/world-anchor/world-anchor-store.js'));
const { mintWorldAnchoredNode, readLiveNode } = require(path.join(REPO, 'packages/lab/world-anchor/live-recall-store.js'));
const {
  writeWorldAnchorEdge, loadWorldAnchorEdge,
  authenticatedWorldAnchorEdges, authenticatedWorldAnchorIds,
} = require(path.join(REPO, 'packages/lab/world-anchor/world-anchor-edge-store.js'));
const { recordMergeOutcome } = require(path.join(REPO, 'packages/lab/world-anchor/merge-outcome-store.js'));
const { deriveJoinKeyId } = require(path.join(REPO, 'packages/kernel/egress/join-key-store.js'));
const { computeLessonCommitment } = require(path.join(REPO, 'packages/kernel/_lib/lesson-commitment.js'));
const { approvalSigBasis } = require(path.join(REPO, 'packages/kernel/egress/approval.js'));
const { generateEdgeKeypair, signRecordId, signEdgeId } = require(path.join(REPO, 'packages/kernel/_lib/edge-attestation.js'));

const SELF = typeof process.getuid === 'function' ? process.getuid() : null;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; process.stdout.write(`  PASS ${name}\n`); }
  catch (e) { failed += 1; process.stdout.write(`  FAIL ${name}: ${(e && e.message) || e}\n`); }
}
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-b2admit-')); }
function dirs() {
  const root = tmp();
  return { anchorDir: root, liveDir: path.join(root, 'live'), edgeDir: path.join(root, 'edges'), outcomeDir: path.join(root, 'outcomes') };
}

// Suppress + collect the [LOOM-EGRESS-ALERT] lines every refuse emits (observable), keeping test output clean.
function captureAlerts(fn) {
  const alerts = [];
  const orig = process.stderr.write;
  process.stderr.write = (chunk) => {
    const s = String(chunk);
    if (s.startsWith('[LOOM-EGRESS-ALERT]')) {
      try { alerts.push(JSON.parse(s.slice('[LOOM-EGRESS-ALERT]'.length).trim())); } catch { /* ignore */ }
      return true;
    }
    return true;
  };
  let r;
  try { r = fn(); } finally { process.stderr.write = orig; }
  return { r, alerts };
}

const REPO_SLUG = 'octo/widget';
const BASE = {
  repo: REPO_SLUG, issueRef: 42, pr_number: 77,
  approval_hash: 'd'.repeat(64), diff_hash: 'a'.repeat(64), base_sha: 'f'.repeat(40),
  branch: 'loom/issue-42', built_by: 'anonymous-actor', emitted_at: '2026-06-28T00:00:00.000Z',
  lesson_signature: 'lesson:boundary-contract|unguarded-edge-case|handle-edge-explicitly',
  lesson_body: 'guard the empty-slice edge before indexing (the captured live-solve hypothesis)',
  merge_sha: `${'c0ffee'.repeat(6)}cafe`,   // HEX40
  observed_at: '2026-06-28T12:00:00.000Z',
  approvedAt: 1735430400000, nonce: 'nonce-abc', key_id: 'v0',
};
function prUrl(f) { return `https://github.com/${f.repo}/pull/${f.pr_number}`; }

// Build node + signed edge + attestation (NOT the outcome - writeOutcome does that so tests can poison it).
// `edgeToDelta` overrides the edge's to_delta_ref (for the att<->edge mismatch case). Two keypairs by
// default (edge vs broker are distinct trust anchors) - a test may pass one to share.
function buildBase(d, over = {}) {
  const f = { ...BASE, ...over };
  const kpEdge = over.kpEdge || generateEdgeKeypair();
  const kpBroker = over.kpBroker || generateEdgeKeypair();

  const a = recordAttestation({
    repo: f.repo, issueRef: f.issueRef, pr_url: prUrl(f), pr_number: f.pr_number,
    branch: f.branch, base_sha: f.base_sha, diff_hash: f.diff_hash,
    lesson_signature: f.lesson_signature, built_by: f.built_by,
    approval_hash: f.approval_hash, emitted_at: f.emitted_at,
  }, { dir: d.anchorDir, selfUid: SELF });
  assert.strictEqual(a.ok, true, `attestation lands (${a.reason})`);

  const m = mintWorldAnchoredNode({
    anchor_id: a.anchor_id, merge_sha: f.merge_sha,
    lesson_signature: f.lesson_signature, lesson_body: f.lesson_body,
  }, { dir: d.liveDir, selfUid: SELF });
  assert.strictEqual(m.ok, true, `node mints (${m.reason})`);
  const node = readLiveNode(m.node_id, { dir: d.liveDir, selfUid: SELF });
  assert.ok(node, 'node readable');

  const toDelta = over.edgeToDelta || f.approval_hash;
  const w = writeWorldAnchorEdge({
    from_node_id: m.node_id, to_delta_ref: toDelta,
    edge_type: 'world-anchored-by', recorded_at: f.observed_at,
  }, { signer: (id) => signEdgeId(id, { privateKeyPem: kpEdge.privateKeyPem }), dir: d.edgeDir, selfUid: SELF });
  assert.strictEqual(w.ok, true, `edge mints (${w.reason})`);
  const signedEdge = loadWorldAnchorEdge(w.edge_id, { dir: d.edgeDir, selfUid: SELF });
  assert.ok(signedEdge && signedEdge.edge_sig, 'signed edge readable + carries a sig');

  const lc = computeLessonCommitment({ lesson_signature: f.lesson_signature, lesson_body: f.lesson_body });
  return { node, node_id: m.node_id, anchor_id: a.anchor_id, signedEdge, kpEdge, kpBroker, lc, f };
}

// Write a merge-outcome. Defaults produce the CONSISTENT record B2 admits. Overrides poison one field:
//   filenameLc  - the lesson_commitment folded into the STORED filename jkid (default the node's real lc)
//   sealLc      - the lesson_commitment FIELD sealed in the body (default filenameLc)
//   sealApproval- the approval_hash FIELD sealed (default f.approval_hash)
//   sigLc/sigHash - the (lesson_commitment, hash) the broker_sig actually signs (default the sealed values)
//   brokerKp    - the key that signs (default q.kpBroker)
function writeOutcome(d, q, over = {}) {
  const filenameLc = over.filenameLc !== undefined ? over.filenameLc : q.lc;
  const sealLc = over.sealLc !== undefined ? over.sealLc : filenameLc;
  const sealApproval = over.sealApproval !== undefined ? over.sealApproval : q.f.approval_hash;
  const sigLc = over.sigLc !== undefined ? over.sigLc : sealLc;
  const sigHash = over.sigHash !== undefined ? over.sigHash : sealApproval;
  const brokerKp = over.brokerKp || q.kpBroker;

  const jkid = deriveJoinKeyId({
    repo: q.f.repo, issueRef: q.f.issueRef, pr_number: q.f.pr_number,
    approval_hash: q.f.approval_hash, lesson_commitment: filenameLc,
  });
  const basis = approvalSigBasis({ hash: sigHash, approvedAt: q.f.approvedAt, nonce: q.f.nonce, key_id: q.f.key_id, lesson_commitment: sigLc });
  const broker_sig = over.broker_sig !== undefined ? over.broker_sig : signRecordId(basis, { privateKeyPem: brokerKp.privateKeyPem });
  assert.ok(broker_sig, 'broker_sig minted');

  const o = recordMergeOutcome({
    join_key_id: jkid, repo: q.f.repo, pr_number: q.f.pr_number, pr_url: prUrl(q.f),
    approval_hash: sealApproval, outcome: 'merged', merge_commit_sha: q.f.merge_sha, observed_at: q.f.observed_at,
    lesson_commitment: sealLc, approvedAt: q.f.approvedAt, nonce: q.f.nonce, key_id: q.f.key_id, broker_sig,
  }, { dir: d.outcomeDir, selfUid: SELF });
  assert.strictEqual(o.ok, true, `merge-outcome lands (${o.reason})`);
  return jkid;
}

function admitOpts(d, q, over = {}) {
  return {
    edges: [q.signedEdge], edgeVerifyKey: q.kpEdge.publicKeyPem, brokerVerifyKey: q.kpBroker.publicKeyPem,
    anchorDir: d.anchorDir, outcomeDir: d.outcomeDir, selfUid: SELF, ...over,
  };
}
function admit(d, q, over = {}) { return captureAlerts(() => admitWorldAnchorNode(q.node, admitOpts(d, q, over))); }

// === 1. HAPPY PATH (two distinct keypairs - the split trust anchors) ===
test('happy path (distinct edge + broker keys) -> admitted, world-anchor, commitment_verified', () => {
  const d = dirs();
  const q = buildBase(d);
  writeOutcome(d, q);
  const { r } = admit(d, q);
  assert.deepStrictEqual(r, { admitted: true, source: 'world-anchor', commitment_verified: true });
});

test('happy path (edge + broker SHARE one key) -> admitted (single-key topology also works)', () => {
  const d = dirs();
  const kp = generateEdgeKeypair();
  const q = buildBase(d, { kpEdge: kp, kpBroker: kp });
  writeOutcome(d, q);
  const { r } = admit(d, q);
  assert.strictEqual(r.admitted, true);
  assert.strictEqual(r.commitment_verified, true);
});

// === 2. STEP 1 (broker_sig) failures ===
test('STEP 1: wrong brokerVerifyKey -> broker-sig-invalid, not admitted + emit', () => {
  const d = dirs();
  const q = buildBase(d);
  writeOutcome(d, q);
  const { r, alerts } = admit(d, q, { brokerVerifyKey: generateEdgeKeypair().publicKeyPem });
  assert.strictEqual(r.admitted, false);
  assert.strictEqual(r.reason, 'broker-sig-invalid');
  assert.ok(alerts.some((a) => a.reason === 'world-anchor-admit-broker-sig-invalid'), 'emits the refuse');
});

test('STEP 1: garbage-PEM brokerVerifyKey (present-but-malformed) -> engages + fails closed broker-sig-invalid', () => {
  const d = dirs();
  const q = buildBase(d);
  writeOutcome(d, q);
  const { r } = admit(d, q, { brokerVerifyKey: 'not-a-pem-but-non-empty' });
  assert.strictEqual(r.admitted, false);
  assert.strictEqual(r.reason, 'broker-sig-invalid');
});

// === 3. STEP 2 (body bindings) failures - the OPAQUE-jkid plant ===
test('STEP 2: outcome sealed lesson_commitment != node-body lc (opaque plant) -> lesson-commitment-mismatch', () => {
  const d = dirs();
  const q = buildBase(d);
  // Store at the CORRECT (node-lc) filename jkid so B2 loads it, but seal a DIFFERENT lesson_commitment
  // and sign the broker_sig over THAT (so STEP 1 passes and STEP 2 is the one that catches it).
  writeOutcome(d, q, { sealLc: 'b'.repeat(64) });
  const { r } = admit(d, q);
  assert.strictEqual(r.admitted, false);
  assert.strictEqual(r.reason, 'lesson-commitment-mismatch');
});

test('STEP 2: outcome sealed approval_hash != edge to_delta_ref -> approval-hash-mismatch', () => {
  const d = dirs();
  const q = buildBase(d);
  writeOutcome(d, q, { sealApproval: 'e'.repeat(64) });   // broker_sig signs over 'e'*64 too (sigHash default), so STEP 1 passes
  const { r } = admit(d, q);
  assert.strictEqual(r.admitted, false);
  assert.strictEqual(r.reason, 'approval-hash-mismatch');
});

// === 4. att<->edge cross-bind ===
test('att.approval_hash != edge.to_delta_ref -> att-edge-approval-mismatch', () => {
  const d = dirs();
  const q = buildBase(d, { edgeToDelta: 'e'.repeat(64) });   // edge points elsewhere than the attestation's approval_hash
  writeOutcome(d, q);
  const { r } = admit(d, q);
  assert.strictEqual(r.admitted, false);
  assert.strictEqual(r.reason, 'att-edge-approval-mismatch');
});

// === 5. membership (EXACT-ONE) ===
test('no authenticated edge for the node -> no-authenticated-edge', () => {
  const d = dirs();
  const q = buildBase(d);
  writeOutcome(d, q);
  const { r } = admit(d, q, { edges: [] });
  assert.strictEqual(r.reason, 'no-authenticated-edge');
});

test('an UNSIGNED edge is not authenticated -> no-authenticated-edge (not laundered)', () => {
  const d = dirs();
  const q = buildBase(d);
  writeOutcome(d, q);
  const unsigned = { ...q.signedEdge };
  delete unsigned.edge_sig; delete unsigned.sig_alg;
  const { r } = admit(d, q, { edges: [unsigned] });
  assert.strictEqual(r.reason, 'no-authenticated-edge');
});

test('two valid signed edges for one node -> ambiguous-edge (exact-one, never first-wins)', () => {
  const d = dirs();
  const q = buildBase(d);
  writeOutcome(d, q);
  // a SECOND valid signed edge from the same node to a different delta-ref (same edge signer)
  const w2 = writeWorldAnchorEdge({
    from_node_id: q.node_id, to_delta_ref: '9'.repeat(64), edge_type: 'world-anchored-by', recorded_at: q.f.observed_at,
  }, { signer: (id) => signEdgeId(id, { privateKeyPem: q.kpEdge.privateKeyPem }), dir: d.edgeDir, selfUid: SELF });
  assert.strictEqual(w2.ok, true);
  const edge2 = loadWorldAnchorEdge(w2.edge_id, { dir: d.edgeDir, selfUid: SELF });
  const { r } = admit(d, q, { edges: [q.signedEdge, edge2] });
  assert.strictEqual(r.reason, 'ambiguous-edge');
});

// === 6. merge-outcome absence + the OQ3-5 grandfather structural EXCLUDE ===
test('no merge-outcome recorded -> no-merge-outcome', () => {
  const d = dirs();
  const q = buildBase(d);   // no writeOutcome
  const { r } = admit(d, q);
  assert.strictEqual(r.reason, 'no-merge-outcome');
});

test("OQ3-5 grandfather EXCLUDE: an outcome sealed lesson_commitment='' sits at the ''-jkid; the node's non-empty lc yields a different jkid -> no-merge-outcome (no '' fallback)", () => {
  const d = dirs();
  const q = buildBase(d);
  // The grandfather outcome is stored at deriveJoinKeyId({..., lesson_commitment:''}) - a DIFFERENT filename
  // than B2's computed jkid (which uses the node's real non-empty lc). B2 must NOT find it.
  writeOutcome(d, q, { filenameLc: '', sealLc: '', sigLc: '' });
  const { r } = admit(d, q);
  assert.strictEqual(r.admitted, false);
  assert.strictEqual(r.reason, 'no-merge-outcome');
});

// === 7. att-tuple-mismatch (forging the attestation to a different PR doesn't launder a real outcome) ===
test('node.anchor_id -> a DIFFERENT (pr_number) attestation than the recorded outcome -> no-merge-outcome', () => {
  const d = dirs();
  const qReal = buildBase(d);            // pr 77, node-A, outcome at jkid-A
  writeOutcome(d, qReal);
  // pr 88, node-B on a DISTINCT attestation (a different PR has a different diff -> different anchor_id,
  // since pr_number is not in the anchor_id basis); NO outcome at jkid-B.
  const qOther = buildBase(d, { pr_number: 88, diff_hash: 'b'.repeat(64) });
  const { r } = admit(d, qOther);
  assert.strictEqual(r.reason, 'no-merge-outcome');
});

// === 8. env-blind (both keys required) ===
for (const [label, over] of [
  ['edgeVerifyKey empty', { edgeVerifyKey: '' }],
  ['brokerVerifyKey empty', { brokerVerifyKey: '' }],
  ['edgeVerifyKey missing', { edgeVerifyKey: undefined }],
  ['brokerVerifyKey missing', { brokerVerifyKey: undefined }],
]) {
  test(`env-blind: ${label} -> no-verify-key (never accept-all)`, () => {
    const d = dirs();
    const q = buildBase(d);
    writeOutcome(d, q);
    const { r } = admit(d, q, over);
    assert.strictEqual(r.admitted, false);
    assert.strictEqual(r.reason, 'no-verify-key');
  });
}

// === 9. selfUid fail-closed ===
test('selfUid:null -> no-uid (never admit with the foreign-owned reject disabled)', () => {
  const d = dirs();
  const q = buildBase(d);
  writeOutcome(d, q);
  const { r } = admit(d, q, { selfUid: null });
  assert.strictEqual(r.admitted, false);
  assert.strictEqual(r.reason, 'no-uid');
});

// === 10. fail-closed totality (an adversarial getter -> outer catch -> admit-error, never throws) ===
test('adversarial getter on the node -> caught -> admit-error, source mock (never throws)', () => {
  const d = dirs();
  const q = buildBase(d);
  writeOutcome(d, q);
  const evilNode = { get node_id() { throw new Error('boom'); } };
  const { r } = captureAlerts(() => admitWorldAnchorNode(evilNode, admitOpts(d, q)));
  assert.strictEqual(r.admitted, false);
  assert.strictEqual(r.source, 'mock');
  assert.strictEqual(r.reason, 'admit-error');
});

test('bad node (null / not-an-object / missing fields) -> bad-node', () => {
  const d = dirs();
  const q = buildBase(d);
  writeOutcome(d, q);
  for (const bad of [null, 42, [], {}, { node_id: 'x' }]) {
    const { r } = captureAlerts(() => admitWorldAnchorNode(bad, admitOpts(d, q)));
    assert.strictEqual(r.reason, 'bad-node', `bad node ${JSON.stringify(bad)}`);
  }
});

// === 11. #273 SHADOW residual - asserted, not assumed ===
test('#273 residual: a fully self-consistent CO-FORGED quadruple ADMITS (integrity+key-possession, NOT provenance; SHADOW-tolerable)', () => {
  const d = dirs();
  // Every key + record here is TEST(attacker)-generated - from the store's view this IS the same-uid
  // co-forge. It admits commitment_verified:true. That is the DOCUMENTED residual: B2 proves integrity +
  // key-possession, never provenance. The close is B5 arming on the DEPLOYED cross-uid broker, not B2.
  const q = buildBase(d);
  writeOutcome(d, q);
  const { r } = admit(d, q);
  assert.strictEqual(r.admitted, true, 'the co-forged-but-self-consistent quadruple admits (the honest residual)');
});

// === 12. exact-set: a poison edge in the array does not launder membership ===
test('exact-set: [realSignedEdge, unsignedPoison] -> still admits (poison ignored, not laundered)', () => {
  const d = dirs();
  const q = buildBase(d);
  writeOutcome(d, q);
  const poison = { edge_id: '1'.repeat(64), from_node_id: q.node_id, to_delta_ref: '2'.repeat(64), edge_type: 'world-anchored-by', recorded_at: q.f.observed_at };
  const { r } = admit(d, q, { edges: [q.signedEdge, poison] });
  assert.strictEqual(r.admitted, true);
});

// === 13. edge-store extract (behavior-preserving; the Set delegates to the edge form) ===
test('edge-store extract: authenticatedWorldAnchorEdges returns the verified edge; Ids delegates to a Set of from_node_id', () => {
  const d = dirs();
  const q = buildBase(d);
  const edgesOut = authenticatedWorldAnchorEdges([q.signedEdge], { verifyKey: q.kpEdge.publicKeyPem });
  assert.strictEqual(edgesOut.length, 1, 'the one verified edge');
  assert.strictEqual(edgesOut[0].from_node_id, q.node_id);
  const ids = authenticatedWorldAnchorIds([q.signedEdge], { verifyKey: q.kpEdge.publicKeyPem });
  assert.ok(ids instanceof Set && ids.has(q.node_id) && ids.size === 1, 'Ids is a Set of from_node_ids');
  // fail-closed: empty key -> empty for BOTH forms
  assert.strictEqual(authenticatedWorldAnchorEdges([q.signedEdge], { verifyKey: '' }).length, 0);
  assert.strictEqual(authenticatedWorldAnchorIds([q.signedEdge], { verifyKey: '' }).size, 0);
});

process.stdout.write(`\n=== admit-world-anchor-node: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
