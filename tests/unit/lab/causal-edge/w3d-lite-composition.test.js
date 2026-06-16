#!/usr/bin/env node

// tests/unit/lab/causal-edge/w3d-lite-composition.test.js
//
// v-next MV-W3d-lite — the LIGHT composition capstone. Proves the FULL chain composes END-TO-END in
// ISOLATION with the source DERIVED (not injected):
//
//   signed edge -> deriveItemSource -> 'signed-lane'      (W3a, the derivation seam)
//   signed edge -> evaluateHardenGate ADMISSION + SYNTHETIC arm counts -> HARDEN   (MV-W1, the verdict)
//   { verdict: HARDEN, source: 'signed-lane' } -> buildRankingWeights -> { sig: 1 }   (MV-W2, the firewall)
//   weights -> the ACTUAL retrieveBySignature -> the ranking FLIPS to the signed lesson
//
// ...and the NEGATIVE: an UNSIGNED lesson -> 'mock' -> gated to 0 -> INERT (no flip). This discharges
// "a real signal needs zero new machinery" END-TO-END (W3a proved only the derivation half).
//
// NOTE (honesty): the signed edge gates the verdict's ADMISSION (nodeId in authenticatedEdgeIds) and the
// derived source; the HARDEN-vs-WITHHOLD MAGNITUDE is driven by SYNTHETIC arm counts — there is NO forge
// poller this wave (the forge->armCounts link is W3b, DEFERRED to beta-time). MECHANICS not TRUST
// (OQ-NS-6): this is COMPOSITION EVIDENCE (the seams interlock, once, on synthetic counts); it NARROWS, it
// hardens NO trust.
//
// ISOLATION (the corrected firewall, light subset — no new stores): every store write threads an EXPLICIT
// temp `dir` (sidesteps the env-capture CRIT); the verify/signing key is an EPHEMERAL keypair injected via
// opts ONLY (never env); the WHOLE real ~/.claude/lab-state tree is digested before + asserted byte-unchanged
// after (name+size, all stores — not just recall-edge); the temp root is rm -rf BURNED in a finally and the
// isolation assertion runs INSIDE the finally (so a breach is caught even when another assertion fails).
// CI-safe (temp dirs; no network/LLM).

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const REPO = path.join(__dirname, '..', '..', '..', '..');

// Hermetic, BEFORE any lab require (CodeRabbit #339: env-cleanup before env-sensitive imports). NOTE: the
// LOOM_EDGE_* reads are actually call-time (edge-attestation loadPublicKey/loadPrivateKey) and
// deriveItemSource / evaluateHardenGate are env-blind (opts-only), so this is DEFENSIVE hygiene, not a
// live-bug fix — but cleaning before requires future-proofs against a module that captures at require-time.
delete process.env.LOOM_EDGE_SIGNING_KEY;
delete process.env.LOOM_EDGE_VERIFY_KEY;

const { deriveItemSource, SIGNED_LANE_SOURCE, MOCK_SOURCE } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'item-source.js'));
const { evaluateHardenGate, VERDICT } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'lesson-merge-lift.js'));
const { buildRankingWeights } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'weight-source-gate.js'));
const { retrieveBySignature } = require(path.join(REPO, 'packages', 'lab', 'attribution', '_spike', 'retrieve-signature.js'));
const { writeEdge, listEdges, DEFAULT_DIR: REAL_EDGE_DIR } = require(path.join(REPO, 'packages', 'lab', 'attribution', 'recall-edge-store.js'));
const { buildWorkedExampleNode } = require(path.join(REPO, 'packages', 'lab', 'attribution', 'recall-graph.js'));
const { generateEdgeKeypair, signEdgeId } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'edge-attestation.js'));

const KEYS = generateEdgeKeypair();            // EPHEMERAL throwaway keypair, injected via opts ONLY
const FLOOR = 20;
const TRIG = 'boundary-contract';
const LAB_STATE_BASE = path.dirname(REAL_EDGE_DIR);   // the real ~/.claude/lab-state root (all stores live under it)

// two valid same-trigger lesson nodes with DISTINCT signatures (different gotcha) so a per-signature weight
// can target exactly one (mirrors retrieve-signature.test.js + weight-source-gate.test.js).
function vnode({ issue, candidateRef, gotcha }) {
  return buildWorkedExampleNode(
    { reference: { issue_id: issue, repo: 'octo/x', problem_statement_digest: 'd', candidate_patch_ref: candidateRef, behavioral_verdict: 'BEHAVIORAL_PASS', reference_divergence: 0.1, contamination_tier: 'clean' }, resolution_friction: null },
    { lesson: { trigger_class: TRIG, gotcha_class: gotcha, corrective_class: 'fail-closed', lesson_body: 'x' }, accepted_diff_ref: 'a'.repeat(64), candidate_patch_sha: 'b'.repeat(64), fail_to_pass: ['t'] },
  );
}
// a SIGNED confirmed-by edge for `nodeId` written to an explicit temp `dir`, read back normalized.
function signedEdgeFor(nodeId, dir) {
  writeEdge(
    { from_node_id: nodeId, to_delta_ref: 'c'.repeat(64), edge_type: 'confirmed-by', fail_to_pass: ['t_a'], recorded_at: '2026-06-16T00:00:00.000Z' },
    { dir, signer: (id) => signEdgeId(id, { privateKeyPem: KEYS.privateKeyPem }) },
  );
  return listEdges({ dir });
}
// a qualifying gate input (the MV-W1 shape). lessonSignature/placeboSignature are the REAL node signatures
// (code-reviewer HIGH: not stale hardcoded tokens) so the placebo-independence arm runs on coherent input.
function gateOpts(nodeId, lessonSignature, placeboSignature) {
  return {
    verifyKey: KEYS.publicKeyPem, nodeId,
    maintainers: ['alice', 'bob'], selfDenylist: new Set(['loom-bot']), avoided: true,
    lessonSignature, placeboSignature,
  };
}
const QUAL_ARMS = { treatment: { merged: 19, n: FLOOR }, control: { merged: 2, n: FLOOR }, placebo: { merged: 3, n: FLOOR } };

