'use strict';

// packages/kernel/spawn-state/stage-candidate.js
//
// PR-P3c-a — the close-path CANDIDATE PRODUCER. stageCandidate() is the producer
// half of the P3 enforcing integrator. It is gated upstream by the spawn-close
// hook's `LOOM_STAGE_CANDIDATES === '1'` branch (default OFF; shadow stays the
// default). When it runs, on a COMPLETED worktree-spawn close it:
//   1. materializes the spawn worktree's FULL delta into ONE durable commit object
//      via the merged PR-3c-a lib (materializeDelta squashes <fork>..HEAD + the
//      working tree) — delta_sha + tree + isEmpty;
//   2. records always-(tracked-)correct provenance: a genesis transaction-record
//      (buildSpawnRecord) with post_state_hash = computePostStateHash(tree) (the M1
//      forward-coupling hash) + head_anchor:null, appended to the content-addressed
//      store (appendRecord);
//   3. pins the delta under a HIDDEN `refs/loom/candidates/<safeId>` ref in the
//      PARENT ref store (a plain idempotent overwrite — NOT casAdvanceRef).
// It performs NO merges — the integrator (P3c-b) consumes the candidates later in
// an explicit, declared order. integrate-merge.js is NOT imported here.
//
// NEVER-TOUCH-HEAD (the honest scope). The user's working tree + HEAD are NEVER
// written. The mutation is: git objects (already in the shared worktree object
// store) + one hidden `refs/loom/candidates/*` ref. That ref is NOT in refs/heads/
// (so it can never be a checked-out branch — the spike S3 desync hazard cannot
// apply) and is invisible to `git branch`. It IS, however, a real write to the
// user's repo (the object store grows; the ref is GC-reachable until deleted) —
// the lock is on HEAD/the working tree, not on a no-write boundary.
//
// THE MERGE-BASE IS DERIVED, NOT PERSISTED (P3c-a /verify-plan board). The
// integrator's 3-way merge-base is each candidate's fork point = `delta_sha^1` (the
// squash commit's single parent), recoverable from the candidate ref alone — so
// head_anchor is recorded null. This is STRICTLY more robust than persisting it:
// the merge-base stays tied to the exact delta being merged and cannot diverge
// under the idempotent re-fire overwrite below.
//
// GENESIS = A STRUCTURAL GATE, NOT PROVENANCE. buildSpawnRecord -> finalizeGenesis
// validates the sentinel + content-hash + schema; it is NOT a provenance check (cf.
// stage-promote.js / quarantine-promote.js). No provenance verification exists at
// the candidate layer.
//
// FAIL-SOFT. Every throw is journaled and swallowed — the caller (the hook) still
// emitApprove()s + exits 0. ZERO eslint-disable; no-shell git (arg arrays only);
// functions < 50 lines.

const fs = require('fs');
const path = require('path');

const { appendWalRecord } = require('../_lib/wal-append.js');
const { runGitDefault } = require('../_lib/invoke-git.js');
const {
  materializeDelta,
  buildSpawnRecord,
  sanitizeAgentId,
  deriveParentRoot,
} = require('../_lib/quarantine-promote.js');
const { computePostStateHash } = require('../_lib/transaction-record.js');
const { appendRecord } = require('../_lib/record-store.js');

// NO hook-layer logger import (the journal IS the observability surface here,
// matching the sibling kernel libs stage-promote.js / post-spawn-resolver.js —
// importing `_log.js` would couple a kernel lib to the hooks layer).

const DIR_MODE = 0o700; // hygienic, matches stage-promote.js / spawn-record.js

// The hidden ref namespace for staged candidates. NOT under refs/heads/ — so a
// candidate never shows in `git branch` and can never be a checked-out branch.
const CANDIDATE_REF_PREFIX = 'refs/loom/candidates/';

/**
 * The per-spawn candidate journal path: <stateDir>/<runId>/resolver-journal-
 * <safeId>.jsonl — the same per-spawn-file basename convention as the shadow +
 * enforce paths, so a fan-out never contends on a shared WAL.
 */
function journalPathFor(stateDir, runId, safeId) {
  return path.join(stateDir, runId, `resolver-journal-${safeId}.jsonl`);
}

/**
 * Fail-soft boundary guard: journalPathFor -> path.join THROWS a TypeError if
 * stateDir/runId are not non-empty strings, BEFORE stageCandidate's try/catch — so
 * it would escape the "NEVER throws" contract. Clamp the inputs at the edge
 * (mirrors stage-promote.js:hasValidStateArgs).
 */
function hasValidStateArgs(stateDir, runId) {
  return typeof stateDir === 'string' && stateDir.length > 0
    && typeof runId === 'string' && runId.length > 0;
}

/**
 * Append one record to the per-spawn candidate journal (fail-soft — a journal
 * write failure must never change the caller's result). Lazily creates the run dir
 * 0o700. Every record is stamped mode:'candidate-stage'.
 */
