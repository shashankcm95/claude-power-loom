'use strict';

// packages/kernel/spawn-state/recovery-sweep.js
//
// PR-4b INTEGRATION — the crash-recovery half of the K9↔K14 hand-off. Reclassifies
// orphan PENDING spawn records (crash-mid-spawn: an intent recorded but never
// committed) to ABORTED, holding the K13 serial lock across the WHOLE critical
// section so a background subprocess that outlived the spawn cannot write into the
// recovery window (ADR-0011 §sweep-timeout / §F3 — TOCTOU close).
//
// The (a)→(c) critical section, lock held throughout:
//   (a) scan the WAL for orphan PENDING records (PENDING with no later ABORTED/
//       COMMITTED record for the same spawn_id)
//   (b) per-spawn filesystem-hash compute (the TOCTOU-protected window)
//   (c) emit an ABORTED record + fsync (durable before admission re-opens)
//
// LOAD-BEARING INVARIANTS (the test contract):
//   - F3 lock discipline: acquireLock ONCE before (a), releaseLock ONCE after (c)
//     — never release-then-more-work (that reopens the TOCTOU window). The lock is
//     held while step-(b) runs.
//   - INV-A9-RecoverySweepIdempotent: walking the WAL twice yields a BYTE-IDENTICAL
//     WAL. An orphan that already has an ABORTED record is skipped — the sweep
//     never double-aborts. (Idempotency via natural-key dedupe on spawn_id —
//     kb:architecture/crosscut/idempotency pattern 1: a second run is a no-op.)
//   - FAIL-CLOSED step-(b): a per-spawn hash failure SKIPS that spawn (it stays
//     PENDING — NEVER a forged ABORTED) + a Class-4 hash-compute-error names it +
//     the sweep CONTINUES (one failure does not abort the whole sweep). The
//     sibling whose hash succeeded still gets its ABORTED record. skipped_count
//     is reported.
//   - sweep-timeout (LOOM_SWEEP_LOCK_TIMEOUT_MS, injected as sweepTimeoutMs):
//     when (a)→(c) exceeds the budget, admission REMAINS BLOCKED (correctness over
//     liveness) + a Class-4 sweep-timeout-operator-alert is emitted; the K13 lock
//     is RELEASED regardless (avoid permanent deadlock).
//   - force-admit (LOOM_FORCE_ADMIT_AFTER_SWEEP_TIMEOUT, injected as
//     forceAdmitAfterTimeout): a Class-4 record carries the blast radius
//     { kind:'recovery-sweep-force-admit', pending_spawn_count, pending_spawn_ids[],
//       sweep_elapsed_ms, sweep_timeout_ms } — the highest-severity unblock needs
//     the full blast-radius surface, not a bare "same pattern as K10".
//
// F23 — clock + timeout + lock are INJECTABLE seams (nowMsFn / sweepTimeoutMs /
// acquireLockFn / releaseLockFn); NO env-var trigger inside the pure path. A
// main()/hook entry MAY seed defaults from env, but the unit-under-test is pure.
// Immutability: builds NEW records; never mutates a scanned record in place.

const fs = require('fs');
const k9 = require('../_lib/k9-promote-deltas');
const { appendWalRecord } = require('../_lib/wal-append');

const DEFAULT_SWEEP_TIMEOUT_MS = 30000;

// §canonical-resolver-table crash-domain dispositions — kept as an exported,
// frozen, inspectable map (mirroring the resolver's RESOLVER_TABLE) so the crash
// spine the ADR calls the table's backbone is enumerable as DATA, not buried in
// inline string literals. A test serializes this and asserts the ADR dispositions
// are present; a rename of an audit-kind is then caught by a data-table assertion
// rather than passing silently. NOTE: the ADR's tail-elapsed-at-crash distinction
// (`sweep-aborted` vs `sweep-aborted-final`) is collapsed here — the v3.0-alpha
// sweep cannot observe crash-time tail state; the orchestrator's §reconcile-as-
// phase step records that ADR-vs-impl divergence (the table-is-split-across-two-
// modules reality the architect-lens flagged).
const SWEEP_DISPOSITIONS = Object.freeze({
  ORPHAN_PENDING: 'recovery-sweep-orphan-pending', // (b)+(c) ABORTED reclassification
  HASH_COMPUTE_ERROR: 'hash-compute-error', // fail-closed skip (stays PENDING)
  WAL_WRITE_ERROR: 'wal-write-error', // per-orphan isolated WAL-append failure
  ROLLBACK_ERROR: 'recovery-rollback-error', // journal-undo replay threw
  ROLLBACK_INVALID_SHA: 'recovery-rollback-invalid-sha', // tampered promoted_sha rejected
  LOCK_UNAVAILABLE: 'sweep-lock-unavailable',
  FORCE_ADMIT: 'recovery-sweep-force-admit',
  TIMEOUT_ALERT: 'sweep-timeout-operator-alert',
});
const SWEEP_ABORT_REASON = SWEEP_DISPOSITIONS.ORPHAN_PENDING;

