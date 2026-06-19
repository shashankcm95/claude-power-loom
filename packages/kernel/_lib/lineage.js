// packages/kernel/_lib/lineage.js
//
// K3 lineage primitive — parent_state_id chain + session_id prompt injection.
// Per Phase-1-alpha PR 1 phase 7 + post-compact R1 FL-4 (pure function,
// no I/O).
//
// SRP: this module operates on chain arrays passed by the caller. It does
// NOT read prior state from disk. The DAG-acyclicity check is a linear scan
// (O(n)) over the passed-in chain.
//
// Status (2026-06-19): NO production consumer. This module is DORMANT-by-design
// — it ships with full unit coverage (tests/unit/kernel/_lib/lineage.test.js)
// but no kernel path imports it. An earlier header asserted a K9/K8 dependency;
// that claim was stale and FALSE:
//   - The K8 updatedInput payload-assembly consumer was CANCELLED per ADR-0012
//     (`updatedInput` is inert on Agent/Task spawns), so no K8 lineage
//     assembly exists to call buildLineageEntry.
//   - The K9 pre-commit path / the integrator / quarantine-promote use their
//     OWN chain gate (post_state_hash content-addressing via provenance-walk +
//     transaction-record); none of them require('./lineage') or call
//     isAcyclicChain.
// Retained (not deleted) as a tested pure primitive for a future chain-integrity
// consumer; do NOT cite it as a live dependency of the K9/K8 paths.

'use strict';

/**
 * Build a lineage entry for a spawn-record's parent + session attribution.
 * Pure function — no I/O.
 *
 * @param {string|null} parentStateId The parent's state_id, or null at genesis
 * @param {string} sessionId Non-empty session identifier (Claude session ID
 *                           or substrate-assigned UUID); prompt-injection
 *                           guard — empty string throws.
 * @returns {{ parent_state_id: string|null, session_id: string }}
 */
function buildLineageEntry(parentStateId, sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new Error('lineage.buildLineageEntry: session_id must be a non-empty string');
  }
  if (parentStateId !== null && typeof parentStateId !== 'string') {
    throw new Error(
      'lineage.buildLineageEntry: parent_state_id must be a string or null (got ' + typeof parentStateId + ')',
    );
  }
  return {
    parent_state_id: parentStateId,
    session_id: sessionId,
  };
}

/**
 * INV-K3-LineageAcyclicity — verify the passed-in chain is a DAG.
 *
 * Pure function (no I/O); linear scan over the chain. Each entry must be
 * `{ state_id: string, parent_state_id: string|null }`. Cycles within the
 * provided set are detected; dangling parent references (parent_state_id
 * pointing to a state_id not in the chain) are acyclic-by-convention (the
 * caller is responsible for chain completeness).
 *
 * @param {Array<{state_id: string, parent_state_id: string|null}>} chain
 * @returns {boolean} true if acyclic, false if a cycle is detected
 */
function isAcyclicChain(chain) {
  if (!Array.isArray(chain)) return false;
  if (chain.length === 0) return true;

  // Build state_id → parent_state_id map (only for entries in this chain).
  // Per code-review FAIL #7 (Phase 10 final pair-run): duplicate state_id
  // entries are a structurally invalid chain — return false eagerly.
  // Without this guard, the second occurrence would silently overwrite the
  // first in the Map, erasing one branch of the chain from cycle detection.
  // K9 pre-commit (PR 3 consumer) MUST see "not acyclic" for duplicates.
  const parentOf = new Map();
  for (const entry of chain) {
    if (!entry || typeof entry !== 'object') return false;
    if (typeof entry.state_id !== 'string') return false;
    if (entry.parent_state_id !== null && typeof entry.parent_state_id !== 'string') {
      return false;
    }
    if (parentOf.has(entry.state_id)) return false; // duplicate state_id = malformed chain
    parentOf.set(entry.state_id, entry.parent_state_id);
  }

  // For each entry, walk parent links. If we revisit a state_id we've
  // already seen during THIS walk, there's a cycle.
  // Linear in total work: a parent shared by N children is walked at most
  // until it's been verified acyclic (visited-set caches per-walk).
  const verifiedAcyclic = new Set();
  for (const startId of parentOf.keys()) {
    if (verifiedAcyclic.has(startId)) continue;
    const seenThisWalk = new Set();
    let cur = startId;
    while (cur !== null && cur !== undefined) {
      if (seenThisWalk.has(cur)) return false; // cycle detected
      seenThisWalk.add(cur);
      if (verifiedAcyclic.has(cur)) break; // joined into already-verified-acyclic subtree
      if (!parentOf.has(cur)) break; // dangling parent ref — acyclic-by-convention
      cur = parentOf.get(cur);
    }
    for (const id of seenThisWalk) verifiedAcyclic.add(id);
  }

  return true;
}

module.exports = {
  buildLineageEntry,
  isAcyclicChain,
};
