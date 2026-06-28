#!/usr/bin/env node

// @loom-layer: lab
//
// Autonomous-SDE ladder gap-map item 2, PR-2 - the gh merge-outcome verifier (SHADOW, read-only GET).
//
// verifyMerge({repo, pr_number}) GETs `repos/<repo>/pulls/<n>` via the ambient `gh` CLI (a GET, NO
// token in argv, sanitized env, hard timeout, bounded buffer) and reports whether GitHub considers the
// PR MERGED. The merge-observer joins this against the kernel egress join-key (loadJoinKey's SEALED
// approval_hash) before it records a merge-outcome - so a recorded outcome is "the kernel emitted this
// PR under approval_hash AND GitHub says it merged."
//
// THE LOAD-BEARING GATE (VERIFY hacker H2/H3 + reviewer LOW-1, folded build-binding):
//   1. The authoritative merge signal is `typeof parsed.merged === 'boolean' && parsed.merged === true`.
//      NEVER `merge_commit_sha` presence (GitHub computes a TEST-merge sha for an OPEN unmerged PR, so
//      the field is non-null even when merged===false - the open-PR trap, Runtime-Probe-confirmed), and
//      NEVER `state === 'closed'` (a closed-UNMERGED PR is also `closed`). A missing/null/string `merged`
//      is unverifiable => fail CLOSED.
//   2. ASYMMETRIC fail-closed: a gh failure (non-zero exit / 404 / 403 / timeout / unparseable / bad-sha)
//      => {ok:false} (UNVERIFIABLE), it NEVER silently degrades to merged:false. A genuine not-yet-merged
//      PR is {ok:true, merged:false} (a legitimate state the caller refuses-to-record, NOT an error).
//   3. STRICT-validate `repo` (two gh-name-safe segments, NO leading dash) + `pr_number` (positive safe
//      int) at THIS boundary - defense-in-depth: parse-pr-url admits a leading-dash repo segment (`o/-r`)
//      and a `1e+23`-style pr_number is rejected here even though Number() would coerce it. We consume the
//      ALREADY-VALIDATED integer pr_number; we NEVER re-parse the URL.
//   4. Every fail-closed reject is OBSERVABLE (emitEgressAlert) - the fail-silent {ok:false} anti-pattern.
//      The classifier goes in a NON-`reason` detail key (gh_reason) because emitEgressAlert forces the
//      positional reason token LAST (it would clobber a `reason` detail key - join-key-store.js:344).
//
// SOLE-CHOKEPOINT INVARIANT (emit-pr.js EC1b.2a): emit-pr.js is the sole WRITE-egress gh-spawner + sole
// egress-token reader. This module spawns `gh api` for a READ-ONLY GET using AMBIENT read auth (it emits
// nothing, never reads the egress token, never git-pushes). It is therefore on the READONLY_GH_ALLOW list,
// EXEMPT from the gh-spawn cap ONLY because it carries the POSITIVE GET-gate `assertReadOnlyGhArgs(args)`
// that refuses any non-`-X GET` BEFORE the spawn (mirrors live-puller.js: gh auto-POSTs on -f/-F when no
// -X is set, so the explicit `-X GET` is load-bearing). We do NOT enumerate gh's write surface (the
// syntactic-gate-extension anti-pattern); the positive invariant is "every spawn is `gh api -X GET`."
//
// NO node/edge mint, NO LIVE_SOURCES, NO signer. Imports kernel/egress/alert (lab -> kernel is legal).
// Injectable opts.runner (default execFile) so unit tests never shell the real gh.

'use strict';

const { execFile } = require('child_process');
const { emitEgressAlert } = require('../../kernel/egress/alert');

const HEX40 = /^[a-f0-9]{40}$/;
// A gh-name-safe path segment: [A-Za-z0-9._-]+ that does NOT start with a dash (the kernel's
// GH_PR_URL segment charset; the no-leading-dash rule is the STRICT half parse-pr-url leaves open).
const GH_SEGMENT = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_BYTES = 1 * 1024 * 1024;   // a single PR JSON is tiny; 1MB is a generous DoS cap.

/** Emit a namespaced, observable alert for a fail-closed reject (the classifier rides gh_reason, not reason). */
function alert(ghReason, detail) { emitEgressAlert('merge-verify-failed', Object.assign({}, detail || {}, { gh_reason: ghReason })); }

