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
//
// v3.8b W2 — the A6 M1 PROVENANCE contract (integrity != authenticity): the content-hash
// self-verify above attests INTACT, not TRUSTWORTHY — the formula is public and the basis is the
// caller-chosen body, so a hand-written snapshot self-hashes to present:true. The WITNESS ledger
// makes provenance machine-checkable: materialize appends a whole-body content-addressed witness
// line (write-then-witness — a crash between the two leaves an UNWITNESSED snapshot, the
// fail-closed direction; re-materialize heals); verifySnapshotProvenance re-derives each row's
// witness_id (#273 — never trust a stored id) and matches content_hash. HONEST SCOPE: same-uid is
// BOTH a forge axis (a forger can append a coherent witness too) AND a denial axis (flooding the
// ledger past the bounded tail makes a legit snapshot read unwitnessed — over-halt; re-materialize
// heals); `witnessed` != authentic-beyond-same-uid (closes at the ContainerAdapter). The trail is
// an ORDER-of-materialize record (positional + append-stamped recorded_at) — body timestamps are
// honest-but-same-uid-forgeable. The hot path NEVER pays for this: the witness fns lazy-require
// their deps and readEvolutionSnapshot only verifies under the opt-in `verifyProvenance` flag
// (spawn-record.js calls it bare).

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

// ── The witness contract (v3.8b W2) ─────────────────────────────────────────────────────────────

const WITNESS_LEDGER_FILENAME = 'snapshot-provenance.jsonl';
const WITNESS_SCHEMA_VERSION = 'v1';
// Read cap == prune cap (VERIFY A-MED-3): a witness that survived the append-side prune is always
// inside the verify-side read window — the tail-window invariant. Witnesses are ~200B; 1024 ≈ 200KB.
const WITNESS_LEDGER_MAX_RECORDS = 1024;
const HEX64_RE = /^[0-9a-f]{64}$/;

// The ONE witness-path formula (the CR-HIGH-2 split-brain discipline, same as resolveSnapshotPath).
// Env read at call-time: LOOM_SNAPSHOT_WITNESS_PATH (explicit) > lab-state base + filename.
function resolveWitnessLedgerPath() {
  const explicit = process.env.LOOM_SNAPSHOT_WITNESS_PATH;
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  const base = process.env.LOOM_LAB_STATE_DIR || path.join(os.homedir(), '.claude', 'lab-state');
  return path.join(base, WITNESS_LEDGER_FILENAME);
}

// witness_id = sha256(canonical(body minus witness_id)) — the WHOLE body (#273): any mutated field
// breaks the id. NOT a field-pair basis (VERIFY A-HIGH-1: generated_at is inside the snapshot's
// hashed body — zero independent entropy + a caller-choosable timestamp made load-bearing; hacker
// H1: out-of-basis fields were mutable while the witness still vouched).
// spread = define-semantics → a hostile `__proto__` own-key is hashed faithfully, not set as a
// prototype (same prototype-safety as snapshotHashBody — VALIDATE code-reviewer CR-2).
function computeWitnessId(body) {
  const basis = { ...body };
  delete basis.witness_id;
  return crypto.createHash('sha256').update(canonicalJsonSerialize(basis), 'utf8').digest('hex');
}

// VALIDATE hacker H1 (HIGH): readJsonlBounded does statSync→readFileSync on a NAME — a FIFO planted
// at the witness path (or via LOOM_SNAPSHOT_WITNESS_PATH) returns a size then BLOCKS FOREVER on the
// read, hanging the v3.9 gate path / the CLI / materialize with no timeout. Apply this leaf's OWN
// handle discipline (the readEvolutionSnapshot FIFO defense): open O_NONBLOCK so a FIFO/device opens
// instantly, fstat the BOUND fd, and treat anything but a regular file as no-ledger. Returns null
// (caller maps to no-ledger/unwitnessed) or the bounded rows. Never throws / never blocks.
// (The shared readJsonlBounded chokepoint has the same pre-existing hang for every Lab store; a
// chokepoint fix is the named broader follow-up — this wave gates the paths IT introduces.)
function readWitnessRowsSafe(ledgerPath) {
  let fd;
  try {
    fd = fs.openSync(ledgerPath, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0));
  } catch { return null; } // absent / unopenable → no-ledger
  try {
    if (!fs.fstatSync(fd).isFile()) return null; // FIFO / dir / device / symlink-to-nonfile → no blocking read
  } catch { return null; } finally {
    try { fs.closeSync(fd); } catch { /* best-effort */ }
  }
  const { readJsonlBounded } = require('./jsonl-read'); // lazy (A-MED-2)
  return readJsonlBounded(ledgerPath, { maxRecords: WITNESS_LEDGER_MAX_RECORDS, name: 'snapshot-witness' });
}

