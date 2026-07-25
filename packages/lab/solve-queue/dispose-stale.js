#!/usr/bin/env node

// @loom-layer: lab
//
// The dispose-on-failure sweep (SHADOW / weight-0). A solver that dies mid-flight leaves its solve-queue
// entry stuck at `solving` with no terminal path (the Wave D `failed-solve-rests-at-solving` behavior),
// which (a) BLOCKS re-enqueue of the same (repo, issue_ref) - `enqueue` returns idempotent-`solving` until
// the entry is disposed - and (b) accretes zombies. This sweep advances a STALE `solving` entry to
// `disposed` (which is re-openable: `disposed -> queued`), so re-submission unblocks and the queue
// self-cleans.
//
// SAFETY (a wall-clock heuristic ALONE is unsafe - architect VERIFY on this plan):
//   - COMPARE-AND-SWAP: the advance passes `expect_state:'solving'`, so an entry that raced OUT of `solving`
//     (to `drafted`, ...) between the unlocked `list` read and the mutation is NEVER disposed. Without CAS
//     the sweep would reap a freshly-drafted, emit-ready entry (the `drafted -> disposed` transition is
//     legal). CAS makes any advanced entry un-disposable - the keystone guard.
//   - GENEROUS WINDOW: DEFAULT_STALE_MS (2h) is ~40x the 180s default actor timeout, and `--timeout` is
//     bounded to this window at the CLI (live-solve-one), so a realistic live solve never ages out mid-run.
//
// SHADOW: the queue gates NOTHING; a mis-dispose is bookkeeping-only (bounded to one wasted re-solve + a
// benign alert). TOTAL: never throws; every entry lands in disposed / skipped / errors.
//
// Imports: the solve-queue store (public ops only) + kernel/egress/alert. NO runtime/kernel STATE, no gh,
// no egress, no arming.

'use strict';

const queue = require('./solve-queue-store');
const { emitEgressAlert } = require('../../kernel/egress/alert');

// The staleness window: a `solving` entry whose last accepted event is older than this is treated as a dead
// solver. 2h = ~40x the 180s default actor timeout, so a crashed zombie is reaped within 2h (the
// re-submission-lockout latency) while a realistic live solve never ages out. Exported so the CLI
// (live-solve-one) can bound `--timeout` to it - the two knobs move together.
const DEFAULT_STALE_MS = 2 * 60 * 60 * 1000;   // 7200000

// FIXED positional token + a `kind` differentiator (the store/merge-promote convention). Never a variable
// positional arg, never a `reason` key in the detail (emitEgressAlert's positional `reason` clobbers it).
// `kind` is spread LAST so a future detail carrying its own `kind` can't clobber the discriminator.
function alert(kind, detail) { emitEgressAlert('dispose-stale', Object.assign({}, detail || {}, { kind })); }

/**
 * One dispose sweep over the solve-queue's `solving` entries: advance each entry whose last accepted event
 * (`updated_at`) is older than `staleMs` to `disposed`, CAS-guarded on `expect_state:'solving'`. TOTAL /
 * SHADOW / weight-0. A CAS refusal (`state-changed`) is a BENIGN lost race -> `skipped`, not an error.
 * @param {{now?: number, staleMs?: number, queueDir?: string, queue?: object}} [opts]
 *   now/staleMs/queue are DI for deterministic tests; queueDir isolates the store (undefined = production).
 * @returns {{ok: boolean, disposed: Array, skipped: Array, errors: Array, reason?: string}}
 */
