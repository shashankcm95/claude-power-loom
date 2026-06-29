#!/usr/bin/env node

// tests/unit/lab/world-anchor/world-anchor-mint.test.js
//
// Autonomous-SDE ladder item 3 (PR-3) - the gh-verified-lane minter. mintFromMergeOutcome consumes the
// kernel-sealed, gh-verified merge-outcome RECORD (#451) and mints the world_anchored NODE + the
// world-anchored-by EDGE, binding the edge's `to_delta_ref` to the KERNEL-SEALED `record.approval_hash`
// and the node's `merge_sha` to the gh-verified `record.merge_commit_sha` - NOT `att.diff_hash` + a
// pasted sha (the legacy unsafe path, removed in this PR).
//
// We drive mintFromMergeOutcome directly (the gated entry; the cli auto-mint arm calls it after a merged
// record). Mirrors cli.test.js STYLE (node:assert + a light test() runner + LOOM_LAB_STATE_DIR pinned
// BEFORE the store modules are required + the attest() fixture shape + the stderr-capture pattern) - the
// lab convention (run via `node <file>`, NOT node:test).

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
const MINT_FILE = path.join(REPO, 'packages', 'lab', 'world-anchor', 'world-anchor-mint.js');
const { mintFromMergeOutcome } = require(MINT_FILE);
const store = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'world-anchor-store.js'));
const outcomeStore = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'merge-outcome-store.js'));
const liveStore = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'live-recall-store.js'));
const edgeStore = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'world-anchor-edge-store.js'));

let passed = 0;
function test(name, fn) { fn(); passed += 1; }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-wamint-')); }

// PR-2 issue-bound the static grandfather seed to (Priivacy-ai/spec-kitty, 2097) - the happy-path fixture
// must join THAT tuple (the floor is no longer signature-only; it is the (repo-slug, issue_ref, sig)
// exact-set). So these constants are the grandfather's tuple, and ISSUE_REF below matches the seed.
const REPO_NAME = 'Priivacy-ai/spec-kitty';
const PR_URL = 'https://github.com/Priivacy-ai/spec-kitty/pull/2137';
const PR_NUMBER = 2137;
const ISSUE_REF = 2097;   // the grandfather seed's issue_ref (Branch A joins on this)
// The kernel-SEALED approval_hash (HEX64) - the EDGE's to_delta_ref binds THIS.
const APPROVAL = 'a'.repeat(64);
// The attestation's diff_hash (HEX64) - the LEGACY edge bound this; the new edge must NOT.
const DIFF_HASH = 'b'.repeat(64);
// A real 40-hex gh merge_commit_sha (the node's world-evidence merge_sha; gh-verified).
const MERGE_SHA = 'c0ffee'.repeat(6) + 'cafe';   // 40 hex chars
const OBSERVED_AT = '2026-06-28T12:00:00.000Z';
// The LESSON_2137 signature (the grandfather seed's built cluster key).
const LESSON_SIG = 'lesson:boundary-contract|unguarded-edge-case|handle-edge-explicitly';

function liveDir(d) { return path.join(d, 'live'); }
function edgeDir(d) { return path.join(d, 'edges'); }
function outcomeDir(d) { return path.join(d, 'outcomes'); }
// PR-2: pendingDir is now part of the FOLD-B all-or-nothing dir set (the captured floor store). The
// happy-path calls must supply ALL FIVE keys; this empty-by-default captured store leaves Branch B with
// zero candidates, so these LESSON_2137-grandfather (Branch A) tests still resolve exactly-one.
function pendingDir(d) { return path.join(d, 'pending'); }

// Suppress + capture the egress alerts every refuse path emits (observable refuses).
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

