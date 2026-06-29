#!/usr/bin/env node

// tests/unit/lab/world-anchor/cli.test.js
//
// The record-merge CLI is the human-invoked OBSERVER: parse owner/repo + pr_number from the PR
// URL, resolveAnchorForPr (exact-set), then recordConfirmation. Fail-closed + observable on no
// unique attestation. And `backfill-2137` BUILDS the #2137 attestation+lesson against an
// injected store dir (the orchestrator runs it later against the real store).
//
// We exercise the parse + the record-merge + the backfill as MODULE functions (dir-injectable),
// not via a subprocess, so the unit test never writes to the real store.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Test isolation: pin the lab-state base to a throwaway tmp dir BEFORE the store modules are required
// (they read LOOM_LAB_STATE_DIR at module load), so a test that omits an injected dir can NEVER write
// to the real ~/.claude/lab-state store. The dogfood surfaced this: a merged record-merge that injected
// `dir` but not `liveDir` minted a live node into the REAL recall-graph-live/ (the default fallback).
process.env.LOOM_LAB_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-test-labstate-'));

const REPO = path.join(__dirname, '..', '..', '..', '..');
const cli = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'cli.js'));
const store = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'world-anchor-store.js'));
const liveStore = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'live-recall-store.js'));
const edgeStore = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'world-anchor-edge-store.js'));
const jkStore = require(path.join(REPO, 'packages', 'kernel', 'egress', 'join-key-store.js'));

let passed = 0;
// A deferred runner (mirrors merge-observer.test.js) so an async test (the observe-merge auto-mint arm)
// is AWAITED - a sync `fn()` call would float a rejected promise and miscount/swallow the failure.
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-wanchor-cli-')); }

// Attest a PR so a subsequent record-merge can resolve it. Returns the anchor_id.
function attest(dir, over = {}) {
  const att = {
    repo: 'octo/widget', issueRef: 42,
    pr_url: 'https://github.com/octo/widget/pull/77', pr_number: 77, branch: 'b',
    base_sha: 'f853934b61000ff076cea60c206db225e3ed89f0', diff_hash: 'a'.repeat(64),
    lesson_signature: 'lesson:boundary-contract|unguarded-edge-case|handle-edge-explicitly',
    built_by: 'anonymous-actor', approval_hash: 'd'.repeat(64), emitted_at: '2026-06-25T00:00:00.000Z',
    ...over,
  };
  const w = store.recordAttestation(att, { dir });
  assert.strictEqual(w.ok, true, 'fixture attestation lands');
  return w.anchor_id;
}

test('parsePrUrl: extracts owner/repo + pr_number from a GitHub PR URL', () => {
  const r = cli.parsePrUrl('https://github.com/Priivacy-ai/spec-kitty/pull/2137');
  assert.strictEqual(r.repo, 'Priivacy-ai/spec-kitty');
  assert.strictEqual(r.pr_number, 2137);
  assert.strictEqual(r.pr_url, 'https://github.com/Priivacy-ai/spec-kitty/pull/2137');
});

test('parsePrUrl: a non-PR / malformed URL throws (fail-closed at the boundary)', () => {
  assert.throws(() => cli.parsePrUrl('https://github.com/octo/widget/issues/5'));
  assert.throws(() => cli.parsePrUrl('not-a-url'));
  assert.throws(() => cli.parsePrUrl('https://example.com/octo/widget/pull/1'));
});

test('runRecordMerge: an attested PR resolves + records a confirmation', () => {
  const dir = tmp();
  store.recordAttestation({
    repo: 'octo/widget', issueRef: 42,
    pr_url: 'https://github.com/octo/widget/pull/77', pr_number: 77, branch: 'b',
    base_sha: 'f853934b61000ff076cea60c206db225e3ed89f0', diff_hash: 'a'.repeat(64),
    lesson_signature: 'lesson:boundary-contract|unguarded-edge-case|handle-edge-explicitly',
    built_by: 'anonymous-actor', approval_hash: 'd'.repeat(64), emitted_at: '2026-06-25T00:00:00.000Z',
  }, { dir });
  const r = cli.runRecordMerge({ pr: 'https://github.com/octo/widget/pull/77', outcome: 'merged', mergeSha: 'cafef00d' }, { dir, liveDir: liveDir(dir), now: '2026-06-26T00:00:00.000Z' });
  assert.strictEqual(r.ok, true);
  const back = store.readAnchor(r.anchor_id, { dir });
  assert.strictEqual(back.confirmation.outcome, 'merged');
  assert.strictEqual(back.confirmation.merge_sha, 'cafef00d');
});