function disposeStaleSolving(opts = {}) {
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  const now = typeof o.now === 'number' && Number.isFinite(o.now) ? o.now : Date.now();
  const staleMs = typeof o.staleMs === 'number' && Number.isFinite(o.staleMs) && o.staleMs > 0 ? o.staleMs : DEFAULT_STALE_MS;
  const q = o.queue || queue;
  const opOpts = o.queueDir !== undefined ? { dir: o.queueDir } : {};
  const summary = { ok: true, disposed: [], skipped: [], errors: [] };

  let entries;
  try { entries = q.list({ state: 'solving' }, opOpts); }
  catch (err) { alert('list-threw', { detail: (err && err.message) || 'error' }); return { ok: false, reason: 'list-threw', disposed: [], skipped: [], errors: [] }; }
  if (!Array.isArray(entries)) return summary;

  for (const e of entries) {
    try {
      if (!e || typeof e.entry_id !== 'string') continue;
      const updatedAt = e.updated_at;
      if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) { summary.skipped.push({ entry_id: e.entry_id, reason: 'no-timestamp' }); continue; }
      // The version-CAS is non-bypassable: without a valid `rev` to pin, we cannot protect against the
      // age-TOCTOU, so a rev-less entry is skipped fail-safe (never disposed without version protection).
      if (!Number.isInteger(e.rev) || e.rev < 0) { summary.skipped.push({ entry_id: e.entry_id, reason: 'no-rev' }); continue; }
      const ageMs = now - updatedAt;
      if (ageMs < staleMs) {
        // A negative age (future ts / clock skew) is `< staleMs` -> not-stale skip (fail-safe: never dispose).
        // A MATERIALLY future ts (age < -staleMs) is a clock-skew/tamper signal that can wedge the entry
        // un-reapable (M1); keep the fail-safe skip but make it OBSERVABLE for manual intervention.
        if (ageMs < -staleMs) alert('future-ts-suspect', { entry_id: e.entry_id, age_ms: ageMs });
        summary.skipped.push({ entry_id: e.entry_id, reason: 'not-stale', age_ms: ageMs });
        continue;
      }
      // CAS on BOTH state and version (rev): refuse if the entry raced OUT of `solving` OR cycled to a FRESH
      // solve since the unlocked snapshot (H1 age-TOCTOU). `rev` (monotonic accepted-event count) is the
      // version token, not the wall-clock `updated_at` - two events in the same ms share a ts but never a rev.
      let adv;
      try {
        adv = q.advance({ entry_id: e.entry_id, to_state: 'disposed', expect_state: 'solving', expect_rev: e.rev, evidence: { reason: 'stale-solving-timeout' } }, opOpts);
      } catch (err) {
        summary.errors.push({ entry_id: e.entry_id, message: (err && err.message) || 'advance-threw' });
        continue;
      }
      if (adv && adv.ok) {
        summary.disposed.push({ entry_id: e.entry_id, age_ms: ageMs });
        alert('disposed-stale-solving', { entry_id: e.entry_id, age_ms: ageMs });
      } else if (adv && (adv.reason === 'state-changed' || adv.reason === 'version-changed')) {
        summary.skipped.push({ entry_id: e.entry_id, reason: adv.reason });   // CAS lost race - benign
      } else {
        summary.errors.push({ entry_id: e.entry_id, message: (adv && adv.reason) || 'advance-failed' });
      }
    } catch (err) {
      // L1 defense-in-depth: a hostile accessor (a throwing entry_id getter, only reachable via a test-only
      // `queue` DI - the real store yields plain data props) must not break the TOTAL contract.
      let eid = null;
      try { if (e && typeof e.entry_id === 'string') eid = e.entry_id; } catch { /* getter hostile */ }
      summary.errors.push({ entry_id: eid, message: (err && err.message) || 'entry-threw' });
    }
  }
  return summary;
}

module.exports = { disposeStaleSolving, DEFAULT_STALE_MS };

// CLI entry: one sweep, JSON to stdout, exit 0 always (a scheduler must not treat a shadow no-op as failure).
// Set exitCode instead of calling process.exit() so a piped stdout is allowed to flush before the process
// ends (an immediate process.exit() can truncate a buffered write).
if (require.main === module) {
  let out;
  try { out = JSON.stringify(disposeStaleSolving({})); }
  catch (err) { out = JSON.stringify({ ok: false, reason: 'sweep-threw', message: (err && err.message) || 'error' }); }
  process.stdout.write(`${out}\n`);
  process.exitCode = 0;
}
