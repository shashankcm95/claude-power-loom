#!/usr/bin/env node

// tests/unit/lab/world-anchor/item5-merge-edge-wire.test.js
//
// Autonomous-SDE ladder item 5, PR-A.2 - the merge -> world-anchored-by edge mint WIRE (SHADOW,
// UNSIGNED). A real maintainer-merge mints a world_anchored NODE (item 3) AND, additively, ONE
// world-anchored-by EDGE binding that node to the merged diff (via the #444 store). The edge is
// UNSIGNED by default (the off-host signer is the separate PR-A2 vehicle); it gates NOTHING
// (LIVE_SOURCES frozen-empty, no production consumer admits the world-anchor source).
//
// We drive the PUBLIC runRecordMerge ONLY (the gated entry); mintFromAttestation stays private.
// Mirrors cli.test.js STYLE (node:assert + a light test() runner + LOOM_LAB_STATE_DIR pinned BEFORE
// the store modules are required + the attest() fixture shape + the stderr-capture pattern) - the lab
// convention (run via `node <file>`, NOT node:test).

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Test isolation: pin the lab-state base to a throwaway tmp dir BEFORE the store modules are required
// (they read LOOM_LAB_STATE_DIR at module load), so a test that omits an injected dir can NEVER write
// to the real ~/.claude/lab-state store (the cli.test.js dogfood lesson, carried verbatim).
process.env.LOOM_LAB_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-test-labstate-'));

const REPO = path.join(__dirname, '..', '..', '..', '..');
const cli = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'cli.js'));
const store = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'world-anchor-store.js'));
const edgeStore = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'world-anchor-edge-store.js'));
const liveStore = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'live-recall-store.js'));
const { generateEdgeKeypair, signEdgeId } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'edge-attestation'));
const { buildRankingWeights, admitWeightForRanking } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'weight-source-gate'));

let passed = 0;
function test(name, fn) { fn(); passed += 1; }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-item5-wire-')); }

// The attestation fixture (mirrors cli.test.js's attest()). diff_hash is a known HEX64 so a test can
// assert the edge binds att.diff_hash, never the (different) merge SHA. Returns { anchor_id, diff_hash }.
const FIXTURE_DIFF_HASH = 'a'.repeat(64);
function attest(dir, over = {}) {
  const att = {
    repo: 'octo/widget', issueRef: 42,
    pr_url: 'https://github.com/octo/widget/pull/77', pr_number: 77, branch: 'b',
    base_sha: 'f853934b61000ff076cea60c206db225e3ed89f0', diff_hash: FIXTURE_DIFF_HASH,
    lesson_signature: 'lesson:boundary-contract|unguarded-edge-case|handle-edge-explicitly',
    built_by: 'anonymous-actor', approval_hash: 'd'.repeat(64), emitted_at: '2026-06-25T00:00:00.000Z',
    ...over,
  };
  const w = store.recordAttestation(att, { dir });
  assert.strictEqual(w.ok, true, 'fixture attestation lands');
  return { anchor_id: w.anchor_id, diff_hash: att.diff_hash };
}

const PR = 'https://github.com/octo/widget/pull/77';
const NOW = '2026-06-26T00:00:00.000Z';
// A 64-hex merge SHA that is DIFFERENT from FIXTURE_DIFF_HASH: it would pass isHex64, so a wire that
// bound to_delta_ref to the merge SHA (instead of the sealed att.diff_hash) would FORGE the binding.
const MERGE_SHA_HEX64 = 'd'.repeat(64);

function liveDir(d) { return path.join(d, 'live'); }
function edgeDir(d) { return path.join(d, 'edges'); }

// Suppress + capture the egress alert that every refuse path emits (observable refuses).
function captureAlert(fn) {
  const orig = process.stderr.write;
  let alerted = false;
  process.stderr.write = (chunk) => { if (String(chunk).includes('LOOM-EGRESS-ALERT') || String(chunk).includes('world-anchor-edge')) alerted = true; return true; };
  let r;
  try { r = fn(); } finally { process.stderr.write = orig; }
  return { r, alerted };
}

