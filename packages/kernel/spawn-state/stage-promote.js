'use strict';

// packages/kernel/spawn-state/stage-promote.js
//
// PR-3c-b — the ENFORCING staging-promote. stagePromote() is the FIRST production
// code path that can reach the REAL k9.promoteDelta. It is gated upstream by the
// spawn-close hook's `LOOM_RESOLVER_ENFORCE === '1'` branch (default OFF; shadow
// stays the default). When it runs it:
//   1. materializes the spawn worktree's FULL delta into ONE commit object via the
//      merged PR-3c-a lib (materializeDelta squashes <merge-base>..HEAD + the
//      working tree) — delta_sha + candidateRel + isEmpty;
//   2. builds a genesis transaction_record (buildGenesisRecord);
//   3. creates a THROWAWAY staging worktree OUT-OF-REPO under the spawn-state dir
//      on a NEW `loom-promote/<safeId>` branch off the parent HEAD;
//   4. runs the real resolve() (omit promoteDeltaFn -> real k9.promoteDelta; omit
//      runGitFn -> the runner binds to worktree_root = the staging worktree) so the
//      cherry-pick lands ON the loom-promote branch IN staging;
//   5. KEEPS loom-promote/<safeId> for human review iff the verdict PROMOTED;
//      DISCARDS it (branch -D, after worktree remove) on every other verdict;
//   6. removes the staging worktree on every path it was created (a
//      `stagingCreated`-guarded, try/catch-wrapped finally).
//
// QUARANTINE (the honest scope). The user's working tree + HEAD are NEVER written:
// all mutation is confined to the out-of-repo staging worktree + a deletable
// `loom-promote/*` ref. Genesis passes K9's STRUCTURAL gate, not a provenance
// check — HUMAN review of the staged branch is the only provenance + scope gate.
// K14 scope detection is a DELIBERATE no-op here (k14_ctx:{} -> classifyTarget
// returns null -> detect()=[]). The journal says all of this; it never claims
// "sandboxed" / "auto-promoted" / "provenance-verified" (B-D8 / S5).
//
// THE THREE RUNNERS (code-reviewer CRITICAL-1). materializeDelta issues add /
// write-tree / commit-tree / diff-tree / merge-base / rev-parse / worktree-list —
// ALL refused by the shadow GUARDED read-only runner — so it gets its OWN
// UNGUARDED harness-bound runners (runGitDefault bound to harnessWorktreePath).
// The worktree lifecycle (worktree add/remove/prune, branch -D) runs against the
// PARENT root. The cherry-pick uses resolve()'s DEFAULT runner (bound to the
// staging worktree). One shared runGitDefault; three distinct bindings.
//
// FAIL-SOFT (B-D7 / S6). Every throw is journaled and swallowed — the caller (the
// hook) still emitApprove()s + exits 0. resolve() is IMMUTABLE (only CALLED here).
// ZERO eslint-disable; no-shell git (arg arrays only); functions < 50 lines.

const fs = require('fs');
const path = require('path');

const { appendWalRecord } = require('../_lib/wal-append.js');
const { checkWithinRoot } = require('../_lib/path-canonicalize.js');
const { runGitDefault } = require('../_lib/invoke-git.js');
const {
  materializeDelta,
  buildGenesisRecord,
  sanitizeAgentId,
  deriveParentRoot,
} = require('../_lib/quarantine-promote.js');
const { resolve } = require('./post-spawn-resolver.js');

// NO hook-layer logger import (the journal IS the observability surface here,
// matching the sibling kernel libs post-spawn-resolver.js / recovery-sweep.js —
// `_log.js` is hooks-layer infrastructure and importing it would couple a kernel
// lib to the hooks layer, breaking the kernel DAG direction; the per-spawn enforce
// journal records every failure path the tests assert on).

const DIR_MODE = 0o700; // hygienic, matches the shadow hook + spawn-record.js