// Write the attestation the minter resolves by the record's (repo, pr_number, pr_url) tuple. Its
// lesson_signature drives the floor lookup; its approval_hash is the ADVISORY cross-check side. Returns
// the anchor_id.
function attest(dir, over = {}) {
  const att = {
    repo: REPO_NAME, issueRef: ISSUE_REF,
    pr_url: PR_URL, pr_number: PR_NUMBER, branch: 'b',
    base_sha: 'f853934b61000ff076cea60c206db225e3ed89f0', diff_hash: DIFF_HASH,
    lesson_signature: LESSON_SIG,
    built_by: 'anonymous-actor', approval_hash: APPROVAL, emitted_at: '2026-06-25T00:00:00.000Z',
    ...over,
  };
  const w = store.recordAttestation(att, { dir });
  assert.strictEqual(w.ok, true, `fixture attestation lands (got ${w.reason})`);
  return w.anchor_id;
}

// OQ-3 W3 — the broker-sig provenance bundle the merge-outcome carries forward for PR-A2 (RFC §5.4). A
// 64-byte canonical-base64 broker_sig passes the store SHAPE gate (the mint reads only record.approval_hash etc.).
const W3_BROKER_SIG = crypto.randomBytes(64).toString('base64');
function validBundle(over = {}) {
  return { lesson_commitment: 'e'.repeat(64), approvedAt: 1735430400000, nonce: 'nonce-abc', key_id: 'v0', broker_sig: W3_BROKER_SIG, ...over };
}

// Write a gh-verified merge-outcome RECORD into the outcome store. The join_key_id is a content-addressed
// HEX64 (the merge-outcome store treats it as OPAQUE = the filename; only join_key_id===filename + the
// content_hash seal are verified). Returns the join_key_id.
function recordOutcome(dir, over = {}) {
  const rec = {
    join_key_id: over.join_key_id || ('d'.repeat(64)),
    repo: REPO_NAME, pr_number: PR_NUMBER, pr_url: PR_URL,
    approval_hash: APPROVAL,
    outcome: 'merged',
    merge_commit_sha: MERGE_SHA,
    observed_at: OBSERVED_AT,
    ...validBundle(),
    ...over,
  };
  const w = outcomeStore.recordMergeOutcome(rec, { dir });
  assert.strictEqual(w.ok, true, `fixture merge-outcome lands (got ${w.reason})`);
  return w.join_key_id;
}

// ---------------------------------------------------------------------------
// Happy: a merged record mints the node AND an UNSIGNED edge bound to the SEALED approval_hash.
// ---------------------------------------------------------------------------

test('a merged record mints the node + an UNSIGNED edge; to_delta_ref === record.approval_hash, node merge_sha === record.merge_commit_sha', () => {
  const dir = tmp();
  attest(dir);
  const jkid = recordOutcome(outcomeDir(dir));
  const r = mintFromMergeOutcome(
    { join_key_id: jkid },
    { anchorDir: dir, liveDir: liveDir(dir), edgeDir: edgeDir(dir), outcomeDir: outcomeDir(dir), pendingDir: pendingDir(dir) },
  );
  assert.strictEqual(r.minted, true, 'the node minted');
  assert.ok(/^[0-9a-f]{64}$/.test(r.node_id), 'a 64-hex node id');
  assert.strictEqual(r.edge_minted, true, 'the edge minted');
  assert.strictEqual(r.edge_signed, false, 'production supplies NO signer -> UNSIGNED');
  assert.ok(/^[0-9a-f]{64}$/.test(r.edge_id), 'a 64-hex edge id');
  // the node binds the gh-verified merge_commit_sha (world-evidence), NEVER a pasted arg
  const node = liveStore.readLiveNode(r.node_id, { dir: liveDir(dir) });
  assert.ok(node, 'the node is readable');
  assert.strictEqual(node.merge_sha, MERGE_SHA, 'node merge_sha === record.merge_commit_sha (gh-verified)');
  // the edge binds the KERNEL-SEALED approval_hash, NEVER att.diff_hash
  const edge = edgeStore.loadWorldAnchorEdge(r.edge_id, { dir: edgeDir(dir) });
  assert.ok(edge, 'the edge is readable');
  assert.strictEqual(edge.to_delta_ref, APPROVAL, 'to_delta_ref === record.approval_hash (kernel-sealed)');
  assert.notStrictEqual(edge.to_delta_ref, DIFF_HASH, 'the edge NEVER binds att.diff_hash (the old anchor)');
  assert.strictEqual(edge.from_node_id, r.node_id, 'from_node_id is the minted node');
  assert.strictEqual(edge.edge_type, 'world-anchored-by', 'the world-anchored-by edge type');
  assert.strictEqual(edge.sig_alg, undefined, 'an unsigned edge has no sig_alg key (SHADOW)');
});

