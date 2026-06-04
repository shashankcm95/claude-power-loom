// @loom-layer: kernel
//
// v3.4 Wave 3 — the A6 hot-path snapshot reader (the 4th extract-to-leaf; canonical-json W0 ·
// recency-decay W2 · jsonl-read H1-deep · this). It is the kernel side of the §3.6 Lab→Kernel data
// contract: `spawn-record.js` (a PostToolUse:Agent close hook, <50ms p99) records the lab-materialized
// reputation snapshot into `axioms.evolution_snapshot.reputation` by reading it AS A FILE — never by
// importing the lab module (K12-clean; the mirror of W1's lab-reads-the-kernel-journal-as-data).
//
// This leaf is the SINGLE SOURCE OF TRUTH for the cross-layer contract, so the writer (lab
// materializer) and the reader (this) can never drift:
//   - resolveSnapshotPath()  — ONE path formula, imported by both sides (verify-plan CR-HIGH-2: a
//     writer/reader path split-brain is the highest-risk integration bug → silent permanent blind).
//   - snapshotHashBody/computeSnapshotHash — ONE hash basis, imported by both (verify-plan A-LOW-5,
//     the M1 forward-coupling class: a drift in which fields are hashed silently breaks verification).
//   - readEvolutionSnapshot — bounded, fail-open, and SELF-VERIFYING (INV-22: never trust a
//     self-asserted hash — recompute + compare). It MUST NEVER throw (the spawn hot path is
//     fail-soft per ADR-0001) and MUST NOT read the ledger (O(1) w.r.t. attestation volume).

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { canonicalJsonSerialize } = require('./canonical-json');

const SNAPSHOT_FILENAME = 'reputation-snapshot.json';
// 256KB — bounds the HOT-PATH JSON.parse COST, not just the file size. A reputation distribution over
// ~18 personas is a few KB; 256KB is ~50× headroom yet caps JSON.parse at <10ms. The prior 1MB let a
// pathological 1MB file spend ~36ms in JSON.parse BEFORE canonicalJsonSerialize's node-cap could fire
// (the H1-deep "byte-bound gated the read STRATEGY not the parse COST" lesson, recurring one layer up —
// VALIDATE hacker HIGH-1, PROVED at p99 ~95ms / 2× the <50ms budget on the live close hook).
const DEFAULT_MAX_BYTES = 256 * 1024;
const HARD_MAX_BYTES = 1 * 1024 * 1024;    // 1MB ceiling on the env override (worst-case parse ~36ms < 50ms); also the H1-deep M-1 anti-disable clamp

// Read at call-time (not module-load) so the resolution is testable + reflects the live env on the
// single hot-path read.
function maxBytes() {
  const env = Number(process.env.LOOM_SNAPSHOT_MAX_BYTES);
  if (Number.isFinite(env) && env > 0) return Math.min(env, HARD_MAX_BYTES);
  return DEFAULT_MAX_BYTES;
}

/**
 * The ONE path formula both the lab materializer and the kernel reader use. A divergence here would
 * make every spawn record `{present:false}` silently forever (verify-plan CR-HIGH-2).
 *   LOOM_EVOLUTION_SNAPSHOT_PATH (explicit) > ${LOOM_LAB_STATE_DIR || ~/.claude/lab-state}/<file>
 */
function resolveSnapshotPath() {
  const explicit = process.env.LOOM_EVOLUTION_SNAPSHOT_PATH;
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  const base = process.env.LOOM_LAB_STATE_DIR || path.join(os.homedir(), '.claude', 'lab-state');
  return path.join(base, SNAPSHOT_FILENAME);
}

/**
 * The canonical body to content-hash: every field EXCEPT content_hash (no self-reference). Object
 * REST-spread uses define-semantics, so a hostile top-level `__proto__` key is copied as an OWN data
 * property (NOT a prototype set) and is faithfully hashed (verify-plan A-LOW-4).
 */
function snapshotHashBody(snap) {
  if (!snap || typeof snap !== 'object' || Array.isArray(snap)) return {};
  const body = { ...snap }; // spread = define-semantics → a hostile `__proto__` own-key is preserved, not a prototype set
  delete body.content_hash; // exclude the hash from its own basis (fresh copy → no shared-state mutation)
  return body;
}

