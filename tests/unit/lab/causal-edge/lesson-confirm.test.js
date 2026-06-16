#!/usr/bin/env node

// tests/unit/lab/causal-edge/lesson-confirm.test.js
//
// v3.11 W2 — the confirmation gate + lane + confirm pass (the RED set), incl. the EXIT-PROOF
// (a lesson provably cannot enter the predictor lane without a same-requirement confirming delta
// sourced from a VERIFIED run, GIVEN store integrity). Evidence-backed: the requirement is the
// CORPUS truth (a tampered node OR a forged attempt cannot soften it); the verdict is the real
// behavioral_verdict (never a caller `passed`). Persona-agnostic. CI-safe (no LLM/sandbox).

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const { sameRequirement, confirmsLesson, confirmedNodeIds, authenticatedEdgeIds, canEnterPredictorLane, runConfirmationPass } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'lesson-confirm.js'));
const { buildWorkedExampleNode } = require(path.join(REPO, 'packages', 'lab', 'attribution', 'recall-graph.js'));
const { listEdges, writeEdge, loadEdge } = require(path.join(REPO, 'packages', 'lab', 'attribution', 'recall-edge-store.js'));
const { sidecarSha, readCandidate } = require(path.join(REPO, 'packages', 'lab', 'attribution', 'candidate-sidecar.js'));
const { generateEdgeKeypair, signEdgeId } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'edge-attestation.js'));

// Hermetic (CodeRabbit #335): the authenticatedEdgeIds fail-closed assertions (opts `{}`) assume NO
// ambient LOOM_EDGE_VERIFY_KEY. Each test file runs in its own node process -> a file-wide delete is isolated.
delete process.env.LOOM_EDGE_SIGNING_KEY;
delete process.env.LOOM_EDGE_VERIFY_KEY;

let passed = 0; let failed = 0;
const _tests = [];
function test(name, fn) { _tests.push({ name, fn }); }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-confirm-')); }

const NODE_PATCH = 'diff --git a/f.py b/f.py\n+    the node candidate\n';
const CONFIRM_PATCH = 'diff --git a/f.py b/f.py\n+    a DIFFERENT independent fix\n';
const ACCEPTED_REF = 'a'.repeat(64);
const FTP = ['t_zero', 't_neg'];          // the corpus-canonical requirement (the trusted source)

function node(over = {}) {
  return buildWorkedExampleNode(
    { id: 'octo__w1', attempt_index: 0, recall_eligible: true, resolution_friction: null,
      reference: { issue_id: over.issue_id || 'octo__w1', repo: 'octo/w', problem_statement_digest: 'd', candidate_patch_ref: 'x', behavioral_verdict: 'BEHAVIORAL_PASS', reference_divergence: 0.2, contamination_tier: 'clean' } },
    { lesson: { trigger_class: 'boundary-contract', gotcha_class: 'unguarded-edge-case', corrective_class: 'fail-closed', lesson_body: 'b' },
      accepted_diff_ref: ACCEPTED_REF, candidate_patch_sha: sidecarSha(NODE_PATCH), fail_to_pass: over.fail_to_pass || FTP });
}
function attempt(over = {}) {
  return { issue_id: 'octo__w1', fail_to_pass: FTP, candidate_patch: CONFIRM_PATCH, behavioral_verdict: 'BEHAVIORAL_PASS', ...over };
}
function bareNode() {
  return buildWorkedExampleNode({ id: 'octo__w1', attempt_index: 0, recall_eligible: true, resolution_friction: null, reference: { issue_id: 'octo__w1', repo: 'octo/w', problem_statement_digest: 'd', candidate_patch_ref: 'x', behavioral_verdict: 'BEHAVIORAL_PASS', reference_divergence: 0.2, contamination_tier: 'clean' } });
}

