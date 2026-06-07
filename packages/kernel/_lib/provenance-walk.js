// packages/kernel/_lib/provenance-walk.js
//
// W0.0 — bounded provenance chain-walk leaf (v3.5 Memory Manage-Layer, Wave 0).
//
// WHY THIS EXISTS (verify-plan FAIL-Q2, load-bearing): record-store.js exposes only
// POINT-lookups (readById / readByPostStateHash / readByIdempotencyKey / listByRun)
// and lineage.js only a SINGLE-edge builder + a cycle check — so no TRANSITIVE
// provenance walk existed. Yet both Wave-0 consumers need one: W0.2 (mark-stale)
// must know a record's transitive evidence_refs, and W0.3 (the provenance-edge view)
// must surface the prev_state_hash chain. This leaf supplies that walk.
//
// PURITY (the lineage.js precedent): pure functions over a passed-in record array —
// NO I/O. The consumer calls record-store.listByRun(opts) and feeds the result here.
// This keeps the leaf trivially testable and K12-clean (no store import).
//
// SCOPE — PROVENANCE relations ONLY (verify-plan):
//   * STATE chain  — prev_state_hash -> predecessor's post_state_hash (the
//     load-bearing keying contract; record-store.js:14-22, v6 §4.2/§5.4).
//   * EVIDENCE DAG — evidence_refs, resolved by transaction_id (the live producers
//     populate evidence_refs with txids or bootstrap sentinels; sentinels are
//     skipped — they are not in-chain records).
// These are KERNEL-asserted provenance edges, trustworthy by construction — so NO
// faithfulness (R3) filter applies. The SEMANTIC multi-relation fan-out
// (caused_by / contradicts / cluster / related, R3-gated) is OQ-27 / Spike B's
// GENERALISATION of this leaf — explicitly OUT of scope here ("NO fan-out").
//
// SAFETY: every walk is BOUNDED (maxNodes) and CYCLE-SAFE (a seen-set), so a
// pathological/looping record set can never hang or blow memory — the same
// fail-soft, bounded discipline as the other kernel/_lib leaves (jsonl-read,
// evolution-snapshot-read). Unresolvable references are skipped, never thrown on.

'use strict';

// A transaction_id / post_state_hash is a 64-char lowercase-hex sha256. A cursor
// that is not 64-hex (the literal 'GENESIS', a bootstrap sentinel like
// 'USER_INTENT_AXIOM:...', or a computeGenesisHash value not present as any
// record's post_state_hash) naturally TERMINATES the walk via the index miss —
// so no separate sentinel matcher is needed (keeps this leaf dependency-free).
const HEX64 = /^[a-f0-9]{64}$/;

// Generous default node cap. Bounds the walk against a pathological chain/closure
// without truncating any realistic run. Callers may override via opts.maxNodes.
const DEFAULT_MAX_NODES = 10000;

function isRecord(r) {
  return !!r && typeof r === 'object' && !Array.isArray(r);
}

function clampMaxNodes(opts) {
  const n = opts && Number.isInteger(opts.maxNodes) ? opts.maxNodes : DEFAULT_MAX_NODES;
  return n > 0 ? n : DEFAULT_MAX_NODES;
}

/**
 * Build a Map post_state_hash -> record (first-wins on a duplicate hash; a
 * duplicate within one run is data corruption, and the walk's correctness does not
 * depend on which duplicate is chosen — K9's fail-closed consumer is the gate).
 * Records with a null/absent/non-hex post_state_hash (a PENDING record) are skipped
 * — they cannot be a STATE-chain predecessor.
 *
 * @param {object[]} records
 * @returns {Map<string, object>}
 */
function indexByPostStateHash(records) {
  const idx = new Map();
  if (!Array.isArray(records)) return idx;
  for (const r of records) {
    if (!isRecord(r)) continue;
    const h = r.post_state_hash;
    if (typeof h === 'string' && HEX64.test(h) && !idx.has(h)) idx.set(h, r);
  }
  return idx;
}

/**
 * Build a Map transaction_id -> record (first-wins). Skips records without a
 * 64-hex transaction_id.
 *
 * @param {object[]} records
 * @returns {Map<string, object>}
 */