function computeSnapshotHash(snap) {
  // canonicalJsonSerialize sorts keys recursively (stable hash despite insertion order) and is
  // depth/node-bounded (a pathological body throws a controlled TypeError — callers catch it).
  return crypto.createHash('sha256').update(canonicalJsonSerialize(snapshotHashBody(snap)), 'utf8').digest('hex');
}

function fail(reason) { return { present: false, reason }; }

/**
 * Read + validate the reputation snapshot. NEVER throws: every branch returns an object
 * ({present:true,...} | {present:false, reason}). O(1) w.r.t. attestation volume (reads only the
 * small snapshot file; never the ledger).
 *
 * @param {string|{path?:string}} [pathOrOpts] explicit path (else resolveSnapshotPath())
 */
function readEvolutionSnapshot(pathOrOpts) {
  let p;
  try {
    if (typeof pathOrOpts === 'string') p = pathOrOpts;
    else if (pathOrOpts && typeof pathOrOpts === 'object' && typeof pathOrOpts.path === 'string') p = pathOrOpts.path;
    else p = resolveSnapshotPath();
  } catch { return fail('absent'); }
  if (!p) return fail('absent');

  // Operate on a HANDLE, not a name (VALIDATE hacker MED — close the type-TOCTOU). statSync(path) then
  // readFileSync(path) has a window: if the regular file is swapped to a FIFO between the two calls,
  // readFileSync BLOCKS FOREVER → a hook HANG (worse than a crash, and the hook has no timeout). Instead
  // open ONE fd with O_NONBLOCK (so opening a FIFO/device returns immediately rather than blocking),
  // fstat the BOUND fd to confirm a regular file, then read from the fd. The fd is pinned to the inode
  // at open, so no post-open path swap can affect it. (Size-TOCTOU is moot — fstat is on the open fd.)
  const cap = maxBytes();
  let raw;
  let fd;
  try {
    fd = fs.openSync(p, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0));
  } catch { return fail('absent'); }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return fail('absent'); // FIFO/dir/device/symlink-to-nonfile → absent, no blocking read
    if (st.size > cap) return fail('oversized');
    raw = fs.readFileSync(fd, 'utf8'); // regular file → reads to EOF; O_NONBLOCK is a no-op for regular files
  } catch {
    return fail('absent');
  } finally {
    try { fs.closeSync(fd); } catch { /* best-effort */ }
  }
  if (Buffer.byteLength(raw, 'utf8') > cap) return fail('oversized');

  let parsed;
  try { parsed = JSON.parse(raw); } catch { return fail('unparseable'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('malformed');

  // shape-normalize: the load-bearing fields must be present + well-typed.
  const shapeOk = typeof parsed.content_hash === 'string'
    && typeof parsed.source === 'string'
    && typeof parsed.generated_at === 'string'
    && Array.isArray(parsed.personas);
  if (!shapeOk) return fail('malformed');

  // SELF-VERIFY the content-hash (INV-22). A bounded-throw from canonicalJsonSerialize (a pathological
  // sub-1MB body) → fail-open hash-error, never an uncaught throw on the hot path.
  let recomputed;
  try { recomputed = computeSnapshotHash(parsed); } catch { return fail('hash-error'); }
  if (recomputed !== parsed.content_hash) return fail('hash-mismatch');

  const watermark = (parsed.watermark && typeof parsed.watermark === 'object' && !Array.isArray(parsed.watermark))
    ? parsed.watermark : {};
  return {
    present: true,
    content_hash: parsed.content_hash,
    generated_at: parsed.generated_at,
    source: parsed.source,
    watermark,
    value: parsed.personas, // the bounded per-persona distribution; spawn-record byte-caps the inline copy
    truncated: false,
  };
}

module.exports = {
  resolveSnapshotPath,
  snapshotHashBody,
  computeSnapshotHash,
  readEvolutionSnapshot,
  SNAPSHOT_FILENAME,
  DEFAULT_MAX_BYTES,
  HARD_MAX_BYTES,
};