/**
 * Read all JSONL records from a WAL, tolerating a torn final line (crash mid
 * append — the un-terminated tail is discarded, never fatal). Returns [] when the
 * WAL is absent.
 */
function readWalRecords(walPath) {
  let raw;
  try { raw = fs.readFileSync(walPath, 'utf8'); } catch { return []; }
  if (raw.length === 0) return [];
  const lines = raw.split('\n');
  const lastIsTorn = !raw.endsWith('\n');
  const records = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0) continue;
    if (i === lines.length - 1 && lastIsTorn) continue; // discard the torn tail
    try { records.push(JSON.parse(line)); } catch { /* skip corrupt line */ }
  }
  return records;
}

// WAL append uses the shared _lib/wal-append primitive (INV-19 read-modify-rewrite
// append; durability via the atomic tmp+rename). The sweep calls it FAIL-HARD (the
// default — no failSoft) so a write failure surfaces as a throw the per-orphan
// guard in processOrphan isolates (one orphan's WAL failure must not abandon the
// remaining orphans). kb:architecture/crosscut/single-responsibility — the resolver
// uses the SAME utility with failSoft:true; the two failure contracts live in one
// place.

/**
 * The set of spawn_ids that already have a terminal (ABORTED or COMMITTED) record
 * in the WAL — those are already resolved and MUST NOT be re-processed (INV-A9
 * idempotency dedupe key).
 */
function resolvedSpawnIds(records) {
  const resolved = new Set();
  for (const r of records) {
    if (!r || typeof r.spawn_id !== 'string') continue;
    const outcome = r.commit_outcome || r.outcome;
    if (outcome === 'ABORTED' || outcome === 'COMMITTED') resolved.add(r.spawn_id);
  }
  return resolved;
}

/**
 * Scan for orphan PENDING records: a PENDING record whose spawn_id has no later
 * terminal (ABORTED/COMMITTED) record. De-duplicated by spawn_id (the first
 * PENDING wins) so a WAL with repeated PENDING lines for one spawn yields one
 * orphan. The returned orphans are the (a) result of the critical section.
 */
function scanOrphanPending(records) {
  const resolved = resolvedSpawnIds(records);
  const seen = new Set();
  const orphans = [];
  for (const r of records) {
    if (!r || typeof r.spawn_id !== 'string') continue;
    const outcome = r.commit_outcome || r.outcome;
    if (outcome !== 'PENDING') continue;
    if (resolved.has(r.spawn_id) || seen.has(r.spawn_id)) continue;
    seen.add(r.spawn_id);
    orphans.push(r);
  }
  return orphans;
}

/**
 * Fail-soft audit emit through the injected seam (ADR-0001 — audit never blocks).
 */
function emitAudit(auditFn, record) {
  if (typeof auditFn !== 'function') return;
  try { auditFn(record); } catch { /* audit never blocks the sweep */ }
}

/**
 * Build the ABORTED reclassification record for an orphan PENDING spawn. NEW
 * object (immutability) carrying the SAME spawn_id (INV-20 closure) + the verified
 * filesystem hash captured under the lock.
 */
function buildAbortedRecord(orphan, fsHash) {
  return {
    spawn_id: orphan.spawn_id,
    commit_outcome: 'ABORTED',
    outcome: 'ABORTED',
    abort_reason: SWEEP_ABORT_REASON,
    is_recovery_sweep: true, // F20 sentinel — a K9 pre-commit must skip the gate
    fs_hash: fsHash,
    worktree_root: orphan.worktree_root || null,
    resolved_at: new Date().toISOString(),
  };
}

/**
 * Process ONE orphan under the held lock: step-(b) hash, then step-(c) emit. A
 * hash failure is FAIL-CLOSED — the spawn is skipped (stays PENDING, never forged
 * ABORTED), a Class-4 hash-compute-error names it, and the caller continues.
 *
 * If the orphan had already PROMOTED a delta before crashing (carries a
 * promoted_sha), the undo is replayed via the K9 rollback executor (arg-array, no
 * shell) BEFORE the ABORTED record is written — the journal-consuming recovery path.
 *
 * @returns {{aborted: boolean, skipped: boolean}}
 */
