// packages/kernel/_lib/provenance-projections.js
//
// W0.2 (deterministic-manage PROJECTIONS: mark-stale + retention-archive) + W0.3
// (provenance-edge VIEW) — v3.5 Memory Manage-Layer, Wave 0.
//
// PURE projections over a passed-in record set (the W0.0 / lineage.js precedent —
// the consumer feeds record-store.listByRun(opts); injectable nowMs like
// recency-decay). They emit NO record: per v6 §5a.1 lifecycle states are pure
// projections, re-derivable and NEVER stored — which is what makes the "adds 4 new
// derived states, no v6 amendment" claim verifiable. Wave 0 produces `stale` +
// `archived`; `conflicted`/`quarantined` arrive with W2/W3.
//
// HONESTLY BOUNDED (v3.5 RFC §1 MEDIUM-3): the deterministic-manage column catches
// ONLY invalidations the substrate witnessed AS A TRANSACTION (a COMMITTED SUPERSEDE).
// External-world staleness the substrate never recorded is NOT detected — see the
// `isStale` bounding-negative test.
//
// SUPERSEDE/TOMBSTONE target convention (v3.5, ESTABLISHED HERE — there is no prior
// SUPERSEDE/TOMBSTONE producer in the substrate): a COMMITTED SUPERSEDE/TOMBSTONE
// names the record(s) it acts on in `affected_records` (the "what this op acts on"
// field), leaving `evidence_refs` for A10 justification. This separates "affected"
// from "justifies" (cleaner than the RFC §3 sketch's `evidence_refs=[old,justifying]`
// conflation). Logged as a Runtime-Claim Probe candidate in the scope doc; the
// future SUPERSEDE producer (a v3.6 leave-shadow concern) MUST honor it.
//
// SHADOW: read-side projections only — never a kernel gate, never a hooks.json ref.

'use strict';

const { walkStateChain, collectEvidenceClosure, HEX64 } = require('./provenance-walk');

const DAY_MS = 86400000;
// Default retention window for retention-archive (RFC leaves the policy open; 90d is
// a conservative default — a retention sweep passes its own threshold via opts).
const DEFAULT_RETENTION_DAYS = 90;

function isRecord(r) {
  return !!r && typeof r === 'object' && !Array.isArray(r);
}

/**
 * The set of transaction_ids named in `affected_records` by a COMMITTED record of
 * the given operation_class. DRY core for findSupersededTxids / findTombstonedTxids.
 * Only COMMITTED ops count (a PENDING/ABORTED manage-op has not taken effect).
 *
 * @param {object[]} records
 * @param {string} opClass 'SUPERSEDE' | 'TOMBSTONE'
 * @returns {Set<string>} 64-hex target transaction_ids
 */
function findAffectedByOp(records, opClass) {
  const set = new Set();
  if (!Array.isArray(records)) return set;
  for (const r of records) {
    if (!isRecord(r)) continue;
    if (r.operation_class !== opClass || r.commit_outcome !== 'COMMITTED') continue;
    const affected = Array.isArray(r.affected_records) ? r.affected_records : [];
    for (const a of affected) {
      if (typeof a === 'string' && HEX64.test(a)) set.add(a);
    }
  }
  return set;
}

function findSupersededTxids(records) {
  return findAffectedByOp(records, 'SUPERSEDE');
}

function findTombstonedTxids(records) {
  return findAffectedByOp(records, 'TOMBSTONE');
}

/**
 * Parse a record's effective timestamp (committed_at, falling back to
 * intent_recorded_at) to epoch ms, or null if unparseable.
 */
