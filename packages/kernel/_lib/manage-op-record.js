// packages/kernel/_lib/manage-op-record.js
//
// v3.6 Wave 2a + W2c — the genesis-rooted COMMITTED SUPERSEDE/TOMBSTONE builder for the human-gated manage-promote
// (the leave-shadow MINT). The kernel-side counterpart of lab/manage-proposal/promote.js, which orchestrates
// (read approved proposal -> locate run -> append + post-condition verify); THIS module only MINTS the record.
//
// Mirrors quarantine-promote.buildSpawnRecord, but for a MANAGE op:
//   - operation_class SUPERSEDE/TOMBSTONE (state-changing); the TARGETS go in affected_records (the
//     findAffectedByOp field), leaving evidence_refs for the A10 justification (provenance-projections.js:22-28).
//   - post_state_hash NULL: a manage op advances no git tree (architect VERIFY: the HONEST choice — a synthetic
//     post_state_hash would be a fabricated readByPostStateHash chain edge). It is found ONLY via findAffectedByOp.
//   - evidence_refs = [USER_INTENT_AXIOM:<approvalAxiomHash>]: the human's approval IS the A10 bootstrap evidence
//     (a sentinel form). The caller binds approvalAxiomHash = sha256(canonicalJsonSerialize(<the approved proposal>)).
//   - writer_persona_id 'lab:manage-promote' (VERIFY hacker MED: Lab-originated + un-attested until the sandbox;
//     it NEVER claims a 'kernel:' namespace it cannot attest).
//   - writer_spawn_id DERIVED from (proposalId, runId) here (VERIFY architect MED-1: the INV-22 binding is
//     internal + checked, not a free-form caller param that could drift from affected_records). v3.6 W2c folds
//     the RESOLVED runId in so a cross-run promotion's per-run mints get DISTINCT keys (else, since the dedup is
//     single-run-scoped, the per-run records would share ONE transaction_id across runs — identity-erasing).
//     Two (proposal,run) pairs -> two keys; re-promoting the same proposal INTO THE SAME RUN -> the same key (an
//     INV-22 idempotent no-op — the property the cross-run partial-failure retry relies on). The colon-join is
//     unambiguous because proposalId is asserted 64-hex (no colon, fixed width) — the runId tail is unambiguous
//     even though isSafePathSegment permits a ':' in a runId (hacker VERIFY M3).
//
// TRUST (OQ-E residual): this builds a record any same-uid caller could also forge (un-attested writer) —
// accepted under the cooperative threat model; the human approval (the axiom) is the trust anchor; the
// affected_records-not-in-the-key poison is closed by promote.js's POST-CONDITION verify, NOT here. Closes at
// the sandbox.
//
// Layer (K12): kernel/_lib — a PURE builder over transaction-record primitives. No I/O, no store, no lab import.

'use strict';

const {
  computeGenesisHash, computeContentHash, computeIdempotencyKey, computeTransactionId,
  validateTransactionRecord,
} = require('./transaction-record');

const HEX64 = /^[a-f0-9]{64}$/;
const MANAGE_OPS = Object.freeze(['SUPERSEDE', 'TOMBSTONE']);
const PERSONA_ID = 'lab:manage-promote';

/**
 * True iff `v` is a 64-char lowercase-hex string (the transaction_id / sha256 shape).
 * @param {*} v
 * @returns {boolean}
 */
function isHex64(v) { return typeof v === 'string' && HEX64.test(v); }

/**
 * Build a genesis-rooted COMMITTED manage-op (SUPERSEDE/TOMBSTONE) transaction-record. Fail-fast (throws) on
 * ANY invalid input — promote.js catches + refuses cleanly. IMMUTABLE: returns a NEW object.
 *
 * @param {object} o
 * @param {'SUPERSEDE'|'TOMBSTONE'} o.operationClass
 * @param {string[]} o.affectedRecords  the target kernel transaction_ids (non-empty; 64-hex each)
 * @param {string} o.proposalId         the approved proposal's id (64-hex; seeds writer_spawn_id — INV-22 binding)
 * @param {string} o.runId              the RESOLVED run this mint lands in (per-(proposal,run) key; W2c)
 * @param {string} o.approvalAxiomHash  sha256(canonicalJsonSerialize(<the approved proposal>)) — the A10 axiom
 * @param {string} o.schemaVersion      e.g. 'v6' (drives the genesis hash + schema_version)
 * @param {string} o.nowIso             intent_recorded_at (ISO 8601; injected for determinism)
 * @returns {object} a validated genesis manage-op record (transaction_id set)
 */