/**
 * Append a materialize-witness line (write-then-witness: the caller writes the snapshot FIRST).
 * Locked RMW capped to the newest WITNESS_LEDGER_MAX_RECORDS; an identical witness_id dedups.
 * FAIL-SOFT: returns { ok:false, reason } rather than throwing (the materializer must not lose its
 * already-written snapshot to a witness failure — the operator re-runs).
 *
 * @param {object} input { content_hash (64-hex), generated_at, record_count?, now? }
 * @returns {{ok:boolean, witness_id?:string, deduped?:boolean, reason?:string}}
 */
function appendSnapshotWitness(input) {
  const o = input || {};
  if (typeof o.content_hash !== 'string' || !HEX64_RE.test(o.content_hash)) return { ok: false, reason: 'invalid-content-hash' };
  if (typeof o.generated_at !== 'string' || o.generated_at.length === 0) return { ok: false, reason: 'invalid-generated-at' };
  const recordCount = (typeof o.record_count === 'number' && Number.isFinite(o.record_count)) ? o.record_count : 0;
  const nowMs = (o.now !== undefined) ? new Date(o.now).getTime() : Date.now();
  if (!Number.isFinite(nowMs)) return { ok: false, reason: 'invalid-now' };
  const body = {
    schema_version: WITNESS_SCHEMA_VERSION,
    content_hash: o.content_hash,
    generated_at: o.generated_at,
    // LEDGER-APPLIED stamp (hacker M1): the body's generated_at is caller-chosen; this is the
    // append-time wall-clock. Inside the id basis (authenticated within the witness), but still
    // same-uid-forgeable at authoring time — file POSITION is the order signal.
    recorded_at: new Date(nowMs).toISOString(),
    record_count: recordCount,
  };
  const witnessId = computeWitnessId(body);
  const row = { witness_id: witnessId, ...body };

  // Writer-side deps are LAZY (VERIFY A-MED-2): this leaf loads on the <50ms spawn-close hook,
  // whose bare-read path must not pay the writer's module-load tax.
  const { acquireLock, releaseLock } = require('./lock');
  const { writeAtomicString } = require('./atomic-write');

  const ledger = resolveWitnessLedgerPath();
  const lockPath = `${ledger}.lock`;
  try { fs.mkdirSync(path.dirname(ledger), { recursive: true }); } catch { /* surfaced by the write below */ }
  if (!acquireLock(lockPath, { maxWaitMs: 2000 })) return { ok: false, reason: 'lock-contended' };
  try {
    // H1: the regular-file gate runs INSIDE the lock but is non-blocking (O_NONBLOCK+fstat), so a
    // FIFO at the ledger path can never hold the lock through a blocking read (hacker L1, subsumed).
    const rows = readWitnessRowsSafe(ledger) || [];
    if (rows.some((r) => r && r.witness_id === witnessId)) return { ok: true, witness_id: witnessId, deduped: true };
    const next = rows.concat([row]).slice(-WITNESS_LEDGER_MAX_RECORDS); // cap: keep the newest
    writeAtomicString(ledger, `${next.map((r) => JSON.stringify(r)).join('\n')}\n`);
    return { ok: true, witness_id: witnessId, deduped: false };
  } catch (e) {
    return { ok: false, reason: `append-failed: ${e && e.message ? e.message : String(e)}` };
  } finally {
    releaseLock(lockPath);
  }
}

/**
 * Was this snapshot's content_hash witnessed by a materialize event? Bounded tail scan; per-row
 * id re-derivation (#273 — a self-inconsistent stored id is SKIPPED); NEVER throws.
 * The tail-window invariant: only witnesses inside the newest WITNESS_LEDGER_MAX_RECORDS are
 * verifiable — flooded/aged-out reads unwitnessed (fail-closed; re-materialize heals).
 *
 * @param {object} snapshotish a parsed snapshot BODY (content_hash + the load-bearing fields) — the
 *                 integrity coupling is recomputed when the full body is present (hacker M1); OR a
 *                 bare `{content_hash}` (the low-level primitive form — the caller OWNS integrity).
 * @param {object} [opts] { ledgerPath? }
 * @returns {{witnessed:boolean, reason:'witnessed'|'unwitnessed'|'no-ledger'|'invalid-snapshot'|'integrity-mismatch'}}
 */