// DN-4 / HIGH-3 / HIGH-4: the verdict-completeness data guard. A verdict.action IN
// this Set KEEPS loom-promote/<safeId> for human review; EVERYTHING else DISCARDS
// it (branch -D in cleanup). Encoding it as DATA (not an if/else) means a future
// resolver action can never silently fall into "keep" — the test inspects the Set
// directly and asserts ACCEPT (NOOP empty branch) + HARD_RESET are excluded.
const KEEP_BRANCH_ACTIONS = new Set(['PROMOTE', 'PROMOTE_WITH_AUDIT']);

// HARDEN (3-lens HIGH — journal-honesty / B-D8): the verdict.action -> journal
// `kind` map. Encoded AS DATA (parallel to KEEP_BRANCH_ACTIONS) so the `kind` a
// reviewer greps first reflects the ACTUAL disposition family, not a single
// hardcoded "noop" string. The prior binary (keep ? 'enforce-promoted' :
// 'enforce-noop-already-present') mislabelled a CONFLICT-aborted (REJECT_CONFLICT /
// HARD_RESET) or scope/evidence-rejected delta as "noop, already present" — a
// factual lie a human reading the journal cannot disambiguate from a benign noop
// (kb:architecture/discipline/error-handling-discipline — "returning a sentinel that
// callers can't disambiguate"). The keep/PROMOTE kinds are handled in journalVerdict;
// this map covers the DISCARD family. A verdict.action absent here falls back to the
// generic 'enforce-rejected' (a future resolver action is recorded as rejected, never
// silently as a noop — the fail-safe direction).
const DISPOSITION_KIND = Object.freeze({
  // ACCEPT === K9 NOOP_ALREADY_PRESENT: the delta really IS already in the parent
  // (an empty branch) — the one case the legacy token was correct for (P15).
  ACCEPT: 'enforce-noop-already-present',
  // The cherry-pick CONFLICTED. ABORTED = `--abort` confirmed; HARD_RESET = the
  // whole-tree was dirty after an unconfirmed abort and K9 reset it. A reviewer may
  // want to act on a conflict — it must read distinctly from a benign noop.
  REJECT_CONFLICT: 'enforce-conflict-rejected',
  HARD_RESET: 'enforce-conflict-rejected',
  ABORTED: 'enforce-aborted',
  // Gate rejections (scope / evidence / request). REJECT_SCOPE is unreachable while
  // k14_ctx:{} (a deliberate no-op; LOW), but mapping it future-proofs the surface
  // for when K14 is enabled in the enforcing path.
  REJECT_SCOPE: 'enforce-rejected-scope',
  REJECT_EVIDENCE: 'enforce-rejected-evidence',
  REJECT_REQUEST: 'enforce-rejected-request',
});

/**
 * The per-spawn enforce journal path: <stateDir>/<runId>/resolver-journal-
 * <safeId>.jsonl. Keyed off the SANITIZED id (the path/branch component — HIGH-5),
 * mirroring the shadow hook's per-spawn-file basename so a fan-out never contends
 * on a shared WAL.
 */
function journalPathFor(stateDir, runId, safeId) {
  return path.join(stateDir, runId, `resolver-journal-${safeId}.jsonl`);
}

/**
 * Fail-soft boundary guard (3-lens MED). journalPathFor -> path.join(stateDir,
 * runId, ...) THROWS a TypeError if stateDir/runId are not non-empty strings, and
 * that throw happens BEFORE stagePromote's try/catch — so it would escape the
 * "NEVER throws" contract (the journal would be unavailable to even record it). In
 * production the hook always threads non-empty strings, so this is a contract-
 * honoring guard for a malformed caller, not a live defect. Clamp the inputs at the
 * edge (kb:architecture/discipline/error-handling-discipline — "define errors out
 * of existence"; kb:backend-dev/node-runtime-basics — validate at the boundary).
 */
function hasValidStateArgs(stateDir, runId) {
  return typeof stateDir === 'string' && stateDir.length > 0
    && typeof runId === 'string' && runId.length > 0;
}

/**
 * Append one record to the per-spawn enforce journal (fail-soft — a journal write
 * failure must never change the caller's approve verdict). Lazily creates the run
 * dir 0o700. Every record is stamped enforce-quarantine / enforced (B-D8).
 */
