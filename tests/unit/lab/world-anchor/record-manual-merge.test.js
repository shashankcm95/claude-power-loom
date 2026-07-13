#!/usr/bin/env node

// tests/unit/lab/world-anchor/record-manual-merge.test.js
//
// Phase-1 (the stable-5-lesson SHADOW bundle): the join-key-FREE, gh-verified, operator-vouched, NODE-ONLY
// producer + its two gh fetch siblings. Injectable-runner + dir-injected unit tests; the REAL gh is NEVER
// shelled and the REAL ~/.claude/lab-state store is NEVER written.
//
// Covers the corrected design-of-record (R1'-R7' in the plan's Pre-Approval Verification):
//   - R2': all 11 ATT_FIELDS sourced (real base_sha/branch/author from gh; diff_hash over the MERGE-COMMIT
//     patch, pinned via /commits/<sha>); the synthetic self-labelling approval_hash.
//   - R1'/F1: the advisory markers (minter_kind/arming_class/provenance_basis) ride the CLI RESULT ONLY -
//     they are NEVER persisted to the attestation body or the node body (the theater-marker close).
//   - R5': every refuse in the composed chain is OBSERVABLE.
//   - the export-bank-pair join precondition (node.anchor_id === att.anchor_id + matching lesson_signature).

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Pin lab-state to a throwaway tmp dir BEFORE the store modules are required (they capture
// LOOM_LAB_STATE_DIR at module load), so a test that omits an injected dir can NEVER touch the real store.
process.env.LOOM_LAB_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-rmm-labstate-'));

const REPO = path.join(__dirname, '..', '..', '..', '..');
const cli = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'cli.js'));
const store = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'world-anchor-store.js'));
const liveStore = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'live-recall-store.js'));
const gh = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'gh-verify.js'));

let passed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-rmm-')); }

// Capture [LOOM-EGRESS-ALERT] lines emitted during fn (async). Returns parsed alert objects.
async function captureAlerts(fn) {
  const alerts = [];
  const orig = process.stderr.write;
  process.stderr.write = (chunk, ...rest) => {
    const s = String(chunk);
    if (s.startsWith('[LOOM-EGRESS-ALERT]')) {
      try { alerts.push(JSON.parse(s.slice('[LOOM-EGRESS-ALERT]'.length).trim())); } catch { /* ignore */ }
      return true;
    }
    return orig.call(process.stderr, chunk, ...rest);
  };
  try { await fn(); } finally { process.stderr.write = orig; }
  return alerts;
}

const REPO_OK = 'octo/widget';
const PR_URL = 'https://github.com/octo/widget/pull/77';
const SHA40 = 'a'.repeat(40);
const BASE_SHA = 'b'.repeat(40);
const DIFF_TEXT = 'diff --git a/x.py b/x.py\n--- a/x.py\n+++ b/x.py\n@@ -1 +1 @@\n-old\n+new\n';

// A single dispatching gh runner (mirrors how the real single `gh` binary answers different args): the
// merge-commit diff GET returns raw diff text; the pr-meta jq GET returns the metadata object; everything
// else (the verifyMerge jq GET) returns the merged/sha object.
function ghRunnerFor(over = {}) {
  const o = {
    merged: true, mergeSha: SHA40, state: 'closed',
    author: 'operator-login', mergedBy: 'operator-login', mergedAt: '2026-07-13T00:00:00Z',
    baseSha: BASE_SHA, branch: 'loom/fix-2097', diff: DIFF_TEXT, throwOn: null, ...over,
  };
  return async (args) => {
    const s = args.join(' ');
    if (o.throwOn && s.includes(o.throwOn)) { const e = new Error('gh failed'); e.code = 1; throw e; }
    if (s.includes('/commits/')) return { stdout: o.diff };
    if (s.includes('.user.login')) return { stdout: `${JSON.stringify({ author: o.author, merged_by: o.mergedBy, merged_at: o.mergedAt, base_sha: o.baseSha, branch: o.branch })}\n` };
    return { stdout: `${JSON.stringify({ merged: o.merged, merge_commit_sha: o.mergeSha, state: o.state })}\n` };
  };
}

