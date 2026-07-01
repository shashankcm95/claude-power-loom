#!/usr/bin/env node
'use strict';

// tests/unit/lab/causal-edge/world-anchored-recall.test.js
//
// PR-B B3 - the NET-NEW world-anchored recall RETRIEVER (SHADOW). The suite IS the behavioral contract
// (the plan's TDD list, folding the 3-lens VERIFY board):
//   - the LOAD-BEARING SHADOW proof: even a FULLY-ADMITTED quadruple + the right keys yields EMPTY output,
//     because LIVE_SOURCES is frozen-empty (gate a); and no-keys yields empty because admission is 'mock'
//     (gate b) - two independent structural gates, either alone dark.
//   - the laundering guard: an off-taxonomy / INVALID-fixpoint lesson_signature node is DROPPED.
//   - the classifyNode WIRING proof: a fully-admitted node classifies source:'world-anchor' (proving the
//     admission wire WITHOUT flipping LIVE_SOURCES - the CRITICAL-fold decomposition).
//   - per-node admittedWeight (no injectable live-source seam); pure rankInstincts; fail-closed totality;
//     the env-key non-flip (B3 reads NO env key).
//
// Real ed25519 across the admitted quadruple (node + signed edge + attestation + broker-signed outcome) -
// slim LOCAL fixtures (B2's admit-world-anchor-node.test.js helpers are un-exported; only the crypto
// primitives + store mints are importable - VERIFY-reviewer F8). No mocked crypto.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Pin lab-state to a throwaway BEFORE the store modules load (they capture DEFAULT_DIR at require), so a
// default-dir call (the CLI path) never reads the real host store.
process.env.LOOM_LAB_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-test-labstate-b3recall-'));

const REPO = path.join(__dirname, '..', '..', '..', '..');
const {
  retrieveWorldAnchoredInstincts, classifyNode, admittedWeight, rankInstincts,
} = require(path.join(REPO, 'packages/lab/causal-edge/world-anchored-recall.js'));
const { recordAttestation } = require(path.join(REPO, 'packages/lab/world-anchor/world-anchor-store.js'));
const { mintWorldAnchoredNode, readLiveNode } = require(path.join(REPO, 'packages/lab/world-anchor/live-recall-store.js'));
const { writeWorldAnchorEdge, loadWorldAnchorEdge } = require(path.join(REPO, 'packages/lab/world-anchor/world-anchor-edge-store.js'));
const { recordMergeOutcome } = require(path.join(REPO, 'packages/lab/world-anchor/merge-outcome-store.js'));
const { deriveJoinKeyId } = require(path.join(REPO, 'packages/kernel/_lib/join-key-id.js'));
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
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-b3recall-')); }
function dirs() {
  const root = tmp();
  return { anchorDir: root, liveDir: path.join(root, 'live'), edgeDir: path.join(root, 'edges'), outcomeDir: path.join(root, 'outcomes') };
}
// Swallow the [LOOM-EGRESS-ALERT] refuse lines the stores emit (observable), keeping test output clean.
function quiet(fn) {
  const orig = process.stderr.write;
  process.stderr.write = (chunk) => (String(chunk).startsWith('[LOOM-EGRESS-ALERT]') ? true : orig.call(process.stderr, chunk));
  try { return fn(); } finally { process.stderr.write = orig; }
}

const REPO_SLUG = 'octo/widget';
const TRIGGER = 'boundary-contract';   // parts[0] of the canonical signature below
const BASE = {
  repo: REPO_SLUG, issueRef: 42, pr_number: 77,
  approval_hash: 'd'.repeat(64), diff_hash: 'a'.repeat(64), base_sha: 'f'.repeat(40),
  branch: 'loom/issue-42', built_by: 'anonymous-actor', emitted_at: '2026-06-28T00:00:00.000Z',
  lesson_signature: 'lesson:boundary-contract|unguarded-edge-case|handle-edge-explicitly',
  lesson_body: 'guard the empty-slice edge before indexing (the captured live-solve hypothesis)',
  merge_sha: `${'c0ffee'.repeat(6)}cafe`,
  observed_at: '2026-06-28T12:00:00.000Z', approvedAt: 1735430400000, nonce: 'nonce-abc', key_id: 'v0',
};
function prUrl(f) { return `https://github.com/${f.repo}/pull/${f.pr_number}`; }

