#!/usr/bin/env node

// tests/unit/lab/world-anchor/gh-verify.test.js
//
// gap-map item 2, PR-2 - the gh merge-outcome verifier. Injectable-runner unit tests; the REAL gh is
// NEVER shelled here. Covers the VERIFY-board REQUIRED non-vacuity cases (build-binding):
//   (a) merged:false + a NON-NULL merge_commit_sha (the open-PR trap: a test-merge sha is non-null for
//       an OPEN unmerged PR; the gate must NOT trust sha-presence).
//   (b) merged:null / merged absent -> unverifiable, fail-closed.
//   (c) state:'closed' + merged:false (a closed-UNMERGED PR is also 'closed') -> merged:false, NOT recorded.
//   (d) gh non-zero exit (404 nonexistent / 403 private) -> fail-closed + observable.
//   (e) a leading-dash repo segment (o/-r, which parse-pr-url admits) REJECTED at the gh-verify boundary.
//   (f) the happy path merged:true + a HEX40 sha.
// Plus: bad pr_number rejected; a timeout fail-closed; an unparseable/non-object response fail-closed.

'use strict';

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const { verifyMerge, isGhRepo, assertReadOnlyGhArgs, defaultRunner } = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'gh-verify.js'));

let passed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// A runner that returns the given parsed object as the gh --jq stdout (the shape gh emits for our jq).
function runnerReturning(obj) {
  return async () => ({ stdout: `${JSON.stringify(obj)}\n` });
}
// A runner that REJECTS (a non-zero gh exit / spawn error / timeout).
function runnerFailing(over = {}) {
  return async () => { const e = new Error('gh failed'); Object.assign(e, over); throw e; };
}
// A runner returning raw (non-JSON) stdout.
function runnerRaw(text) { return async () => ({ stdout: text }); }

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
const SHA40 = 'a'.repeat(40);

// (f) the happy path
test('(f) happy path: merged:true + HEX40 sha -> {ok:true, merged:true, merge_commit_sha}', async () => {
  const r = await verifyMerge({ repo: REPO_OK, pr_number: 77 }, { runner: runnerReturning({ merged: true, merge_commit_sha: SHA40, state: 'closed' }) });
  assert.deepStrictEqual(r, { ok: true, merged: true, merge_commit_sha: SHA40 });
});

// (a) the open-PR trap: merged:false but a non-null merge_commit_sha (a test-merge sha)
test('(a) open-PR trap: merged:false + a NON-NULL merge_commit_sha -> {ok:true, merged:false} (never trusts sha-presence)', async () => {
  const r = await verifyMerge({ repo: REPO_OK, pr_number: 5 }, { runner: runnerReturning({ merged: false, merge_commit_sha: SHA40, state: 'open' }) });
  assert.deepStrictEqual(r, { ok: true, merged: false }, 'a non-null test-merge sha on an unmerged PR must NOT be recorded as merged');
});

// (b) merged null / absent
test('(b) merged:null is unverifiable -> {ok:false, reason:merged-not-boolean} + observable', async () => {
  const alerts = await captureAlerts(async () => {
    const r = await verifyMerge({ repo: REPO_OK, pr_number: 5 }, { runner: runnerReturning({ merged: null, merge_commit_sha: null, state: 'open' }) });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'merged-not-boolean');
  });
  assert.ok(alerts.some((al) => al.reason === 'merge-verify-failed' && al.gh_reason === 'merged-not-boolean'), 'null merged is observable (NON-VACUOUS)');
});

test('(b2) merged absent (key missing) is unverifiable -> fail-closed', async () => {
  const r = await verifyMerge({ repo: REPO_OK, pr_number: 5 }, { runner: runnerReturning({ merge_commit_sha: null, state: 'open' }) });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'merged-not-boolean');
});

// (c) state:'closed' + merged:false (a closed-unmerged PR)
test('(c) state:closed + merged:false -> {ok:true, merged:false} (never gates on state===closed)', async () => {
  const r = await verifyMerge({ repo: REPO_OK, pr_number: 9 }, { runner: runnerReturning({ merged: false, merge_commit_sha: null, state: 'closed' }) });
  assert.deepStrictEqual(r, { ok: true, merged: false }, 'a closed-but-unmerged PR is merged:false, not recorded');
});

