#!/usr/bin/env node

'use strict';

// K13 — serial-spawn admission enforcer (v3.0-alpha, PR 2).
//
// Ships hook-SHAPED but DORMANT: NOT wired into hooks.json in v3.0-alpha (no
// PreToolUse:Agent|Task entry invokes it — see plan §Sub-PR-2 file list, which
// does not modify hooks.json). Built + unit-tested here; its acquireLock-guarded
// serial state + lock are consumed by PR 4's post-spawn-resolver + recovery-sweep
// (plan §Sub-PR-4; F3: "recovery sweep MUST hold K13 lock"). Activation of the
// admission GATE itself is deferred to a later phase. Same ship-dormant shape as
// K9 (plan line 291).
//
// Design — the load-bearing nuance:
//   A short-lived PreToolUse hook CANNOT hold a lock across the spawn's whole
//   lifetime (it returns + exits before the spawn runs). So the serial state is
//   a PERSISTENT marker file with AGE-based staleness. Agent/Task spawns are NOT
//   OS processes, so the PID-staleness recovery in `_lib/lock.js` does not apply
//   to them — age is the only safe staleness signal here. `acquireLock` is held
//   ONLY around the brief read-marker → decide → write-marker critical section.
//   Explicit marker release is PR 4's post-spawn-resolver job (releaseSerialMarker
//   below); in PR 2, AGE-reap is the only release.
//
// Guarantee scope (HONEST — architect pair-review FLAG-1): the lock guarantees
//   "at most one ADMITTED marker within `maxSpawnAgeMs`", NOT "at most one LIVE
//   spawn". A spawn that runs longer than maxSpawnAgeMs is reaped and a second
//   admits while the first may still be alive. That is the accepted age-reap
//   liveness/correctness trade for the local-trust model; PR 4's explicit
//   release closes the normal-spawn-close side, leaving only the crashed-spawn
//   case to age-reap.
//
// F8 (blair-HIGH-4): K13 calls `acquireLock` DIRECTLY — never `withLock`, whose
//   lock-fail path is `process.exit(2)` (→ a UI error dialog instead of a clean
//   hook-protocol rejection). A false `acquireLock` return is mapped to
//   {decision:"block", reason:"serial-only-spawn-active"} + exit 0.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { acquireLock, releaseLock } = require('../_lib/lock');
const { writeAtomicString } = require('../_lib/atomic-write');

// Spawn-state base — consistent with spawn-record.js (~/.claude/spawn-state).
// LOOM_SPAWN_STATE_DIR override exists for hermetic tests + CI fixtures.
const DEFAULT_STATE_DIR = process.env.LOOM_SPAWN_STATE_DIR ||
  path.join(os.homedir(), '.claude', 'spawn-state');
const MARKER_BASENAME = 'k13-active-spawn.json';
const LOCK_BASENAME = 'k13-serial.lock';
const DIR_MODE = 0o700; // hygienic, matches spawn-record.js

