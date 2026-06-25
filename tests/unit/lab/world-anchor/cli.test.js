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

let passed = 0;
function test(name, fn) { fn(); passed += 1; }
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
// Item 3: the merge -> live-lesson MINT wire (record-merge --outcome merged mints exactly one
// world_anchored node into recall-graph-live/, derived from the VERIFIED attestation, never a
// caller field; closed/stale/absent mint NOTHING and emit a reason).
// --------------------------------------------------------------------------

function liveDir(store_dir) { return path.join(store_dir, 'live'); }

test('record-merge --outcome merged MINTS exactly one world_anchored live node', () => {
  const dir = tmp();
  const live = liveDir(dir);
  attest(dir);
  const r = cli.runRecordMerge(
    { pr: 'https://github.com/octo/widget/pull/77', outcome: 'merged', mergeSha: 'd91785ea' },
    { dir, liveDir: live, now: '2026-06-26T00:00:00.000Z' },
  );
  assert.strictEqual(r.ok, true);
  assert.ok(r.minted, 'the merge minted a live lesson node');
  assert.ok(/^[0-9a-f]{64}$/.test(r.live_node_id), 'a 64-hex live node id is returned');
  const nodes = liveStore.listLiveNodes({ dir: live });
  assert.strictEqual(nodes.length, 1, 'exactly one live node minted');
  assert.strictEqual(nodes[0].provenance, liveStore.WORLD_ANCHORED);
  assert.strictEqual(nodes[0].merge_sha, 'd91785ea', 'the gh-verified merge SHA is world-evidence in the node');
});

test('the minted lesson identity derives from the VERIFIED attestation, NOT a caller-supplied field (hacker H2)', () => {
  const dir = tmp();
  const live = liveDir(dir);
  const anchor_id = attest(dir);
  // pass a hostile caller field that, if read, would change the lesson identity
  const r = cli.runRecordMerge(
    {
      pr: 'https://github.com/octo/widget/pull/77', outcome: 'merged', mergeSha: 'd91785ea',
      lesson_signature: 'lesson:state-mutation|silent-coercion|fail-closed',
      lesson_body: 'attacker-supplied body',
    },
    { dir, liveDir: live, now: '2026-06-26T00:00:00.000Z' },
  );
  assert.strictEqual(r.ok, true);
  const node = liveStore.readLiveNode(r.live_node_id, { dir: live });
  // the sealed attestation's lesson_signature wins, not the caller's hostile one
  const att = store.readAnchor(anchor_id, { dir });
  assert.strictEqual(node.lesson_signature, att.lesson_signature, 'identity from the sealed attestation');
  assert.notStrictEqual(node.lesson_signature, 'lesson:state-mutation|silent-coercion|fail-closed', 'the caller field is ignored');
  assert.notStrictEqual(node.lesson_body, 'attacker-supplied body', 'the caller body is ignored');
});

test('record-merge --outcome closed mints NOTHING and the (non-)mint is observable (no live dir populated)', () => {
  const dir = tmp();
  const live = liveDir(dir);
  attest(dir);
  const r = cli.runRecordMerge(
    { pr: 'https://github.com/octo/widget/pull/77', outcome: 'closed' },
    { dir, liveDir: live, now: '2026-06-26T00:00:00.000Z' },
  );
  assert.strictEqual(r.ok, true, 'recording a closed confirmation succeeds');
  assert.ok(!r.minted, 'a closed outcome mints no lesson');
  // no live node exists
  const nodes = liveStore.listLiveNodes({ dir: live });
  assert.strictEqual(nodes.length, 0, 'closed -> zero live nodes');
});

test('record-merge --outcome stale mints NOTHING', () => {
  const dir = tmp();
  const live = liveDir(dir);
  attest(dir);
  const r = cli.runRecordMerge(
    { pr: 'https://github.com/octo/widget/pull/77', outcome: 'stale' },
    { dir, liveDir: live, now: '2026-06-26T00:00:00.000Z' },
  );
  assert.strictEqual(r.ok, true);
  assert.ok(!r.minted, 'a stale outcome mints no lesson');
  assert.strictEqual(liveStore.listLiveNodes({ dir: live }).length, 0);
});

