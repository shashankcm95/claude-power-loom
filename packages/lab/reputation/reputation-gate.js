#!/usr/bin/env node

// @loom-layer: lab
//
// v3.10-W3 — the reputation-gate ADVISORY consumer: the spawn-narrowing decision that closes the reputation
// loop INTERNALLY (a PURE, consumable function; production stays OPEN until a future enforcement wave wires it
// into selection). Given a candidate set + a projectReputation output + a per-candidate breaker decision, it
// recommends `proceed` | `down-weight` | `reroute` -- NEVER a hard `exclude` (the breaker is SHADOW and
// projectReputation self-labels "advisory ... NOT a quality score").
//
// THE VERIFY-BOARD LOAD-BEARING DESIGN (architect HIGH + hacker HIGH x3): the inputs are THREE INDEPENDENT
// axes, evaluated SEPARATELY (fail-safe to NO-SIGNAL per axis) and combined by MOST-restrictive -- NOT a single
// short-circuit ladder. A ladder let one axis's "insufficient" swallow another's real signal:
//   - reputation VOLUME (thinness) must NOT swallow a TRIPPED breaker (a denial-rate safety signal). [arch HIGH]
//   - a STARVED breaker source must NOT neutralize the reputation down-weight axis (else one env var,
//     LOOM_BREAKER_SOURCE, disables the whole advisory). [hacker HIGH]
//   - a stripped/NaN `by_verdict` that cleared minEvidence must NOT launder to `proceed` (it down-weights
//     `unreadable-distribution`). [hacker HIGH]
//
// THE AUTHENTICATED-LANE MARKER (VALIDATE-hacker MED -- honest scope): the `source === SOURCE` check is a
// MIS-WIRE GUARD, NOT a cryptographic authentication. It catches a careless caller passing the W1/W2
// hardening-signal mirror (or any non-projectReputation object) -- it does NOT prove the rows came from the
// kernel-attested store (a caller fully controls its own input; the REAL authentication is UPSTREAM, in the
// verdict-attestation store the harness reads). Defense-in-depth FAILS TOWARD NARROWING: a malformed/inconsistent
// row (`total !== sum(by_verdict)`, a non-int/negative total, a duplicate persona key) is treated as
// `unreadable-distribution`/`duplicate-row` -> down-weight, never laundered to proceed.
//
// PURE -- no I/O; the harness reads the stores + pins `breakerOf` to the LIVE default source `verdict-fail`
// (non-starved; the SAME kernel-attested store feeds both axes).

'use strict';

const { SOURCE } = require('./project'); // 'verdict-attestation' -- the mis-wire marker

const DEFAULTS = Object.freeze({ minEvidence: 5, passFloor: 0.5 });

const isInt = (n) => Number.isInteger(n);
// Coerce caller opts (VALIDATE-hacker LOW): an out-of-range/NaN/Infinity opt must fall back to the DEFAULT, not
// silently disable an axis (minEvidence:NaN -> total>=NaN is always false -> axis A off; passFloor:0 -> never down-weight).
const coerceMinEvidence = (v) => (Number.isInteger(v) && v >= 0 ? v : DEFAULTS.minEvidence);
const coercePassFloor = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : DEFAULTS.passFloor);

function proceedAll(candidates, reason) {
  return candidates.map((c) => ({
    candidate: c, recommendation: 'proceed', reason,
    evidence: { total: 0, pass_ratio: null, readable: false, breaker_tripped: false, source_starved: false },
  }));
}

/**
 * @param {Array<string>} candidates  persona keys eligible for a spawn
 * @param {object} reputation         a projectReputation output (MUST be the authenticated verdict lane)
 * @param {Function|null} breakerOf   candidate -> a breaker evaluate() decision OBJECT or null (MUST NOT throw;
 *                                    a throw is caught as null -- the consumer never passes requireLive)
 * @param {object} [opts]             { minEvidence?, passFloor? }
 * @returns {Array<{candidate, recommendation, reason, evidence}>}
 */
