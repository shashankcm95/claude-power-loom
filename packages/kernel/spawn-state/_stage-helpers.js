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

/**
 * The per-spawn journal path: <stateDir>/<runId>/resolver-journal-<safeId>.jsonl.
 * Keyed off the SANITIZED id (the path component), so a fan-out's concurrent closes
 * never contend on a shared WAL (one file per spawn).
 */
function journalPathFor(stateDir, runId, safeId) {
  return path.join(stateDir, runId, `resolver-journal-${safeId}.jsonl`);
}

/**
 * Fail-soft boundary guard. journalPathFor -> path.join(stateDir, runId, ...) THROWS
 * a TypeError if stateDir/runId are not non-empty strings, and that throw happens
 * BEFORE a producer's try/catch — so it would escape the "NEVER throws" contract (the
 * journal would be unavailable to even record it). In production the hook always
 * threads non-empty strings, so this is a contract-honoring guard for a malformed
 * caller, not a live defect. Clamp the inputs at the edge (kb:architecture/discipline/
 * error-handling-discipline — "define errors out of existence").
 */
function hasValidStateArgs(stateDir, runId) {
  return typeof stateDir === 'string' && stateDir.length > 0
    && typeof runId === 'string' && runId.length > 0;
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