// (d) gh non-zero exit
test('(d) gh non-zero exit (404 nonexistent) -> {ok:false, reason:gh-failed} + observable', async () => {
  const alerts = await captureAlerts(async () => {
    const r = await verifyMerge({ repo: REPO_OK, pr_number: 404 }, { runner: runnerFailing({ code: 1 }) });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'gh-failed');
  });
  assert.ok(alerts.some((al) => al.reason === 'merge-verify-failed' && al.gh_reason === 'gh-exit'), 'a gh exit is observable (NON-VACUOUS)');
});

test('(d2) gh timeout (killed) -> {ok:false, reason:gh-failed} + observable as gh-timeout', async () => {
  const alerts = await captureAlerts(async () => {
    const r = await verifyMerge({ repo: REPO_OK, pr_number: 1 }, { runner: runnerFailing({ killed: true, code: null }) });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'gh-failed');
  });
  assert.ok(alerts.some((al) => al.reason === 'merge-verify-failed' && al.gh_reason === 'gh-timeout'), 'a timeout is observable + distinct');
});

// (e) leading-dash repo segment rejected at the gh-verify boundary (parse-pr-url admits it; gh-verify rejects)
test('(e) a leading-dash repo segment (o/-r) is REJECTED at the gh-verify boundary (before any runner call)', async () => {
  let runnerCalled = false;
  const r = await verifyMerge({ repo: 'octo/-evil', pr_number: 1 }, { runner: async () => { runnerCalled = true; return { stdout: '{}' }; } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'bad-repo');
  assert.strictEqual(runnerCalled, false, 'a bad repo never reaches the gh subprocess');
  assert.strictEqual(isGhRepo('octo/-evil'), false, 'isGhRepo rejects a leading-dash segment');
  assert.strictEqual(isGhRepo('octo/widget'), true, 'isGhRepo accepts a normal repo');
});

test('(e2) a non-two-segment repo is rejected; isGhRepo edge-cases', () => {
  assert.strictEqual(isGhRepo('only-one-segment'), false);
  assert.strictEqual(isGhRepo('a/b/c'), false, 'three segments rejected');
  assert.strictEqual(isGhRepo('a/'), false, 'empty second segment rejected');
  assert.strictEqual(isGhRepo('-lead/repo'), false, 'leading-dash owner rejected');
  assert.strictEqual(isGhRepo('owner/repo.js'), true, 'a dot is gh-name-safe');
});

// pr_number boundary (defense-in-depth vs the 1e+23 overflow)
test('a non-positive / non-safe-int pr_number is REJECTED at the boundary (no runner call)', async () => {
  let called = false;
  const runner = async () => { called = true; return { stdout: '{}' }; };
  assert.strictEqual((await verifyMerge({ repo: REPO_OK, pr_number: 0 }, { runner })).reason, 'bad-pr-number');
  assert.strictEqual((await verifyMerge({ repo: REPO_OK, pr_number: -3 }, { runner })).reason, 'bad-pr-number');
  assert.strictEqual((await verifyMerge({ repo: REPO_OK, pr_number: 1e23 }, { runner })).reason, 'bad-pr-number');
  assert.strictEqual(called, false, 'a bad pr_number never reaches the gh subprocess');
});

// unparseable / non-object
test('an unparseable gh response -> {ok:false, reason:unparseable} + observable', async () => {
  const alerts = await captureAlerts(async () => {
    const r = await verifyMerge({ repo: REPO_OK, pr_number: 1 }, { runner: runnerRaw('<html>not json</html>') });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'unparseable');
  });
  assert.ok(alerts.some((al) => al.reason === 'merge-verify-failed' && al.gh_reason === 'unparseable'), 'unparseable is observable');
});

test('a non-object (array) gh response -> fail-closed unparseable', async () => {
  const r = await verifyMerge({ repo: REPO_OK, pr_number: 1 }, { runner: runnerReturning([1, 2, 3]) });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'unparseable');
});