test('record-merge of an UN-ATTESTED PR mints nothing and is fail-closed (no live node, observable refuse)', () => {
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

test('record-merge merged twice is idempotent: still exactly one live node', () => {
  const dir = tmp();
  const live = liveDir(dir);
  attest(dir);
  const args = { pr: 'https://github.com/octo/widget/pull/77', outcome: 'merged', mergeSha: 'd91785ea' };
  const opts = { dir, liveDir: live, now: '2026-06-26T00:00:00.000Z' };
  const r1 = cli.runRecordMerge(args, opts);
  const r2 = cli.runRecordMerge(args, opts);
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(r2.ok, true, 'a re-confirm of the same merge is idempotent');
  assert.strictEqual(liveStore.listLiveNodes({ dir: live }).length, 1, 'exactly one live node after a double record');
  // The re-mint must be HONESTLY flagged: minted:true + minted_deduped:false on the FIRST write,
  // minted:true + minted_deduped:true on the SECOND (the node already existed). A log/automation
  // consumer must be able to tell a NEW world-anchor event from a re-confirm.
  assert.strictEqual(r1.minted_deduped, false, 'first record is a genuine first write (not deduped)');
  assert.strictEqual(r2.minted_deduped, true, 'second record is a dedup, not a new world-anchor event');
});

test('merged but the sealed signature is OFF the orchestrator floor: no mint, observable refuse (M1)', () => {
  const dir = tmp();
  const live = liveDir(dir);
  // attest with a taxonomy-valid signature that is NOT in the orchestrator floor (a different cluster)
  attest(dir, { lesson_signature: 'lesson:data-parse|silent-coercion|fail-closed' });
  const orig = process.stderr.write;
  let alerted = false;
  process.stderr.write = (chunk) => { if (String(chunk).includes('live-recall-mint-refused') && String(chunk).includes('"mint_reason":"no-floor-lesson"')) alerted = true; return true; };
  let r;
  try {
    r = cli.runRecordMerge({ pr: 'https://github.com/octo/widget/pull/77', outcome: 'merged', mergeSha: 'd91785ea' }, { dir, liveDir: live, now: '2026-06-26T00:00:00.000Z' });
  } finally { process.stderr.write = orig; }
  assert.strictEqual(r.ok, true, 'the confirmation still records');
  assert.ok(!r.minted, 'a no-floor-lesson outcome mints nothing');
  assert.strictEqual(r.mint_reason, 'no-floor-lesson');
  assert.ok(alerted, 'the no-floor-lesson refuse is observable (M1)');
  assert.strictEqual(liveStore.listLiveNodes({ dir: live }).length, 0);
});

test('merged but NO --merge-sha: no mint, observable refuse (the world-evidence is mandatory, M1)', () => {
  const dir = tmp();
  const live = liveDir(dir);
  attest(dir);
  const orig = process.stderr.write;
  let alerted = false;
  process.stderr.write = (chunk) => { if (String(chunk).includes('live-recall-mint-refused') && String(chunk).includes('"mint_reason":"no-merge-sha"')) alerted = true; return true; };
  let r;
  try {
    r = cli.runRecordMerge({ pr: 'https://github.com/octo/widget/pull/77', outcome: 'merged' }, { dir, liveDir: live, now: '2026-06-26T00:00:00.000Z' });
  } finally { process.stderr.write = orig; }
  assert.ok(!r.minted, 'a merge with no world-evidence SHA mints nothing');
  assert.strictEqual(r.mint_reason, 'no-merge-sha');
  assert.ok(alerted, 'the no-merge-sha refuse is observable (M1)');
});

test('main(list-live) exercises the CLI branch + arg parsing, emitting the {ok,count,nodes} payload', () => {
  const dir = tmp();
  const live = liveDir(dir);
  attest(dir);
  cli.runRecordMerge({ pr: 'https://github.com/octo/widget/pull/77', outcome: 'merged', mergeSha: 'd91785ea' }, { dir, liveDir: live, now: '2026-06-26T00:00:00.000Z' });
  // Route through main() (NOT listLive() directly) so the `list-live` branch + --live-dir parsing are
  // actually covered; assert the emitted payload + exit code (CodeRabbit #441 nitpick).
  const chunks = [];
  const orig = process.stdout.write;
  process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };
  let code;
  try { code = cli.main(['list-live', '--live-dir', live]); } finally { process.stdout.write = orig; }
  assert.strictEqual(code, 0, 'list-live exits 0');
  const listed = JSON.parse(chunks.join('').trim());
  assert.strictEqual(listed.ok, true);
  assert.strictEqual(listed.count, 1);
  assert.strictEqual(listed.nodes[0].provenance, liveStore.WORLD_ANCHORED);
});

test('mintFromAttestation is NOT exported (confirmation-mint-only gate cannot be bypassed)', () => {
  // CodeRabbit #441 (security): the internal mint helper must stay private so no consumer can mint a
  // live node straight from a stored attestation, skipping runRecordMerge's exact 'merged' gate.
  assert.strictEqual(cli.mintFromAttestation, undefined, 'the internal mint helper stays private');
  assert.strictEqual(typeof cli.runRecordMerge, 'function', 'the gated entry point is the public surface');
});

console.log(`cli.test.js: ${passed} passed`);
