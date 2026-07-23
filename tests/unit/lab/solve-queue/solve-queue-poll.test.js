#!/usr/bin/env node

// tests/unit/lab/solve-queue/solve-queue-poll.test.js
//
// F3 — the autonomous poll RUNNER: one sweep = review-observe (PASS 1) + merge->mint (PASS 2). Integration
// over the REAL solve-queue + review-outcome + world-anchor stores on isolated dirs + a mock gh. TOTAL /
// SHADOW / weight-0. Locks: the compose (observe + promote in one sweep), the F3 systemic-failure bail
// (never hammering a rate-limit cooldown) with promote STILL running, the empty-queue no-op, and the
// all-or-nothing dir wiring (a partial set is refused, never silently falling back to the real ledger).

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE_BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-poll-'));
process.env.LOOM_LAB_STATE_DIR = STATE_BASE;

const REPO = path.join(__dirname, '..', '..', '..', '..');
const queue = require(path.join(REPO, 'packages', 'lab', 'solve-queue', 'solve-queue-store.js'));
const { mintLivePendingLesson } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'live-pending-store.js'));
const { pollSolveQueue } = require(path.join(REPO, 'packages', 'lab', 'solve-queue', 'solve-queue-poll.js'));
const { DEFAULT_STALE_MS } = require(path.join(REPO, 'packages', 'lab', 'solve-queue', 'dispose-stale.js'));

let passed = 0;
const pending = [];
function test(name, fn) {
  pending.push(Promise.resolve().then(fn)
    .then(() => { process.stdout.write(`  PASS ${name}\n`); passed += 1; })
    .catch((e) => { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); process.exitCode = 1; }));
}

const SHA40 = 'c0ffee'.repeat(6) + 'cafe';
const CPS = 'a'.repeat(64);
const SIG = 'lesson:boundary-contract|unguarded-edge-case|handle-edge-explicitly';
const BODY = 'a captured earned instinct: validate at the boundary';

// A single dispatching gh runner (mirrors the real gh answering different args): /reviews (observe),
// /commits (diff), .user.login (merger identity), else the PR merge-state.
function ghRunnerFor(over = {}) {
  const o = {
    merged: true, mergeSha: SHA40, state: 'closed', author: 'octocat', mergedBy: 'maintainer',
    mergedAt: '2026-07-14T00:00:00.000Z', baseSha: 'b'.repeat(40), branch: 'fix/x',
    diff: 'diff --git a/x b/x\n+one line\n',
    reviews: [{ id: 101, state: 'APPROVED', author_association: 'MEMBER', submitted_at: '2026-07-16T00:00:00.000Z', pull_request_url: 'https://api.github.com/repos/octo/widget/pulls/77' }],
    ...over,
  };
  return async (args) => {
    const s = args.join(' ');
    if (o.throwOn && s.includes(o.throwOn)) { const e = new Error(o.throwMsg || 'gh boom'); if (o.throwStderr) e.stderr = o.throwStderr; throw e; }
    if (s.includes('/reviews')) return { stdout: `${JSON.stringify(o.reviews)}\n` };
    if (s.includes('/commits/')) return { stdout: o.diff };
    if (s.includes('.user.login')) return { stdout: `${JSON.stringify({ author: o.author, merged_by: o.mergedBy, merged_at: o.mergedAt, base_sha: o.baseSha, branch: o.branch })}\n` };
    return { stdout: `${JSON.stringify({ merged: o.merged, merge_commit_sha: o.mergeSha, state: o.state })}\n` };
  };
}

function dirs5() {
  const b = fs.mkdtempSync(path.join(STATE_BASE, 'b-'));
  return {
    queueDir: path.join(b, 'q'), pendingDir: path.join(b, 'pending'), anchorDir: path.join(b, 'anchor'),
    liveDir: path.join(b, 'live'), reviewDir: path.join(b, 'review'),
  };
}
function seedCapture(d, { cps = CPS, issue = 7 } = {}) {
  const r = mintLivePendingLesson({ provenance: 'live_pending', repo: 'https://github.com/octo/widget', issue_ref: issue, candidate_patch_sha: cps, lesson_signature: SIG, lesson_body: BODY }, { dir: d.pendingDir });
  assert.strictEqual(r.ok, true, `seed capture (${r.reason || ''})`);
}
function seedInFlight(d, { prNum = 77, cps = CPS, issue = 7 } = {}) {
  const e = queue.enqueue({ repo: 'octo/widget', issue_ref: issue }, { dir: d.queueDir });
  queue.claimNext({ dir: d.queueDir });
  queue.advance({ entry_id: e.entry_id, to_state: 'drafted', evidence: { candidate_patch_sha: cps, lesson_signature: SIG } }, { dir: d.queueDir });
  queue.advance({ entry_id: e.entry_id, to_state: 'in_flight', evidence: { pr_url: `https://github.com/octo/widget/pull/${prNum}`, pr_number: prNum } }, { dir: d.queueDir });
  return e.entry_id;
}

