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
//   - IDOR (hacker HIGH): a TARGET-ELIGIBILITY gate -- refuse a target whose writer_persona_id is kernel:- OR
//     kernel--namespaced (normalized) or whose operation_class is itself a manage/provenance op. RESIDUAL: an ordinary non-kernel CREATE provenance
//     record is still targetable -- the human reviewing the proposal is the scope gate; a fuller content-class
//     allow-list is future work once "memory records" are a distinct class.
//   - POISON-KEY fail-OPEN (hacker CRITICAL): a POST-CONDITION verify -- after appendRecord (incl. the DEDUPED
//     path), re-read the stored record and HARD-FAIL unless operation_class matches AND affected_records EQUALS
//     the canonical approved SET exactly (W2b exact-SET-equality, generalizing the W2a single-element check). A
//     deduped DECOY (same idempotency_key, different affected_records) is a FAIL in every shape (superset /
//     subset / dup-pad / foreign), never a success.
//   - W2b.1 scope: MULTI-target SINGLE-RUN -> `cull`->TOMBSTONE, `content-dedup`/`merge`->SUPERSEDE. The target
//     set is CANONICALIZED + re-capped at MAX_TARGETS at the boundary (a planted authentic row is not trusted
//     as canonical/bounded); per-target eligibility; cross-run REFUSE (cross-run-deferred-w2c). `quarantine`
//     REFUSES (recall-layer v3.8a). Cross-run mints + the E11 promote-path breaker are W2c / W2b.2.
//   - Rate-bound (architect MED, doc): the per-invocation explicit --proposal-id + INV-22 dedup + the boundary
//     MAX_TARGETS re-cap IS the W2b.1 rate/blast-radius bound; the E11 promote-path breaker generalizes it in W2b.2.
//
// Layer (K12): lab -- reads the sibling store + calls kernel/_lib (buildManageOpRecord/findRecordRun/record-store).

'use strict';

const crypto = require('crypto');
const { listProposals, canonicalizeTargets, MAX_TARGETS } = require('./store');
const { APPROVED_DISPOSITION } = require('./enums');
const { buildManageOpRecord } = require('../../kernel/_lib/manage-op-record');
const { findRecordRun } = require('../../kernel/_lib/record-locate');
const { appendRecord, readById } = require('../../kernel/_lib/record-store');
const { canonicalJsonSerialize } = require('../../kernel/_lib/canonical-json');
// v3.6 W2b.2: the promote-path breaker (EC2) — bounds the destructive-mint RATE.
const { evaluate: evaluateBreaker } = require('../circuit-breaker/project');

const SCHEMA_VERSION = 'v6';
// op_type -> kernel operation_class (W2b.1). `cull` -> TOMBSTONE; `content-dedup`/`merge` -> SUPERSEDE (both
// multi-target). `quarantine` is a recall-layer retrieval-suppression (v3.8a), NOT a kernel op -> refused.
const OP_MAP = Object.freeze({ cull: 'TOMBSTONE', 'content-dedup': 'SUPERSEDE', merge: 'SUPERSEDE' });

/**
 * The leave-shadow opt-in gate: true iff `LOOM_MANAGE_ENFORCE` is exactly '1' (shadow is the default).
 * @returns {boolean}
 */
const isEnforced = () => process.env.LOOM_MANAGE_ENFORCE === '1';

/**
 * Build a DEEPLY-frozen refusal result (the never-throws contract -- a clean {ok:false} instead of an
 * exception). Array-valued context (e.g. `runs`) is frozen too: a bare Object.freeze is shallow, and the repo
 * Testing rule flags the shallow-freeze-of-a-derived-array leak (VALIDATE hacker MEDIUM) -- a caller must not
 * be able to mutate a returned array.
 * @param {string} reason the machine-readable refusal code
 * @param {object} [extra] additional context merged into the result
 * @returns {Readonly<{ok:false, refused:string}>}
 */
const refuse = (reason, extra) => {
  const out = { ok: false, refused: reason, ...extra };
  for (const k of Object.keys(out)) { if (Array.isArray(out[k])) out[k] = Object.freeze(out[k]); }
  return Object.freeze(out);
};

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
 * Resolve the SINGLE run holding ALL targets (D5 -- per-target then unanimity). Calls findRecordRun on EVERY
 * target (NOT readById against a guessed run), so a cross-run target is detected as cross-run -- never
 * mis-reported as `target-not-found` (architect VERIFY CRITICAL). Fail-closed: any phantom -> target-not-found;
 * any ambiguous -> target-in-multiple-runs-w2b; >1 distinct run -> cross-run-deferred-w2c (the W2c boundary).
 *
 * @param {string[]} targets canonical (dedup+sorted) target transaction_ids
 * @param {{stateDir?: string}} opts
 * @returns {{runId:string} | {refused:string, [k:string]:*}}
 */
