'use strict';

// packages/kernel/spawn-state/ghost-heartbeat-state.js
//
// Ghost Heartbeat W2-PR1. State for the drift-emit producer (drift-audit.js).
//
//   - emitted-set : the CORRECTNESS boundary. Per (session_id, drift-class)
//     idempotency, so a class converges (store threshold 3) only across DISTINCT
//     sessions — a single over-eager judge pass cannot graduate a class alone
//     (RFC section 2.2). The store's own `bump` is NON-idempotent, so this set is
//     where idempotency lives.
//   - watermark   : a performance OPTIMIZATION only (skip re-scanning old
//     sessions). NEVER the correctness boundary — a late / clock-skewed session
//     must not be silently skipped; the emitted-set is the source of truth.
//
// recordEmissions is ONE withLockSoft critical section: load -> for each
// not-yet-emitted class { emitFn(class); mark } -> advance watermark -> writeAtomic.
// withLockSoft (NOT withLock) so a carrier hook fails open on lock-timeout rather
// than process.exit(2).

const fs = require('fs');
const path = require('path');
const os = require('os');
const { writeAtomic } = require('../_lib/atomic-write');
const { withLockSoft } = require('../_lib/lock');
const { withRegularFileFd } = require('../_lib/safe-read');

const STATE_VERSION = 1;
const HOME = os.homedir();
const DEFAULT_STATE_PATH = path.join(HOME, '.claude', 'checkpoints', 'ghost-heartbeat-state.json');

// PR-B retention defaults. A sid is pruned from the emitted-set only after it has
// been absent for >= PRUNE_ABSENT_RUNS_DEFAULT consecutive COMPLETE runs AND past the
// wall-clock floor — K>=2 + floor absorbs the non-monotonic dominant-sid flip and the
// concurrent Stop-child emit-during-prune race (the lock makes the WRITE atomic, not
// the DECISION current). The runner overrides these via env (clamped).
const PRUNE_ABSENT_RUNS_DEFAULT = 2;
const PRUNE_FLOOR_MS_DEFAULT = 86400000; // 24h
const MAX_ABSENT_RUNS = 1000000;         // pruneTracking poison ceiling (R13 rigor)
const PRUNE_SKEW_MS = 86400000;          // firstAbsentAt future-stamp slack (1 day)

function emptyState() {
  return { version: STATE_VERSION, watermark: { lastReviewedAt: null, lastSessionId: null }, emitted: {}, pruneTracking: {}, lastRunAt: null };
}

// Per-sid absence bookkeeping is read from the SAME open-writable file as the
// correctness-bearing emitted-set, so it is poison-validated with the SAME rigor as
// the runner's audited map (the R13 lesson): absentRuns a non-negative integer <=
// MAX_ABSENT_RUNS, firstAbsentAt a finite ms in [0, now+skew] (a FUTURE first-absence
// is impossible). ANY non-conforming field -> DROP the whole tracker for that sid
// (it re-stamps on the next genuine absence) — never coerce a partial, which would let
// a forged value game the K+floor gate in either direction (deny-prune / prune-now).
function sanitizePruneTracking(raw, now = Date.now) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const clock = typeof now === 'function' ? now : () => now; // tolerate a bare timestamp
  const ceiling = clock() + PRUNE_SKEW_MS;
  for (const [sid, v] of Object.entries(raw)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const { absentRuns, firstAbsentAt } = v;
    if (!Number.isInteger(absentRuns) || absentRuns < 0 || absentRuns > MAX_ABSENT_RUNS) continue;
    if (!Number.isFinite(firstAbsentAt) || firstAbsentAt < 0 || firstAbsentAt > ceiling) continue;
    out[sid] = { absentRuns, firstAbsentAt };
  }
  return out;
}

