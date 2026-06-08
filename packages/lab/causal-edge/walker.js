#!/usr/bin/env node

// @loom-layer: lab
//
// v3.5 Wave 2 - the OQ-27 read-side walker (the CONSUMER of the graph loop). Spike B's generalization
// of the W0.0 kernel provenance-walk leaf to the SEMANTIC multi-relation fan-out (caused_by /
// contradicts / cluster / related). ADVISORY: the walker's output is DATA for an orchestrator to RANK
// over - it never gates anything, and (v6 section 0a.3.1:175) a consumer MUST NOT splice traversedEdges
// into a peer spawn's prompt as instructions. It is read-only + SHADOW.
//
// PURE over a passed-in edge array (the provenance-walk.js purity precedent): NO I/O. The STORE does
// the bounded readJsonlBounded read and feeds records in - so the read/parse cost is bounded at the
// store boundary, and this leaf stays trivially testable + containment-clean (it does NOT import
// ./store). It reuses ONLY DEFAULT_MAX_NODES from the kernel provenance-walk leaf (lab->kernel = legal)
// + the closed-enum constants from the sibling ./enums. (HEX64 from provenance-walk is NOT reused:
// semantic block ids are free-form strings - the store validates them as control-char-free, length-
// capped, possibly-non-ASCII identifiers - NOT 64-hex content hashes, so HEX64 does not apply here.)
//
// NET-NEW traversal (NOT "generalize the leaf"): cluster/related are UNDIRECTED multi-edge walks and
// causal-chain is a DIRECTED forward walk - a different shape than provenance-walk's backward
// single-parent chain. So this owns a NEW indexByBlock adjacency index (provenance-walk's indexBy*
// key on transaction_id / post_state_hash, which edges do not have).
//
// R3 FILTER-THEN-INDEX (the load-bearing admission contract): isEligible() filters edges FIRST; the
// adjacency index is built ONLY from eligible edges; the traversal touches ONLY the index. So NO mode
// can ever surface an AUDIT-ONLY (unvalidated / surface_overlap_only) edge - the raw array is not
// reachable after indexing.

'use strict';

const { DEFAULT_MAX_NODES } = require('../../kernel/_lib/provenance-walk');
const { RELATIONS, WALKER_ELIGIBLE_STATUSES } = require('./enums');

const MODES = Object.freeze(['causal-chain', 'related', 'cluster']);

// Output bound for traversedEdges, SYMMETRIC with maxNodes (which bounds reachedBlocks). The walker is
// exported + PURE, so an external caller can pass an arbitrarily dense array; without this, traversedEdges
// is O(E)-unbounded (a complete graph yields ~N^2/2 edges) even though reachedBlocks is capped (VALIDATE
// hacker M1). In the live loop the store caps the ledger at MAX_LEDGER_RECORDS so this never bites there.
const DEFAULT_MAX_EDGES = 100000;

function isRecord(r) {
  return !!r && typeof r === 'object' && !Array.isArray(r);
}

function nonEmptyStr(v) {
  return typeof v === 'string' && v.length > 0;
}

function clampMaxNodes(opts) {
  const n = opts && Number.isInteger(opts.maxNodes) ? opts.maxNodes : DEFAULT_MAX_NODES;
  return n > 0 ? n : DEFAULT_MAX_NODES;
}

/**
 * R3 eligibility: an edge is walker-eligible IFF its faithfulness_status is in the eligible subset
 * (advisory_llm_checked / human_confirmed - NOT unvalidated / surface_overlap_only), its relation is a
 * known closed-enum relation, and BOTH endpoints are non-empty strings. This is the SOLE admission gate.
 *
 * @param {object} edge
 * @returns {boolean}
 */
function isEligible(edge) {
  return isRecord(edge)
    && WALKER_ELIGIBLE_STATUSES.includes(edge.faithfulness_status)
    && RELATIONS.includes(edge.relation)
    && nonEmptyStr(edge.source_block)
    && nonEmptyStr(edge.target_block)
    && nonEmptyStr(edge.edge_id); // VALIDATE code-reviewer HIGH-3: edge_id is the traversedEdges dedup
  //                                 key; without it, edges lacking an id collide on `undefined` and only
  //                                 one survives dedup. Requiring it at the sole admission gate closes that.
}

/**
 * Build the UNDIRECTED adjacency index: each edge is listed under BOTH its endpoints (so an undirected
 * walk from either end finds it). The caller passes ONLY eligible edges (R3 FILTER-THEN-INDEX) - this
 * function does NOT re-filter, so an ineligible edge passed in would be indexed; isEligible is the gate
 * and walk() applies it before calling here.
 *
 * @param {object[]} eligibleEdges
 * @returns {Map<string, object[]>} block_id -> incident edges
 */
