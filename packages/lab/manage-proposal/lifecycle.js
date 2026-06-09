#!/usr/bin/env node

// @loom-layer: lab
//
// v3.6 Wave 1 (consumer-first, SHADOW) - the manage-layer lifecycle READ consumer. The missing READER for
// the v3.5 manage-proposal store (the dark-producer edge this closes): given a kernel transaction_id, it
// composes TWO orthogonal facts into one advisory verdict -
//   kernel_state - the record's COMMITTED lifecycle (projectLifecycleState; a kernel/_lib PURE projection)
//   approved_ops - the APPROVED manage-intent targeting it (approvedOpsByRecord; the sibling Lab projection)
// This cross-layer JOIN is the bridge the v3.6 Wave 2 destructive mint will feed: mint a COMMITTED
// SUPERSEDE/TOMBSTONE -> projectLifecycleState flips kernel_state -> this (already-shipped) consumer surfaces it.
//
// ADVISORY + narrowing-safe: `effective` is a PURE DESCRIPTIVE UNION ({committed, pending_intent}), NEVER a
// resolved suppress/delete/gate verdict (the consumer ANNOTATES; it never instructs). SHADOW: no I/O, no
// store write, no hooks.json ref.
//
// RECORDS-PROVENANCE PRECONDITION (architect VERIFY HIGH): the kernel-half is meaningful ONLY when the
// caller supplies the txid's run records (the record-store is run-scoped; cross-run target location is the
// v3.6 Wave 2 run-seam). With no records, kernel_state defaults `unknown` - the MANAGE-half is what closes
// the v3.5 dark edge this wave; the kernel-half composition is forward-correct + lights up in W2.
//
// CONTRACT NOTE (architect VERIFY CRITICAL): projectLifecycleState takes a RECORD object (not a txid) and
// has no `live` state - the COMMITTED base is `active`, and `archived` fires on age alone (no destructive op
// needed). Only {tombstoned, superseded, stale} require a co-located COMMITTED SUPERSEDE/TOMBSTONE.
//
// Layer (K12): `lab`. Imports kernel/_lib (projectLifecycleState / indexByTransactionId - lab->kernel LEGAL)
// + the sibling ./projections. NO store/runtime state.

'use strict';

const { projectLifecycleState } = require('../../kernel/_lib/provenance-projections');
const { indexByTransactionId } = require('../../kernel/_lib/provenance-walk');
const { approvedOpsByRecord } = require('./projections');

/**
 * The composed advisory lifecycle verdict for a kernel transaction_id. Pure; frozen return.
 *
 * @param {string} txid a kernel transaction_id
 * @param {object} [opts]
 * @param {object[]} [opts.records]      the run's record set (kernel-half; absent -> kernel_state 'unknown')
 * @param {object[]} [opts.proposals]    the manage-proposal set (manage-half; the store feeds listProposals())
 * @param {number}  [opts.nowMs]         injected wall-clock for the archived-by-age projection
 * @param {number}  [opts.retentionDays] retention window (days) for archived-by-age
 * @returns {{txid:string, kernel_state:string, approved_ops:object[], effective:object, advisory:true}} frozen
 */
function manageLifecycleStatus(txid, opts = {}) {
  const records = Array.isArray(opts.records) ? opts.records : [];
  const proposals = Array.isArray(opts.proposals) ? opts.proposals : [];

  const lifecycleOpts = {};
  if (Number.isFinite(opts.nowMs)) lifecycleOpts.nowMs = opts.nowMs;
  if (Number.isInteger(opts.retentionDays)) lifecycleOpts.retentionDays = opts.retentionDays;

  // Resolve txid -> RECORD object first (CRITICAL-1: projectLifecycleState takes a record, not a txid).
  // indexByTransactionId HEX64-validates + first-wins; an absent record -> 'unknown' (the run-seam default).
  const record = indexByTransactionId(records).get(txid);
  // record is always isRecord-valid (indexByTransactionId filters), so projectLifecycleState cannot return
  // null on the hit path; the `?? 'unknown'` collapses BOTH the absent-record path AND that unreachable null
  // into one safe default, so a future exotic record set can never leak `kernel_state: null` (VALIDATE LOW-2).
  const kernelState = (record ? projectLifecycleState(record, records, lifecycleOpts) : null) ?? 'unknown';

  const approvedOps = (approvedOpsByRecord(proposals).get(txid) || []).map((o) => Object.freeze({ ...o }));
  Object.freeze(approvedOps);

  return Object.freeze({
    txid,
    kernel_state: kernelState,
    approved_ops: approvedOps,
    // PURE DESCRIPTIVE UNION - never a single resolved verdict (narrowing-safety; VERIFY MEDIUM).
    effective: Object.freeze({
      committed: kernelState,
      pending_intent: Object.freeze(approvedOps.map((o) => o.op_type)),
    }),
    advisory: true,
  });
}

module.exports = { manageLifecycleStatus };
