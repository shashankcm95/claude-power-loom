#!/usr/bin/env node

// @loom-layer: lab
//
// Wave B - the async merge-poll -> captured-lesson promotion. It sweeps the Wave-A solve-queue's `in_flight`
// AND `merged` entries (a TWO-STATE sweep so a `merged`-but-not-yet-`minted` entry from a crash/transient
// error is RE-VISITED), gh-verifies each PR merged (JOIN-KEY-FREE `verifyMerge` - Option B, not the armed
// join-key path), sources the solve-time CAPTURED lesson by `candidate_patch_sha` via the ONE dam-admitted
// reader (`resolveCapturedSignatureForAttest`), mints a node-only WEIGHT-0 `world_anchored` node
// (admit-refused `no-authenticated-edge`; LIVE_SOURCES frozen-empty), and advances `in_flight -> merged ->
// minted`. The producer never blocks on any single merge; the dataset widens as merges land.
//
// SHADOW / weight-0: read-only gh, NO arming, NO PR emit, NO signer, NO kernel join-key read. `emitted_at`
// is the gh-reported `merged_at` (retry-stable; it seals the attestation content_hash, so a wall-clock value
// would make a crash-retry a PERMANENT collision-reject instead of a clean dedup). NEVER imports
// live-pending-store (its reader dam admits only world-anchor-mint.js); the captured body arrives via the
// world-anchor-mint export. Composes the same primitive set as record-manual-merge, minus the hand-authored
// lesson (a small deliberate duplication of the ~15-line evidence->attestation->mint compose; a shared-tail
// extraction is a named deferred DRY follow-up).

'use strict';

const queue = require('./solve-queue-store');
const { emitEgressAlert } = require('../../kernel/egress/alert');
const { parsePrUrl } = require('../world-anchor/parse-pr-url');
const { verifyMerge } = require('../world-anchor/gh-verify');
// The attest+mint lives in world-anchor/ (it touches the dam-guarded world-anchor-store + live-recall-store,
// which a solve-queue/ module may NOT import - the shadow-import-graph dam). This poller owns the QUEUE.
const { mintCapturedMerge } = require('../world-anchor/mint-captured-merge');

const DIR_KEYS = ['queueDir', 'pendingDir', 'anchorDir', 'liveDir'];

function alert(reason, detail) { emitEgressAlert('merge-promote', Object.assign({}, detail || {}, { promote_reason: reason })); }

// Isolation is ALL-OR-NOTHING (mirrors mintFromMergeOutcome FOLD-B): 0 keys = production (every store uses
// its native LOOM_LAB_STATE_DIR subdir), or all 4 = fully isolated (tests). A partial set would silently let
// an un-wired store fall back to the REAL ~/.claude/lab-state. Returns {ok, dirs} or {ok:false, reason}.
function resolveDirs(o) {
  const supplied = DIR_KEYS.filter((k) => o[k] !== undefined);
  if (supplied.length !== 0 && supplied.length !== DIR_KEYS.length) return { ok: false, reason: 'incomplete-dir-wiring' };
  return { ok: true, dirs: { queue: o.queueDir, pending: o.pendingDir, anchor: o.anchorDir, live: o.liveDir } };
}

// PASS 1: confirm an `in_flight` entry's merge (join-key-free) and advance it to `merged`. Records into the
// summary; NEVER throws (a bad entry is a skip/error, not a batch abort).
async function promoteOneInFlight(e, ctx, summary) {
  const { dirs, ghRunner } = ctx;
  const ev = e.evidence || {};
  if (typeof ev.pr_url !== 'string' || typeof ev.candidate_patch_sha !== 'string') {
    summary.skipped.push({ entry_id: e.entry_id, stage: 'in_flight', reason: 'missing-evidence' }); return;
  }
  let parsed;
  try { parsed = parsePrUrl(ev.pr_url); } catch { summary.skipped.push({ entry_id: e.entry_id, stage: 'in_flight', reason: 'bad-pr-url' }); return; }
  if (parsed.repo !== e.repo) {
    alert('repo-mismatch', { entry_id: e.entry_id, entry_repo: e.repo, url_repo: parsed.repo });
    summary.skipped.push({ entry_id: e.entry_id, stage: 'in_flight', reason: 'repo-mismatch' }); return;
  }
  const v = await verifyMerge({ repo: parsed.repo, pr_number: parsed.pr_number }, { runner: ghRunner });
  if (!v.ok) { summary.skipped.push({ entry_id: e.entry_id, stage: 'in_flight', reason: 'gh-unverifiable' }); return; }
  if (v.merged !== true) { summary.skipped.push({ entry_id: e.entry_id, stage: 'in_flight', reason: 'not-merged' }); return; }
  const adv = queue.advance({ entry_id: e.entry_id, to_state: 'merged', evidence: { merge_sha: v.merge_commit_sha } }, { dir: dirs.queue });
  if (!adv.ok) { summary.errors.push({ entry_id: e.entry_id, stage: 'in_flight', message: adv.reason }); return; }
  summary.merged.push(e.entry_id);
}