// ---------------------------------------------------------------------------
// Happy: a merged record mints the node AND an UNSIGNED world-anchored-by edge.
// ---------------------------------------------------------------------------

test('a merged record mints the node AND an UNSIGNED world-anchored-by edge', () => {
  const dir = tmp();
  const live = liveDir(dir);
  const edges = edgeDir(dir);
  const { diff_hash } = attest(dir);
  const r = cli.runRecordMerge(
    { pr: PR, outcome: 'merged', mergeSha: MERGE_SHA_HEX64 },
    { dir, liveDir: live, edgeDir: edges, now: NOW },
  );
  assert.strictEqual(r.ok, true);
  assert.ok(r.minted, 'the node minted');
  assert.ok(/^[0-9a-f]{64}$/.test(r.live_node_id), 'a 64-hex live node id');
  // the additive edge
  assert.strictEqual(r.edge_minted, true, 'the edge minted');
  assert.strictEqual(r.edge_signed, false, 'production supplies NO signer -> the edge is UNSIGNED');
  assert.ok(/^[0-9a-f]{64}$/.test(r.edge_id), 'a 64-hex edge id');
  // the edge binds the node to the SEALED att.diff_hash, with from_node_id == the minted node
  const edge = edgeStore.loadWorldAnchorEdge(r.edge_id, { dir: edges });
  assert.ok(edge, 'the edge file exists in edgeDir + loads back');
  assert.strictEqual(edge.from_node_id, r.live_node_id, 'from_node_id is the minted node');
  assert.strictEqual(edge.to_delta_ref, diff_hash, 'to_delta_ref is the sealed att.diff_hash');
  assert.strictEqual(edge.edge_type, 'world-anchored-by', 'the world-anchored-by edge type');
  assert.strictEqual(edge.sig_alg, undefined, 'an unsigned edge has no sig_alg key (SHADOW)');
});

// ---------------------------------------------------------------------------
// Dedups on re-merge: PROVES recorded_at = confirmed_at (the stable per-anchor timestamp). A fresh
// Date() would put a different recorded_at into bodiesEqual and COLLIDE-refuse instead of dedup.
// ---------------------------------------------------------------------------

test('re-merge (same now) DEDUPS the edge - proves recorded_at = confirmed_at stability (NOT a collision)', () => {
  const dir = tmp();
  const live = liveDir(dir);
  const edges = edgeDir(dir);
  attest(dir);
  const args = { pr: PR, outcome: 'merged', mergeSha: MERGE_SHA_HEX64 };
  const opts = { dir, liveDir: live, edgeDir: edges, now: NOW };
  const r1 = cli.runRecordMerge(args, opts);
  const r2 = cli.runRecordMerge(args, opts);
  assert.strictEqual(r1.edge_minted, true, 'first merge mints the edge');
  assert.strictEqual(r1.edge_deduped, false, 'first edge write is a genuine first write');
  assert.strictEqual(r2.edge_minted, true, 'second merge re-mints idempotently (not a collision)');
  assert.strictEqual(r2.edge_deduped, true, 'the second edge dedups (recorded_at stable across re-merge)');
  assert.notStrictEqual(r2.edge_reason, 'collision', 'a stable recorded_at means NO collision on re-merge');
  assert.strictEqual(r1.edge_id, r2.edge_id, 'same content-address');
  assert.strictEqual(edgeStore.listWorldAnchorEdges({ dir: edges }).length, 1, 'exactly one edge file');
});

// ---------------------------------------------------------------------------
// to_delta_ref is att.diff_hash, NEVER the merge SHA (a 64-hex merge SHA that differs from diff_hash).
// ---------------------------------------------------------------------------