test('runRecordMerge: an UN-ATTESTED PR is fail-closed (the observable refuse already alerted in resolve)', () => {
  const dir = tmp();
  // capture the observable signal that resolveAnchorForPr emits (keeps test output clean + asserts it fired)
  const orig = process.stderr.write;
  let alerted = false;
  process.stderr.write = (chunk) => { if (String(chunk).includes('world-anchor-unattested-merge')) alerted = true; return true; };
  let r;
  try { r = cli.runRecordMerge({ pr: 'https://github.com/octo/widget/pull/999', outcome: 'merged' }, { dir }); }
  finally { process.stderr.write = orig; }
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no-match', 'a merge of an un-attested PR is loudly skipped, never laundered into a confirmation');
  assert.ok(alerted, 'the refuse is observable');
});

test('runRecordMerge: an invalid outcome is rejected', () => {
  const dir = tmp();
  const r = cli.runRecordMerge({ pr: 'https://github.com/octo/widget/pull/77', outcome: 'totally-merged' }, { dir });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'bad-outcome');
});

test('backfill2137: BUILDS the #2137 attestation + lesson and writes it to the injected store dir', () => {
  const dir = tmp();
  // a local diff fixture so the test does not depend on /tmp/spec-kitty-2097.diff
  const diffFile = path.join(dir, 'fix.diff');
  fs.writeFileSync(diffFile, 'diff --git a/run_tests.sh b/run_tests.sh\n+resolve interpreter\n');
  const r = cli.backfill2137({ dir, diffPath: diffFile });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.attestation.repo, 'Priivacy-ai/spec-kitty');
  assert.strictEqual(r.attestation.issueRef, 2097);
  assert.strictEqual(r.attestation.pr_number, 2137);
  assert.strictEqual(r.attestation.pr_url, 'https://github.com/Priivacy-ai/spec-kitty/pull/2137');
  assert.strictEqual(r.attestation.base_sha, 'f853934b61000ff076cea60c206db225e3ed89f0');
  assert.strictEqual(r.attestation.built_by, 'anonymous-actor');
  assert.strictEqual(r.attestation.approval_hash, 'dba8bf189c465cfcd822d85e9f00e87594230a0d6bf9458c53c1740313ffc334');
  assert.strictEqual(r.attestation.lesson_signature, 'lesson:boundary-contract|unguarded-edge-case|handle-edge-explicitly');
  // diff_hash is RE-DERIVED from the file bytes, never hardcoded
  const expectedDiffHash = require('crypto').createHash('sha256').update(fs.readFileSync(diffFile)).digest('hex');
  assert.strictEqual(r.attestation.diff_hash, expectedDiffHash, 'diff_hash is sha256 of the diff bytes (re-derived)');
  // and it actually landed in the store
  const back = store.readAnchor(r.anchor_id, { dir });
  assert.ok(back, 'the backfilled attestation is readable from the store');
  assert.strictEqual(back.repo, 'Priivacy-ai/spec-kitty');
});

test('backfill2137: a MISSING diff file REFUSES by default (a placeholder anchor_id is not the real content-address)', () => {
  const dir = tmp();
  const r = cli.backfill2137({ dir, diffPath: path.join(dir, 'does-not-exist.diff') });
  assert.strictEqual(r.ok, false, 'the placeholder path does NOT silently record a non-content-addressed anchor');
  assert.strictEqual(r.reason, 'placeholder-refused');
  assert.strictEqual(r.diff_hash_source, 'placeholder', 'a missing diff is flagged as a placeholder, never silently trusted');
  assert.strictEqual(fs.readdirSync(dir).length, 0, 'nothing written for a refused placeholder backfill');
});

test('backfill2137: --allow-placeholder explicitly opts in to the documented stand-in (and flags it)', () => {
  const dir = tmp();
  const r = cli.backfill2137({ dir, diffPath: path.join(dir, 'does-not-exist.diff'), allowPlaceholder: true });
  assert.strictEqual(r.ok, true, 'an explicit opt-in records the placeholder');
  assert.strictEqual(r.diff_hash_source, 'placeholder', 'still flagged as a placeholder, not the real content-address');
  assert.strictEqual(r.attestation.diff_hash, cli.PLACEHOLDER_DIFF_HASH, 'the documented placeholder hash');
});