// A runner that records the args it was called with (to prove the GET-gate shape).
function capturingRunner(inner) {
  const calls = [];
  const fn = async (args, runOpts) => { calls.push(args); return inner(args, runOpts); };
  fn.calls = calls;
  return fn;
}

const LESSON = { 'trigger-class': 'boundary-contract', 'gotcha-class': 'unguarded-edge-case', 'corrective-class': 'handle-edge-explicitly', 'lesson-body': 'A host shell test-runner invoking a bare interpreter is unsafe; delegate to the project canonical runner.' };
function happyArgs(over = {}) { return { 'pr-url': PR_URL, ...LESSON, ...over }; }

// --------------------------------------------------------------------------
// gh-verify: fetchPrMergeMeta
// --------------------------------------------------------------------------

test('fetchPrMergeMeta: happy -> {ok, author, merged_by, merged_at, base_sha, branch}', async () => {
  const r = await gh.fetchPrMergeMeta({ repo: REPO_OK, pr_number: 77 }, { runner: ghRunnerFor() });
  assert.deepStrictEqual(r, { ok: true, author: 'operator-login', merged_by: 'operator-login', merged_at: '2026-07-13T00:00:00Z', base_sha: BASE_SHA, branch: 'loom/fix-2097' });
});

test('fetchPrMergeMeta: null merged_by/merged_at are tolerated (audit-only) -> ok with nulls', async () => {
  const r = await gh.fetchPrMergeMeta({ repo: REPO_OK, pr_number: 77 }, { runner: ghRunnerFor({ mergedBy: null, mergedAt: null }) });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.merged_by, null);
  assert.strictEqual(r.merged_at, null);
});

test('fetchPrMergeMeta: bad repo -> {ok:false, bad-repo} + observable', async () => {
  const alerts = await captureAlerts(async () => {
    const r = await gh.fetchPrMergeMeta({ repo: 'no-slash', pr_number: 77 }, { runner: ghRunnerFor() });
    assert.deepStrictEqual(r, { ok: false, reason: 'bad-repo' });
  });
  assert.ok(alerts.some((a) => a.reason === 'merge-verify-failed' && a.gh_reason === 'meta-bad-repo'));
});

test('fetchPrMergeMeta: bad pr_number -> {ok:false, bad-pr-number}', async () => {
  const r = await gh.fetchPrMergeMeta({ repo: REPO_OK, pr_number: 0 }, { runner: ghRunnerFor() });
  assert.deepStrictEqual(r, { ok: false, reason: 'bad-pr-number' });
});

test('fetchPrMergeMeta: gh failure -> {ok:false, gh-failed} + observable (fail-closed, never silent)', async () => {
  const alerts = await captureAlerts(async () => {
    const r = await gh.fetchPrMergeMeta({ repo: REPO_OK, pr_number: 77 }, { runner: ghRunnerFor({ throwOn: 'pulls/' }) });
    assert.deepStrictEqual(r, { ok: false, reason: 'gh-failed' });
  });
  assert.ok(alerts.some((a) => a.gh_reason === 'meta-gh-exit'));
});

test('fetchPrMergeMeta: non-HEX40 base_sha -> {ok:false, bad-base-sha} + observable', async () => {
  const alerts = await captureAlerts(async () => {
    const r = await gh.fetchPrMergeMeta({ repo: REPO_OK, pr_number: 77 }, { runner: ghRunnerFor({ baseSha: 'not-a-sha' }) });
    assert.deepStrictEqual(r, { ok: false, reason: 'bad-base-sha' });
  });
  assert.ok(alerts.some((a) => a.gh_reason === 'meta-bad-base-sha'));
});

test('fetchPrMergeMeta: null branch (a deleted head with no ref) -> {ok:false, bad-branch} + observable', async () => {
  const alerts = await captureAlerts(async () => {
    const r = await gh.fetchPrMergeMeta({ repo: REPO_OK, pr_number: 77 }, { runner: ghRunnerFor({ branch: null }) });
    assert.deepStrictEqual(r, { ok: false, reason: 'bad-branch' });
  });
  assert.ok(alerts.some((a) => a.gh_reason === 'meta-bad-branch'));
});

