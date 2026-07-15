#!/usr/bin/env node

// tests/unit/lab/solve-queue/merge-promote.test.js
//
// TDD SPEC (written FIRST) for Wave B - the async merge-poll -> captured-lesson promotion. It sweeps the
// Wave-A solve-queue's `in_flight` AND `merged` entries, gh-verifies each PR merged (join-key-free), sources
// the solve-time CAPTURED lesson by candidate_patch_sha, mints a weight-0 world_anchored node, and advances
// the entry in_flight -> merged -> minted. SHADOW / weight-0. Run as `node <file>`.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE_BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-wb-'));
process.env.LOOM_LAB_STATE_DIR = STATE_BASE;

const REPO = path.join(__dirname, '..', '..', '..', '..');
const queue = require(path.join(REPO, 'packages', 'lab', 'solve-queue', 'solve-queue-store.js'));
const { mintLivePendingLesson } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'live-pending-store.js'));
const liveStore = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'live-recall-store.js'));
const { admitWorldAnchorNode } = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'admit-world-anchor-node.js'));
const { promoteMergedEntries } = require(path.join(REPO, 'packages', 'lab', 'solve-queue', 'merge-promote.js'));
const { mintCapturedMerge } = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'mint-captured-merge.js'));

let passed = 0;
function test(name, fn) { return fn().then(() => { passed += 1; }); }

const SHA40 = 'c0ffee'.repeat(6) + 'cafe';                 // 40 hex
const CPS = 'a'.repeat(64);
const SIG = 'lesson:boundary-contract|unguarded-edge-case|handle-edge-explicitly';
const BODY = 'a captured earned instinct: validate at the boundary';

// A single dispatching gh runner (mirrors the real gh binary answering different args).
function ghRunnerFor(over = {}) {
  const o = { merged: true, mergeSha: SHA40, state: 'closed', author: 'octocat', mergedBy: 'maintainer', mergedAt: '2026-07-14T00:00:00.000Z', baseSha: 'b'.repeat(40), branch: 'fix/x', diff: 'diff --git a/x b/x\n+one line\n', ...over };
  return async (args) => {
    const s = args.join(' ');
    if (o.throwOn && s.includes(o.throwOn)) throw new Error('gh boom');
    if (s.includes('/commits/')) return { stdout: o.diff };
    if (s.includes('.user.login')) return { stdout: `${JSON.stringify({ author: o.author, merged_by: o.mergedBy, merged_at: o.mergedAt, base_sha: o.baseSha, branch: o.branch })}\n` };
    return { stdout: `${JSON.stringify({ merged: o.merged, merge_commit_sha: o.mergeSha, state: o.state })}\n` };
  };
}

// Fresh isolated store bundle.
function bundle() {
  const b = fs.mkdtempSync(path.join(STATE_BASE, 'b-'));
  return { queueDir: path.join(b, 'q'), pendingDir: path.join(b, 'pending'), anchorDir: path.join(b, 'anchor'), liveDir: path.join(b, 'live') };
}
function seedCapture(dirs, { cps = CPS, sig = SIG, body = BODY, repo = 'https://github.com/octo/widget', issue = 7 } = {}) {
  const r = mintLivePendingLesson({ provenance: 'live_pending', repo, issue_ref: issue, candidate_patch_sha: cps, lesson_signature: sig, lesson_body: body }, { dir: dirs.pendingDir });
  assert.strictEqual(r.ok, true, `capture seed (${r.reason || ''})`);
}
// Enqueue -> claim -> drafted(cps) -> in_flight(pr_url). Returns the entry_id.
function seedInFlight(dirs, { repo = 'octo/widget', issue = 7, cps = CPS, prNum = 77 } = {}) {
  const e = queue.enqueue({ repo, issue_ref: issue }, { dir: dirs.queueDir });
  queue.claimNext({ dir: dirs.queueDir });
  queue.advance({ entry_id: e.entry_id, to_state: 'drafted', evidence: { candidate_patch_sha: cps, lesson_signature: SIG } }, { dir: dirs.queueDir });
  queue.advance({ entry_id: e.entry_id, to_state: 'in_flight', evidence: { pr_url: `https://github.com/${repo}/pull/${prNum}`, pr_number: prNum } }, { dir: dirs.queueDir });
  return e.entry_id;
}
const st = (dirs, id) => queue.get({ entry_id: id }, { dir: dirs.queueDir }).state;