// --------------------------------------------------------------------------
// sameRequirement — exact-set, both non-empty, string-only.
// --------------------------------------------------------------------------
test('sameRequirement: exact-set true; order/multiplicity insensitive', () => {
  assert.strictEqual(sameRequirement(['a', 'b'], ['b', 'a']), true);
  assert.strictEqual(sameRequirement(['a', 'b'], ['a', 'a', 'b']), true); // set semantics
});
test('sameRequirement: subset, superset, EMPTY all false', () => {
  assert.strictEqual(sameRequirement(['a', 'b'], ['a']), false);          // subset
  assert.strictEqual(sameRequirement(['a'], ['a', 'b']), false);          // superset
  assert.strictEqual(sameRequirement([], []), false);                     // empty proves nothing (C1)
  assert.strictEqual(sameRequirement(['a'], []), false);
  assert.strictEqual(sameRequirement(null, ['a']), false);
});
test('sameRequirement: non-string members are REJECTED, never coerced (M-B)', () => {
  assert.strictEqual(sameRequirement([true], ['true']), false);
  assert.strictEqual(sameRequirement([null], ['null']), false);
  assert.strictEqual(sameRequirement([{ toString: () => 'x' }], ['x']), false);
  assert.strictEqual(sameRequirement([''], ['']), false);                 // empty-string member
});

// --------------------------------------------------------------------------
// confirmsLesson — the gate's full rejection set (3rd arg = the corpus-trusted requirement).
// --------------------------------------------------------------------------
test('a verified confirming attempt PASSES the gate (requirement = corpus truth)', () => {
  assert.strictEqual(confirmsLesson(node(), attempt(), FTP), true);
});
test('REJECT: a non-PASS behavioral_verdict (never a caller boolean)', () => {
  assert.strictEqual(confirmsLesson(node(), attempt({ behavioral_verdict: 'BEHAVIORAL_PARTIAL' }), FTP), false);
  assert.strictEqual(confirmsLesson(node(), attempt({ behavioral_verdict: 'BEHAVIORAL_FAIL' }), FTP), false);
  assert.strictEqual(confirmsLesson(node(), { ...attempt(), behavioral_verdict: undefined, passed: true }, FTP), false);
});
test('REJECT: a different issue', () => {
  assert.strictEqual(confirmsLesson(node({ issue_id: 'octo__w1' }), attempt({ issue_id: 'octo__OTHER' }), FTP), false);
});
test('REJECT: absent trusted requirement (fail-closed without the corpus truth)', () => {
  assert.strictEqual(confirmsLesson(node(), attempt(), undefined), false);
  assert.strictEqual(confirmsLesson(node(), attempt(), []), false);
});
test('REJECT (H-A): a TAMPERED node fail_to_pass (!= corpus) — even if the attempt matches the node', () => {
  // attacker softens BOTH the node and the attempt to a subset; the corpus truth (FTP) catches it.
  assert.strictEqual(confirmsLesson(node({ fail_to_pass: ['t_zero'] }), attempt({ fail_to_pass: ['t_zero'] }), FTP), false);
});
test('REJECT (C2): a forged confirming attempt fail_to_pass (!= corpus)', () => {
  assert.strictEqual(confirmsLesson(node(), attempt({ fail_to_pass: ['t_zero'] }), FTP), false);           // subset attempt
  assert.strictEqual(confirmsLesson(node(), attempt({ fail_to_pass: ['t_zero', 't_neg', 't_x'] }), FTP), false); // superset
});
test('REJECT: self-delta, accepted-diff-as-delta, empty/trivial candidate', () => {
  assert.strictEqual(confirmsLesson(node(), attempt({ candidate_patch: NODE_PATCH }), FTP), false);        // self-confirm
  const n = buildWorkedExampleNode(
    { id: 'octo__w1', attempt_index: 0, recall_eligible: true, resolution_friction: null,
      reference: { issue_id: 'octo__w1', repo: 'octo/w', problem_statement_digest: 'd', candidate_patch_ref: 'x', behavioral_verdict: 'BEHAVIORAL_PASS', reference_divergence: 0.2, contamination_tier: 'clean' } },
    { lesson: { trigger_class: 'boundary-contract', gotcha_class: 'unguarded-edge-case', corrective_class: 'fail-closed', lesson_body: 'b' },
      accepted_diff_ref: sidecarSha(CONFIRM_PATCH), candidate_patch_sha: sidecarSha(NODE_PATCH), fail_to_pass: FTP });
  assert.strictEqual(confirmsLesson(n, attempt(), FTP), false, 'ground-truth (accepted_diff) cannot confirm');
  assert.strictEqual(confirmsLesson(node(), attempt({ candidate_patch: '' }), FTP), false);                // empty candidate
});
test('REJECT: a non-lesson node / a junk node_id', () => {
  assert.strictEqual(confirmsLesson(bareNode(), attempt(), FTP), false, 'a lesson-less node never confirms');
  assert.strictEqual(confirmsLesson({ ...node(), node_id: 'not-hex' }, attempt(), FTP), false);
});
test('PERSONA-AGNOSTIC: a built_by difference does not change the gate outcome (P5)', () => {
  const withPersona = { ...node(), built_by: { role: 'node-backend', roster_name: 'nova', actor_kind: 'claude_p' } };
  assert.strictEqual(confirmsLesson(withPersona, attempt(), FTP), confirmsLesson(node(), attempt(), FTP));
  assert.strictEqual(confirmsLesson(withPersona, attempt(), FTP), true);
});