test('fetchPrMergeMeta: missing author -> {ok:false, bad-author}', async () => {
  const r = await gh.fetchPrMergeMeta({ repo: REPO_OK, pr_number: 77 }, { runner: ghRunnerFor({ author: null }) });
  assert.deepStrictEqual(r, { ok: false, reason: 'bad-author' });
});

// --------------------------------------------------------------------------
// gh-verify: fetchMergeCommitDiff
// --------------------------------------------------------------------------

test('fetchMergeCommitDiff: happy -> {ok, diff} (raw text, never JSON)', async () => {
  const r = await gh.fetchMergeCommitDiff({ repo: REPO_OK, merge_commit_sha: SHA40 }, { runner: ghRunnerFor() });
  assert.deepStrictEqual(r, { ok: true, diff: DIFF_TEXT });
});

test('fetchMergeCommitDiff: bad merge sha -> {ok:false, bad-merge-sha} + observable', async () => {
  const alerts = await captureAlerts(async () => {
    const r = await gh.fetchMergeCommitDiff({ repo: REPO_OK, merge_commit_sha: 'short' }, { runner: ghRunnerFor() });
    assert.deepStrictEqual(r, { ok: false, reason: 'bad-merge-sha' });
  });
  assert.ok(alerts.some((a) => a.gh_reason === 'diff-bad-sha'));
});

test('fetchMergeCommitDiff: gh failure -> {ok:false, gh-failed} + observable', async () => {
  const alerts = await captureAlerts(async () => {
    const r = await gh.fetchMergeCommitDiff({ repo: REPO_OK, merge_commit_sha: SHA40 }, { runner: ghRunnerFor({ throwOn: 'commits/' }) });
    assert.deepStrictEqual(r, { ok: false, reason: 'gh-failed' });
  });
  assert.ok(alerts.some((a) => a.gh_reason === 'diff-gh-exit'));
});

test('fetchMergeCommitDiff: empty diff -> {ok:false, empty-diff} + observable (a real fix has a diff)', async () => {
  const alerts = await captureAlerts(async () => {
    const r = await gh.fetchMergeCommitDiff({ repo: REPO_OK, merge_commit_sha: SHA40 }, { runner: ghRunnerFor({ diff: '' }) });
    assert.deepStrictEqual(r, { ok: false, reason: 'empty-diff' });
  });
  assert.ok(alerts.some((a) => a.gh_reason === 'diff-empty'));
});

test('both fetch siblings build args that PASS the read-only GET-gate (non-vacuous chokepoint proof)', async () => {
  const metaRunner = capturingRunner(ghRunnerFor());
  await gh.fetchPrMergeMeta({ repo: REPO_OK, pr_number: 77 }, { runner: metaRunner });
  const diffRunner = capturingRunner(ghRunnerFor());
  await gh.fetchMergeCommitDiff({ repo: REPO_OK, merge_commit_sha: SHA40 }, { runner: diffRunner });
  assert.deepStrictEqual(metaRunner.calls[0].slice(0, 4), ['api', '-X', 'GET', 'repos/octo/widget/pulls/77']);
  assert.deepStrictEqual(diffRunner.calls[0].slice(0, 4), ['api', '-X', 'GET', `repos/octo/widget/commits/${SHA40}`]);
  // The gate itself must accept both argv (a write verb would throw).
  assert.doesNotThrow(() => gh.assertReadOnlyGhArgs(metaRunner.calls[0]));
  assert.doesNotThrow(() => gh.assertReadOnlyGhArgs(diffRunner.calls[0]));
});

// --------------------------------------------------------------------------
// cli: runRecordManualMerge
// --------------------------------------------------------------------------

