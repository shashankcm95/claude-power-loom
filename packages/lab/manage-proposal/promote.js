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
//   - W2b.1 scope: MULTI-target -> `cull`->TOMBSTONE, `content-dedup`/`merge`->SUPERSEDE. The target set is
//     CANONICALIZED + re-capped at MAX_TARGETS at the boundary (a planted authentic row is not trusted as
//     canonical/bounded); per-target eligibility; `quarantine` REFUSES (recall-layer v3.8a).
//   - W2c scope: CROSS-RUN. Targets spanning runs are PARTITIONED by run (resolveTargetRuns -> Map) and minted
//     ONE COMMITTED op per run (each naming that run's subset), with per-(proposal,run) idempotency (the runId is
//     folded into writer_spawn_id — manage-op-record.js). The breaker is PREDICTIVE (denials+K>threshold ->
//     breaker-would-exceed, ZERO mints). Cross-run is NOT atomic: a per-run failure returns an honest
//     partial-cross-run {minted, unminted} (NO rollback — §0a.3.1; idempotent re-invoke recovers). A SINGLE
//     target id duplicated across runs (ambiguous) STAYS refused (target-in-multiple-runs-w2b).
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
const { appendRecord, readById, readByIdempotencyKey } = require('../../kernel/_lib/record-store');
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
 * Resolve the run holding EACH target -> a Map<runId, target[]> (W2c: cross-run is now LEGAL — the
 * `cross-run-deferred-w2c` refusal is LIFTED; targets spanning runs are PARTITIONED, one mint per run). Calls
 * findRecordRun on EVERY target (NOT readById against a guessed run), so each target is resolved to its OWN run
 * (architect VERIFY CRITICAL). Fail-closed: any phantom -> target-not-found; a SINGLE target id duplicated across
 * runs (loc.ambiguous) -> target-in-multiple-runs-w2b (D7 — under-determined, kept refused; orthogonal to
 * cross-run-DIFFERENT-targets).
 *
 * @param {string[]} targets canonical (dedup+sorted) target transaction_ids
 * @param {{stateDir?: string}} opts
 * @returns {{byRun: Map<string,string[]>} | {refused:string, [k:string]:*}}
 */
function resolveTargetRuns(targets, opts) {
  if (!Array.isArray(targets) || targets.length === 0) return { refused: 'no-targets' };
  const byRun = new Map();
  for (const t of targets) {
    const loc = findRecordRun(t, opts);
    if (!loc) return { refused: 'target-not-found', target: t };
    if (loc.ambiguous) return { refused: 'target-in-multiple-runs-w2b', target: t, runs: loc.runs };
    if (!byRun.has(loc.runId)) byRun.set(loc.runId, []);
    byRun.get(loc.runId).push(t);
  }
  return { byRun };
}

/**
 * Build the honest per-run mint-failure result (D4). TWO shapes by whether anything committed:
 *   - NO run committed yet (`minted` empty) -> a CLEAN total failure: surface the `cause` directly as `failed`
 *     (matches the single-run post-condition / append contract — there is no partial state to report).
 *   - SOME runs committed, the run at `failRid` did not -> a genuine cross-run PARTIAL: `failed:'partial-cross-run'`
 *     with `{minted, unminted, cause}`. NO rollback (un-committing a destructive op is itself a destructive op —
 *     §0a.3.1); recovery is an idempotent re-invoke (the per-(proposal,run) key DEDUPS the already-minted runs and
 *     retries only the unminted). `unminted` = failRid + every run after it in the sorted order.
 * Never throws — returns a frozen {ok:false} result.
 *
 * @param {object[]} minted the already-committed per-run mint records (frozen entries)
 * @param {string[]} runIds the full sorted run order
 * @param {string} failRid the run that failed
 * @param {string} cause the per-run failure code (append-failed | append-error | build-failed | post-condition-mismatch)
 * @param {object} [extra] additional context
 * @returns {Readonly<object>}
 */
function partialResult(minted, runIds, failRid, cause, extra) {
  const mintedRuns = new Set(minted.map((m) => m.runId));
  const unminted = runIds.filter((r) => !mintedRuns.has(r));
  if (minted.length === 0) {
    // No partial state — a clean total failure (single-run, or the first run failing). Surface the cause.
    return Object.freeze({ ok: false, failed: cause, fail_run: failRid, unminted: Object.freeze(unminted), ...extra });
  }
  return Object.freeze({
    ok: false,
    failed: 'partial-cross-run',
    cause,
    fail_run: failRid,
    minted: Object.freeze(minted.slice()),
    unminted: Object.freeze(unminted),
    ...extra,
  });
}

