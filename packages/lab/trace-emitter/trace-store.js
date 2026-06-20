'use strict';

// ③.1-W2a — the per-run JSONL timeline store for the F7 trace-emitter. One file per run
// (`<run_id>.jsonl`) under LAB_STATE_BASE/trace-timeline — a trace is an ordered append
// stream, so replay = read-in-order and cross-run diff = a two-file compare (NOT the
// content-addressed one-file-per-node idiom, which is for dedup'd nodes). All SHADOW.
//
// APPEND COST + CONCURRENCY (RESOLVED ③.2.0-C — was ARCH NOTE-6 + VALIDATE H2, deferred at ③.1):
// the append is fs.appendFileSync (O(1)); seq is now assigned in O(1) from a per-run COUNTER SIDECAR
// (`<run>.jsonl.seq`) instead of the old O(n) whole-file nextSeq() re-scan (which made a long run
// O(n^2)). And seq assignment + the append run UNDER a per-run withLockSoft (`<run>.jsonl.lock`), so
// concurrent same-run_id emitters can no longer COLLIDE on seq (or interleave a torn line) — the ③.1
// W4 deferral, closed at beta scale. nextSeq() survives ONLY as the legacy recovery path (a
// counter-less timeline pays one O(n) scan, then the counter takes over). The counter is RESERVED
// (bumped) BEFORE the append, so a crash leaves a benign seq GAP, never a collision. SHADOW/best-
// effort: withLockSoft (not withLock) — a lock-timeout drops the trace (TRACE_LOCK_TIMEOUT), never a
// process.exit; a dropped trace degrades observability, never corrupts (library-catalog.js's posture).
//
// PRIVACY (VALIDATE H1): the digest fields (inputs_digest/outputs_digest) are the ENFORCED
// boundary (the schema rejects non-hex). state_delta/attrs are FREE-FORM bags the store does
// NOT scan — a caller MUST digest()/scrub raw content BEFORE passing it. The privacy
// guarantee is digest-fields-ONLY, NOT absolute. W4 (real stranger-repo content) MUST add a
// pre-persist scrub of these bags (the ③.0-W2 secret-scrub factory) before real content flows.
//
// FILE WRITES: fs.appendFileSync (NOT writeAtomicString — that rewrites the whole file,
// defeating the O(1) append). The 0700 dir is the containment (foreign-uid cannot plant
// inside it); a SAME-uid symlink-plant of a run file is the conceded container-tier residual
// (consistent with the #345 same-uid concession).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { isSafePathSegment } = require('../../kernel/_lib/path-canonicalize');
const { deepFreeze } = require('../../kernel/_lib/deep-freeze');
const { withLockSoft } = require('../../kernel/_lib/lock');
const { validateTraceRecord } = require('./trace-schema');

const LAB_STATE_BASE = process.env.LOOM_LAB_STATE_DIR || path.join(os.homedir(), '.claude', 'lab-state');
const TIMELINE_SUBDIR = 'trace-timeline';
const DIR_MODE = 0o700;

function timelineDir(opts) {
  return (opts && opts.dir) || path.join(LAB_STATE_BASE, TIMELINE_SUBDIR);
}

/**
 * CWE-22 guard (#215 lesson): run_id flows into a filename, so reject any traversal /
 * separator / NUL on the RAW segment BEFORE path.join collapses `..`. Throws on unsafe.
 * @param {string} runId
 */
function assertSafeRunId(runId) {
  if (!isSafePathSegment(runId)) {
    const e = new Error(`unsafe run_id: ${JSON.stringify(runId)}`);
    e.code = 'UNSAFE_RUN_ID';
    throw e;
  }
}

function timelinePath(runId, opts) {
  assertSafeRunId(runId);
  return path.join(timelineDir(opts), `${runId}.jsonl`);
}

// LEGACY recovery only (③.2.0-C): scan the timeline to compute the next monotonic seq. O(n); used
// ONCE per run when the counter sidecar is absent (a pre-counter timeline), then the counter takes
// over. Returns 0 for a new/missing file. Malformed lines are skipped (no usable seq).
function nextSeq(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return 0; }
  let max = -1;
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      const r = JSON.parse(line);
      if (Number.isInteger(r.seq) && r.seq > max) max = r.seq;
    } catch { /* skip malformed line */ }
  }
  return max + 1;
}

// ③.2.0-C: the O(1) per-run seq counter sidecar (`<run>.jsonl.seq`) + the per-run lock path. Neither
// ends in `.jsonl`, so listRuns (which filters `.jsonl`) never mistakes them for a run.
function seqPathFor(file) { return `${file}.seq`; }
function lockPathFor(file) { return `${file}.lock`; }

