'use strict';

// packages/kernel/_lib/integrate-merge.js
//
// PR-P3a — DORMANT integration merge primitives for the P3c ordered integrator.
// This module SHIPS DORMANT: no production code imports it in P3a (only its unit
// test requires it). P3c's `integrator` is the first production importer — it
// stacks per-spawn candidate deltas onto the `loom/integration` branch in an
// explicitly-specified order, using these three stateless, git-seam-injected
// primitives. The integration NEVER touches the user's checked-out HEAD/working
// tree (the P3 design decision, USER-locked): the merge math is pure plumbing.
//
// THE SAFETY PROPERTY (P3 design spike S3, /tmp/p3-git-spike.sh): a plumbing
// `update-ref` on the CHECKED-OUT branch silently desyncs the working tree — so
// P3 computes the merged tree out-of-tree (`merge-tree --write-tree` → a tree,
// never a checkout) and only ever advances `loom/integration` (a ref the user
// does not have checked out). These primitives realize exactly that: no working
// tree, no checkout, no cherry-pick (cf. k9.promoteDelta, which DOES cherry-pick
// into a working tree — correct for 3c's throwaway staging worktree, UNSAFE here).
//
// THE MERGE-BASE INVARIANT (verify-plan architect Ch4 / code-reviewer F1 — the
// load-bearing correctness rule): when stacking candidate N onto an integration
// tip that already holds 1..N-1, the 3-way merge-base MUST be each candidate's
// OWN fork point (its head_anchor = materializeDelta.parentHead), NOT the growing
// tip. A candidate's delta is expressed relative to where it forked; merging it
// against the tip computes a wrong three-way diff (false-conflict or silent-miss).
// The caller supplies mergeBase per candidate; these primitives never assume it.
//
// No-shell git (CWE-78): every git run goes through the injected runGit seam
// (args arrays, never a shell string) — the caller binds it to the repo via the
// shared _lib/invoke-git runGitDefault (the seam-required pattern materializeDelta
// uses). Injectable so the unit test drives real git in a temp repo; the primitives
// stay agnostic about child_process (DIP).

// A git tree/commit sha is EITHER 40-hex (sha1) OR 64-hex (sha256) — the anchored
// alternation, NOT a {40,64} range (which would admit 41-63-hex garbage). Mirrors
// invoke-git.js / quarantine-promote.js / transaction-record.js. Lowercase only.
const GIT_SHA_RE = /^[a-f0-9]{40}$|^[a-f0-9]{64}$/;

// The "ref must not exist" create-form oldvalue. `git update-ref <ref> <new> <old>`
// treats an EMPTY oldvalue (or the all-zeros oid) as "the ref must NOT already
// exist" — an atomic create that a second create fails. We use '' rather than a
// zero-oid so the form is hash-agnostic (sha1's 40-zero vs sha256's 64-zero would
// otherwise have to be chosen per repo). Proven in the P3 design spike.
const CREATE_OLDVALUE = '';

/**
 * Throw a concrete fail-fast Error when the injected git seam is missing — every
 * primitive needs it (DIP: these primitives depend on an abstraction, never on
 * child_process directly). Centralized so each entry point stays one readable line.
 *
 * @param {*} runGit the injected seam (must be a function).
 * @param {string} fn the calling primitive name (for the message).
 */
function requireSeam(runGit, fn) {
  if (typeof runGit !== 'function') {
    throw new Error(`integrate-merge: ${fn} requires a runGit seam`);
  }
}

/**
 * Parse the conflicted paths out of a `merge-tree --write-tree` CONFLICT output.
 * After the tree-oid line, git prints a conflicted-file-info section, one line per
 * conflicted blob stage: `<mode> <object> <stage>\t<path>` (proven in the spike).
 * Dedup the paths (each conflicted file appears at stages 1/2/3).
 *
 * @param {string} stdout the merge-tree combined stdout.
 * @returns {string[]} the unique conflicted paths (possibly empty).
 */
function parseConflictPaths(stdout) {
  const out = typeof stdout === 'string' ? stdout : '';
  const paths = new Set();
  for (const line of out.split('\n')) {
    const m = /^[0-7]{6} [0-9a-f]+ [123]\t(.+)$/.exec(line);
    if (m) paths.add(unquoteGitPath(m[1]));
  }
  return Array.from(paths);
}

/**
 * Unquote a git path when core.quotePath quoted it (code-reviewer Finding 2). git
 * wraps a path with special/non-ASCII bytes in double-quotes (`"a\tb.txt"`); strip
 * the quotes + unescape the common C-escapes so conflictPaths carries the real path.
 * Octal `\NNN` byte-escapes are left as-is — cosmetic for the journal; P3c does NOT
 * key any security decision on these paths (they label what conflicted, for routing).
 *
 * @param {string} p a path token from the conflicted-file section.
 * @returns {string} the unquoted path (unchanged when not quoted).
 */
