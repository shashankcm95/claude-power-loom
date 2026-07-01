'use strict';

// A-W2 - the SHADOW live-loop scheduler runner. Mirrors the ghost-heartbeat SRP triad (this = the runner;
// A-W3 = the launchd wiring; the lock + run-state are the persistence). Drives `pullLiveCorpus ->
// runLiveDraftLoop` EMIT-OFF: it NEVER calls `emitPR` directly, threads NO egress custody opts, and forwards
// `{}` loop-deps in production, so the loop's hardcoded `emitFn(data, {})` (live-draft-run.js:323) engages
// emitPR's three fail-closed defaults (dry-run + no-token + killswitch-ON) -> `emitted:false`.
//
// Draft-only by construction: with emit OFF no PR is emitted -> nothing to merge -> the `observe-merge ->
// world-anchor-mint` half is inherently Part B (it needs a real merged PR URL). `captureLiveLesson` still mints
// (weight-inert) into the `live_pending` lane INSIDE the loop - that is the reachable "mint-unsigned-shadow".
//
// Advisory-runner posture (mirror ghost-heartbeat): every stage fail-soft, the process ALWAYS exits 0 (a
// scheduler must never see a failure). Import-exclusion (SHADOW-safety): this runner imports the pull + draft
// legs + the kernel lock/atomic-write ONLY - never `world-anchor/`, `custody-arming`, or the mint - so the
// world-anchor lane stays untouched (a structural test enforces this).

const fs = require('fs');
const os = require('os');
const path = require('path');

const { pullLiveCorpus } = require('../issue-corpus/live-puller');
const { runLiveDraftLoop } = require('../persona-experiment/live-draft-run');
const { acquireLock, releaseLock } = require('../../kernel/_lib/lock');
const { writeAtomic } = require('../../kernel/_lib/atomic-write');

const HOME = os.homedir();
const CHECKPOINTS = path.join(HOME, '.claude', 'checkpoints');
const DEFAULT_RUN_STATE_PATH = path.join(CHECKPOINTS, 'live-loop-run.json');
const DEFAULT_LOCK_PATH = path.join(CHECKPOINTS, 'live-loop.lock');
// The env killswitch is INERT under launchd's minimal env (it does not source the shell profile), so the
// home-readable touch-file is the WORKING off-switch: `touch ~/.claude/checkpoints/live-loop.disabled`.
const DEFAULT_KILLSWITCH_FILE = path.join(CHECKPOINTS, 'live-loop.disabled');
const DEFAULT_ARTIFACTS_DIR = path.join(CHECKPOINTS, 'live-loop-artifacts');
const DEFAULT_LEDGER_PATH = path.join(CHECKPOINTS, 'live-loop-ledger.json');
const RUN_STATE_VERSION = 1;
const DEFAULT_LIMIT = 5;                 // bounded corpus per fire; pullLiveCorpus re-validates [1,100].

// Presence-only lstat NO-FOLLOW (mirror ghost-heartbeat): ANY node at the path (file/symlink/dir) means
// disabled; a stat error means absent. A content read would REDUCE safety (an empty-but-readable file would
// fail open) - keep it presence-only.
function killswitchFilePresent(p) {
  try { fs.lstatSync(p); return true; } catch { return false; }
}