function resolveSingleRun(targets, opts) {
  if (!Array.isArray(targets) || targets.length === 0) return { refused: 'no-targets' };
  const runs = new Set();
  for (const t of targets) {
    const loc = findRecordRun(t, opts);
    if (!loc) return { refused: 'target-not-found', target: t };
    if (loc.ambiguous) return { refused: 'target-in-multiple-runs-w2b', target: t, runs: loc.runs };
    runs.add(loc.runId);
  }
  if (runs.size > 1) return { refused: 'cross-run-deferred-w2c', runs: [...runs].sort() };
  return { runId: [...runs][0] };
}

/**
 * The exact-SET-equality post-condition (D2 -- generalizes the W2a single-element check; VALIDATE NEW-1). The
 * stored op MUST act on EXACTLY the canonical approved set as a COMMITTED op of the expected class. Rejects a
 * deduped INV-22 poison-key decoy in ALL shapes: superset (length too big), subset (length too small),
 * dup-pad (Set cardinality too small), foreign element (containment). A SET, so order-independent.
 *
 * @param {object|null} stored the re-read stored record
 * @param {string} operationClass the expected operation_class
 * @param {Set<string>} wantSet the canonical approved target set
 * @returns {boolean}
 */
function postConditionOk(stored, operationClass, wantSet) {
  if (!stored || stored.operation_class !== operationClass || stored.commit_outcome !== 'COMMITTED') return false;
  const got = stored.affected_records;
  if (!Array.isArray(got) || got.length !== wantSet.size || new Set(got).size !== wantSet.size) return false;
  return got.every((t) => wantSet.has(t));
}