function processOrphan(orphan, opts) {
  const hashFn = opts.hashSpawnFn;
  let fsHash;
  try {
    fsHash = typeof hashFn === 'function' ? hashFn(orphan) : null;
  } catch (err) {
    // FAIL-CLOSED: never forge an ABORTED on a hash failure. Skip + alert + go on.
    emitAudit(opts.auditFn, {
      class: 4,
      kind: 'hash-compute-error',
      spawn_id: orphan.spawn_id,
      reason: String((err && err.message) || err).slice(0, 200),
    });
    return { aborted: false, skipped: true };
  }

  // Journal-consuming undo: a crashed spawn that already promoted a delta must
  // have it reverted (arg-array via the K9 executor). The orphan PENDING records
  // the recovery-sweep normally sees never promoted, so this is a guarded path —
  // reached only when an orphan carries a hex promoted_sha.
  if (typeof orphan.promoted_sha === 'string' && orphan.promoted_sha.length > 0) {
    const rollback = typeof opts.rollbackPromotionFn === 'function'
      ? opts.rollbackPromotionFn
      : k9.rollbackPromotion;
    try {
      const res = rollback({
        worktreeRoot: orphan.worktree_root,
        promotedSha: orphan.promoted_sha,
        journalPath: opts.journalPath,
        runGitFn: opts.runGitFn,
      });
      // A tampered WAL whose promoted_sha fails the executor's hex guard is
      // REJECTED (no git runs) and returns { reverted:false, reason:'invalid-
      // promoted-sha' } WITHOUT throwing — convert that silent skip into an
      // observable Class-4 integrity event (STRIDE-T: WAL tampering). The CWE-78
      // injection is already blocked by the executor's pattern guard; this only
      // makes the rejection auditable.
      if (res && res.reverted === false && res.reason === 'invalid-promoted-sha') {
        emitAudit(opts.auditFn, {
          class: 4, kind: SWEEP_DISPOSITIONS.ROLLBACK_INVALID_SHA, spawn_id: orphan.spawn_id,
        });
      }
    } catch {
      // rollback failure is audited but does not block the ABORTED reclassification
      emitAudit(opts.auditFn, { class: 4, kind: SWEEP_DISPOSITIONS.ROLLBACK_ERROR, spawn_id: orphan.spawn_id });
    }
  }

  // (c) emit the ABORTED record. PER-ORPHAN ISOLATION: the WAL append is fail-hard
  // (it throws on a disk failure), so guard it HERE — a single orphan's WAL-write
  // failure must SKIP that orphan (it stays PENDING — never a forged ABORTED, and
  // never silently lost) and let the sweep CONTINUE so a sibling still aborts. The
  // same fail-closed shape as the hash-compute gate above.
  try {
    appendWalRecord(opts.walPath, buildAbortedRecord(orphan, fsHash));
    return { aborted: true, skipped: false };
  } catch (err) {
    emitAudit(opts.auditFn, {
      class: 4,
      kind: SWEEP_DISPOSITIONS.WAL_WRITE_ERROR,
      spawn_id: orphan.spawn_id,
      reason: String((err && err.message) || err).slice(0, 200),
    });
    return { aborted: false, skipped: true };
  }
}

/**
 * Run the recovery sweep. Acquires the K13 lock, scans + reclassifies orphan
 * PENDING records to ABORTED under the lock, releases the lock. Honors the
 * fail-closed hash contract, the idempotency dedupe, the sweep-timeout block, and
 * the force-admit blast-radius record. Never throws into the hook — returns a
 * structured result.
 *
 * @param {object} opts
 * @param {string} opts.walPath
 * @param {function} [opts.acquireLockFn]   () => boolean — K13 lock acquire seam
 * @param {function} [opts.releaseLockFn]   () => void
 * @param {function} [opts.hashSpawnFn]     (orphanRecord) => string — step-(b) fs hash
 * @param {function} [opts.nowMsFn]         () => number — injectable clock (F23)
 * @param {number}  [opts.sweepTimeoutMs]   critical-section budget (default 30000)
 * @param {boolean} [opts.forceAdmitAfterTimeout=false]  operator escape hatch (F23)
 * @param {function} [opts.auditFn]         Class-4 audit collector seam
 * @param {function} [opts.rollbackPromotionFn]  K9 rollback seam (journal-consuming undo)
 * @param {function} [opts.scanOverrideFn]  (F23) step-(a) override — (records) =>
 *        orphans[]; lets a unit test drive the orphan set directly so a step-(c)
 *        failure can be exercised independently of the WAL read. Defaults to the
 *        real scanOrphanPending; production callers never pass it.
 * @returns {{aborted_count: number, skipped_count: number, admissionBlocked: boolean, timedOut: boolean}}
 */
