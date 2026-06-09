#!/usr/bin/env node

// @loom-layer: lab
//
// v3.6 Wave 2a — the human-gated manage-promote orchestrator (the leave-shadow MINT). Reads ONE explicit
// approved `cull` proposal -> mints a COMMITTED kernel TOMBSTONE into the TARGET's run -> the W1 reader
// (manageLifecycleStatus) reports the target `tombstoned`. SHADOW DEFAULT: a no-op REFUSE unless
// LOOM_MANAGE_ENFORCE==='1' (opt-in; mirrors LOOM_RESOLVER_ENFORCE; the human is the trust anchor).
//
// HARDENED per the 2-lens VERIFY (architect + hacker; the first WAL mutation):
//   - TOCTOU (Design 4): the proposal is named by id + content-authentic (listProposals re-derives proposal_id);
//     assert disposition==='approved'. A swapped target-set changes the id (not named); a forged id is not found.
//     RESIDUAL (hacker MED, cooperative model): a same-uid updateDisposition('approved') on an attacker's GENUINE
//     proposal is trusted -- the human-in-loop is the ONLY gate distinguishing it; this collapses to OQ-E.
//   - IDOR (hacker HIGH): a TARGET-ELIGIBILITY gate -- refuse a target whose writer_persona_id is kernel:-namespaced
//     or whose operation_class is itself a manage/provenance op. RESIDUAL: an ordinary non-kernel CREATE provenance
//     record is still targetable -- the human reviewing the proposal is the scope gate; a fuller content-class
//     allow-list is future work once "memory records" are a distinct class.
//   - POISON-KEY fail-OPEN (hacker CRITICAL): a POST-CONDITION verify -- after appendRecord (incl. the DEDUPED
//     path), re-read the stored record and HARD-FAIL unless operation_class matches AND affected_records contains
//     the target. A deduped DECOY (same idempotency_key, different affected_records) is a FAIL, never a success.
//   - W2a scope: single-target `cull` only -> TOMBSTONE; quarantine/content-dedup/merge/multi-target REFUSE.
//   - Rate-bound (architect MED, doc): the per-invocation explicit --proposal-id + INV-22 dedup IS the W2a
//     rate-bound; the E11 promote-path breaker generalizes it in W2b.
//
// Layer (K12): lab -- reads the sibling store + calls kernel/_lib (buildManageOpRecord/findRecordRun/record-store).

'use strict';

const crypto = require('crypto');
const { listProposals } = require('./store');
const { APPROVED_DISPOSITION } = require('./enums');
const { buildManageOpRecord } = require('../../kernel/_lib/manage-op-record');
const { findRecordRun } = require('../../kernel/_lib/record-locate');
const { appendRecord, readById } = require('../../kernel/_lib/record-store');
const { canonicalJsonSerialize } = require('../../kernel/_lib/canonical-json');

const SCHEMA_VERSION = 'v6';
// op_type -> kernel operation_class. W2a ships `cull` only. content-dedup/merge -> SUPERSEDE is W2b; quarantine
// is a recall-layer retrieval-suppression (v3.8a), NOT a kernel op.
const OP_MAP = Object.freeze({ cull: 'TOMBSTONE' });

/**
 * The leave-shadow opt-in gate: true iff `LOOM_MANAGE_ENFORCE` is exactly '1' (shadow is the default).
 * @returns {boolean}
 */
const isEnforced = () => process.env.LOOM_MANAGE_ENFORCE === '1';

/**
 * Build a frozen refusal result (the never-throws contract -- a clean {ok:false} instead of an exception).
 * @param {string} reason the machine-readable refusal code
 * @param {object} [extra] additional context merged into the result
 * @returns {Readonly<{ok:false, refused:string}>}
 */
const refuse = (reason, extra) => Object.freeze({ ok: false, refused: reason, ...extra });

/**
 * The IDOR target-eligibility gate (hacker VERIFY/VALIDATE): a cull may tombstone only a real, non-kernel,
 * non-manage memory record. The kernel persona namespace is BOTH 'kernel:' AND 'kernel-' (the LIVE integrator is
 * 'kernel-loom-integrator', VALIDATE NEW-2; integration-record.js); the persona is normalized (trim + casefold)
 * before the prefix check (VALIDATE MED-1, against 'KERNEL:' / leading-whitespace evasions). RESIDUAL: an
 * ordinary non-kernel CREATE/APPEND provenance record is still targetable -- the human reviewing the proposal is
 * the scope gate; a fuller content-class allow-list is future work once "memory records" are a distinct class.
 *
 * @param {object|null} targetRecord the resolved target record (from readById), or null
 * @returns {string|null} a refusal code ('target-not-found' | 'target-kernel-owned' | 'target-is-a-manage-op'), or null if eligible
 */
function eligibilityRefusal(targetRecord) {
  if (!targetRecord) return 'target-not-found';
  const persona = typeof targetRecord.writer_persona_id === 'string'
    ? targetRecord.writer_persona_id.trim().toLowerCase() : '';
  if (persona.startsWith('kernel:') || persona.startsWith('kernel-')) return 'target-kernel-owned';
  const op = targetRecord.operation_class;
  if (op === 'SUPERSEDE' || op === 'TOMBSTONE' || op === 'DERIVED-VIEW-INVALIDATE') return 'target-is-a-manage-op';
  return null; // eligible (a non-kernel CREATE/APPEND memory record)
}