test('to_delta_ref binds the sealed att.diff_hash, NEVER the (64-hex) merge SHA (hacker H1)', () => {
  const dir = tmp();
  const live = liveDir(dir);
  const edges = edgeDir(dir);
  const { diff_hash } = attest(dir);
  assert.notStrictEqual(MERGE_SHA_HEX64, diff_hash, 'the merge SHA is a DIFFERENT 64-hex than att.diff_hash');
  const r = cli.runRecordMerge(
    { pr: PR, outcome: 'merged', mergeSha: MERGE_SHA_HEX64 },
    { dir, liveDir: live, edgeDir: edges, now: NOW },
  );
  const edge = edgeStore.loadWorldAnchorEdge(r.edge_id, { dir: edges });
  assert.strictEqual(edge.to_delta_ref, diff_hash, 'the edge binds att.diff_hash');
  assert.notStrictEqual(edge.to_delta_ref, MERGE_SHA_HEX64, 'the edge NEVER binds the caller merge SHA');
});

// ---------------------------------------------------------------------------
// byte-identical-node (additive): the node result is byte-identical across an edge-SUCCESS run and an
// injected edge-FAILURE run; the failure surfaces edge_minted:false + a reason + an alert, node stays
// minted:true. This MUST fail RED against the UNWIRED cli.js first (no edge_* fields exist yet).
// MECHANISM: force the edge-mint to fail by injecting an edgeDir that is a FILE, not a directory. The
// store's ensureStoreDir lstat's it, sees a non-directory, and throws -> caught -> {ok:false,
// reason:'store-dir'}. The NODE mint uses a DIFFERENT (valid) liveDir, so the node is unaffected.
// ---------------------------------------------------------------------------

test('byte-identical-node: an edge-FAILURE leaves the node result byte-identical + surfaces edge_reason + alert', () => {
  // ---- run A: edge success (the reference node fields) ----
  const dirA = tmp();
  attest(dirA);
  const rA = cli.runRecordMerge(
    { pr: PR, outcome: 'merged', mergeSha: MERGE_SHA_HEX64 },
    { dir: dirA, liveDir: liveDir(dirA), edgeDir: edgeDir(dirA), now: NOW },
  );
  assert.strictEqual(rA.edge_minted, true, 'run A mints the edge');
  const nodeFieldsA = { minted: rA.minted, minted_deduped: rA.minted_deduped, live_node_id: rA.live_node_id, mint_reason: rA.mint_reason };

  // ---- run B: edge FAILURE (edgeDir is a regular FILE -> ensureStoreDir throws -> store-dir refuse) ----
  const dirB = tmp();
  attest(dirB);
  const badEdgeDir = path.join(dirB, 'edge-as-file');
  fs.writeFileSync(badEdgeDir, 'not a directory', { mode: 0o600 });   // a file where a dir is expected
  let rB;
  const cap = captureAlert(() => {
    rB = cli.runRecordMerge(
      { pr: PR, outcome: 'merged', mergeSha: MERGE_SHA_HEX64 },
      { dir: dirB, liveDir: liveDir(dirB), edgeDir: badEdgeDir, now: NOW },
    );
  });
  const nodeFieldsB = { minted: rB.minted, minted_deduped: rB.minted_deduped, live_node_id: rB.live_node_id, mint_reason: rB.mint_reason };

  // the node is UNAFFECTED by the edge failure (additive guarantee)
  assert.strictEqual(rB.minted, true, 'the node still minted despite the edge failure');
  assert.deepStrictEqual(nodeFieldsB, nodeFieldsA, 'the node-result fields are byte-identical across edge-success and edge-failure');
  // the edge failure is surfaced + observable
  assert.strictEqual(rB.edge_minted, false, 'the edge did NOT mint');
  assert.ok(typeof rB.edge_reason === 'string' && rB.edge_reason.length > 0, 'a surfaced edge_reason');
  assert.strictEqual(rB.edge_reason, 'store-dir', 'the store refused on the bad (file-not-dir) edgeDir');
  assert.ok(cap.alerted, 'the edge-failure refuse is OBSERVABLE (the store emits)');
  // the node was genuinely minted (non-vacuous: the live node exists on disk)
  assert.strictEqual(liveStore.listLiveNodes({ dir: liveDir(dirB) }).length, 1, 'the node is on disk even though the edge failed');
});

