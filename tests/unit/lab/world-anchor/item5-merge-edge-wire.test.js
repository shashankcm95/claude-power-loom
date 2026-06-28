#!/usr/bin/env node

// tests/unit/lab/world-anchor/item5-merge-edge-wire.test.js
//
// Autonomous-SDE ladder item 3 (PR-3) - the gh-verified merge -> world-anchored-by edge mint WIRE
// (SHADOW, UNSIGNED), REHOMED onto the new minter (world-anchor-mint.js). A gh-verified merge-outcome
// RECORD (#451) mints a world_anchored NODE (item 3) AND, additively, ONE world-anchored-by EDGE binding
// that node to the KERNEL-SEALED `record.approval_hash` (the rebind PR-3 does) - NOT `att.diff_hash` (the
// old anchor). The edge is UNSIGNED by default (the off-host signer is the separate PR-A2 vehicle); it
// gates NOTHING (LIVE_SOURCES frozen-empty, no production consumer admits the world-anchor source).
//
// We drive mintFromMergeOutcome (the gated entry the cli auto-mint arm calls). Mirrors cli.test.js STYLE
// (node:assert + a light test() runner + LOOM_LAB_STATE_DIR pinned BEFORE the store modules are required
// + the attest() fixture shape + the stderr-capture pattern) - the lab convention (run via `node <file>`,
// NOT node:test).

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
const { mintFromMergeOutcome } = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'world-anchor-mint.js'));
const store = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'world-anchor-store.js'));
const edgeStore = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'world-anchor-edge-store.js'));
const outcomeStore = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'merge-outcome-store.js'));
const { generateEdgeKeypair, signEdgeId } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'edge-attestation'));
const { buildRankingWeights, admitWeightForRanking } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'weight-source-gate'));

let passed = 0;
function test(name, fn) { fn(); passed += 1; }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-item3-wire-')); }

const REPO_NAME = 'octo/widget';
const PR_URL = 'https://github.com/octo/widget/pull/77';
const PR_NUMBER = 77;
const LESSON_SIG = 'lesson:boundary-contract|unguarded-edge-case|handle-edge-explicitly';
// The KERNEL-SEALED approval_hash (HEX64) the edge binds (the rebind target). DIFFERENT from the
// attestation's diff_hash so a wire that bound to_delta_ref to att.diff_hash would FORGE the binding.
const APPROVAL_HASH = 'a'.repeat(64);
const FIXTURE_DIFF_HASH = 'b'.repeat(64);
const MERGE_SHA40 = 'c'.repeat(40);
const NOW = '2026-06-28T12:00:00.000Z';

// The attestation fixture (mirrors cli.test.js's attest()). diff_hash is a known HEX64; approval_hash
// matches the record so the cross-check is clean. Returns { anchor_id, diff_hash }.
function attest(dir, over = {}) {
  const att = {
    repo: REPO_NAME, issueRef: 42,
    pr_url: PR_URL, pr_number: PR_NUMBER, branch: 'b',
    base_sha: 'f853934b61000ff076cea60c206db225e3ed89f0', diff_hash: FIXTURE_DIFF_HASH,
    lesson_signature: LESSON_SIG,
    built_by: 'anonymous-actor', approval_hash: APPROVAL_HASH, emitted_at: '2026-06-25T00:00:00.000Z',
    ...over,
  };
  const w = store.recordAttestation(att, { dir });
  assert.strictEqual(w.ok, true, 'fixture attestation lands');
  return { anchor_id: w.anchor_id, diff_hash: att.diff_hash };
}

// Write a gh-verified merge-outcome RECORD into the outcome store. Returns the join_key_id.
function recordOutcome(dir, over = {}) {
  const rec = {
    join_key_id: over.join_key_id || ('d'.repeat(64)),
    repo: REPO_NAME, pr_number: PR_NUMBER, pr_url: PR_URL,
    approval_hash: APPROVAL_HASH, outcome: 'merged',
    merge_commit_sha: MERGE_SHA40, observed_at: NOW,
    ...over,
  };
  const w = outcomeStore.recordMergeOutcome(rec, { dir });
  assert.strictEqual(w.ok, true, `fixture merge-outcome lands (got ${w.reason})`);
  return w.join_key_id;
}

