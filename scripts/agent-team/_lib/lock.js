// Shared file-lock primitive for HETS scripts. Closes 2 CS-1 CRITs in one
// place: kb-resolver + budget-tracker concurrency hazards (per CS-1
// orch-code recommendation #1).
//
// Extraction note: this code was originally inline in agent-identity.js
// (since H.2-bridge) and pattern-recorder.js (since H.1, slight variant).
// H.3.2 unifies both copies + applies the wrapper to 3 more scripts that
// were doing read-modify-write without locks (kb-resolver, budget-tracker,
// tree-tracker — flagged by code-reviewer.nova X-3 in CS-1).
//
// Usage:
//   const { withLock } = require('./_lib/lock');
//   withLock(LOCK_PATH, () => {
//     const data = readStore();
//     data.someField += 1;
//     writeStore(data);
//   });
//
// Stale-lock recovery: if the lock file holds a PID that's no longer alive,
// the wait loop unlinks it and retries. Same logic as the original
// agent-identity implementation.
//
// HT.2.3 (drift-note 75): acquireLock auto-creates the lockfile parent dir
// via `fs.mkdirSync({ recursive: true })` per substrate's lazy-mkdir
// convention (session-end-nudge.js:62 + saveState:125 + pattern-recorder.js:49
// precedents). Closes the opaque-3-sec-timeout-on-ENOENT failure mode that
// HT.1.14 test 77 ephemeral-tmpdir fixture surfaced. Transparent for all
// 10 current production consumers (whose parent dirs are pre-created at
// install); enables future ephemeral-tmpdir tests to "just work".
//
// H.9.10 (closes drift-note candidate referenced at H.9.7 L70 comment): wait
// loop migrated from busy-wait spin (CPU-burning Date.now() < end) to
// Atomics.wait true-sleep (synchronous OS-level sleep; zero CPU usage during
// wait; same wall-clock elapsed). Per architect FLAG-1 + code-reviewer
// HIGH-CR1 convergent absorption: try/catch around SharedArrayBuffer
// construction + busy-wait fallback (preserves ADR-0001 fail-soft contract
// for 2 hook consumers under exotic Node runtime configurations); NaN-guard
// on sleepMs (Atomics.wait(NaN) blocks forever per ECMA-262 §25.4.5; current
// busy-wait silently no-ops; bounds-check preserves no-hang behavior).
// SharedArrayBuffer is REQUIRED by Atomics.wait's type contract; substrate
// does NOT share buffer cross-thread (each worker_threads import gets own
// SAB via per-thread module cache). 12 FLAGs absorbed at H.9.10 gate.

const fs = require('fs');
const path = require('path');

// H.9.10 architect FLAG-1 absorption: try/catch around SharedArrayBuffer
// construction. If SAB unavailable (memory-constrained env, --no-shared-
// array-buffer flag, hardened runtime), module load MUST NOT fail (would
// break all 15 consumers including 2 hook fail-soft consumers per ADR-0001).
// _WAIT_INT32 stays null as fallback signal; _waitSleep handles fallback path.
let _WAIT_INT32 = null;
try {
  const _WAIT_SAB = new SharedArrayBuffer(4);
  _WAIT_INT32 = new Int32Array(_WAIT_SAB);
} catch {
  // SAB unavailable; _waitSleep below falls back to busy-wait.
}
// architect FLAG-3 absorption: log unexpected Atomics.wait return-values
// once per process for defense-in-depth observability (ADR-0001 invariant 3).
let _UNEXPECTED_WAIT_RESULT_LOGGED = false;
let _SAB_FALLBACK_LOGGED = false;

// H.9.10: shared sleep primitive used by acquireLock wait loop. Encapsulates:
// (a) code-reviewer HIGH-CR1 LIVE BUG absorption: NaN/zero/negative sleepMs
//     guard (Atomics.wait(NaN) blocks forever; falls back to safeSleepMs=50);
// (b) architect FLAG-1 happy path: Atomics.wait true-sleep on SharedArrayBuffer;
// (c) architect FLAG-1 fallback path: busy-wait if SAB unavailable;
// (d) architect FLAG-3 observability: log unexpected return values once.
function _waitSleep(sleepMs) {
  const safeSleepMs = (typeof sleepMs === 'number' && sleepMs > 0 && isFinite(sleepMs))
    ? sleepMs : 50;
  if (_WAIT_INT32) {
    const result = Atomics.wait(_WAIT_INT32, 0, 0, safeSleepMs);
    if (result !== 'timed-out' && result !== 'not-equal' && !_UNEXPECTED_WAIT_RESULT_LOGGED) {
      _UNEXPECTED_WAIT_RESULT_LOGGED = true;
      try {
        process.stderr.write(`[_lib/lock] unexpected Atomics.wait result: ${result}\n`);
      } catch { /* stderr write failed; ignore */ }
    }
    return;
  }
  // Fallback busy-wait when SAB unavailable (architect FLAG-1 absorption).
  if (!_SAB_FALLBACK_LOGGED) {
    _SAB_FALLBACK_LOGGED = true;
    try {
      process.stderr.write('[_lib/lock] SharedArrayBuffer unavailable; falling back to busy-wait\n');
    } catch { /* stderr write failed; ignore */ }
  }
  const end = Date.now() + safeSleepMs;
  while (Date.now() < end) { /* spin */ }
}