test('mintFromMergeOutcome is TOTAL: it never throws on a happy mint and returns the documented shape', () => {
  const dir = tmp();
  attest(dir);
  const jkid = recordOutcome(outcomeDir(dir));
  let r;
  assert.doesNotThrow(() => {
    r = mintFromMergeOutcome({ join_key_id: jkid }, { anchorDir: dir, liveDir: liveDir(dir), edgeDir: edgeDir(dir), outcomeDir: outcomeDir(dir), pendingDir: pendingDir(dir) });
  });
  for (const k of ['minted', 'node_id', 'deduped', 'edge_minted', 'edge_id', 'edge_deduped', 'edge_signed']) {
    assert.ok(k in r, `the return shape carries ${k}`);
  }
});

test('mintFromMergeOutcome({join_key_id}, null) is TOTAL: returns a refuse, does NOT throw (hacker L1)', () => {
  // FOLD 1: a null/non-object opts must normalize to {} - the documented TOTAL contract. A bare opts.*
  // read on `null` would throw a TypeError; the guard at the top normalizes it. With no outcomeDir the
  // record is unreadable (it falls back to the real default dir, which is the pinned throwaway base + a
  // non-existent join_key_id), so the result is a clean refuse, never a crash.
  let r;
  assert.doesNotThrow(() => { r = mintFromMergeOutcome({ join_key_id: 'd'.repeat(64) }, null); });
  assert.strictEqual(r.minted, false, 'a null opts yields a refuse');
  assert.ok(typeof r.mint_reason === 'string' && r.mint_reason.length > 0, 'a refuse reason is surfaced, not a thrown error');
  // and a non-object (array) opts is also normalized
  let r2;
  assert.doesNotThrow(() => { r2 = mintFromMergeOutcome({ join_key_id: 'd'.repeat(64) }, []); });
  assert.strictEqual(r2.minted, false, 'an array opts also yields a refuse (normalized to {})');
});

// ---------------------------------------------------------------------------
// FOLD B (isolation is all-or-nothing): a PARTIAL per-store dir set silently lets the un-wired stores
// fall back to the REAL ~/.claude/lab-state, cross-writing real state. The minter fail-closes a partial
// set (incomplete-dir-wiring) + a stray legacy `dir` key (unsupported-dir-key). Both are TOTAL refuses.
// ---------------------------------------------------------------------------

test('partial dir wiring (outcomeDir only) refuses incomplete-dir-wiring + emits, never touches real state', () => {
  const dir = tmp();
  attest(dir);
  const jkid = recordOutcome(outcomeDir(dir));
  const { r, alerts } = captureAlerts(() => mintFromMergeOutcome(
    { join_key_id: jkid },
    { outcomeDir: outcomeDir(dir) },   // only 1 of 4 -> incomplete
  ));
  assert.strictEqual(r.minted, false, 'a partial dir set refuses');
  assert.strictEqual(r.mint_reason, 'incomplete-dir-wiring');
  assert.ok(alerts.some((a) => JSON.stringify(a).includes('incomplete-dir-wiring')), 'the partial-wiring refuse is observable');
  // non-vacuous: nothing was minted (the guard short-circuits BEFORE any store read/write)
  assert.strictEqual(liveStore.listLiveNodes({ dir: liveDir(dir) }).length, 0, 'no node minted on a partial dir set');
});