function parseTimestamp(record) {
  const raw = record.committed_at || record.intent_recorded_at;
  if (typeof raw !== 'string') return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

// Internal stale check given a precomputed superseded set (avoids re-scanning when
// projectLifecycleState already has it).
function staleGiven(record, records, supersededSet, opts) {
  if (!isRecord(record)) return false;
  const id = record.transaction_id;
  if (typeof id !== 'string') return false;
  if (supersededSet.has(id)) return false; // directly superseded == "superseded", not "stale"
  if (supersededSet.size === 0) return false; // nothing superseded anywhere → nothing can be stale
  const closure = collectEvidenceClosure([id], records, opts);
  for (const dep of closure) {
    if (dep !== id && supersededSet.has(dep)) return true; // a transitive dependency was superseded
  }
  return false;
}

// Internal archivable check given precomputed superseded + tombstoned sets.
function archivableGiven(record, records, supersededSet, tombstonedSet, opts) {
  if (!isRecord(record)) return false;
  if (record.commit_outcome !== 'COMMITTED') return false; // only committed records age into archive
  const id = record.transaction_id;
  if (supersededSet.has(id) || tombstonedSet.has(id)) return false; // replaced/deleted != aged-out
  const ts = parseTimestamp(record);
  if (ts === null) return false; // unparseable timestamp → fail-soft (not archivable)
  const nowMs = opts && Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  const retentionDays =
    opts && Number.isInteger(opts.retentionDays) && opts.retentionDays > 0
      ? opts.retentionDays
      : DEFAULT_RETENTION_DAYS;
  return nowMs - ts > retentionDays * DAY_MS;
}

// BATCH NOTE (VALIDATE LOW): isStale/isArchivable each recompute the superseded/
// tombstoned sets (O(records) per call). For a sweep over MANY records, prefer
// projectLifecycleState (which hoists both sets once via staleGiven/archivableGiven)
// or factor those internals out — deferred until a real batch consumer exists (YAGNI).
/**
 * mark-stale projection: true iff a COMMITTED SUPERSEDE invalidated a record in
 * `record`'s transitive evidence-closure (and `record` is not itself directly
 * superseded). Pure, bounded (via collectEvidenceClosure). NO record emitted.
 *
 * @param {object} record
 * @param {object[]} records the run's record set
 * @param {{maxNodes?: number}} [opts]
 * @returns {boolean}
 */
function isStale(record, records, opts = {}) {
  return staleGiven(record, records, findSupersededTxids(records), opts);
}

/**
 * retention-archive projection: true iff `record` is a COMMITTED, not-superseded,
 * not-tombstoned record whose age exceeds the retention window. Pure; injectable
 * nowMs (the recency-decay precedent). NO record emitted.
 *
 * @param {object} record
 * @param {object[]} records
 * @param {{nowMs?: number, retentionDays?: number}} [opts]
 * @returns {boolean}
 */
function isArchivable(record, records, opts = {}) {
  return archivableGiven(
    record,
    records,
    findSupersededTxids(records),
    findTombstonedTxids(records),
    opts
  );
}

/**
 * The combined derived lifecycle state for a record (a pure projection per §5a.1).
 * Precedence: aborted/informational/candidate (from commit_outcome) →
 * tombstoned → superseded → stale → archived → active. Returns null for a non-record.
 *
 * @param {object} record
 * @param {object[]} records
 * @param {{nowMs?: number, retentionDays?: number, maxNodes?: number}} [opts]
 * @returns {string|null}
 */
function projectLifecycleState(record, records, opts = {}) {
  if (!isRecord(record)) return null;
  const outcome = record.commit_outcome;
  if (outcome === 'ABORTED' || outcome === 'ROLLED-BACK') return 'aborted';
  if (outcome === 'NOT_APPLICABLE') return 'informational';
  if (outcome === 'PENDING') return 'candidate';
  // COMMITTED → the derived precedence.
  const superseded = findSupersededTxids(records);
  const tombstoned = findTombstonedTxids(records);
  const id = record.transaction_id;
  if (tombstoned.has(id)) return 'tombstoned';
  if (superseded.has(id)) return 'superseded';
  if (staleGiven(record, records, superseded, opts)) return 'stale';
  if (archivableGiven(record, records, superseded, tombstoned, opts)) return 'archived';
  return 'active';
}

/**
 * W0.3 — the provenance-edge VIEW for a record: the existing chain surfaced as a
 * pure projection (provenance edges are NOT records — architect's A' split). Returns
 * the newest-first STATE chain (transaction_ids), the direct evidence_refs (txids
 * only), and the transitive evidence closure. Read-side / human-facing; shadow-safe.
 *
 * @param {object} record
 * @param {object[]} records
 * @param {{maxNodes?: number}} [opts]
 * @returns {{transaction_id: string, state_chain: string[], direct_evidence: string[], evidence_closure: string[]}|null}
 */
function buildProvenanceView(record, records, opts = {}) {
  if (!isRecord(record)) return null;
  const id = typeof record.transaction_id === 'string' ? record.transaction_id : null;
  const chain = walkStateChain(record, records, opts);
  const directEvidence = (Array.isArray(record.evidence_refs) ? record.evidence_refs : []).filter(
    (r) => typeof r === 'string' && HEX64.test(r)
  );
  const closure = id ? collectEvidenceClosure([id], records, opts) : new Set();
  return {
    transaction_id: id,
    state_chain: chain.map((r) => r.transaction_id).filter((t) => typeof t === 'string'),
    direct_evidence: directEvidence,
    evidence_closure: [...closure],
  };
}

module.exports = {
  findSupersededTxids,
  findTombstonedTxids,
  isStale,
  isArchivable,
  projectLifecycleState,
  buildProvenanceView,
  DEFAULT_RETENTION_DAYS,
};