function indexByTransactionId(records) {
  const idx = new Map();
  if (!Array.isArray(records)) return idx;
  for (const r of records) {
    if (!isRecord(r)) continue;
    const id = r.transaction_id;
    if (typeof id === 'string' && HEX64.test(id) && !idx.has(id)) idx.set(id, r);
  }
  return idx;
}

/**
 * Walk the STATE chain backward from a start record, following prev_state_hash to
 * each predecessor's post_state_hash, until a genesis position (a non-hex
 * prev_state_hash) or a broken/missing link.
 *
 * Returns the records ordered NEWEST-FIRST: [startRecord, predecessor, ..., genesis].
 * A PENDING start (post_state_hash null) is still a valid walk start — we follow ITS
 * prev_state_hash. Fail-soft: a missing predecessor stops the walk and returns the
 * partial chain (never throws). Cycle-safe + bounded by maxNodes.
 *
 * @param {object} startRecord the record to start from (must be a record object).
 * @param {object[]} records the run's record set (the predecessor pool).
 * @param {{maxNodes?: number}} [opts]
 * @returns {object[]} the chain, newest-first (empty if startRecord is not a record).
 */
function walkStateChain(startRecord, records, opts = {}) {
  if (!isRecord(startRecord)) return [];
  const maxNodes = clampMaxNodes(opts);
  const byPost = indexByPostStateHash(records);
  const chain = [startRecord];
  const seenPost = new Set();
  if (typeof startRecord.post_state_hash === 'string') {
    seenPost.add(startRecord.post_state_hash);
  }
  let cursor = startRecord.prev_state_hash;
  while (
    chain.length < maxNodes &&
    typeof cursor === 'string' &&
    HEX64.test(cursor) &&
    !seenPost.has(cursor)
  ) {
    const pred = byPost.get(cursor);
    if (!pred) break; // genesis-hash / broken link / fail-soft
    chain.push(pred);
    seenPost.add(cursor);
    cursor = pred.prev_state_hash;
  }
  return chain;
}

/**
 * Collect the transitive EVIDENCE closure rooted at one or more transaction_ids:
 * BFS over evidence_refs, resolving each ref by transaction_id. Bootstrap sentinels
 * (and any non-64-hex ref) are skipped — they are not in-chain records. The result
 * INCLUDES the seed ids (so "a SUPERSEDE targets a record in R's closure" naturally
 * covers a SUPERSEDE of R itself). Cycle-safe + bounded by maxNodes; an unresolvable
 * id is counted as visited but not expanded.
 *
 * @param {string[]} startTxIds the root transaction_ids.
 * @param {object[]} records the run's record set (resolution pool).
 * @param {{maxNodes?: number}} [opts]
 * @returns {Set<string>} the transitive set of reachable transaction_ids.
 */
function collectEvidenceClosure(startTxIds, records, opts = {}) {
  const visited = new Set();
  if (!Array.isArray(startTxIds)) return visited;
  const maxNodes = clampMaxNodes(opts);
  const byTxid = indexByTransactionId(records);
  const queue = [];
  for (const id of startTxIds) {
    if (visited.size >= maxNodes) break; // honor the cap in the seed phase too (VALIDATE M-fix: a multi-seed caller must not exceed maxNodes)
    if (typeof id === 'string' && HEX64.test(id) && !visited.has(id)) {
      visited.add(id);
      queue.push(id);
    }
  }
  while (queue.length > 0 && visited.size < maxNodes) {
    const rec = byTxid.get(queue.shift());
    if (!rec) continue; // seed-only / unresolvable → visited but not expanded
    const refs = Array.isArray(rec.evidence_refs) ? rec.evidence_refs : [];
    for (const ref of refs) {
      if (typeof ref !== 'string' || !HEX64.test(ref)) continue; // skip sentinels / non-txids
      if (visited.has(ref)) continue;
      if (visited.size >= maxNodes) break;
      visited.add(ref);
      queue.push(ref);
    }
  }
  return visited;
}

module.exports = {
  walkStateChain,
  collectEvidenceClosure,
  indexByPostStateHash,
  indexByTransactionId,
  HEX64, // exported so sibling projection consumers share the one definition (DRY)
  DEFAULT_MAX_NODES,
};
