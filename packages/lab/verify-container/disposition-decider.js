'use strict';

// @loom-layer: lab
//
// disposition-decider.js (VC-W2a) — the PURE anti-bypass disposition decider for the verify gate. Maps a
// verify verdict to EMIT / BLOCK, keyed on the (result_class, reason, resolved) triple — NEVER on `passed`
// alone (a `passed=null` collides across loom-side and candidate-side causes; honesty VERIFY). DEFAULT
// fail-CLOSED (BLOCK): a can't-verify state is exactly what an adversarial candidate manufactures.
//
// EMIT gates on the SEALED regression `resolved===true` (every sealed fail_to_pass flips AND no
// pass_to_pass regressed, via evaluateOutcome), NEVER a gameable `observed-pass` (hacker VERIFY C1 — a
// candidate ships one trivially-green test and its real regression stays `missing` => `all-observed-pass`).
// So on the LIVE path (no sealed set threaded => `resolved` absent) every CONTAINED_RESULT BLOCKs as
// `unsealed-pass` until O-TESTS lands (the whole-suite / sealed-FTP regression oracle). The ONLY loom-side
// fail-OPEN is `no-attested-backend` (no Docker host, decided BEFORE any candidate code runs => not
// candidate-influenced); every other SETUP_FAILURE reason (containment-uncertain, backend-threw [conflates
// a candidate applyPatch throw until the adapter splits it], candidate-patch-apply-failed) is
// candidate-attributable-or-ambiguous => BLOCK.
//
// UNWIRED: no consumer calls this yet (VC-W2b wires it behind a strict flag via the Option-C async
// pre-gate adapter; the kernel emitPR stays sync + unchanged). QUALITY not TRUST — the disposition never
// feeds a trust weight / world_anchored / LIVE_SOURCES (OQ-NS-6; #273-disjoint).

const { RESULT_CLASS } = require('../issue-corpus/container-adapter');

// the KNOWN candidate-attributable-or-ambiguous SETUP_FAILURE reasons that are safe to echo for audit; ANY
// other (unknown / hostile) reason maps to the fixed `setup-unknown` so a raw attacker-length string is never
// echoed verbatim into a downstream log / PR / sandbox-profile sink (VALIDATE-hacker M2 — latent when wired).
const SETUP_BLOCK_REASONS = Object.freeze(['containment-uncertain', 'candidate-patch-apply-failed', 'backend-threw']);

function decision(emit, reason) { return Object.freeze({ emit: emit === true, reason }); }

/**
 * @param {{ result_class?: string, reason?: string, resolved?: boolean }} verdict
 *   `resolved` is the SEALED-regression outcome (true = sealed FTP flip + no PTP regress; false = a sealed
 *   red; absent/undefined = no sealed set was threaded, i.e. the live path).
 * @returns {{ emit: boolean, reason: string }} FROZEN; emit:true ONLY on a sealed `resolved===true` pass
 *   or the loom-side infra advisory. Every other case fail-CLOSED (emit:false).
 */
function decideDisposition(verdict) {
  const v = verdict && typeof verdict === 'object' ? verdict : {};
  // read OWN properties only — an inherited (Object.create prototype-chain) field must not reach EMIT
  // (VALIDATE-hacker M1; the verdict is a trusted producer's own-prop literal today, this is defense-in-depth).
  const own = (k) => Object.prototype.hasOwnProperty.call(v, k);
  const rc = own('result_class') ? v.result_class : undefined;
  const reason = own('reason') && typeof v.reason === 'string' ? v.reason : '';
  const resolved = own('resolved') ? v.resolved : undefined;

  if (rc === RESULT_CLASS.CONTAINED_RESULT) {
    // EMIT ONLY on the SEALED regression pass — never a gameable observed-pass (C1). STRICT === true.
    if (resolved === true) return decision(true, 'resolved');
    if (resolved === false) return decision(false, 'sealed-regression-failed');
    // `resolved` absent => no sealed set threaded (the live path) => NOT trustworthy => BLOCK.
    if (reason === 'all-observed-pass') return decision(false, 'unsealed-pass');
    if (reason === 'test-failed') return decision(false, 'test-failed');
    if (reason === 'no-observed-tests') return decision(false, 'zero-observed-signal');
    return decision(false, 'contained-unsealed-unknown');
  }

  if (rc === RESULT_CLASS.KILLED_FOR_DOS) {
    // anti-bypass: a candidate that DoS'd its OWN verify does NOT emit (else it trivially skips the gate).
    return decision(false, 'resource-bound-dos');
  }

  if (rc === RESULT_CLASS.SETUP_FAILURE) {
    // the ONLY provably-loom-side reason: no Docker host, decided before any candidate code runs.
    if (reason === 'no-attested-backend') return decision(true, 'loom-infra-advisory');
    // every other SETUP_FAILURE reason is candidate-attributable or ambiguous => fail-CLOSED. Echo ONLY a
    // KNOWN reason for audit; an unknown/hostile reason maps to the fixed `setup-unknown` (M2 — no verbatim echo).
    return decision(false, SETUP_BLOCK_REASONS.includes(reason) ? reason : 'setup-unknown');
  }

  // unrecognized / undefined / null result_class => fail-CLOSED default.
  return decision(false, 'unrecognized');
}

module.exports = { decideDisposition };
