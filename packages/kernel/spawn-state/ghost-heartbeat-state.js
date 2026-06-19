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

const STATE_VERSION = 1;
const HOME = os.homedir();
const DEFAULT_STATE_PATH = path.join(HOME, '.claude', 'checkpoints', 'ghost-heartbeat-state.json');

function emptyState() {
  return { version: STATE_VERSION, watermark: { lastReviewedAt: null, lastSessionId: null }, emitted: {}, lastRunAt: null };
}

// Tolerant read: a missing / corrupt / wrong-shaped file yields empty state, never
// throws (the producer must fail open).
function loadState(statePath = DEFAULT_STATE_PATH) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return emptyState();
  }
  if (!parsed || typeof parsed !== 'object') return emptyState();
  const w = (parsed.watermark && typeof parsed.watermark === 'object') ? parsed.watermark : {};
  const emitted = (parsed.emitted && typeof parsed.emitted === 'object' && !Array.isArray(parsed.emitted)) ? parsed.emitted : {};
  return {
    version: STATE_VERSION,
    watermark: { lastReviewedAt: w.lastReviewedAt || null, lastSessionId: w.lastSessionId || null },
    emitted,
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
    state = { ...state, watermark: { lastReviewedAt: reviewedAt, lastSessionId: sessionId }, lastRunAt: new Date().toISOString() };
    writeAtomic(statePath, state);
    return emittedNow;
  });
}

module.exports = {
  loadState, isEmitted, markEmitted, pruneEmitted, recordEmissions, emptyState,
  DEFAULT_STATE_PATH, STATE_VERSION,
};
