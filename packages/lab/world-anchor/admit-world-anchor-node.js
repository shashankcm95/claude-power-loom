#!/usr/bin/env node

// @loom-layer: lab
//
// Autonomous-SDE ladder item 5, PR-B B2 - the COMMITMENT-GATED world-anchor ADMISSION TAG (SHADOW).
//
// Given a persisted world_anchored node, decide whether its 'world-anchor' source token is
// COMMITMENT-VERIFIED (trustworthy) by RE-verifying, at admission time, PR-A2a's STEP 1 (the broker_sig
// over approvalSigBasis, custody-pinned allowEnvFallback:false) + STEP 2 (the lesson-commitment binding)
// against the content_hash-SEALED merge-outcome record - joined UNIQUELY via the kernel deriveJoinKeyId
// 5-tuple. This is Option C (re-verify at admission from the sealed bundle) - NOT persist a self-asserted
// flag (reopens the frozen node seal), NOT re-derive-only (drops STEP 1's provenance gate). The mint
// (world-anchor-mint.js:474-520) computes commitment_verified as a TRANSIENT record-event that never
// enters the node schema, so admission genuinely must re-verify; that is exactly what this does.
//
// SHADOW / WEIGHT-INERT: this tag gates NOTHING. LIVE_SOURCES stays Object.freeze([]); NO production
// consumer calls admitWorldAnchorNode (the shadow-import-graph dam asserts zero callers of THIS name AND
// authenticatedWorldAnchorEdges). Wiring the tag into a live recall driver + the LIVE_SOURCES flip is
// PR-B3 (the Rubicon). Until then this is the mechanism, unit-proven, reachable but trusted by nothing.
//
// #273 RESIDUAL - B2 admission is INTEGRITY + key-possession, NOT PROVENANCE (the SAME framing
// world-anchor-mint.js:33-39 / world-anchor-edge-store.js:31-39 / merge-outcome-store.js:33-39 carry).
// commitment_verified:true proves a (node, signed-edge, attestation, merge-outcome) QUADRUPLE is mutually
// self-consistent AND the sigs verify against the SUPPLIED keys - it does NOT prove the legitimate
// producer minted them. Every join input (node.anchor_id, the attestation's {repo,issueRef,pr_number,
// approval_hash}, the edge's to_delta_ref, the node body's {lesson_signature,lesson_body}) is same-uid-
// writable, so an attacker who controls the lab stores can CO-FORGE a self-consistent quadruple that
// admits. This inverts the mint's trust direction (the mint treats att.approval_hash as ADVISORY and
// binds only the KERNEL-sealed record.approval_hash - world-anchor-mint.js:365-376; B2 derives its join
// FROM the lab-written attestation + edge). The step-2a att<->edge + step-7 outcome cross-checks make the
// quadruple internally RIGID, but rigidity != provenance. What makes STEP 1 a REAL gate is ONLY a DEPLOYED
// cross-uid signing key the same-uid host cannot read() (the edge signer IS deployed+attested, uid 612 -
// #273 conds 2+3; whether the APPROVAL broker_sig is ALSO cross-uid-custodial is a SEPARATE trust anchor,
// hence the split brokerVerifyKey). Tolerable ONLY because SHADOW; the close is PR-B5 arming (OQ-NS-6:
// merged code NARROWS, deployment HARDENS).
//
// TOTAL + OBSERVABLE + ENV-BLIND + EXACT-SET (mirrors deriveWorldAnchorSource's discipline verbatim):
// per-step named-reason refuses (each emitEgressAlert - security.md, no silent {ok:false}) + an outer
// whole-body catch as the totality net (any throw -> fail-closed 'mock'); require BOTH verify keys up
// front; exactly-one authenticated edge (never .find()/[0]/.includes for authz).
//
// LAB tier: kernel/_lib + kernel/egress (the join-key seal, the sig basis, the crypto verify, the alert)
// + sibling world-anchor stores. lab -> kernel is the LEGAL direction. NO runtime/kernel STATE. PURE-ish:
// the only I/O is the two opts-dir-injected store reads (readAnchor, loadMergeOutcome), SHADOW by injection.

'use strict';

const { authenticatedWorldAnchorEdges, WORLD_ANCHOR_SOURCE } = require('./world-anchor-edge-store');
const { readAnchor } = require('./world-anchor-store');
const { loadMergeOutcome } = require('./merge-outcome-store');
// deriveJoinKeyId from the SINGLE-SOURCE kernel _lib primitive - NOT the join-key STORE (which carries a
// require-allowlist dam: only emit-pr writes + merge-observer reads). B2 re-derives the id, it does not read
// the store; importing the pure primitive keeps that dam intact.
const { deriveJoinKeyId } = require('../../kernel/_lib/join-key-id');
const { computeLessonCommitment } = require('../../kernel/_lib/lesson-commitment');
const { approvalSigBasis } = require('../../kernel/egress/approval');
const { verifyRecordSig } = require('../../kernel/_lib/edge-attestation');
const { currentUid } = require('../../kernel/_lib/safe-resolve');
const { emitEgressAlert } = require('../../kernel/egress/alert');