/**
 * Promote ONE explicit approved `cull` / `content-dedup` / `merge` proposal to a COMMITTED kernel op
 * (TOMBSTONE / SUPERSEDE) over its MULTI-target, SINGLE-RUN set. Human-gated + flag-gated + shadow-default.
 * NEVER throws -- returns a frozen { ok, ... } result.
 *
 * @param {string} proposalId the id the human reviewed + approved
 * @param {{stateDir?: string, nowIso?: string}} [opts]
 * @returns {object} frozen: { ok:true, transaction_id, runId, targets, operation_class, deduped }
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

  // (2) op_type -> kernel operation_class. hasOwnProperty-guarded (VALIDATE hacker LOW): a bare OP_MAP[op_type]
  // reaches the prototype chain, so a planted op_type='toString'/'valueOf' would resolve to a truthy inherited
  // Function and slip past the !operationClass guard (downstream-rejected by buildManageOpRecord, but this
  // closes it at promote's OWN boundary).
  const operationClass = Object.prototype.hasOwnProperty.call(OP_MAP, proposal.op_type)
    ? OP_MAP[proposal.op_type] : undefined;
  if (!operationClass) {
    return refuse('op-not-supported', {
      op_type: proposal.op_type,
      note: proposal.op_type === 'quarantine'
        ? 'quarantine is a recall-layer suppression (v3.8a), not a kernel op'
        : 'unknown op_type',
    });
  }

  // (3) Canonicalize + re-cap AT THE BOUNDARY (hacker VERIFY HIGH+MEDIUM): proposal.target_records is NOT
  // guaranteed canonical on read (isAuthenticProposal canonicalizes INTERNALLY, so a planted authentic row may
  // be unsorted / duplicated), and MAX_TARGETS is enforced only at create-time. Canonicalize ONCE here and use
  // the SAME `wantTargets` for the mint AND the post-condition -- closes the non-canonical self-DoS + the
  // planted-row blast-radius bypass, and keeps build-input and `want` from drifting.
  if (!Array.isArray(proposal.target_records)) return refuse('invalid-proposal-shape', { reason: 'target_records-not-an-array' });
  // Frozen at creation (VALIDATE hacker MEDIUM): wantTargets is returned in the success result; a shallow
  // Object.freeze of the result would leave this derived array mutable. The kernel builder copies it
  // (`[...affectedRecords]`), so freezing here does not affect the stored record.
  const wantTargets = Object.freeze(canonicalizeTargets(proposal.target_records));
  if (wantTargets.length === 0) return refuse('no-targets');
  if (wantTargets.length > MAX_TARGETS) return refuse('too-many-targets', { count: wantTargets.length });

  // (4) Resolve the single run holding ALL targets (D5) -- fail-closed on phantom / ambiguous / cross-run.
  const loc = resolveSingleRun(wantTargets, { stateDir });
  if (loc.refused) { const { refused: code, ...extra } = loc; return refuse(code, extra); }
  const runId = loc.runId;

  // (5) Per-target IDOR eligibility (D4 -- after run-resolution; all-or-nothing). Any kernel-owned / manage-op
  // target refuses the WHOLE op before any mint.
  for (const t of wantTargets) {
    const elig = eligibilityRefusal(readById(t, { runId, stateDir }));
    if (elig) return refuse(elig, { target: t });
  }

  // (5.5) PROMOTE-PATH BREAKER (W2b.2, EC2): bound the destruction RATE before the irreversible mint.
  // Evaluate the `manage-promote` source (committed TOMBSTONE/SUPERSEDE mints, CROSS-run, windowed on FS
  // mtime) on the GLOBAL cap (no persona — every mint carries the same writer_persona_id, so per-persona is
  // degenerate; F5). The breaker uses REAL wall-clock (NOT the caller's nowIso — else a future nowIso would
  // shift the window forward and age out the real recent mints → fail-to-trip; the C1 lesson at the window
  // level). It counts PRIOR committed mints (the in-flight one is not appended yet) → caps the (N+1)th.
  // Rides LOOM_MANAGE_ENFORCE (no second flag; the cap is live exactly when destruction is live — F2);
  // kill-switch is LOOM_DISABLE_CIRCUIT_BREAKER (opt-OUT). FAIL-CLOSED on a scan ERROR (M3): a thrown
  // source read REFUSES (never silently mints; preserves the never-throws contract).
  let breaker;
  try {
    breaker = evaluateBreaker({ source: 'manage-promote', stateDir });
  } catch (e) {
    return refuse('breaker-source-unavailable', { error: e && e.message ? e.message : String(e) });
  }
  // VALIDATE hacker M1: a nonzero excluded_future is a STORM-HIDING tamper signal — a same-uid utimes() of a
  // destructive mint into the future drops it from the window (under-count → fail-to-trip). The breaker
  // already computes it; for THIS irreversible op we fail-CLOSED on the signal rather than silently mint.
  if (breaker.excluded_future > 0) {
    return refuse('breaker-tamper-signal', { excluded_future: breaker.excluded_future });
  }
  if (breaker.tripped) {
    return refuse('breaker-open', {
      scope: breaker.scope, denials_in_window: breaker.denials_in_window, threshold: breaker.threshold, window_ms: breaker.window_ms,
    });
  }

  // (6) Mint: the human approval IS the A10 axiom (bound to the canonical proposal body). ONE atomic op naming
  // all targets in affected_records.
  const approvalAxiomHash = crypto.createHash('sha256').update(canonicalJsonSerialize(proposal)).digest('hex');
  let record;
  try {
    record = buildManageOpRecord({ operationClass, affectedRecords: wantTargets, proposalId, approvalAxiomHash, schemaVersion: SCHEMA_VERSION, nowIso });
  } catch (e) { return refuse('build-failed', { error: e.message }); }

  const res = appendRecord(record, { runId, stateDir });
  if (!res.ok) return refuse('append-failed', { reason: res.reason });

  // (7) POST-CONDITION verify (hacker CRITICAL -- the INV-22 poison-key fail-OPEN, exact-SET-equality). The
  // append may have DEDUPED against a pre-planted decoy carrying the same idempotency_key but a different
  // affected_records; re-read the STORED record and HARD-FAIL unless it acts on EXACTLY the approved set.
  const stored = readById(res.transaction_id, { runId, stateDir });
  if (!postConditionOk(stored, operationClass, new Set(wantTargets))) {
    return Object.freeze({
      ok: false,
      failed: 'post-condition-mismatch',
      detail: 'the stored op does not act on EXACTLY the approved target set as a COMMITTED op (possible INV-22 poison-key suppression)',
      transaction_id: res.transaction_id,
      deduped: !!res.deduped,
    });
  }

  return Object.freeze({ ok: true, transaction_id: res.transaction_id, runId, targets: wantTargets, operation_class: operationClass, deduped: !!res.deduped });
}

module.exports = { promoteProposal, OP_MAP };