function unquoteGitPath(p) {
  if (p.length >= 2 && p.startsWith('"') && p.endsWith('"')) {
    return p.slice(1, -1).replace(/\\([\\"tn])/g, (_, c) => (c === 't' ? '\t' : c === 'n' ? '\n' : c));
  }
  return p;
}

/**
 * Out-of-tree 3-way merge via `git merge-tree --write-tree` — computes the merged
 * tree WITHOUT touching any working tree (the load-bearing safety property).
 *
 * Result discipline (the three-way distinction matters to the caller):
 *   - CLEAN   -> {ok:true,  conflict:false, tree}            (exit 0; first line = tree oid)
 *   - CONFLICT-> {ok:true,  conflict:true,  tree, conflictPaths}  (exit 1; merge-tree RAN + reported)
 *   - ERROR   -> {ok:false, conflict:false, tree:null, error, code}  (bad oid / not-a-commit, exit !=0,1)
 * `ok:true` means "merge-tree ran and reported"; a CONFLICT is NOT an error (the
 * caller routes it to quarantine, in order). Only a real git failure is ok:false.
 *
 * @param {Object} opts
 * @param {string} opts.mergeBase the common ancestor = the candidate's OWN fork
 *   point (head_anchor / materializeDelta.parentHead), NOT the integration tip.
 * @param {string} opts.ours      the integration tip (or base on the first stack).
 * @param {string} opts.theirs    the candidate (its squash commit or tree).
 * @param {function} opts.runGit  (args[]) => {ok,code,stdout,stderr}, repo-bound.
 * @returns {{ok:boolean, conflict:boolean, tree:(string|null), conflictPaths?:string[], error?:string, code?:number}}
 */
function mergeTreeWriteTree(opts) {
  const { mergeBase, ours, theirs, runGit } = opts || {};
  requireSeam(runGit, 'mergeTreeWriteTree');
  const res = runGit(['merge-tree', '--write-tree', `--merge-base=${mergeBase}`, ours, theirs]);
  // NOTE (code-reviewer Finding 6): runGitDefault does NOT bound stdout (only stderr
  // is capped at 500), so a conflict listing with very many files is held in full
  // here. Acceptable for P3c's bounded integration use; parseConflictPaths dedups.
  const stdout = res && typeof res.stdout === 'string' ? res.stdout : '';
  const firstLine = stdout.split('\n')[0].trim();
  // code-absent fallback is ok-CONDITIONAL (code-reviewer Finding 1): a seam stub
  // returning {ok:true} without a numeric code must read CLEAN (0), not be misread as
  // a conflict; an {ok:false} without a code defaults to 1 (conflict -> quarantine,
  // the safe-conservative route — the delta is preserved for review, never dropped).
  const code = res && typeof res.code === 'number'
    ? res.code
    : (res && res.ok ? 0 : 1);

  // CLEAN: exit 0, the first line is the merged tree oid.
  if (res && res.ok && code === 0) {
    if (!GIT_SHA_RE.test(firstLine)) {
      return { ok: false, conflict: false, tree: null, error: 'merge-tree: clean exit without a tree oid' };
    }
    return { ok: true, conflict: false, tree: firstLine };
  }
  // CONFLICT: exit 1, the first line is the conflicted tree oid + a conflicted-file
  // section. runGitDefault surfaces a non-zero exit's stdout via err.stdout, so the
  // conflicted-file section is available to parse here.
  if (code === 1) {
    return {
      ok: true,
      conflict: true,
      tree: GIT_SHA_RE.test(firstLine) ? firstLine : null,
      conflictPaths: parseConflictPaths(stdout),
    };
  }
  // ERROR: any other exit (128 bad-oid / not-a-commit, etc.) is a git failure.
  return {
    ok: false,
    conflict: false,
    tree: null,
    error: (res && res.stderr ? String(res.stderr) : 'merge-tree failed').slice(0, 200),
    code,
  };
}

/**
 * Build a merge commit from a merged tree via `git commit-tree` (no working tree).
 * `parents` is ordered [integrationTip, candidateDelta] so the commit records both
 * lineages. Fail-fast on a non-sha tree or a non-sha parent (caller-bug surface).
 *
 * @param {Object} opts
 * @param {string} opts.tree     a merged tree sha (from mergeTreeWriteTree).
 * @param {string[]} opts.parents ordered parent commit shas (each validated).
 * @param {string} [opts.message] the commit message (single line; default supplied).
 * @param {function} opts.runGit  (args[]) => result, repo-bound.
 * @returns {{ok:boolean, commit?:string, error?:string}}
 */
function commitMergedTree(opts) {
  const { tree, parents, message, runGit } = opts || {};
  requireSeam(runGit, 'commitMergedTree');
  if (typeof tree !== 'string' || !GIT_SHA_RE.test(tree)) {
    throw new Error(
      `integrate-merge: commitMergedTree requires a valid tree sha, got ${JSON.stringify(typeof tree === 'string' ? tree.slice(0, 80) : tree)}`
    );
  }
  // Fail-fast on a 0-parent / non-array parents (code-reviewer Finding 4): an
  // integration merge commit is NEVER a root commit — it always has at least the
  // integration tip as a parent. This surfaces a caller bug before git silently
  // builds a parentless root commit.
  if (!Array.isArray(parents) || parents.length < 1) {
    throw new Error(`integrate-merge: commitMergedTree requires at least one parent (never a root commit), got ${JSON.stringify(parents)}`);
  }
  const args = ['commit-tree', tree];
  for (const p of parents) {
    if (typeof p !== 'string' || !GIT_SHA_RE.test(p)) {
      throw new Error(`integrate-merge: commitMergedTree parent is not a sha: ${JSON.stringify(p)}`);
    }
    args.push('-p', p);
  }
  args.push('-m', typeof message === 'string' && message.length > 0 ? message : 'loom integration merge');

  const res = runGit(args);
  if (!res || !res.ok) {
    return { ok: false, error: (res && res.stderr ? String(res.stderr) : 'commit-tree failed').slice(0, 200) };
  }
  const commit = String(res.stdout || '').trim().split('\n')[0];
  if (!GIT_SHA_RE.test(commit)) {
    return { ok: false, error: 'commit-tree: no commit sha returned' };
  }
  return { ok: true, commit };
}

/**
 * Advance a ref atomically via `git update-ref <ref> <new> <old>` — a true CAS
 * (the spike proved a stale/wrong old-oid fails atomically, exit 128). This is the
 * sibling-concurrency backstop: a racing loser whose oldOid went stale gets
 * {ok:false, reason:'cas-failed'} (NOT a throw) and the integrator re-merges
 * against the new tip rather than corrupting it.
 *
 * CREATE form: a null/undefined oldOid uses the EMPTY oldvalue, which git treats as
 * "the ref must NOT already exist" — an atomic create whose second invocation fails.
 *
 * @param {Object} opts
 * @param {string} opts.ref      a fully-qualified ref name (must start with refs/).
 * @param {string} opts.newOid   the new commit sha to point at.
 * @param {string|null} [opts.oldOid] the expected current oid, or null for create.
 * @param {function} opts.runGit (args[]) => result, repo-bound.
 * @returns {{ok:boolean, created?:boolean, reason?:string, stderr?:string, code?:number}}
 */
function casAdvanceRef(opts) {
  const { ref, newOid, oldOid, runGit } = opts || {};
  requireSeam(runGit, 'casAdvanceRef');
  if (typeof ref !== 'string' || !ref.startsWith('refs/')) {
    throw new Error(`integrate-merge: casAdvanceRef requires a refs/ ref name, got ${JSON.stringify(ref)}`);
  }
  if (typeof newOid !== 'string' || !GIT_SHA_RE.test(newOid)) {
    throw new Error(`integrate-merge: casAdvanceRef requires a valid newOid sha, got ${JSON.stringify(typeof newOid === 'string' ? newOid.slice(0, 80) : newOid)}`);
  }
  const expected = oldOid == null ? CREATE_OLDVALUE : oldOid;
  if (expected !== CREATE_OLDVALUE && !GIT_SHA_RE.test(expected)) {
    throw new Error(`integrate-merge: casAdvanceRef oldOid must be a sha or null, got ${JSON.stringify(typeof oldOid === 'string' ? oldOid.slice(0, 80) : oldOid)}`);
  }

  const res = runGit(['update-ref', ref, newOid, expected]);
  if (res && res.ok && res.code === 0) {
    return { ok: true, created: expected === CREATE_OLDVALUE };
  }
  // exit 128 = CAS failure: a stale/wrong old-oid, OR ref-already-exists on create.
  // Labeled, never thrown — the integrator's retry loop branches on .ok.
  return {
    ok: false,
    reason: 'cas-failed',
    stderr: (res && res.stderr ? String(res.stderr) : '').slice(0, 200),
    code: res && typeof res.code === 'number' ? res.code : 1,
  };
}

module.exports = {
  mergeTreeWriteTree,
  commitMergedTree,
  casAdvanceRef,
  // exposed for the spec + future P3c reuse
  parseConflictPaths,
  GIT_SHA_RE,
};