function recommendNarrowing(candidates, reputation, breakerOf, opts = {}) {
  // coerce `opts` itself before any property read (CodeRabbit #326): `opts = {}` only catches `undefined`, so a
  // `null`/non-object `opts` would crash on `opts.minEvidence`. A pure consumer falls back to defaults instead.
  const o = (opts && typeof opts === 'object') ? opts : {};
  const minEvidence = coerceMinEvidence(o.minEvidence);
  const passFloor = coercePassFloor(o.passFloor);
  const cands = Array.isArray(candidates) ? candidates : [];

  // STRUCTURAL GUARD (the authenticated-lane MIS-WIRE marker): a mirror / mis-wire never narrows trust.
  if (!reputation || reputation.source !== SOURCE || !Array.isArray(reputation.personas)) {
    return proceedAll(cands, 'unauthenticated-lane');
  }

  // Map-keyed row index (null-proto safe; a `__proto__`/`constructor` persona key must not walk the prototype).
  // A DUPLICATE persona key is a malformed/tampered signal (the real projectReputation never emits one --
  // additive accumulation) -> flag it so the candidate FAILS TOWARD NARROWING (VALIDATE-hacker MED).
  const rowOf = new Map();
  const dupKeys = new Set();
  for (const p of reputation.personas) {
    if (p && typeof p.persona === 'string') {
      if (rowOf.has(p.persona)) dupKeys.add(p.persona);
      rowOf.set(p.persona, p);
    }
  }

  return cands.map((c) => {
    const row = rowOf.get(c) || null;

    // --- AXIS A: reputation distribution (the down-weight axis). Fires ONLY on sufficient + CONSISTENT evidence. ---
    let aSignal = 'proceed';
    let aReason = null;
    let pass_ratio = null;
    let readable = false;
    let evidenceTotal = 0;
    if (dupKeys.has(c)) {
      aSignal = 'down-weight'; aReason = 'duplicate-row';            // ambiguous attribution -> narrow, never launder
    } else if (row) {
      const total = row.total;
      if (!isInt(total) || total < 0) {
        aSignal = 'down-weight'; aReason = 'unreadable-distribution'; // a malformed total -> narrow
      } else {
        evidenceTotal = total;
        if (total >= minEvidence && total > 0) {                     // `total > 0` guards a minEvidence:0 divide-by-zero
          const bv = row.by_verdict;
          const okBv = bv && isInt(bv.pass) && isInt(bv.partial) && isInt(bv.fail)
            && bv.pass >= 0 && bv.partial >= 0 && bv.fail >= 0 && (bv.pass + bv.partial + bv.fail) === total;
          if (okBv) {
            readable = true;
            pass_ratio = bv.pass / total;                            // `partial` counts as NON-passing (pinned)
            if (pass_ratio < passFloor) { aSignal = 'down-weight'; aReason = 'poor-distribution'; }
          } else {
            // cleared minEvidence but the distribution is unreadable/INCONSISTENT -> NARROW; never launder.
            aSignal = 'down-weight'; aReason = 'unreadable-distribution';
          }
        } // else thin (total < minEvidence, incl 0) -> NO down-weight signal (but does NOT suppress axis B)
      }
    }

    // --- AXIS B: breaker (the reroute axis), INDEPENDENT of reputation volume. Snapshot the booleans INSIDE the
    // try (VALIDATE-hacker HIGH): a THROWING getter on `.tripped`/`.source_starved` must degrade to no-signal,
    // not crash the consumer (the prior try wrapped only the breakerOf CALL, not the property reads). ---
    let source_starved = false;
    let breaker_tripped = false;
    try {
      const brk = breakerOf ? breakerOf(c) : null;
      if (brk) {
        source_starved = brk.source_starved === true;
        // a starved source contributes NOTHING (but does not suppress axis A).
        breaker_tripped = !source_starved && !!(brk.tripped || brk.global_tripped || brk.persona_tripped);
      }
    } catch { source_starved = false; breaker_tripped = false; }     // any throw -> no breaker signal
    const bSignal = breaker_tripped ? 'reroute' : 'proceed';

    // --- COMBINE by MOST-restrictive (reroute > down-weight > proceed). ---
    let recommendation;
    let reason;
    if (bSignal !== 'proceed') {
      recommendation = bSignal; reason = 'breaker-tripped';
    } else if (aSignal !== 'proceed') {
      recommendation = aSignal; reason = aReason;
    } else {
      recommendation = 'proceed';
      reason = !row ? 'no-row' : (evidenceTotal === 0 || evidenceTotal < minEvidence ? 'insufficient-evidence' : 'sufficient-pass');
    }

    return { candidate: c, recommendation, reason, evidence: { total: evidenceTotal, pass_ratio, readable, breaker_tripped, source_starved } };
  });
}

module.exports = { recommendNarrowing, DEFAULTS };