// Mint node + signed edge + attestation. `over.lesson_signature` overrides the signature (for the
// off-taxonomy drop test - mintWorldAnchoredNode only bounds the string, never taxonomy-validates it).
function buildBase(d, over = {}) {
  const f = { ...BASE, ...over };
  const kpEdge = over.kpEdge || generateEdgeKeypair();
  const kpBroker = over.kpBroker || generateEdgeKeypair();
  const a = quiet(() => recordAttestation({
    repo: f.repo, issueRef: f.issueRef, pr_url: prUrl(f), pr_number: f.pr_number,
    branch: f.branch, base_sha: f.base_sha, diff_hash: f.diff_hash,
    lesson_signature: f.lesson_signature, built_by: f.built_by, approval_hash: f.approval_hash, emitted_at: f.emitted_at,
  }, { dir: d.anchorDir, selfUid: SELF }));
  assert.strictEqual(a.ok, true, `attestation lands (${a.reason})`);
  const m = quiet(() => mintWorldAnchoredNode({
    anchor_id: a.anchor_id, merge_sha: f.merge_sha, lesson_signature: f.lesson_signature, lesson_body: f.lesson_body,
  }, { dir: d.liveDir, selfUid: SELF }));
  assert.strictEqual(m.ok, true, `node mints (${m.reason})`);
  const node = readLiveNode(m.node_id, { dir: d.liveDir, selfUid: SELF });
  const w = quiet(() => writeWorldAnchorEdge({
    from_node_id: m.node_id, to_delta_ref: f.approval_hash, edge_type: 'world-anchored-by', recorded_at: f.observed_at,
  }, { signer: (id) => signEdgeId(id, { privateKeyPem: kpEdge.privateKeyPem }), dir: d.edgeDir, selfUid: SELF }));
  assert.strictEqual(w.ok, true, `edge mints (${w.reason})`);
  const signedEdge = loadWorldAnchorEdge(w.edge_id, { dir: d.edgeDir, selfUid: SELF });
  const lc = computeLessonCommitment({ lesson_signature: f.lesson_signature, lesson_body: f.lesson_body });
  return { node, node_id: m.node_id, signedEdge, kpEdge, kpBroker, lc, f };
}
// Write the CONSISTENT broker-signed merge-outcome B2 admits.
function writeOutcome(d, q) {
  const jkid = deriveJoinKeyId({ repo: q.f.repo, issueRef: q.f.issueRef, pr_number: q.f.pr_number, approval_hash: q.f.approval_hash, lesson_commitment: q.lc });
  const basis = approvalSigBasis({ hash: q.f.approval_hash, approvedAt: q.f.approvedAt, nonce: q.f.nonce, key_id: q.f.key_id, lesson_commitment: q.lc });
  const broker_sig = signRecordId(basis, { privateKeyPem: q.kpBroker.privateKeyPem });
  const o = quiet(() => recordMergeOutcome({
    join_key_id: jkid, repo: q.f.repo, pr_number: q.f.pr_number, pr_url: prUrl(q.f),
    approval_hash: q.f.approval_hash, outcome: 'merged', merge_commit_sha: q.f.merge_sha, observed_at: q.f.observed_at,
    lesson_commitment: q.lc, approvedAt: q.f.approvedAt, nonce: q.f.nonce, key_id: q.f.key_id, broker_sig,
  }, { dir: d.outcomeDir, selfUid: SELF }));
  assert.strictEqual(o.ok, true, `merge-outcome lands (${o.reason})`);
}
// Production-shaped retrieve opts: the retriever reads edges from edgeDir itself; keys custody-pinned.
function retrieveOpts(d, q, over = {}) {
  return {
    liveDir: d.liveDir, edgeDir: d.edgeDir, anchorDir: d.anchorDir, outcomeDir: d.outcomeDir, selfUid: SELF,
    edgeVerifyKey: q.kpEdge.publicKeyPem, brokerVerifyKey: q.kpBroker.publicKeyPem, ...over,
  };
}

