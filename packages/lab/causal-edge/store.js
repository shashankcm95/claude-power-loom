#!/usr/bin/env node

// @loom-layer: lab
//
// v3.5 Wave 2 - Causal-edge store (the semantic-edge PRODUCER of the graph loop). The Layer-3,
// ADVISORY-ONLY store of LLM-asserted semantic edges between memory blocks (caused_by / contradicts /
// cluster ...). It OBSERVES and RECORDS - it NEVER blocks or gates anything (Lab boundary, RFC section 2
// Layer 3); 0 packages/kernel/hooks.json deep refs (SHADOW).
//
// D1 (the load-bearing design decision - see the Wave 2 plan): semantic edges live HERE, in a dedicated
// advisory Lab store, NOT in the kernel transaction-record schema. This is v6-CONFORMANT via section
// 10b / OQ-24 (a derived/advisory cache, regeneratable, never canonical - the E1/E4 precedent), NOT a
// section 4.2 amendment (v6 has no semantic-edge kernel record; section 4.2's edges-embedded-in-nodes
// governs KERNEL PROVENANCE edges - prev_state_hash / evidence_refs - a different class). Secondary
// reason: the kernel JSON schema is documentary (no ajv), so a node_type discriminator there would be
// an INERT control (the ADR-0012 trap). R4 (closed enums + canonicalization) is therefore self-owned here.
//
// Layer discipline (K12, by PATH): under packages/lab/, so `lab`. Imports ONLY kernel/_lib (atomic
// write / lock / canonical-json / jsonl-read - lab->kernel = outer->inner = LEGAL) + the sibling
// ./enums. It imports NO runtime/kernel STATE (no record-store, no transaction-record, no spawn-state).
//
// EDGE-IDENTITY semantics (the contrast with E1/W1, which ACCUMULATE distinct events): an edge is a
// STABLE identity (relation + endpoints + conflict_type) with a MUTABLE faithfulness_status. So the
// store DEDUPS on edge_id (one live row per identity); createEdge on an existing edge_id is idempotent
// (returns the live row); a separate updateEdgeStatus() supersedes the status (the W1 enrichRecord
// analog). NO wall-clock expiry (an edge is not a witness that ages out); the ledger is bounded by a
// count cap (newest kept) + the read-path byte cap.
//
// TRUST MODEL (VALIDATE hacker C1 - an HONEST boundary, NOT enforcement): this is a writer-UNAUTHENTICATED
// advisory store (the Wave-1 OQ-E NO-GO: in-process write-identity on a single-uid host collapses to the
// sandbox requirement; the kernel-attested-writer primitive is deferred to v3.6). updateEdgeStatus is a
// TRUSTED-CALLER entrypoint - the faithfulness module is the INTENDED promotion gate, but the store cannot
// enforce that a verdict earned a promotion (ADR-0012: such a check is inert theater - a caller forges the
// verdict too). The blast radius is bounded by NARROWING-SAFETY: a forged-eligible edge reaches ADVISORY
// walker reads ONLY, never a kernel gate / capability (v6 section 0a.3.1). What the store DOES verify: the
// content-address (edge_id) is re-derived + checked on read (the INV-22 discipline - see readLedger), so a
// hand-planted row whose edge_id lies about its body is skipped, never dedup-served.

'use strict';

const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { writeAtomicString } = require('../../kernel/_lib/atomic-write');
const { acquireLock, releaseLock } = require('../../kernel/_lib/lock');
const { canonicalJsonSerialize } = require('../../kernel/_lib/canonical-json');
const { readJsonlBounded } = require('../../kernel/_lib/jsonl-read');
const { nonEmptyString, hasControlChars } = require('../../kernel/_lib/free-string-checks');
const {
  RELATIONS, CONFLICT_TYPES, FAITHFULNESS_STATUSES, DEFAULT_FAITHFULNESS_STATUS, validateEnum,
} = require('./enums');

// Resolved ONCE at module-load (the ENV-BEFORE-REQUIRE discipline; tests set LOOM_LAB_STATE_DIR first).
const LAB_STATE_BASE = process.env.LOOM_LAB_STATE_DIR || path.join(os.homedir(), '.claude', 'lab-state');
const STORE_DIR = path.join(LAB_STATE_BASE, 'causal-edges');
const LEDGER_PATH = path.join(STORE_DIR, 'ledger.jsonl');
const LOCK_PATH = path.join(STORE_DIR, '.lock');