// --------------------------------------------------------------------------
// PR-3 (item 3 rebind): record-merge is CONFIRMATION-ONLY. The legacy pasted-sha mint
// (att.diff_hash + a pasted --merge-sha) is REMOVED; observe-merge (the gh-verified lane) is now the
// SOLE mint path. A merged record-merge records the world-anchor-store confirmation but mints NO
// node/edge - the legacy forge surface (mintFromAttestation + a pasted/forged --merge-sha) is gone.
// --------------------------------------------------------------------------

function liveDir(store_dir) { return path.join(store_dir, 'live'); }

test('record-merge --outcome merged RECORDS the confirmation but MINTS NOTHING (PR-3: legacy mint removed)', () => {
  const dir = tmp();
  const live = liveDir(dir);
  const edges = path.join(dir, 'edges');
  const anchor_id = attest(dir);
  const r = cli.runRecordMerge(
    { pr: 'https://github.com/octo/widget/pull/77', outcome: 'merged', mergeSha: 'd91785ea' },
    { dir, liveDir: live, edgeDir: edges, now: '2026-06-26T00:00:00.000Z' },
  );
  assert.strictEqual(r.ok, true, 'the confirmation still records');
  // the confirmation IS recorded (the world-anchor-store sidecar)
  const back = store.readAnchor(anchor_id, { dir });
  assert.strictEqual(back.confirmation.outcome, 'merged', 'the merged confirmation is recorded');
  // but NOTHING is minted on the legacy path now
  assert.strictEqual(r.minted, undefined, 'record-merge no longer mints a node (no `minted` field)');
  assert.strictEqual(r.live_node_id, undefined, 'no live node id surfaced from record-merge');
  assert.strictEqual(r.edge_minted, undefined, 'record-merge no longer mints an edge (no `edge_*` fields)');
  assert.strictEqual(r.edge_id, undefined, 'no edge id surfaced from record-merge');
  assert.strictEqual(liveStore.listLiveNodes({ dir: live }).length, 0, 'record-merge mints ZERO live nodes (PR-3)');
});

test('record-merge --outcome merged --merge-sha <forged> mints NOTHING (the pasted-sha forge surface is gone)', () => {
  const dir = tmp();
  const live = liveDir(dir);
  const edges = path.join(dir, 'edges');
  attest(dir);
  // a hostile/forged 64-hex sha that the LEGACY path would have bound; PR-3 mints nothing from it.
  const r = cli.runRecordMerge(
    { pr: 'https://github.com/octo/widget/pull/77', outcome: 'merged', mergeSha: 'f'.repeat(40) },
    { dir, liveDir: live, edgeDir: edges, now: '2026-06-26T00:00:00.000Z' },
  );
  assert.strictEqual(r.ok, true, 'the confirmation still records');
  assert.strictEqual(r.minted, undefined, 'no node minted from the pasted --merge-sha');
  assert.strictEqual(liveStore.listLiveNodes({ dir: live }).length, 0, 'the pasted-sha forge surface mints nothing');
  assert.strictEqual(edgeStore.listWorldAnchorEdges({ dir: edges }).length, 0, 'no edge from the pasted-sha path');
});

test('record-merge --outcome closed records the confirmation + mints nothing', () => {
  const dir = tmp();
  const live = liveDir(dir);
  attest(dir);
  const r = cli.runRecordMerge(
    { pr: 'https://github.com/octo/widget/pull/77', outcome: 'closed' },
    { dir, liveDir: live, now: '2026-06-26T00:00:00.000Z' },
  );
  assert.strictEqual(r.ok, true, 'recording a closed confirmation succeeds');
  assert.strictEqual(r.minted, undefined, 'a closed outcome mints nothing');
  assert.strictEqual(liveStore.listLiveNodes({ dir: live }).length, 0, 'closed -> zero live nodes');
});