/** Two non-empty gh-name-safe segments, no leading dash. */
function isGhRepo(repo) {
  if (typeof repo !== 'string') return false;
  const parts = repo.split('/');
  if (parts.length !== 2) return false;
  return parts.every((s) => GH_SEGMENT.test(s));
}

function isPositiveSafeInt(v) { return Number.isSafeInteger(v) && v > 0; }

// THE READ-ONLY GET-GATE (the sole-chokepoint POSITIVE invariant; mirrors live-puller.js:157). Every
// spawn must be `gh api` with an EXPLICIT `-X GET` and no write verb. gh auto-switches to POST when -f/-F
// data fields are present and no -X is set, so the explicit `-X GET` is load-bearing. defaultRunner calls
// this BEFORE any subprocess runs => GET-only BY CONSTRUCTION; the egress lint verifies the gate EXISTS.
function assertReadOnlyGhArgs(args) {
  if (!Array.isArray(args) || String(args[0]) !== 'api') throw new Error('gh-readonly: only `gh api` reads are permitted');
  let getPinned = false;
  for (let i = 0; i < args.length; i += 1) {
    const a = String(args[i]);
    let verb = null;
    if (a === '-X' || a === '--method') verb = String(args[i + 1] || '');           // `-X GET` / `--method POST`
    else { const m = a.match(/^(?:-X|--method=)(.+)$/); if (m) verb = m[1]; }        // glued `-XPOST` / `--method=POST`
    if (verb !== null) {
      if (!/^GET$/i.test(verb)) throw new Error(`gh-readonly: only -X GET is permitted (write verb refused: ${verb})`);
      getPinned = true;
    }
  }
  if (!getPinned) throw new Error('gh-readonly: every gh api call must explicitly pin -X GET (else -f/-F data fields auto-POST)');
  return true;
}

// The default runner: execFile (NO shell), array args, sanitized env, hard timeout, bounded buffer.
// Resolves to { stdout } on a zero exit; rejects with an Error carrying .code/.stderr on a non-zero exit
// / timeout / spawn error. Mirrors gh-emit.js's runGh discipline for a read-only GET.
function defaultRunner(args, { timeoutMs, maxBytes, env }) {
  assertReadOnlyGhArgs(args);                          // GET-only by construction - refuse any write before spawn
  return new Promise((resolve, reject) => {
    execFile('gh', args, {
      env,
      timeout: timeoutMs,
      maxBuffer: maxBytes,
      killSignal: 'SIGKILL',
      encoding: 'utf8',
    }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error(`gh-verify: gh ${args.slice(0, 2).join(' ')} failed (${(err && err.code) || 'error'})`);
        e.code = err && err.code;
        e.killed = err && err.killed;
        e.stderr = typeof stderr === 'string' ? stderr : '';
        reject(e);
        return;
      }
      resolve({ stdout: typeof stdout === 'string' ? stdout : '' });
    });
  });
}

// Build the from-scratch sanitized env for the gh subprocess: PATH + HOME (gh needs them to find its
// config + binary) + the gh non-interactive hardening keys. NO token is passed in argv or set here -
// gh resolves ambient credentials itself (a GET); the env is minimized, not credential-bearing.
function buildVerifyEnv(src = process.env || {}) {
  const env = {};
  if (typeof src.PATH === 'string') env.PATH = src.PATH;
  if (typeof src.HOME === 'string') env.HOME = src.HOME;
  if (typeof src.GH_CONFIG_DIR === 'string') env.GH_CONFIG_DIR = src.GH_CONFIG_DIR;
  env.GH_PROMPT_DISABLED = '1';
  env.GH_NO_UPDATE_NOTIFIER = '1';
  return env;
}

/**
 * Verify whether GitHub considers PR <repo>#<pr_number> merged.
 * @param {{repo: string, pr_number: number}} q  repo (two gh-name-safe segments) + the ALREADY-validated
 *   integer pr_number (NEVER re-parsed from a URL here).
 * @param {{runner?: Function, timeoutMs?: number, maxBytes?: number, env?: object}} [opts]
 *   opts.runner(args, runOpts) -> Promise<{stdout}> (injected in tests; default shells real gh).
 * @returns {Promise<{ok: boolean, merged?: boolean, merge_commit_sha?: string|null, reason?: string}>}
 *   - {ok:true, merged:true, merge_commit_sha} when GitHub reports merged===true with a HEX40 sha.
 *   - {ok:true, merged:false} for a legitimate not-yet-merged PR (NOT an error; the caller refuses-to-record).
 *   - {ok:false, reason} (observable) for any UNVERIFIABLE outcome (bad args / gh failure / unparseable / bad sha).
 */