// Tolerant read: a missing / corrupt / wrong-shaped / non-regular file yields empty
// state, never throws AND never blocks (the producer + the unattended PR-3a runner
// must fail open). withRegularFileFd opens O_NONBLOCK + fstat + reads from the bound
// fd — a FIFO planted at the state path would hang a raw readFileSync forever (#371).
function loadState(statePath = DEFAULT_STATE_PATH, now = Date.now) {
  const parsed = withRegularFileFd(statePath, (fd) => JSON.parse(fs.readFileSync(fd, 'utf8')), null);
  if (!parsed || typeof parsed !== 'object') return emptyState();
  const w = (parsed.watermark && typeof parsed.watermark === 'object') ? parsed.watermark : {};
  const rawEmitted = (parsed.emitted && typeof parsed.emitted === 'object' && !Array.isArray(parsed.emitted)) ? parsed.emitted : {};
  // Normalize the NESTED values too: each emitted[sid] MUST be an array of strings.
  // A parseable-but-wrong-shaped file (emitted[sid] = a string / number / object)
  // would make markEmitted's `prev.includes` throw or misbehave, breaking the
  // tolerant-load (fail-open) contract. Drop anything that is not a string array.
  const emitted = {};
  for (const [sid, v] of Object.entries(rawEmitted)) {
    if (Array.isArray(v)) emitted[sid] = v.filter((x) => typeof x === 'string');
  }
  // pruneTracking is validated + returned PER-FIELD independently of emitted: a
  // malformed pruneTracking must NEVER drop the correctness-bearing emitted-set, and
  // loadState's strict whitelist would otherwise silently drop the field on every read
  // (so recordEmissions's write would erase the absence counters -> prune never fires).
  return {
    version: STATE_VERSION,
    watermark: { lastReviewedAt: w.lastReviewedAt || null, lastSessionId: w.lastSessionId || null },
    emitted,
    pruneTracking: sanitizePruneTracking(parsed.pruneTracking, now),
    lastRunAt: parsed.lastRunAt || null,
  };
}

function isEmitted(state, sessionId, driftClass) {
  const arr = state.emitted[sessionId];
  return Array.isArray(arr) && arr.includes(driftClass);
}

// Immutable: returns a NEW state with (sessionId, driftClass) recorded.
function markEmitted(state, sessionId, driftClass) {
  const prev = state.emitted[sessionId] || [];
  if (prev.includes(driftClass)) return state;
  return { ...state, emitted: { ...state.emitted, [sessionId]: [...prev, driftClass] } };
}

// Retention tied to the watermark, not wall-clock age: keep only the sessions the
// caller guarantees may still be re-audited (keepSessionIds). Pruning by age alone
// can un-dedup (prune -> re-audit -> re-inflate), so the caller derives the keep
// set from the watermark floor. Immutable.
function pruneEmitted(state, keepSessionIds) {
  const keep = new Set(keepSessionIds || []);
  const emitted = {};
  for (const [sid, classes] of Object.entries(state.emitted)) {
    if (keep.has(sid)) emitted[sid] = classes;
  }
  return { ...state, emitted };
}

// The one critical section. emitFn(driftClass) performs the side effect (the store
// `bump`) for each class NOT already emitted for this session; on success the
// (session, class) pair is recorded so a re-run / concurrent carrier is a no-op.
// Returns { ok:true, value: emittedClasses[] } | { ok:false, reason:'lock-timeout' }
// — {ok:false} means the caller emits nothing and fails open.
function recordEmissions({ sessionId, classes, reviewedAt = null, emitFn, statePath = DEFAULT_STATE_PATH, lockPath } = {}) {
  const lp = lockPath || (statePath + '.lock');
  return withLockSoft(lp, () => {
    let state = loadState(statePath);
    const emittedNow = [];
    for (const driftClass of classes) {
      if (isEmitted(state, sessionId, driftClass)) continue;
      emitFn(driftClass);
      state = markEmitted(state, sessionId, driftClass);
      emittedNow.push(driftClass);
    }
    // An emit is a PRESENCE signal: reset this sid's absence tracker transactionally
    // under the SAME lock pruneEmittedState uses. This closes the snapshot-TOCTOU race
    // (a Stop-child emit landing between the runner's discover() snapshot and the prune
    // would otherwise be counted absent and prune a sid the run it was emitted to —
    // VERIFY board hack/arch MED). Only on an actual emit (state changed) — a no-op
    // re-emit must not perturb a legitimately-accruing tracker.
    let pruneTracking = state.pruneTracking;
    if (emittedNow.length > 0 && pruneTracking && Object.prototype.hasOwnProperty.call(pruneTracking, sessionId)) {
      pruneTracking = { ...pruneTracking };
      delete pruneTracking[sessionId];
    }
    state = { ...state, pruneTracking, watermark: { lastReviewedAt: reviewedAt, lastSessionId: sessionId }, lastRunAt: new Date().toISOString() };
    writeAtomic(statePath, state);
    return emittedNow;
  });
}

