'use strict';

// @loom-layer: lab
//
// ③.1-W2b — the close-path INGESTER (the F7 consumer; ARCH-PC-4 capture mechanism).
// K12-clean: the kernel JOURNALS its close-path timing to the spawn-state journal; this lab
// module READS that journal (lab→kernel-data read, allowed) and folds it into the F7 timeline
// as component:'close-path' records. No kernel import, no kernel edit. All SHADOW.
//
// CROSS-TIER COUPLING (architect VERIFY Finding 2 — a known, documented contract): this
// reads the kernel's `resolver-journal-<agentId>.jsonl` entry shapes:
//   - kind 'shadow-resolver-verdict'   (ALWAYS): duration = status_git_ms  (legacy alias:
//     k14_git_ms — RENAMED at ③.0-W1; we read `status_git_ms ?? k14_git_ms` so both old +
//     new journals fold) → event 'status-git'.
//   - kind 'shadow-provenance-record'  (COMMITTED-only): duration = producer_git_ms → event
//     'producer-git'. A non-COMMITTED close emits 'shadow-provenance-skipped' (NO producer
//     duration — legitimately absent, not an anomaly).
// If the kernel renames a FIELD again, a duration-bearing entry missing its field is counted
// as `skipped` (a LOUD signal — the caller/CLI surfaces it), never a silent empty timeline.

const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('./trace-store');
const { traceEmit } = require('./index');

const SPAWN_STATE_BASE = process.env.LOOM_SPAWN_STATE_DIR || path.join(os.homedir(), '.claude', 'spawn-state');
const JOURNAL_RE = /^resolver-journal-.*\.jsonl$/;
const MAX_SPAWN_ID_LEN = 128; // a real spawn_id is a ~17-char agentId hash; bound the copy (VALIDATE H2).

// Bound spawn_id before it enters the timeline attrs (VALIDATE H2): accept only a non-empty
// string within the length cap, else null. Closes object-injection (a non-string journal
// spawn_id) + the oversize-DoS (a multi-MB spawn_id). The FULL content-scrub of attrs (the
// ③.0-W2 secret-scrub factory, for a same-uid attacker-planted token) is the W4 carry.
function safeSpawnId(v) {
  return (typeof v === 'string' && v.length > 0 && v.length <= MAX_SPAWN_ID_LEN) ? v : null;
}

// Emit ONE close-path record; returns true on success, false if traceEmit rejected it.
// The try/catch is the batch-isolation guard (VALIDATE H1): a single bad entry degrades to a
// skip — it must NEVER throw out of the loop and abort the whole batch (which would also
// leave a partial, non-idempotent timeline).
function emitClosePath(traceRunId, event, durMs, entry, dir) {
  try {
    traceEmit({
      run_id: traceRunId,
      component: 'close-path',
      event,
      dur_ms: durMs,
      attrs: { spawn_id: safeSpawnId(entry.spawn_id), source_kind: entry.kind },
    }, { dir });
    return true;
  } catch {
    return false; // a schema/validator divergence degrades to skipped, never aborts the batch
  }
}

// A valid close-path duration matches the schema: a non-negative integer (ms).
function validDuration(v) {
  return Number.isInteger(v) && v >= 0 ? v : null;
}

/**
 * Fold a kernel run's close-path journal timings into the F7 timeline.
 *
 * @param {object} args
 * @param {string} args.kernelRunId  the spawn-state run subdir (sha256(session_id)[:16]).
 * @param {string} args.traceRunId   the F7 run_id to emit close-path records into.
 * @param {string} [args.spawnStateDir] override the spawn-state base (test seam).
 * @param {string} [args.dir]         override the F7 timeline dir (test seam, passed to traceEmit).
 * @returns {{emitted: number, skipped: number, entriesSeen: number, files: number}}
 *   `skipped` > 0 signals a coupling break (a duration-bearing entry was unparseable or
 *   missing/invalid its duration field) — the caller MUST surface it. BLIND SPOT (accepted):
 *   a KIND rename (e.g. `shadow-resolver-verdict`→X) is indistinguishable by counts from a
 *   legitimate no-duration-only run (both: emitted=0, skipped=0) — only a FIELD rename is
 *   detectable (via the `status_git_ms ?? k14_git_ms` fallback + the `skipped` count). So the
 *   loud signal is `skipped > 0`, NOT `emitted === 0` (which false-positives on a run that
 *   ended with only skipped/error closes — VALIDATE F1).
 */
function ingestClosePath({ kernelRunId, traceRunId, spawnStateDir, dir } = {}) {
  // CWE-22 (#215): both ids flow into a path — guard the raw segment before any join.
  store.assertSafeRunId(traceRunId);
  store.assertSafeRunId(kernelRunId);

  const runDir = path.join(spawnStateDir || SPAWN_STATE_BASE, kernelRunId);
  let files;
  // .sort() — readdirSync order is not guaranteed; sort so cross-file ingestion order (and
  // thus the assigned seq) is deterministic across environments (VALIDATE ingest:87).
  try { files = fs.readdirSync(runDir).filter((n) => JOURNAL_RE.test(n)).sort(); }
  catch { return { emitted: 0, skipped: 0, entriesSeen: 0, files: 0 }; }

  let emitted = 0;
  let skipped = 0;
  let entriesSeen = 0;

  for (const name of files) {
    let raw;
    // An unreadable journal file (perms/race) is SILENT data loss — surface it as a skip
    // (the loud signal) rather than silently dropping the whole file (VALIDATE ingest:97).
    try { raw = fs.readFileSync(path.join(runDir, name), 'utf8'); } catch { skipped += 1; continue; }
    for (const line of raw.split('\n')) {
      if (!line) continue;
      entriesSeen += 1;
      let e;
      try { e = JSON.parse(line); } catch { skipped += 1; continue; }
      if (!e || typeof e !== 'object' || Array.isArray(e)) { skipped += 1; continue; }

      if (e.kind === 'shadow-resolver-verdict') {
        // status_git_ms (current) ?? k14_git_ms (pre-③.0-W1 alias); must be a non-neg int.
        const dur = validDuration(e.status_git_ms) ?? validDuration(e.k14_git_ms);
        if (dur === null) { skipped += 1; continue; } // a verdict with NO valid duration = coupling break / garbage
        if (emitClosePath(traceRunId, 'status-git', dur, e, dir)) emitted += 1; else skipped += 1;
      } else if (e.kind === 'shadow-provenance-record') {
        const dur = validDuration(e.producer_git_ms);
        if (dur === null) { skipped += 1; continue; } // a provenance-record should carry a valid producer_git_ms
        if (emitClosePath(traceRunId, 'producer-git', dur, e, dir)) emitted += 1; else skipped += 1;
      }
      // else: a non-duration kind (shadow-provenance-skipped/-error, resolver audit records,
      // INV-20 ABORTED, ...) — legitimately no close-path duration; ignored, NOT an anomaly.
    }
  }
  return { emitted, skipped, entriesSeen, files: files.length };
}

module.exports = { ingestClosePath, SPAWN_STATE_BASE };