// === 1. THE LOAD-BEARING SHADOW PROOF ===
test('SHADOW (gate a): a FULLY-ADMITTED node + the RIGHT keys STILL yields empty (LIVE_SOURCES frozen-empty)', () => {
  const d = dirs();
  const q = buildBase(d);
  writeOutcome(d, q);
  const out = quiet(() => retrieveWorldAnchoredInstincts({ trigger_class: TRIGGER }, retrieveOpts(d, q)));
  assert.deepStrictEqual(out.instincts, [], 'no instinct surfaces even when admission would pass - LIVE_SOURCES is empty');
  assert.strictEqual(out.shadow_empty, true);
  assert.strictEqual(out.diagnostics.n_nodes, 1, 'the node WAS read (the gate is the weight, not the read)');
});

test('SHADOW (gate b): no verify keys -> admission mock -> empty (even with a full quadruple present)', () => {
  const d = dirs();
  const q = buildBase(d);
  writeOutcome(d, q);
  const out = quiet(() => retrieveWorldAnchoredInstincts({ trigger_class: TRIGGER }, retrieveOpts(d, q, { edgeVerifyKey: undefined, brokerVerifyKey: undefined })));
  assert.deepStrictEqual(out.instincts, []);
  assert.strictEqual(out.shadow_empty, true);
});

test('SHADOW: diagnostics carry COUNTS only - never lesson_body (no weight-0 enumeration surface)', () => {
  const d = dirs();
  const q = buildBase(d);
  writeOutcome(d, q);
  const out = quiet(() => retrieveWorldAnchoredInstincts({ trigger_class: TRIGGER }, retrieveOpts(d, q)));
  assert.ok(!JSON.stringify(out.diagnostics).includes('empty-slice'), 'the attacker-controllable lesson_body never rides in diagnostics');
  assert.deepStrictEqual(Object.keys(out.diagnostics).sort(), ['error', 'n_admitted', 'n_nodes', 'n_off_taxonomy']);
  assert.strictEqual(out.diagnostics.error, false, 'success-path diagnostics carry error:false (symmetric with the fail path)');
});

// === 2. classifyNode WIRING PROOF (admission works WITHOUT flipping LIVE_SOURCES) ===
test('classifyNode: a fully-admitted node classifies source:world-anchor, verdict:HARDEN, trigger_class parsed', () => {
  const d = dirs();
  const q = buildBase(d);
  writeOutcome(d, q);
  const item = quiet(() => classifyNode(q.node, {
    edges: [q.signedEdge], edgeVerifyKey: q.kpEdge.publicKeyPem, brokerVerifyKey: q.kpBroker.publicKeyPem,
    anchorDir: d.anchorDir, outcomeDir: d.outcomeDir, selfUid: SELF,
  }));
  assert.ok(item, 'classified');
  assert.strictEqual(item.source, 'world-anchor', 'the admission wire works (source world-anchor)');
  assert.strictEqual(item.verdict, 'HARDEN');
  assert.strictEqual(item.trigger_class, TRIGGER, 'trigger_class from the PARSED signature, not node.trigger_class');
});

test('classifyNode: a NON-admitted node (no outcome) classifies source:mock, verdict:WITHHOLD', () => {
  const d = dirs();
  const q = buildBase(d);   // no writeOutcome -> admission refuses -> mock
  const item = quiet(() => classifyNode(q.node, {
    edges: [q.signedEdge], edgeVerifyKey: q.kpEdge.publicKeyPem, brokerVerifyKey: q.kpBroker.publicKeyPem,
    anchorDir: d.anchorDir, outcomeDir: d.outcomeDir, selfUid: SELF,
  }));
  assert.strictEqual(item.source, 'mock');
  assert.strictEqual(item.verdict, 'WITHHOLD', 'WITHHOLD belt on non-admit');
});