function verifySnapshotProvenance(snapshotish, opts) {
  try {
    const contentHash = snapshotish && typeof snapshotish.content_hash === 'string' ? snapshotish.content_hash : null;
    if (!contentHash || !HEX64_RE.test(contentHash)) return { witnessed: false, reason: 'invalid-snapshot' };
    // M1 (VALIDATE hacker): make the integrity coupling INTRINSIC. The fn is exported, so a future
    // direct caller (an audit CLI, the v3.9 gate) passing a full body must not get a vouch for a hash
    // that does not match its own body. When the load-bearing snapshot fields are present, recompute
    // the snapshot hash and require a match — the bare `{content_hash}` primitive form (no `personas`)
    // skips this and trusts the caller (the readEvolutionSnapshot path already self-verified INV-22).
    if (Array.isArray(snapshotish.personas)) {
      let recomputed;
      try { recomputed = computeSnapshotHash(snapshotish); } catch { return { witnessed: false, reason: 'integrity-mismatch' }; }
      if (recomputed !== contentHash) return { witnessed: false, reason: 'integrity-mismatch' };
    }
    const ledger = (opts && typeof opts.ledgerPath === 'string') ? opts.ledgerPath : resolveWitnessLedgerPath();
    const rows = readWitnessRowsSafe(ledger); // H1: O_NONBLOCK+fstat regular-file gate, never blocks
    if (rows === null) return { witnessed: false, reason: 'no-ledger' };
    for (let i = rows.length - 1; i >= 0; i -= 1) { // newest first
      const r = rows[i];
      if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
      if (r.content_hash !== contentHash) continue;
      let derived;
      // Per-row guard (hacker L1): a syntactically-valid but pathologically-deep row would throw
      // canonicalJsonSerialize's bounded TypeError mid-scan — skip it, never throw (the leaf contract).
      try { derived = computeWitnessId(r); } catch { continue; }
      if (r.witness_id === derived) return { witnessed: true, reason: 'witnessed' };
    }
    return { witnessed: false, reason: 'unwitnessed' };
  } catch {
    return { witnessed: false, reason: 'unwitnessed' }; // outer fail-soft: a hostile ledger can only deny, never crash a caller
  }
}

/**
 * Read + validate the reputation snapshot. NEVER throws: every branch returns an object
 * ({present:true,...} | {present:false, reason}). O(1) w.r.t. attestation volume (reads only the
 * small snapshot file; never the ledger).
 *
 * @param {string|{path?:string}} [pathOrOpts] explicit path (else resolveSnapshotPath())
 */
function readEvolutionSnapshot(pathOrOpts) {
  let p;
  let verifyProvenance = false;
  try {
    if (typeof pathOrOpts === 'string') p = pathOrOpts;
    else if (pathOrOpts && typeof pathOrOpts === 'object') {
      if (typeof pathOrOpts.path === 'string') p = pathOrOpts.path;
      verifyProvenance = pathOrOpts.verifyProvenance === true; // opt-in; the bare hot-path call never sets it
    }
    // Default ONLY when no path was provided at all — an EXPLICIT empty/falsy path stays 'absent'
    // (the pre-existing contract; the leaf suite locks `''` → absent, never a default fall-through).
    if (p === undefined) p = resolveSnapshotPath();
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
  const result = {
    present: true,
    content_hash: parsed.content_hash,
    generated_at: parsed.generated_at,
    source: parsed.source,
    watermark,
    value: parsed.personas, // the bounded per-persona distribution; spawn-record byte-caps the inline copy
    truncated: false,
  };
  if (verifyProvenance) {
    // Opt-in ONLY (the no-flag result shape is byte-identical — the hot-path lock). One extra
    // bounded small-file read; the gating consumer fail-closes on provenance !== 'witnessed'.
    result.provenance = verifySnapshotProvenance(parsed).witnessed ? 'witnessed' : 'unwitnessed';
  }
  return result;
}

module.exports = {
  resolveSnapshotPath,
  snapshotHashBody,
  computeSnapshotHash,
  readEvolutionSnapshot,
  resolveWitnessLedgerPath,
  computeWitnessId,
  appendSnapshotWitness,
  verifySnapshotProvenance,
  SNAPSHOT_FILENAME,
  WITNESS_LEDGER_FILENAME,
  WITNESS_LEDGER_MAX_RECORDS,
  DEFAULT_MAX_BYTES,
  HARD_MAX_BYTES,
};
