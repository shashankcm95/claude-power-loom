'use strict';

// ③.1-W2a — the per-run JSONL timeline store for the F7 trace-emitter. One file per run
// (`<run_id>.jsonl`) under LAB_STATE_BASE/trace-timeline — a trace is an ordered append
// stream, so replay = read-in-order and cross-run diff = a two-file compare (NOT the
// content-addressed one-file-per-node idiom, which is for dedup'd nodes). All SHADOW.
//
// APPEND COST (ARCH VERIFY NOTE-6): the line append is fs.appendFileSync (O(1), no
// whole-file rewrite), but nextSeq() reads the existing file to assign the monotonic seq
// (O(n) per append → O(n^2) reads over a long run). Fine at dry-run scale (hundreds of
// records). A future high-volume wave swaps nextSeq for an O(1) counter/header-tracked max;
// the append itself is already O(1).
//
// CONCURRENCY (VALIDATE H2): seq is monotonic for a SINGLE writer per run. Concurrent
// emitters to the SAME run_id race in nextSeq (read-max → append) and can COLLIDE on the
// seq integer. So the CANONICAL replay order is the on-disk APPEND order (appendFileSync is
// atomic per line at this size — no torn JSON), which readTimeline preserves via a STABLE
// seq sort (equal seqs keep append order). Strict monotonicity under concurrent writers (an
// atomic counter / per-run lock) is DEFERRED to W4, where the batch-runner's concurrency
// model is decided.
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

// Read the existing timeline to compute the next monotonic seq. Returns 0 for a new/missing
// file. Malformed lines are skipped (they cannot hold a usable seq). See APPEND COST above.
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
  // The store ALWAYS owns seq — a caller-supplied seq could duplicate / break the monotonic
  // per-run contract (CodeRabbit Major). The spread below overrides any incoming record.seq.
  const seq = nextSeq(file);
  const full = { ...record, seq };
  const v = validateTraceRecord(full);
  if (!v.ok) {
    const e = new Error(`invalid trace record: ${v.errors.join(',')}`);
    e.code = 'INVALID_TRACE';
    throw e;
  }
  fs.appendFileSync(file, `${JSON.stringify(full)}\n`, { mode: 0o600 });
  return deepFreeze(full);
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