test('happy path: attestation + node both land; result carries evidence + markers + shadow flags', async () => {
  const anchorDir = tmp();
  const liveDir = tmp();
  const r = await cli.runRecordManualMerge(happyArgs(), { ghRunner: ghRunnerFor(), anchorDir, liveDir });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.ok(/^[0-9a-f]{64}$/.test(r.anchor_id));
  assert.ok(/^[0-9a-f]{64}$/.test(r.node_id));
  assert.strictEqual(r.shadow, true);
  assert.strictEqual(r.production_inert, true);
  assert.deepStrictEqual(r.markers, { minter_kind: 'operator-vouched', arming_class: 'pre-arm', provenance_basis: 'github-merge-verified' });
  assert.strictEqual(r.github_evidence.author, 'operator-login');
  assert.strictEqual(r.github_evidence.merge_sha, SHA40);
  // both records persisted (read back through the verify-on-read path with the isolated dirs)
  const att = store.readAnchor(r.anchor_id, { dir: anchorDir });
  assert.ok(att, 'attestation persisted + verifies on read');
  const node = liveStore.readLiveNode(r.node_id, { dir: liveDir });
  assert.ok(node, 'node persisted + verifies on read');
});

test('R2: diff_hash is sha256 of the MERGE-COMMIT diff; approval_hash is the synthetic self-label; anchor_id derives from {repo, issueRef, diff_hash}', async () => {
  const anchorDir = tmp();
  const liveDir = tmp();
  const r = await cli.runRecordManualMerge(happyArgs(), { ghRunner: ghRunnerFor(), anchorDir, liveDir });
  const att = store.readAnchor(r.anchor_id, { dir: anchorDir });
  const expectedDiffHash = crypto.createHash('sha256').update(DIFF_TEXT).digest('hex');
  assert.strictEqual(att.diff_hash, expectedDiffHash, 'diff_hash is over the merge-commit patch bytes');
  const expectedAnchor = store.deriveAnchorId({ repo: REPO_OK, issueRef: 77, diff_hash: expectedDiffHash });
  assert.strictEqual(att.anchor_id, expectedAnchor, 'anchor_id derives from {repo, issueRef(default pr_number), diff_hash}');
  const expectedApproval = crypto.createHash('sha256').update(`operator-vouched:${expectedAnchor}`).digest('hex');
  assert.strictEqual(att.approval_hash, expectedApproval, 'approval_hash is the synthetic self-label');
  assert.strictEqual(att.base_sha, BASE_SHA);
  assert.strictEqual(att.branch, 'loom/fix-2097');
});

test('R1/F1: the advisory markers NEVER persist to the attestation body or the node body (theater-marker close)', async () => {
  const anchorDir = tmp();
  const liveDir = tmp();
  const r = await cli.runRecordManualMerge(happyArgs(), { ghRunner: ghRunnerFor(), anchorDir, liveDir });
  const att = store.readAnchor(r.anchor_id, { dir: anchorDir });
  const node = liveStore.readLiveNode(r.node_id, { dir: liveDir });
  for (const marker of ['minter_kind', 'arming_class', 'provenance_basis', 'author', 'github_evidence']) {
    assert.ok(!(marker in att), `attestation body must NOT carry ${marker}`);
    assert.ok(!(marker in node), `node body must NOT carry ${marker}`);
  }
});

test('export-bank-pair join precondition: node.anchor_id === att.anchor_id AND node.lesson_signature === att.lesson_signature', async () => {
  const anchorDir = tmp();
  const liveDir = tmp();
  const r = await cli.runRecordManualMerge(happyArgs(), { ghRunner: ghRunnerFor(), anchorDir, liveDir });
  const att = store.readAnchor(r.anchor_id, { dir: anchorDir });
  const node = liveStore.readLiveNode(r.node_id, { dir: liveDir });
  assert.strictEqual(node.anchor_id, att.anchor_id);
  assert.strictEqual(node.lesson_signature, att.lesson_signature);
});

test('issueRef defaults to pr_number; an explicit --issue-ref is honored', async () => {
  const a1 = tmp(); const l1 = tmp();
  const r1 = await cli.runRecordManualMerge(happyArgs(), { ghRunner: ghRunnerFor(), anchorDir: a1, liveDir: l1 });
  assert.strictEqual(store.readAnchor(r1.anchor_id, { dir: a1 }).issueRef, 77, 'default = pr_number');
  const a2 = tmp(); const l2 = tmp();
  const r2 = await cli.runRecordManualMerge(happyArgs({ 'issue-ref': '2097' }), { ghRunner: ghRunnerFor(), anchorDir: a2, liveDir: l2 });
  assert.strictEqual(store.readAnchor(r2.anchor_id, { dir: a2 }).issueRef, 2097, 'explicit --issue-ref honored');
});