const SCHEMA_VERSION = 'v3.5';
const LOCK_WAIT_MS = 2000;        // bounded; the advisory store never blocks longer than this
const MAX_LEDGER_RECORDS = 10000; // a count cap (the dedup keeps it small in practice; this bounds a flood)
// A ledger SIZE (byte) bound for the READ path: past it, readJsonlBounded TAIL-reads the newest records
// (never the whole file as one >512MB string). Env-overridable (ENV-BEFORE-REQUIRE) for tests.
const MAX_LEDGER_BYTES = Number(process.env.LOOM_LAB_MAX_LEDGER_BYTES) > 0
  ? Number(process.env.LOOM_LAB_MAX_LEDGER_BYTES) : 64 * 1024 * 1024;
// Per-field byte cap (mirrors W1 M2): bounds ledger bloat + keeps the canonical edge_id basis total.
const MAX_FIELD_LEN = 512;
// The ECMAScript Date limit (+/-8.64e15 ms from the epoch). A `now` past this is finite but still makes
// new Date().toISOString() throw RangeError - so Number.isFinite alone is NOT a sufficient guard (CodeRabbit).
const MAX_DATE_MS = 8.64e15;

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

// Advisory soft-lock (mirrors E1/W1): the kernel store's withLock does process.exit(2) on contention;
// the Lab store is ADVISORY and must NEVER kill the caller. On a bounded acquire-failure it warns +
// returns the soft fallback so a caller warn-and-skips.
function withLabLock(fn, onContended) {
  if (!acquireLock(LOCK_PATH, { maxWaitMs: LOCK_WAIT_MS })) {
    try { process.stderr.write('causal-edge: ledger lock contended - skipping (advisory)\n'); } catch { /* ignore */ }
    return onContended();
  }
  try { return fn(); } finally { releaseLock(LOCK_PATH); }
}

// INV-22 discipline (VALIDATE hacker H1): edge_id is a VERIFIED content-address, NEVER trusted as-stored.
// isAuthenticEdge re-derives it from the row body; a row whose stored edge_id does not match (a tampered
// body, or a hand-planted row claiming a forged identity) is NOT authentic. Mirrors the kernel
// record-store's deriveIdempotencyKey re-derivation. Advisory -> a non-authentic row is SKIPPED on read,
// never thrown on; the next write persists the cleaned set (self-healing, like the W1 prune-on-write).
function isAuthenticEdge(r) {
  if (!r || typeof r !== 'object') return false;
  try {
    return r.edge_id === computeEdgeId(r.relation, r.source_block, r.target_block, r.conflict_type);
  } catch {
    return false; // un-rederivable (malformed / over-deep field) -> not authentic
  }
}

// Read the JSONL ledger -> array via the shared bounded reader: missing -> []; oversized -> newest tail;
// corrupt line -> skipped; > MAX_LEDGER_RECORDS -> newest cap. Then drop content-address forgeries (H1).
// Never throws (advisory).
function readLedger() {
  const raw = readJsonlBounded(LEDGER_PATH, {
    maxRecords: MAX_LEDGER_RECORDS,
    maxBytes: MAX_LEDGER_BYTES,
    name: 'causal-edge',
  });
  return raw.filter(isAuthenticEdge);
}

// Atomic whole-ledger write (never a raw append - a record line can exceed PIPE_BUF and interleave).
// writeAtomicString creates STORE_DIR as needed. Empty -> empty file.
function writeLedger(records) {
  const body = records.length ? records.map((r) => JSON.stringify(r)).join('\n') + '\n' : '';
  writeAtomicString(LEDGER_PATH, body);
}

function nowMsFrom(opts) {
  return (opts && opts.now !== undefined) ? new Date(opts.now).getTime() : Date.now();
}

// Parse a record's recorded_at to ms for the count-cap sort; an unparseable value sorts OLDEST (-Infinity)
// so a malformed row is evicted first (VALIDATE hacker H2 trailer: Date.parse(NaN) must not corrupt eviction).
function tsOf(record) {
  const t = Date.parse(record && record.recorded_at);
  return Number.isNaN(t) ? -Infinity : t;
}