function indexByBlock(eligibleEdges) {
  const idx = new Map();
  if (!Array.isArray(eligibleEdges)) return idx;
  const add = (block, e) => {
    const list = idx.get(block);
    if (list) list.push(e); else idx.set(block, [e]);
  };
  for (const e of eligibleEdges) {
    if (!isRecord(e)) continue;
    add(e.source_block, e);
    add(e.target_block, e);
  }
  return idx;
}

// The neighbor of `block` across edge `e` for a given mode, or null if `e` is not followable from
// `block` in that mode. UNDIRECTED (related/cluster): the other endpoint. DIRECTED (causal-chain): only
// the target, and only when `block` is the source.
function neighborOf(block, e, mode) {
  if (mode === 'causal-chain') {
    return e.source_block === block ? e.target_block : null;
  }
  return e.source_block === block ? e.target_block : e.source_block; // undirected
}

/**
 * Walk the causal-edge graph from a seed block. PURE + BOUNDED + CYCLE-SAFE.
 *
 * Modes:
 *   - 'cluster'      : the full UNDIRECTED connected component (bounded BFS).
 *   - 'related'      : depth-1 UNDIRECTED neighbors only.
 *   - 'causal-chain' : the DIRECTED forward reach (source -> target), bounded BFS.
 *
 * @param {string} seedBlock the block to start from.
 * @param {object[]} edges the candidate edge set (the store feeds this; may contain ineligible edges).
 * @param {{mode?: string, maxNodes?: number, maxDepth?: number, maxEdges?: number}} [opts]
 *        maxDepth: a positive integer caps traversal depth in 'cluster'/'causal-chain' (default
 *        unbounded); 'related' is always depth-1 regardless. maxEdges: caps |traversedEdges| (default
 *        DEFAULT_MAX_EDGES). maxNodes caps |reachedBlocks|.
 * @returns {{reachedBlocks: string[], traversedEdges: object[], truncated: boolean}}
 *          reachedBlocks INCLUDES the seed IFF seedBlock is a non-empty string (an invalid seed -> []).
 *          traversedEdges are the eligible edges actually used (deduped by edge_id), bounded by maxEdges
 *          - DATA for ranking, never instructions (section 0a.3.1:175). truncated=true if any cap bit.
 */
function walk(seedBlock, edges, opts = {}) {
  const mode = MODES.includes(opts.mode) ? opts.mode : 'cluster';
  const maxNodes = clampMaxNodes(opts);
  const maxEdges = Number.isInteger(opts.maxEdges) && opts.maxEdges > 0 ? opts.maxEdges : DEFAULT_MAX_EDGES;
  const maxDepth = mode === 'related'
    ? 1
    : (Number.isInteger(opts.maxDepth) && opts.maxDepth > 0 ? opts.maxDepth : Infinity);

  if (!nonEmptyStr(seedBlock)) return { reachedBlocks: [], traversedEdges: [], truncated: false };

  // R3 FILTER-THEN-INDEX: filter to eligible FIRST, index ONLY the eligible set; the raw array is not
  // touched again. An AUDIT-ONLY edge cannot enter the index, so no mode can surface it.
  const eligible = (Array.isArray(edges) ? edges : []).filter(isEligible);
  const idx = indexByBlock(eligible);

  const reached = new Set([seedBlock]);
  const traversed = [];
  const traversedIds = new Set();
  const queue = [{ block: seedBlock, depth: 0 }];
  let truncated = false;

  while (queue.length > 0) {
    const { block, depth } = queue.shift();
    if (depth >= maxDepth) continue;
    const incident = idx.get(block) || [];
    for (const e of incident) {
      const neighbor = neighborOf(block, e, mode);
      if (neighbor === null) continue; // not followable in this mode (directed: wrong way)
      if (!traversedIds.has(e.edge_id)) {
        if (traversed.length >= maxEdges) truncated = true; // M1: bound the output independent of input
        else { traversedIds.add(e.edge_id); traversed.push(e); }
      }
      if (reached.has(neighbor)) continue; // cycle-safe (seen-set)
      if (reached.size >= maxNodes) { truncated = true; continue; } // bounded
      reached.add(neighbor);
      queue.push({ block: neighbor, depth: depth + 1 });
    }
  }

  return { reachedBlocks: [...reached], traversedEdges: traversed, truncated };
}

module.exports = {
  walk,
  isEligible,
  indexByBlock,
  MODES,
};
