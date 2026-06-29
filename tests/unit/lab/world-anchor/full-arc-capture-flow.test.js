#!/usr/bin/env node

// tests/unit/lab/world-anchor/full-arc-capture-flow.test.js
//
// PHASE-CLOSE 3c - the autonomous-SDE capture-wire FULL-ARC in-process integration test (SHADOW /
// weight-inert). The per-seam suites each cover ONE store boundary; attest-from-capture.test.js's
// JOIN-PROBE chains producer->mint but BYPASSES the capture step (it mints the captured node inline as a
// fixture and asserts the attestation join). This test wires the REAL stores end-to-end across the whole
// arc - capture -> attest -> (kernel join-key + gh-verified merge-observe) -> mint - mocking ONLY the two
// EXTERNAL boundaries (the gh runner + the claude deriveFn, which is not even invoked here because the
// captured node IS the deriver's product). NOTHING in the lab substrate is stubbed; every store is the real
// content-addressed module, so this exercises the actual cross-module joins (repoSlug normalization, the
// exact-set lesson resolution, the kernel-sealed approval_hash rebind) that no single-seam test sees.
//
// WHAT THIS IS / IS NOT: this is the IN-PROCESS ACCEPTANCE WALK - the closeable bar for 3c. The TRUE
// external e2e (a real `claude -p` live-lesson deriver populating the captured node + a real GitHub merge
// driving observe-merge) is a NAMED RESIDUAL, NOT covered here (it crosses an external boundary - network +
// an LLM - and is never faked; per Rule-2a-corollary a mock-green suite is a hypothesis about the path it
// mocks, never proof the real path works). The deriver leg (#457 `lessonLegFn`) and the gh call are the two
// faked legs; the lab stores in between are 100% real.
//
// Run as MODULE functions (dir-injectable), never against the real ~/.claude/lab-state store. Mirrors
// attest-from-capture.test.js / merge-observer.test.js STYLE (node:assert + a light test() runner +
// LOOM_LAB_STATE_DIR pinned BEFORE the store modules are required so a missed dir-injection can NEVER write
// the real store; real mkdtemp temp dirs cleaned up in a finally).

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Test isolation: pin the lab-state base to a throwaway tmp dir BEFORE the store modules are required (the
// kernel join-key store + every lab store capture LOOM_LAB_STATE_DIR / their DEFAULT_DIR at module load).
// observe-merge reads the KERNEL join-key store via its DEFAULT_DIR (it does NOT accept a join-key dir - it
// is the production reader), so pinning the base is the ONLY way to isolate that read (the merge-observer
// dogfood lesson, carried verbatim).
process.env.LOOM_LAB_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-test-labstate-fullarc-'));

const REPO = path.join(__dirname, '..', '..', '..', '..');
const cli = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'cli.js'));
const mint = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'world-anchor-mint.js'));
const liveStore = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'live-recall-store.js'));
const outcomeStore = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'merge-outcome-store.js'));
const pendingStore = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'live-pending-store.js'));
const jkStore = require(path.join(REPO, 'packages', 'kernel', 'egress', 'join-key-store.js'));
const { lessonClusterKey } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'lesson-signature.js'));

let passed = 0; let failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-fullarc-')); }

const SELF = typeof process.getuid === 'function' ? process.getuid() : null;
const JK_DIR = jkStore.DEFAULT_DIR;            // the kernel egress-join-keys default, under the pinned base