// A free-string field (source_block / target_block / source_origin): non-empty, BYTE-length-capped,
// control-char-free. NOT enum-validated (these are arbitrary identifiers / provenance strings). The cap
// is a BYTE cap (Buffer.byteLength), not a char count: a multibyte string under MAX_FIELD_LEN chars can
// still exceed the byte budget the canonical edge_id basis + the ledger bloat bound assume.
function validateFreeString(v, fieldName) {
  if (!nonEmptyString(v)) {
    throw new Error(`causal-edge: ${fieldName} (a non-empty string) is required`);
  }
  if (Buffer.byteLength(v, 'utf8') > MAX_FIELD_LEN) {
    throw new Error(`causal-edge: ${fieldName} exceeds the ${MAX_FIELD_LEN}-byte length cap`);
  }
  if (hasControlChars(v)) {
    throw new Error(`causal-edge: ${fieldName} contains a control / line-separator character (rejected at the store boundary)`);
  }
  return v;
}

// Validate + normalize createEdge input AT THE BOUNDARY (before the lock - a bad input writes nothing).
// Throws a clean Error on any violation. Returns the validated, normalized fields.
function validateCreateEdgeInput(o) {
  const relation = validateEnum(o.relation, RELATIONS, 'relation'); // R4 NFC + closed enum
  // conflict_type: REQUIRED iff contradicts, FORBIDDEN otherwise (keeps the edge_id basis well-defined).
  let conflictType = null;
  if (relation === 'contradicts') {
    if (o.conflictType === undefined || o.conflictType === null) {
      throw new Error("causal-edge: conflict_type is required when relation === 'contradicts'");
    }
    conflictType = validateEnum(o.conflictType, CONFLICT_TYPES, 'conflict_type');
  } else if (o.conflictType !== undefined && o.conflictType !== null) {
    throw new Error("causal-edge: conflict_type is forbidden unless relation === 'contradicts'");
  }
  // faithfulness_status: R1 fail-closed default 'unvalidated'.
  const faithfulnessStatus = (o.faithfulnessStatus === undefined || o.faithfulnessStatus === null)
    ? DEFAULT_FAITHFULNESS_STATUS
    : validateEnum(o.faithfulnessStatus, FAITHFULNESS_STATUSES, 'faithfulness_status');
  return {
    relation,
    conflictType,
    faithfulnessStatus,
    sourceBlock: validateFreeString(o.sourceBlock, 'source_block'),
    targetBlock: validateFreeString(o.targetBlock, 'target_block'),
    sourceOrigin: validateFreeString(o.sourceOrigin, 'source_origin'),
  };
}

// The identity content-address. The basis is the WHOLE identity tuple through the kernel canonical-json
// leaf (sorted/total - MAX_FIELD_LEN keeps it bounded). faithfulness_status + source_origin are NOT in
// the basis (they are mutable/provenance, not identity). conflict_type ?? null pins a contradicts edge's
// sub-kind into the identity (two contradicts edges of different kinds are distinct identities).
function computeEdgeId(relation, sourceBlock, targetBlock, conflictType) {
  return sha256(canonicalJsonSerialize([relation, sourceBlock, targetBlock, conflictType == null ? null : conflictType]));
}

/**
 * Create (or idempotently return) a causal edge. ADVISORY - never blocks.
 *
 * @param {object} input
 * @param {string} input.relation           one of RELATIONS
 * @param {string} input.sourceBlock        the source block id (free string)
 * @param {string} input.targetBlock        the target block id (free string)
 * @param {string} [input.conflictType]     required iff relation==='contradicts'
 * @param {string} [input.faithfulnessStatus] default 'unvalidated' (R1)
 * @param {string} input.sourceOrigin       provenance of the assertion (free string)
 * @param {number|string} [input.now]       injected wall-clock (tests); default Date.now()
 * @returns {object} the frozen record, OR the existing live row (dedup), OR { skipped:'lock-contended', edge_id }
 */