// Read the next seq in O(1) from the counter; on an absent/corrupt counter (legacy timeline / first
// write) recover ONCE from the O(n) file scan. The reader NEVER trusts a counter that is BEHIND the
// file because appendTrace RESERVES (bumps) the counter before each append — so it is always >= the
// true max; a stale counter is therefore impossible UNDER THIS MODULE'S OWN WRITE PATH (a crash leaves
// it AHEAD, a benign gap). A manual/external edit of the .seq sidecar to a too-low value is OUTSIDE the
// stated SHADOW same-uid threat model (the documented symlink-plant concession) — it would re-issue a
// live seq; this module never does so itself.
function readSeqCounter(seqPath, file) {
  try {
    const n = parseInt(fs.readFileSync(seqPath, 'utf8').trim(), 10);
    if (Number.isInteger(n) && n >= 0) return n;
  } catch { /* absent/unreadable -> recover from the file scan below */ }
  return nextSeq(file);
}
let _SEQ_WRITE_FAILURE_LOGGED = false;
function writeSeqCounter(seqPath, next) {
  try {
    fs.writeFileSync(seqPath, String(next), { mode: 0o600 });
  } catch (e) {
    // best-effort: a scan recovers the seq next time. But if EVERY write fails (disk full / perm
    // change), the O(1) design silently degrades to O(n) — emit a one-time stderr notice so it is
    // diagnosable (the lock module's _SAB_FALLBACK_LOGGED pattern), without changing the soft-fail posture.
    if (!_SEQ_WRITE_FAILURE_LOGGED) {
      _SEQ_WRITE_FAILURE_LOGGED = true;
      try { process.stderr.write(`[trace-store] seq counter write failed; falling back to file scan: ${e && e.message}\n`); } catch { /* ignore */ }
    }
  }
}

/**
 * Append a COMPLETE trace record (schema_version/ts/component/event/... already set — the
 * traceEmit API fills those). Assigns seq if absent, validates against the frozen schema,
 * appends one JSONL line. Returns the deep-frozen stored record.
 * @param {object} record
 * @param {{dir?: string}} [opts]
 * @returns {object} the frozen stored record (with seq)
 */
function appendTrace(record, opts = {}) {
  const file = timelinePath(record.run_id, opts);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  // VALIDATE M3: mkdir does NOT tighten a pre-existing loose dir — chmod to 0700 so the
  // containment holds even if the base/subdir pre-existed group/world-traversable.
  try { fs.chmodSync(dir, DIR_MODE); } catch { /* best-effort tighten */ }
  const seqPath = seqPathFor(file);
  // ③.2.0-C: serialize seq-assignment + append under a per-run lock so concurrent same-run_id
  // emitters cannot collide on seq or interleave a torn line. SHADOW/best-effort (withLockSoft, no
  // process.exit). An INVALID_TRACE throw from fn() propagates (lock released by the finally).
  const r = withLockSoft(lockPathFor(file), () => {
    // O(1) from the counter (legacy timelines pay one O(n) scan). The store ALWAYS owns seq — a
    // caller-supplied seq could break the monotonic per-run contract; the spread overrides it.
    const seq = readSeqCounter(seqPath, file);
    const full = { ...record, seq };
    const v = validateTraceRecord(full);
    if (!v.ok) {
      const e = new Error(`invalid trace record: ${v.errors.join(',')}`);
      e.code = 'INVALID_TRACE';
      throw e; // counter NOT yet bumped + nothing appended -> seq is simply reused next time (no gap)
    }
    // RESERVE before append: a crash between the bump and the append leaves the counter AHEAD of the
    // file (a benign seq GAP), never BEHIND (which would re-issue a live seq -> collision).
    writeSeqCounter(seqPath, seq + 1);
    fs.appendFileSync(file, `${JSON.stringify(full)}\n`, { mode: 0o600 });
    return deepFreeze(full);
  });
  if (!r.ok) {
    const e = new Error(`trace append dropped under contention: ${r.reason}`);
    e.code = 'TRACE_LOCK_TIMEOUT';
    throw e;
  }
  return r.value;
}

/**
 * Read a run's timeline, ordered by seq, deep-frozen (read-path immutability — #266).
 * Malformed lines are skipped (a partial last write must not crash a replay). Missing
 * file → [].
 * @param {string} runId
 * @param {{dir?: string}} [opts]
 * @returns {ReadonlyArray<object>}
 */
function readTimeline(runId, opts = {}) {
  const file = timelinePath(runId, opts);
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return deepFreeze([]); }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; } // skip unparseable (partial last write)
    // VALIDATE M1: a line must be a plain object with an integer seq to participate in an
    // ordered replay — drop poisoned/partial lines (the write path enforces the full schema;
    // the read path stays version-tolerant but sortable, never NaN-sorting on a bad seq).
    if (!rec || typeof rec !== 'object' || Array.isArray(rec) || !Number.isInteger(rec.seq)) continue;
    out.push(rec);
  }
  // All seqs are integers here; V8 sort is stable → equal seqs keep on-disk APPEND order
  // (the canonical order under concurrent writers — see CONCURRENCY note above).
  out.sort((a, b) => a.seq - b.seq);
  return deepFreeze(out);
}

function listRuns(opts = {}) {
  const dir = timelineDir(opts);
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names
    .filter((n) => n.endsWith('.jsonl'))
    .map((n) => n.slice(0, -'.jsonl'.length))
    .sort();
}

module.exports = {
  LAB_STATE_BASE, TIMELINE_SUBDIR,
  timelineDir, timelinePath, assertSafeRunId,
  appendTrace, readTimeline, listRuns,
};