function buildManageOpRecord(o) {
  const { operationClass, affectedRecords, proposalId, runId, approvalAxiomHash, schemaVersion, nowIso } = o || {};
  if (!MANAGE_OPS.includes(operationClass)) {
    throw new Error(`manage-op-record: operationClass must be SUPERSEDE|TOMBSTONE, got ${JSON.stringify(operationClass)}`);
  }
  if (!Array.isArray(affectedRecords) || affectedRecords.length === 0 || !affectedRecords.every(isHex64)) {
    throw new Error('manage-op-record: affectedRecords must be a non-empty array of 64-hex transaction_ids');
  }
  // 64-hex assertion (hacker VERIFY M3): the colon-join `proposalId:runId` is only unambiguous when proposalId is
  // fixed-width hex (no colon) — so the runId tail can never be confused with part of the id, even though a runId
  // may itself contain a ':'. Enforce the invariant rather than rely on the (current) accident of the caller.
  if (!isHex64(proposalId)) {
    throw new Error('manage-op-record: proposalId must be a 64-hex sha256 (the colon-join unambiguity invariant)');
  }
  if (typeof runId !== 'string' || runId.length === 0) {
    throw new Error('manage-op-record: runId (a non-empty string — the per-(proposal,run) key axis) is required');
  }
  if (!isHex64(approvalAxiomHash)) {
    throw new Error('manage-op-record: approvalAxiomHash must be a 64-hex sha256 of the canonical approved proposal');
  }
  if (typeof schemaVersion !== 'string' || schemaVersion.length === 0) {
    throw new Error('manage-op-record: schemaVersion (a non-empty string) is required');
  }
  if (typeof nowIso !== 'string' || nowIso.length === 0) {
    throw new Error('manage-op-record: nowIso (an ISO 8601 string) is required');
  }

  const prevStateHash = computeGenesisHash(schemaVersion, 'per-project'); // genesis-rooted (not forked from a state)
  const writerSpawnId = `manage-promote:${proposalId}:${runId}`;          // per-(proposal,run) — the INV-22 binding (W2c)
  // content_hash binds the op identity (writer_spawn_id encodes proposalId); post/head are null (a logical op).
  const contentHash = computeContentHash({ postStateHash: null, writerSpawnId, headAnchor: null });
  const idempotencyKey = computeIdempotencyKey({
    writerPersonaId: PERSONA_ID, operationClass, contentHash, prevStateHash,
  });

  const base = {
    prev_state_hash: prevStateHash,
    post_state_hash: null,
    head_anchor: null,
    writer_persona_id: PERSONA_ID,
    writer_spawn_id: writerSpawnId,
    operation_class: operationClass,
    affected_records: [...affectedRecords],
    evidence_refs: [`USER_INTENT_AXIOM:${approvalAxiomHash}`],
    intent_recorded_at: nowIso,
    commit_outcome: 'COMMITTED',
    schema_version: schemaVersion,
    idempotency_key: idempotencyKey,
  };
  // Derive transaction_id LAST (it hashes the idempotency_key in, so appendRecord's id===computeTransactionId
  // integrity check passes — the buildSpawnRecord ordering).
  const record = { ...base, transaction_id: computeTransactionId(base) };
  const v = validateTransactionRecord(record, { isGenesisPosition: true });
  if (!v.valid) {
    throw new Error(`manage-op-record: built record failed validation: ${(v.errors || []).join('; ')}`);
  }
  return record;
}

module.exports = { buildManageOpRecord, PERSONA_ID };