// Deliberately NOT 'world-anchor' (that is the admitted token, imported from the edge store as the single
// source). 'mock' is the un-admitted token, mirroring deriveWorldAnchorSource's MOCK_SOURCE.
const MOCK_SOURCE = 'mock';

/** Emit a namespaced, observable egress alert for a refuse/anomaly (fail-closed must be observable). */
function alert(reason, detail) { emitEgressAlert(`world-anchor-admit-${reason}`, detail || {}); }

/** The un-admitted result + its observable emit. A single shape so every refuse path is identical. */
function refuse(reason, detail) {
  alert(reason, detail);
  return { admitted: false, source: MOCK_SOURCE, commitment_verified: false, reason };
}

function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }

/**
 * admitWorldAnchorNode(node, opts) -> { admitted, source, commitment_verified, reason? }. Decide whether a
 * persisted world_anchored node's 'world-anchor' source is COMMITMENT-VERIFIED. Fail-closed to
 * { admitted:false, source:'mock', commitment_verified:false, reason } on ANY defect; never throws.
 *
 * @param {{node_id, anchor_id, lesson_signature, lesson_body}} node  a persisted world_anchored node
 * @param {{
 *   edges?: Array,            world-anchored-by edges (caller supplies; B2 does not read the edge store)
 *   edgeVerifyKey?: string,   ed25519 PUBLIC key for the EDGE sig (the deployed cross-uid loom-edge-signer)
 *   brokerVerifyKey?: string, ed25519 PUBLIC key for the merge-outcome broker_sig (the APPROVAL broker)
 *   anchorDir?: string,       attestation store dir (opts-injected; SHADOW by injection)
 *   outcomeDir?: string,      merge-outcome store dir (opts-injected)
 *   selfUid?: number|null,    uid seam; resolves to currentUid() when omitted; null FAILS CLOSED (no-uid)
 * }} [opts]
 * @returns {{admitted: boolean, source: 'world-anchor'|'mock', commitment_verified: boolean, reason?: string}}
 */