function liveDir(d) { return path.join(d, 'live'); }
function edgeDir(d) { return path.join(d, 'edges'); }
function outcomeDir(d) { return path.join(d, 'outcomes'); }

// ---------------------------------------------------------------------------
// Happy: a merged record mints the node AND an UNSIGNED world-anchored-by edge bound to approval_hash.
// ---------------------------------------------------------------------------

test('a merged record mints the node AND an UNSIGNED world-anchored-by edge', () => {
  const dir = tmp();
  attest(dir);
  const jkid = recordOutcome(outcomeDir(dir));
  const r = mintFromMergeOutcome({ join_key_id: jkid }, { anchorDir: dir, liveDir: liveDir(dir), edgeDir: edgeDir(dir), outcomeDir: outcomeDir(dir) });
  assert.strictEqual(r.minted, true, 'the node minted');
  assert.ok(/^[0-9a-f]{64}$/.test(r.node_id), 'a 64-hex live node id');
  assert.strictEqual(r.edge_minted, true, 'the edge minted');
  assert.strictEqual(r.edge_signed, false, 'production supplies NO signer -> the edge is UNSIGNED');
  assert.ok(/^[0-9a-f]{64}$/.test(r.edge_id), 'a 64-hex edge id');
  const edge = edgeStore.loadWorldAnchorEdge(r.edge_id, { dir: edgeDir(dir) });
  assert.ok(edge, 'the edge file exists in edgeDir + loads back');
  assert.strictEqual(edge.from_node_id, r.node_id, 'from_node_id is the minted node');
  assert.strictEqual(edge.edge_type, 'world-anchored-by', 'the world-anchored-by edge type');
  assert.strictEqual(edge.sig_alg, undefined, 'an unsigned edge has no sig_alg key (SHADOW)');
});

// ---------------------------------------------------------------------------
// to_delta_ref is the SEALED record.approval_hash, NEVER att.diff_hash (the PR-3 rebind). att.diff_hash
// is a DIFFERENT 64-hex; a wire that bound it would forge the trust anchor.
// ---------------------------------------------------------------------------

test('to_delta_ref binds the SEALED record.approval_hash, NEVER att.diff_hash (the PR-3 rebind)', () => {
  const dir = tmp();
  const { diff_hash } = attest(dir);
  const jkid = recordOutcome(outcomeDir(dir));
  assert.notStrictEqual(APPROVAL_HASH, diff_hash, 'precondition: approval_hash differs from att.diff_hash');
  const r = mintFromMergeOutcome({ join_key_id: jkid }, { anchorDir: dir, liveDir: liveDir(dir), edgeDir: edgeDir(dir), outcomeDir: outcomeDir(dir) });
  const edge = edgeStore.loadWorldAnchorEdge(r.edge_id, { dir: edgeDir(dir) });
  assert.strictEqual(edge.to_delta_ref, APPROVAL_HASH, 'the edge binds the kernel-sealed record.approval_hash');
  assert.notStrictEqual(edge.to_delta_ref, diff_hash, 'the edge NEVER binds att.diff_hash (the old anchor)');
});

// ---------------------------------------------------------------------------
// Dedups on re-mint: PROVES recorded_at = record.observed_at (the stable per-record timestamp). A fresh
// Date() would put a different recorded_at into bodiesEqual and COLLIDE-refuse instead of dedup.
// ---------------------------------------------------------------------------