function journal(journalFile, record) {
  try {
    fs.mkdirSync(path.dirname(journalFile), { recursive: true, mode: DIR_MODE });
  } catch { /* best-effort: a mkdir failure surfaces on the appendWalRecord below */ }
  appendWalRecord(
    journalFile,
    { mode: 'candidate-stage', resolved_at: new Date().toISOString(), ...record },
    { failSoft: true }
  );
}

/**
 * Build the two harness-bound, UNGUARDED git runners materializeDelta needs
 * (add / write-tree / commit-tree / diff-tree / merge-base / rev-parse /
 * worktree-list are all refused by the shadow guarded read-only runner). Both bind
 * runGitDefault to the harness worktree; runGitWithEnv carries the per-call
 * extraEnv (GIT_INDEX_FILE) for the temp-index squash.
 */
function makeHarnessRunners(harnessWorktreePath) {
  return {
    runGit: (a) => runGitDefault(harnessWorktreePath, a),
    runGitWithEnv: (a, env) => runGitDefault(harnessWorktreePath, a, env),
  };
}

/**
 * Materialize the spawn's delta — via the injected materializeDeltaFn seam (test
 * shape injection) when present, else the merged harness-bound materializeDelta.
 * Returns {delta_sha, candidateRel, isEmpty, tree, parentHead}.
 */
function materialize(args, harnessRunners) {
  if (typeof args.materializeDeltaFn === 'function') {
    return args.materializeDeltaFn({ ...args, ...harnessRunners });
  }
  return materializeDelta({
    worktreePath: args.harnessWorktreePath,
    agentId: args.agentId,
    runGit: harnessRunners.runGit,
    runGitWithEnv: harnessRunners.runGitWithEnv,
  });
}

/**
 * SRP — build + append the genesis provenance record (via the appendRecordFn seam
 * when present). post_state_hash = computePostStateHash(tree) (the M1 producer);
 * head_anchor:null (the merge-base is derived, not persisted — see the module
 * header). Returns {ok:true, record} or, on a record-write failure, journals
 * 'candidate-record-failed' and returns {ok:false} — the FLAG-2 ref-implies-record
 * invariant (never write the candidate ref without its provenance record).
 */
function recordProvenance(args, safeId, postStateHash, journalFile) {
  const record = buildSpawnRecord({
    agentId: args.agentId,
    personaId: args.personaId,
    schemaVersion: args.schemaVersion,
    postStateHash,
    headAnchor: null,
  });
  const appendFn = typeof args.appendRecordFn === 'function' ? args.appendRecordFn : appendRecord;
  const appended = appendFn(record, { runId: args.runId, stateDir: args.stateDir });
  if (!appended || !appended.ok) {
    journal(journalFile, {
      kind: 'candidate-record-failed',
      spawn_id: safeId,
      reason: appended ? appended.reason : 'append-returned-falsy',
    });
    return { ok: false };
  }
  return { ok: true, record };
}

/**
 * SRP — pin delta_sha under refs/loom/candidates/<safeId> in the PARENT ref store
 * (a plain idempotent overwrite — NOT casAdvanceRef; the sibling race is at the
 * integration tip, P3c-b). The object is already in the shared object store; the
 * ref keeps it reachable past the worktree's GC. Returns {ok:true, ref} or journals
 * 'candidate-ref-failed' + {ok:false}. runGitDefault never throws (returns
 * {ok:false}), so a bad object / refname is detected via .ok, not a try/catch.
 */
function pinCandidateRef(args, harnessRunners, safeId, deltaSha, journalFile) {
  const parentRoot = deriveParentRoot(args.harnessWorktreePath, harnessRunners.runGit);
  const runGitParent = (a) => runGitDefault(parentRoot, a);
  const ref = `${CANDIDATE_REF_PREFIX}${safeId}`;
  const upd = runGitParent(['update-ref', ref, deltaSha]);
  if (!upd || !upd.ok) {
    const stderr = (upd && upd.stderr) ? String(upd.stderr).slice(0, 200) : 'no stderr';
    journal(journalFile, { kind: 'candidate-ref-failed', spawn_id: safeId, ref, delta_sha: deltaSha, reason: stderr });
    return { ok: false };
  }
  return { ok: true, ref };
}

/**
 * SRP — the pre-try guard stage (fail-soft, before any throw-capable work). Returns
 * {done:true, result} for an early-return guard, or {done:false, safeId, journalFile}
 * to proceed. Keeps stageCandidate's orchestration a readable < 50-line skeleton
 * (code-reviewer PRINCIPLE). The three guards:
 *   - invalid stateDir/runId -> 'invalid-args' (clamps the path.join TypeError edge
 *     BEFORE journalPathFor, so the "NEVER throws" contract holds);
 *   - empty safeId -> 'bad-id' (FLAG-1: an empty id would form the git-invalid ref
 *     `refs/loom/candidates/`; no meaningful per-spawn journal key exists for an
 *     id-less spawn — mirrors the shadow hook's no-id no-op — so it returns without
 *     a journal file);
 *   - non-completed status -> 'non-completed' (journaled).
 *
 * @param {object} args  the stageCandidate args.
 * @returns {{done:true, result:object}|{done:false, safeId:string, journalFile:string}}
 */
