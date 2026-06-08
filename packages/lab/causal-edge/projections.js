#!/usr/bin/env node

// @loom-layer: lab
//
// v3.5 Wave 3a - the `conflicted` projection (D2): a PURE Lab projection over the causal-edge set. The
// Wave-0 kernel provenance-projections ANTICIPATED `conflicted` as a kernel derivedLifecycleState, but D1
// (Wave 2) moved the contradicts edge into THIS advisory Lab store, and the kernel CANNOT read Lab (K12
// inner->outer) - so `conflicted` can only be computed HERE, in the Lab layer, over the edge set. Mirrors
// the provenance-projections pure-over-passed-in-set style (the STORE does the bounded read + feeds edges
// in); emits NO record (a re-derivable view, not a stored state).
//
// Two advisory tiers (ANNOTATION, retrieval-eligible - NEVER suppression; RFC section 3.1 / the security
// finding: `conflicted` annotates a block, it does not hide it):
//   confirmed - a block that is an endpoint of an R3-ELIGIBLE (advisory_llm_checked / human_confirmed)
//               contradicts edge (a JUDGED conflict).
//   candidate - a block touched ONLY by unjudged (unvalidated / surface_overlap_only) contradicts edges
//               (a flagged-but-unjudged conflict). CONFIRMED WINS: one eligible contradicts edge makes the
//               block confirmed regardless of co-existing unjudged edges (F2 precedence).
//
// THE CONTRADICTS PRE-FILTER IS LOAD-BEARING (VERIFY code-reviewer F3): walker.isEligible admits ALL 9
// relations, so filtering by isEligible ALONE would let a caused_by / advisory_llm_checked edge FALSELY
// mark its endpoints conflicted. The gate is `relation === 'contradicts' && isEligible(edge)` - filter to
// contradicts FIRST, THEN apply eligibility. Scoped to contradicts ONLY in 3a; 3b's quarantine/dedup
// states are a SEPARATE projection (a 3b builder must not assume conflictedBlocks covers them).
//
// Layer discipline (K12, by PATH): under packages/lab/, so `lab`. Imports ONLY the sibling ./walker
// (isEligible reuse - DRY; provenance-walk transitively via the walker). PURE: no ./store, no env, no I/O.
// SHADOW - read-side projection only, never a kernel gate, never a hooks.json ref.

'use strict';

const { isEligible } = require('./walker');

// The one relation flag-conflict / conflicted operate on. A const (not an ./enums import) keeps the dep
// surface to the single sibling ./walker; isEligible already validates relation membership.
const CONTRADICTS = 'contradicts';

function isRecord(r) {
  return !!r && typeof r === 'object' && !Array.isArray(r);
}

function nonEmptyStr(v) {
  return typeof v === 'string' && v.length > 0;
}

/**
 * conflicted projection: map each block touched by a `contradicts` edge to its conflict tier + the
 * incident contradicts edges. PURE over a passed-in edge array (the store feeds listEdges() in). A block
 * is `confirmed` iff it has >=1 R3-eligible contradicts edge; `candidate` iff ALL its contradicts edges
 * are unjudged. Non-contradicts edges are IGNORED (the load-bearing pre-filter). Annotation, never
 * suppression - it surfaces both endpoints; it neither mutates nor filters the input set.
 *
 * @param {object[]} edges the candidate edge set (any relation / status; ineligible records tolerated)
 * @returns {Map<string, {tier: 'confirmed'|'candidate', edges: object[]}>} block_id -> conflict annotation
 */
function conflictedBlocks(edges) {
  const result = new Map();
  if (!Array.isArray(edges)) return result;

  // PRE-FILTER to contradicts edges with both endpoints present FIRST (F3): isEligible admits all 9
  // relations, so eligibility alone would falsely conflict a caused_by edge's endpoints.
  const contradicts = edges.filter((e) => isRecord(e)
    && e.relation === CONTRADICTS
    && nonEmptyStr(e.source_block)
    && nonEmptyStr(e.target_block));

  // Annotate a block with an incident contradicts edge. `confirmed` is monotonic + order-independent:
  // once any eligible contradicts edge touches a block it stays confirmed (F2), and an unjudged edge
  // never demotes it.
  const annotate = (block, edge, confirmed) => {
    let entry = result.get(block);
    if (!entry) { entry = { tier: 'candidate', edges: [] }; result.set(block, entry); }
    entry.edges.push(edge);
    if (confirmed) entry.tier = 'confirmed';
  };

  for (const e of contradicts) {
    const confirmed = isEligible(e); // e is already a contradicts edge -> eligibility == judged (advisory/human)
    annotate(e.source_block, e, confirmed);
    annotate(e.target_block, e, confirmed);
  }
  return result;
}

module.exports = { conflictedBlocks, CONTRADICTS };