test('re-mint (same record) DEDUPS the edge - proves recorded_at = record.observed_at stability (NOT a collision)', () => {
  const dir = tmp();
  attest(dir);
  const jkid = recordOutcome(outcomeDir(dir));
  const opts = { anchorDir: dir, liveDir: liveDir(dir), edgeDir: edgeDir(dir), outcomeDir: outcomeDir(dir) };
  const r1 = mintFromMergeOutcome({ join_key_id: jkid }, opts);
  const r2 = mintFromMergeOutcome({ join_key_id: jkid }, opts);
  assert.strictEqual(r1.edge_minted, true, 'first mint mints the edge');
  assert.strictEqual(r1.edge_deduped, false, 'first edge write is a genuine first write');
  assert.strictEqual(r2.edge_minted, true, 'second mint re-mints idempotently (not a collision)');
  assert.strictEqual(r2.edge_deduped, true, 'the second edge dedups (recorded_at stable across re-mint)');
  assert.notStrictEqual(r2.edge_reason, 'collision', 'a stable recorded_at means NO collision on re-mint');
  assert.strictEqual(r1.edge_id, r2.edge_id, 'same content-address');
  assert.strictEqual(edgeStore.listWorldAnchorEdges({ dir: edgeDir(dir) }).length, 1, 'exactly one edge file');
});

// ---------------------------------------------------------------------------
// LOOM_EDGE_SIGNING_KEY-set-yet-UNSIGNED: the production mint (NO edgeSigner) NEVER signs with the
// ambient env key. Set the env to a real ed25519 PEM, run the production path, assert the edge is
// UNSIGNED and the authenticated lane rejects it (hacker H2).
// ---------------------------------------------------------------------------

test('LOOM_EDGE_SIGNING_KEY set, production mint (no edgeSigner) still mints an UNSIGNED edge (hacker H2)', () => {
  const dir = tmp();
  attest(dir);
  const jkid = recordOutcome(outcomeDir(dir));
  const kp = generateEdgeKeypair();
  const prev = process.env.LOOM_EDGE_SIGNING_KEY;
  process.env.LOOM_EDGE_SIGNING_KEY = kp.privateKeyPem;   // the ambient signing key is PRESENT
  let r;
  try {
    // the PRODUCTION mint: NO edgeSigner injected -> the store's signer is undefined -> UNSIGNED.
    r = mintFromMergeOutcome({ join_key_id: jkid }, { anchorDir: dir, liveDir: liveDir(dir), edgeDir: edgeDir(dir), outcomeDir: outcomeDir(dir) });
  } finally {
    if (prev === undefined) delete process.env.LOOM_EDGE_SIGNING_KEY;
    else process.env.LOOM_EDGE_SIGNING_KEY = prev;
  }
  assert.strictEqual(r.edge_minted, true);
  assert.strictEqual(r.edge_signed, false, 'the production mint never signs (env key present but ignored)');
  const edge = edgeStore.loadWorldAnchorEdge(r.edge_id, { dir: edgeDir(dir) });
  assert.strictEqual(edge.sig_alg, undefined, 'load-back: the edge carries NO sig_alg (unsigned)');
  const admitted = edgeStore.authenticatedWorldAnchorIds([edge], { verifyKey: kp.publicKeyPem });
  assert.strictEqual(admitted.size, 0, 'an unsigned edge enters NO authenticated lane (gates nothing)');
});

test('edge_signed is PERSISTED truth: a supplied-but-FAILING signer -> UNSIGNED -> edge_signed:false (VALIDATE hacker H1)', () => {
  const dir = tmp();
  attest(dir);
  const jkid = recordOutcome(outcomeDir(dir));
  // a signer that IS supplied but yields a non-canonical sig: the store degrades the edge to UNSIGNED +
  // emits sign-failed. edge_signed must reflect the ON-DISK truth (false), NOT the mere presence of the
  // signer function (which would be a fail-silent lie - the field becomes load-bearing under PR-A2).
  const origErr = process.stderr.write;
  process.stderr.write = () => true;   // suppress the sign-failed alert
  let r;
  try {
    r = mintFromMergeOutcome(
      { join_key_id: jkid },
      { anchorDir: dir, liveDir: liveDir(dir), edgeDir: edgeDir(dir), outcomeDir: outcomeDir(dir), edgeSigner: () => 'not-a-canonical-sig' },
    );
  } finally { process.stderr.write = origErr; }
  assert.strictEqual(r.edge_minted, true, 'the edge still persists (a sign-failure degrades to unsigned, no data loss)');
  assert.strictEqual(r.edge_signed, false, 'edge_signed is the PERSISTED truth: a failed signer is NOT reported as signed');
  assert.strictEqual(edgeStore.loadWorldAnchorEdge(r.edge_id, { dir: edgeDir(dir) }).sig_alg, undefined, 'load-back confirms unsigned on disk');
});

