#!/usr/bin/env node

// tests/unit/lab/world-anchor/attest-from-capture.test.js
//
// item-3-live Half B - the EMIT-side attest-from-capture producer (SHADOW / weight-inert /
// production-inert). The write half of the captured-lesson merge wire (#455 built the MINT read half).
//
// runAttestFromCapture sources `att.lesson_signature` from a captured `live_pending` lesson and writes a
// world-anchor attestation, so the #455 captured-floor branch fires from a LEGIT producer (not the
// hardcoded LESSON_2137 grandfather). The lesson lookup lives in world-anchor-mint.js
// (resolveCapturedSignatureForAttest) - the existing admitted lane reader - so the producer's lookup and
// the mint's Branch-B join CANNOT diverge, and cli.js NEVER reads live-pending-store directly (the dam
// stays at one reader).
//
// Behavioral SPEC, written FIRST (TDD). Run as MODULE functions (dir-injectable), never against the real
// store. Mirrors cli.test.js / world-anchor-mint.test.js STYLE (node:assert + a light test() runner +
// LOOM_LAB_STATE_DIR pinned BEFORE the store modules are required + the stderr-capture pattern).

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Test isolation: pin the lab-state base to a throwaway tmp dir BEFORE the store modules are required
// (they read LOOM_LAB_STATE_DIR at module load), so a test that omits an injected dir can NEVER write to
// the real ~/.claude/lab-state store (the cli.test.js dogfood lesson, carried verbatim).
process.env.LOOM_LAB_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-test-labstate-afc-'));

const REPO = path.join(__dirname, '..', '..', '..', '..');
const cli = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'cli.js'));
const mint = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'world-anchor-mint.js'));
const store = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'world-anchor-store.js'));
const liveStore = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'live-recall-store.js'));
const outcomeStore = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'merge-outcome-store.js'));
const pendingStore = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'live-pending-store.js'));

let passed = 0; let failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-afc-')); }

// ---------------------------------------------------------------------------
// Fixtures - the grandfather tuple is irrelevant here (Half B sources the signature from CAPTURE), so we
// use a generic PR/issue. The captured lane stores repo as a URL; the producer normalizes both sides to a
// slug (repoSlug) before comparing.
// ---------------------------------------------------------------------------
const REPO_SLUG = 'octo/widget';
const REPO_URL = 'https://github.com/octo/widget';
const ISSUE_REF = 42;
const PR_NUMBER = 77;
const PR_URL = 'https://github.com/octo/widget/pull/77';
const CPS = 'a'.repeat(64);                  // candidate_patch_sha (HEX64)
const CPS2 = 'b'.repeat(64);                 // a second patch sha
const APPROVAL = 'd'.repeat(64);             // a HEX64 approval_hash
const BASE_SHA = 'f853934b61000ff076cea60c206db225e3ed89f0';  // HEX40
const MERGE_SHA = 'c0ffee'.repeat(6) + 'cafe';                // HEX40 gh merge_commit_sha
// Two distinct canonical taxonomy signatures (the captured floor uses these coarse-bucket keys).
const SIG_A = 'lesson:boundary-contract|unguarded-edge-case|handle-edge-explicitly';
const SIG_B = 'lesson:data-parse|silent-coercion|fail-closed';
const CAPTURED_BODY = 'a captured live-solve lesson hypothesis (Half B)';

function pendingDir(d) { return path.join(d, 'pending'); }
function liveDir(d) { return path.join(d, 'live'); }
function edgeDir(d) { return path.join(d, 'edges'); }
function outcomeDir(d) { return path.join(d, 'outcomes'); }

// Mint a captured live_pending node into the injected pendingDir (the writer fixture - mirrors how the
// live-draft-run capture branch mints one).
function capture(dir, over = {}) {
  const block = {
    repo: REPO_URL, issue_ref: ISSUE_REF, candidate_patch_sha: CPS,
    lesson_signature: SIG_A, lesson_body: CAPTURED_BODY, ...over,
  };
  const w = pendingStore.mintLivePendingLesson(block, { dir: pendingDir(dir) });
  assert.strictEqual(w.ok, true, `captured fixture lands (got ${w.reason})`);
  return w.node_id;
}

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

