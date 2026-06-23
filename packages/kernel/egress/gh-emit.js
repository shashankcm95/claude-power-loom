'use strict';

// @loom-layer: kernel
//
// ③.2.5c — the gh-REST emission MECHANISM: the live network seam behind the now-complete signed approval gate
// (5a verify-half #399 + 5b cross-uid broker #400 + 5b.2 approve-CLI #401). This is the FIRST code in the repo
// that touches the network. emit-pr.js's armedEmit() delegates here ONLY when the gate has passed
// (live AND token AND killswitch-off AND a VALID per-emission signed human approval).
//
// THE LOAD-BEARING DESIGN (VERIFY board, 2 CRITICAL + 4 HIGH folded — see the wave plan's Pre-Approval table):
//   1. TRANSPORT = `gh api <endpoint> --method <M> --input -` with the FULL JSON body on STDIN. NEVER `-f`/`-F`
//      for ANY field (CRITICAL-1, re-probed on gh 2.90.0): `-F/--field` magic-reads a value starting with `@` as
//      a HOST FILE — the blob `content` is actor-influenced + multi-line, so a `@path`-leading line would
//      exfiltrate a host file into the first live PR. `--input -` sends opaque JSON; no field-flag magic touches
//      actor bytes. The subprocess (vs node-https) keeps the shipped EC1b.1 killswitch=env-sanitization proof
//      meaningful (only a credential-resolving subprocess can pick up ambient creds; buildEmitEnv neutralizes it).
//   2. POST-IMAGE = reconstructed POSITIONALLY from the SCRUBBED diff (draft.diff), new-file-adds ONLY this wave.
//      Content lines are taken from the hunk body by COUNT (strip exactly one leading `+`), never a
//      `startsWith('+++')` test (HIGH-4: that drops a legit `+`-leading body line). The emitted path must be the
//      canonical stanza path AND be in the validated path-set AND pass isEgressDeniedPath (HIGH-4: the dual
//      `diff --git`/`+++` ingestion can name two paths — refuse on divergence; re-validate per emitted entry).
//      The bytes on the wire derive ONLY from the approved scrubbed diff — never a worktree (raw secret).
//   3. THE REAL SELF-CHECK (CRITICAL-2), TWO load-bearing halves: the hash cross-check binds the DIFF to the
//      gate's INDEPENDENTLY-threaded approvalHash (computeEmissionHash(draft) === approvalHash — catches a seam
//      divergence where a future refactor hands the seam a draft other than the one the gate hashed); the
//      positional reconstruction + count-assert + STRICT-single-hunk + path-membership bind the emitted file
//      CONTENT faithfully to that diff. Both are load-bearing for DIFFERENT properties — neither is the rejected
//      self-rehash tautology (a re-hash of the draft against a hash computed from the SAME draft in the SAME call).
//      The strict-single-hunk enforcement (VALIDATE-hacker HIGH) is what makes "emit exactly the approved bytes"
//      enforceable for the new-file shape: any unconsumed hunk/content => fail-closed, never a silent truncation.
//   4. ENVELOPE = KERNEL CONSTANTS (HIGH-3): the commit message + PR body interpolate ONLY the validated integer
//      issueRef + the 64-hex approvalHash, never free actor text. The signed approval binds {repo,issueRef,diff};
//      the envelope is kernel-templated + deterministic + UNSIGNED (an explicit residual — see the plan).
//   5. draft:true is a HARD CONSTANT (security.md non-bypassable-guard) — no caller path can flip it; ready-PR is
//      a future arming step. Dedup-on-deterministic-branch-name makes the emit IDEMPOTENT (a 422 "already exists"
//      reconciles to the existing PR — no duplicate; closes the EC1b.5e partial-commit duplicate-emit hole).
//
// KERNEL-tier: node core + sibling egress modules + kernel/_lib only. parseDiffPaths/isEgressDeniedPath are
// imported from emit-pr (the SAME validators the gate ran — no re-implementation, no drift); the back-edge
// (emit-pr's armedEmit -> gh-emit) is a LAZY require inside that function, so there is no load-time cycle.

