'use strict';

// packages/kernel/spawn-state/_stage-helpers.js
//
// Shared close-path staging helpers, extracted from the two spawn-close staging
// producers — stage-promote.js (PR-3c-b, the enforcing quarantine path) and
// stage-candidate.js (PR-P3c-a, the candidate producer). Both reached the same four
// byte-identical helpers; per the DRY "extract at the 2nd occurrence" threshold they
// live here so a fix to the journal-path convention, the boundary guard, the harness
// runner binding, or the materialize seam lands in ONE place.
//
// NOT shared: each producer's `journal()` stays local — it stamps a different
// `mode:` ('enforce-quarantine' vs 'candidate-stage'), which is load-bearing
// observability, not duplication.
//
// Pure functions, no module state. ZERO eslint-disable; functions < 50 lines.

const path = require('path');

const { runGitDefault } = require('../_lib/invoke-git.js');
const { materializeDelta } = require('../_lib/quarantine-promote.js');
const { isSafePathSegment } = require('../_lib/path-canonicalize.js');

/**
 * The per-spawn journal path: <stateDir>/<runId>/resolver-journal-<safeId>.jsonl.
 * Keyed off the SANITIZED id (the path component), so a fan-out's concurrent closes
 * never contend on a shared WAL (one file per spawn).
 */
function journalPathFor(stateDir, runId, safeId) {
  return path.join(stateDir, runId, `resolver-journal-${safeId}.jsonl`);
}

/**
 * Fail-soft boundary guard for the close-path staging producers (stage-promote +
 * stage-candidate). Two jobs:
 *
 *  (1) TYPE clamp — journalPathFor / createStagingWorktree -> path.join(stateDir,
 *      runId, ...) THROWS a TypeError on a non-string, BEFORE a producer's try/catch,
 *      escaping the "NEVER throws" contract. Clamp at the edge (kb:architecture/
 *      discipline/error-handling-discipline — "define errors out of existence").
 *
 *  (2) TRAVERSAL guard (CWE-22) — `runId` is the per-run SUBDIR segment joined under
 *      the shared `stateDir`. A traversal runId (`a/../b`, `x/..`) path.join-COLLAPSES
 *      in-base and would land the journal + staging worktree in a SIBLING run's dir
 *      (or the stateDir root) — and a base-anchored `checkWithinRoot` cannot catch it
 *      (path.join's normalization removes the `..` before the check sees it). So runId
 *      MUST be a safe single segment (path-canonicalize.isSafePathSegment), rejected
 *      BEFORE the join. `stateDir` is the trusted absolute base (legitimately holds
 *      separators) and stays a plain non-empty-string check.
 *
 * Defense-in-depth: the close-path runId is `sha256(session_id).slice(0,16)` /
 * UUID-derived by resolveRunId today, so no traversal is live-reachable — this matches
 * record-store.isSafeRunId's posture and guards a future runId source.
 */
function hasValidStateArgs(stateDir, runId) {
  return typeof stateDir === 'string' && stateDir.length > 0
    && isSafePathSegment(runId);
}

/**
 * Build the two harness-bound, UNGUARDED git runners materializeDelta needs (its
 * add / write-tree / commit-tree / diff-tree / merge-base / rev-parse / worktree-list
 * verbs are all refused by the shadow guarded read-only runner). Both bind
 * runGitDefault to the harness worktree; runGitWithEnv carries the per-call extraEnv
 * (GIT_INDEX_FILE) for the temp-index squash.
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

module.exports = {
  journalPathFor,
  hasValidStateArgs,
  makeHarnessRunners,
  materialize,
};