// A back-dated `solving` entry (the store stamps a live ts, so we craft the event log directly) to exercise
// PASS 0 with the poll's default real-time clock.
function seedStaleSolving(d, { issue = 55, ageMs = DEFAULT_STALE_MS + 60000 } = {}) {
  const repo = 'octo/widget';
  const eid = queue.entryId(repo, issue);
  const ts = Date.now() - ageMs;
  const evs = [
    { entry_id: eid, repo, issue_ref: issue, from_state: null, to_state: 'queued', ts, evidence: {} },
    { entry_id: eid, repo, issue_ref: issue, from_state: 'queued', to_state: 'solving', ts, evidence: {} },
  ];
  fs.mkdirSync(d.queueDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(d.queueDir, 'events.jsonl'), `${evs.map((e) => JSON.stringify(e)).join('\n')}\n`, { mode: 0o600 });
  return eid;
}

test('m5. PASS 0 disposes a stale solving zombie in a full sweep (observe/promote still run)', async () => {
  const d = dirs5();
  const eid = seedStaleSolving(d);
  const res = await pollSolveQueue({ ...d, ghRunner: ghRunnerFor() });
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(res.disposed.map((x) => x.entry_id), [eid], 'the stale solving entry was reaped');
  assert.strictEqual(queue.get({ entry_id: eid }, { dir: d.queueDir }).state, 'disposed', 'disposed on disk');
  assert.strictEqual(res.observed.length, 0);
  assert.strictEqual(res.minted.length, 0);
});

test('m6. PASS 0 leaves a FRESH solving entry untouched (a live solve is never reaped)', async () => {
  const d = dirs5();
  const e = queue.enqueue({ repo: 'octo/widget', issue_ref: 66 }, { dir: d.queueDir });
  queue.claimNext({ dir: d.queueDir });   // -> solving, live ts
  const res = await pollSolveQueue({ ...d, ghRunner: ghRunnerFor() });
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(res.disposed, []);
  assert.deepStrictEqual(res.errors.filter((x) => x.stage === 'dispose'), [], 'PASS 0 examined the queue cleanly (no dispose-stage error)');
  assert.strictEqual(queue.get({ entry_id: e.entry_id }, { dir: d.queueDir }).state, 'solving');
});

test('m1. one sweep OBSERVES the in_flight PR review AND PROMOTES the merge -> minted', async () => {
  const d = dirs5(); seedCapture(d); const id = seedInFlight(d);
  const res = await pollSolveQueue({ ...d, ghRunner: ghRunnerFor() });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.observed.length, 1, 'observed the in_flight PR');
  assert.strictEqual(res.observed[0].ok, true, `review-observe succeeded (${res.observed[0].reason})`);
  assert.ok(res.reviews_recorded >= 1, 'an insider APPROVED review was recorded');
  assert.strictEqual(res.minted.length, 1, 'the merged PR minted a world_anchored node');
  assert.strictEqual(res.minted[0].entry_id, id);
});

test('m2. an empty queue is a clean no-op (ok, nothing observed / minted)', async () => {
  const d = dirs5();
  const res = await pollSolveQueue({ ...d, ghRunner: ghRunnerFor() });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.observed.length, 0);
  assert.strictEqual(res.minted.length, 0);
  assert.strictEqual(res.review_pass_bailed, false);
});

test('m3. F3 pacing: 2 consecutive review-observe failures BAIL pass 1, but promote (pass 2) still runs', async () => {
  const d = dirs5();
  const CPS2 = 'b'.repeat(64);   // distinct entries (the queue dedups on repo+issue_ref) so BOTH observe calls fire
  seedCapture(d, { cps: CPS, issue: 7 }); seedInFlight(d, { prNum: 77, cps: CPS, issue: 7 });
  seedCapture(d, { cps: CPS2, issue: 8 }); seedInFlight(d, { prNum: 78, cps: CPS2, issue: 8 });
  const gh = ghRunnerFor({ throwOn: '/reviews', throwStderr: 'gh: HTTP 429', throwMsg: 'HTTP 429' });
  const res = await pollSolveQueue({ ...d, ghRunner: gh });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.review_pass_bailed, true, 'two consecutive observe failures bail the review pass');
  assert.strictEqual(res.minted.length, 2, 'promote (pass 2) still runs and mints both merged PRs after the bail');
});

test('m4. incomplete dir wiring is REFUSED (all-or-nothing), never throws', async () => {
  const res = await pollSolveQueue({ queueDir: path.join(STATE_BASE, 'x') });   // 1 of 5
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'incomplete-dir-wiring');
});

Promise.all(pending).then(() => { process.stdout.write(`\nsolve-queue-poll.test.js: ${passed} passed\n`); });
