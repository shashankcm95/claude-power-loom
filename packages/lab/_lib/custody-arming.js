'use strict';

// @loom-layer: lab
//
// A-W1 (Part A) - the ARMING POLICY for the world-anchor custody keys: which PINNED /etc/loom paths, gated on
// the both-or-neither arm coherence. Extracted from world-anchored-recall-cli.js now that A-W1 adds a SECOND
// consumer (the observe-merge verify-at-mint arm) - single-source the pinned paths + the arming-gated resolution
// so the two consumers cannot split-brain (mirrors world-anchor-arming.js's "one flag, one parse, one truth").
//
// LAYERING (VERIFY-architect Q2-A): this is a lab/_lib LEAF w.r.t. lab/world-anchor/. It never imports back into
// world-anchor/; signingArmed (the B1 LOOM_EDGE_REQUIRE_UID_SEP arm) is INJECTED by the caller (the recall CLI /
// the mint arm both already legally reach into world-anchor/edge-signer-resolve for isEdgeUidSepArmed()). This
// keeps the module graph a DAG (no _lib <-> world-anchor cycle).
//
// SEAM vs task_d722450d (VERIFY-architect Q3-A): this module owns the arming POLICY and CALLS custody-verify-key.js's
// public resolveCustodyVerifyKey (the fd-safe low-level READ). task_d722450d rewires that reader's INTERNALS to a
// kernel primitive; the public export + signature are unchanged, so the seam is stable across either merge order.
//
// SHADOW: {} / null on every un-armed OR incoherent box (byte-identical to the pre-A un-armed behaviour). The
// crypto verify (B2, allowEnvFallback:false) stays the load-bearing gate downstream - an absent/foreign key -> null.

const { isWorldAnchorArmMisconfigured, armingCoherence } = require('./world-anchor-arming');
const { resolveCustodyVerifyKey } = require('./custody-verify-key');
const { currentUid } = require('../../kernel/_lib/safe-resolve');
const { emitEgressAlert } = require('../../kernel/egress/alert');

// The custody-pinned trust anchors (HARD CONSTANTS, never argv/env-derived - VERIFY-hacker M1). The edge verify
// key is the deployed cross-uid loom-edge-signer's PUBLIC key; the broker verify key is the approval broker's
// (approve-cli.js:180). Absent on CI/clean-dev -> resolveCustodyVerifyKey returns null -> dark.
const EDGE_VERIFY_KEY_PATH = '/etc/loom/edge-verify.pem';
const BROKER_VERIFY_KEY_PATH = '/etc/loom/verify.pem';

// The SINGLE arming decision shared by BOTH resolvers (VERIFY-architect Q5-A single-truth: they read the SAME
// armingCoherence, so they can never split - both dark or both live). Emits observably before any dark return
// (Q5-C / security.md - a fail-closed decision must not be silent):
//   - world-anchor-arm-incoherent : the two flags DISAGREE (scope/config failure). DISTINCT (Q5-B) from the
//     single-flag typo token below. The `cause` field distinguishes B5-only (admission-armed-without-signing, a
//     real misconfig) from B1-only (signing-armed-without-admission, the legitimate sign-then-admit staging step).
//     NB: the detail key is `cause`, NOT `reason` - emitEgressAlert's positional token IS the `reason` and would
//     clobber a `reason` detail key (alert.js:19-23).
//   - world-anchor-arm-misconfigured : a TYPO on the admission arm flag (a parse failure, not a flag-disagreement).
function armingDecision(signingArmed) {
  const coh = armingCoherence(signingArmed);
  if (!coh.coherent) emitEgressAlert('world-anchor-arm-incoherent', { cause: coh.reason });
  if (isWorldAnchorArmMisconfigured()) emitEgressAlert('world-anchor-arm-misconfigured', {});
  return coh;
}

/**
 * resolveArmedCustodyKeys({ signingArmed }) -> {} | { selfUid, edgeVerifyKey, brokerVerifyKey }. The D2 admission
 * custody keys. Returns {} (no key read) on every box where admission is not COHERENTLY armed (un-armed / typo /
 * incoherent B5-only) - byte-identical to the pre-A un-armed SHADOW behaviour. Both keys resolve INDEPENDENTLY
 * (never short-circuit): B2's admitWorldAnchorNode requires BOTH and AND-gates its refuse, so present-edge +
 * absent-broker (or the reverse) still refuses cleanly via no-verify-key.
 */
function resolveArmedCustodyKeys({ signingArmed } = {}) {
  if (!armingDecision(signingArmed).admissionArmed) return {};      // dark: un-armed / incoherent
  const selfUid = currentUid();
  return {
    selfUid,
    edgeVerifyKey: resolveCustodyVerifyKey(EDGE_VERIFY_KEY_PATH, selfUid),      // independent resolve
    brokerVerifyKey: resolveCustodyVerifyKey(BROKER_VERIFY_KEY_PATH, selfUid),  // independent resolve
  };
}

/**
 * resolveArmedBrokerVerifyKey({ signingArmed }) -> string | null. The BROKER verify key for verify-at-mint: the
 * observe-merge auto-mint arm threads this into mintFromMergeOutcome, which verifies record.broker_sig against it
 * (the approval broker's key, NOT the edge key). null when admission is not COHERENTLY armed -> the mint's
 * authEngaged stays false -> the un-authenticated SHADOW skip path, byte-identical to today. When coherently armed
 * but the key is absent (CI) -> null -> the mint fail-closes broker-sig-invalid (present-but-unresolvable intent).
 */
function resolveArmedBrokerVerifyKey({ signingArmed } = {}) {
  if (!armingDecision(signingArmed).admissionArmed) return null;    // dark: un-armed / incoherent
  return resolveCustodyVerifyKey(BROKER_VERIFY_KEY_PATH, currentUid());
}

module.exports = {
  EDGE_VERIFY_KEY_PATH,
  BROKER_VERIFY_KEY_PATH,
  resolveArmedCustodyKeys,
  resolveArmedBrokerVerifyKey,
};