// ---------------------------------------------------------------------------
// Fixtures - one captured lesson on a frozen-floor triple. The lesson_signature is the REAL lessonClusterKey
// over a canonical (trigger, gotcha, corrective) triple (NOT a hand-literal'd string), so the mint's
// frozen-24-key taxonomy gate (isCanonicalLessonSignature) admits it - the same key machinery the live
// deriver emits. The captured BODY is the model-derived lesson prose that the #457 `claude -p` leg would
// produce (faked here as a known constant; that LLM leg is the named external residual).
// ---------------------------------------------------------------------------
const REPO_SLUG = 'octo/widget';
const REPO_URL = 'https://github.com/octo/widget';
const ISSUE_REF = 42;
const PR_NUMBER = 77;
const PR_URL = 'https://github.com/octo/widget/pull/77';
const CPS = 'a'.repeat(64);                    // candidate_patch_sha (HEX64)
const APPROVAL = 'd'.repeat(64);               // a HEX64 approval_hash (the kernel-sealed join-key field)
const BASE_SHA = 'f'.repeat(40);               // HEX40 base_sha
const MERGE_SHA = 'c0ffee'.repeat(6) + 'cafe'; // HEX40 gh merge_commit_sha (gh-reported world-evidence)
const CAPTURED_SIG = lessonClusterKey({
  trigger_class: 'boundary-contract', gotcha_class: 'unguarded-edge-case', corrective_class: 'handle-edge-explicitly',
});
const CAPTURED_BODY = 'guard the empty-slice edge before indexing (the captured live-solve hypothesis)';

function pendingDir(d) { return path.join(d, 'pending'); }
function liveDir(d) { return path.join(d, 'live'); }
function edgeDir(d) { return path.join(d, 'edges'); }
function outcomeDir(d) { return path.join(d, 'outcomes'); }

// STEP 1 - mint a captured live_pending node via the REAL store (the deriver's product). This stands in for
// the #457 `claude -p` leg: in production the deriveFn writes this node; here we write it directly (the LLM
// leg is the external residual). Returns the captured node_id.
function captureLesson(dir, over = {}) {
  const block = {
    repo: REPO_URL, issue_ref: ISSUE_REF, candidate_patch_sha: CPS,
    lesson_signature: CAPTURED_SIG, lesson_body: CAPTURED_BODY, ...over,
  };
  const w = pendingStore.mintLivePendingLesson(block, { dir: pendingDir(dir) });
  assert.strictEqual(w.ok, true, `the captured live_pending node lands (got ${w.reason})`);
  return w.node_id;
}