// --------------------------------------------------------------------------
// the lane.
// --------------------------------------------------------------------------
test('canEnterPredictorLane: false without an edge, true with one', () => {
  const n = node();
  assert.strictEqual(canEnterPredictorLane(n, confirmedNodeIds([])), false);
  const ids = confirmedNodeIds([{ edge_type: 'confirmed-by', from_node_id: n.node_id }]);
  assert.strictEqual(canEnterPredictorLane(n, ids), true);
});
test('confirmedNodeIds ignores a non-confirmed-by type / a coerced from_node_id', () => {
  const n = node();
  assert.strictEqual(confirmedNodeIds([{ edge_type: 'contradicted-by', from_node_id: n.node_id }]).size, 0);
  assert.strictEqual(confirmedNodeIds([{ edge_type: 'confirmed-by', from_node_id: [n.node_id] }]).size, 0); // strict
});

// --------------------------------------------------------------------------
// runConfirmationPass — join + sidecar + write edges (requirementFor = corpus resolver).
// --------------------------------------------------------------------------
test('confirm pass: 1 node x 1 verified attempt -> 1 recoverable canonical edge + confirmed', async () => {
  const dir = tmp();
  const n = node();
  const r = await runConfirmationPass([n], [attempt()], { edgeDir: path.join(dir, 'e'), sidecarDir: path.join(dir, 's'), now: '2026-06-15T00:00:00.000Z', requirementFor: () => FTP });
  assert.strictEqual(r.n_confirmed, 1);
  assert.strictEqual(r.n_written, 1);
  assert.strictEqual(r.n_sidecar_failed, 0);
  assert.deepStrictEqual(r.confirmed_node_ids, [n.node_id]);
  assert.strictEqual(listEdges({ dir: path.join(dir, 'e') }).length, 1);
  // the returned edge is the CANONICAL stored form (has edge_id, sorted fail_to_pass)
  assert.ok(/^[0-9a-f]{64}$/.test(r.edges[0].edge_id));
  assert.deepStrictEqual(r.edges[0].fail_to_pass, [...FTP].sort());
  // the confirming delta is recoverable (the H3 bar-raise)
  assert.strictEqual(readCandidate(sidecarSha(CONFIRM_PATCH), { dir: path.join(dir, 's') }), CONFIRM_PATCH);
});
test('confirm pass: a non-confirming attempt writes NO edge', async () => {
  const dir = tmp();
  const r = await runConfirmationPass([node()], [attempt({ candidate_patch: NODE_PATCH })], { edgeDir: path.join(dir, 'e'), sidecarDir: path.join(dir, 's'), now: '2026-06-15T00:00:00.000Z', requirementFor: () => FTP });
  assert.strictEqual(r.n_confirmed, 0);
  assert.strictEqual(r.n_written, 0);
  assert.strictEqual(listEdges({ dir: path.join(dir, 'e') }).length, 0);
});
test('confirm pass: no requirementFor resolver -> fail-closed (no confirmation)', async () => {
  const dir = tmp();
  const r = await runConfirmationPass([node()], [attempt()], { edgeDir: path.join(dir, 'e'), sidecarDir: path.join(dir, 's'), now: '2026-06-15T00:00:00.000Z' });
  assert.strictEqual(r.n_confirmed, 0, 'without the corpus truth, nothing confirms');
});