test('a stray legacy `dir` key refuses unsupported-dir-key + emits (never silently ignored)', () => {
  const dir = tmp();
  attest(dir);
  const jkid = recordOutcome(outcomeDir(dir));
  const { r, alerts } = captureAlerts(() => mintFromMergeOutcome(
    { join_key_id: jkid },
    { dir, outcomeDir: outcomeDir(dir), liveDir: liveDir(dir), edgeDir: edgeDir(dir) },   // legacy `dir` present
  ));
  assert.strictEqual(r.minted, false, 'a stray `dir` key refuses');
  assert.strictEqual(r.mint_reason, 'unsupported-dir-key');
  assert.ok(alerts.some((a) => JSON.stringify(a).includes('unsupported-dir-key')), 'the unsupported-dir-key refuse is observable');
});

test('a full FIVE-dir set passes the wiring guard and mints (the all-or-nothing happy case)', () => {
  const dir = tmp();
  attest(dir);
  const jkid = recordOutcome(outcomeDir(dir));
  const r = mintFromMergeOutcome(
    { join_key_id: jkid },
    { anchorDir: dir, outcomeDir: outcomeDir(dir), liveDir: liveDir(dir), edgeDir: edgeDir(dir), pendingDir: pendingDir(dir) },
  );
  assert.strictEqual(r.minted, true, 'a complete FIVE-dir set mints');
  assert.strictEqual(r.edge_minted, true, 'and the edge mints');
});

// ---------------------------------------------------------------------------
// Identity derives from the VERIFIED attestation, never a caller field (hacker H2). The minter takes ONLY
// { join_key_id }; there is NO caller surface for a lesson body / merge_sha / approval_hash. Prove the
// lesson identity comes from the on-disk sealed attestation's lesson_signature, not anything passed in.
// ---------------------------------------------------------------------------

test('the lesson identity derives from the VERIFIED attestation, NOT a caller-supplied field (hacker H2)', () => {
  const dir = tmp();
  const anchor_id = attest(dir);
  const jkid = recordOutcome(outcomeDir(dir));
  // a hostile extra field on the opts object - it must be ignored entirely.
  const r = mintFromMergeOutcome(
    { join_key_id: jkid, lesson_signature: 'lesson:state-mutation|silent-coercion|fail-closed', lesson_body: 'attacker body', merge_sha: 'deadbeef' },
    { anchorDir: dir, liveDir: liveDir(dir), edgeDir: edgeDir(dir), outcomeDir: outcomeDir(dir), pendingDir: pendingDir(dir) },
  );
  assert.strictEqual(r.minted, true);
  const node = liveStore.readLiveNode(r.node_id, { dir: liveDir(dir) });
  const att = store.readAnchor(anchor_id, { dir });
  assert.strictEqual(node.lesson_signature, att.lesson_signature, 'identity from the sealed attestation');
  assert.notStrictEqual(node.lesson_signature, 'lesson:state-mutation|silent-coercion|fail-closed', 'the caller lesson_signature is ignored');
  assert.notStrictEqual(node.lesson_body, 'attacker body', 'the caller lesson_body is ignored');
  assert.notStrictEqual(node.merge_sha, 'deadbeef', 'the caller merge_sha is ignored (gh-verified record wins)');
});

// ---------------------------------------------------------------------------
// The approval-hash cross-check is ADVISORY: a divergent att.approval_hash EMITS but STILL mints,
// binding the KERNEL record.approval_hash regardless (D1 / hacker H1: never gate on the untrusted side).
// ---------------------------------------------------------------------------