// === 3. THE LAUNDERING GUARD (off-taxonomy / INVALID-fixpoint drop) ===
for (const sig of ['lesson:INVALID|INVALID|INVALID', 'lesson:INVALID|unguarded-edge-case|handle-edge-explicitly', 'garbage', 'lesson:boundary-contract|unguarded-edge-case|handle-edge-explicitly|EXTRA']) {
  test(`laundering guard: a node with off-taxonomy signature ${JSON.stringify(sig)} is DROPPED (classifyNode null)`, () => {
    const d = dirs();
    const q = buildBase(d, { lesson_signature: sig, diff_hash: 'b'.repeat(64) });
    const item = quiet(() => classifyNode(q.node, {
      edges: [q.signedEdge], edgeVerifyKey: q.kpEdge.publicKeyPem, brokerVerifyKey: q.kpBroker.publicKeyPem,
      anchorDir: d.anchorDir, outcomeDir: d.outcomeDir, selfUid: SELF,
    }));
    assert.strictEqual(item, null, 'the raw on-disk signature is never trusted as a ranking key');
  });
}

test('retrieve: an off-taxonomy node is counted in n_off_taxonomy, never surfaced', () => {
  const d = dirs();
  buildBase(d, { lesson_signature: 'lesson:INVALID|INVALID|INVALID' });
  const out = quiet(() => retrieveWorldAnchoredInstincts({ trigger_class: TRIGGER }, { liveDir: d.liveDir, edgeDir: d.edgeDir, selfUid: SELF }));
  assert.strictEqual(out.diagnostics.n_off_taxonomy, 1);
  assert.deepStrictEqual(out.instincts, []);
});

// === 4. admittedWeight (per-node gate; no injectable live-source seam) ===
test('admittedWeight: any source in SHADOW yields 0 (frozen-empty LIVE_SOURCES; no opts seam)', () => {
  assert.strictEqual(admittedWeight({ source: 'world-anchor', verdict: 'HARDEN' }), 0, 'world-anchor not in the empty live-set');
  assert.strictEqual(admittedWeight({ source: 'mock', verdict: 'HARDEN' }), 0);
  assert.strictEqual(admittedWeight({ source: 'world-anchor', verdict: 'WITHHOLD' }), 0, 'WITHHOLD -> weight 0 regardless');
  assert.strictEqual(admittedWeight.length, 1, 'admittedWeight takes ONE arg - no liveSources injection seam');
});

// === 4b. exported helpers are FAIL-CLOSED at the seam B4 will call (VALIDATE code-reviewer MED + hacker LOW) ===
test('exported helpers never throw on an adversarial getter / malformed input (fail-closed for a future B4 caller)', () => {
  const evilNode = { get lesson_signature() { throw new Error('boom'); } };
  const evilItem = { get source() { throw new Error('boom'); }, verdict: 'HARDEN' };
  const evilEntry = { node_id: 'a', trigger_class: TRIGGER, get weight() { throw new Error('boom'); } };
  assert.strictEqual(classifyNode(evilNode, {}), null, 'classifyNode fail-closes to null');
  assert.strictEqual(classifyNode(null), null);
  assert.strictEqual(classifyNode(42), null);
  assert.strictEqual(admittedWeight(evilItem), 0, 'admittedWeight fail-closes to 0');
  assert.strictEqual(admittedWeight(null), 0);
  assert.strictEqual(admittedWeight(undefined), 0);
  assert.deepStrictEqual(rankInstincts([evilEntry], { trigger_class: TRIGGER }), [], 'rankInstincts fail-closes to []');
  assert.deepStrictEqual(rankInstincts(null, null), []);
});

// === 5. rankInstincts (PURE) ===
test('rankInstincts: keeps only w>0, sorts trigger-match desc then weight desc then node_id asc; limit honored', () => {
  const entries = [
    { node_id: 'ccc', trigger_class: 'data-parse', weight: 5 },       // no match
    { node_id: 'bbb', trigger_class: TRIGGER, weight: 1 },            // match, low weight
    { node_id: 'aaa', trigger_class: TRIGGER, weight: 1 },            // match, low weight, earlier node_id
    { node_id: 'ddd', trigger_class: TRIGGER, weight: 0 },            // w=0 -> dropped
  ];
  const ranked = rankInstincts(entries, { trigger_class: TRIGGER }, 10);
  assert.deepStrictEqual(ranked.map((r) => r.node_id), ['aaa', 'bbb', 'ccc'], 'match-first, then node_id asc tie-break; w0 dropped');
  assert.strictEqual(rankInstincts(entries, { trigger_class: TRIGGER }, 1).length, 1, 'limit honored');
  assert.deepStrictEqual(rankInstincts([], { trigger_class: TRIGGER }).map((r) => r.node_id), []);
});