// runLiveLoop: one SHADOW fire. Gates -> lock -> (fail-soft pull) -> (drive the draft loop EMIT-OFF) ->
// (fail-open run-state). Never throws; returns a summary { ok, reason?, pulled, drafted, fatal, outcomes }.
// Every external seam is injectable via `deps` for tests (pullFn / draftFn / loopDeps / acquireFn / releaseFn /
// writeStateFn). In production `deps` is empty: `loopDeps` defaults to `{}`, so the loop uses the real emitPR
// with `{}` opts and stays draft.
async function runLiveLoop({
  artifactsDir = DEFAULT_ARTIFACTS_DIR, ledgerPath = DEFAULT_LEDGER_PATH, limit = DEFAULT_LIMIT,
  capUsd, model, timeout, dockerBin, image,
  runStatePath = DEFAULT_RUN_STATE_PATH, lockPath = DEFAULT_LOCK_PATH, killswitchFile = DEFAULT_KILLSWITCH_FILE,
  now = Date.now, log = () => {}, deps = {},
} = {}) {
  // --- gates: env killswitch (parity; inert under launchd) -> touch-file killswitch -> opt-in run-gate ---
  if (process.env.LOOM_LIVE_LOOP_DISABLED === '1') return { ok: false, reason: 'killswitch' };
  if (killswitchFilePresent(killswitchFile)) return { ok: false, reason: 'killswitch-file' };
  if (process.env.LOOM_LIVE_LOOP_ENABLED !== '1') return { ok: false, reason: 'opt-out' };

  const pullFn = deps.pullFn || pullLiveCorpus;
  const draftFn = deps.draftFn || runLiveDraftLoop;
  const loopDeps = deps.loopDeps || {};              // {} in prod -> real emitPR({}) -> EMIT-OFF (no live emitFn)
  const acquireFn = deps.acquireFn || acquireLock;
  const releaseFn = deps.releaseFn || releaseLock;
  const writeStateFn = deps.writeStateFn || writeAtomic;

  // --- run-in-progress LOCK: a SMALL maxWaitMs so a contended fire skips fast (the default 3000 would block
  // ~3s; 100ms is ~30x faster and imperceptible for a scheduled fire). NOT a truly-near-zero value: acquireLock
  // loops `while (Date.now() - start < maxWaitMs)`, so a maxWaitMs of 0/1 is FLAKY - a single clock tick between
  // `start` and the while-check yields ZERO acquisition attempts. 100ms reliably guarantees >=1 attempt while
  // still skipping fast on contention. A minutes-long run holds the lock across the await; a SIGKILLed holder's
  // dead PID is reclaimed by acquireLock. withLockSoft is SYNC-only (it would release before an async fn
  // resolves) - so acquire + release manually around the async critical section.
  //
  // GUARD the acquire (VALIDATE HIGH): acquireLock can THROW (its unguarded fs.mkdirSync on the checkpoints dir
  // -> EACCES/ENOSPC/EROFS). Catch it so runLiveLoop ALWAYS RESOLVES a summary (the never-throws contract) - a
  // programmatic caller (an A-W3 wrapper, a test) must not have to wrap the call. A throw = a failed acquire.
  let locked;
  try { locked = acquireFn(lockPath, { maxWaitMs: 100 }); }
  catch (e) { return { ok: false, reason: 'lock-acquire-threw:' + ((e && e.message) || 'error') }; }
  if (!locked) return { ok: false, reason: 'locked' };

  let pulled = 0;
  let drafted = 0;
  let fatal = null;
  let outcomes = [];
  try {
    // fail-soft pull: pullLiveCorpus has no top-level auth catch (live-puller.js:223) - a 401/403 on the search
    // call throws OUT of it; this wrap is LOAD-BEARING (an unauth box stays inert, not crashing).
    let records = [];
    try {
      const pull = await pullFn({ limit });
      records = (pull && Array.isArray(pull.records)) ? pull.records : [];
    } catch (e) { fatal = 'pull:' + ((e && e.message) || 'error'); }
    pulled = records.length;

    if (records.length) {
      try { fs.mkdirSync(artifactsDir, { recursive: true }); } catch { /* fail-soft: writeArtifact is per-record fail-soft */ }
      // drive the loop EMIT-OFF: forward `loopDeps` (`{}` in prod). The runner NEVER calls emitPR directly and
      // threads NO egress custody opts (they are not in runLiveDraftLoop's signature to thread). runLiveDraftLoop
      // is itself fail-soft, but the try makes a defensive throw a fatal, never an escape (advisory posture).
      try {
        const report = await draftFn({ records, artifactsDir, ledgerPath, capUsd, model, timeout, dockerBin, image, runId: 'live-loop', now: now(), deps: loopDeps });
        outcomes = (report && Array.isArray(report.outcomes)) ? report.outcomes : [];
        drafted = outcomes.filter((o) => o && o.ok === true).length;
        if (report && report.fatal && !fatal) fatal = 'draft:' + report.fatal;
      } catch (e) { if (!fatal) fatal = 'draft-threw:' + ((e && e.message) || 'error'); }
    }

    // fail-open run-state (mirror ghost-heartbeat-run.js:291-295): a write failure must not escape the
    // always-exit-0 contract.
    try {
      writeStateFn(runStatePath, { version: RUN_STATE_VERSION, pulled, drafted, fatal, lastRunAt: new Date(now()).toISOString() });
    } catch (e) { log('run-state-write-error', { msg: e && e.message }); }
  } catch (e) {
    // last-resort: any unexpected throw becomes a fatal, never escapes (a scheduler must never see a failure).
    if (!fatal) fatal = 'run-threw:' + ((e && e.message) || 'error');
  } finally {
    try { releaseFn(lockPath); } catch { /* release is best-effort; a stale lock self-heals on the next fire */ }
  }

  return { ok: true, pulled, drafted, fatal, outcomes };
}

module.exports = {
  runLiveLoop, killswitchFilePresent,
  DEFAULT_RUN_STATE_PATH, DEFAULT_LOCK_PATH, DEFAULT_KILLSWITCH_FILE, DEFAULT_ARTIFACTS_DIR, RUN_STATE_VERSION,
};

// Advisory runner CLI (mirror the ghost-heartbeat CLI): print a summary + ALWAYS exit 0. No emit env is
// set/read; emit-off is at the loop's `{}` opts regardless of any plist env.
if (require.main === module) {
  runLiveLoop({
    log: (e, d) => process.stderr.write(`[live-loop-run] ${e} ${d !== undefined ? JSON.stringify(d) : ''}\n`),
  }).then((res) => {
    process.stdout.write(`${JSON.stringify({ ok: res.ok, reason: res.reason, pulled: res.pulled, drafted: res.drafted, fatal: res.fatal })}\n`);
    process.exit(0);
  }).catch((e) => {
    process.stderr.write(`[live-loop-run] fatal ${(e && e.message) || e}\n`);
    process.exit(0);
  });
}