// ---------------------------------------------------------------------------
// LOOM_EDGE_SIGNING_KEY-set-yet-UNSIGNED: the production wire (NO edgeSigner) NEVER signs with the
// ambient env key. Set the env to a real ed25519 PEM, run the production path, assert the edge is
// UNSIGNED and the authenticated lane rejects it (hacker H2).
// ---------------------------------------------------------------------------

test('LOOM_EDGE_SIGNING_KEY set, production wire (no edgeSigner) still mints an UNSIGNED edge (hacker H2)', () => {
  const dir = tmp();
  const live = liveDir(dir);
  const edges = edgeDir(dir);
  attest(dir);
  const kp = generateEdgeKeypair();
  const prev = process.env.LOOM_EDGE_SIGNING_KEY;
  process.env.LOOM_EDGE_SIGNING_KEY = kp.privateKeyPem;   // the ambient signing key is PRESENT
  let r;
  try {
    // the PRODUCTION wire: NO edgeSigner injected -> the store's signer is undefined -> UNSIGNED.
    r = cli.runRecordMerge(
      { pr: PR, outcome: 'merged', mergeSha: MERGE_SHA_HEX64 },
      { dir, liveDir: live, edgeDir: edges, now: NOW },
    );
  } finally {
    if (prev === undefined) delete process.env.LOOM_EDGE_SIGNING_KEY;
    else process.env.LOOM_EDGE_SIGNING_KEY = prev;
  }
  assert.strictEqual(r.edge_minted, true);
  assert.strictEqual(r.edge_signed, false, 'the production wire never signs (env key present but ignored)');
  const edge = edgeStore.loadWorldAnchorEdge(r.edge_id, { dir: edges });
  assert.strictEqual(edge.sig_alg, undefined, 'load-back: the edge carries NO sig_alg (unsigned)');
  // even with the matching pubkey handed to the verifier, an unsigned edge is NOT in the authenticated lane
  const admitted = edgeStore.authenticatedWorldAnchorIds([edge], { verifyKey: kp.publicKeyPem });
  assert.strictEqual(admitted.size, 0, 'an unsigned edge enters NO authenticated lane (gates nothing)');
});

test('edge_signed is PERSISTED truth: a supplied-but-FAILING signer -> UNSIGNED -> edge_signed:false (VALIDATE hacker H1)', () => {
  const dir = tmp();
  const live = liveDir(dir);
  const edges = edgeDir(dir);
  attest(dir);
  // a signer that IS supplied but yields a non-canonical sig: the store degrades the edge to UNSIGNED +
  // emits sign-failed. edge_signed must reflect the ON-DISK truth (false), NOT the mere presence of the
  // signer function (which would be a fail-silent lie - the field becomes load-bearing under PR-A2).
  const { r } = captureAlert(() => cli.runRecordMerge(
    { pr: PR, outcome: 'merged', mergeSha: MERGE_SHA_HEX64 },
    { dir, liveDir: live, edgeDir: edges, now: NOW, edgeSigner: () => 'not-a-canonical-sig' },
  ));
  assert.strictEqual(r.edge_minted, true, 'the edge still persists (a sign-failure degrades to unsigned, no data loss)');
  assert.strictEqual(r.edge_signed, false, 'edge_signed is the PERSISTED truth: a failed signer is NOT reported as signed');
  assert.strictEqual(edgeStore.loadWorldAnchorEdge(r.edge_id, { dir: edges }).sig_alg, undefined, 'load-back confirms unsigned on disk');
});

// ---------------------------------------------------------------------------
// W3d-lite composition: the lane composes given 3 INJECTED seams (an ephemeral edgeSigner, a
// verifyKey, liveSources:['world-anchor']). POSITIVE arm: a signed edge -> authenticatedWorldAnchorIds
// -> deriveWorldAnchorSource='world-anchor' -> buildRankingWeights({liveSources:['world-anchor']})
// yields a positive weight. NEGATIVE arm: the production (unsigned, no-key) edge -> 'mock' ->
// admitWeightForRanking = 0. The REAL ~/.claude/lab-state edge dir is snapshotted before / asserted
// byte-unchanged after / temp dirs burned in a finally (the #444 W3d-lite pattern).
// ---------------------------------------------------------------------------