// --------------------------------------------------------------------------
// THE EXIT-PROOF — a provisional node cannot reach the predictor lane without a same-requirement
// confirming delta sourced from a verified run. EXHAUSTIVE over the gate's rejection set.
// --------------------------------------------------------------------------
test('EXIT-PROOF: the predictor lane is unreachable without a genuine same-requirement confirming delta', async () => {
  const dir = tmp();
  const edgeDir = path.join(dir, 'e'); const sidecarDir = path.join(dir, 's');
  const n = node();
  const opts = { edgeDir, sidecarDir, now: '2026-06-15T00:00:00.000Z', requirementFor: () => FTP };
  const lane = () => canEnterPredictorLane(n, confirmedNodeIds(listEdges({ dir: edgeDir })));

  assert.strictEqual(lane(), false, 'provisional: hazard lane');
  // EVERY non-confirming attempt leaves the node in the hazard lane (exhaustive over the gate set)
  const rejections = [
    attempt({ behavioral_verdict: 'BEHAVIORAL_FAIL' }),     // not a real pass
    attempt({ behavioral_verdict: undefined, passed: true }), // a caller `passed` is ignored
    attempt({ issue_id: 'octo__OTHER' }),                   // wrong issue
    attempt({ fail_to_pass: ['t_zero'] }),                  // attempt subset (!= corpus)
    attempt({ fail_to_pass: ['t_zero', 't_neg', 't_x'] }),  // attempt superset (!= corpus)
    attempt({ candidate_patch: NODE_PATCH }),               // self-delta
    attempt({ candidate_patch: '' }),                       // trivial
  ];
  for (const bad of rejections) {
    await runConfirmationPass([n], [bad], opts);
    assert.strictEqual(lane(), false, 'still hazard after a non-confirming attempt');
  }
  // a TAMPERED node requirement also cannot reach the lane (corpus truth catches it)
  await runConfirmationPass([node({ fail_to_pass: ['t_zero'] })], [attempt({ fail_to_pass: ['t_zero'] })], opts);
  assert.strictEqual(canEnterPredictorLane(node({ fail_to_pass: ['t_zero'] }), confirmedNodeIds(listEdges({ dir: edgeDir }))), false, 'softened requirement stays hazard');
  // a missing corpus requirement cannot reach the lane
  await runConfirmationPass([n], [attempt()], { edgeDir, sidecarDir, now: opts.now });
  assert.strictEqual(lane(), false, 'no corpus truth -> still hazard');

  // ONLY a genuine same-requirement, different-non-trivial, BEHAVIORAL_PASS confirm flips it
  await runConfirmationPass([n], [attempt()], opts);
  assert.strictEqual(lane(), true, 'predictor lane reached ONLY via a genuine confirming delta');
});

// --------------------------------------------------------------------------
// v-next Carry C W1 — the authenticated lane (authenticatedEdgeIds) + the SIGNED confirm pass.
// --------------------------------------------------------------------------
test('SIGNED confirm pass: {signingKey} writes a SIGNED edge; authenticatedEdgeIds(verifyKey) includes it; fail-closed without a key', async () => {
  const dir = tmp();
  const { publicKeyPem, privateKeyPem } = generateEdgeKeypair();
  const n = node();
  const r = await runConfirmationPass([n], [attempt()], { edgeDir: path.join(dir, 'e'), sidecarDir: path.join(dir, 's'), now: '2026-06-15T00:00:00.000Z', requirementFor: () => FTP, signingKey: privateKeyPem });
  assert.strictEqual(r.n_written, 1);
  const edges = listEdges({ dir: path.join(dir, 'e'), verifyKey: publicKeyPem });
  assert.strictEqual(edges.length, 1);
  assert.strictEqual(edges[0].sig_alg, 'ed25519');
  assert.strictEqual(authenticatedEdgeIds(edges, { verifyKey: publicKeyPem }).has(n.node_id), true);
  assert.strictEqual(authenticatedEdgeIds(edges, {}).size, 0, 'fail-closed: no verify key -> nothing authenticated');
});