function runRecoverySweep(opts) {
  if (!opts || typeof opts !== 'object' || typeof opts.walPath !== 'string') {
    throw new Error('recovery-sweep.runRecoverySweep: { walPath } is required');
  }
  const acquire = typeof opts.acquireLockFn === 'function' ? opts.acquireLockFn : (() => true);
  const release = typeof opts.releaseLockFn === 'function' ? opts.releaseLockFn : (() => {});
  const nowMsFn = typeof opts.nowMsFn === 'function' ? opts.nowMsFn : Date.now;
  const sweepTimeoutMs = Number.isFinite(opts.sweepTimeoutMs) ? opts.sweepTimeoutMs : DEFAULT_SWEEP_TIMEOUT_MS;

  // Lock unavailable → cannot safely sweep. Fail-closed: admission blocked, no
  // work, no false ABORTED. (Nothing was held, so nothing to release.)
  if (!acquire()) {
    emitAudit(opts.auditFn, { class: 4, kind: SWEEP_DISPOSITIONS.LOCK_UNAVAILABLE });
    return { aborted_count: 0, skipped_count: 0, admissionBlocked: true, timedOut: false };
  }

  // ── Critical section (a)→(c): the lock is held from here until the single
  //    release in the finally block. No interleaved release (F3 TOCTOU close).
  let abortedCount = 0;
  let skippedCount = 0;
  let timedOut = false;
  let pendingSnapshot = [];
  const t0 = nowMsFn();
  try {
    // (a) scan for orphan PENDING records. scanOverrideFn (F23) lets a test drive
    // the orphan set directly so a step-(c) WAL-write failure can be isolated from
    // the WAL read; production never injects it (defaults to the real scan).
    const records = readWalRecords(opts.walPath);
    const orphans = typeof opts.scanOverrideFn === 'function'
      ? opts.scanOverrideFn(records)
      : scanOrphanPending(records);
    pendingSnapshot = orphans.map((o) => o.spawn_id);

    // force-admit blast-radius record (operator escape hatch): emit the full
    // pending surface the operator is unblocking past (ADR §sweep-timeout hardening).
    // DELIBERATELY emitted PRE-processing: the blast radius must report the FULL
    // pending set the operator is unblocking past, captured BEFORE any orphan is
    // reclassified out of it — a post-loop recount would shrink the reported radius
    // as orphans got ABORTED. `sweep_elapsed_ms` here is the elapsed-at-scan (near
    // zero); the timeout's own alert below carries the elapsed-at-timeout.
    if (opts.forceAdmitAfterTimeout === true) {
      emitAudit(opts.auditFn, {
        class: 4,
        kind: SWEEP_DISPOSITIONS.FORCE_ADMIT,
        pending_spawn_count: pendingSnapshot.length,
        pending_spawn_ids: pendingSnapshot.slice(),
        sweep_elapsed_ms: nowMsFn() - t0,
        sweep_timeout_ms: sweepTimeoutMs,
      });
    }

    // (b)+(c) per orphan: hash under the lock, then emit ABORTED (fail-closed).
    for (const orphan of orphans) {
      const res = processOrphan(orphan, opts);
      if (res.aborted) abortedCount += 1;
      if (res.skipped) skippedCount += 1;
    }

    // Timeout check: did the (a)→(c) section exceed the budget? (correctness over
    // liveness — admission stays blocked on timeout unless force-admit overrides.)
    if (nowMsFn() - t0 >= sweepTimeoutMs) {
      timedOut = true;
      emitAudit(opts.auditFn, {
        class: 4,
        kind: SWEEP_DISPOSITIONS.TIMEOUT_ALERT,
        sweep_elapsed_ms: nowMsFn() - t0,
        sweep_timeout_ms: sweepTimeoutMs,
        pending_spawn_count: pendingSnapshot.length,
      });
    }
  } finally {
    // (c)-exit: release the lock EXACTLY once — even on timeout (avoid permanent
    // deadlock) and even if a hash/emit threw past the per-orphan guard.
    release();
  }

  // On timeout, admission remains BLOCKED unless the operator force-admitted.
  const admissionBlocked = timedOut && opts.forceAdmitAfterTimeout !== true;

  return {
    aborted_count: abortedCount,
    skipped_count: skippedCount,
    admissionBlocked,
    timedOut,
  };
}

module.exports = {
  runRecoverySweep,
  // exported for inspection / reuse (no other production importer in v3.0-alpha)
  scanOrphanPending,
  readWalRecords,
  // the crash-domain disposition map (ADR §canonical-resolver-table spine), frozen
  // + enumerable so an audit-kind rename is caught by a data-table assertion.
  SWEEP_DISPOSITIONS,
};