function createEdge(input) {
  const o = input || {};
  const v = validateCreateEdgeInput(o); // pre-lock; throws on bad input
  const nowMs = nowMsFrom(o);
  // VALIDATE hacker H2 (+ CodeRabbit range fix): a non-finite `now` (NaN / "garbage" / Infinity / {}) OR a
  // finite-but-out-of-Date-range one (e.g. 1e20 > MAX_DATE_MS) would make new Date().toISOString() throw a
  // deep, UNCAUGHT RangeError - violating the advisory "never throw a stack dump" contract. Reject BOTH as a
  // CLEAN boundary error (the CLI try/catch turns it into a tidy exit-1), before the lock.
  if (!Number.isFinite(nowMs) || Math.abs(nowMs) > MAX_DATE_MS) {
    throw new Error('causal-edge: now must be a finite timestamp within the supported Date range');
  }
  const recordedAt = new Date(nowMs).toISOString();
  const edgeId = computeEdgeId(v.relation, v.sourceBlock, v.targetBlock, v.conflictType);

  const record = Object.freeze({
    node_type: 'causal-edge',
    edge_id: edgeId,
    schema_version: SCHEMA_VERSION,
    relation: v.relation,
    source_block: v.sourceBlock,
    target_block: v.targetBlock,
    conflict_type: v.conflictType,
    faithfulness_status: v.faithfulnessStatus,
    source_origin: v.sourceOrigin,
    recorded_at: recordedAt,
  });

  return withLabLock(() => {
    const all = readLedger();
    // DEDUP on edge_id: one live row per identity. An existing identity is returned AS-IS (first-write-
    // wins on non-identity fields; status changes go through updateEdgeStatus - NOT a second row).
    const existing = all.find((r) => r && r.edge_id === edgeId);
    if (existing) return Object.freeze(existing);
    let live = all.slice();
    live.push(record);
    // Count cap: keep the newest MAX_LEDGER_RECORDS. Sort by recorded_at with a STABLE index tiebreaker
    // (VALIDATE code-reviewer HIGH-2: same-millisecond rows must drop oldest-by-insertion deterministically,
    // not arbitrarily); tsOf maps an unparseable recorded_at to -Infinity so a malformed row is evicted first.
    if (live.length > MAX_LEDGER_RECORDS) {
      live = live
        .map((r, i) => ({ r, i }))
        .sort((a, b) => (tsOf(a.r) - tsOf(b.r)) || (a.i - b.i))
        .slice(live.length - MAX_LEDGER_RECORDS)
        .map((x) => x.r);
    }
    writeLedger(live);
    return record;
  }, () => Object.freeze({ skipped: 'lock-contended', edge_id: edgeId }));
}

/**
 * Supersede an edge's faithfulness_status durably (the W1 enrichRecord analog). Read-modify-write the
 * whole ledger under the lock; find by edge_id; replace IN PLACE with a new frozen record (immutability).
 * NOT a createEdge re-call (that dedups on the unchanged identity + would drop the status change).
 *
 * TRUSTED-CALLER entrypoint (VALIDATE hacker C1): no write-identity authentication (writer-unauthenticated
 * advisory store; OQ-E primitive deferred to v3.6). The faithfulness module is the INTENDED promotion gate;
 * the store cannot enforce a verdict preceded the call (ADR-0012 inert-theater). A forged promotion is
 * bounded by NARROWING-SAFETY: it admits the edge to ADVISORY walker reads only, never a kernel gate.
 *
 * @param {string} edgeId
 * @param {string} newStatus  one of FAITHFULNESS_STATUSES (R4-validated)
 * @returns {object} the new frozen record, OR { notFound:true, edge_id }, OR { skipped:'lock-contended', edge_id }
 */
function updateEdgeStatus(edgeId, newStatus) {
  if (!nonEmptyString(edgeId)) {
    throw new Error('causal-edge: updateEdgeStatus requires a non-empty edge_id');
  }
  const status = validateEnum(newStatus, FAITHFULNESS_STATUSES, 'faithfulness_status'); // R4; throws on invalid/homoglyph
  return withLabLock(() => {
    const all = readLedger();
    const idx = all.findIndex((r) => r && r.edge_id === edgeId);
    if (idx === -1) return Object.freeze({ notFound: true, edge_id: edgeId });
    const updated = Object.freeze({ ...all[idx], faithfulness_status: status });
    const next = all.slice();
    next[idx] = updated;
    writeLedger(next);
    return updated;
  }, () => Object.freeze({ skipped: 'lock-contended', edge_id: edgeId }));
}

/**
 * List stored edges. Read-only; no lock needed. (No wall-clock expiry - edges are stable identities.)
 * @param {object} [opts] { filter?: (edge)=>boolean }
 * @returns {object[]}
 */
function listEdges(opts) {
  const o = opts || {};
  let records = readLedger();
  if (typeof o.filter === 'function') records = records.filter(o.filter);
  return records;
}

module.exports = {
  createEdge,
  updateEdgeStatus,
  listEdges,
  computeEdgeId,
  STORE_DIR,
  LEDGER_PATH,
  MAX_LEDGER_RECORDS,
  MAX_FIELD_LEN,
  SCHEMA_VERSION,
};
