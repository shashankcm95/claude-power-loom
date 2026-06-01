'use strict';

// packages/kernel/_lib/invoke-git.js
//
// Shared no-shell git invoker for kernel callers (v3.0-alpha).
//
// EXTRACTION RATIONALE (PR 3 architect HIGH — DRY): K1 (worktree-allocator,
// PR 2) and K9 (promote-deltas, PR 3) both need an execFile-style git runner
// with the IDENTICAL {ok, code, stdout, stderr} contract. K1 shipped first; K9
// arriving as the SECOND importer of a byte-for-byte-identical runGitDefault is
// exactly the 2nd-instance threshold where DRY says extract rather than
// copy-paste (kb:architecture/crosscut/single-responsibility — a single source
// of truth for the security-load-bearing primitive). The risk this removes is
// concrete: a future CWE-78 hardening (arg-allowlist, shell:false assertion)
// applied to one copy and missed in the other.
//
// SECURITY (CWE-78): args are passed to execFileSync as an ARGUMENT ARRAY — git
// is spawned directly, NOT through a shell, so no word-splitting / metachar
// interpolation is possible on caller-supplied refs / paths. This is the single
// place the kernel's no-shell git contract is realized; callers MUST pass argv
// as an array and never build a shell string.
//
// safe-exec.js is intentionally NOT reused here: it hardcodes 'node' as the
// binary (invokeNodeJson / invokeNodeText) and parses node-script stdout — there
// is no git-shaped seam in it. This module is the git-shaped sibling.
//
// This is a DAG leaf: it has ZERO kernel dependencies (only child_process), so
// importing it from K1 + K9 does not perturb either module's acyclic dependency
// graph (kb:architecture/crosscut/acyclic-dependencies).

const { execFileSync } = require('child_process');

/**
 * Run git in `repoRoot` with `args` via execFile (NO shell). Never throws —
 * returns a result object so callers branch on `.ok` instead of try/catch. On a
 * non-zero exit, stderr (or the error message) is captured and bounded to 500
 * chars so a hostile/huge stderr cannot bloat the result.
 *
 * The optional `extraEnv` (PR-3c-a, additive + backward-compatible) is merged
 * AFTER the locale pins so a caller can inject per-call git env vars — notably
 * GIT_INDEX_FILE, which K-quarantine's temp-index squash uses to stage into a
 * throwaway index without touching the worktree's real .git/index — WITHOUT
 * disturbing LANG/LC_ALL. Existing 2-arg callers (K1, K9) are unaffected:
 * `{ ...undefined }` spreads to nothing.
 *
 * @param {string} repoRoot - cwd for the git invocation.
 * @param {string[]} args - argv array (e.g. ['-c','core.hooksPath=/dev/null','cherry-pick',sha]).
 * @param {Object<string,string>} [extraEnv] - per-call env overlay (e.g. {GIT_INDEX_FILE}).
 * @returns {{ok: boolean, code: number, stdout: string, stderr: string}}
 */
function runGitDefault(repoRoot, args, extraEnv) {
  try {
    const stdout = execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      // Pin the locale to C so git's human-readable messages are stable English
      // (K9 classifies the "cherry-pick is now empty" / "nothing to commit"
      // signal by substring; a localized runner could break that match). Harmless
      // for K1, which never parses git prose. Inherit the rest of the env, then
      // overlay any caller-supplied per-call vars (extraEnv) LAST so an explicit
      // GIT_INDEX_FILE wins (but the locale pins above cannot be silently
      // clobbered by an inherited LANG — extraEnv is opt-in per call).
      env: { ...process.env, LANG: 'C', LC_ALL: 'C', ...extraEnv },
    });
    return { ok: true, code: 0, stdout: stdout || '', stderr: '' };
  } catch (err) {
    return {
      ok: false,
      code: (err && err.status != null) ? err.status : 1,
      stdout: (err && typeof err.stdout === 'string') ? err.stdout : '',
      stderr: String((err && (err.stderr || err.message)) || '').slice(0, 500),
    };
  }
}

module.exports = { runGitDefault };