test('bad --issue-ref (non-decimal) -> {ok:false, bad-issue-ref} + observable', async () => {
  const alerts = await captureAlerts(async () => {
    const r = await cli.runRecordManualMerge(happyArgs({ 'issue-ref': '1e3' }), { ghRunner: ghRunnerFor(), anchorDir: tmp(), liveDir: tmp() });
    assert.deepStrictEqual(r, { ok: false, reason: 'bad-issue-ref' });
  });
  assert.ok(alerts.some((a) => a.rmm_reason === 'bad-issue-ref'));
});

test('not-merged -> {ok:false, not-merged} + observable; NOTHING is written', async () => {
  const anchorDir = tmp();
  const liveDir = tmp();
  const alerts = await captureAlerts(async () => {
    const r = await cli.runRecordManualMerge(happyArgs(), { ghRunner: ghRunnerFor({ merged: false }), anchorDir, liveDir });
    assert.deepStrictEqual(r, { ok: false, reason: 'not-merged' });
  });
  assert.ok(alerts.some((a) => a.rmm_reason === 'not-merged'));
  assert.strictEqual(liveStore.listLiveNodes({ dir: liveDir }).length, 0, 'no node minted for an unmerged PR');
  assert.strictEqual(store.listAnchors({ dir: anchorDir }).length, 0, 'no attestation recorded for an unmerged PR');
});

test('merge-unverifiable (gh gate fails) -> {ok:false, merge-unverifiable}', async () => {
  const r = await cli.runRecordManualMerge(happyArgs(), { ghRunner: ghRunnerFor({ throwOn: 'pulls/' }), anchorDir: tmp(), liveDir: tmp() });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'merge-unverifiable');
});

test('bad lesson enum -> {ok:false, bad-lesson} + observable (buildWorldAnchorLesson throws, wrapped)', async () => {
  const alerts = await captureAlerts(async () => {
    const r = await cli.runRecordManualMerge(happyArgs({ 'trigger-class': 'not-a-real-trigger' }), { ghRunner: ghRunnerFor(), anchorDir: tmp(), liveDir: tmp() });
    assert.deepStrictEqual(r, { ok: false, reason: 'bad-lesson' });
  });
  assert.ok(alerts.some((a) => a.rmm_reason === 'bad-lesson'));
});

test('bad --pr-url -> {ok:false, bad-pr-url} + observable', async () => {
  const alerts = await captureAlerts(async () => {
    const r = await cli.runRecordManualMerge(happyArgs({ 'pr-url': 'https://github.com/octo/widget/issues/5' }), { ghRunner: ghRunnerFor(), anchorDir: tmp(), liveDir: tmp() });
    assert.deepStrictEqual(r, { ok: false, reason: 'bad-pr-url' });
  });
  assert.ok(alerts.some((a) => a.rmm_reason === 'bad-pr-url'));
});

test('diff-unavailable (empty merge-commit diff) -> {ok:false, diff-unavailable}', async () => {
  const r = await cli.runRecordManualMerge(happyArgs(), { ghRunner: ghRunnerFor({ diff: '' }), anchorDir: tmp(), liveDir: tmp() });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'diff-unavailable');
});

test('re-run is idempotent: a second identical run dedups (content-addressed), same node_id', async () => {
  const anchorDir = tmp();
  const liveDir = tmp();
  const r1 = await cli.runRecordManualMerge(happyArgs(), { ghRunner: ghRunnerFor(), anchorDir, liveDir });
  const r2 = await cli.runRecordManualMerge(happyArgs(), { ghRunner: ghRunnerFor(), anchorDir, liveDir });
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(r2.anchor_id, r1.anchor_id);
  assert.strictEqual(r2.node_id, r1.node_id);
  assert.strictEqual(r2.deduped, true, 'idempotent re-run reports deduped');
  assert.strictEqual(liveStore.listLiveNodes({ dir: liveDir }).length, 1, 'exactly one node after a re-run');
});

