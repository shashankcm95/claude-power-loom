'use strict';

// packages/kernel/_lib/integration-record.js
//
// PR-P3c-c — the NON-GENESIS chained-record builder for the ordered integrator.
// buildChainedRecord mints the integrator's APPEND record per clean merge:
//   - prev_state_hash = the parent's STORED post_state_hash (the M1/Case-E seam —
//     a value a prior appendRecord ACTUALLY stored, NOT a recompute over the tip);
//   - post_state_hash = computePostStateHash(mergedTree), EXPLICIT (so the next
//     candidate's walk can resolve THIS record as its parent via readByPostStateHash);
//   - evidence_refs = [the candidate's genesis record transaction_id] — an
//     A10-satisfying, R10-UNVERIFIED back-reference (it is NOT walked; the per-candidate
//     provenance gate is the READ in mintIntegrationRecord, not this ref).
//
// It is the non-genesis parallel to quarantine-promote's GENESIS builders. It reuses
// computeTransactionId/validateTransactionRecord verbatim (M1) and validates at the
// NON-genesis position (fail-fast: a malformed prev throws HERE, not as a cryptic K9
// reject downstream).

const { computeTransactionId, validateTransactionRecord } = require('./transaction-record.js');

// The fixed authoring identity for a kernel-emitted integration record. The integration
// is a kernel assembly op (a user-invoked CLI), NOT a persona spawn — so it carries a
// constant integrator persona, not a per-spawn one. validateTransactionRecord requires a
// non-empty writer_persona_id; ref CONTENT is not verified at v3.0-alpha (v3.1 R10).
const KERNEL_INTEGRATOR_PERSONA = 'kernel-loom-integrator';

/**
 * Build a NON-GENESIS chained integration record (transaction_id set, validated at the
 * non-genesis position). IMMUTABLE: returns a NEW object; never mutates opts.
 *
 * @param {Object} opts
 * @param {string} opts.prevPost the parent's STORED post_state_hash (64-hex; the M1 seam).
 * @param {string} opts.post this record's post_state_hash = computePostStateHash(mergedTree).
 * @param {string} opts.evidenceTxid the candidate's genesis record transaction_id (A10 back-ref).
 * @param {string} opts.safeId the sanitized candidate id (-> writer_spawn_id).
 * @param {string} opts.schemaVersion e.g. 'v3'.
 * @returns {Object} a non-genesis-valid transaction-record.
 * @throws {Error} if the assembled record fails non-genesis validation (fail-fast).
 */
function buildChainedRecord(opts) {
  const { prevPost, post, evidenceTxid, safeId, schemaVersion } = opts || {};
  // Immutable construction; intent_recorded_at = commit time (single-phase — the merge
  // is synchronous + atomic via the integrator's terminal CAS, so there is no separate
  // PENDING intent record).
  const record = {
    prev_state_hash: prevPost,
    post_state_hash: post,
    head_anchor: null,
    writer_persona_id: KERNEL_INTEGRATOR_PERSONA,
    writer_spawn_id: `loom-integrate-${safeId}`,
    operation_class: 'APPEND',
    evidence_refs: [evidenceTxid],
    intent_recorded_at: new Date().toISOString(),
    commit_outcome: 'COMMITTED',
    schema_version: schemaVersion,
  };
  const finalized = { ...record, transaction_id: computeTransactionId(record) };
  const v = validateTransactionRecord(finalized, { isGenesisPosition: false });
  if (!v.valid) {
    throw new Error(`integration-record: chained record failed non-genesis validation: ${(v.errors || []).join('; ')}`);
  }
  return finalized;
}

module.exports = { buildChainedRecord, KERNEL_INTEGRATOR_PERSONA };