// Max age before an active-spawn marker is stale + reapable. Default generous
// (10 min) for the local-trust threat model — a long-running subagent must not
// be evicted mid-flight. Env-overridable.
const MAX_SPAWN_AGE_MS_DEFAULT = (() => {
  const raw = parseInt(process.env.LOOM_K13_MAX_SPAWN_AGE_MS || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 600000;
})();

function markerPathFor(stateDir) {
  return path.join(stateDir || DEFAULT_STATE_DIR, MARKER_BASENAME);
}
function lockPathFor(stateDir) {
  return path.join(stateDir || DEFAULT_STATE_DIR, LOCK_BASENAME);
}

function k13AuditPath() {
  return path.join(os.homedir(), '.claude', 'checkpoints', 'k13-serial-log.jsonl');
}

/**
 * Class-4 audit emit. Fail-soft (ADR-0001): audit failure never blocks. Log
 * path injectable by ARGUMENT (F23 discipline — never an env var).
 */
function emitK13Audit(record, logPath) {
  const target = logPath || k13AuditPath();
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(
      target,
      JSON.stringify({ ts: new Date().toISOString(), class: 4, kind: 'k13-serial-enforcer', ...record }) + '\n'
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * PURE admission decision (no I/O).
 *
 * @param {object|null} currentMarker - parsed active-spawn marker, or null.
 * @param {number} nowMs
 * @param {number} maxSpawnAgeMs
 * @returns {{admit: boolean, reason: string, reaped: boolean}}
 */
function decideAdmission(currentMarker, nowMs, maxSpawnAgeMs) {
  if (!currentMarker || typeof currentMarker.created_at_ms !== 'number') {
    return { admit: true, reason: 'no-active-spawn', reaped: false };
  }
  const age = nowMs - currentMarker.created_at_ms;
  if (age >= maxSpawnAgeMs) {
    return { admit: true, reason: 'reaped-stale-marker', reaped: true };
  }
  return { admit: false, reason: 'serial-only-spawn-active', reaped: false };
}

function readMarker(markerPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    return (parsed && typeof parsed === 'object') ? parsed : null;
  } catch {
    // Missing OR corrupt → treat as no active spawn (admission-equivalent to none).
    return null;
  }
}

function writeMarker(markerPath, marker) {
  fs.mkdirSync(path.dirname(markerPath), { recursive: true, mode: DIR_MODE });
  // Shared atomic primitive (tmp+rename + cleanup-on-error) — DRY with spawn-record.
  writeAtomicString(markerPath, JSON.stringify(marker));
}

/**
 * Locked serial admission. Acquires the K13 lock (F8: DIRECTLY, not withLock),
 * reads + decides + (on admit) writes the marker, releases the lock.
 *
 * Never throws at RUNTIME — the contract is a {decision, reason} object so the
 * PR-4 resolver (which calls this directly, without main()'s catch) is safe. The
 * one exception is a non-finite `nowMs`, which is a PROGRAMMER error (caller bug)
 * and fails fast with a clear message rather than a cryptic Date throw.
 *
 * @param {object} o
 * @param {string} [o.stateDir]
 * @param {string} o.spawnId
 * @param {number} o.nowMs - ms since epoch (caller-authoritative; must be finite).
 * @param {number} [o.maxSpawnAgeMs]
 * @param {function} [o.acquireLockFn] - injectable for tests; default real lock.
 * @param {function} [o.releaseLockFn]
 * @param {string} [o.auditLogPath]
 * @returns {{decision: 'allow'|'block', reason: string, reaped: boolean}}
 */
function runSerialAdmission(o) {
  // nowMs is caller-authoritative for age math — a non-finite value is a
  // programmer error, not a runtime condition (HIGH-1, code-review). Fail fast
  // with a clear message instead of a cryptic "Invalid time value" deep in
  // writeMarker's new Date().
  if (!Number.isFinite(o.nowMs)) {
    throw new Error('K13 runSerialAdmission: nowMs must be a finite number (ms since epoch)');
  }
  const stateDir = o.stateDir || DEFAULT_STATE_DIR;
  const maxAge = (typeof o.maxSpawnAgeMs === 'number') ? o.maxSpawnAgeMs : MAX_SPAWN_AGE_MS_DEFAULT;
  const lockPath = lockPathFor(stateDir);
  const acquire = o.acquireLockFn || (() => acquireLock(lockPath));
  const release = o.releaseLockFn || (() => releaseLock(lockPath));

  // F8: acquireLock DIRECTLY. A false return → clean block (NEVER process.exit(2)).
  if (!acquire()) {
    return { decision: 'block', reason: 'serial-only-spawn-active', reaped: false };
  }
  try {
    const markerPath = markerPathFor(stateDir);
    const decision = decideAdmission(readMarker(markerPath), o.nowMs, maxAge);
    if (decision.admit) {
      writeMarker(markerPath, {
        spawn_id: o.spawnId,
        created_at_ms: o.nowMs,
        created_at_iso: new Date(o.nowMs).toISOString(),
      });
    }
    return { decision: decision.admit ? 'allow' : 'block', reason: decision.reason, reaped: decision.reaped };
  } catch (err) {
    // Runtime failure in the critical section (e.g. marker write failed: disk
    // full, permissions). FAIL CLOSED — do not admit a spawn we cannot record —
    // and return a structured result rather than throwing (HIGH-1 / MEDIUM).
    emitK13Audit(
      { event: 'admission-error', reason: String((err && err.message) || err).slice(0, 200), spawn_id: o.spawnId },
      o.auditLogPath
    );
    return { decision: 'block', reason: 'admission-error', reaped: false };
  } finally {
    release();
  }
}

// PR-4a (ADR-0011 §K13-release-retry): bounded-retry budget for a lock-unavailable
// RELEASE. A failed release is costlier than a failed admission — the marker
// persists and blocks ALL spawns until age-reap (maxSpawnAgeMs). Bounded to 3–5
// attempts with a fixed ≈500ms backoff; total budget stays well under the sweep
// critical-section ceiling. NOT env-overridable (F23 — the backoff is exercised
// via an injectable sleepFn seam, never a process.env trigger).
const RELEASE_RETRY_MAX_ATTEMPTS = 3;
const RELEASE_RETRY_BACKOFF_MS = 500;

/**
 * Try to acquire the lock + perform the owner-scoped unlink exactly once.
 * Returns a structured result. `null` means the lock was unavailable (caller
 * decides whether to retry).
 *
 * @returns {{released: boolean, reason: string}|null}
 */
function attemptOwnerRelease(stateDir, spawnId, acquire, release) {
  if (!acquire()) return null; // lock unavailable on this attempt
  try {
    const markerPath = markerPathFor(stateDir);
    const marker = readMarker(markerPath);
    if (marker && marker.spawn_id === spawnId) {
      try { fs.unlinkSync(markerPath); } catch { /* already gone */ }
      return { released: true, reason: 'owner-release' };
    }
    return { released: false, reason: marker ? 'not-owner' : 'no-marker' };
  } finally {
    release();
  }
}

/**
 * Release the active-spawn marker IFF it belongs to spawnId. PR 4's
 * post-spawn-resolver calls this at spawn-close (the resolver sources spawnId by
 * reading the active marker — ADR-0011 §K13-spawn-id-provenance — so the
 * owner-check matches by construction). Lock-guarded; a non-owner call is a no-op
 * (a spawn can never evict another spawn's marker).
 *
 * Two lock-unavailable behaviors, selected by whether a `sleepFn` seam is
 * supplied (F23 — the retry is an injectable-clock concern, never env-triggered):
 *   - sleepFn ABSENT  (legacy single-attempt): a lock-unavailable release is
 *       audited Class-4 and returns reason:'lock-unavailable' immediately. The
 *       marker persists for age-reap.
 *   - sleepFn PRESENT (PR-4a bounded retry): up to RELEASE_RETRY_MAX_ATTEMPTS
 *       (3) with a fixed backoff between attempts. If a later attempt acquires
 *       the lock, the marker is released. On exhaustion it emits a Class-4
 *       'release-retry-exhausted' audit and returns that reason; the marker
 *       persists for age-reap (correctness over liveness). The PostToolUse hook
 *       MUST exit cleanly regardless — this function never throws or blocks
 *       indefinitely (the attempt count is hard-bounded).
 *
 * @param {object} o
 * @param {string} [o.stateDir]
 * @param {string} o.spawnId
 * @param {function} [o.acquireLockFn]
 * @param {function} [o.releaseLockFn]
 * @param {function} [o.sleepFn]      injectable backoff seam (ms) → enables retry
 * @param {string} [o.auditLogPath]
 * @returns {{released: boolean, reason: string}}
 */
function releaseSerialMarker(o) {
  const stateDir = o.stateDir || DEFAULT_STATE_DIR;
  const lockPath = lockPathFor(stateDir);
  const acquire = o.acquireLockFn || (() => acquireLock(lockPath));
  const release = o.releaseLockFn || (() => releaseLock(lockPath));

  // Legacy single-attempt path: no injectable sleep seam ⇒ no retry budget.
  if (typeof o.sleepFn !== 'function') {
    const once = attemptOwnerRelease(stateDir, o.spawnId, acquire, release);
    if (once === null) {
      emitK13Audit({ event: 'release-lock-unavailable', spawn_id: o.spawnId }, o.auditLogPath);
      return { released: false, reason: 'lock-unavailable' };
    }
    return once;
  }

  // PR-4a bounded retry: 1 initial try + up to (MAX-1) retries, each preceded by
  // a single injected backoff sleep. A non-lock-unavailable outcome (owner /
  // not-owner / no-marker) returns immediately — only lock-unavailability retries.
  for (let attempt = 1; attempt <= RELEASE_RETRY_MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      try { o.sleepFn(RELEASE_RETRY_BACKOFF_MS); } catch { /* sleep seam must not throw the hook */ }
    }
    const res = attemptOwnerRelease(stateDir, o.spawnId, acquire, release);
    if (res !== null) return res; // acquired the lock — done (released or owner-mismatch)
  }
  // Exhausted: every attempt found the lock unavailable. Marker persists for
  // age-reap; surface a distinct Class-4 reason so the resolver can alert.
  emitK13Audit(
    { event: 'release-retry-exhausted', spawn_id: o.spawnId, attempts: RELEASE_RETRY_MAX_ATTEMPTS },
    o.auditLogPath
  );
  return { released: false, reason: 'release-retry-exhausted' };
}

// ── Dormant hook entry (NOT wired in hooks.json) ────────────────────────────

function readStdin() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function emit(decision, reason) {
  try {
    process.stdout.write(JSON.stringify(reason ? { decision, reason } : { decision }) + '\n');
  } catch {
    // stdout closed; nothing we can do, and the hook must not throw.
  }
}

function main() {
  const input = readStdin();
  // Fail-soft (ADR-0001) for non-serial conditions: malformed input / non-spawn
  // tools never block. Only a genuine active marker or lock-fail blocks.
  if (!input) { emit('allow'); process.exit(0); }
  const toolName = input.tool_name || input.toolName;
  if (toolName !== 'Agent' && toolName !== 'Task') { emit('allow'); process.exit(0); }

  try {
    const sessionId = input.session_id || input.sessionId || '';
    const spawnId = `${Date.now().toString(36)}-${sessionId || 'nosession'}`;
    const r = runSerialAdmission({ spawnId, nowMs: Date.now() });
    emit(r.decision, r.decision === 'block' ? r.reason : undefined);
    process.exit(0);
  } catch {
    // Unexpected error in a DORMANT gate → fail-soft allow (never brick a spawn).
    emit('allow');
    process.exit(0);
  }
}

if (require.main === module) main();

module.exports = {
  decideAdmission,
  runSerialAdmission,
  releaseSerialMarker,
  readMarker,
  markerPathFor,
  lockPathFor,
  emitK13Audit,
  MAX_SPAWN_AGE_MS_DEFAULT,
};