async function verifyMerge(q, opts = {}) {
  const query = q && typeof q === 'object' && !Array.isArray(q) ? q : {};
  if (!isGhRepo(query.repo)) { alert('bad-repo', { repo: typeof query.repo === 'string' ? query.repo.slice(0, 80) : typeof query.repo }); return { ok: false, reason: 'bad-repo' }; }
  if (!isPositiveSafeInt(query.pr_number)) { alert('bad-pr-number', { repo: query.repo }); return { ok: false, reason: 'bad-pr-number' }; }

  const runner = typeof opts.runner === 'function' ? opts.runner : defaultRunner;
  // `-X GET` is load-bearing (the read-only GET-gate): it forces GET so the call can never auto-POST.
  const args = [
    'api', '-X', 'GET', `repos/${query.repo}/pulls/${query.pr_number}`,
    '--jq', '{merged: .merged, merge_commit_sha: .merge_commit_sha, state: .state}',
  ];
  const runOpts = {
    timeoutMs: typeof opts.timeoutMs === 'number' ? opts.timeoutMs : DEFAULT_TIMEOUT_MS,
    maxBytes: typeof opts.maxBytes === 'number' ? opts.maxBytes : DEFAULT_MAX_BYTES,
    // ALWAYS allowlist-filter through buildVerifyEnv so a caller-supplied opts.env cannot drop the
    // GH_PROMPT_DISABLED / GH_NO_UPDATE_NOTIFIER hardening by replacing the env wholesale (CodeRabbit Major).
    env: buildVerifyEnv(opts.env && typeof opts.env === 'object' ? opts.env : process.env),
  };

  let stdout;
  try {
    const res = await runner(args, runOpts);
    stdout = res && typeof res.stdout === 'string' ? res.stdout : '';
  } catch (err) {
    // ASYMMETRIC fail-closed: a gh non-zero exit (404/403) / timeout / spawn error is UNVERIFIABLE,
    // never silently merged:false. Observable.
    alert(err && err.killed ? 'gh-timeout' : 'gh-exit', { repo: query.repo, pr_number: query.pr_number, code: (err && err.code) || 'error' });
    return { ok: false, reason: 'gh-failed' };
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    alert('unparseable', { repo: query.repo, pr_number: query.pr_number });
    return { ok: false, reason: 'unparseable' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    alert('unparseable', { repo: query.repo, pr_number: query.pr_number });
    return { ok: false, reason: 'unparseable' };
  }

  // THE GATE: strict boolean merged===true (NEVER sha-presence, NEVER state==='closed').
  if (typeof parsed.merged !== 'boolean') {
    // typeof null === 'object'; report 'null' for a human triaging the observable alert (VALIDATE-hacker L-1).
    alert('merged-not-boolean', { repo: query.repo, pr_number: query.pr_number, merged_type: parsed.merged === null ? 'null' : typeof parsed.merged });
    return { ok: false, reason: 'merged-not-boolean' };
  }
  if (parsed.merged !== true) {
    // a LEGITIMATE not-yet-merged PR - not an error, the caller refuses-to-record (no alert).
    return { ok: true, merged: false };
  }
  // merged===true: the merge_commit_sha must be a real HEX40 (a merged PR always has one).
  const sha = parsed.merge_commit_sha;
  if (typeof sha !== 'string' || !HEX40.test(sha)) {
    alert('bad-merge-sha', { repo: query.repo, pr_number: query.pr_number });
    return { ok: false, reason: 'bad-merge-sha' };
  }
  return { ok: true, merged: true, merge_commit_sha: sha };
}

// defaultRunner is exported ONLY so the lab test can prove it INVOKES assertReadOnlyGhArgs (a write-arg
// throws synchronously, before any spawn) - VALIDATE-hacker M-1. Production callers use verifyMerge.
module.exports = { verifyMerge, isGhRepo, buildVerifyEnv, assertReadOnlyGhArgs, defaultRunner };