const { execFileSync } = require('child_process');
const { computeEmissionHash } = require('./approval');
const { parseDiffPaths, isEgressDeniedPath } = require('./emit-pr');

const HASH64 = /^[0-9a-f]{64}$/;
const SAFE_BRANCH = /^[A-Za-z0-9._/-]+$/;          // the API-resolved default_branch charset (rides into argv + a ref path)
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;         // a generous bound on any single gh response (DoS cap)
const MAX_DIFF_BYTES = 5 * 1024 * 1024;            // self-defend the kernel module (mirrors emit-pr's upstream cap)

// ③.2.5c — a HIGH-VISIBILITY alert on a SECURITY-sensitive egress reject (the OBS carry 2026-06-22 +
// security.md fail-closed-must-be-observable): a tamper / forgery / laundering / killswitch-bypass attempt must
// NOT fail silently. A structured single-line stderr signal — cheap while SHADOW, load-bearing once the network
// is live. NOT emitted on benign outcomes (a normal 422-dedup, an ordinary HTTP error) — only the attack-shaped
// reject paths, so the signal stays high-signal. Telemetry must never throw (a logging failure cannot fail the gate).
function emitEgressAlert(reason, detail = {}) {
  try { process.stderr.write(`[LOOM-EGRESS-ALERT] ${JSON.stringify(Object.assign({ reason }, detail))}\n`); } catch { /* never throw from telemetry */ }
}

// --------------------------------------------------------------------------
// runGh — the sanitized, FAIL-CLOSED gh subprocess primitive.
// --------------------------------------------------------------------------

/**
 * Invoke `gh` with NO shell (array argv), the from-scratch sanitized `env`, an optional JSON request body on
 * stdin (for `--input -`), a hard timeout, a bounded buffer, and SIGKILL on timeout. Returns raw stdout.
 *
 * FAIL-CLOSED, in DELIBERATE CONTRAST to safe-exec.js's fail-OPEN (ADR-0001 returns null): any non-zero exit /
 * timeout / oversize / spawn error THROWS — a swallowed network failure on the highest-stakes path is the
 * unacceptable outcome. The thrown error carries `.status`/`.stderr`/`.stdout` so the caller can detect a 422.
 * (Do NOT "align" this to safe-exec's null-return convention — the failure contract is intentionally opposite.)
 * @param {string[]} args  the gh argv (e.g. ['api', 'repos/o/r', '--method', 'POST', '--input', '-'])
 * @param {{ env: object, input?: string, timeoutMs?: number, maxBytes?: number }} opts
 * @returns {string} raw stdout
 */