function admitWorldAnchorNode(node, opts = {}) {
  try {
    const o = (opts && typeof opts === 'object') ? opts : {};

    // 0. ENV-BLIND: BOTH verify keys required up front (two DISTINCT trust anchors - edge vs broker). An
    //    empty/missing key -> no-verify-key BEFORE any join work (never accept-all). A present-but-malformed
    //    PEM is NOT short-circuited here - it ENGAGES and fails closed downstream (verifyEdgeSig /
    //    verifyRecordSig return false on an unloadable key), mirroring the mint's asymmetric-parse.
    if (!isNonEmptyString(o.edgeVerifyKey) || !isNonEmptyString(o.brokerVerifyKey)) return refuse('no-verify-key', {});

    // node shape (a defensive boundary - a persisted node always carries these, but B2 is a public fn).
    if (!node || typeof node !== 'object' || Array.isArray(node)) return refuse('bad-node', {});
    if (!isNonEmptyString(node.node_id) || !isNonEmptyString(node.anchor_id)
      || !isNonEmptyString(node.lesson_signature) || !isNonEmptyString(node.lesson_body)) return refuse('bad-node', {});

    // selfUid: resolve, then FAIL CLOSED on null (an untrusted caller passing null, or a no-uid platform,
    // would disable the stores' foreign-owned-file reject - a trust gate must refuse where it cannot verify
    // ownership, never admit; security.md: a pinned guard is not a caller-overridable default).
    const selfUid = o.selfUid === undefined ? currentUid() : o.selfUid;
    if (selfUid === null) return refuse('no-uid', {});

    // 1. Signed-edge membership + capture the edge (EXACT-ONE, never first-wins). authenticatedWorldAnchorEdges
    //    re-derives each edge_id + verifies the sig against edgeVerifyKey (custody-pinned). Its to_delta_ref is
    //    the node's approval_hash. Membership is necessary but NOT sufficient (the B1-hacker close) - the
    //    commitment re-verify below is what makes it sufficient.
    const authedEdges = authenticatedWorldAnchorEdges(Array.isArray(o.edges) ? o.edges : [], { verifyKey: o.edgeVerifyKey });
    const nodeEdges = authedEdges.filter((e) => e.from_node_id === node.node_id);
    if (nodeEdges.length === 0) return refuse('no-authenticated-edge', { node_id: node.node_id });
    if (nodeEdges.length > 1) return refuse('ambiguous-edge', { node_id: node.node_id, matches: nodeEdges.length });
    const approvalHash = nodeEdges[0].to_delta_ref;

    // 2. Load the attestation. readAnchor(node.anchor_id) transitively binds att.anchor_id === node.anchor_id
    //    (the read re-derives deriveAnchorId({repo,issueRef,diff_hash}) === filename), so the att is the one
    //    keyed at the node's anchor_id - but that binding is itself same-uid-forgeable (see the header #273).
    const att = readAnchor(node.anchor_id, { dir: o.anchorDir, selfUid });
    if (!att) return refuse('no-attestation', { anchor_id: node.anchor_id });

    // 2a. att<->edge cross-bind (defense-in-depth): the attestation carries its OWN approval_hash; tie it to
    //     the edge's to_delta_ref so a co-forger cannot pair attestation-X's {repo,issueRef,pr_number} with an
    //     unrelated real merge's edge. (Does NOT close the same-uid quadruple co-forge - header #273.)
    if (att.approval_hash !== approvalHash) return refuse('att-edge-approval-mismatch', { anchor_id: node.anchor_id });

    // 3. Re-derive lc from the NODE body (per-step catch: computeLessonCommitment THROWS on empty/non-string).
    //    Residual: lc is over the node body, not re-bound to the attestation's floor lesson the way the mint is
    //    (world-anchor-mint.js:463-492) - proves body<->outcome consistency, NOT that the body is the merge's
    //    real lesson (same-uid-writable; header #273).
    let lc;
    try { lc = computeLessonCommitment({ lesson_signature: node.lesson_signature, lesson_body: node.lesson_body }); }
    catch (err) { return refuse('bad-lesson-body', { detail: (err && err.message) || 'error' }); }

    // 4. Derive the UNIQUE join key (the 5-tuple is unique per merge - no approval_hash fanout, the B1-hacker
    //    HIGH close). {repo,issueRef,pr_number} from the sealed attestation; approval_hash from the edge;
    //    lesson_commitment re-derived from the node body.
    const jkid = deriveJoinKeyId({
      repo: att.repo, issueRef: att.issueRef, pr_number: att.pr_number,
      approval_hash: approvalHash, lesson_commitment: lc,
    });

    // 5. Load the merge-outcome DIRECT by jkid. loadMergeOutcome guarantees outcome.join_key_id === jkid
    //    (filename check) + the content_hash seal, so the join_key_id FIELD is transitively bound; the ONLY
    //    unbound fields are the sealed-but-opaque lesson_commitment/approval_hash, cross-checked in step 7. Do
    //    NOT re-derive jkid from the outcome body (the store deliberately refuses that - circular).
    const outcome = loadMergeOutcome(jkid, { dir: o.outcomeDir, selfUid });
    if (!outcome) return refuse('no-merge-outcome', { join_key_id: jkid });

    // 6. STEP 1 re-verify (broker_sig, custody-pinned). approvalSigBasis THROWS on a non-string commitment;
    //    verifyRecordSig is fail-soft. Wrap BOTH in one try (mirrors world-anchor-mint.js:398-412): a throw ->
    //    auth-verify-error; a false verify -> broker-sig-invalid. Each emits.
    let sigOk;
    try {
      const basis = approvalSigBasis({
        hash: outcome.approval_hash, approvedAt: outcome.approvedAt,
        nonce: outcome.nonce, key_id: outcome.key_id, lesson_commitment: outcome.lesson_commitment,
      });
      sigOk = verifyRecordSig(basis, outcome.broker_sig, { publicKeyPem: o.brokerVerifyKey, allowEnvFallback: false });
    } catch (err) { return refuse('auth-verify-error', { join_key_id: jkid, detail: (err && err.message) || 'error' }); }
    if (!sigOk) return refuse('broker-sig-invalid', { join_key_id: jkid });

    // 7. STEP 2 cross-checks (the ONLY body-field bindings B2 owns; the store left them opaque): the sealed
    //    lesson_commitment must equal the node-body lc (the body binding), and the sealed approval_hash must
    //    equal the edge's to_delta_ref (the edge binding). A grandfather (outcome lesson_commitment='') never
    //    reaches here - its jkid (derived with '') differs from the node's non-empty-lc jkid, so step 5's
    //    loadMergeOutcome already returned null (OQ3-5 EXCLUDE, structural). No fallback '' lookup.
    if (outcome.lesson_commitment !== lc) return refuse('lesson-commitment-mismatch', { join_key_id: jkid });
    if (outcome.approval_hash !== approvalHash) return refuse('approval-hash-mismatch', { join_key_id: jkid });

    // 8. ADMIT: the quadruple is mutually consistent AND both sigs verified (INTEGRITY + key-possession; NOT
    //    provenance - header #273). SHADOW: no consumer reads this into a weight.
    return { admitted: true, source: WORLD_ANCHOR_SOURCE, commitment_verified: true };
  } catch (err) {
    // Outer totality net: any unforeseen throw (e.g. an adversarial getter on node/edge) fails CLOSED.
    alert('error', { detail: (err && err.message) || 'error' });
    return { admitted: false, source: MOCK_SOURCE, commitment_verified: false, reason: 'admit-error' };
  }
}

module.exports = { admitWorldAnchorNode };