// ---------------------------------------------------------------------------
// W3d-lite composition: the lane composes given 3 INJECTED seams (an ephemeral edgeSigner, a verifyKey,
// liveSources:['world-anchor']). POSITIVE arm: a signed edge -> authenticatedWorldAnchorIds ->
// deriveWorldAnchorSource='world-anchor' -> buildRankingWeights({liveSources:['world-anchor']}) yields a
// positive weight. NEGATIVE arm: the production (unsigned, no-key) edge -> 'mock' -> admitWeightForRanking
// = 0. The REAL ~/.claude/lab-state edge dir is snapshotted before / asserted byte-unchanged after / temp
// dirs burned in a finally (the #444 W3d-lite pattern, rehomed onto the new mint path).
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

test('W3d-lite composition (rehomed): signed edge -> world-anchor -> positive weight; unsigned -> mock -> 0 (3 injected seams)', () => {
  const realEdgeDir = edgeStore.DEFAULT_DIR;
  const beforeDigest = digestDir(realEdgeDir);   // snapshot the REAL lab-state edge dir
  const dir = tmp();
  try {
    attest(dir);
    const jkid = recordOutcome(outcomeDir(dir));
    const kp = generateEdgeKeypair();
    const edgeSigner = (id) => signEdgeId(id, { privateKeyPem: kp.privateKeyPem });

    // ---- POSITIVE arm: inject the ephemeral edgeSigner -> a SIGNED edge ----
    const rSigned = mintFromMergeOutcome(
      { join_key_id: jkid },
      { anchorDir: dir, liveDir: liveDir(dir), edgeDir: edgeDir(dir), outcomeDir: outcomeDir(dir), edgeSigner },
    );
    assert.strictEqual(rSigned.edge_minted, true);
    assert.strictEqual(rSigned.edge_signed, true, 'an injected edgeSigner produces a SIGNED edge');
    const signedEdges = edgeStore.listWorldAnchorEdges({ dir: edgeDir(dir) });
    const admitted = edgeStore.authenticatedWorldAnchorIds(signedEdges, { verifyKey: kp.publicKeyPem });
    assert.strictEqual(admitted.has(rSigned.node_id), true, 'the signed edge admits the node to the authenticated lane');
    const src = edgeStore.deriveWorldAnchorSource({ node_id: rSigned.node_id }, signedEdges, { verifyKey: kp.publicKeyPem });
    assert.strictEqual(src, 'world-anchor', 'the admitted node derives the world-anchor source');
    const weights = buildRankingWeights(
      [{ lesson_signature: LESSON_SIG, verdict: 'HARDEN', source: src }],
      { liveSources: ['world-anchor'] },
    );
    assert.ok(weights[LESSON_SIG] > 0, 'with the source injected live, the lane yields a positive weight');

    // ---- NEGATIVE arm: the PRODUCTION (unsigned, no-key, frozen-LIVE_SOURCES) path is inert ----
    const dir2 = tmp();
    try {
      attest(dir2);
      const jkid2 = recordOutcome(outcomeDir(dir2));
      const rUnsigned = mintFromMergeOutcome(
        { join_key_id: jkid2 },
        { anchorDir: dir2, liveDir: liveDir(dir2), edgeDir: edgeDir(dir2), outcomeDir: outcomeDir(dir2) },   // NO edgeSigner
      );
      const unsignedEdges = edgeStore.listWorldAnchorEdges({ dir: edgeDir(dir2) });
      const srcProd = edgeStore.deriveWorldAnchorSource({ node_id: rUnsigned.node_id }, unsignedEdges, {});   // no verifyKey
      assert.strictEqual(srcProd, 'mock', 'the production unsigned edge derives mock (no verifyKey)');
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