// Default valid args for runAttestFromCapture (an injected --diff so we never depend on /tmp).
function baseArgs(dir, over = {}) {
  const diffFile = path.join(dir, 'fix.diff');
  if (!fs.existsSync(diffFile)) fs.writeFileSync(diffFile, 'diff --git a/x b/x\n+change\n');
  return {
    'pr-url': PR_URL,
    'issue-ref': String(ISSUE_REF),
    'candidate-patch-sha': CPS,
    diff: diffFile,
    'approval-hash': APPROVAL,
    'base-sha': BASE_SHA,
    branch: 'loom/issue-42',
    'built-by': 'anonymous-actor',
    'emitted-at': '2026-06-28T00:00:00.000Z',
    ...over,
  };
}
function baseOpts(dir) { return { anchorDir: dir, pendingDir: pendingDir(dir) }; }

// ===========================================================================
// 1. THE SELECTION (Pre-Approval Verification SS A) - two fail-closed exact-set checks.
// ===========================================================================

test('resolveCapturedSignatureForAttest is exported alongside mintFromMergeOutcome', () => {
  assert.strictEqual(typeof mint.resolveCapturedSignatureForAttest, 'function', 'the helper is exported');
  assert.strictEqual(typeof mint.mintFromMergeOutcome, 'function', 'the mint stays exported');
});

test('selection: 0 captured for the tuple -> no-captured-lesson (observable)', () => {
  const dir = tmp();
  // nothing captured
  const { r, alerts } = captureAlerts(() => mint.resolveCapturedSignatureForAttest(
    { repoSlug: REPO_SLUG, issueRef: ISSUE_REF, candidatePatchSha: CPS }, { pendingDir: pendingDir(dir) },
  ));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no-captured-lesson');
  assert.ok(alerts.length > 0, 'the no-captured-lesson refuse is observable');
});

test('selection: exactly one captured -> {ok:true, lesson_signature}', () => {
  const dir = tmp();
  capture(dir);   // one node: (slug, 42, CPS, SIG_A)
  const { r } = captureAlerts(() => mint.resolveCapturedSignatureForAttest(
    { repoSlug: REPO_SLUG, issueRef: ISSUE_REF, candidatePatchSha: CPS }, { pendingDir: pendingDir(dir) },
  ));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.lesson_signature, SIG_A, 'the captured signature is returned');
});

test('selection check 1: >1 node same (repo,issue,cps) different signature -> ambiguous-captured-patch', () => {
  const dir = tmp();
  // two lesson axes from ONE patch (same cps, different lesson_signature)
  capture(dir, { lesson_signature: SIG_A });
  capture(dir, { lesson_signature: SIG_B });
  const { r, alerts } = captureAlerts(() => mint.resolveCapturedSignatureForAttest(
    { repoSlug: REPO_SLUG, issueRef: ISSUE_REF, candidatePatchSha: CPS }, { pendingDir: pendingDir(dir) },
  ));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'ambiguous-captured-patch', 'two axes from one patch -> ambiguous-captured-patch');
  assert.ok(alerts.some((a) => JSON.stringify(a).includes('ambiguous-captured-patch')), 'observable');
});

test('selection check 2: one cps but >1 node same (repo,issue,lesson_signature) -> ambiguous-captured-lesson', () => {
  const dir = tmp();
  // the selected cps yields SIG_A; a SECOND node shares (repo,issue,SIG_A) differing only by cps -> the
  // mint would see >1 on its (repoSlug,issue,sig) re-join -> ambiguous-floor-lesson. Refuse at the producer.
  capture(dir, { candidate_patch_sha: CPS, lesson_signature: SIG_A });
  capture(dir, { candidate_patch_sha: CPS2, lesson_signature: SIG_A });
  const { r, alerts } = captureAlerts(() => mint.resolveCapturedSignatureForAttest(
    { repoSlug: REPO_SLUG, issueRef: ISSUE_REF, candidatePatchSha: CPS }, { pendingDir: pendingDir(dir) },
  ));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'ambiguous-captured-lesson', 'the mint precondition (exactly-one by sig) fails -> refuse');
  assert.ok(alerts.some((a) => JSON.stringify(a).includes('ambiguous-captured-lesson')), 'observable');
});

