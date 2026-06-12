#!/usr/bin/env node

// @loom-layer: lab
//
// v3.8a W3 - the recall-class retrieval-suppression VIEW (the manage loop's read edge).
// Given a candidate set of kernel transaction_ids (a recall-class result set), partition
// it against the LIVE manage state into:
//
//   suppressed - kernel-COMMITTED destructive facts ONLY: {tombstoned, superseded} (the
//                v3.6 promote mints). NOT stale/archived (age/transitive projections, not
//                destructive facts - suppressing them is silent memory loss, the v3.5
//                carry-item (c) lossy-recall caution).
//   flagged    - ADVISORY manage-intent: approved-but-unpromoted destructive ops UNION
//                pending quarantine proposals (the quarantinedRecords `candidate` tier -
//                the VERIFY-HIGH fix: the approved-only lifecycle path alone is blind to
//                a freshly-filed quarantine). Approved quarantine lands HERE, never in
//                suppressed (it mints no kernel op by design - promote.js refuses it),
//                deduped across the two projections it appears in.
//   surfaced   - the explicit DEFAULT branch: everything else (active / stale / archived /
//                aborted / informational / candidate / unknown), annotated with its
//                kernel_state. Fail-soft per ELEMENT - an absent txid surfaces with reason
//                'no-records', a present-but-unindexed txid 'unresolved', a non-hex element
//                'invalid-txid'. NEVER silently dropped (the anti-silent-loss default).
//
// PRECEDENCE: a committed fact wins - a tombstoned/superseded txid with advisory intent
// lands in suppressed ONLY. The partition is EXHAUSTIVE + pairwise-DISJOINT over the
// (deduped) input: every input txid appears in exactly one tier. The WHOLE partition is
// always returned (suppression that cannot be inspected is the OQ-21 failure mode); any
// display filtering is a consumer convenience over an already-complete structure.
//
// ADVISORY + SHADOW (section-0a.3.1): a pure read - the view ANNOTATES a candidate set;
// it never gates a kernel read, never writes, and carries `advisory: true`. It reads
// kernel RECORDS, not causal EDGES - the RFC's AUDIT-ONLY-edge exclusion stays vacuously
// held (orthogonal surface), not "enforced" here.
//
// COST CONTRACT: input capped at MAX_RECALL_SET (= the store's MAX_TARGETS, 256); each
// txid is one cross-run locate+load pass (loadRecordsForTarget) - worst-case O(N) run
// loads. Per-run memoization is deliberately NOT built until a probe shows real cost
// (YAGNI; the VALIDATE hacker's 256-set probe is the gate). The `proposals` arg is
// UN-capped: it is fed by the LOCAL Lab store (listProposals), and the hacker's 200k-
// proposal probe measured 31ms with the flagged tier staying bounded/deduped - if a
// future wave ever wires an EXTERNAL proposal source, cap it alongside the txid cap.
//
// FAIL-SOFT SCOPE: the per-element diagnostics (invalid-txid / no-records / unresolved)
// cover VALIDATION outcomes; an I/O exception thrown by a CUSTOM loadRecordsFn propagates
// as a structural throw (the default loader, loadRecordsForTarget, never throws).
//
// Layer (K12): lab. Composes three siblings (manageLifecycleStatus, quarantinedRecords,
// loadRecordsForTarget) + nothing else - the Wave-1 lifecycle.js compose pattern, one
// level up. Accumulation on Map (never plain objects - the promote.js `toString`
// precedent); deep-frozen returns (the #266 shallow-freeze lesson).

'use strict';

const { manageLifecycleStatus } = require('./lifecycle');
const { quarantinedRecords } = require('./projections');
const { loadRecordsForTarget } = require('./crossrun-load');

const HEX64 = /^[a-f0-9]{64}$/;
// Mirrors the store's MAX_TARGETS cap (store.js validateTargets).
const MAX_RECALL_SET = 256;
// The kernel-COMMITTED destructive facts that suppress (and ONLY these).
const SUPPRESSING_STATES = new Set(['tombstoned', 'superseded']);

/** Deep-freeze the small partition trees (rows + nested reasons arrays). */
function deepFreezeRows(rows) {
  for (const row of rows) {
    if (Array.isArray(row.reasons)) {
      for (const reason of row.reasons) Object.freeze(reason);
      Object.freeze(row.reasons);
    }
    Object.freeze(row);
  }
  return Object.freeze(rows);
}

