'use strict';

// @loom-layer: lab
//
// PR-B B5 (the Rubicon) - the SINGLE source of the world-anchored HARDEN arming flag (SHADOW).
//
// The whole autonomous-SDE arc is weight-inert (weight-source-gate.js LIVE_SOURCES = Object.freeze([])).
// B5 arms the world-anchored HARDEN gate behind ONE deploy flag, LOOM_WORLD_ANCHOR_ARM. This module is the
// SOLE reader of that env var + the SOLE owner of its parse, so the TWO gate sites that must agree cannot
// diverge (VERIFY-architect HIGH-1: two independent `normalizeBool(process.env...)` reads - one in the pure
// weight gate at module-load, one in the recall CLI - would be a split-brain arming seam; a rename/parse
// drift in one and not the other silently half-arms the box). D1 (weight-source-gate) and D2
// (world-anchored-recall-cli) BOTH call isWorldAnchorArmed() here. One flag name, one parse, one truth.
//
// STRICT for the ARM direction (VERIFY-hacker M2, scope hacker CRITICAL 1): arming reuses the BLESSED STRICT
// normalizeBool (only 1/true/yes/on, trimmed/case-insensitive -> true; a typo 'ture' / '0x1' / any other
// token -> false -> DARK). isDeployFlagSet (LENIENT) is used ONLY as a misconfig DETECTOR for an observable
// "you typo'd the arm flag" emit - NEVER on a gating branch (a lenient flag on the admit branch is the
// fails-OPEN bug the scope folded). Mirrors edge-signer-resolve.js's STRICT-arm / LENIENT-detect split.
//
// ARMING CONTRACT (the two-flag AND for gap-map item 8): the world-anchored HARDEN admits a weight only when
// BOTH LOOM_EDGE_REQUIRE_UID_SEP (B1 - real cross-uid SIGNED edges exist) AND LOOM_WORLD_ANCHOR_ARM (B5 -
// the weight admission) are set on a DEPLOYED + ATTESTED box. This module owns only the second; the first is
// edge-signer-resolve.js. Arming alone is inert without the deployed cross-uid custody keys + B2's crypto.
//
// PURE: no I/O. Reads process.env only when a predicate is CALLED (never at module load here).

const { normalizeBool, isDeployFlagSet } = require('./host-claude-guard');

// The single canonical env var name (greppable in one place; both gate sites reference this constant).
const WORLD_ANCHOR_ARM_ENV = 'LOOM_WORLD_ANCHOR_ARM';

/**
 * isWorldAnchorArmed() -> boolean. STRICT: true ONLY for a valid-truthy LOOM_WORLD_ANCHOR_ARM
 * (1/true/yes/on). Unset / '' / '0' / any typo -> false -> the gate stays dark. The SOLE arming decision
 * consumed by both the weight-source gate (D1) and the recall CLI (D2).
 */
function isWorldAnchorArmed() {
  return normalizeBool(process.env[WORLD_ANCHOR_ARM_ENV]);
}

/**
 * isWorldAnchorArmMisconfigured() -> boolean. True when the operator set a NON-FALSEY-but-not-valid arm
 * token (a typo like 'ture'/'enabled'): they INTENDED to arm but the STRICT parse leaves it dark. LENIENT
 * detector for an OBSERVABLE emit only (never gates). False when unset / explicit-falsey / valid-truthy.
 */
function isWorldAnchorArmMisconfigured() {
  return isDeployFlagSet(process.env[WORLD_ANCHOR_ARM_ENV]) && !isWorldAnchorArmed();
}

/**
 * armingCoherence(signingArmed) -> { admissionArmed, coherent, reason }. The both-or-neither arm preflight
 * (A-W1). signingArmed (LOOM_EDGE_REQUIRE_UID_SEP, B1) is an INJECTED param: the CALLER (which legally reads
 * both flags) passes it, so this module stays the SOLE reader of only LOOM_WORLD_ANCHOR_ARM and lab/_lib never
 * imports back into world-anchor/ (VERIFY-architect Q2-A: no _lib<->world-anchor cycle).
 *
 * ASYMMETRIC by WORKFLOW-ORDER (Q1-A, NOT by "B1-only edges are inert" - that is a TIME-BOUND property: a
 * B1-armed box's accumulated signed edges become admittable the moment item 8 flips LIVE_SOURCES): admission
 * (B5) ADMITS only when BOTH cohere; signing-only (B1-only) is the LEGITIMATE sign-then-admit staging step
 * (admission stays dark, signing is NOT broken - a different module owns it). B5-only (admission armed while
 * signing is dark) is NEVER a legitimate step -> fail-closed dark. Either XOR is `coherent:false` with a
 * DISTINCT reason for the caller to emit observably (Q5-C: emit before failing dark).
 *
 * DI-param defensiveness: signingArmed must be a real boolean; anything else coerces to false (dark).
 *
 * CALLER NOTE (VALIDATE code-reviewer): `coherent:false` is NOT a general health signal - it means only "the two
 * flags DISAGREE". B1-only is `coherent:false` yet LEGITIMATE (the sign-then-admit staging step). Gate a REFUSE
 * on `!admissionArmed` (both XOR states are dark), and gate an EMIT on `!coherent` (both XOR states are observable);
 * do NOT branch a refuse/alarm on `coherent` alone or you would wrongly alarm on the legit B1-only staging path.
 */
function armingCoherence(signingArmed) {
  const admissionFlag = isWorldAnchorArmed();
  const signing = signingArmed === true;
  const admissionArmed = admissionFlag && signing;
  const coherent = admissionFlag === signing;               // both-set or neither-set
  let reason = null;
  if (admissionFlag && !signing) reason = 'admission-armed-without-signing';      // B5-only: incoherent -> dark
  else if (!admissionFlag && signing) reason = 'signing-armed-without-admission'; // B1-only: legit staging
  return { admissionArmed, coherent, reason };
}

module.exports = { WORLD_ANCHOR_ARM_ENV, isWorldAnchorArmed, isWorldAnchorArmMisconfigured, armingCoherence };