test('record-merge of an UN-ATTESTED PR is fail-closed (observable refuse), mints nothing', () => {
  const dir = tmp();
  const live = liveDir(dir);
  const orig = process.stderr.write;
  let alerted = false;
  process.stderr.write = (chunk) => { if (String(chunk).includes('world-anchor-unattested-merge')) alerted = true; return true; };
  let r;
  try {
    r = cli.runRecordMerge({ pr: 'https://github.com/octo/widget/pull/999', outcome: 'merged' }, { dir, liveDir: live });
  } finally { process.stderr.write = orig; }
  assert.strictEqual(r.ok, false);
  assert.ok(alerted, 'the refuse is observable');
  assert.strictEqual(liveStore.listLiveNodes({ dir: live }).length, 0, 'no live node for an un-attested merge');
});

test('mintFromAttestation is NO LONGER exported (the legacy mint helper is removed, not just private)', () => {
  // PR-3 deletes the legacy attestation-anchored mint from cli.js entirely (relocated logic lives in the
  // gh-verified minter). The export must be gone so no consumer can mint from a stored attestation.
  assert.strictEqual(cli.mintFromAttestation, undefined, 'the legacy mint helper is no longer exported');
  assert.strictEqual(typeof cli.runRecordMerge, 'function', 'record-merge (confirmation-only) is still the public surface');
});

// --------------------------------------------------------------------------
// PR-3: observe-merge is the SOLE mint path. After a gh-verified `merged` record, mainObserveMerge
// auto-mints (the node + the UNSIGNED edge bound to the SEALED approval_hash). The mint is additive: a
// mint failure does NOT change the record's success exit code. We inject the gh runner so no real gh is
// shelled, and pin the kernel join-key store via DEFAULT_DIR (LOOM_LAB_STATE_DIR is the throwaway base).
// --------------------------------------------------------------------------

const SELF_UID = typeof process.getuid === 'function' ? process.getuid() : null;
const OBSERVE_SHA40 = 'b'.repeat(40);
const OBSERVE_APPROVAL = 'd'.repeat(64);
// PR-2 issue-bound the static grandfather floor to (Priivacy-ai/spec-kitty, 2097). The auto-mint happy
// path must join THAT tuple (Branch A); the captured floor (pendingDir) stays empty here, so the
// LESSON_2137 grandfather seed resolves exactly-one. The grandfather tuple, shared by the attestation +
// the join-key + the observe `pr` arg.
const GF = Object.freeze({
  repo: 'Priivacy-ai/spec-kitty', issueRef: 2097, pr_number: 2137,
  pr_url: 'https://github.com/Priivacy-ai/spec-kitty/pull/2137',
});
function pendingDir(store_dir) { return path.join(store_dir, 'pending'); }

function seedJoinKey(over = {}) {
  const rec = {
    repo: 'octo/widget', issueRef: 42, pr_number: 77,
    pr_url: 'https://github.com/octo/widget/pull/77',
    approval_hash: OBSERVE_APPROVAL, base_sha: 'f'.repeat(40),
    emitted_at: '2026-06-28T00:00:00.000Z', ...over,
  };
  const w = jkStore.writeJoinKey(rec, { dir: jkStore.DEFAULT_DIR, selfUid: SELF_UID === null ? undefined : SELF_UID });
  assert.strictEqual(w.ok, true, `seedJoinKey must succeed (got ${w.reason})`);
  return w.id;
}
function clearJoinKeys() {
  try { for (const f of fs.readdirSync(jkStore.DEFAULT_DIR)) fs.unlinkSync(path.join(jkStore.DEFAULT_DIR, f)); } catch { /* absent ok */ }
}
const runnerMerged = () => async () => ({ stdout: JSON.stringify({ merged: true, merge_commit_sha: OBSERVE_SHA40, state: 'closed' }) });

