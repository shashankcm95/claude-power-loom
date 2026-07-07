// packages/kernel/_lib/recurrence-lifecycle.js
//
// Pure recurrence-classification leaf — the DETECTION half of the graduate/retire lifecycle,
// EXTRACTED from self-improve-store.js so the organ is named ONCE (ADR-0020, which corrects
// ADR-0018's over-scoped "extract the lifecycle" mandate). Placed in kernel `_lib` — the legal
// inward-import target per the dependency-rule — mirroring recency-decay.js / canonical-json.js.
//
// WHY a leaf and not a unified lifecycle: the 2026-07-06 recon found the lifecycle is BUILT ONCE
// (this consumer). The lab causal-edge organ is a DIFFERENT mechanism (content-addressed tally +
// cross-run confirmation + Wilson gate + tombstone), sharing zero code; scars are discipline-only.
// So this leaf is the genuinely-common DETECTION predicate only. It NEVER names a terminal state
// (rule vs gated-recall) — each substrate owns its EXIT handler, preserving ADR-0018 fork #3.
//
// PURE: no I/O, no Date, no mutation. The convergence gate is a span between two STORED timestamps
// (not age-from-now), so no clock is needed. Kept ADVISORY-safe: firstSeenMs/lastSeenMs are read
// from an open-writable counters file and are NOT authenticated (integrity != provenance) — a
// converged drift class is risk:high and never auto-graduates, so a forged span cannot drive an
// action. If this ever gates an ACTION, the timestamps must come from an authenticated writer.

'use strict';

/**
 * The lifecycle DETECTION stages. Frozen so a caller cannot mutate the vocabulary.
 * @readonly
 */
const STAGE = Object.freeze({
  BELOW_THRESHOLD: 'below-threshold',       // count has not reached the candidate threshold
  DEFERRED_CROSS_WINDOW: 'deferred-cross-window', // reached threshold inside a single arc; wait for a later window
  CANDIDATE: 'candidate',                   // a real candidate, not (yet) auto-graduate-eligible
  GRADUATE_ELIGIBLE: 'graduate-eligible',   // low-risk + count >= auto-graduate threshold
});

/**
 * @typedef {{count:number, firstSeenMs:number, lastSeenMs:number}} Tally
 * @typedef {{candidateThreshold:number, autoGraduateThreshold:number, lowRisk:boolean,
 *            requiresCrossWindow:boolean, crossWindowSpanMs:number}} Policy
 */

/**
 * Cross-window convergence gate: has the observed span exceeded the policy's window?
 * STRICT `>` (mirrors self-improve-store hasConvergenceSpan). Non-finite timestamps -> false
 * (fail-closed: defer a record we cannot date rather than pass it).
 * @param {Tally} tally
 * @param {Policy} policy
 * @returns {boolean}
 */
function hasConverged(tally, policy) {
  const a = tally && tally.firstSeenMs;
  const b = tally && tally.lastSeenMs;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return (b - a) > policy.crossWindowSpanMs;
}

/**
 * Auto-graduate eligibility: low-risk AND count at/over the auto-graduate threshold. The predicate
 * duplicated verbatim in self-improve-store at the existing-candidate and new-candidate paths.
 * NOTE: this gate deliberately does NOT apply the cross-window check — an already-admitted candidate
 * is never re-gated (the store's existing-path uses this directly).
 * @param {Tally} tally
 * @param {Policy} policy
 * @returns {boolean}
 */
function isGraduateEligible(tally, policy) {
  const count = (tally && tally.count) || 0;
  return policy.lowRisk === true && count >= policy.autoGraduateThreshold;
}

/**
 * Classify a signal's recurrence into a lifecycle stage. Order preserves self-improve-store's
 * NEW-candidate path exactly: below-threshold, then the cross-window DEFER (store :543), then
 * graduate-eligibility (store :562), else a plain candidate. Deferral is checked BEFORE graduation
 * so a (hypothetical future) low-risk + cross-window signal defers until its window opens rather
 * than auto-graduating inside a single arc.
 * @param {Tally} tally
 * @param {Policy} policy
 * @returns {string} one of STAGE.*
 */
function classifyRecurrence(tally, policy) {
  const count = (tally && tally.count) || 0;
  if (count < policy.candidateThreshold) return STAGE.BELOW_THRESHOLD;
  if (policy.requiresCrossWindow && !hasConverged(tally, policy)) return STAGE.DEFERRED_CROSS_WINDOW;
  if (isGraduateEligible(tally, policy)) return STAGE.GRADUATE_ELIGIBLE;
  return STAGE.CANDIDATE;
}

module.exports = { STAGE, hasConverged, isGraduateEligible, classifyRecurrence };