function journal(journalFile, record) {
  try {
    fs.mkdirSync(path.dirname(journalFile), { recursive: true, mode: DIR_MODE });
  } catch { /* best-effort: a mkdir failure surfaces on the appendWalRecord below */ }
  appendWalRecord(
    journalFile,
    { mode: 'enforce-quarantine', enforced: true, resolved_at: new Date().toISOString(), ...record },
    { failSoft: true }
  );
}

/**
 * Build the three harness-bound, UNGUARDED git runners materializeDelta needs
 * (CRITICAL-1). Both bind runGitDefault to the harness worktree; runGitWithEnv
 * carries the per-call extraEnv (GIT_INDEX_FILE) for the temp-index squash.
 */
function makeHarnessRunners(harnessWorktreePath) {
  return {
    runGit: (a) => runGitDefault(harnessWorktreePath, a),
    runGitWithEnv: (a, env) => runGitDefault(harnessWorktreePath, a, env),
  };
}

/**
 * SRP — create the THROWAWAY staging worktree on a NEW loom-promote/<safeId> branch
 * off the parent HEAD, OUT-OF-REPO under the spawn-state dir. Returns
 * {ok, stagingPath, reason}. Boundary-checks the staging path against stateDir
 * (HIGH-5 / MED-6 / CWE-22) BEFORE `worktree add`; a non-zero add (collision /
 * duplicate close) is a fail-soft skip (B-D6). NEVER throws. The parent-bound
 * runner (`runGitParent`) already carries the parent root, so the parent path is
 * not a separate param here.
 *
 * @param {object} args {stateDir, runId, safeId, runGitParent}
 * @returns {{ok: boolean, stagingPath: string, reason: string|null}}
 */
function createStagingWorktree({ stateDir, runId, safeId, runGitParent }) {
  const stagingPath = path.join(stateDir, runId, 'promote-staging', safeId);
  const scope = checkWithinRoot(stagingPath, stateDir);
  if (!scope.ok) {
    return { ok: false, stagingPath, reason: `staging-out-of-scope:${scope.reason}` };
  }
  const branch = `loom-promote/${safeId}`;
  const add = runGitParent(['worktree', 'add', '-b', branch, stagingPath, 'HEAD']);
  if (!add || !add.ok) {
    const stderr = (add && add.stderr) ? String(add.stderr).slice(0, 200) : 'no stderr';
    return { ok: false, stagingPath, reason: `worktree-add-failed:${stderr}` };
  }
  return { ok: true, stagingPath, reason: null };
}

/**
 * SRP — the FRESH enforcing envelope (B-D4; NOT a patched shadow envelope). Its
 * worktree_root + candidate_path are the STAGING worktree (so K9's cherry-pick cwd
 * AND the CWE-22 scope root are staging). commit_outcome:'COMMITTED' is sound
 * because the status guard already required status==='completed'. k14_ctx:{} makes
 * K14 detect a deliberate clean no-op (the human review is the scope gate).
 *
 * `journal_path` is DELIBERATELY OMITTED (resolved a plan-vs-runtime mismatch in
 * B-D4's literal field list — probed against k9-promote-deltas.js:399-404): K9
 * CWE-22-scope-checks `envelope.journal_path` against worktree_root (= the staging
 * root), but the per-spawn enforce journal lives OUTSIDE staging by design (B-D3:
 * <stateDir>/<runId>/...  vs staging <stateDir>/<runId>/promote-staging/<safeId>),
 * so threading it would make K9 return REJECTED_REQUEST 'journal-path-out-of-scope'
 * and the clean promote could NEVER land. K9's reverse-cherrypick ledger is an
 * OPTIONAL concern we skip in quarantine (the throwaway worktree is deleted on
 * cleanup anyway); the enforce journal is the resolver's separate `walPath`/auditFn
 * surface — unaffected. Omitting it (journalPath==null) makes K9 skip the check.
 */
function buildEnforcingEnvelope({ stagingPath, candidateRel, deltaSha, transactionRecord, safeId }) {
  return {
    spawn_id: safeId,
    worktree_root: stagingPath,
    candidate_path: path.join(stagingPath, candidateRel),
    delta_sha: deltaSha,
    transaction_record: transactionRecord,
    is_genesis_position: true,
    commit_outcome: 'COMMITTED',
    k14_ctx: {},
  };
}