test('approval-hash divergence (att != record) EMITS but STILL mints, binding record.approval_hash', () => {
  const dir = tmp();
  // the attestation carries a DIFFERENT approval_hash than the record (an honest stale attestation)
  const ATT_APPROVAL = 'e'.repeat(64);
  attest(dir, { approval_hash: ATT_APPROVAL });
  const jkid = recordOutcome(outcomeDir(dir));   // record.approval_hash = APPROVAL ('a'*64)
  assert.notStrictEqual(ATT_APPROVAL, APPROVAL, 'precondition: att and record approval_hash diverge');
  const { r, alerts } = captureAlerts(() => mintFromMergeOutcome(
    { join_key_id: jkid },
    { anchorDir: dir, liveDir: liveDir(dir), edgeDir: edgeDir(dir), outcomeDir: outcomeDir(dir), pendingDir: pendingDir(dir) },
  ));
  // a divergence is OBSERVABLE
  assert.ok(alerts.some((a) => JSON.stringify(a).includes('approval-hash-divergence')), 'the divergence emits an observable alert');
  // ...but it STILL mints (not a gate)
  assert.strictEqual(r.minted, true, 'a divergence does NOT block the mint');
  assert.strictEqual(r.edge_minted, true, 'the edge still mints');
  const edge = edgeStore.loadWorldAnchorEdge(r.edge_id, { dir: edgeDir(dir) });
  // and it binds the KERNEL record.approval_hash, never the (divergent) att.approval_hash
  assert.strictEqual(edge.to_delta_ref, APPROVAL, 'to_delta_ref binds the KERNEL record.approval_hash, never the att one');
  assert.notStrictEqual(edge.to_delta_ref, ATT_APPROVAL, 'the lab-written att.approval_hash is NEVER the binding source');
});

// ---------------------------------------------------------------------------
// Refuse paths - each fail-closed + OBSERVABLE (a distinguishing token on a NON-`reason` key).
// ---------------------------------------------------------------------------

test('merge-outcome-unreadable: an absent record refuses + emits at the minter layer (M1)', () => {
  const dir = tmp();
  attest(dir);
  // NO recordOutcome - the record does not exist
  const { r, alerts } = captureAlerts(() => mintFromMergeOutcome(
    { join_key_id: 'd'.repeat(64) },
    { anchorDir: dir, liveDir: liveDir(dir), edgeDir: edgeDir(dir), outcomeDir: outcomeDir(dir), pendingDir: pendingDir(dir) },
  ));
  assert.strictEqual(r.minted, false);
  assert.strictEqual(r.mint_reason, 'merge-outcome-unreadable');
  assert.ok(alerts.some((a) => JSON.stringify(a).includes('merge-outcome-unreadable')), 'the minter emits merge-outcome-unreadable');
});

test('no-match: a record whose PR tuple matches no attestation refuses + emits (the minter layer)', () => {
  const dir = tmp();
  // NO attestation written -> resolveAnchorForPr returns no-match
  const jkid = recordOutcome(outcomeDir(dir));
  const { r, alerts } = captureAlerts(() => mintFromMergeOutcome(
    { join_key_id: jkid },
    { anchorDir: dir, liveDir: liveDir(dir), edgeDir: edgeDir(dir), outcomeDir: outcomeDir(dir), pendingDir: pendingDir(dir) },
  ));
  assert.strictEqual(r.minted, false);
  assert.strictEqual(r.mint_reason, 'no-match');
  // resolveAnchorForPr emits its own world-anchor-unattested-merge AND the minter emits attestation-unreadable layer
  assert.ok(alerts.some((a) => JSON.stringify(a).includes('no-match') || JSON.stringify(a).includes('attestation-unreadable')), 'the no-match is observable');
});