// merged:true but a bad sha
test('merged:true but a non-HEX40 merge_commit_sha -> {ok:false, reason:bad-merge-sha} + observable', async () => {
  const alerts = await captureAlerts(async () => {
    const r = await verifyMerge({ repo: REPO_OK, pr_number: 1 }, { runner: runnerReturning({ merged: true, merge_commit_sha: 'not-a-sha', state: 'closed' }) });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'bad-merge-sha');
  });
  assert.ok(alerts.some((al) => al.reason === 'merge-verify-failed' && al.gh_reason === 'bad-merge-sha'), 'a bad sha on a merged PR is observable');
});

// the runner receives the right argv (no token, the correct endpoint + jq, a pinned -X GET).
test('the runner is invoked with `api -X GET repos/<repo>/pulls/<n>` + a --jq, NO token in argv', async () => {
  let captured = null;
  await verifyMerge({ repo: REPO_OK, pr_number: 42 }, { runner: async (args) => { captured = args; return { stdout: '{"merged":true,"merge_commit_sha":"' + SHA40 + '","state":"closed"}' }; } });
  assert.strictEqual(captured[0], 'api');
  assert.ok(captured.includes('-X') && captured[captured.indexOf('-X') + 1] === 'GET', 'an explicit -X GET is pinned (read-only)');
  assert.ok(captured.includes('repos/octo/widget/pulls/42'), 'the endpoint positional is present');
  assert.ok(captured.includes('--jq'), 'a --jq projection is passed');
  assert.ok(!captured.some((a) => /token|GH_TOKEN|ghp_/i.test(a)), 'no token-bearing arg');
});

// NON-VACUITY on the read-only GET-gate: prove it REFUSES a write verb / a missing -X GET / a non-api call.
test('assertReadOnlyGhArgs is non-vacuous: it refuses a write verb, a glued -XPOST, a missing -X GET, and a non-api call', () => {
  assert.strictEqual(assertReadOnlyGhArgs(['api', '-X', 'GET', 'repos/o/r/pulls/1']), true, 'a pinned -X GET passes');
  assert.throws(() => assertReadOnlyGhArgs(['api', '-X', 'POST', 'repos/o/r/pulls']), /write verb refused/, 'a POST is refused');
  assert.throws(() => assertReadOnlyGhArgs(['api', '--method=DELETE', 'repos/o/r']), /write verb refused/, 'a glued --method=DELETE is refused');
  assert.throws(() => assertReadOnlyGhArgs(['api', 'repos/o/r/pulls/1', '--jq', '.merged']), /must explicitly pin -X GET/, 'a missing -X GET is refused (auto-POST hazard)');
  assert.throws(() => assertReadOnlyGhArgs(['repo', 'view']), /only `gh api`/, 'a non-api call is refused');
});

// the default runner enforces the GET-gate BEFORE spawning: a write-arg verifyMerge call would throw in
// defaultRunner. We exercise the gate directly (the runner is the only place real gh would spawn).
test('the default runner path refuses a non-GET argv before any subprocess (GET-only by construction)', () => {
  assert.throws(() => assertReadOnlyGhArgs(['api', 'repos/o/r', '-f', 'state=closed']), /must explicitly pin -X GET/, 'a -f data field with no -X GET would auto-POST -> refused');
});

// VALIDATE-hacker M-1: prove defaultRunner INVOKES the gate at its call-site (not just that the gate
// function works in isolation). A write-arg throws SYNCHRONOUSLY in defaultRunner, before any subprocess.
test('defaultRunner invokes the GET-gate at its call-site: a write-arg throws before any spawn', () => {
  assert.throws(() => defaultRunner(['api', '-X', 'POST', 'repos/o/r/pulls'], { timeoutMs: 1, maxBytes: 1, env: {} }), /write verb refused/, 'defaultRunner refuses a POST before spawning');
  assert.throws(() => defaultRunner(['api', 'repos/o/r', '-f', 'x=1'], { timeoutMs: 1, maxBytes: 1, env: {} }), /must explicitly pin -X GET/, 'defaultRunner refuses an auto-POST -f field before spawning');
});

(async () => {
  for (const t of tests) { await t.fn(); passed += 1; }
  console.log(`gh-verify.test.js: ${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