/**
 * SRP — run the REAL resolve() against the staging envelope (B-D5). OMIT
 * promoteDeltaFn (-> real k9.promoteDelta) + OMIT runGitFn (-> resolveRunGit binds
 * the runner to worktree_root = staging). Keep genesis (resolveParentFn:undefined)
 * + the K13 no-op seams (the harness owns concurrency; no admission marker exists)
 * + auditFn/walPath = the per-spawn journal. Returns the verdict.
 */
function runStagedResolve(envelope, journalFile) {
  return resolve({
    envelope,
    walPath: journalFile,
    auditFn: (record) => journal(journalFile, { kind: 'enforce-audit', ...record }),
    resolveParentFn: undefined,
    readMarkerFn: () => null,
    releaseSerialMarkerFn: () => ({ released: false, reason: 'enforce-k13-skip' }),
    stateDir: path.dirname(journalFile),
  });
}

/**
 * SRP — fail-soft, ORDERED cleanup of the staging worktree (B-D7 / CRITICAL-2 /
 * MED-7). `worktree remove --force` -> `worktree prune` -> (if !keep) `branch -D`
 * — branch -D runs AFTER remove because git refuses to delete a checked-out
 * branch. A cleanup anomaly journals 'staging-cleanup-failed' and is NEVER thrown
 * (runGitDefault never throws — it returns {ok:false} — so a non-ok remove is
 * detected by inspecting `.ok`, not via try/catch; the try/catch is the last-line
 * guard against an UNEXPECTED throw, e.g. an OOM in mkdir under journal()). The
 * harness worktree is never touched.
 *
 * Anomaly detection (MED-7 / P14): a staging checkout dir removed OUT-OF-BAND
 * before cleanup (the P14 injection) is the failure mode this proves fail-soft.
 * Git's `worktree remove --force` TOLERATES a missing checkout dir on current
 * versions (returns ok), so the deterministic signal is "the staging path is
 * already gone at cleanup entry" — journal it, then still best-effort prune +
 * branch -D so no registration/ref leaks.
 */
function cleanupStaging({ stagingPath, safeId, keep, runGitParent, journalFile }) {
  try {
    const missingBefore = !fs.existsSync(stagingPath);
    const remove = runGitParent(['worktree', 'remove', '--force', stagingPath]);
    if (missingBefore || !remove || !remove.ok) {
      const stderr = (remove && remove.stderr) ? String(remove.stderr).slice(0, 200) : null;
      journal(journalFile, {
        kind: 'staging-cleanup-failed',
        staged_branch: `loom-promote/${safeId}`,
        reason: missingBefore ? 'staging-dir-missing-before-cleanup' : `worktree-remove-failed:${stderr}`,
      });
    }
    runGitParent(['worktree', 'prune']);
    if (!keep) {
      runGitParent(['branch', '-D', `loom-promote/${safeId}`]);
    }
  } catch (err) {
    journal(journalFile, { kind: 'staging-cleanup-failed', error: err.message, staged_branch: `loom-promote/${safeId}` });
  }
}

/**
 * Materialize the spawn's delta — via the injected materializeDeltaFn seam (P16
 * shape injection) when present, else the merged harness-bound materializeDelta.
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
 * Materialize the delta and apply the two pre-staging skip guards (B-D2.2): an
 * EMPTY squash -> 'enforce-noop-empty'; a non-empty delta with an empty
 * candidateRel (a rare diff-tree miss) -> 'enforce-no-candidate' (architect MED-1).
 * Returns either {skip:true, result} (journaled, no staging happens) or
 * {skip:false, deltaSha, candidateRel}. Factored out so stagePromote's lifecycle
 * orchestration stays one readable < 50-line unit (kb:architecture/crosscut/single-
 * responsibility). Runs BEFORE staging exists, so a skip here never reaches the
 * stagingCreated-guarded cleanup.
 */