test('rankInstincts: a NaN / negative / non-number weight is not surfaced (clamped by the >0 filter)', () => {
  const entries = [
    { node_id: 'a', trigger_class: TRIGGER, weight: NaN },
    { node_id: 'b', trigger_class: TRIGGER, weight: -3 },
    { node_id: 'c', trigger_class: TRIGGER, weight: Infinity },
  ];
  // Infinity is >0 and finite? No - Number.isFinite(Infinity) === false, so it is filtered too.
  assert.deepStrictEqual(rankInstincts(entries, { trigger_class: TRIGGER }).map((r) => r.node_id), []);
});

// === 6. fail-closed ===
test('fail-closed: absent store dirs -> empty, shadow_empty true, never throws', () => {
  const out = quiet(() => retrieveWorldAnchoredInstincts({ trigger_class: TRIGGER }, { liveDir: '/nonexistent/loom-b3/live', edgeDir: '/nonexistent/loom-b3/edges', selfUid: SELF }));
  assert.deepStrictEqual(out.instincts, []);
  assert.strictEqual(out.shadow_empty, true);
});

test('fail-closed: selfUid:null -> empty (admission no-uid; never admit with foreign-reject disabled)', () => {
  const d = dirs();
  const q = buildBase(d);
  writeOutcome(d, q);
  const out = quiet(() => retrieveWorldAnchoredInstincts({ trigger_class: TRIGGER }, retrieveOpts(d, q, { selfUid: null })));
  assert.deepStrictEqual(out.instincts, []);
});

test('fail-closed: empty query / no trigger_class -> empty (no match), never throws', () => {
  const d = dirs();
  const q = buildBase(d);
  writeOutcome(d, q);
  const out = quiet(() => retrieveWorldAnchoredInstincts({}, retrieveOpts(d, q)));
  assert.deepStrictEqual(out.instincts, []);
});

// === 7. env-key non-flip (VERIFY-hacker MED#2: B3 reads NO env key) ===
test('env-key non-flip: LOOM_EDGE_VERIFY_KEY set + full quadruple + NO keys passed -> still empty', () => {
  const d = dirs();
  const q = buildBase(d);
  writeOutcome(d, q);
  const prev = process.env.LOOM_EDGE_VERIFY_KEY;
  process.env.LOOM_EDGE_VERIFY_KEY = q.kpEdge.publicKeyPem;   // an attacker sets an ambient key
  try {
    const out = quiet(() => retrieveWorldAnchoredInstincts({ trigger_class: TRIGGER }, { liveDir: d.liveDir, edgeDir: d.edgeDir, anchorDir: d.anchorDir, outcomeDir: d.outcomeDir, selfUid: SELF }));
    assert.deepStrictEqual(out.instincts, [], 'B3 never reads an env verify key - admission stays no-verify-key -> mock');
  } finally {
    if (prev === undefined) delete process.env.LOOM_EDGE_VERIFY_KEY; else process.env.LOOM_EDGE_VERIFY_KEY = prev;
  }
});

// === 8. the CLI (B4's invokeNodeJson contract: single JSON to stdout, exit 0, shadow_empty on a clean box) ===
test('CLI: --trigger-class runs -> exit 0, the ENTIRE stdout is one parseable JSON object, shadow_empty true', () => {
  const { spawnSync } = require('child_process');
  const CLI = path.join(REPO, 'packages/lab/causal-edge/world-anchored-recall-cli.js');
  // The child inherits the throwaway LOOM_LAB_STATE_DIR pinned at the top -> absent store -> empty.
  const res = spawnSync(process.execPath, [CLI, '--trigger-class', TRIGGER, '--limit', '5'], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, `CLI exits 0 (stderr=${res.stderr})`);
  const out = JSON.parse(res.stdout);   // invokeNodeJson does JSON.parse over the ENTIRE stdout - must not throw
  assert.strictEqual(out.shadow_empty, true);
  assert.deepStrictEqual(out.instincts, []);
  assert.ok(out.diagnostics && typeof out.diagnostics.n_nodes === 'number', 'diagnostics present');
});

process.stdout.write(`\n=== world-anchored-recall: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
