#!/usr/bin/env node

// @loom-layer: lab
//
// F3 - the autonomous poll RUNNER (SHADOW / weight-0). ONE sweep over the solve-queue composing SHADOW
// pieces and adding no new capability:
//   PASS 0    DISPOSE stale `solving` zombies (dispose-stale; no gh calls).
//   PASS 0.5  RECONCILE `drafted` -> `in_flight` by OBSERVING the operator-emitted PR (emit-reconcile).
//   PASS 1    OBSERVE each `in_flight` entry's PR review state (runReviewObserve -> review-outcome-store).
//   PASS 2    PROMOTE merged PRs to minted world_anchored nodes (promoteMergedEntries, Wave B).
// It is the poll-half of the true autonomous loop: solve -> PR (elsewhere) -> [this cron] observe reviews +
// harden-on-merge. Read-only `gh` only; NO write, NO arming, NO egress, NO join-key. Designed to run behind a
// launchd timer (the INTERVAL is the primary pacing against the shared-token secondary rate-limit - see F3).
//
// TOTAL: never throws. A bad entry / a failed observe is recorded in the summary and the sweep continues.
// F3 PACING: PASS 1 walks entries sequentially and BAILS on a rate-limit signal (never hammering the
// cooldown - the whole reason the F1/F2 puller now hands callers a differentiated `rate-limited` reason).
// Wave B's own gh-verify already fail-soft-skips a transient error per entry.
//
// Dir wiring mirrors merge-promote: ALL-OR-NOTHING over the 5 store dirs (0 = production, each store uses its
// native LOOM_LAB_STATE_DIR subdir; 5 = fully isolated tests). A partial set would silently let an un-wired
// store fall back to the REAL ledger.

'use strict';

const queue = require('./solve-queue-store');
const { promoteMergedEntries } = require('./merge-promote');
const { disposeStaleSolving } = require('./dispose-stale');
const { reconcileDraftedEntries } = require('./emit-reconcile');
const { runReviewObserve } = require('../world-anchor/review-observer');
const { RATELIMIT_RE } = require('../world-anchor/gh-verify');
const { emitEgressAlert } = require('../../kernel/egress/alert');

const DIR_KEYS = ['queueDir', 'pendingDir', 'anchorDir', 'liveDir', 'reviewDir'];

function alert(reason, detail) { emitEgressAlert('solve-queue-poll', Object.assign({}, detail || {}, { poll_reason: reason })); }

function resolveDirs(o) {
  const supplied = DIR_KEYS.filter((k) => o[k] !== undefined);
  if (supplied.length !== 0 && supplied.length !== DIR_KEYS.length) return { ok: false, reason: 'incomplete-dir-wiring' };
  return { ok: true, isolated: supplied.length === DIR_KEYS.length };
}

/**
 * One autonomous poll sweep: dispose stale `solving` zombies (PASS 0), observe reviews (PASS 1), then
 * promote merges (PASS 2). TOTAL / SHADOW / weight-0.
 * @param {{queueDir?, pendingDir?, anchorDir?, liveDir?, reviewDir?, ghRunner?: Function}} [opts]
 *   all-or-nothing dir set (0 = production; 5 = isolated tests) + the injected read-only gh runner.
 * @returns {Promise<{ok, disposed, observed, reviews_recorded, merged, minted, skipped, errors, rate_limited}>}
 */