function materializeOrSkip(args, harnessRunners, journalFile, safeId) {
  const { delta_sha: deltaSha, candidateRel, isEmpty } = materialize(args, harnessRunners);
  if (isEmpty) {
    journal(journalFile, { kind: 'enforce-noop-empty', spawn_id: safeId });
    return { skip: true, result: { enforced: false, action: null, outcome: null, reason: 'empty-delta' } };
  }
  if (candidateRel === '') {
    journal(journalFile, { kind: 'enforce-no-candidate', spawn_id: safeId, delta_sha: deltaSha });
    return { skip: true, result: { enforced: false, action: null, outcome: null, reason: 'no-candidate' } };
  }
  return { skip: false, deltaSha, candidateRel };
}

/**
 * The journal `kind` for one verdict (B-D8 honesty). KEEP (PROMOTE / PROMOTE_WITH_
 * AUDIT) -> 'enforce-promoted'. Otherwise the DISPOSITION_KIND data map keyed by
 * verdict.action distinguishes a benign noop ('enforce-noop-already-present') from a
 * conflict ('enforce-conflict-rejected') / abort / gate-reject — so the token a
 * reviewer greps first is never a mislabel. An unknown action -> 'enforce-rejected'
 * (fail-safe: a future resolver action records as rejected, not as a silent noop).
 */
function dispositionKind(verdict, keep) {
  if (keep) return 'enforce-promoted';
  return DISPOSITION_KIND[verdict.action] || 'enforce-rejected';
}

/**
 * Journal the post-resolve quarantine verdict (B-D8). `outcome` carries K9's
 * PROMOTED vs NOOP so a reviewer never merges an empty branch expecting a delta
 * (architect MED-2); the `note` is the honesty contract (quarantine / human-
 * review-gated / K14 no-op / not-auto-merged / not-provenance-verified). The `kind`
 * is disposition-accurate (dispositionKind) — a conflict-reject is NOT recorded as
 * "noop, already present" (3-lens HIGH).
 */
function journalVerdict(journalFile, safeId, verdict, keep) {
  journal(journalFile, {
    kind: dispositionKind(verdict, keep),
    spawn_id: safeId,
    action: verdict.action,
    outcome: verdict.outcome,
    staged_branch: `loom-promote/${safeId}`,
    branch_kept: keep,
    note: 'staged to a quarantine branch for human review; NOT auto-merged; '
      + 'genesis = structural gate, not provenance-verified; K14 scope detection '
      + 'is a deliberate no-op in enforcing; user working tree/HEAD untouched.',
  });
}

/**
 * ENFORCING staging-promote. See the module header for the full contract. NEVER
 * throws — every failure path journals + returns a result object so the caller
 * (the spawn-close hook) still approves + exits 0.
 *
 * @param {object} args
 * @param {string} args.harnessWorktreePath  the harness isolation:"worktree" (read-only here)
 * @param {string} args.agentId              the harness correlation id (sanitized for paths/refs)
 * @param {object} args.toolResponse         the harness tool_response ({status, ...})
 * @param {string} args.runId                the per-run subdir id
 * @param {string} args.stateDir             the spawn-state base (LOOM_SPAWN_STATE_DIR)
 * @param {string} args.personaId            the authoring persona (genesis record)
 * @param {string} args.schemaVersion        e.g. 'v3' (drives the genesis hash)
 * @param {function} [args.materializeDeltaFn]  TEST seam (P16): inject a {delta_sha, candidateRel, isEmpty} shape
 * @param {function} [args.__onStagingCreated] TEST seam (P14): called with stagingPath right after `worktree add`
 * @returns {{enforced: boolean, action: string|null, outcome: string|null, reason: string|null}}
 */