async function main() {
  await test('a merged in_flight entry mints a WEIGHT-0 node + advances to minted', async () => {
    const d = bundle(); seedCapture(d); const id = seedInFlight(d);
    const r = await promoteMergedEntries({ ...d, ghRunner: ghRunnerFor() });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.minted.length, 1, 'one entry minted');
    assert.strictEqual(st(d, id), 'minted');
    const node = liveStore.readLiveNode(r.minted[0].node_id, { dir: d.liveDir });
    assert.ok(node && node.provenance === liveStore.WORLD_ANCHORED, 'a world_anchored node exists');
    const adm = admitWorldAnchorNode(node, { edgeDir: path.join(d.liveDir, '..', 'edges') });
    assert.strictEqual(adm.admitted, false, `weight-0: a node-only mint is admit-REFUSED (reason: ${adm.reason})`);
  });

  await test('the TWO-STATE sweep RESUMES a stranded `merged` entry (the crux fix)', async () => {
    const d = bundle(); seedCapture(d);
    // seed an entry ALREADY at merged (no node yet) - simulating a crash after the in_flight->merged advance
    const id = seedInFlight(d);
    queue.advance({ entry_id: id, to_state: 'merged', evidence: { merge_sha: SHA40 } }, { dir: d.queueDir });
    assert.strictEqual(st(d, id), 'merged');
    const r = await promoteMergedEntries({ ...d, ghRunner: ghRunnerFor() });
    assert.strictEqual(st(d, id), 'minted', 'a stranded merged entry is re-swept + minted');
    assert.strictEqual(r.minted.length, 1);
  });

  await test('a NOT-yet-merged entry is left in_flight (poll again later)', async () => {
    const d = bundle(); seedCapture(d); const id = seedInFlight(d);
    const r = await promoteMergedEntries({ ...d, ghRunner: ghRunnerFor({ merged: false }) });
    assert.strictEqual(st(d, id), 'in_flight', 'not merged -> unchanged');
    assert.strictEqual(r.minted.length, 0);
    assert.ok(r.skipped.some((s) => s.reason === 'not-merged'));
  });

  await test('merged but NO captured lesson: advances to merged, mint SKIPPED (fail-closed), left merged', async () => {
    const d = bundle(); /* no seedCapture */ const id = seedInFlight(d);
    const r = await promoteMergedEntries({ ...d, ghRunner: ghRunnerFor() });
    assert.strictEqual(st(d, id), 'merged', 'no capture -> confirmed merged but NOT minted');
    assert.strictEqual(r.minted.length, 0);
    assert.ok(r.skipped.some((s) => s.reason === 'no-captured-lesson'), 'observable no-captured-lesson');
  });

  await test('idempotent re-poll: a second sweep re-mints the SAME node, no double-advance', async () => {
    const d = bundle(); seedCapture(d); const id = seedInFlight(d);
    const r1 = await promoteMergedEntries({ ...d, ghRunner: ghRunnerFor() });
    const r2 = await promoteMergedEntries({ ...d, ghRunner: ghRunnerFor() });
    assert.strictEqual(st(d, id), 'minted');
    assert.strictEqual(r1.minted.length, 1);
    // second sweep: the entry is already minted (in neither swept state) -> nothing to do, no error
    assert.strictEqual(r2.minted.length, 0);
    assert.strictEqual(r2.errors.length, 0);
  });

  await test('a repo-mismatch entry is a NAMED skip (no wrong-repo join), batch continues', async () => {
    const d = bundle(); seedCapture(d);
    const good = seedInFlight(d);
    // a second entry whose pr_url points at a DIFFERENT repo than entry.repo
    const bad = queue.enqueue({ repo: 'octo/other', issue_ref: 9 }, { dir: d.queueDir });
    queue.claimNext({ dir: d.queueDir }); // claims the oldest queued (octo/other#9? or the good one already advanced) - good is in_flight so octo/other is claimed
    queue.advance({ entry_id: bad.entry_id, to_state: 'drafted', evidence: { candidate_patch_sha: 'd'.repeat(64) } }, { dir: d.queueDir });
    queue.advance({ entry_id: bad.entry_id, to_state: 'in_flight', evidence: { pr_url: 'https://github.com/evil/elsewhere/pull/3', pr_number: 3 } }, { dir: d.queueDir });
    const r = await promoteMergedEntries({ ...d, ghRunner: ghRunnerFor() });
    assert.strictEqual(st(d, good), 'minted', 'the good entry still promotes');
    assert.ok(r.skipped.some((s) => s.reason === 'repo-mismatch'), 'the mismatched entry is a named skip');
  });

  await test('VALIDATE M2: a merged entry whose pr_url repo != entry.repo is a repo-mismatch skip (pass-2 parity)', async () => {
    const d = bundle(); seedCapture(d);
    const e = queue.enqueue({ repo: 'octo/widget', issue_ref: 7 }, { dir: d.queueDir });
    queue.claimNext({ dir: d.queueDir });
    queue.advance({ entry_id: e.entry_id, to_state: 'drafted', evidence: { candidate_patch_sha: CPS } }, { dir: d.queueDir });
    // pr_url points at a DIFFERENT repo than the entry's fold-validated repo
    queue.advance({ entry_id: e.entry_id, to_state: 'in_flight', evidence: { pr_url: 'https://github.com/evil/other/pull/3', pr_number: 3 } }, { dir: d.queueDir });
    queue.advance({ entry_id: e.entry_id, to_state: 'merged', evidence: { merge_sha: SHA40 } }, { dir: d.queueDir });   // seed merged directly (bypass pass 1)
    const r = await promoteMergedEntries({ ...d, ghRunner: ghRunnerFor() });
    assert.strictEqual(st(d, e.entry_id), 'merged', 'left merged (not minted from a wrong-repo url)');
    assert.ok(r.skipped.some((s) => s.reason === 'repo-mismatch'), 'pass-2 repo-mismatch skip');
  });

  await test('the crash-window: a re-invoked mint on a still-merged entry dedups to the SAME node (no fork)', async () => {
    const d = bundle(); seedCapture(d);
    const args = [{ repo: 'octo/widget', issue_ref: 7, pr_url: 'https://github.com/octo/widget/pull/77', pr_number: 77, merge_sha: SHA40, candidate_patch_sha: CPS },
      { ghRunner: ghRunnerFor(), pendingDir: d.pendingDir, anchorDir: d.anchorDir, liveDir: d.liveDir }];
    const m1 = await mintCapturedMerge(...args);
    const m2 = await mintCapturedMerge(...args);   // simulates a crash between the mint + the queue advance
    assert.strictEqual(m1.ok, true, `first mint (${m1.reason || ''})`);
    assert.strictEqual(m2.ok, true, `re-mint (${m2.reason || ''})`);
    assert.strictEqual(m2.node_id, m1.node_id, 'clean content-dedup, never a divergent collision or a forked node');
  });

  try { fs.rmSync(STATE_BASE, { recursive: true, force: true }); } catch { /* best-effort */ }
  assert.ok(passed >= 8, `anti-vacuity floor: expected >=8, ran ${passed}`);
  console.log(`${path.basename(__filename)}: ${passed} passed`);
}

main().catch((e) => { process.stderr.write(`${e && e.stack || e}\n`); process.exit(1); });