test('selection: helper is TOTAL - a null opts does not throw, returns a refuse', () => {
  let r;
  assert.doesNotThrow(() => { r = mint.resolveCapturedSignatureForAttest({ repoSlug: REPO_SLUG, issueRef: ISSUE_REF, candidatePatchSha: CPS }, null); });
  assert.strictEqual(r.ok, false, 'a null opts (no pendingDir -> real default, no match) yields a refuse');
  assert.ok(typeof r.reason === 'string' && r.reason.length > 0, 'a refuse reason, not a crash');
});

// ===========================================================================
// 2. EMIT-ARG VALIDATION (SS C) - clean observable boundary refuse, NOT the downstream bad-attestation.
// ===========================================================================

test('emit-arg: a malformed --base-sha refuses at the producer boundary (NOT bad-attestation)', () => {
  const dir = tmp();
  capture(dir);
  const { r, alerts } = captureAlerts(() => cli.runAttestFromCapture(baseArgs(dir, { 'base-sha': 'xyz' }), baseOpts(dir)));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'bad-base-sha', 'a clean producer-boundary refuse, not the confusing downstream bad-attestation');
  assert.notStrictEqual(r.reason, 'bad-attestation', 'the validation is at the producer boundary, not the store');
  assert.ok(alerts.length > 0, 'the refuse is observable');
});

test('emit-arg: a malformed --approval-hash refuses bad-approval-hash at the boundary', () => {
  const dir = tmp();
  capture(dir);
  const { r } = captureAlerts(() => cli.runAttestFromCapture(baseArgs(dir, { 'approval-hash': 'nothex' }), baseOpts(dir)));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'bad-approval-hash');
});

test('emit-arg: a missing --candidate-patch-sha refuses missing-candidate-patch-sha (REQUIRED)', () => {
  const dir = tmp();
  capture(dir);
  const args = baseArgs(dir);
  delete args['candidate-patch-sha'];
  const { r, alerts } = captureAlerts(() => cli.runAttestFromCapture(args, baseOpts(dir)));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'missing-candidate-patch-sha', 'cps is REQUIRED (a multi-solve issue never silently picks)');
  assert.ok(alerts.length > 0, 'observable');
});

test('emit-arg: a control-char --built-by refuses (bounded plain string)', () => {
  const dir = tmp();
  capture(dir);
  const { r } = captureAlerts(() => cli.runAttestFromCapture(baseArgs(dir, { 'built-by': 'evilactor' }), baseOpts(dir)));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'bad-built-by', 'a control char in --built-by is refused at the boundary');
});

test('emit-arg: a control-char --branch refuses (bounded plain string)', () => {
  const dir = tmp();
  capture(dir);
  const { r } = captureAlerts(() => cli.runAttestFromCapture(baseArgs(dir, { branch: 'b ranch' }), baseOpts(dir)));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'bad-branch');
});

test('emit-arg: DEL (0x7f) + C1 (0x80-0x9f) in --built-by refuse (the tightened band, NON-VACUOUS)', () => {
  // The original guard rejected only C0 (<0x20); DEL + the C1 band rode through (VALIDATE hacker MEDIUM).
  // This goes RED on the old guard (ok:true) + GREEN on the tightened band. \u escapes keep source ASCII.
  const dir = tmp();
  capture(dir);
  const del = captureAlerts(() => cli.runAttestFromCapture(baseArgs(dir, { 'built-by': 'who' + String.fromCharCode(0x7f) + 'del' }), baseOpts(dir))).r;
  assert.strictEqual(del.ok, false, 'DEL (0x7f) in --built-by is refused by the tightened band');
  assert.strictEqual(del.reason, 'bad-built-by');
  const c1 = captureAlerts(() => cli.runAttestFromCapture(baseArgs(dir, { 'built-by': 'who' + String.fromCharCode(0x9b) + 'csi' }), baseOpts(dir))).r;
  assert.strictEqual(c1.ok, false, 'a C1 control byte (0x9b CSI) in --built-by is refused');
  assert.strictEqual(c1.reason, 'bad-built-by');
});