function stagePromote(args) {
  const { agentId, toolResponse, runId, stateDir } = args || {};
  // Fail-soft boundary guard (3-lens MED): clamp malformed state args BEFORE the
  // path.join below (which would otherwise throw a TypeError that escapes the
  // "NEVER throws" contract). See hasValidStateArgs.
  if (!hasValidStateArgs(stateDir, runId)) {
    return { enforced: false, action: null, outcome: null, reason: 'invalid-args' };
  }
  const safeId = sanitizeAgentId(agentId);
  const journalFile = journalPathFor(stateDir, runId, safeId);

  // Status guard (MED-8 / B-D2): a failed/aborted spawn NEVER promotes — the fresh
  // envelope hardcodes COMMITTED, so a non-completed status must be rejected here.
  const status = toolResponse && toolResponse.status;
  if (status !== 'completed') {
    journal(journalFile, { kind: 'enforce-skipped-non-completed', spawn_id: safeId, observed_status: status || null });
    return { enforced: false, action: null, outcome: null, reason: 'non-completed' };
  }

  let stagingCreated = false;
  let stagingPath = null;
  let runGitParent = null;
  let keep = false;
  let result = { enforced: false, action: null, outcome: null, reason: null };
  try {
    const harnessRunners = makeHarnessRunners(args.harnessWorktreePath);
    const mat = materializeOrSkip(args, harnessRunners, journalFile, safeId);
    if (mat.skip) return mat.result; // empty / no-candidate — journaled, no staging

    const transactionRecord = buildGenesisRecord({
      agentId, personaId: args.personaId, schemaVersion: args.schemaVersion,
    });

    // Derive the PARENT root (the worktree-lifecycle runner binds to it) only now —
    // after the materialize guards (so the P16 injected-shape path returns without
    // a real worktree-list). runGit is the harness-bound runner the lib expects.
    // KNOWN + ACCEPTED double-derive (3-lens LOW / DRY): materializeDelta also calls
    // deriveParentRoot internally (one `git worktree list` against the SAME harness
    // worktree), so this is the 2nd identical subprocess for one deterministic value.
    // We re-derive (rather than thread the value out) DELIBERATELY: it preserves
    // materializeDelta's clean {delta_sha, candidateRel, isEmpty} single-return SRP
    // contract (kb:architecture/crosscut/single-responsibility), and the parent root
    // is stable across the two calls within one close. One cheap subprocess on a
    // cold path (one spawn-close) is worth less than the seam boundary (YAGNI).
    const parentRoot = deriveParentRoot(args.harnessWorktreePath, harnessRunners.runGit);
    runGitParent = (a) => runGitDefault(parentRoot, a);

    const staging = createStagingWorktree({ stateDir, runId, safeId, runGitParent });
    if (!staging.ok) {
      journal(journalFile, { kind: 'staging-add-failed', spawn_id: safeId, reason: staging.reason });
      return { enforced: false, action: null, outcome: null, reason: staging.reason };
    }
    stagingCreated = true;
    stagingPath = staging.stagingPath;
    if (typeof args.__onStagingCreated === 'function') args.__onStagingCreated(stagingPath);

    const envelope = buildEnforcingEnvelope({
      stagingPath, candidateRel: mat.candidateRel, deltaSha: mat.deltaSha, transactionRecord, safeId,
    });
    const verdict = runStagedResolve(envelope, journalFile);
    keep = KEEP_BRANCH_ACTIONS.has(verdict.action);
    journalVerdict(journalFile, safeId, verdict, keep);
    result = { enforced: true, action: verdict.action, outcome: verdict.outcome, reason: null };
  } catch (err) {
    // Fail-soft (B-D7): swallow every throw; record it in the journal, never
    // propagate (the journal is the observability surface — no hook-layer logger).
    journal(journalFile, { kind: 'enforce-error', spawn_id: safeId, error: err.message });
    result = { enforced: false, action: null, outcome: null, reason: 'threw' };
  } finally {
    // CRITICAL-2: clean up ONLY a staging worktree that was actually created. A
    // throw BEFORE `worktree add` (materialize / genesis / scope) leaves
    // stagingCreated=false, so the finally is a no-op (no cleanup on a non-existent
    // path masking the original error).
    if (stagingCreated) {
      cleanupStaging({ stagingPath, safeId, keep, runGitParent, journalFile });
    }
  }
  return result;
}

module.exports = {
  stagePromote,
  KEEP_BRANCH_ACTIONS,
  // exported for inspection / the smoke harness (not on the runtime path)
  createStagingWorktree,
  buildEnforcingEnvelope,
  cleanupStaging,
};