test('ambiguous: >1 attestation for the PR tuple refuses + emits (fail-closed read-only, no node)', () => {
  const dir = tmp();
  // two attestations whose (repo, pr_number, pr_url) tuple matches but with different diff_hash -> two anchors
  attest(dir, { diff_hash: 'b'.repeat(64) });
  attest(dir, { diff_hash: '1'.repeat(64) });
  const jkid = recordOutcome(outcomeDir(dir));
  const { r, alerts } = captureAlerts(() => mintFromMergeOutcome(
    { join_key_id: jkid },
    { anchorDir: dir, liveDir: liveDir(dir), edgeDir: edgeDir(dir), outcomeDir: outcomeDir(dir), pendingDir: pendingDir(dir) },
  ));
  assert.strictEqual(r.minted, false);
  assert.strictEqual(r.mint_reason, 'ambiguous');
  assert.ok(alerts.some((a) => JSON.stringify(a).includes('ambiguous')), 'the ambiguous refuse is observable');
  assert.strictEqual(liveStore.listLiveNodes({ dir: liveDir(dir) }).length, 0, 'no node minted on an ambiguous resolve');
});

test('no-floor-lesson: a sealed signature off the orchestrator floor refuses + emits (M1)', () => {
  const dir = tmp();
  // a taxonomy-valid signature that is NOT in the orchestrator floor (a different cluster)
  attest(dir, { lesson_signature: 'lesson:data-parse|silent-coercion|fail-closed' });
  const jkid = recordOutcome(outcomeDir(dir));
  const { r, alerts } = captureAlerts(() => mintFromMergeOutcome(
    { join_key_id: jkid },
    { anchorDir: dir, liveDir: liveDir(dir), edgeDir: edgeDir(dir), outcomeDir: outcomeDir(dir), pendingDir: pendingDir(dir) },
  ));
  assert.strictEqual(r.minted, false);
  assert.strictEqual(r.mint_reason, 'no-floor-lesson');
  assert.ok(alerts.some((a) => JSON.stringify(a).includes('no-floor-lesson')), 'the no-floor-lesson refuse is observable');
  assert.strictEqual(liveStore.listLiveNodes({ dir: liveDir(dir) }).length, 0, 'no node for an off-floor lesson');
});

test('mintFromMergeOutcome is TOTAL on a planted-unreadable record: returns a refuse, never throws', () => {
  const dir = tmp();
  attest(dir);
  // plant a corrupt (non-JSON) record at a valid <64-hex>.json filename so verify-on-read returns null
  const od = outcomeDir(dir);
  fs.mkdirSync(od, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(od, 'd'.repeat(64) + '.json'), 'not json', { mode: 0o600 });
  let r;
  const { r: captured } = captureAlerts(() => {
    assert.doesNotThrow(() => {
      r = mintFromMergeOutcome({ join_key_id: 'd'.repeat(64) }, { anchorDir: dir, liveDir: liveDir(dir), edgeDir: edgeDir(dir), outcomeDir: od, pendingDir: pendingDir(dir) });
    });
    return r;
  });
  assert.strictEqual(captured.minted, false, 'a corrupt record refuses');
  assert.strictEqual(captured.mint_reason, 'merge-outcome-unreadable', 'verify-on-read null -> merge-outcome-unreadable');
});

// ---------------------------------------------------------------------------
// lesson-build-failed: TOTALITY (VERIFY M2). The floor lesson is wrapped in try/catch; a build throw
// emits lesson-build-failed + refuses, never crashes. We exercise it by injecting a buildLesson that
// throws (the minter's lesson-builder is opts-injectable for exactly this test seam).
// ---------------------------------------------------------------------------

test('lesson-build-failed: a throwing lesson builder emits + refuses, NEVER throws (M2 totality)', () => {
  const dir = tmp();
  attest(dir);
  const jkid = recordOutcome(outcomeDir(dir));
  let r;
  const { alerts } = captureAlerts(() => {
    assert.doesNotThrow(() => {
      r = mintFromMergeOutcome(
        { join_key_id: jkid },
        {
          anchorDir: dir, liveDir: liveDir(dir), edgeDir: edgeDir(dir), outcomeDir: outcomeDir(dir), pendingDir: pendingDir(dir),
          buildLesson: () => { throw new Error('boom'); },
        },
      );
    });
  });
  assert.strictEqual(r.minted, false, 'a build throw refuses');
  assert.strictEqual(r.mint_reason, 'lesson-build-failed');
  assert.ok(alerts.some((a) => JSON.stringify(a).includes('lesson-build-failed')), 'the lesson-build-failed refuse is observable');
});