/**
 * Append each PLANNED per-run mint (one COMMITTED op per run, naming THAT run's subset). On the FIRST per-run
 * failure: STOP and return the honest partial (D4 — no rollback; idempotent retry recovers). Per-run: append ->
 * re-read + exact-SET post-condition on THAT run's subset (architect F4 — the global set would falsely reject).
 * Every append is wrapped so a thrown error (e.g. a transient EACCES) becomes a clean partial, never a propagated
 * throw (the never-throws contract).
 *
 * @param {Array<{rid:string, subset:string[], record:object}>} planned the per-run build plan (sorted runId order)
 * @param {string[]} runIds the full sorted run order (for the unminted computation)
 * @param {string} operationClass the expected COMMITTED op class
 * @param {{stateDir?: string}} opts
 * @returns {{minted: object[]} | Readonly<object>} {minted} on full success, else a frozen partialResult
 */
function mintPlannedRuns(planned, runIds, operationClass, opts) {
  const { stateDir } = opts;
  const minted = [];
  for (const p of planned) {
    let res;
    try {
      res = appendRecord(p.record, { runId: p.rid, stateDir });
    } catch (e) { return partialResult(minted, runIds, p.rid, 'append-error', { error: e && e.message ? e.message : String(e) }); }
    if (!res.ok) return partialResult(minted, runIds, p.rid, 'append-failed', { reason: res.reason });
    // POST-CONDITION (hacker CRITICAL -- the INV-22 poison-key fail-OPEN): the append may have DEDUPED against a
    // pre-planted decoy with the same (proposalId, runId) key but a different affected_records; re-read + HARD-FAIL
    // unless the stored op acts on EXACTLY this run's subset (exact-SET-equality; superset/subset/dup-pad/foreign).
    let stored;
    try { stored = readById(res.transaction_id, { runId: p.rid, stateDir }); } catch { stored = null; }
    if (!postConditionOk(stored, operationClass, new Set(p.subset))) {
      return partialResult(minted, runIds, p.rid, 'post-condition-mismatch', { transaction_id: res.transaction_id, deduped: !!res.deduped });
    }
    minted.push(Object.freeze({ runId: p.rid, transaction_id: res.transaction_id, targets: Object.freeze([...p.subset]), deduped: !!res.deduped }));
  }
  return { minted };
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
 * Promote ONE explicit approved `cull` / `content-dedup` / `merge` proposal to COMMITTED kernel ops
 * (TOMBSTONE / SUPERSEDE) over its MULTI-target, possibly CROSS-RUN set (W2c — one mint per run).
 * Human-gated + flag-gated + shadow-default. NEVER throws -- returns a frozen { ok, ... } result.
 *
 * @param {string} proposalId the id the human reviewed + approved
 * @param {{stateDir?: string, nowIso?: string}} [opts]
 * @returns {object} frozen: { ok:true, operation_class, targets, mints:[{runId, transaction_id, targets, deduped}] }
 *                   | { ok:false, refused, ... } (pre-flight) | { ok:false, failed:'partial-cross-run', minted, unminted, ... }
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

  // (4) Resolve EACH target's run -> a Map<runId, target[]> (W2c: cross-run is now LEGAL). Fail-closed on
  // phantom / ambiguous (D7). Deterministic sorted run order -> the mint loop + the mints[] result reproduce.
  const resolved = resolveTargetRuns(wantTargets, { stateDir });
  if (resolved.refused) { const { refused: code, ...extra } = resolved; return refuse(code, extra); }
  const byRun = resolved.byRun;
  const runIds = [...byRun.keys()].sort();

  // (5) Per-target IDOR eligibility (all-or-nothing, BEFORE any mint). Read each target against its OWN run
  // (the byRun map — the W2a CRITICAL: never a guessed run). Any kernel-owned / manage-op target refuses the
  // WHOLE op across all runs (no partial mint on an eligibility failure — that is a pre-flight refusal, distinct
  // from the post-flight partial-cross-run).
  for (const rid of runIds) {
    for (const t of byRun.get(rid)) {
      const elig = eligibilityRefusal(readById(t, { runId: rid, stateDir }));
      if (elig) return refuse(elig, { target: t });
    }
  }

  // (6) PLAN the per-run mints UP FRONT (before the breaker): build each run's record + determine which runs will
  // DEDUP (an existing committed mint for the same (proposalId, runId) key) vs net-MINT. The approval axiom is
  // computed ONCE — it is per-PROPOSAL, identical for every per-run mint (architect F9). A build error here is a
  // clean pre-flight refuse (nothing minted yet). Pure: buildManageOpRecord + readByIdempotencyKey are read-only.
  const approvalAxiomHash = crypto.createHash('sha256').update(canonicalJsonSerialize(proposal)).digest('hex');
  const planned = [];
  for (const rid of runIds) {
    const subset = byRun.get(rid);
    let record;
    try {
      record = buildManageOpRecord({ operationClass, affectedRecords: subset, proposalId, runId: rid, approvalAxiomHash, schemaVersion: SCHEMA_VERSION, nowIso });
    } catch (e) { return refuse('build-failed', { error: e.message, run: rid }); }
    let willDedup = false;
    try { willDedup = !!readByIdempotencyKey(record.idempotency_key, { runId: rid, stateDir }); } catch { willDedup = false; }
    planned.push({ rid, subset, record, willDedup });
  }

  // (6.5) PROMOTE-PATH BREAKER (W2b.2 EC2, W2c-predictive). Evaluate the `manage-promote` source (committed
  // TOMBSTONE/SUPERSEDE mints, CROSS-run, windowed on FS mtime) ONCE on the GLOBAL cap (no persona — every mint
  // carries the same writer_persona_id, so per-persona is degenerate; F5). ONE evaluation, not per-run (per-run
  // re-eval would manufacture partials — architect D5). REAL wall-clock (NOT the caller's nowIso — else a future
  // nowIso would age out the recent mints → fail-to-trip; the C1 window-level lesson).
  // PREDICTIVE (hacker VERIFY H1/F2 + VALIDATE H1): K = the count of runs that will NET-MINT (NOT runIds.length —
  // a run that will dedup adds 0 net destruction AND is already counted in denials_in_window, so counting it in K
  // too would double-count it and WEDGE the documented partial-retry recovery near the threshold). Refuse
  // `breaker-would-exceed` (ZERO mints) if denials_in_window + K would EXCEED the threshold — a non-predictive
  // check lets ONE approval mint up to #runs<=MAX_TARGETS irreversible ops past the cap. The arithmetic is HERE
  // (the breaker stays source-agnostic — architect SRP). Rides LOOM_MANAGE_ENFORCE (no second flag — F2);
  // kill-switch LOOM_DISABLE_CIRCUIT_BREAKER. FAIL-CLOSED on a scan error / tamper signal (never silently mints).
  const k = planned.filter((p) => !p.willDedup).length;
  let breaker;
  try {
    breaker = evaluateBreaker({ source: 'manage-promote', stateDir });
  } catch (e) {
    return refuse('breaker-source-unavailable', { error: e && e.message ? e.message : String(e) });
  }
  // VALIDATE hacker M1: a nonzero excluded_future is a STORM-HIDING tamper signal — a same-uid utimes() of a
  // destructive mint into the future drops it from the window (under-count → fail-to-trip). Fail-CLOSED. (The
  // signal is one-directional: a BACK-date storm is the un-instrumented OQ-E/sandbox residual — record-scan.js.)
  if (breaker.excluded_future > 0) {
    return refuse('breaker-tamper-signal', { excluded_future: breaker.excluded_future });
  }
  if (breaker.tripped) {
    return refuse('breaker-open', {
      scope: breaker.scope, denials_in_window: breaker.denials_in_window, threshold: breaker.threshold, window_ms: breaker.window_ms,
    });
  }
  // The predictive bound (strict `>`): a promotion may bring the window count UP TO the threshold (matching the
  // existing K=1 "the threshold-reaching mint is allowed, the next is refused" behavior), never PAST it.
  if (breaker.denials_in_window + k > breaker.threshold) {
    return refuse('breaker-would-exceed', {
      denials_in_window: breaker.denials_in_window, threshold: breaker.threshold, k, window_ms: breaker.window_ms,
    });
  }

  // (7) MINT each planned run (one COMMITTED op per run, sorted order; per-run exact-SET post-condition; honest
  // partial on the first failure — D4). (8) Success: clean-break {mints:[...]} (no single-run alias — architect
  // F5): operation_class + targets are PROMOTION-level; the per-run facts are in mints[] (sorted runId order).
  const outcome = mintPlannedRuns(planned, runIds, operationClass, { stateDir });
  if (outcome.failed) return outcome; // a partial / total mint failure
  return Object.freeze({
    ok: true,
    operation_class: operationClass,
    targets: wantTargets,
    mints: Object.freeze(outcome.minted),
  });
}

module.exports = { promoteProposal, OP_MAP };