/**
 * Partition a recall-class candidate txid set against the live manage state.
 *
 * @param {string[]} txids the candidate set (64-hex kernel transaction_ids; deduped here)
 * @param {object} [opts]
 * @param {string}   [opts.stateDir]      record-store root for the default cross-run loader
 * @param {object[]} [opts.proposals]     the manage-proposal set (e.g. listProposals())
 * @param {number}   [opts.nowMs]         injected wall-clock (archived-by-age projection)
 * @param {number}   [opts.retentionDays] retention window for archived-by-age
 * @param {function} [opts.loadRecordsFn] injectable records seam (txid -> object[]);
 *                                        defaults to the real cross-run loader
 * @returns {{surfaced: object[], suppressed: object[], flagged: object[], advisory: true}} deep-frozen
 * @throws {TypeError} on a non-array input or a set larger than MAX_RECALL_SET
 */
function recallSuppression(txids, opts = {}) {
  if (!Array.isArray(txids)) {
    throw new TypeError('recallSuppression: txids must be an array of 64-hex transaction_ids');
  }
  if (txids.length > MAX_RECALL_SET) {
    throw new TypeError(`recallSuppression: candidate set exceeds the ${MAX_RECALL_SET} cap (got ${txids.length})`);
  }
  const proposals = Array.isArray(opts.proposals) ? opts.proposals : [];
  const loadRecords = typeof opts.loadRecordsFn === 'function'
    ? opts.loadRecordsFn
    : (txid) => loadRecordsForTarget(txid, { stateDir: opts.stateDir });
  const lifecycleOpts = {};
  if (Number.isFinite(opts.nowMs)) lifecycleOpts.nowMs = opts.nowMs;
  if (Number.isInteger(opts.retentionDays)) lifecycleOpts.retentionDays = opts.retentionDays;

  // The quarantine view over the WHOLE proposal set, computed once (Map: txid -> {tier, proposals}).
  const quarantine = quarantinedRecords(proposals);

  const surfaced = [];
  const suppressed = [];
  const flagged = [];
  const seen = new Set(); // dedup: the partition is over the input SET

  for (const txid of txids) {
    if (seen.has(txid)) continue;
    seen.add(txid);

    // Element-level fail-soft: a non-hex element is VISIBLE, never dropped.
    if (typeof txid !== 'string' || !HEX64.test(txid)) {
      surfaced.push({ txid, kernel_state: 'unknown', reason: 'invalid-txid' });
      continue;
    }

    const records = loadRecords(txid);
    const recordSet = Array.isArray(records) ? records : [];
    const verdict = manageLifecycleStatus(txid, { ...lifecycleOpts, records: recordSet, proposals });
    const state = verdict.kernel_state;

    // Tier 1 - committed destructive facts win (precedence; the partition stays disjoint).
    if (SUPPRESSING_STATES.has(state)) {
      suppressed.push({ txid, reason: state });
      continue;
    }

    // Tier 2 - advisory intent: approved ops awaiting promotion UNION pending quarantine.
    // Map-accumulated by op_type+disposition so the approved-quarantine double-listing
    // (approvedOpsByRecord AND quarantinedRecords) dedups to one reason. Multiple approved
    // ops of the SAME op_type targeting this txid (e.g. two culls with overlapping target
    // sets) fold to ONE reason - last-writer wins for proposal_id; the txid is correctly
    // flagged regardless (advisory). If full proposal traceability ever matters, key by
    // op_type+proposal_id instead (an API-shape change - deliberate, not an oversight).
    const reasonByKey = new Map();
    for (const op of verdict.approved_ops) {
      reasonByKey.set(`${op.op_type}|approved`, { op_type: op.op_type, disposition: 'approved', proposal_id: op.proposal_id });
    }
    const qEntry = quarantine.get(txid);
    if (qEntry) {
      const disposition = qEntry.tier === 'quarantined' ? 'approved' : 'pending';
      const key = `quarantine|${disposition}`;
      if (!reasonByKey.has(key)) {
        const pid = qEntry.proposals[0] && qEntry.proposals[0].proposal_id;
        reasonByKey.set(key, { op_type: 'quarantine', disposition, proposal_id: pid });
      }
    }
    if (reasonByKey.size > 0) {
      flagged.push({ txid, reasons: [...reasonByKey.values()] });
      continue;
    }

    // Tier 3 - the explicit DEFAULT branch: surfaced + annotated. The unknown case carries
    // a diagnostic reason so a read-failure is never mistaken for a clean record.
    const row = { txid, kernel_state: state };
    if (state === 'unknown') {
      row.reason = recordSet.length === 0 ? 'no-records' : 'unresolved';
    }
    surfaced.push(row);
  }

  return Object.freeze({
    surfaced: deepFreezeRows(surfaced),
    suppressed: deepFreezeRows(suppressed),
    flagged: deepFreezeRows(flagged),
    advisory: true,
  });
}

module.exports = { recallSuppression, MAX_RECALL_SET };