// PASS 2: mint the captured lesson for a `merged` entry (delegated to world-anchor/mint-captured-merge) and
// advance to `minted`. Fail-CLOSED on a missing capture (leave `merged`, observable, retried next sweep).
// A transient/no-capture refuse is a `skipped`; an attest/mint substrate failure is an `errors`. NEVER throws.
async function promoteOneMerged(e, ctx, summary) {
  const { dirs, ghRunner } = ctx;
  const ev = e.evidence || {};
  if (typeof ev.pr_url !== 'string' || typeof ev.candidate_patch_sha !== 'string' || typeof ev.merge_sha !== 'string') {
    summary.skipped.push({ entry_id: e.entry_id, stage: 'merged', reason: 'missing-evidence' }); return;
  }
  let parsed;
  try { parsed = parsePrUrl(ev.pr_url); } catch { summary.skipped.push({ entry_id: e.entry_id, stage: 'merged', reason: 'bad-pr-url' }); return; }
  if (parsed.repo !== e.repo) {   // VALIDATE M2: parity with pass 1 - the mint's repo must be the entry's fold-validated repo (which rejects `..`), not an attacker-chosen pr_url
    alert('repo-mismatch', { entry_id: e.entry_id, entry_repo: e.repo, url_repo: parsed.repo });
    summary.skipped.push({ entry_id: e.entry_id, stage: 'merged', reason: 'repo-mismatch' }); return;
  }
  const m = await mintCapturedMerge(
    { repo: parsed.repo, issue_ref: e.issue_ref, pr_url: ev.pr_url, pr_number: parsed.pr_number, merge_sha: ev.merge_sha, candidate_patch_sha: ev.candidate_patch_sha },
    { ghRunner, pendingDir: dirs.pending, anchorDir: dirs.anchor, liveDir: dirs.live },
  );
  // A `mint-collision` carrying a node_id means a node ALREADY EXISTS for this (anchor, lesson) identity
  // (the captured path minting a pin-carrying v2 node over a pre-existing v1 / divergent-envelope node). The
  // promote goal - a minted lesson node exists for this merged solve - is MET, so treat it as an IDEMPOTENT
  // success: advance to `minted` instead of sticking the entry in errors forever. This is the RESIDUAL
  // migration-hazard handler for the pin path; conditional-v2 in buildBody is the no-pin-path ROOT close.
  // SHADOW-safe (the node gates nothing); the arming-time revisit (item 5): once a node gates a weight, a
  // collision must be re-examined, not blindly accepted. Every OTHER mint/attest refuse still routes to errors.
  const minted = m.ok || (m.reason === 'mint-collision' && typeof m.node_id === 'string');
  if (!minted) {
    if (/^(attest|mint)-/.test(m.reason)) summary.errors.push({ entry_id: e.entry_id, stage: 'mint', message: m.reason });
    else summary.skipped.push({ entry_id: e.entry_id, stage: 'merged', reason: m.reason });   // no-captured-lesson / transient gh
    return;
  }
  if (!m.ok) alert('collision-idempotent-minted', { entry_id: e.entry_id, node_id: m.node_id });   // observable: advanced on a pre-existing node
  const adv = queue.advance({ entry_id: e.entry_id, to_state: 'minted', evidence: {} }, { dir: dirs.queue });
  if (!adv.ok) { summary.errors.push({ entry_id: e.entry_id, stage: 'advance-minted', message: adv.reason }); return; }
  // deduped: the collision-idempotent path is a dedup (a node already existed); the success path carries the
  // store's REAL deduped flag (a same-body re-mint / TOCTOU race), NOT a `!m.ok` heuristic (VALIDATE code-reviewer).
  summary.minted.push({ entry_id: e.entry_id, node_id: m.node_id, deduped: m.ok ? !!m.deduped : true });
}

/**
 * One promotion sweep over the solve-queue: confirm merges (in_flight -> merged), then mint pending merges
 * (merged -> minted). TOTAL (never throws). SHADOW / weight-0.
 * @param {{queueDir?, pendingDir?, anchorDir?, liveDir?, ghRunner?: Function}} [opts] all-or-nothing dir set
 *   (0 = production; 4 = isolated tests) + the injected gh runner (production shells real read-only gh).
 * @returns {Promise<{ok, merged, minted, skipped, errors}>}
 */
async function promoteMergedEntries(opts = {}) {
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  const rd = resolveDirs(o);
  if (!rd.ok) { alert(rd.reason, {}); return { ok: false, reason: rd.reason, merged: [], minted: [], skipped: [], errors: [] }; }
  const ctx = { dirs: rd.dirs, ghRunner: o.ghRunner };
  const summary = { merged: [], minted: [], skipped: [], errors: [] };
  // Pass 1: in_flight -> merged
  for (const e of queue.list({ state: 'in_flight' }, { dir: rd.dirs.queue })) {
    try { await promoteOneInFlight(e, ctx, summary); } catch (err) { summary.errors.push({ entry_id: e.entry_id, stage: 'in_flight', message: (err && err.message) || 'error' }); }
  }
  // Pass 2: merged -> minted (fresh list: includes pass-1's just-advanced AND any prior-stranded merges)
  for (const e of queue.list({ state: 'merged' }, { dir: rd.dirs.queue })) {
    try { await promoteOneMerged(e, ctx, summary); } catch (err) { summary.errors.push({ entry_id: e.entry_id, stage: 'merged', message: (err && err.message) || 'error' }); }
  }
  return { ok: true, ...summary };
}

module.exports = { promoteMergedEntries };
