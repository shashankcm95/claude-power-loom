'use strict';

// K1 — declarative git-worktree allocator (v3.0-alpha, PR 2).
//
// v6 spec anchor: §6.1.1 K1 — "declarative worktree integration". Provides the
// isolated worktree a spawn writes into, which is the substrate K14 (write-scope
// detection) and K9 (delta cherry-pick) build on in PR 4. Ships as a LIBRARY
// (ships dormant — no hooks.json entry in PR 2; consumed by PR 4's
// post-spawn-resolver / spawn-init flow). Same ship-dormant shape as K9/K13.
//
// Three guarantees:
//   1. retry — transient `git worktree add` failures are retried up to
//      maxAttempts (default 3) with an injectable backoff.
//   2. cleanup — every failed attempt removes any partial worktree before the
//      next try (resource-leak guard — code-reviewer focus per plan phase 9).
//   3. escape-hatch composition (K10) — respects LOOM_DISABLE_WORKTREE; and if
//      allocation fails after all retries, "the escape hatch fires": K1 degrades
//      to a no-worktree mode + Class-4 audit (plan verification probe:
//      "3 retries → escape hatch fires").
//
// Security: all git invocations use execFile-style ARGUMENT ARRAYS (never a
// shell string) — closes CWE-78 command injection on worktree paths / refs
// (verify-plan ROUND 2 vlad). Path arguments pass through as single argv
// elements; no interpolation, no word-splitting.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { evaluateEscapeHatches } = require('../enforcement/k10-escape-hatch');

const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Default git runner — execFile (NO shell), returns a result object (never
 * throws). Injectable via opts.runGitFn so unit tests never touch real git.
 *
 * @param {string} repoRoot - cwd for the git invocation.
 * @param {string[]} args - argv array (e.g. ['worktree','add',path,ref]).
 * @returns {{ok: boolean, code: number, stdout: string, stderr: string}}
 */
function runGitDefault(repoRoot, args) {
  try {
    const stdout = execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, code: 0, stdout: stdout || '', stderr: '' };
  } catch (err) {
    return {
      ok: false,
      code: (err && err.status != null) ? err.status : 1,
      stdout: '',
      stderr: String((err && (err.stderr || err.message)) || '').slice(0, 500),
    };
  }
}

function k1AuditPath() {
  return path.join(os.homedir(), '.claude', 'checkpoints', 'k1-worktree-log.jsonl');
}

/**
 * Class-4 audit emit. Fail-soft (ADR-0001): audit failure never blocks. Log
 * path injectable by ARGUMENT (F23 discipline — never an env var).
 */
function emitK1Audit(record, logPath) {
  const target = logPath || k1AuditPath();
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(
      target,
      JSON.stringify({ ts: new Date().toISOString(), class: 4, kind: 'k1-worktree-allocator', ...record }) + '\n'
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove a (possibly partial) worktree. Best-effort: `git worktree remove
 * --force` then `git worktree prune`. Never throws.
 *
 * @param {object} opts {repoRoot, worktreePath, runGitFn?}
 * @returns {{cleaned: boolean, steps: Array<{step: string, ok: boolean}>}}
 */
function cleanupWorktree(opts) {
  const runGit = opts.runGitFn || ((args) => runGitDefault(opts.repoRoot, args));
  const steps = [];
  const rm = runGit(['worktree', 'remove', '--force', opts.worktreePath]);
  steps.push({ step: 'remove', ok: !!(rm && rm.ok) });
  const prune = runGit(['worktree', 'prune']);
  steps.push({ step: 'prune', ok: !!(prune && prune.ok) });
  return { cleaned: steps.every((s) => s.ok), steps };
}

/**
 * Allocate a git worktree for a spawn, with retry + cleanup + K10 escape-hatch.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {string} opts.worktreePath
 * @param {string} [opts.ref='HEAD']
 * @param {number} [opts.maxAttempts=3]
 * @param {object} [opts.env=process.env]
 * @param {function} [opts.runGitFn] - injectable (args[]) => result.
 * @param {function} [opts.sleepFn] - injectable backoff (attempt) => void.
 * @param {string} [opts.auditLogPath]
 * @returns {{allocated: boolean, mode: 'worktree'|'escape-hatch-disabled'|'escape-hatch-failed', path: string|null, attempts: number, reason: string, audited: boolean}}
 */
function allocateWorktree(opts) {
  const env = opts.env || process.env;
  const maxAttempts = (typeof opts.maxAttempts === 'number' && opts.maxAttempts > 0)
    ? opts.maxAttempts : DEFAULT_MAX_ATTEMPTS;
  const runGit = opts.runGitFn || ((args) => runGitDefault(opts.repoRoot, args));
  const sleep = opts.sleepFn || (() => {});
  const ref = opts.ref || 'HEAD';

  // K10 composition: respect the LOOM_DISABLE_WORKTREE operator escape hatch.
  // When disabled, the spawn runs in the main worktree (no isolation) — that is
  // the operator's explicit choice; audit it (MEDIUM) and do NOT touch git.
  const hatch = evaluateEscapeHatches(env);
  if (hatch.worktreeDisabled) {
    emitK1Audit(
      { mode: 'escape-hatch-disabled', reason: 'LOOM_DISABLE_WORKTREE', worktree_path: opts.worktreePath, severity: hatch.severity },
      opts.auditLogPath
    );
    return { allocated: false, mode: 'escape-hatch-disabled', path: null, attempts: 0, reason: 'LOOM_DISABLE_WORKTREE', audited: true };
  }

  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = runGit(['worktree', 'add', opts.worktreePath, ref]);
    if (res && res.ok) {
      return { allocated: true, mode: 'worktree', path: opts.worktreePath, attempts: attempt, reason: 'allocated', audited: false };
    }
    lastErr = (res && res.stderr) || 'unknown';
    // Resource-leak guard: clear any partial worktree before the next attempt.
    cleanupWorktree({ repoRoot: opts.repoRoot, worktreePath: opts.worktreePath, runGitFn: runGit });
    if (attempt < maxAttempts) sleep(attempt);
  }

  // All attempts failed → the escape hatch fires: degrade to no-worktree + audit.
  emitK1Audit(
    {
      mode: 'escape-hatch-failed',
      reason: 'allocation-failed-after-retries',
      attempts: maxAttempts,
      last_error: String(lastErr).slice(0, 200),
      worktree_path: opts.worktreePath,
      severity: 'HIGH',
    },
    opts.auditLogPath
  );
  return { allocated: false, mode: 'escape-hatch-failed', path: null, attempts: maxAttempts, reason: 'allocation-failed-after-retries', audited: true };
}

module.exports = {
  allocateWorktree,
  cleanupWorktree,
  runGitDefault,
  _k1AuditPath: k1AuditPath,
  DEFAULT_MAX_ATTEMPTS,
};