function runGh(args, { env, input, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  try {
    return execFileSync('gh', args, {
      env,
      input: typeof input === 'string' ? input : undefined,
      timeout: timeoutMs,
      maxBuffer: maxBytes,
      killSignal: 'SIGKILL',
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
  } catch (err) {
    // extract the HTTP status from stderr (err.status is the PROCESS exit code, always 1 for a gh API error;
    // err.code is undefined). The structured fields below are preserved for isAlreadyExists' 422 text-match.
    const stderr = err && err.stderr ? String(err.stderr) : '';
    const httpStatus = (stderr.match(/HTTP (\d{3})/) || [])[1] || null;
    const e = new Error(`runGh: gh ${args.slice(0, 2).join(' ')} failed (${httpStatus ? `HTTP ${httpStatus}` : ((err && err.status) || 'error')})`);
    e.status = err && err.status;
    e.httpStatus = httpStatus;
    e.stderr = stderr;
    e.stdout = err && err.stdout ? String(err.stdout) : '';
    throw e;
  }
}

/** A 422 "Reference already exists" — the dedup-on-key signal (the deterministic branch was already created). */
function isAlreadyExists(err) {
  const text = `${(err && err.stderr) || ''}${(err && err.stdout) || ''}`;
  return /already exists/i.test(text);
}

function ghJson(gh, args, opts) {
  const out = gh(args, opts);
  try {
    return JSON.parse(out);
  } catch (parseErr) {
    // preserve the SyntaxError + a bounded sample so a truncated/HTML/error-page response is diagnosable
    // (a bare `catch {}` would erase whether this was a DoS-truncation, an HTML error page, or real bad JSON).
    const e = new Error(`gh-emit: unparseable gh JSON for ${args.slice(0, 2).join(' ')}: ${parseErr && parseErr.message}`);
    e.cause = parseErr;
    e.rawSample = typeof out === 'string' ? out.slice(0, 200) : String(out);
    throw e;
  }
}

// --------------------------------------------------------------------------
// Post-image reconstruction — POSITIONAL, new-file-adds ONLY, fail-closed.
// --------------------------------------------------------------------------

const RE_GIT = /^diff --git "?a\/(.+?)"? "?b\/(.+?)"?\s*$/;
const RE_PLUS = /^\+\+\+ "?b\/(.+?)"?\s*$/;
const RE_HUNK = /^@@ -\d+(?:,\d+)? \+\d+(?:,(\d+))? @@/;

/**
 * Reconstruct each touched file's FULL post-image from the SCRUBBED diff. MVP scope: every stanza MUST be a
 * NEW-FILE add (a `new file mode` header + a single `@@ -0,0 +1,N @@` hunk); ANY other shape (a modify hunk
 * against an unseen base, a delete, a rename) throws `cannot-reconstruct-postimage` (fail-closed — the general
 * base+hunk applier is deferred). Content is taken POSITIONALLY (the N hunk-body lines, strip one leading `+`),
 * so a body line that itself starts with `+` is preserved. The canonical path is the `diff --git b/` name and
 * MUST equal the `+++ b/` name (refuse on divergence). Trailing-newline tracked via the `\ No newline` marker.
 * @param {string} scrubbedDiff
 * @returns {Array<{ path: string, mode: string, content: string }>}
 */
function reconstructPostImages(scrubbedDiff) {
  const lines = String(scrubbedDiff || '').split('\n');
  const files = [];
  let i = 0;
  while (i < lines.length) {
    const mGit = RE_GIT.exec(lines[i]);
    if (!mGit) { i += 1; continue; }
    const gitPathA = mGit[1].trim();
    const gitPathB = mGit[2].trim();
    let isNewFile = false;
    let plusPath = null;
    let hunkCount = null;
    let hunkLine = null;
    let j = i + 1;
    for (; j < lines.length; j += 1) {
      const h = lines[j];
      if (RE_GIT.test(h)) break;                                  // next stanza with no hunk
      if (/^new file mode /.test(h)) isNewFile = true;
      const mPlus = RE_PLUS.exec(h);
      if (mPlus) plusPath = mPlus[1].trim();
      const mHunk = RE_HUNK.exec(h);
      if (mHunk) { hunkCount = mHunk[1] === undefined ? 1 : Number(mHunk[1]); hunkLine = h; j += 1; break; }
    }
    if (!isNewFile || hunkCount === null) {
      throw new Error('cannot-reconstruct-postimage: only new-file-add stanzas are emittable this wave');
    }
    if (plusPath === null || plusPath !== gitPathB || gitPathA !== gitPathB) {
      throw new Error(`cannot-reconstruct-postimage: stanza path diverges (diff --git a/${gitPathA} b/${gitPathB}, +++ b/${plusPath})`);
    }
    // a NEW file's hunk old-side MUST be -0,0 (VALIDATE-honesty: the documented `@@ -0,0 +1,N @@` shape — a
    // stanza claiming `new file mode` with a non-zero old-side is malformed/Byzantine -> fail-closed).
    if (!/^@@ -0(?:,0)? \+/.test(hunkLine)) {
      throw new Error(`cannot-reconstruct-postimage: a new-file hunk must be -0,0 (got ${JSON.stringify(hunkLine)})`);
    }
    // collect EXACTLY hunkCount added lines positionally (strip one leading `+`, so a `+`-leading body line survives).
    const content = [];
    for (; j < lines.length && content.length < hunkCount; j += 1) {
      const c = lines[j];
      if (c[0] !== '+') throw new Error('cannot-reconstruct-postimage: a new-file hunk body line is not an addition');
      content.push(c.slice(1));
    }
    if (content.length !== hunkCount) {
      throw new Error(`cannot-reconstruct-postimage: hunk count mismatch (header +${hunkCount}, body ${content.length})`);
    }
    // trailing-newline + STRICT SINGLE-HUNK (VALIDATE-hacker HIGH — the content-fidelity guarantee): after the
    // hunk body the ONLY allowed lines before the next `diff --git` are a single `\ No newline` marker and trailing
    // blanks. ANY other line (a 2nd @@ hunk, more +/- content) => UNCONSUMED content => fail-closed, NEVER a silent
    // truncation that emits fewer bytes than the human approved.
    let trailingNewline = true;
    if (lines[j] === '\\ No newline at end of file') { trailingNewline = false; j += 1; }
    for (; j < lines.length && !RE_GIT.test(lines[j]); j += 1) {
      if (lines[j].length > 0) {
        throw new Error('cannot-reconstruct-postimage: a new-file stanza has unconsumed content (multi-hunk / extra lines not emittable this wave)');
      }
    }
    files.push({ path: gitPathB, mode: '100644', content: content.join('\n') + (trailingNewline ? '\n' : '') });
    i = j;
  }
  return files;
}

// --------------------------------------------------------------------------
// The kernel-constant PR envelope (HIGH-3 — zero actor bytes).
// --------------------------------------------------------------------------

function prTitle(issueRef) { return `loom: candidate for issue #${issueRef}`; }
function commitMessage(issueRef, hash) { return `loom: candidate for issue #${issueRef}\n\napproval-hash: ${hash}\n`; }
function prBody(issueRef, hash) {
  return `Automated DRAFT candidate from Power Loom for issue #${issueRef}.\n\n`
    + `This is a SHADOW/DRAFT egress behind a signed, human-approved gate. `
    + `It is a draft for human review, not a merge request.\n\napproval-hash: ${hash}\n`;
}

// --------------------------------------------------------------------------
// ghEmit — the tree->commit->ref->pull sequence behind the gate.
// --------------------------------------------------------------------------

/**
 * The REAL self-check (BEFORE any network) — a SECURITY boundary, so each reject ALERTS (observable) then throws:
 *   - env: a sanitized object is REQUIRED (env=undefined => execFileSync inherits process.env => ambient GH_TOKEN
 *     restored => the buildEmitEnv killswitch is defeated; VALIDATE-reviewer HIGH).
 *   - the hash cross-check binds the diff to the gate's INDEPENDENT approvalHash (not a self-rehash tautology).
 *   - the repo/issueRef gate-contract shape; a self-defending diff-size bound (mirrors emit-pr's upstream cap).
 *   - reconstruct + per-path re-validation: every emitted path is in the validated set AND not egress-denied.
 * @returns {{ repo: string, issueRef: number, files: Array }}
 */
function validateEmitInputs({ draft, approvalHash, env }) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    emitEgressAlert('env-missing', { note: 'undefined env would inherit process.env (killswitch bypass)' });
    throw new Error('ghEmit: a sanitized env (from buildEmitEnv) is required — undefined inherits process.env');
  }
  if (typeof approvalHash !== 'string' || !HASH64.test(approvalHash)) {
    emitEgressAlert('bad-approval-hash');
    throw new Error('ghEmit: missing/invalid approvalHash (gate contract)');
  }
  if (!draft || typeof draft !== 'object') throw new Error('ghEmit: a draft object is required');
  if (computeEmissionHash(draft) !== approvalHash) {
    emitEgressAlert('forward-contract-violation', { approvalHash });
    throw new Error('ghEmit: Forward-Contract violation — computeEmissionHash(draft) !== approvalHash');
  }
  const repo = draft.repo;
  const issueRef = draft.issueRef;
  const diff = typeof draft.diff === 'string' ? draft.diff : '';
  if (typeof repo !== 'string' || !/^[a-z0-9][a-z0-9-]*\/[a-z0-9._-]+$/.test(repo)) {
    emitEgressAlert('repo-not-normalized', { repo: String(repo).slice(0, 80) });
    throw new Error('ghEmit: draft.repo is not a normalized owner/name (gate contract)');
  }
  if (!Number.isInteger(issueRef) || issueRef <= 0) throw new Error('ghEmit: draft.issueRef is not a positive integer');
  if (Buffer.byteLength(diff, 'utf8') > MAX_DIFF_BYTES) throw new Error('ghEmit: diff exceeds the size bound (fail-closed)');
  const validated = new Set(parseDiffPaths(diff).paths);
  const files = reconstructPostImages(diff);
  if (files.length === 0) throw new Error('ghEmit: the approved diff reconstructs to zero files');
  for (const f of files) {
    if (!validated.has(f.path) || isEgressDeniedPath(f.path)) {
      emitEgressAlert('path-divergence-or-denied', { path: f.path });
      throw new Error(`ghEmit: reconstructed path not in the validated set / egress-denied: ${JSON.stringify(f.path)}`);
    }
  }
  return { repo, issueRef, files };
}

/**
 * Create a real DRAFT PR from the approved scrubbed draft via the gh REST git-data API. Called by emit-pr's
 * armedEmit ONLY after the gate passed. `env` already carries GH_TOKEN (buildEmitEnv) — the sole credential path.
 * @param {{ draft: object, approvalHash: string, env: object }} args
 * @param {{ runGh?: Function }} [deps]  inject a mock gh for unit tests (the real network is never touched)
 * @returns {{ pr_url: string, number: number, branch: string, deduped?: boolean }}
 */
function ghEmit({ draft, approvalHash, env } = {}, deps = {}) {
  const gh = deps.runGh || runGh;
  // 1. the REAL self-check (BEFORE any network): env guard + hash cross-check + faithful, validated reconstruction.
  const { repo, issueRef, files } = validateEmitInputs({ draft, approvalHash, env });

  // 2. resolve + VALIDATE the base (default) branch — never actor-supplied; the API value rides into argv + a ref.
  const repoMeta = ghJson(gh, ['api', `repos/${repo}`], { env });
  const base = repoMeta && repoMeta.default_branch;
  if (typeof base !== 'string' || base.length === 0 || !SAFE_BRANCH.test(base) || base.includes('..') || base.includes(':')) {
    emitEgressAlert('default-branch-unsafe', { base: String(base).slice(0, 80) });
    throw new Error(`ghEmit: API default_branch is unsafe (${JSON.stringify(base)})`);
  }
  const refObj = ghJson(gh, ['api', `repos/${repo}/git/ref/heads/${base}`], { env });
  const baseCommitSha = refObj && refObj.object && refObj.object.sha;
  if (typeof baseCommitSha !== 'string' || !/^[0-9a-f]{7,64}$/.test(baseCommitSha)) {
    throw new Error('ghEmit: could not resolve the base commit sha');
  }
  const baseCommit = ghJson(gh, ['api', `repos/${repo}/git/commits/${baseCommitSha}`], { env });
  const baseTreeSha = baseCommit && baseCommit.tree && baseCommit.tree.sha;
  if (typeof baseTreeSha !== 'string') throw new Error('ghEmit: could not resolve the base tree sha');

  // 3. tree (base_tree preserves unlisted files; inline content per entry — no separate blob POST).
  const treeBody = JSON.stringify({
    base_tree: baseTreeSha,
    tree: files.map((f) => ({ path: f.path, mode: f.mode, type: 'blob', content: f.content })),
  });
  const tree = ghJson(gh, ['api', `repos/${repo}/git/trees`, '--method', 'POST', '--input', '-'], { env, input: treeBody });
  if (!tree || typeof tree.sha !== 'string') throw new Error('ghEmit: tree create returned no sha');

  // 4. commit (message is a kernel constant).
  const commitBody = JSON.stringify({ message: commitMessage(issueRef, approvalHash), tree: tree.sha, parents: [baseCommitSha] });
  const commit = ghJson(gh, ['api', `repos/${repo}/git/commits`, '--method', 'POST', '--input', '-'], { env, input: commitBody });
  if (!commit || typeof commit.sha !== 'string') throw new Error('ghEmit: commit create returned no sha');

  // 5. ref (RESERVE). The branch name is kernel-built from the validated integer + the hash — deterministic =>
  //    the idempotency key. A 422 "already exists" => dedup-reconcile to the existing PR (no duplicate).
  const owner = repo.split('/')[0];
  const branch = `loom/issue-${issueRef}-${approvalHash.slice(0, 12)}`;
  const refBody = JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha });
  let reserved = false;
  try {
    gh(['api', `repos/${repo}/git/refs`, '--method', 'POST', '--input', '-'], { env, input: refBody });
    reserved = true;
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
    // dedup-on-key: a 422 "already exists" => reconcile to the existing OPEN PR for THIS exact branch. VALIDATE-hacker
    // LOW: verify head.ref === our branch before trusting it (self-validating, not solely the `?head=` filter).
    const existing = ghJson(gh, ['api', `repos/${repo}/pulls?head=${owner}:${branch}&state=open`], { env });
    const pr = Array.isArray(existing)
      ? existing.find((p) => p && p.head && p.head.ref === branch && p.draft === true)
      : null;
    if (pr) return { pr_url: pr.html_url, number: pr.number, branch, deduped: true };
    // VALIDATE-hacker MEDIUM (dedup laundering) — the ref EXISTS but no OPEN loom PR points at it. DO NOT auto-create
    // a PR on a pre-existing branch: an actor with push access could pre-create the (publicly-computable) loom branch
    // with arbitrary content, and a silent re-PR would brand attacker content with loom's approval envelope. Fail
    // CLOSED + observable so a genuine partial-prior-emit is operator-reconciled, never auto-laundered.
    emitEgressAlert('ref-exists-no-open-pr', { branch });
    throw new Error(`ghEmit: ref ${branch} exists but no open loom DRAFT PR points at it — refusing to auto-create on a pre-existing branch (operator must verify)`);
  }

  // 6. pull (draft:true is a HARD CONSTANT — never a parameter). reserve->rollback ONLY if WE created the ref.
  try {
    const prBodyJson = JSON.stringify({ title: prTitle(issueRef), head: branch, base, body: prBody(issueRef, approvalHash), draft: true });
    const pr = ghJson(gh, ['api', `repos/${repo}/pulls`, '--method', 'POST', '--input', '-'], { env, input: prBodyJson });
    return { pr_url: pr.html_url, number: pr.number, branch };
  } catch (err) {
    if (reserved) {
      // best-effort rollback of the orphan ref so a retry isn't blocked; never throw over the original error.
      try { gh(['api', `repos/${repo}/git/refs/heads/${branch}`, '--method', 'DELETE'], { env }); } catch { /* best-effort */ }
    }
    throw err;
  }
}

module.exports = { ghEmit, runGh, reconstructPostImages, isAlreadyExists, prTitle, commitMessage, prBody };
