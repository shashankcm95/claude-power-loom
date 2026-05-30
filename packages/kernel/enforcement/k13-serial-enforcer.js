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
 * @param {object} o
 * @param {string} [o.stateDir]
 * @param {string} o.spawnId
 * @param {number} o.nowMs
 * @param {number} [o.maxSpawnAgeMs]
 * @param {function} [o.acquireLockFn] - injectable for tests; default real lock.
 * @param {function} [o.releaseLockFn]
 * @returns {{decision: 'allow'|'block', reason: string, reaped: boolean}}
 */
function runSerialAdmission(o) {
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
  } finally {
    release();
  }
}

/**
 * Release the active-spawn marker IFF it belongs to spawnId. PR 4's
 * post-spawn-resolver calls this at spawn-close. Lock-guarded; a non-owner call
 * is a no-op (a spawn can never evict another spawn's marker).
 *
 * @param {object} o
 * @param {string} [o.stateDir]
 * @param {string} o.spawnId
 * @param {function} [o.acquireLockFn]
 * @param {function} [o.releaseLockFn]
 * @returns {{released: boolean, reason: string}}
 */
function releaseSerialMarker(o) {
  const stateDir = o.stateDir || DEFAULT_STATE_DIR;
  const lockPath = lockPathFor(stateDir);
  const acquire = o.acquireLockFn || (() => acquireLock(lockPath));
  const release = o.releaseLockFn || (() => releaseLock(lockPath));

  if (!acquire()) return { released: false, reason: 'lock-unavailable' };
  try {
    const markerPath = markerPathFor(stateDir);
    const marker = readMarker(markerPath);
    if (marker && marker.spawn_id === o.spawnId) {
      try { fs.unlinkSync(markerPath); } catch { /* already gone */ }
      return { released: true, reason: 'owner-release' };
    }
    return { released: false, reason: marker ? 'not-owner' : 'no-marker' };
  } finally {
    release();
  }
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
  MAX_SPAWN_AGE_MS_DEFAULT,
};