test('emit-arg: a missing --diff file refuses (diff_hash is re-derived from the bytes, never an arg)', () => {
  const dir = tmp();
  capture(dir);
  const { r } = captureAlerts(() => cli.runAttestFromCapture(baseArgs(dir, { diff: path.join(dir, 'nope.diff') }), baseOpts(dir)));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'diff-unreadable', 'a missing --diff refuses; the producer never accepts a --diff-hash arg');
});

test('emit-arg: a malformed --pr-url refuses bad-pr-url at the boundary', () => {
  const dir = tmp();
  capture(dir);
  const { r } = captureAlerts(() => cli.runAttestFromCapture(baseArgs(dir, { 'pr-url': 'https://github.com/octo/widget/issues/5' }), baseOpts(dir)));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'bad-pr-url');
});

// ===========================================================================
// HAPPY: a captured node -> a recorded attestation whose lesson_signature is the CAPTURED one.
// ===========================================================================

test('happy: a captured node yields a recorded attestation sourcing the captured lesson_signature', () => {
  const dir = tmp();
  capture(dir);
  const { r } = captureAlerts(() => cli.runAttestFromCapture(baseArgs(dir), baseOpts(dir)));
  assert.strictEqual(r.ok, true, `attest succeeds (got ${r.reason})`);
  assert.ok(/^[0-9a-f]{64}$/.test(r.anchor_id), 'a 64-hex anchor_id');
  // the attestation is readable + carries the CAPTURED signature, the SLUG repo, and the re-derived diff_hash
  const att = store.readAnchor(r.anchor_id, { dir });
  assert.ok(att, 'the attestation is readable from the store');
  assert.strictEqual(att.lesson_signature, SIG_A, 'lesson_signature sourced from the captured node, not LESSON_2137');
  assert.strictEqual(att.repo, REPO_SLUG, 'the repo is stored as a SLUG (so the mint join works)');
  const expectedDiffHash = require('crypto').createHash('sha256').update(fs.readFileSync(baseArgs(dir).diff)).digest('hex');
  assert.strictEqual(att.diff_hash, expectedDiffHash, 'diff_hash is re-derived from the --diff bytes');
});

test('happy: the success output SURFACES the stored att.pr_url (eyeball byte-identity coupling)', () => {
  const dir = tmp();
  capture(dir);
  const { r } = captureAlerts(() => cli.runAttestFromCapture(baseArgs(dir), baseOpts(dir)));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.pr_url, PR_URL, 'the stored att.pr_url is surfaced so an operator can match it to the kernel join-key');
});

// ===========================================================================
// 3. --pr-url byte-identity (SS C(3)) - a trailing-slash / case-variant does NOT join.
// ===========================================================================

test('pr-url byte-identity: a trailing-slash --pr-url produces an attestation that does NOT join the canonical PR at mint', () => {
  // Build a full wire: a captured node, a variant-URL attestation, and a merge-outcome record for the
  // CANONICAL pr_url. The variant attestation's pr_url differs, so resolveAnchorForPr (the mint's EXACT-set
  // tuple join) finds NO match -> an observable no-match-class outcome, never a silent wrong-PR success.
  const dir = tmp();
  capture(dir);
  // the variant URL: trailing slash. parsePrUrl trims but does NOT strip a trailing slash, so the
  // attestation's pr_url is the canonical-with-slash form, which the canonical join tuple won't match.
  const variantUrl = PR_URL + '/';
  const { r } = captureAlerts(() => cli.runAttestFromCapture(baseArgs(dir, { 'pr-url': variantUrl }), baseOpts(dir)));
  // Either the variant URL fails to parse (bad-pr-url) OR it parses to a non-canonical pr_url. Both are
  // acceptable observable no-join outcomes; what is NOT acceptable is a silent join to the canonical PR.
  if (r.ok) {
    assert.notStrictEqual(r.pr_url, PR_URL, 'a trailing-slash --pr-url never lands as the canonical byte-identical URL');
    // now drive the mint against a CANONICAL merge-outcome record -> it must NOT resolve the variant attestation
    const jkid = 'e'.repeat(64);
    outcomeStore.recordMergeOutcome({
      join_key_id: jkid, repo: REPO_SLUG, pr_number: PR_NUMBER, pr_url: PR_URL,
      approval_hash: APPROVAL, outcome: 'merged', merge_commit_sha: MERGE_SHA, observed_at: '2026-06-28T12:00:00.000Z',
    }, { dir: outcomeDir(dir) });
    const { r: m } = captureAlerts(() => mint.mintFromMergeOutcome(
      { join_key_id: jkid },
      { anchorDir: dir, liveDir: liveDir(dir), edgeDir: edgeDir(dir), outcomeDir: outcomeDir(dir), pendingDir: pendingDir(dir) },
    ));
    assert.strictEqual(m.minted, false, 'a variant-URL attestation does NOT join the canonical PR at mint');
    assert.strictEqual(m.mint_reason, 'no-match', 'an observable no-match-class outcome, not a silent wrong success');
  } else {
    assert.strictEqual(r.reason, 'bad-pr-url', 'a non-canonical --pr-url is refused at the boundary');
  }
});