test('UNSIGNED confirm pass (shadow default): unsigned edge; confirmedNodeIds counts it (unchanged); authenticatedEdgeIds excludes it', async () => {
  const dir = tmp();
  const { publicKeyPem } = generateEdgeKeypair();
  const n = node();
  await runConfirmationPass([n], [attempt()], { edgeDir: path.join(dir, 'e'), sidecarDir: path.join(dir, 's'), now: '2026-06-15T00:00:00.000Z', requirementFor: () => FTP });
  const edges = listEdges({ dir: path.join(dir, 'e') });
  assert.strictEqual('edge_sig' in edges[0], false);
  assert.strictEqual(confirmedNodeIds(edges).has(n.node_id), true);            // unchanged: still counts it
  assert.strictEqual(authenticatedEdgeIds(edges, { verifyKey: publicKeyPem }).size, 0); // but not authenticated
});

test('RESIDUAL (hacker HIGH-1, PINNED): an UNSIGNED forged edge STILL inflates the lane via the unchanged confirmedNodeIds (open until W2)', () => {
  // The live weight path (confirmedNodeIds) is UNCHANGED in W1 -> a hand-forged unsigned edge (zero
  // gate runs) still promotes its victim. W1 closes only the SIGNED path; this PINS the shadow residual.
  const victim = 'f'.repeat(64);
  const forged = { edge_type: 'confirmed-by', from_node_id: victim };          // no sig, no gate run
  assert.strictEqual(confirmedNodeIds([forged]).has(victim), true);            // STILL counted (by design, W1)
  assert.strictEqual(authenticatedEdgeIds([forged], { verifyKey: generateEdgeKeypair().publicKeyPem }).has(victim), false); // but NOT authenticated
});

test('authenticatedEdgeIds: fail-closed (no key -> empty); a wrong-length/garbage sig is excluded', () => {
  assert.strictEqual(authenticatedEdgeIds([{ edge_type: 'confirmed-by', from_node_id: 'a'.repeat(64), edge_id: 'b'.repeat(64), sig_alg: 'ed25519', edge_sig: 'AAAA' }], {}).size, 0);
  const { publicKeyPem } = generateEdgeKeypair();
  assert.strictEqual(authenticatedEdgeIds([{ edge_type: 'confirmed-by', from_node_id: 'a'.repeat(64), edge_id: 'b'.repeat(64), sig_alg: 'ed25519', edge_sig: 'AAAA' }], { verifyKey: publicKeyPem }).size, 0);
});

test('authenticatedEdgeIds RE-DERIVES (MV-W1 hacker CRITICAL): a signature-replay (valid {edge_id,edge_sig}, SWAPPED from_node_id) is REJECTED', () => {
  const dir = tmp();
  const { publicKeyPem, privateKeyPem } = generateEdgeKeypair();
  const A = '1'.repeat(64); const B = '2'.repeat(64);
  const w = writeEdge({ from_node_id: A, to_delta_ref: 'c'.repeat(64), edge_type: 'confirmed-by', fail_to_pass: ['t'], recorded_at: '2026-06-16T00:00:00.000Z' }, { dir, signer: (id) => signEdgeId(id, { privateKeyPem }) });
  const real = loadEdge(w.edge_id, { dir });
  // sanity: the REAL signed edge is admitted for A
  assert.strictEqual(authenticatedEdgeIds([real], { verifyKey: publicKeyPem }).has(A), true);
  // FORGE: keep the valid edge_id + edge_sig, SWAP from_node_id to B (a replay of one genuine signature)
  const forged = { ...real, from_node_id: B };
  const admitted = authenticatedEdgeIds([forged], { verifyKey: publicKeyPem });
  assert.strictEqual(admitted.has(B), false, 'swapped from_node_id must NOT be admitted (the re-derive guard binds it)');
  assert.strictEqual(admitted.has(A), false);
});

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && e.message}`); }
  }
  console.log(`\nlesson-confirm: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