function digestDir(dir) {
  let entries;
  try { entries = fs.readdirSync(dir).sort(); } catch { return 'ABSENT'; }
  const h = crypto.createHash('sha256');
  for (const name of entries) {
    h.update(name);
    try { h.update(fs.readFileSync(path.join(dir, name))); } catch { h.update('UNREADABLE'); }
  }
  return h.digest('hex');
}

test('W3d-lite composition: signed edge -> world-anchor -> positive weight; unsigned -> mock -> 0 (3 injected seams)', () => {
  const realEdgeDir = edgeStore.DEFAULT_DIR;
  const beforeDigest = digestDir(realEdgeDir);   // snapshot the REAL lab-state edge dir
  const dir = tmp();
  const live = liveDir(dir);
  const edges = edgeDir(dir);
  try {
    attest(dir);
    const kp = generateEdgeKeypair();
    const edgeSigner = (id) => signEdgeId(id, { privateKeyPem: kp.privateKeyPem });

    // ---- POSITIVE arm: inject the ephemeral edgeSigner -> a SIGNED edge ----
    const rSigned = cli.runRecordMerge(
      { pr: PR, outcome: 'merged', mergeSha: MERGE_SHA_HEX64 },
      { dir, liveDir: live, edgeDir: edges, edgeSigner, now: NOW },
    );
    assert.strictEqual(rSigned.edge_minted, true);
    assert.strictEqual(rSigned.edge_signed, true, 'an injected edgeSigner produces a SIGNED edge');
    const signedEdges = edgeStore.listWorldAnchorEdges({ dir: edges });
    const admitted = edgeStore.authenticatedWorldAnchorIds(signedEdges, { verifyKey: kp.publicKeyPem });
    assert.strictEqual(admitted.has(rSigned.live_node_id), true, 'the signed edge admits the node to the authenticated lane');
    const src = edgeStore.deriveWorldAnchorSource({ node_id: rSigned.live_node_id }, signedEdges, { verifyKey: kp.publicKeyPem });
    assert.strictEqual(src, 'world-anchor', 'the admitted node derives the world-anchor source');
    const weights = buildRankingWeights(
      [{ lesson_signature: 'lesson:boundary-contract|unguarded-edge-case|handle-edge-explicitly', verdict: 'HARDEN', source: src }],
      { liveSources: ['world-anchor'] },
    );
    assert.ok(weights['lesson:boundary-contract|unguarded-edge-case|handle-edge-explicitly'] > 0, 'with the source injected live, the lane yields a positive weight');

    // ---- NEGATIVE arm: the PRODUCTION (unsigned, no-key, frozen-LIVE_SOURCES) path is inert ----
    const dir2 = tmp();
    try {
      attest(dir2);
      const rUnsigned = cli.runRecordMerge(
        { pr: PR, outcome: 'merged', mergeSha: MERGE_SHA_HEX64 },
        { dir: dir2, liveDir: liveDir(dir2), edgeDir: edgeDir(dir2), now: NOW },   // NO edgeSigner
      );
      const unsignedEdges = edgeStore.listWorldAnchorEdges({ dir: edgeDir(dir2) });
      // no verifyKey -> deriveWorldAnchorSource fails closed to 'mock'
      const srcProd = edgeStore.deriveWorldAnchorSource({ node_id: rUnsigned.live_node_id }, unsignedEdges, {});
      assert.strictEqual(srcProd, 'mock', 'the production unsigned edge derives mock (no verifyKey)');
      // and mock is NOT an admitted production source (the frozen-empty LIVE_SOURCES default)
      assert.strictEqual(admitWeightForRanking({ source: srcProd, weight: 1 }), 0, 'mock admits ZERO weight in production (frozen LIVE_SOURCES)');
    } finally {
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.strictEqual(digestDir(realEdgeDir), beforeDigest, 'the REAL lab-state edge dir is byte-unchanged (the composition only touched temp dirs)');
});

console.log(`item5-merge-edge-wire.test.js: ${passed} passed`);