function precheck(args) {
  const { agentId, toolResponse, runId, stateDir } = args || {};
  if (!hasValidStateArgs(stateDir, runId)) {
    return { done: true, result: { staged: false, reason: 'invalid-args' } };
  }
  const safeId = sanitizeAgentId(agentId);
  if (safeId.length === 0) {
    return { done: true, result: { staged: false, reason: 'bad-id' } };
  }
  const journalFile = journalPathFor(stateDir, runId, safeId);
  const status = toolResponse && toolResponse.status;
  if (status !== 'completed') {
    journal(journalFile, { kind: 'candidate-skipped-non-completed', spawn_id: safeId, observed_status: status || null });
    return { done: true, result: { staged: false, reason: 'non-completed' } };
  }
  return { done: false, safeId, journalFile };
}

/**
 * SRP — emit the success journal + the staged result for a pinned candidate. The
 * `note` is the honest scope contract (hidden idempotent ref; NO merge; derived
 * merge-base; structural-not-provenance; HEAD/working-tree untouched).
 */
function stagedResult(journalFile, safeId, ref, deltaSha, postStateHash, transactionId) {
  journal(journalFile, {
    kind: 'candidate-staged',
    spawn_id: safeId,
    ref,
    delta_sha: deltaSha,
    post_state_hash: postStateHash,
    transaction_id: transactionId,
    record_appended: true,
    note: 'P3c-a candidate: delta pinned under refs/loom/candidates/* (hidden ref, idempotent by id); '
      + 'NO merge (integrator P3c-b consumes it); head_anchor null (merge-base derived = delta_sha^1); '
      + 'genesis = STRUCTURAL gate, not provenance-verified; user HEAD/working tree untouched.',
  });
  return { staged: true, ref, delta_sha: deltaSha, post_state_hash: postStateHash, transaction_id: transactionId };
}

/**
 * The close-path candidate producer. See the module header for the full contract.
 * NEVER throws — every failure path journals + returns a result object so the caller
 * (the spawn-close hook) still approves + exits 0.
 *
 * @param {object} args
 * @param {string} args.harnessWorktreePath  the harness isolation:"worktree" (read-only here)
 * @param {string} args.agentId              the harness correlation id (sanitized for the ref name)
 * @param {object} args.toolResponse         the harness tool_response ({status, ...})
 * @param {string} args.runId                the per-run subdir id
 * @param {string} args.stateDir             the spawn-state base (LOOM_SPAWN_STATE_DIR)
 * @param {string} args.personaId            the authoring persona (genesis record)
 * @param {string} args.schemaVersion        e.g. 'v3' (drives the genesis hash)
 * @param {function} [args.materializeDeltaFn] TEST seam: inject a {delta_sha, isEmpty, tree} shape
 * @param {function} [args.appendRecordFn]     TEST seam: inject an appendRecord returning {ok:false}
 * @returns {{staged: boolean, ref?: string, delta_sha?: string, post_state_hash?: string,
 *            transaction_id?: string, reason?: string}}
 */
function stageCandidate(args) {
  const pre = precheck(args);
  if (pre.done) return pre.result;
  const { safeId, journalFile } = pre;

  try {
    const harnessRunners = makeHarnessRunners(args.harnessWorktreePath);
    const { delta_sha: deltaSha, isEmpty, tree } = materialize(args, harnessRunners);
    if (isEmpty) {
      journal(journalFile, { kind: 'candidate-noop-empty', spawn_id: safeId });
      return { staged: false, reason: 'empty-delta' };
    }

    // post_state_hash: the always-(tracked-)correct M1 hash from the materialized tree.
    // (A malformed materializeDelta shape with a non-hex `tree` makes computePostStateHash
    // throw -> caught below -> 'candidate-error', fail-soft — never a partial stage.)
    const postStateHash = computePostStateHash(tree);

    // Record FIRST, then the ref (FLAG-2 ordering): a record-success + ref-fail
    // leaves a harmless orphan record (unused provenance, tolerate-on-read); the
    // reverse — a ref with no record — is the confused success FLAG-2 forbids.
    // (P3c-b note: the integrator enumerates candidates by REF, not by a store query,
    // so such an orphan record is invisible to it — no dedup/cleanup burden here.)
    const prov = recordProvenance(args, safeId, postStateHash, journalFile);
    if (!prov.ok) return { staged: false, reason: 'record-write-failed' };

    const pin = pinCandidateRef(args, harnessRunners, safeId, deltaSha, journalFile);
    if (!pin.ok) return { staged: false, reason: 'ref-write-failed' };

    return stagedResult(journalFile, safeId, pin.ref, deltaSha, postStateHash, prov.record.transaction_id);
  } catch (err) {
    // Fail-soft: swallow every throw; record it in the journal, never propagate.
    journal(journalFile, { kind: 'candidate-error', spawn_id: safeId, error: err.message });
    return { staged: false, reason: 'threw' };
  }
}

module.exports = {
  stageCandidate,
  // exported for inspection / the smoke harness (not on the runtime path)
  CANDIDATE_REF_PREFIX,
};
