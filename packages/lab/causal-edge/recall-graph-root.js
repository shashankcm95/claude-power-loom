#!/usr/bin/env node

// @loom-layer: lab
//
// Track A W2 (blueprint 3b) - the PURE recall-graph root: a content-addressed digest over the SET of
// recall nodes (+ confirmed-by edges) that an emit-time recall drew from, pinned onto the `live_pending`
// node's sealed body. In SHADOW the Wave-1 recall boundary exposes a rendered TEXT block, never node/edge
// ids, and recall is empty-until-armed - so this wave always digests the EMPTY set (a deterministic
// constant). Surfacing the real admitted-node ids for a non-empty root is a boundary extension, arming-gated
// (a named residual in the plan). The SHAPE is reserved now so the pin field exists before arming.
//
// DOMAIN-SEPARATED (VERIFY architect M1 / hacker M2): the two id-sets are hashed as a STRUCTURE
// `{nodes, edges}`, NOT a flattened `[...nodes, ...edges]` concat - a flat concat collides
// (`nodes=[a],edges=[b,c]` and `nodes=[a,b],edges=[c]` both canonicalize to `["a","b","c"]`). Each set is
// sorted for order-independence (a set has no inherent order; the root must not depend on insertion order).
//
// PURE: no I/O, no state, no input mutation. Mirrors the `sha256(canonicalJsonSerialize(...))` digest idiom
// of transaction-record.js + both world-anchor stores (invent no new hasher).

'use strict';

const crypto = require('crypto');
const { canonicalJsonSerialize } = require('../../kernel/_lib/canonical-json');

// Coerce to a sorted array of unique string ids (a set is order-free + dup-free). A non-array or a
// non-string element is dropped rather than thrown - this is a total, fail-soft helper on the mint path.
function toSortedIdSet(ids) {
  if (!Array.isArray(ids)) return [];
  const seen = new Set();
  for (const v of ids) { if (typeof v === 'string' && v.length > 0) seen.add(v); }
  return [...seen].sort();
}

/**
 * The content-addressed root over an emit-time recall set. Order-independent (each id-set is sorted) and
 * domain-separated (nodes vs edges as distinct keys). The empty-set root is a deterministic constant.
 * @param {string[]} [nodeIds] the admitted recall-node ids drawn from (empty in SHADOW)
 * @param {string[]} [edgeIds] the confirmed-by edge ids drawn from (empty in SHADOW)
 * @returns {string} 64-hex recall_graph_root
 */
function computeRecallGraphRoot(nodeIds, edgeIds) {
  const basis = { nodes: toSortedIdSet(nodeIds), edges: toSortedIdSet(edgeIds) };
  return crypto.createHash('sha256').update(canonicalJsonSerialize(basis)).digest('hex');
}

// The SHADOW constant: the root of the empty recall set. Exposed so the writer + tests reference the single
// source of truth rather than re-deriving it (and so a reader can assert "this node drew from no recall").
const EMPTY_RECALL_GRAPH_ROOT = computeRecallGraphRoot([], []);

module.exports = { computeRecallGraphRoot, EMPTY_RECALL_GRAPH_ROOT };
