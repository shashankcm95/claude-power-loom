'use strict';

// @loom-layer: kernel
//
// _lib/sleep.js — the synchronous, timer-free sleep primitive (F-W2 DRY extraction).
//
// EXTRACTION NOTE (code-reviewer PRINCIPLE/DRY): this is the SharedArrayBuffer + Atomics.wait
// core lifted VERBATIM out of _lib/lock.js's `_waitSleep` (H.9.10). It already solves three
// things a hand-rolled second copy would get wrong:
//   (a) NaN/zero/negative guard — `Atomics.wait(NaN)` blocks FOREVER (ECMA-262 §25.4.5), so a
//       bad duration is clamped to a safe default instead of hanging the process.
//   (b) SAB-unavailable fallback — a memory-constrained env / `--no-shared-array-buffer` /
//       hardened runtime cannot construct a SharedArrayBuffer; the try/catch at load leaves
//       `_WAIT_INT32` null and `sleepSync` falls back to a bounded busy-wait (never a load-fail,
//       preserving the ADR-0001 fail-soft contract for the hook consumers of lock.js).
//   (c) once-per-process observability of the two exceptional branches (an unexpected
//       Atomics.wait return; the SAB fallback), so a degraded runtime is diagnosable without
//       spamming stderr.
//
// F-W2 uses this as the DEFAULT `sleep` for ghEmit's bounded fork-readiness poll (the wait is
// injectable so tests drive the 404-then-200 path with ZERO real waiting). lock.js imports it
// too, so there is a SINGLE Atomics.wait implementation (no drift between two copies).
//
// SharedArrayBuffer is REQUIRED by Atomics.wait's type contract; the substrate does NOT share
// the buffer cross-thread (each worker_threads import gets its own SAB via the per-thread module
// cache). Node core only — zero deps.

// try/catch around SharedArrayBuffer construction: if SAB is unavailable, module load MUST NOT
// fail (that would break every consumer, including lock.js's fail-soft hook consumers per
// ADR-0001). `_WAIT_INT32` stays null as the fallback signal; sleepSync handles the fallback.
let _WAIT_INT32 = null;
try {
  const _WAIT_SAB = new SharedArrayBuffer(4);
  _WAIT_INT32 = new Int32Array(_WAIT_SAB);
} catch {
  // SAB unavailable; sleepSync below falls back to busy-wait.
}
let _UNEXPECTED_WAIT_RESULT_LOGGED = false;
let _SAB_FALLBACK_LOGGED = false;

// M-2 (hacker VALIDATE) — a hard defense-in-depth ceiling so this SHARED primitive cannot hang the process on a
// large FINITE `ms` from a FUTURE caller. The sole current caller (gh-emit's fork-readiness backoff) already caps
// at 20s, but the guarantee must live IN the primitive, not only at the call site.
const MAX_SLEEP_MS = 60000;

/**
 * Synchronously sleep for `ms` milliseconds with ZERO CPU usage (Atomics.wait true-sleep) on the
 * happy path, falling back to a bounded busy-wait when SharedArrayBuffer is unavailable. A
 * NaN/zero/negative/non-finite `ms` is clamped to a safe 50ms (Atomics.wait(NaN) would block
 * forever); a large finite `ms` is capped at MAX_SLEEP_MS (M-2). PURE of timers/Date-based polling
 * on the happy path.
 * @param {number} ms  milliseconds to sleep (clamped to a safe default when invalid; capped at MAX_SLEEP_MS)
 */
/**
 * Clamp a requested `ms` to a safe, bounded wait. PURE (testable without a real wait): a NaN/zero/negative/
 * non-finite `ms` => 50ms (Atomics.wait(NaN) would block forever); a large finite `ms` => MAX_SLEEP_MS (M-2).
 * @param {number} ms
 * @returns {number} the clamped milliseconds
 */
function clampSleepMs(ms) {
  return Math.min((typeof ms === 'number' && ms > 0 && isFinite(ms)) ? ms : 50, MAX_SLEEP_MS);
}

function sleepSync(ms) {
  const safeMs = clampSleepMs(ms);
  if (_WAIT_INT32) {
    const result = Atomics.wait(_WAIT_INT32, 0, 0, safeMs);
    if (result !== 'timed-out' && result !== 'not-equal' && !_UNEXPECTED_WAIT_RESULT_LOGGED) {
      _UNEXPECTED_WAIT_RESULT_LOGGED = true;
      try {
        process.stderr.write(`[_lib/sleep] unexpected Atomics.wait result: ${result}\n`);
      } catch { /* stderr write failed; ignore */ }
    }
    return;
  }
  // Fallback busy-wait when SAB unavailable (never a load-fail; bounded by safeMs).
  if (!_SAB_FALLBACK_LOGGED) {
    _SAB_FALLBACK_LOGGED = true;
    try {
      process.stderr.write('[_lib/sleep] SharedArrayBuffer unavailable; falling back to busy-wait\n');
    } catch { /* stderr write failed; ignore */ }
  }
  const end = Date.now() + safeMs;
  while (Date.now() < end) { /* spin */ }
}

module.exports = { sleepSync, clampSleepMs, MAX_SLEEP_MS };