test('observe-merge on a merged record AUTO-MINTS the node + the edge (the SOLE mint path, PR-3)', async () => {
  clearJoinKeys();
  // the attestation the minter resolves (same GRANDFATHER tuple as the join-key; Branch A resolves it)
  const dir = tmp();
  attest(dir, { ...GF, approval_hash: OBSERVE_APPROVAL });
  seedJoinKey(GF);
  const liveD = liveDir(dir);
  const edgeD = path.join(dir, 'edges');
  const outcomeD = path.join(dir, 'outcomes');
  const pendingD = pendingDir(dir);   // PR-2: part of the all-or-nothing FIVE-dir set (empty -> Branch B 0)
  // inject the gh runner + the COHERENT FIVE-dir isolation set (FOLD B: all-or-nothing; the minter
  // fail-closes a partial set). outcomeDir is shared by the observer's record store + the minter; the
  // attestation store IS the tmp root (attest(dir) wrote there). We drive the dedicated arm function
  // with the injected runner (main() reads argv + has no --dir flag now).
  const r = await cli.mainObserveMerge(
    { pr: GF.pr_url },
    { ghRunner: runnerMerged(), outcomeDir: outcomeD, anchorDir: dir, liveDir: liveD, edgeDir: edgeD, pendingDir: pendingD, now: '2026-06-28T12:00:00.000Z' },
  );
  assert.strictEqual(r.code, 0, 'observe-merge exits 0');
  assert.strictEqual(r.payload.ok, true, 'the record succeeded');
  assert.strictEqual(r.payload.recorded, true, 'the merge-outcome recorded');
  assert.strictEqual(r.payload.minted, true, 'observe-merge auto-minted the node');
  assert.ok(/^[0-9a-f]{64}$/.test(r.payload.node_id), 'a 64-hex node id surfaced');
  assert.strictEqual(r.payload.edge_minted, true, 'observe-merge auto-minted the edge');
  assert.strictEqual(r.payload.edge_signed, false, 'the production edge is UNSIGNED (SHADOW)');
  // the edge binds the SEALED approval_hash, never att.diff_hash
  const edge = edgeStore.loadWorldAnchorEdge(r.payload.edge_id, { dir: edgeD });
  assert.strictEqual(edge.to_delta_ref, OBSERVE_APPROVAL, 'to_delta_ref === the kernel-sealed approval_hash');
  // the node binds the gh-verified merge_commit_sha
  const node = liveStore.readLiveNode(r.payload.node_id, { dir: liveD });
  assert.strictEqual(node.merge_sha, OBSERVE_SHA40, 'node merge_sha === the gh-verified merge_commit_sha');
});

test('observe-merge auto-mint is NON-FATAL: a mint failure leaves the record success exit code (additive)', async () => {
  clearJoinKeys();
  const dir = tmp();
  attest(dir, { ...GF, approval_hash: OBSERVE_APPROVAL });
  seedJoinKey(GF);
  const liveD = liveDir(dir);
  const outcomeD = path.join(dir, 'outcomes');
  const pendingD = pendingDir(dir);   // PR-2: part of the all-or-nothing FIVE-dir set (empty -> Branch B 0)
  // edgeDir is a regular FILE -> the edge mint fails; the node still mints; the record success stands.
  const badEdgeDir = path.join(dir, 'edge-as-file');
  fs.writeFileSync(badEdgeDir, 'not a dir', { mode: 0o600 });
  const r = await cli.mainObserveMerge(
    { pr: GF.pr_url },
    { ghRunner: runnerMerged(), outcomeDir: outcomeD, anchorDir: dir, liveDir: liveD, edgeDir: badEdgeDir, pendingDir: pendingD, now: '2026-06-28T12:00:00.000Z' },
  );
  assert.strictEqual(r.code, 0, 'the record success exit code stands despite the edge-mint failure');
  assert.strictEqual(r.payload.ok, true, 'the recorded outcome is untouched');
  assert.strictEqual(r.payload.minted, true, 'the node still minted');
  assert.strictEqual(r.payload.edge_minted, false, 'the edge mint failed (non-fatal)');
  assert.ok(typeof r.payload.edge_reason === 'string' && r.payload.edge_reason.length > 0, 'the edge failure reason is surfaced');
});

test('cli.js source references NEITHER resolveSigner NOR LOOM_EDGE_SIGNING_KEY (production-unsigned guarantee, hacker H2)', () => {
  // The production wire NEVER self-signs into the authenticated lane: it must not resolve a signer from
  // the env. A structural source assert is the strongest non-runtime proof the env-key path is absent.
  const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'packages', 'lab', 'world-anchor', 'cli.js'), 'utf8');
  assert.strictEqual(src.includes('resolveSigner'), false, 'cli.js never calls resolveSigner (no env-fallback signer)');
  assert.strictEqual(src.includes('LOOM_EDGE_SIGNING_KEY'), false, 'cli.js never references the env signing key');
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); passed += 1; }
    catch (e) { console.error(`FAIL: ${name}`); throw e; }
  }
  console.log(`cli.test.js: ${passed} passed`);
})();
