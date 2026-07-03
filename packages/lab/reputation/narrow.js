// @loom-layer: lab
//
// item-6 — the `narrow` HARNESS: the missing LIVE caller of the pure `recommendNarrowing` (reputation-gate.js,
// v3.10-W3). It is the IMPURE shell (reads the two stores) around the pure combinator, so reputation-gate.js
// stays I/O-free per its charter. Given a candidate persona set, it reads the reputation distribution + the
// breaker decision and returns the per-candidate advisory `proceed` | `down-weight` | `reroute`.
//
// NARROWS-ONLY, NEVER GATES: this returns an advisory the orchestrator MAY consult to narrow its OWN spawn
// choice (A3b — §0a.3.1-clean, the E11 precedent in agent-identity-reputation.md:500-505). It MUST NOT be wired
// to auto-skip a candidate or to a non-zero exit on `reroute`. Widening it to a GATE requires an authenticated
// minter (#273) + a new ADR — do not turn the advisory into an exclude.
//
// LIVE LANE (integrity != provenance, #273-open): it feeds the LIVE `projectReputation()` (source-marked,
// matches recommendNarrowing's guard) — NOT the A6 witnessed snapshot (architect VERIFY Q1: A6-mediation
// governs Lab->KERNEL WIDENING reads; a narrows-only orchestrator consumer is exempt). So it carries the same
// same-uid co-forge ceiling the whole SHADOW track carries; acceptable BECAUSE it narrows-only + gates nothing.
//
// Layer (K12, by PATH): packages/lab/, so `lab`. lab->lab imports only (reputation + circuit-breaker +
// persona-experiment); the pure combinator never learns the breaker's evaluate() shape (it stays in THIS
// harness — architect F3, information-hiding).

'use strict';

const { projectReputation } = require('./project');
const { recommendNarrowing } = require('./reputation-gate');
const { evaluate, DEFAULT_SOURCE } = require('../circuit-breaker/project');
const { canonicalPersonaKey } = require('../persona-experiment/canonical-persona-key');

// Match the projection's row keys: personaOf keys rows as `canonicalPersonaKey(raw) || raw`, and evaluate()
// canonicalizes its query the same way. recommendNarrowing looks up VERBATIM (reputation-gate.js:79,84), so a raw
// numbered-form candidate (`13-node-backend`) would miss its own down-weight row keyed `node-backend` -> no-row ->
// `proceed` (VERIFY-hacker HIGH-1, a laundering lever). Canonicalize each candidate BEFORE the pure fn.
//   - CASE-FOLD (VALIDATE-hacker MEDIUM): canonicalPersonaKey's BARE_SHAPE is lowercase-only, so a mixed-case
//     token (`Node-Backend`) falls back to RAW and misses its canonical `node-backend` down-weight row -> a proceed
//     launder. Lowercase FIRST so a mixed-case QUERY resolves to the canonical persona. (The complementary
//     mixed-case-RECORD half is a write-boundary normalization in verdict-attestation, a NAMED follow-up.)
//   - COERCE a non-string to a stable string (VALIDATE-hacker LOW): else `candidate:undefined` drops its key in the
//     JSON output and a downstream zip-by-candidate could misalign. A non-string persona key is a caller error ->
//     surface it as a stable (if odd) `no-row` -> `proceed`, never a dropped key.
function canonToken(c) {
  const s = (typeof c === 'string' ? c : String(c)).toLowerCase();
  return canonicalPersonaKey(s) || s;
}

/**
 * @param {Array<string>} candidates  persona keys eligible for a spawn (canonicalized here)
 * @param {object} [opts]  { now?, minEvidence?, passFloor?, projectReputationFn?, evaluateFn? }
 *                         projectReputationFn / evaluateFn are IN-PROCESS TEST SEAMS (default to the real store
 *                         readers), analogous to recommendNarrowing's injected breakerOf / emit-pr's armedEmitFn.
 *                         The CLI (the live caller) NEVER injects them — it always reads the real stores.
 * @returns {Array<{candidate, recommendation, reason, evidence}>}  the recommendNarrowing advisory (narrows-only)
 */
function narrow(candidates, opts = {}) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const projectFn = typeof o.projectReputationFn === 'function' ? o.projectReputationFn : projectReputation;
  const evalFn = typeof o.evaluateFn === 'function' ? o.evaluateFn : evaluate;
  const cands = (Array.isArray(candidates) ? candidates : []).map(canonToken);

  // FAIL-LOUD (VERIFY-hacker MED-1): a store-read fault is an operator-visible fault, NOT an advisory `proceed`.
  // Do NOT wrap this in try/catch — a swallowed throw defaulting to proceed would launder the whole reputation axis.
  const reputation = projectFn({ now: o.now });

  // HARD-PIN the breaker source to the LIVE default `verdict-fail` (VERIFY-hacker HIGH-2): passing `source`
  // EXPLICITLY makes resolveSourceId ignore the LOOM_BREAKER_SOURCE env, so a poisoned env can't repoint axis B
  // at a STARVED store and silence a reroute. The try/catch degrades a breaker THROW to null (no-signal) — the
  // ONLY legal fail-safe swallow (a dead breaker omits ONE of two independent axes; recommendNarrowing pins this).
  const breakerOf = (c) => {
    try {
      return evalFn({ persona: c, source: DEFAULT_SOURCE, now: o.now });
    } catch (e) {
      // Degrade to no-signal (recommendNarrowing treats null as "no breaker axis"). A STARVED source does NOT
      // throw (it returns source_starved:true, surfaced via evidence) — so this only fires on an UNEXPECTED evalFn
      // defect; emit a diagnostic rather than swallow it silently (CodeRabbit nitpick; fundamentals no-silent-catch).
      process.stderr.write(`reputation: narrow breakerOf(${c}) threw - degrading to no-signal: ${e && e.message}\n`);
      return null;
    }
  };

  return recommendNarrowing(cands, reputation, breakerOf, { minEvidence: o.minEvidence, passFloor: o.passFloor });
}

module.exports = { narrow, canonToken };