// ===========================================================================
// 4. THE JOIN-PROBE (hard VALIDATE gate, REAL stores) - the producer wire actually joins the #455 mint,
//    resolving EXACTLY the captured lesson (origin/body = the captured one, NOT LESSON_2137), minted:true.
// ===========================================================================

test('JOIN-PROBE: captured node -> runAttestFromCapture -> mintFromMergeOutcome resolves the CAPTURED lesson (minted:true)', () => {
  const dir = tmp();
  // 1. a captured live_pending node (the floor source)
  capture(dir);
  // 2. the producer writes the attestation, sourcing the captured signature
  const { r: prod } = captureAlerts(() => cli.runAttestFromCapture(baseArgs(dir), baseOpts(dir)));
  assert.strictEqual(prod.ok, true, `the producer attests (got ${prod.reason})`);
  // 3. a matching gh-verified merge-outcome record (the mint's input)
  const jkid = 'd'.repeat(64);
  const w = outcomeStore.recordMergeOutcome({
    join_key_id: jkid, repo: REPO_SLUG, pr_number: PR_NUMBER, pr_url: PR_URL,
    approval_hash: APPROVAL, outcome: 'merged', merge_commit_sha: MERGE_SHA, observed_at: '2026-06-28T12:00:00.000Z',
  }, { dir: outcomeDir(dir) });
  assert.strictEqual(w.ok, true, 'the merge-outcome record lands');
  // 4. drive the mint - Branch B must resolve EXACTLY the captured lesson
  const m = mint.mintFromMergeOutcome(
    { join_key_id: jkid },
    { anchorDir: dir, liveDir: liveDir(dir), edgeDir: edgeDir(dir), outcomeDir: outcomeDir(dir), pendingDir: pendingDir(dir) },
  );
  assert.strictEqual(m.minted, true, 'the mint resolves the captured floor + mints the node');
  const node = liveStore.readLiveNode(m.node_id, { dir: liveDir(dir) });
  assert.ok(node, 'the node is readable');
  assert.strictEqual(node.lesson_signature, SIG_A, 'the node carries the CAPTURED signature');
  assert.strictEqual(node.lesson_body, CAPTURED_BODY, 'the node body is the CAPTURED body, NOT LESSON_2137');
  const LESSON_2137_BODY_FRAGMENT = 'uv run pytest';
  assert.ok(!node.lesson_body.includes(LESSON_2137_BODY_FRAGMENT), 'the node is NOT the LESSON_2137 grandfather body');
});

// ===========================================================================
// 5. deny-not-substitute (TOCTOU forward-contract) - plant a SECOND competing node AFTER attesting; the
//    mint refuses ambiguous-floor-lesson, never world-anchors the wrong body.
// ===========================================================================