// The locked retention policy (sibling of recordEmissions; same withLockSoft, same
// default `statePath + '.lock'`, so it is mutually exclusive with every emit). The
// runner OBSERVES (presentSids + complete) outside the lock; this function DECIDES +
// writes inside it. Superset-safe / default-KEEP-on-uncertainty:
//   - !complete  -> DEFER: no counter advance, no prune (an incomplete observation —
//     truncated discovery OR a never-captured present path — must not drive a prune).
//   - complete   -> for each emitted sid: present -> RESET its tracker; else increment
//     absence (stamp firstAbsentAt on first); PRUNE only when absentRuns >= K AND
//     now - firstAbsentAt >= floorMs.
// Immutable; returns { ok, deferred, pruned: sid[] }. Fail-soft on lock-timeout
// ({ ok:false }), so the runner's try/catch + the advisory contract hold.
function pruneEmittedState({ presentSids, complete, now = Date.now, absentRuns: K = PRUNE_ABSENT_RUNS_DEFAULT, floorMs = PRUNE_FLOOR_MS_DEFAULT, statePath = DEFAULT_STATE_PATH, lockPath } = {}) {
  const lp = lockPath || (statePath + '.lock');
  const clock = typeof now === 'function' ? now : () => now; // tolerate a bare timestamp
  const res = withLockSoft(lp, () => {
    const state = loadState(statePath, clock);
    if (!complete) {
      // Defer: do not advance counters, do not prune. Leave state untouched (no write
      // -> no churn) so a busy box that never reaches a complete run is a pure no-op.
      return { deferred: true, pruned: [] };
    }
    const present = new Set(Array.isArray(presentSids) ? presentSids : []);
    const tracking = { ...state.pruneTracking };
    const tnow = clock();
    const pruned = [];
    let changed = false;
    const has = (sid) => Object.prototype.hasOwnProperty.call(tracking, sid);
    for (const sid of Object.keys(state.emitted)) {
      if (present.has(sid)) { if (has(sid)) { delete tracking[sid]; changed = true; } continue; }
      const prev = tracking[sid];
      const firstAbsentAt = (prev && Number.isFinite(prev.firstAbsentAt)) ? prev.firstAbsentAt : tnow;
      const nextRuns = ((prev && Number.isInteger(prev.absentRuns)) ? prev.absentRuns : 0) + 1;
      if (nextRuns >= K && (tnow - firstAbsentAt) >= floorMs) {
        pruned.push(sid);
        if (has(sid)) delete tracking[sid];
      } else {
        tracking[sid] = { absentRuns: Math.min(nextRuns, MAX_ABSENT_RUNS), firstAbsentAt };
      }
      changed = true;
    }
    // No-op when nothing moved (no prune, no tracker change) -> no write, no churn, and
    // a test with an empty emitted-set never creates a state file.
    if (!changed) return { deferred: false, pruned: [] };
    const prunedSet = new Set(pruned);
    const keep = Object.keys(state.emitted).filter((sid) => !prunedSet.has(sid));
    const next = { ...pruneEmitted(state, keep), pruneTracking: tracking, lastRunAt: new Date(tnow).toISOString() };
    writeAtomic(statePath, next);
    return { deferred: false, pruned };
  });
  if (!res.ok) return { ok: false, deferred: true, pruned: [] };
  return { ok: true, ...res.value };
}

module.exports = {
  loadState, isEmitted, markEmitted, pruneEmitted, pruneEmittedState, recordEmissions, emptyState,
  sanitizePruneTracking, DEFAULT_STATE_PATH, STATE_VERSION,
  PRUNE_ABSENT_RUNS_DEFAULT, PRUNE_FLOOR_MS_DEFAULT,
};