// ---------------------------------------------------------------------------
// Additive byte-identical-node on an edge failure (D2). The node mint is the load-bearing result; an
// edge-mint failure (a foreign/file edgeDir) leaves the node minted:true byte-identical + surfaces
// edge_minted:false + edge_reason + an emitted alert. FAILS RED against the unwired minter first.
// ---------------------------------------------------------------------------

test('additive: an edge-FAILURE leaves the node byte-identical + surfaces edge_reason + an alert', () => {
  // run A: edge success (the reference node fields)
  const dirA = tmp();
  attest(dirA);
  const jkidA = recordOutcome(outcomeDir(dirA));
  const rA = mintFromMergeOutcome({ join_key_id: jkidA }, { anchorDir: dirA, liveDir: liveDir(dirA), edgeDir: edgeDir(dirA), outcomeDir: outcomeDir(dirA), pendingDir: pendingDir(dirA) });
  assert.strictEqual(rA.edge_minted, true, 'run A mints the edge');
  const nodeFieldsA = { minted: rA.minted, node_id: rA.node_id, deduped: rA.deduped, mint_reason: rA.mint_reason };

  // run B: edge FAILURE (edgeDir is a regular FILE -> ensureStoreDir throws -> store-dir refuse)
  const dirB = tmp();
  attest(dirB);
  const jkidB = recordOutcome(outcomeDir(dirB));
  const badEdgeDir = path.join(dirB, 'edge-as-file');
  fs.writeFileSync(badEdgeDir, 'not a directory', { mode: 0o600 });
  let rB;
  const { alerts } = captureAlerts(() => {
    rB = mintFromMergeOutcome({ join_key_id: jkidB }, { anchorDir: dirB, liveDir: liveDir(dirB), edgeDir: badEdgeDir, outcomeDir: outcomeDir(dirB), pendingDir: pendingDir(dirB) });
  });
  const nodeFieldsB = { minted: rB.minted, node_id: rB.node_id, deduped: rB.deduped, mint_reason: rB.mint_reason };
  assert.strictEqual(rB.minted, true, 'the node still minted despite the edge failure');
  assert.deepStrictEqual(nodeFieldsB, nodeFieldsA, 'the node-result fields are byte-identical across edge-success and edge-failure');
  assert.strictEqual(rB.edge_minted, false, 'the edge did NOT mint');
  assert.strictEqual(rB.edge_reason, 'store-dir', 'the store refused on the bad (file-not-dir) edgeDir');
  assert.ok(alerts.length > 0, 'the edge-failure refuse is OBSERVABLE');
  assert.strictEqual(liveStore.listLiveNodes({ dir: liveDir(dirB) }).length, 1, 'the node is on disk even though the edge failed');
});

// ---------------------------------------------------------------------------
// Re-mint DEDUPS on record.observed_at (L2): recorded_at = the persisted first-write timestamp, never a
// fresh Date(). A second mint of the same record dedups (NOT a collision).
// ---------------------------------------------------------------------------

