#!/usr/bin/env node

// @loom-layer: lab
//
// v3.5 Wave 3b.1 - the `quarantined` projection: a PURE Lab projection over the manage-proposal set.
// Mirrors causal-edge/projections.js conflictedBlocks. (DISAMBIGUATION: this quarantine is a Memory-Manage
// retrieval-suppression marker, NOT the kernel quarantine-promote.js spawn-delta staging.)
//
// Two advisory tiers (ANNOTATION, NEVER suppression): in v3.5 there is NO retrieval layer to suppress, so
// the projection SURFACES the marker; the actual retrieval-suppression is OWED to the v3.6 K4-recall wiring
// (the 3a F4 lesson - a marker + a projection, no live effect).
//   quarantined - a record that is a target of an APPROVED quarantine proposal (human-disposed)
//   candidate   - a record targeted ONLY by PENDING quarantine proposals (awaiting disposition)
// APPROVED-WINS: one approved proposal makes a record `quarantined` regardless of co-existing pending
// proposals (monotonic, order-independent - the conflicted confirmed-wins analog).
//
// THE op_type + non-rejected PRE-FILTER IS LOAD-BEARING (the 3a F3-trap analog): the store will, in 3b.2,
// hold content-dedup/cull/merge proposals too. A bare disposition filter would FALSELY quarantine a
// cull/dedup target; a `rejected` quarantine must NOT mark its targets. The gate is
// `op_type === 'quarantine' && disposition !== 'rejected'`.
//
// Layer (K12): `lab`. Imports ONLY the sibling ./enums (APPROVED_DISPOSITION). PURE: no ./store, no I/O. SHADOW.

'use strict';

const { APPROVED_DISPOSITION, OP_TYPES } = require('./enums');

const QUARANTINE = 'quarantine';
const REJECTED = 'rejected';

function isRecord(r) {
  return !!r && typeof r === 'object' && !Array.isArray(r);
}

function nonEmptyStr(v) {
  return typeof v === 'string' && v.length > 0;
}

/**
 * quarantined projection: map each kernel txid targeted by a non-rejected `quarantine` proposal to its
 * tier + the incident proposals. PURE over a passed-in array (the store feeds listProposals() in).
 * `quarantined` iff >=1 APPROVED quarantine proposal targets it; `candidate` iff only PENDING. Non-
 * quarantine + rejected proposals are IGNORED (the load-bearing pre-filter). Annotation, never suppression.
 *
 * @param {object[]} proposals the manage-proposal set (any op_type / disposition; ineligible tolerated)
 * @returns {Map<string, {tier: 'quarantined'|'candidate', proposals: object[]}>} txid -> annotation
 */
function quarantinedRecords(proposals) {
  const result = new Map();
  if (!Array.isArray(proposals)) return result;

  // PRE-FILTER to non-rejected quarantine proposals with a target array FIRST (the F3-trap analog).
  const active = proposals.filter((p) => isRecord(p)
    && p.op_type === QUARANTINE
    && p.disposition !== REJECTED
    && Array.isArray(p.target_records));

  // `quarantined` is monotonic + order-independent: once an approved quarantine touches a txid it stays
  // quarantined; a later pending proposal never downgrades it.
  const annotate = (txid, proposal, approved) => {
    let entry = result.get(txid);
    if (!entry) { entry = { tier: 'candidate', proposals: [] }; result.set(txid, entry); }
    entry.proposals.push(proposal);
    if (approved) entry.tier = 'quarantined';
  };

  for (const p of active) {
    const approved = p.disposition === APPROVED_DISPOSITION;
    // Dedup the targets WITHIN a proposal so a hand-planted duplicate does not double-list (the store
    // canonicalizes on write, but this projection is pure over ANY set - the 3a self-loop lesson).
    const seen = new Set();
    for (const txid of p.target_records) {
      if (!nonEmptyStr(txid) || seen.has(txid)) continue;
      seen.add(txid);
      annotate(txid, p, approved);
    }
  }
  return result;
}

/**
 * approvedOpsByRecord projection (v3.6 Wave 1): map each kernel txid to the APPROVED manage-ops targeting
 * it, across ALL op_types. A SIBLING of quarantinedRecords - it shares the load-bearing op_type +
 * disposition pre-filter SHAPE, but is APPROVED-only + all-op-type + tier-free (NOT a superset: it drops
 * the candidate/quarantined tier `quarantinedRecords` carries). This is the "approved manage-intent" view
 * the v3.6 Wave 2 destructive mint consumes (a `cull` -> a kernel TOMBSTONE; a `content-dedup` -> a
 * SUPERSEDE). PURE over a passed-in array (the store feeds listProposals() in); ANNOTATION, never suppression.
 *
 * @param {object[]} proposals the manage-proposal set (any op_type / disposition; ineligible tolerated)
 * @returns {Map<string, Array<{op_type:string, proposal_id:string, justification:string}>>} txid -> approved ops
 */
function approvedOpsByRecord(proposals) {
  const result = new Map();
  if (!Array.isArray(proposals)) return result;

  // PRE-FILTER: approved + a KNOWN op_type (closed-enum membership - a garbage op_type is dropped) + a
  // target array (the F3-trap analog). Approved-only: this view FEEDS the mint, so pending/rejected are out.
  const approved = proposals.filter((p) => isRecord(p)
    && p.disposition === APPROVED_DISPOSITION
    && OP_TYPES.includes(p.op_type)
    && Array.isArray(p.target_records));

  for (const p of approved) {
    // Dedup targets WITHIN a proposal so a hand-planted duplicate does not double-list (pure over ANY set;
    // the store canonicalizes on write - the 3a self-loop lesson).
    const seen = new Set();
    for (const txid of p.target_records) {
      if (!nonEmptyStr(txid) || seen.has(txid)) continue;
      seen.add(txid);
      let entry = result.get(txid);
      if (!entry) { entry = []; result.set(txid, entry); }
      entry.push({ op_type: p.op_type, proposal_id: p.proposal_id, justification: p.justification });
    }
  }
  return result;
}

module.exports = { quarantinedRecords, approvedOpsByRecord };