// R2' + idempotency (VALIDATE code-reviewer FAIL): emitted_at is in ATT_FIELDS -> content_hash, so a
// wall-clock value would make a same-PR retry collision-reject instead of dedup. It MUST come from the
// retry-stable gh merged_at. Assert the SOURCE directly (a revert to wall-clock fails this deterministically).
test('emitted_at is the gh merged_at (retry-stable), NOT a wall-clock value', async () => {
  const anchorDir = tmp();
  const liveDir = tmp();
  const r = await cli.runRecordManualMerge(happyArgs(), { ghRunner: ghRunnerFor({ mergedAt: '2026-07-13T00:00:00Z' }), anchorDir, liveDir });
  assert.strictEqual(store.readAnchor(r.anchor_id, { dir: anchorDir }).emitted_at, '2026-07-13T00:00:00Z');
});

test('no merged_at (anomalous merged PR) -> {ok:false, no-merged-at} + observable; nothing written', async () => {
  const anchorDir = tmp();
  const liveDir = tmp();
  const alerts = await captureAlerts(async () => {
    const r = await cli.runRecordManualMerge(happyArgs(), { ghRunner: ghRunnerFor({ mergedAt: null }), anchorDir, liveDir });
    assert.deepStrictEqual(r, { ok: false, reason: 'no-merged-at' });
  });
  assert.ok(alerts.some((a) => a.rmm_reason === 'no-merged-at'));
  assert.strictEqual(store.listAnchors({ dir: anchorDir }).length, 0, 'no attestation when merged_at is missing');
});

// L2/R5' (hacker + code-reviewer): the attestation-succeeds/mint-fails partial state must emit the arm's OWN
// classifier AND surface anchor_id (so a re-run with a valid store completes the mint).
test('partial-state: attestation persists but the mint fails (bad liveDir) -> {ok:false, mint-failed} + observable + anchor_id surfaced', async () => {
  const anchorDir = tmp();
  const liveFile = path.join(tmp(), 'not-a-dir');
  fs.writeFileSync(liveFile, 'x'); // liveDir points at a FILE -> mintWorldAnchoredNode's ensureStoreDir throws
  const alerts = await captureAlerts(async () => {
    const r = await cli.runRecordManualMerge(happyArgs(), { ghRunner: ghRunnerFor(), anchorDir, liveDir: liveFile });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'mint-failed');
    assert.ok(/^[0-9a-f]{64}$/.test(r.anchor_id), 'anchor_id surfaced for the persisted attestation');
  });
  assert.ok(alerts.some((a) => a.reason === 'record-manual-merge-refused' && a.rmm_reason === 'mint-failed'), "the arm emits its OWN mint-failed classifier");
  assert.strictEqual(store.listAnchors({ dir: anchorDir }).length, 1, 'attestation persisted despite the mint failure (partial state)');
});

// M1 (hacker): an assume-breach gh response with a C1 control char in a persisted/echoed field is a trust
// boundary - branch + author get the SAME control-char reject the arm applies to the operator built_by.
test('fetchPrMergeMeta: a C1 control char in branch -> {ok:false, bad-branch} + observable', async () => {
  const alerts = await captureAlerts(async () => {
    const r = await gh.fetchPrMergeMeta({ repo: REPO_OK, pr_number: 77 }, { runner: ghRunnerFor({ branch: 'evil\u009bbr' }) });
    assert.deepStrictEqual(r, { ok: false, reason: 'bad-branch' });
  });
  assert.ok(alerts.some((a) => a.gh_reason === 'meta-bad-branch'));
});

test('fetchPrMergeMeta: a C1 control char in author -> {ok:false, bad-author}', async () => {
  const r = await gh.fetchPrMergeMeta({ repo: REPO_OK, pr_number: 77 }, { runner: ghRunnerFor({ author: 'op\u009bx' }) });
  assert.deepStrictEqual(r, { ok: false, reason: 'bad-author' });
});

(async () => {
  for (const t of tests) { await t.fn(); passed += 1; }
  console.log(`record-manual-merge.test.js: ${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