/**
 * Promote ONE explicit approved `cull` proposal to a COMMITTED kernel TOMBSTONE. Human-gated + flag-gated +
 * shadow-default. NEVER throws -- returns a frozen { ok, ... } result.
 *
 * @param {string} proposalId the id the human reviewed + approved
 * @param {{stateDir?: string, nowIso?: string}} [opts]
 * @returns {object} frozen: { ok:true, transaction_id, runId, target, operation_class, deduped }
 *                   | { ok:false, refused, ... } | { ok:false, failed, ... }
 */
function promoteProposal(proposalId, opts = {}) {
  if (!isEnforced()) return refuse('shadow-default', { hint: 'set LOOM_MANAGE_ENFORCE=1 to opt in (the human is the trust anchor)' });
  if (typeof proposalId !== 'string' || proposalId.length === 0) return refuse('missing-proposal-id');
  const stateDir = opts.stateDir;
  const nowIso = opts.nowIso || new Date().toISOString();

  // (1) Load the NAMED proposal -- content-authentic by construction (listProposals re-derives proposal_id).
  // The store is NOT a sandbox (p-writescope): wrap the read so the never-throws contract holds on a store read
  // error, and guard the proposal SHAPE below against a planted malformed row (CodeRabbit Major).
  let proposals;
  try { proposals = listProposals(); } catch (e) { return refuse('proposal-store-read-failed', { error: e && e.message ? e.message : String(e) }); }
  const proposal = (Array.isArray(proposals) ? proposals : []).find((p) => p && p.proposal_id === proposalId);
  if (!proposal) return refuse('proposal-not-found');
  if (proposal.disposition !== APPROVED_DISPOSITION) return refuse('not-approved', { disposition: proposal.disposition });

  // (2) W2a scope guards.
  const operationClass = OP_MAP[proposal.op_type];
  if (!operationClass) {
    return refuse('op-not-supported-in-w2a', {
      op_type: proposal.op_type,
      note: proposal.op_type === 'quarantine'
        ? 'quarantine is a recall-layer suppression (v3.8a), not a kernel op'
        : 'content-dedup/merge -> SUPERSEDE is W2b',
    });
  }
  if (!Array.isArray(proposal.target_records)) return refuse('invalid-proposal-shape', { reason: 'target_records-not-an-array' });
  if (proposal.target_records.length !== 1) {
    return refuse('multi-target-deferred-w2b', { count: proposal.target_records.length });
  }
  const target = proposal.target_records[0];

  // (3) Locate the target's run (the run-seam) -- fail-closed on phantom / ambiguous.
  const loc = findRecordRun(target, { stateDir });
  if (!loc) return refuse('target-not-found');
  if (loc.ambiguous) return refuse('target-in-multiple-runs-w2b', { runs: loc.runs });
  const runId = loc.runId;

  // (4) IDOR eligibility gate (hacker HIGH) -- a cull may tombstone only an eligible memory record.
  const elig = eligibilityRefusal(readById(target, { runId, stateDir }));
  if (elig) return refuse(elig, { target });

  // (5) Mint: the human approval IS the A10 axiom (bound to the canonical proposal body).
  const approvalAxiomHash = crypto.createHash('sha256').update(canonicalJsonSerialize(proposal)).digest('hex');
  let record;
  try {
    record = buildManageOpRecord({ operationClass, affectedRecords: [target], proposalId, approvalAxiomHash, schemaVersion: SCHEMA_VERSION, nowIso });
  } catch (e) { return refuse('build-failed', { error: e.message }); }

  const res = appendRecord(record, { runId, stateDir });
  if (!res.ok) return refuse('append-failed', { reason: res.reason });

  // (6) POST-CONDITION verify (hacker CRITICAL -- the INV-22 poison-key fail-OPEN). The append may have DEDUPED
  // against a pre-planted decoy carrying the same idempotency_key but a different affected_records; re-read the
  // STORED record and HARD-FAIL unless it actually acts on the target. EXACT-equality, NOT a subset .includes
  // (VALIDATE NEW-1 CRITICAL): a superset decoy [target, victim] would pass a subset check and launder a
  // single-target approval into a multi-record tombstone -- W2a is single-target by construction, so the stored
  // op MUST be a COMMITTED op acting on EXACTLY [target].
  const stored = readById(res.transaction_id, { runId, stateDir });
  if (!stored || stored.operation_class !== operationClass || stored.commit_outcome !== 'COMMITTED'
      || !Array.isArray(stored.affected_records) || stored.affected_records.length !== 1
      || stored.affected_records[0] !== target) {
    return Object.freeze({
      ok: false,
      failed: 'post-condition-mismatch',
      detail: 'the stored op does not act on EXACTLY the target as a COMMITTED op (possible INV-22 poison-key suppression)',
      transaction_id: res.transaction_id,
      deduped: !!res.deduped,
    });
  }

  return Object.freeze({ ok: true, transaction_id: res.transaction_id, runId, target, operation_class: operationClass, deduped: !!res.deduped });
}

module.exports = { promoteProposal, OP_MAP };