// STEP 2 - the REAL attest-from-capture producer args (an injected --diff so we never touch /tmp).
function attestArgs(dir, over = {}) {
  const diffFile = path.join(dir, 'fix.diff');
  if (!fs.existsSync(diffFile)) fs.writeFileSync(diffFile, 'diff --git a/x b/x\n+guard the edge\n');
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

// Write a kernel join-key for the PR into the kernel DEFAULT_DIR (the production reader path observe-merge
// uses; it accepts no join-key dir override). Mirrors merge-observer.test.js's seedJoinKey verbatim.
function seedJoinKey(over = {}) {
  const rec = {
    repo: REPO_SLUG, issueRef: ISSUE_REF, pr_number: PR_NUMBER, pr_url: PR_URL,
    approval_hash: APPROVAL, base_sha: BASE_SHA, emitted_at: '2026-06-28T00:00:00.000Z', ...over,
  };
  const w = jkStore.writeJoinKey(rec, { dir: JK_DIR, selfUid: SELF === null ? undefined : SELF });
  assert.strictEqual(w.ok, true, `seedJoinKey must succeed (got ${w.reason})`);
  return w.id;
}

// Clean the kernel join-key store between tests so resolveJoinKeyForPr's exact-set stays deterministic.
function clearJoinKeys() {
  try { for (const f of fs.readdirSync(JK_DIR)) fs.unlinkSync(path.join(JK_DIR, f)); } catch { /* absent ok */ }
}

// The INJECTED gh runner (the external GitHub boundary - the ONLY network leg, faked). Mirrors
// merge-observer.test.js's runnerMerged: returns the gh JSON a merged PR yields.
function ghRunnerMerged() { return async () => ({ stdout: JSON.stringify({ merged: true, merge_commit_sha: MERGE_SHA, state: 'closed' }) }); }

// Suppress + collect the egress alerts every refuse path emits (keeps the test output clean; observable).
async function captureAlerts(fn) {
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
  try { r = await fn(); } finally { process.stderr.write = orig; }
  return { r, alerts };
}

// ===========================================================================
// 1. THE FULL ARC through the PRODUCTION observe-merge auto-mint path (the most genuine end-to-end):
//    captured node -> attestation -> kernel join-key + gh-verified merge-observe -> AUTO-MINT. EVERY lab
//    store is real; only the gh runner is injected (no network). Asserts the captured body/signature flow
//    end-to-end into the minted world-anchor node, and the node is weight-inert (no `source` token).
// ===========================================================================

test('FULL ARC (observe-merge auto-mint): the CAPTURED lesson flows end-to-end into the minted world-anchor node', async () => {
  const dir = tmp();
  try {
    clearJoinKeys();
    // STEP 1: the deriver's product - a captured live_pending node (the #457 leg, faked).
    const capturedId = captureLesson(dir);
    assert.ok(/^[0-9a-f]{64}$/.test(capturedId), 'a 64-hex captured node_id');

    // STEP 2: the REAL emit-side producer sources att.lesson_signature FROM the captured node + records the
    // attestation. cli.js never reads the live-pending store directly (the dam stays at one reader).
    const { r: prod } = await captureAlerts(() => cli.runAttestFromCapture(
      attestArgs(dir), { anchorDir: dir, pendingDir: pendingDir(dir) },
    ));
    assert.strictEqual(prod.ok, true, `the producer attests (got ${prod.reason})`);
    assert.strictEqual(prod.lesson_signature, CAPTURED_SIG, 'the attestation sources the CAPTURED signature');

    // STEP 3: a kernel egress join-key for the PR (the production trust anchor; observe-merge fails-closed
    // without one). REAL kernel writer, into the kernel DEFAULT_DIR.
    const jkid = seedJoinKey();

    // STEP 4: drive the REAL production observe-merge arm with an INJECTED gh runner (no network) + the
    // COHERENT FIVE store dirs. This gh-verifies the merge, records the kernel-sealed merge-outcome, and
    // AUTO-MINTS the world_anchored node + the (unsigned) world-anchored-by edge - the actual production code
    // path, not a hand-driven mint.
    const { r: res } = await captureAlerts(() => cli.mainObserveMerge(
      { pr: PR_URL },
      {
        ghRunner: ghRunnerMerged(),
        outcomeDir: outcomeDir(dir), anchorDir: dir, liveDir: liveDir(dir), edgeDir: edgeDir(dir),
        pendingDir: pendingDir(dir), now: '2026-06-28T12:00:00.000Z',
      },
    ));
    assert.strictEqual(res.code, 0, 'the observe-merge arm exits 0 (a merged outcome recorded)');
    assert.strictEqual(res.payload.ok, true, 'the merge-outcome record succeeds');
    assert.strictEqual(res.payload.join_key_id, jkid, 'the recorded outcome is keyed by the kernel join-key');
    assert.strictEqual(res.payload.minted, true, 'the auto-mint resolves the captured floor + mints the node');

    // STEP 5 (the headline assertion): the minted world-anchor node carries the CAPTURED body + signature -
    // the captured lesson flowed end-to-end through EVERY real store into the world-anchor mint.
    const node = liveStore.readLiveNode(res.payload.node_id, { dir: liveDir(dir) });
    assert.ok(node, 'the minted world-anchor node is readable from the live store');
    assert.strictEqual(node.lesson_signature, CAPTURED_SIG, 'the node carries the CAPTURED signature (not LESSON_2137)');
    assert.strictEqual(node.lesson_body, CAPTURED_BODY, 'the node body IS the CAPTURED body (end-to-end flow proven)');
    assert.ok(!node.lesson_body.includes('uv run pytest'), 'the node is NOT the LESSON_2137 grandfather body');
    assert.strictEqual(node.merge_sha, MERGE_SHA, 'the node carries the gh-verified merge_commit_sha (world-evidence)');

    // WEIGHT-INERT end-to-end: the node carries NO `source` token. The weight gate (admitWeightForRanking)
    // returns 0 for any record whose `source` is not in LIVE_SOURCES (Object.freeze([])); the world_anchored
    // node's exact-set schema has NO `source` key at all, so it can NEVER be admitted as a weight source.
    assert.ok(!Object.prototype.hasOwnProperty.call(node, 'source'), 'the node carries NO `source` token (weight-inert by construction)');
    assert.strictEqual(node.provenance, 'world_anchored', 'provenance:world_anchored is the honesty marker (the weight gate keys on `source`, never provenance)');

    // and the edge minted UNSIGNED (the production invariant - no edgeSigner -> integrity-only, gates nothing).
    assert.strictEqual(res.payload.edge_minted, true, 'the world-anchored-by edge minted');
    assert.strictEqual(res.payload.edge_signed, false, 'the edge is UNSIGNED (RECORDED-not-TRUSTED; #273 close is the deferred PR-A2 signer)');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ===========================================================================
// 2. THE FULL ARC through the direct mintFromMergeOutcome path (no kernel join-key needed - it reads the
//    already-recorded merge-outcome). Proves the capture -> attest -> mint chain explicitly, isolating the
//    auto-mint logic from the gh-observe leg (the two catch different wiring bugs).
// ===========================================================================

test('FULL ARC (direct mint): captured node -> attest -> recordMergeOutcome -> mintFromMergeOutcome resolves the CAPTURED lesson', async () => {
  const dir = tmp();
  try {
    captureLesson(dir);
    const { r: prod } = await captureAlerts(() => cli.runAttestFromCapture(
      attestArgs(dir), { anchorDir: dir, pendingDir: pendingDir(dir) },
    ));
    assert.strictEqual(prod.ok, true, `the producer attests (got ${prod.reason})`);

    // a gh-verified merge-outcome record (the mint's sole input; written via the REAL store).
    const jkid = 'd'.repeat(64);
    const w = outcomeStore.recordMergeOutcome({
      join_key_id: jkid, repo: REPO_SLUG, pr_number: PR_NUMBER, pr_url: PR_URL,
      approval_hash: APPROVAL, outcome: 'merged', merge_commit_sha: MERGE_SHA, observed_at: '2026-06-28T12:00:00.000Z',
    }, { dir: outcomeDir(dir) });
    assert.strictEqual(w.ok, true, 'the merge-outcome record lands');

    // the REAL mint (the coherent FIVE store dirs; production passes none).
    const m = mint.mintFromMergeOutcome(
      { join_key_id: jkid },
      { anchorDir: dir, liveDir: liveDir(dir), edgeDir: edgeDir(dir), outcomeDir: outcomeDir(dir), pendingDir: pendingDir(dir) },
    );
    assert.strictEqual(m.minted, true, 'the mint resolves the captured floor + mints the node');
    const node = liveStore.readLiveNode(m.node_id, { dir: liveDir(dir) });
    assert.ok(node, 'the node is readable');
    assert.strictEqual(node.lesson_signature, CAPTURED_SIG, 'the node carries the CAPTURED signature');
    assert.strictEqual(node.lesson_body, CAPTURED_BODY, 'the node body is the CAPTURED body, end-to-end');
    assert.ok(!Object.prototype.hasOwnProperty.call(node, 'source'), 'weight-inert: no `source` token');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ===========================================================================
// 3. NEGATIVE: with NO captured node the arc fails CLOSED (no-captured-lesson) - the captured-floor join is
//    load-bearing, never a silent grandfather substitution for this non-spec-kitty issue.
// ===========================================================================

test('FULL ARC negative: no captured node -> the producer refuses (no-captured-lesson), never a silent mint', async () => {
  const dir = tmp();
  try {
    // no captureLesson - the captured lane is empty for this tuple.
    const { r: prod } = await captureAlerts(() => cli.runAttestFromCapture(
      attestArgs(dir), { anchorDir: dir, pendingDir: pendingDir(dir) },
    ));
    assert.strictEqual(prod.ok, false, 'the producer refuses with no captured node');
    assert.strictEqual(prod.reason, 'no-captured-lesson', 'a clean observable refuse, never a silent attestation');
    // and with no attestation, the mint resolves nothing (no node minted).
    assert.strictEqual(liveStore.listLiveNodes({ dir: liveDir(dir) }).length, 0, 'NO world-anchor node minted');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${name}\n      ${e && e.message}`); }
  }
  console.log(`\nfull-arc-capture-flow.test.js: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
