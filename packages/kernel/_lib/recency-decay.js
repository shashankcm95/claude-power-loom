// packages/kernel/_lib/recency-decay.js
//
// Pure recency-decay leaf. EXTRACTED from runtime trust-scoring.js (v3.4 Wave 2) so non-runtime
// callers — e.g. the Lab's E4 reputation projection — can depend on the decay RULE without importing
// the runtime identity STATE module (the Lab containment boundary, RFC §2 Layer 3; the Wave-0
// canonical-json precedent). trust-scoring.js re-exports computeRecencyDecay + RECENCY_HALF_LIFE_DAYS
// VERBATIM (back-compat — same function object, observable behavior unchanged; the M1 no-drift rule).
//
// computeRecencyDecayAt(history, nowMs) is the INJECTABLE core (deterministic — E4 needs a pinned
// `now`; verify-plan HIGH-2). computeRecencyDecay(history) is the Date.now() wrapper (the runtime's
// existing single-arg contract).
//
// NOTE (verify-plan HIGH-1): the contract reads `entry.ts`. A consumer whose records use a different
// timestamp field (e.g. the verdict-attestation store's `recorded_at`) MUST adapt to `{ts: <iso>}`
// before calling — else every entry is skipped and the result is null.
// NOTE (verify-plan MEDIUM-1): RECENCY_HALF_LIFE_DAYS (a decay WEIGHT, a time-constant in days) is
// INDEPENDENT of the verdict-attestation store's DEFAULT_EXPIRES_AFTER_DAYS (a ledger SIZE bound).
// They are coincidentally both 30, NOT the same knob — do not "DRY" them into one constant.

'use strict';

// H.7.0 — recency decay TIME-CONSTANT τ (days). NOTE (verify-plan honesty Finding 4): despite the
// legacy name, the formula exp(-d/τ) is a time-constant decay, NOT a true half-life — at d=τ the
// factor is e⁻¹≈0.37 (a half-life would give 0.5 via exp(-d·ln2/τ)). Name kept for back-compat
// (runtime re-exports it); the value (30) is unchanged.
const RECENCY_HALF_LIFE_DAYS = 30;

/**
 * Mean recency-decay factor over a history: mean of exp(-ageDays / RECENCY_HALF_LIFE_DAYS) for each
 * entry with a parseable `ts`. `nowMs` is injected so callers can be deterministic. OBSERVABLE-ONLY
 * (display/advisory). Empty / no-parseable-entry → null.
 *
 * @param {Array<{ts:string}>} history
 * @param {number} nowMs  the reference wall-clock (ms)
 * @returns {number|null} factor in (0,1], or null
 */
function computeRecencyDecayAt(history, nowMs) {
  if (!Array.isArray(history) || history.length === 0) return null;
  const factors = [];
  for (const entry of history) {
    if (!entry || typeof entry.ts !== 'string') continue;
    const t = Date.parse(entry.ts);
    if (!Number.isFinite(t)) continue;
    const dDays = Math.max(0, (nowMs - t) / (1000 * 60 * 60 * 24));
    factors.push(Math.exp(-dDays / RECENCY_HALF_LIFE_DAYS));
  }
  if (factors.length === 0) return null;
  return factors.reduce((a, b) => a + b, 0) / factors.length;
}

/**
 * Back-compat single-arg wrapper (the runtime's existing contract — uses live wall-clock).
 * @param {Array<{ts:string}>} history
 * @returns {number|null}
 */
function computeRecencyDecay(history) {
  return computeRecencyDecayAt(history, Date.now());
}

module.exports = { computeRecencyDecay, computeRecencyDecayAt, RECENCY_HALF_LIFE_DAYS };
