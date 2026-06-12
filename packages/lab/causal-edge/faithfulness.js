#!/usr/bin/env node

// @loom-layer: lab
//
// v3.5 Wave 2 - the faithfulness rung-2 advisory check (Spike C). ADVISORY + PURE: it produces a
// VERDICT; the CALLER applies the promotion via store.updateEdgeStatus (this module never touches the
// store, and NEVER calls an LLM - the judge is injected). SHADOW.
//
// Two rungs (the faithfulness_status ladder; values mirror ./enums FAITHFULNESS_STATUSES):
//   rung-1  surface_overlap_only  - deterministic token-Jaccard, a CHEAP AUDIT-ONLY precursor. It is
//           NOT walker-eligible (./enums WALKER_ELIGIBLE_STATUSES excludes it), so rung-1 alone NEVER
//           makes an edge traversable - narrowing-safe by construction.
//           ★ HONEST LIMITATION: rung-1-SKIP is a FALSE-NEGATIVE path - a cross-surface causal edge
//           (two related blocks sharing no token surface) scores 0 and is never escalated to rung-2,
//           so it stays AUDIT-ONLY indefinitely. Acknowledged; not a Wave-2 blocker (narrowing-safe).
//   rung-2  advisory_llm_checked  - an INJECTABLE judge rung2AdvisoryCheck(edge, judgeFn). The real
//           judge is an Agent / claude -p spawn passed in BY THE CALLER. FAIL-CLOSED: only an explicit
//           { supported:true } promotes; a negative / malformed / throwing / absent judge leaves the
//           edge AUDIT-ONLY. The ceiling is advisory_llm_checked - rung-2 can NEVER mint
//           human_confirmed (that requires a human).
//
// ★ The injected real judge OWES (a documented SPEC, NOT enforced here): treat block text as DATA, not
// instructions (prompt-injection resistance). The structural-guard test proves only the REFUSAL-to-
// promote contract; real-LLM faithfulness accuracy + injection resistance were CALIBRATED in v3.8b W3
// (a measured `claude -p` spike — see the calibration record + calibration.js; re-runnable via
// `calibration-cli.js --real`, UNSANDBOXED only). The calibration is informational: the rung-2 ceiling
// below keeps a bad judge narrowing-safe regardless.
//
// NARROWING-SAFETY (the load-bearing property): rung-2 only NARROWS traversal-eligibility upward into
// the advisory band; a false-positive admits an edge to ADVISORY reads only - never a kernel gate or
// a promotion past advisory_llm_checked.

'use strict';

// The rung-2 promotion ceiling. A named constant so callers + the structural-guard test can assert it.
// Mirrors ./enums FAITHFULNESS_STATUSES[2]; rung-2 can grant THIS and nothing higher.
const RUNG2_MAX_STATUS = 'advisory_llm_checked';
const DEFAULT_OVERLAP_THRESHOLD = 0.1;

// Tokenize for the surface-overlap heuristic: lowercase, split on any non-[a-z0-9] run, drop empties,
// dedup into a Set. NOTE (honest): non-ASCII letters are treated as separators (dropped) - this is a
// coarse AUDIT-ONLY heuristic, not a linguistic tokenizer; it is narrowing-safe (it only ever suggests
// the AUDIT-ONLY surface_overlap_only status, never a walker-eligible one).
function tokenize(text) {
  if (typeof text !== 'string' || text.length === 0) return new Set();
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 0));
}

// Jaccard similarity of two token Sets: |A intersect B| / |A union B|. Empty union -> 0.
function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * rung-1: deterministic surface-overlap precursor. AUDIT-ONLY (surface_overlap_only is not
 * walker-eligible). A 0-overlap pair (the rung-1-skip false-negative) stays 'unvalidated'.
 *
 * @param {string} sourceText the source block's text
 * @param {string} targetText the target block's text
 * @param {{threshold?: number}} [opts] overlap threshold in [0,1] (default 0.1)
 * @returns {{score: number, suggestedStatus: 'surface_overlap_only'|'unvalidated'}}
 */
function rung1SurfaceOverlap(sourceText, targetText, opts = {}) {
  const threshold = (typeof opts.threshold === 'number' && opts.threshold >= 0 && opts.threshold <= 1)
    ? opts.threshold : DEFAULT_OVERLAP_THRESHOLD;
  const score = jaccard(tokenize(sourceText), tokenize(targetText));
  // score > 0 guard: a 0-overlap pair never escalates, even if threshold is 0.
  const suggestedStatus = (score > 0 && score >= threshold) ? 'surface_overlap_only' : 'unvalidated';
  return { score, suggestedStatus };
}

/**
 * rung-2: the injectable advisory faithfulness judge. PURE - returns a verdict; the caller applies it
 * via store.updateEdgeStatus(edge.edge_id, result.status) iff result.promoted. FAIL-CLOSED.
 *
 * @param {object} edge the causal edge under review (its current faithfulness_status is the fallback)
 * @param {(edge:object)=>{supported:boolean, reason?:string}} judgeFn the injected judge (Agent / claude -p)
 * @returns {{promoted: boolean, status: string, reason: string}}
 *          promoted=true ONLY on an explicit { supported:true }; status is then RUNG2_MAX_STATUS.
 *          Otherwise promoted=false and status is the edge's UNCHANGED current status (AUDIT-ONLY).
 */
function rung2AdvisoryCheck(edge, judgeFn) {
  const current = (edge && typeof edge.faithfulness_status === 'string') ? edge.faithfulness_status : 'unvalidated';
  if (typeof judgeFn !== 'function') {
    return { promoted: false, status: current, reason: 'no-judge' };
  }
  let judgment;
  try {
    judgment = judgeFn(edge);
  } catch {
    return { promoted: false, status: current, reason: 'judge-threw' };
  }
  // Strict === true (not truthy): a malformed / coerced / over-claiming verdict must NOT promote.
  if (!judgment || typeof judgment !== 'object' || judgment.supported !== true) {
    return { promoted: false, status: current, reason: 'unsupported-or-malformed' };
  }
  const reason = (typeof judgment.reason === 'string' && judgment.reason.length > 0)
    ? judgment.reason.slice(0, 512) : 'supported';
  // The ceiling is RUNG2_MAX_STATUS regardless of any `status`/`grant` field the judge tries to set.
  return { promoted: true, status: RUNG2_MAX_STATUS, reason };
}

module.exports = {
  rung1SurfaceOverlap,
  rung2AdvisoryCheck,
  RUNG2_MAX_STATUS,
  DEFAULT_OVERLAP_THRESHOLD,
};