test('re-mint DEDUPS on record.observed_at (recorded_at stable across re-mint, NOT a collision)', () => {
  const dir = tmp();
  attest(dir);
  const jkid = recordOutcome(outcomeDir(dir));
  const opts = { anchorDir: dir, liveDir: liveDir(dir), edgeDir: edgeDir(dir), outcomeDir: outcomeDir(dir), pendingDir: pendingDir(dir) };
  const r1 = mintFromMergeOutcome({ join_key_id: jkid }, opts);
  const r2 = mintFromMergeOutcome({ join_key_id: jkid }, opts);
  assert.strictEqual(r1.minted, true);
  assert.strictEqual(r1.deduped, false, 'first node mint is a genuine first write');
  assert.strictEqual(r1.edge_deduped, false, 'first edge mint is a genuine first write');
  assert.strictEqual(r2.minted, true, 'second mint is idempotent');
  assert.strictEqual(r2.deduped, true, 'second node mint dedups');
  assert.strictEqual(r2.edge_deduped, true, 'second edge mint dedups (recorded_at stable on record.observed_at)');
  assert.notStrictEqual(r2.edge_reason, 'collision', 'a stable recorded_at means NO collision on re-mint');
  assert.strictEqual(r1.node_id, r2.node_id, 'same content-address node');
  assert.strictEqual(r1.edge_id, r2.edge_id, 'same content-address edge');
  assert.strictEqual(edgeStore.listWorldAnchorEdges({ dir: edgeDir(dir) }).length, 1, 'exactly one edge file');
  assert.strictEqual(liveStore.listLiveNodes({ dir: liveDir(dir) }).length, 1, 'exactly one node file');
});

// ---------------------------------------------------------------------------
// HEX40 merge_sha flows through unmodified (honesty MED-3). The record carries a real 40-hex
// merge_commit_sha; the node accepts it (the node store accepts any bounded string; the HEX40 guarantee
// is UPSTREAM in merge-outcome-store.js, not the node store).
// ---------------------------------------------------------------------------

test('a real 40-hex record.merge_commit_sha flows through mintWorldAnchoredNode unmodified', () => {
  const dir = tmp();
  attest(dir);
  assert.ok(/^[0-9a-f]{40}$/.test(MERGE_SHA), 'precondition: MERGE_SHA is a real HEX40');
  const jkid = recordOutcome(outcomeDir(dir));
  const r = mintFromMergeOutcome({ join_key_id: jkid }, { anchorDir: dir, liveDir: liveDir(dir), edgeDir: edgeDir(dir), outcomeDir: outcomeDir(dir), pendingDir: pendingDir(dir) });
  const node = liveStore.readLiveNode(r.node_id, { dir: liveDir(dir) });
  assert.strictEqual(node.merge_sha, MERGE_SHA, 'the HEX40 merge_commit_sha is the node merge_sha unmodified');
});

// ---------------------------------------------------------------------------
// Structural: the minter source carries NO join-key-store require (belt + suspenders with the kernel
// dam, which already fails on a third requirer). The minter reads the merge-outcome record's already-
// sealed approval_hash; it must NEVER read the kernel join-key.
// ---------------------------------------------------------------------------

test('the minter source carries NO join-key-store require (the minter never reads the kernel join-key)', () => {
  const src = fs.readFileSync(MINT_FILE, 'utf8');
  // strip comments so a documentary mention in the header does not trip the assert
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.strictEqual(/require\(\s*['"][^'"]*join-key-store(?:\.js)?['"]\s*\)/.test(stripped), false, 'the minter never requires the kernel join-key store');
  assert.strictEqual(/\b(?:loadJoinKey|resolveJoinKeyForPr|listJoinKeys)\s*\(/.test(stripped), false, 'the minter never CALLS a join-key reader');
});

// ---------------------------------------------------------------------------
// Header invariant: the minter names SHADOW + #273 + LIVE_SOURCES + the defense-in-depth-only framing.
// ---------------------------------------------------------------------------

test('SHADOW header invariant: world-anchor-mint.js names SHADOW + #273 + LIVE_SOURCES + defense-in-depth', () => {
  const src = fs.readFileSync(MINT_FILE, 'utf8');
  assert.ok(/SHADOW/.test(src), 'the minter names its SHADOW status');
  assert.ok(/#273/.test(src), 'the header carries the #273 integrity-not-provenance residual');
  assert.ok(/LIVE_SOURCES/.test(src), 'the header references the LIVE_SOURCES / authenticated-minter prerequisite');
  assert.ok(/defense-in-depth/i.test(src), 'the cross-check is framed as defense-in-depth, not provenance');
});

console.log(`world-anchor-mint.test.js: ${passed} passed`);