async function pollSolveQueue(opts = {}) {
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  const rd = resolveDirs(o);
  const summary = { disposed: [], reconciled: [], reconcile_skipped: [], observed: [], reviews_recorded: 0, merged: [], minted: [], skipped: [], errors: [], rate_limited: false, review_pass_bailed: false, promote_pass_bailed: false };
  if (!rd.ok) { alert(rd.reason, {}); return { ok: false, reason: rd.reason, ...summary }; }
  const ghRunner = o.ghRunner;

  // PASS 0: dispose stale `solving` zombies (a solver that died mid-flight leaves an entry with no terminal
  // path). Zero gh calls (can't touch PASS 1's rate-limit budget); SHADOW. Wrapped so a throw can't abort
  // PASS 1/2 (mirrors the queue.list fail-soft below).
  try {
    const swept = disposeStaleSolving(o.queueDir !== undefined ? { queueDir: o.queueDir } : {});
    summary.disposed = (swept && Array.isArray(swept.disposed)) ? swept.disposed : [];
    if (swept && Array.isArray(swept.errors) && swept.errors.length) {
      summary.errors.push(...swept.errors.map((x) => Object.assign({ stage: 'dispose' }, x)));
    }
    // A whole-sweep failure (e.g. list-threw) returns ok:false with EMPTY errors[] - surface it so PASS 0
    // never fails silently (the fail-closed-must-be-observable invariant).
    if (swept && swept.ok === false && (!Array.isArray(swept.errors) || swept.errors.length === 0)) {
      summary.errors.push({ stage: 'dispose', message: swept.reason || 'dispose-failed' });
    }
  } catch (err) {
    alert('dispose-pass-threw', { message: (err && err.message) || 'error' });
    summary.errors.push({ stage: 'dispose', message: (err && err.message) || 'dispose-threw' });
  }

  // PASS 0.5: reconcile `drafted` -> `in_flight` by OBSERVING the operator-emitted PR (read-only gh). It is
  // the cheapest gh pass (1 call per REPO, bounded pages) vs PASS 1's 1-per-entry, so it runs first; its
  // real benefit is removing a sweep of latency for a PR opened AND merged while the cron was down.
  // RATE-LIMIT INTERLOCK (bidirectional): PASS 0.5 spends gh calls BEFORE PASS 1's own bail could fire, so a
  // rate limit detected here must SKIP PASS 1 entirely - otherwise this pass becomes a new way to burn the
  // exact shared-token budget that bail exists to protect.
  try {
    const rec = await reconcileDraftedEntries(o.queueDir !== undefined ? { queueDir: o.queueDir, runner: ghRunner } : { runner: ghRunner });
    summary.reconciled = (rec && Array.isArray(rec.reconciled)) ? rec.reconciled : [];
    if (rec && Array.isArray(rec.errors) && rec.errors.length) {
      summary.errors.push(...rec.errors.map((x) => Object.assign({ stage: 'reconcile' }, x)));
    }
    // Carry the reconciler's SKIPS through too. PASS 2 later assigns summary.skipped wholesale, so stash
    // them separately: a `list-truncated` / `no-join-key` stall is invisible to a monitor otherwise.
    if (rec && Array.isArray(rec.skipped) && rec.skipped.length) {
      summary.reconcile_skipped = rec.skipped.map((x) => Object.assign({ stage: 'reconcile' }, x));
    }
    if (rec && rec.rate_limited === true) summary.rate_limited = true;
    if (rec && rec.ok === false && (!Array.isArray(rec.errors) || rec.errors.length === 0)) {
      summary.errors.push({ stage: 'reconcile', message: rec.reason || 'reconcile-failed' });
    }
  } catch (err) {
    alert('reconcile-pass-threw', { message: (err && err.message) || 'error' });
    summary.errors.push({ stage: 'reconcile', message: (err && err.message) || 'reconcile-threw' });
  }

  // PASS 1: review-observe each in_flight PR (poll review state -> review-outcome-store).
  // F3 pacing: walk sequentially and BAIL on systemic failure so the sweep never hammers the shared-token
  // secondary-rate-limit cooldown. runReviewObserve masks a gh failure as an opaque `gh-exit` (it does not
  // surface the status), so the bail triggers on a RECOGNIZED rate-limit reason (future-proof, if the
  // observer is later hardened to differentiate) OR on 2 CONSECUTIVE observe failures (the systemic-failure
  // proxy - a rate-limit fails every call, so two in a row is the signal to stop, not press on).
  let consecutiveFail = 0;
  let entries;
  // The PASS 0.5 interlock: if the reconciler already hit the shared-token rate limit, do NOT start a
  // per-entry observe walk into the same cooldown - bail before the first call, not after two more.
  if (summary.rate_limited) {
    summary.review_pass_bailed = true;
    alert('review-pass-bail', { reason: 'rate-limited-upstream-pass', consecutive: 0 });
    entries = [];
  } else {
    try { entries = queue.list({ state: 'in_flight' }, { dir: o.queueDir }); }
    catch (err) { alert('queue-list-threw', { message: (err && err.message) || 'error' }); entries = []; }
  }
  for (const e of entries) {
    const pr = e && e.evidence && e.evidence.pr_url;
    if (typeof pr !== 'string' || !pr) continue;
    let r;
    try {
      r = await runReviewObserve({ pr }, { runner: ghRunner, dir: o.reviewDir });
    } catch (err) {
      summary.errors.push({ entry_id: e.entry_id, stage: 'review', message: (err && err.message) || 'error' });
      r = { ok: false, reason: 'observe-threw' };
    }
    const ok = !!(r && r.ok);
    summary.observed.push({ entry_id: e.entry_id, pr, ok, reason: (r && r.reason) || null });
    if (ok) { consecutiveFail = 0; summary.reviews_recorded += Number(r.recorded || r.observed || 0) || 0; continue; }
    consecutiveFail += 1;
    const recognizedRateLimit = RATELIMIT_RE.test(String((r && r.reason) || ''));
    if (recognizedRateLimit || consecutiveFail >= 2) {
      summary.review_pass_bailed = true;
      if (recognizedRateLimit) summary.rate_limited = true;
      alert('review-pass-bail', { entry_id: e.entry_id, reason: (r && r.reason) || null, consecutive: consecutiveFail });
      break;
    }
  }

  // PASS 2: merge -> mint (Wave B). Pass the 4 promote dirs ONLY when fully isolated (all-or-nothing).
  const promoteOpts = { ghRunner };
  if (rd.isolated) {
    promoteOpts.queueDir = o.queueDir; promoteOpts.pendingDir = o.pendingDir;
    promoteOpts.anchorDir = o.anchorDir; promoteOpts.liveDir = o.liveDir;
  }
  // The interlock covers PASS 2 as well: merge-promote has NO bail of its own (1 verifyMerge per in_flight +
  // 2 fetches per merged, unbounded), so running it into a known cooldown would spend exactly the shared
  // budget the bail protects (VALIDATE-hacker M-2).
  // Gated on a RECOGNIZED rate limit only - deliberately NOT on the generic `review_pass_bailed`.
  // A pre-PR CodeRabbit Major proposed bailing on both, but premise-probing it against the prior wave shows
  // that over-reaches: PASS 1's systemic bail also fires on 2 consecutive NON-rate-limit failures (two 404s,
  // a transient blip), and F3 (#584) deliberately keeps promote running through those - its own test m3 and
  // this suite's header lock that in, because Wave B's gh-verify already fail-soft-skips per entry. Bailing
  // on every systemic failure would silently overturn a tested design decision to close a hole that the
  // `rate_limited` gate (the actual cooldown, VALIDATE-hacker M-2) already closes.
  if (summary.rate_limited) {
    summary.promote_pass_bailed = true;
    alert('promote-pass-bail', { reason: 'rate-limited-upstream-pass' });
    return { ok: true, ...summary };
  }
  const promoted = await promoteMergedEntries(promoteOpts);
  if (promoted && promoted.ok) {
    summary.merged = promoted.merged || [];
    summary.minted = promoted.minted || [];
    summary.skipped = promoted.skipped || [];
    if (Array.isArray(promoted.errors)) summary.errors.push(...promoted.errors);
  } else {
    summary.errors.push({ stage: 'promote', message: (promoted && promoted.reason) || 'promote-failed' });
  }

  return { ok: true, ...summary };
}

module.exports = { pollSolveQueue };

// CLI entry (the launchd runner invokes `node solve-queue-poll.js`): one sweep, JSON to stdout, exit 0
// always (a scheduler must not treat a shadow no-op as a failure). Production wiring = zero dirs.
if (require.main === module) {
  pollSolveQueue({})
    .then((res) => { process.stdout.write(`${JSON.stringify(res)}\n`); process.exit(0); })
    .catch((err) => { process.stdout.write(`${JSON.stringify({ ok: false, reason: 'poll-threw', message: (err && err.message) || 'error' })}\n`); process.exit(0); });
}