// digest the WHOLE real lab-state tree as sorted "relpath:sha256(content)" — TRUE byte-integrity (CodeRabbit
// #339: a relpath:size digest would MISS a same-size in-place overwrite). Catches an add OR a content
// overwrite in ANY store, not just recall-edge. Absent base -> [] (env-dependent baseline; the delta is what matters).
function digestLabState() {
  const out = [];
  const walk = (dir, rel) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries.slice().sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(full, r); continue; }
      let hash = 'ERR';
      try { hash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex'); } catch { hash = 'ERR'; }
      out.push(`${r}:${hash}`);
    }
  };
  walk(LAB_STATE_BASE, '');
  return out;
}

let passed = 0; let failed = 0;
const _tests = [];
function test(name, fn) { _tests.push({ name, fn }); }

test('END-TO-END (isolated): a SIGNED lesson composes derivation->verdict->weight->retriever FLIP; UNSIGNED is INERT', () => {
  const realBefore = digestLabState();
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-w3dlite-'));
  const edgeDir = path.join(tmpRoot, 'recall-edge');
  try {
    const A = vnode({ issue: 'octo/x__a', candidateRef: 'cafef00d0001', gotcha: 'unguarded-edge-case' });
    const B = vnode({ issue: 'octo/x__b', candidateRef: 'cafef00d0002', gotcha: 'silent-coercion' });
    const NODES = [A, B];
    const query = { repo: 'octo/x', trigger_class: TRIG };
    // equal-score tie precondition: WITHOUT a weight the node_id tiebreak decides; target = the OTHER node,
    // so a weight on it must FLIP the top (the weight axis is what is exercised).
    const baseTop = retrieveBySignature(query, NODES).top.node;
    const target = baseTop.node_id === A.node_id ? B : A;

    // --- the SIGNED path: full chain, source DERIVED ---
    const signed = signedEdgeFor(target.node_id, edgeDir);                 // explicit temp dir
    const source = deriveItemSource(target, signed, { verifyKey: KEYS.publicKeyPem });
    assert.strictEqual(source, SIGNED_LANE_SOURCE, 'a signed lesson derives the signed-lane source');
    // admission gated by the signed edge; HARDEN magnitude from SYNTHETIC arm counts (no forge poller this wave).
    const gate = evaluateHardenGate(QUAL_ARMS, signed, gateOpts(target.node_id, target.lesson_signature, baseTop.lesson_signature));
    assert.strictEqual(gate.verdict, VERDICT.HARDEN, 'the qualifying signed input HARDENs');
    const weights = buildRankingWeights(
      [{ lesson_signature: target.lesson_signature, verdict: gate.verdict, source }],
      { liveSources: new Set([SIGNED_LANE_SOURCE]) },                      // the rig's INJECTED allow-set
    );
    assert.strictEqual(weights[target.lesson_signature], 1, 'the derived source + HARDEN verdict admits a positive weight');
    const flippedTop = retrieveBySignature(query, NODES, { weights }).top.node;
    assert.strictEqual(flippedTop.node_id, target.node_id, 'the composed weight FLIPS the ranking to the signed lesson');
    assert.notStrictEqual(flippedTop.node_id, baseTop.node_id, 'a genuine flip vs the no-weights baseline');

    // --- the NEGATIVE: an UNSIGNED lesson -> mock -> inert ---
    const unsignedSource = deriveItemSource(target, [], { verifyKey: KEYS.publicKeyPem });
    assert.strictEqual(unsignedSource, MOCK_SOURCE, 'an unsigned lesson derives mock');
    const inertWeights = buildRankingWeights(
      [{ lesson_signature: target.lesson_signature, verdict: VERDICT.HARDEN, source: unsignedSource }],
      { liveSources: new Set([SIGNED_LANE_SOURCE]) },                      // mock is NOT in the allow-set
    );
    assert.deepStrictEqual({ ...inertWeights }, {}, 'a mock-sourced lesson admits NO weight (even with a HARDEN verdict)');
    const inertTop = retrieveBySignature(query, NODES, { weights: inertWeights }).top.node;
    assert.strictEqual(inertTop.node_id, baseTop.node_id, 'the mock lesson is INERT — ranking unchanged vs baseline');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });                 // BURN the ephemeral root
    // ISOLATION asserted INSIDE the finally (code-reviewer MED): runs even when an inner assertion failed —
    // exactly when a real-dir breach would otherwise go unnoticed.
    assert.deepStrictEqual(digestLabState(), realBefore, 'the REAL lab-state tree must be untouched by the isolated rig');
  }
});

test('BURN is complete: the ephemeral temp root no longer exists after the run; real lab-state untouched', () => {
  const realBefore = digestLabState();
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-w3dlite-burn-'));
  const edgeDir = path.join(tmpRoot, 'recall-edge');
  try {
    signedEdgeFor('a'.repeat(64), edgeDir);
    assert.ok(fs.existsSync(edgeDir), 'the rig wrote into the temp dir');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    assert.strictEqual(fs.existsSync(tmpRoot), false, 'the temp root is gone after burn');
    assert.deepStrictEqual(digestLabState(), realBefore, 'and the real lab-state tree is still untouched');
  }
});

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && e.message}`); }
  }
  console.log(`\nw3d-lite-composition: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