test('deny-not-substitute: a competing captured node planted AFTER attesting -> mint refuses ambiguous-floor-lesson', () => {
  const dir = tmp();
  capture(dir);                                   // the legit captured node (slug,42,CPS,SIG_A)
  const { r: prod } = captureAlerts(() => cli.runAttestFromCapture(baseArgs(dir), baseOpts(dir)));
  assert.strictEqual(prod.ok, true, 'the producer attests the legit captured lesson');
  // PLANT a second node sharing (repo,issue,SIG_A) differing by cps - the mint re-joins on
  // (repoSlug,issue,lesson_signature) ONLY, so it now sees >1 -> ambiguous-floor-lesson (deny, never substitute).
  capture(dir, { candidate_patch_sha: CPS2, lesson_signature: SIG_A, lesson_body: 'an attacker body planted late' });
  const jkid = 'd'.repeat(64);
  outcomeStore.recordMergeOutcome({
    join_key_id: jkid, repo: REPO_SLUG, pr_number: PR_NUMBER, pr_url: PR_URL,
    approval_hash: APPROVAL, outcome: 'merged', merge_commit_sha: MERGE_SHA, observed_at: '2026-06-28T12:00:00.000Z',
  }, { dir: outcomeDir(dir) });
  const { r: m, alerts } = captureAlerts(() => mint.mintFromMergeOutcome(
    { join_key_id: jkid },
    { anchorDir: dir, liveDir: liveDir(dir), edgeDir: edgeDir(dir), outcomeDir: outcomeDir(dir), pendingDir: pendingDir(dir) },
  ));
  assert.strictEqual(m.minted, false, 'the mint DENIES (never substitutes the attacker body)');
  assert.strictEqual(m.mint_reason, 'ambiguous-floor-lesson', 'a planted competing tuple denies a weight-inert shadow mint');
  assert.ok(alerts.some((a) => JSON.stringify(a).includes('ambiguous-floor-lesson')), 'the deny is observable');
  assert.strictEqual(liveStore.listLiveNodes({ dir: liveDir(dir) }).length, 0, 'NO node minted (never the wrong body)');
});

// ===========================================================================
// 6. repoSlug parity - the URL / slug / .git triad resolves identically on the producer side and the
//    mint side (the producer reuses the in-module repoSlug, so they CANNOT diverge).
// ===========================================================================

test('repoSlug parity: a captured node stored as a .git URL joins a bare-slug attestation on both sides', () => {
  const dir = tmp();
  // the captured node's repo is a .git clone-URL form; the attestation repo is the bare slug.
  capture(dir, { repo: REPO_URL + '.git' });
  // the producer must still find the captured node (repoSlug strips .git on both sides)
  const { r: prod } = captureAlerts(() => cli.runAttestFromCapture(baseArgs(dir), baseOpts(dir)));
  assert.strictEqual(prod.ok, true, 'the producer joins the .git-form captured node to the bare-slug input');
  assert.strictEqual(prod.lesson_signature, SIG_A, 'the captured signature is selected across the .git/slug shapes');
  // and the produced attestation joins the mint's Branch B (same repoSlug normalization)
  const jkid = 'd'.repeat(64);
  outcomeStore.recordMergeOutcome({
    join_key_id: jkid, repo: REPO_SLUG, pr_number: PR_NUMBER, pr_url: PR_URL,
    approval_hash: APPROVAL, outcome: 'merged', merge_commit_sha: MERGE_SHA, observed_at: '2026-06-28T12:00:00.000Z',
  }, { dir: outcomeDir(dir) });
  const m = mint.mintFromMergeOutcome(
    { join_key_id: jkid },
    { anchorDir: dir, liveDir: liveDir(dir), edgeDir: edgeDir(dir), outcomeDir: outcomeDir(dir), pendingDir: pendingDir(dir) },
  );
  assert.strictEqual(m.minted, true, 'the .git captured node + bare-slug attestation join the mint identically');
});

// ===========================================================================
// TOTALITY - runAttestFromCapture never throws; a no-captured-lesson is a clean refuse.
// ===========================================================================

test('runAttestFromCapture is TOTAL: a no-captured-lesson is a clean refuse, never a throw', () => {
  const dir = tmp();
  // no captured node
  let r;
  const { r: captured } = captureAlerts(() => { assert.doesNotThrow(() => { r = cli.runAttestFromCapture(baseArgs(dir), baseOpts(dir)); }); return r; });
  assert.strictEqual(captured.ok, false);
  assert.strictEqual(captured.reason, 'no-captured-lesson', 'no captured node -> a clean no-captured-lesson refuse');
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${name}\n      ${e && e.message}`); }
  }
  console.log(`\nattest-from-capture.test.js: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