function acquireLock(lockPath, opts) {
  // HT.2.3: lazy parent-dir creation (drift-note 75) per substrate convention.
  // Recursive mode is idempotent fast-path when dir exists (sub-millisecond stat).
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const maxWaitMs = (opts && opts.maxWaitMs) || 3000;
  // H.9.21.2.1 v2.1.3: sleepMs default reduced 50ms → 20ms after T108 CI flake
  // post-v2.1.2 merge. Finer-grained polling means the lock-release-to-next-
  // acquire latency caps at ~20ms vs ~50ms. For 5-way contention this trims
  // worst-case cumulative wait from ~250ms (5 × 50ms scheduler slack) to
  // ~100ms. Combined with the library-catalog timeout bump (30000ms) this
  // gives ample margin on the slowest GitHub Actions runners while preserving
  // ADR-0001 fail-soft contract on the 2 hook consumers (error-critic +
  // session-end-nudge: their wait windows accommodate sub-100ms granularity).
  const sleepMs = (opts && opts.sleepMs) || 20;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      return true;
    } catch {
      // Stale lock recovery: if the locking pid is gone, take it over.
      // H.3.6 (CS-2 code-reviewer.jade C-1): the prior version only checked
      // `pid !== process.pid` and skipped cleanup when the lock holds the
      // current PID — but that's exactly the case where the prior incarnation
      // crashed and left a same-PID orphan; without unlink, the process
      // deadlocks against itself until timeout. Now: if pid === process.pid,
      // treat as stale (we'd never legitimately hold our own lock through
      // a fresh withLock() call) and reclaim.
      try {
        const pid = parseInt(fs.readFileSync(lockPath, 'utf8'), 10);
        if (Number.isNaN(pid) || !pid) {
          // Garbage in lock file → assume corrupt + reclaim
          try { fs.unlinkSync(lockPath); } catch { /* race: another process won the reclaim */ }
          continue;
        }
        if (pid === process.pid) {
          // Self-PID orphan from a prior incarnation — reclaim
          try { fs.unlinkSync(lockPath); } catch { /* race: another reclaim won */ }
          continue;
        }
        try { process.kill(pid, 0); } // throws if pid is gone
        catch { try { fs.unlinkSync(lockPath); } catch { /* race: lock already reclaimed */ } continue; }
      } catch { /* lock disappeared between check and read */ }
      // H.9.10: Atomics.wait true-sleep replaces H.9.7 busy-wait spin loop.
      // _waitSleep encapsulates NaN-guard (code-reviewer HIGH-CR1) + happy
      // path (Atomics.wait on shared int32) + fallback path (busy-wait if
      // SAB unavailable per architect FLAG-1) + observability (architect
      // FLAG-3). Wall-clock-elapsed invariant preserved (Test 79 + Test 85
      // timing windows accommodate ~1-2ms OS scheduler granularity per
      // iteration; ~60-120ms accumulated drift over worst-case 60 iterations
      // per architect LOW-8).
      _waitSleep(sleepMs);
    }
  }
  return false;
}

function releaseLock(lockPath) {
  try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
}

// Convenience wrapper that acquires + runs + releases. Exits with code 2
// if lock cannot be acquired within timeout (matches the original
// agent-identity behavior).
function withLock(lockPath, fn, opts) {
  if (!acquireLock(lockPath, opts)) {
    console.error(`Could not acquire lock at ${lockPath} within ${(opts && opts.maxWaitMs) || 3000}ms. Aborting.`);
    process.exit(2);
  }
  try { return fn(); } finally { releaseLock(lockPath); }
}

module.exports = { acquireLock, releaseLock, withLock };
