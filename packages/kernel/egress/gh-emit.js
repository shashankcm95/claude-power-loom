'use strict';

// @loom-layer: kernel
//
// ③.2.5c — the gh-REST emission MECHANISM: the live network seam behind the now-complete signed approval gate
// (5a verify-half #399 + 5b cross-uid broker #400 + 5b.2 approve-CLI #401). This is the FIRST code in the repo
// that touches the network. emit-pr.js's armedEmit() delegates here ONLY when the gate has passed
// (live AND token AND killswitch-off AND a VALID per-emission signed human approval).
//
// THE LOAD-BEARING DESIGN (the ③.2.5c VERIFY board folded 2 CRITICAL + 4 HIGH; the #405 modify-applier added its
// own VALIDATE folds — a CRITICAL mode-allowlist [C1], path-allowlist, header whitelist, env-sanitization check,
// and baseCommitSha attestation — see each wave plan's Pre-Approval/VALIDATE table):
//   1. TRANSPORT = `gh api <endpoint> --method <M> --input -` with the FULL JSON body on STDIN. NEVER `-f`/`-F`
//      for ANY field (CRITICAL-1, re-probed on gh 2.90.0): `-F/--field` magic-reads a value starting with `@` as
//      a HOST FILE — the blob `content` is actor-influenced + multi-line, so a `@path`-leading line would
//      exfiltrate a host file into the first live PR. `--input -` sends opaque JSON; no field-flag magic touches
//      actor bytes. The subprocess (vs node-https) keeps the shipped EC1b.1 killswitch=env-sanitization proof
//      meaningful (only a credential-resolving subprocess can pick up ambient creds; buildEmitEnv neutralizes it).
//   2. POST-IMAGE = EXACT POSITIONAL RECONSTRUCTION from the SCRUBBED diff (draft.diff). #405 generalizes the
//      ③.2.5c new-file-only path to a fail-closed base+hunk applier: `parseDiffStanzas` (pure) parses each file
//      stanza into typed hunks; `applyHunks(base, hunks)` (pure) rebuilds the post-image positionally. A NEW-file
//      add applies against an EMPTY base; a MODIFY fetches the base content at the resolved base commit (gh
//      contents API) and applies the approved hunks. The applier is EXACT-reconstruction, NOT a line-count check
//      (#405 VERIFY-hacker CRITICAL — a count is satisfied by many byte-strings): hunks must be strictly
//      ascending + non-overlapping by oldStart; each `newStart` must equal the running new-file offset (catches a
//      lying header); every ` `/`-` line must match the live base EXACTLY (a moved base => REFUSE, never a
//      guessed/corrupting post-image); content lines are taken from the hunk body by COUNT (strip exactly one
//      leading op char), never a `startsWith('+++')` test (HIGH-4: that drops a legit `+`-leading body line).
//      rename/copy/DELETE stanzas are DEFERRED (fail-closed). The emitted path must be the canonical stanza path
//      AND be in the validated path-set AND pass isEgressDeniedPath AND carry no `?`/`#`/`%` (the contents-URL
//      query/fragment-injection surface). The bytes on the wire derive ONLY from the approved scrubbed diff +
//      the fetched base — never a worktree (raw secret).
//   3. THE REAL SELF-CHECK (CRITICAL-2), TWO load-bearing halves: the hash cross-check binds the DIFF to the
//      gate's INDEPENDENTLY-threaded approvalHash (computeEmissionHash(draft) === approvalHash — catches a seam
//      divergence where a future refactor hands the seam a draft other than the one the gate hashed); the
//      exact positional reconstruction (ascending+non-overlap, newStart===running-offset, exact context/removed
//      match, exactly oldCount consumed per hunk, no line past base EOF, verbatim tail-carry) + path-membership
//      bind the emitted file CONTENT faithfully to that diff. Both are load-bearing for DIFFERENT properties —
//      neither is the rejected
//      self-rehash tautology (a re-hash of the draft against a hash computed from the SAME draft in the SAME call).
//      A FORWARD-CONTRACT residual remains (#405 honesty HIGH): the human approved the DIFF; for a MODIFY the
//      emitted bytes are live-base + approved-hunks, and the inter-hunk gap/tail come from the emit-time base the
//      approver did not render. The exact match bounds divergence to "the approved hunks at the approved
//      positions"; a moved base REFUSES; DRAFT-only + human-merge (PATH-1) gates it. Binding baseCommitSha into
//      the approval is a future arming step (the honest analog of approval.js's own "integrity not provenance").
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
const { computeEmissionHash, BASE_SHA_RE, isSafeBaseSha } = require('./approval');   // F-W2b — the shared base-sha shape gate (the live-base domain + moved-base compare + the consumer-boundary guard)
const { parseDiffPaths, isEgressDeniedPath, ENV_ALLOWLIST, OWNER_RE } = require('./emit-pr');
const { emitEgressAlert } = require('./alert');                       // #412 — extracted shared egress alert (also used by the host-actor guard)
const { sleepSync } = require('../_lib/sleep');                       // F-W2 — the shared synchronous-sleep primitive (DRY: same core as _lib/lock.js's _waitSleep) for the bounded fork-readiness poll

const HASH64 = /^[0-9a-f]{64}$/;
const SAFE_BRANCH = /^[A-Za-z0-9._/-]+$/;          // the API-resolved default_branch charset (rides into argv + a ref path)
// F-W1 — the NORMALIZED owner/name shape a resolvedForkRepo must match (the SAME normalized form
// validateEmitInputs enforces on draft.repo). A custody fork target is lowercased-normalized by construction;
// re-asserting the shape at the gh-emit sink is defense-in-depth (the fork string rides into the write argv).
const NORMALIZED_REPO_RE = /^[a-z0-9][a-z0-9-]*\/[a-z0-9._-]+$/;
// F-W2 length caps (architect F-6 + code-reviewer LOW). GitHub's login (owner) max is 39 chars; a normalized
// owner/name string is capped generously at 100. These turn a fail-LATE (a 500-char owner 404s at the network,
// unobservable) into a fail-FAST + observable alert BEFORE F-W3 gives forkRepo a live head. Kernel constants.
const MAX_OWNER_LEN = 39;
const MAX_REPO_REF_LEN = 100;
// F-W4 M0 — maintainer_can_modify is a HARD KERNEL CONSTANT, EXPLICITLY `false` (Q-M1-necessity RESOLVED false,
// 2026-07-02), added to the cross-repo PR-create ONLY in fork mode. NEVER read from `draft`/`data`/a param — a
// maintainer-edit permission bit is exactly the policy an actor must not set through the envelope (#273 steering-field
// rule); an actor planting `true` is IGNORED (the const wins), so the actor cannot ESCALATE to maintainer edit access.
// WHY false (grounded — GitHub docs): `maintainer_can_modify:true` grants anyone with upstream push access the ability
// to commit to loom's fork branch, and because a fork INHERITS the upstream workflows it escalates to "allow edits AND
// access to secrets" — a capability loom's draft-candidate flow does not need (YAGNI). `false` is the smallest surface
// AND keeps the merged bytes provably loom's approved content (OQ-NS-6, the trust-signal integrity the north-star
// needs). Set EXPLICITLY (not omitted) so the semantics never depend on the GitHub create-PR default. Inert until F-W4
// populates a live forkRepo (isForkMode is always false in production => this const never rides the wire this wave).
const MAINTAINER_CAN_MODIFY = false;
// F-W2 fork-readiness poll (architect F-5 + code-reviewer + hacker M3 — triple convergence). HARD KERNEL
// CONSTANTS, NEVER caller-overridable opts (security.md non-bypassable-guard): only the wait MECHANISM (`sleep`)
// is injectable, for test speed. The bounded exponential backoff: attempt 1 = an immediate GET; on a 404,
// sleep(min(250 * 2^(attempt-1), 20000)) ms then retry; give up (fork-readiness-timeout) after
// FORK_READINESS_MAX_ATTEMPTS WITHOUT sleeping after the last failed attempt. Worst-case wait
// 250+500+1000+2000+4000+8000+16000 = ~31.75s (well under GitHub's 5-min fork escalation).
const FORK_READINESS_MAX_ATTEMPTS = 8;
const FORK_READINESS_BASE_MS = 250;
const FORK_READINESS_MAX_MS = 20000;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;         // a generous bound on any single gh response (DoS cap)
const MAX_DIFF_BYTES = 5 * 1024 * 1024;            // self-defend the kernel module (mirrors emit-pr's upstream cap)
// #405 — base+hunk applier amplification caps (kernel constants). MAX_BASE_BYTES aligns with the gh contents-API
// base64 ceiling (a file > 1MB returns encoding:'none' — refuse, see ghEmit). MAX_POST_IMAGE_BYTES bounds the
// PRODUCED new file: a tiny diff applied to a large base, or a single huge added line, would otherwise amplify
// (#405 VERIFY-hacker HIGH). 2MB is generous for a good-first-issue candidate file + a clear DoS signal.
const MAX_BASE_BYTES = 1 * 1024 * 1024;
const MAX_POST_IMAGE_BYTES = 2 * 1024 * 1024;
// #405 VALIDATE-hacker C1 (CRITICAL) — the diff's `mode` is an ACTOR-AUTHORED, self-asserted field that rides
// verbatim into the emitted git tree. A `120000` lands a SYMLINK, `160000` a gitlink/submodule, `040000` a tree
// — all unbounded primitives in a maintainer's repo. The egress emits REGULAR FILES ONLY (the #273 "never trust
// a self-asserted field" class). Anything else fails closed.
const ALLOWED_FILE_MODES = new Set(['100644', '100755']);
// #405 VALIDATE-hacker M2 (defense-in-depth) — the passed env MUST be a buildEmitEnv() product, not process.env
// (a refactor handing the ambient env would reintroduce the very credentials the killswitch dropped). Check by
// ALLOWLIST, not denylist: refuse any key OUTSIDE buildEmitEnv's known output. buildEmitEnv copies ENV_ALLOWLIST
// from process.env then SETS these hardening/credential keys (emit-pr.js:86-94) — so a benign GIT_CONFIG_NOSYSTEM /
// GIT_CONFIG_GLOBAL it sets must NOT be refused (the v1 `startsWith('GIT_CONFIG')` denylist false-refused the
// sanitizer's OWN output — a CRITICAL the mock-`env:{}` tests missed; caught by the first live broker-signed
// dogfood, Rule-2a-corollary). This MUST track buildEmitEnv's output; the real-buildEmitEnv regression test fails
// if buildEmitEnv adds a key not listed here.
const BUILD_EMIT_ENV_SET_KEYS = ['GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL', 'GIT_TERMINAL_PROMPT', 'GIT_ALLOW_PROTOCOL', 'GH_CONFIG_DIR', 'GH_PROMPT_DISABLED', 'GH_NO_UPDATE_NOTIFIER', 'GH_TOKEN'];
const SANITIZED_ENV_KEYS = new Set([...ENV_ALLOWLIST, ...BUILD_EMIT_ENV_SET_KEYS]);

// ③.2.5c — emitEgressAlert: the HIGH-VISIBILITY alert on a SECURITY-sensitive egress reject. #412 extracted it to
// ./alert.js (verbatim) so the host-level-actor armed-refusal guard emits the SAME signal; imported above.

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

/**
 * F-W2 — a 404 "Not Found" (the fork-does-not-exist signal, mirroring isAlreadyExists). ensureFork treats a 404
 * GET as "proceed to create"; any OTHER error (5xx / 403 / network / unparseable) RE-THROWS immediately
 * (fail-closed — never create/keep-polling on an unknown error). Matches `HTTP 404` OR a bare `Not Found` on
 * either stderr or stdout, so a gh-api error page on either stream is caught. Never throws.
 */
function isNotFound(err) {
  const text = `${(err && err.stderr) || ''}${(err && err.stdout) || ''}`;
  return /HTTP 404\b/.test(text) || /not found/i.test(text);
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
// Diff parsing + EXACT positional reconstruction (pure, fail-closed) — #405.
// --------------------------------------------------------------------------

const RE_GIT = /^diff --git "?a\/(.+?)"? "?b\/(.+?)"?\s*$/;
const RE_PLUS = /^\+\+\+ "?b\/(.+?)"?\s*$/;
const RE_HUNK_FULL = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const NO_NL_MARKER = '\\ No newline at end of file';
// #405 VALIDATE-hacker M1 — validate the stanza path against a POSITIVE relative-path allowlist (NOT a `?#%`
// denylist): the path is interpolated into the `contents/{path}?ref=` endpoint, so a `&`/space/`@`/quote/`..`
// must never reach `gh api`. A denylist is allow-what-isn't-blocked (a future refactor that moves `?ref=` turns an
// un-encoded `&` into param-injection); the allowlist is deny-what-isn't-a-safe-path. (`..`/leading-`/` also caught
// by isEgressDeniedPath.)
const SAFE_PATH = /^[A-Za-z0-9._/-]+$/;

/**
 * Parse a SCRUBBED unified diff into per-file stanzas (PURE — no I/O). Each stanza:
 *   { pathB, type:'add'|'modify', mode, hunks:[{oldStart,oldCount,newStart,newCount,lines:[{op,text,oldNoNL,newNoNL}]}] }
 * `op` is one of ' '|'+'|'-'. A `\ No newline at end of file` marker is parsed as a PER-SIDE flag on the
 * immediately-preceding hunk line (git emits it mid-hunk, qualifying only that line's side): a `-` line sets
 * oldNoNL, a `+` line sets newNoNL, a ` ` context line sets BOTH; it is EXCLUDED from the op-counts. A bare ''
 * line is a blank CONTEXT line (op ' ', text '', advances base).
 *
 * FAIL-CLOSED refusals (this is the egress attack surface — refuse on anything off-shape):
 *   - a rename / copy / DELETE stanza (DEFERRED — `sha:null` delete + rename detection are out of scope).
 *   - path divergence (`diff --git a/X b/Y` with X != Y, or a `+++ b/Z` with Z != the canonical b-path).
 *   - a path bearing `?` / `#` / `%` (the contents-URL injection surface).
 *   - a hunk whose old-side (` `+`-`) count != oldCount or new-side (` `+`+`) count != newCount.
 *   - a `\ No newline` marker with no preceding line / a duplicate marker on one line.
 *   - a stanza with zero hunks (a mode-only / empty change is not emittable).
 *   - a `new file mode` stanza whose hunk old-side is not -0,0.
 * @param {string} scrubbedDiff
 * @returns {Array<{ pathB: string, type: 'add'|'modify', mode: string, hunks: Array }>}
 */
function parseDiffStanzas(scrubbedDiff) {
  const lines = String(scrubbedDiff || '').split('\n');
  const stanzas = [];
  let i = 0;
  while (i < lines.length) {
    const mGit = RE_GIT.exec(lines[i]);
    if (!mGit) { i += 1; continue; }
    const gitPathA = mGit[1].trim();
    const gitPathB = mGit[2].trim();

    // --- header scan: until the first hunk or the next stanza. The scan is a WHITELIST (#405 VALIDATE-architect
    //     MED): every non-blank header line must be a RECOGNIZED git header form — an unrecognized line fails
    //     closed (a future git marker can't slip through to be mis-attributed downstream). Content can ONLY come
    //     from exact-matched hunk bodies, so the recognized-but-ignored metadata lines (index/---/+++ /dev/null)
    //     cannot inject bytes.
    let type = 'modify';
    let mode = '100644';
    let plusPath = null;
    let forbidden = null;
    let j = i + 1;
    for (; j < lines.length; j += 1) {
      const h = lines[j];
      if (RE_GIT.test(h)) break;                     // next stanza (this one carried no hunk)
      if (RE_HUNK_FULL.test(h)) break;               // hunks begin
      if (h === '') continue;                        // a blank separator line
      let m;
      if ((m = /^new file mode (\d{6})$/.exec(h))) { type = 'add'; mode = m[1]; }
      else if (/^deleted file mode /.test(h)) forbidden = 'delete';
      else if (/^(rename|copy) (from|to) /.test(h)) forbidden = 'rename/copy';
      else if (/^(old|new) mode \d{6}$/.test(h)) forbidden = 'mode-change';   // a chmod (code-reviewer MED) — never silently emit a wrong explicit mode
      else if (/^(Binary files |GIT binary patch)/.test(h)) forbidden = 'binary';
      else if ((m = RE_PLUS.exec(h))) plusPath = m[1].trim();
      else if (/^(index |--- |\+\+\+ |similarity index |dissimilarity index )/.test(h)) { /* recognized-benign metadata — ignored; cannot inject content */ }
      else throw new Error(`parseDiffStanzas: unrecognized header line ${JSON.stringify(h.slice(0, 60))} — fail-closed (the egress parser is a whitelist)`);
    }

    // --- header-level fail-closed refusals ---
    if (forbidden) throw new Error(`parseDiffStanzas: a ${forbidden} stanza is not emittable this wave (fail-closed)`);
    if (gitPathA !== gitPathB) throw new Error(`parseDiffStanzas: stanza path diverges (a/${gitPathA} != b/${gitPathB}) — rename/byzantine, fail-closed`);
    if (plusPath !== null && plusPath !== gitPathB) throw new Error(`parseDiffStanzas: +++ path ${JSON.stringify(plusPath)} != ${JSON.stringify(gitPathB)} — fail-closed`);
    if (!SAFE_PATH.test(gitPathB)) throw new Error(`parseDiffStanzas: path ${JSON.stringify(gitPathB)} is not a safe relative path ([A-Za-z0-9._/-]) — fail-closed`);
    if (type === 'add' && !ALLOWED_FILE_MODES.has(mode)) {
      throw new Error(`parseDiffStanzas: new-file mode ${mode} is not an allowed file mode (100644/100755) — symlink/gitlink/tree refused — fail-closed`);
    }

    // --- parse hunks until the next stanza / EOF ---
    const hunks = [];
    while (j < lines.length && !RE_GIT.test(lines[j])) {
      const mh = RE_HUNK_FULL.exec(lines[j]);
      if (!mh) {
        if (lines[j].length === 0) { j += 1; continue; }   // tolerate a blank separator line between/after hunks
        throw new Error(`parseDiffStanzas: unexpected line outside a hunk ${JSON.stringify(lines[j].slice(0, 60))} — fail-closed`);
      }
      const oldStart = Number(mh[1]);
      const oldCount = mh[2] === undefined ? 1 : Number(mh[2]);
      const newStart = Number(mh[3]);
      const newCount = mh[4] === undefined ? 1 : Number(mh[4]);
      j += 1;                                              // step past the @@ header
      const body = [];
      let oldSeen = 0; let newSeen = 0;
      for (; j < lines.length; j += 1) {
        const ln = lines[j];
        if (ln === NO_NL_MARKER) {
          if (body.length === 0) throw new Error('parseDiffStanzas: a `\\ No newline` marker with no preceding hunk line — fail-closed');
          const prev = body[body.length - 1];
          if (prev.noNLApplied) throw new Error('parseDiffStanzas: a duplicate `\\ No newline` marker — fail-closed');
          prev.noNLApplied = true;
          if (prev.op === '-') prev.oldNoNL = true;
          else if (prev.op === '+') prev.newNoNL = true;
          else { prev.oldNoNL = true; prev.newNoNL = true; }
          continue;
        }
        if (oldSeen === oldCount && newSeen === newCount) break;   // the hunk body is complete
        let op; let text;
        if (ln === '') { op = ' '; text = ''; }                    // a blank context line
        else {
          const c = ln[0];
          if (c === ' ' || c === '+' || c === '-') { op = c; text = ln.slice(1); }
          else break;                                              // not a body line — the count check below catches a short body
        }
        if (op === ' ') { oldSeen += 1; newSeen += 1; }
        else if (op === '-') { oldSeen += 1; }
        else { newSeen += 1; }
        body.push({ op, text, oldNoNL: false, newNoNL: false });
      }
      if (oldSeen !== oldCount || newSeen !== newCount) {
        throw new Error(`parseDiffStanzas: hunk body count mismatch (header -${oldCount} +${newCount}, body old ${oldSeen} new ${newSeen}) — fail-closed`);
      }
      hunks.push({ oldStart, oldCount, newStart, newCount, lines: body });
    }

    if (hunks.length === 0) throw new Error(`parseDiffStanzas: stanza ${JSON.stringify(gitPathB)} has no hunks (mode-only/empty not emittable) — fail-closed`);
    if (type === 'add') {
      for (const hk of hunks) {
        if (hk.oldStart !== 0 || hk.oldCount !== 0) throw new Error(`parseDiffStanzas: a new-file hunk must be -0,0 (got -${hk.oldStart},${hk.oldCount}) — fail-closed`);
      }
    }
    stanzas.push({ pathB: gitPathB, type, mode, hunks });
    i = j;
  }
  if (stanzas.length === 0) throw new Error('parseDiffStanzas: no parseable diff stanza (fail-closed)');
  return stanzas;
}

/**
 * Split base text into logical lines that match git's hunk line-numbering. PURE.
 *   ""        => { lines: [],            endsWithNL: true  }   (an empty file)
 *   "a\nb\n"  => { lines: ['a','b'],     endsWithNL: true  }
 *   "a\nb"    => { lines: ['a','b'],     endsWithNL: false }   (an unterminated last line)
 * Splits ONLY on '\n' so a CRLF file keeps its '\r' as line content (faithful reconstruction).
 */
function splitBaseLines(text) {
  if (text === '') return { lines: [], endsWithNL: true };
  const endsWithNL = text.endsWith('\n');
  const body = endsWithNL ? text.slice(0, -1) : text;
  return { lines: body.split('\n'), endsWithNL };
}

/**
 * Rebuild a file's FULL post-image by applying `hunks` to `baseText` (PURE, FAIL-CLOSED, EXACT positional
 * reconstruction — #405 VERIFY-hacker CRITICAL: a line-COUNT check is satisfied by many byte-strings; this
 * reconstructs positionally and REFUSES `cannot-apply-hunk` on ANY divergence). A NEW-file add applies against
 * baseText === '' (empty base). Invariants:
 *   1. hunks strictly ascending + non-overlapping by oldStart.
 *   2. each hunk's `newStart` === 1 + the running new-file line offset (catches a lying header).
 *   3. every ` `/`-` line matches the live base EXACTLY at the stated position; a `-`/` ` past base EOF, or a
 *      content mismatch, => refuse (a moved base). The TRAILING unchanged region is carried VERBATIM from the
 *      base (correct unified-diff semantics — it is NOT asserted-equal-to-base.length; the enforced guarantees
 *      are: each hunk consumes exactly oldCount, no gap runs past EOF, and every ` `/`-` matches).
 *   4. the trailing newline of the post-image is the NEW-side no-newline flag of the FINAL emitted line.
 *   5. base > MAX_BASE_BYTES or post-image > MAX_POST_IMAGE_BYTES => refuse (DoS amplification cap).
 * `hunks` MUST be non-empty (parseDiffStanzas refuses a zero-hunk stanza; the exported guard below makes the
 * precondition explicit so a direct caller cannot get a silent no-op base passthrough).
 * @param {string} baseText
 * @param {Array} hunks  parseDiffStanzas hunk objects
 * @returns {string} the reconstructed post-image
 */
function applyHunks(baseText, hunks) {
  if (!Array.isArray(hunks) || hunks.length === 0) {
    throw new Error('cannot-apply-hunk: no hunks to apply (fail-closed — a zero-hunk stanza is not emittable)');
  }
  const src = baseText == null ? '' : String(baseText);
  if (Buffer.byteLength(src, 'utf8') > MAX_BASE_BYTES) {
    throw new Error('cannot-apply-hunk: base exceeds MAX_BASE_BYTES (fail-closed)');
  }
  const { lines: baseLines, endsWithNL: baseEndsNL } = splitBaseLines(src);

  // invariant 1: strictly ascending + non-overlapping by oldStart (refuse on adjacency/overlap/out-of-order).
  for (let k = 0; k + 1 < hunks.length; k += 1) {
    if (hunks[k + 1].oldStart <= hunks[k].oldStart + hunks[k].oldCount) {
      throw new Error(`cannot-apply-hunk: hunks not strictly ascending/non-overlapping (hunk ${k} ends ${hunks[k].oldStart + hunks[k].oldCount}, next oldStart ${hunks[k + 1].oldStart}) — fail-closed`);
    }
  }

  const out = [];                  // [{ text, noNL }] — the reconstructed new-file lines
  const lastBase = baseLines.length - 1;
  let bk = 0;                      // 0-indexed cursor into baseLines (next unconsumed old line)
  for (const hk of hunks) {
    // gapEnd (0-indexed exclusive) = where this hunk's old-side begins. oldCount===0 (pure insertion) inserts
    // AFTER old line oldStart, so the gap runs to oldStart; oldCount>0 starts AT line oldStart (1-based).
    const gapEnd = hk.oldCount > 0 ? hk.oldStart - 1 : hk.oldStart;
    if (gapEnd < bk) throw new Error(`cannot-apply-hunk: hunk oldStart ${hk.oldStart} precedes cursor ${bk} (overlap) — fail-closed`);
    if (gapEnd > baseLines.length) throw new Error(`cannot-apply-hunk: hunk oldStart ${hk.oldStart} is past EOF (${baseLines.length}) — fail-closed`);
    for (let g = bk; g < gapEnd; g += 1) out.push({ text: baseLines[g], noNL: (g === lastBase && !baseEndsNL) });
    bk = gapEnd;
    // invariant 2: after the gap, the new-file position must equal newStart - 1.
    if (out.length !== hk.newStart - 1) {
      throw new Error(`cannot-apply-hunk: newStart ${hk.newStart} != running new-offset ${out.length + 1} — fail-closed`);
    }
    for (const l of hk.lines) {
      if (l.op === ' ') {
        if (bk >= baseLines.length) throw new Error(`cannot-apply-hunk: context line extends past base EOF at line ${bk + 1} — fail-closed`);
        if (baseLines[bk] !== l.text) throw new Error(`cannot-apply-hunk: context mismatch at base line ${bk + 1} (moved base) — fail-closed`);
        out.push({ text: l.text, noNL: !!l.newNoNL });
        bk += 1;
      } else if (l.op === '-') {
        if (bk >= baseLines.length) throw new Error(`cannot-apply-hunk: removed line extends past base EOF at line ${bk + 1} — fail-closed`);
        if (baseLines[bk] !== l.text) throw new Error(`cannot-apply-hunk: removed-line mismatch at base line ${bk + 1} (moved base) — fail-closed`);
        bk += 1;
      } else {                       // '+'
        out.push({ text: l.text, noNL: !!l.newNoNL });
      }
    }
    // each hunk must consume EXACTLY oldCount old lines (gap excluded).
    if (bk !== gapEnd + hk.oldCount) {
      throw new Error(`cannot-apply-hunk: hunk consumed ${bk - gapEnd} old lines, header said ${hk.oldCount} — fail-closed`);
    }
  }
  // tail: carry the remaining unchanged base lines VERBATIM (correct unified-diff semantics — trailing context
  // is part of the post-image, NOT a refusal). bk advances to baseLines.length here.
  for (let g = bk; g < baseLines.length; g += 1) out.push({ text: baseLines[g], noNL: (g === lastBase && !baseEndsNL) });

  if (out.length === 0) return '';
  const body = out.map((l) => l.text).join('\n');
  const result = out[out.length - 1].noNL ? body : body + '\n';
  if (Buffer.byteLength(result, 'utf8') > MAX_POST_IMAGE_BYTES) {
    throw new Error('cannot-apply-hunk: produced post-image exceeds MAX_POST_IMAGE_BYTES (fail-closed)');
  }
  return result;
}

// --------------------------------------------------------------------------
// The kernel-constant PR envelope (HIGH-3 — zero actor bytes).
// --------------------------------------------------------------------------

function prTitle(issueRef) { return `loom: candidate for issue #${issueRef}`; }
// #405 VALIDATE-architect F5 / hacker H1: bind the resolved base-commit sha into the envelope so the (base, diff)
// pair is ATTESTABLE — a reviewer of the DRAFT can verify WHICH base the approved hunks were applied against
// (for a MODIFY the inter-hunk gap/tail come from the emit-time base). The sha is API-resolved + hex-validated,
// never actor text. Binding the sha into the APPROVAL basis (so a moved base invalidates the approval) is the
// fuller close — a future arming step (the honest analog of approval.js's own integrity-not-provenance residual).
function commitMessage(issueRef, hash, baseSha) { return `loom: candidate for issue #${issueRef}\n\napproval-hash: ${hash}\nbase-commit: ${baseSha}\n`; }
function prBody(issueRef, hash, baseSha) {
  return `Automated DRAFT candidate from Power Loom for issue #${issueRef}.\n\n`
    + `This is a SHADOW/DRAFT egress behind a signed, human-approved gate. `
    + `It is a draft for human review, not a merge request.\n\napproval-hash: ${hash}\nbase-commit: ${baseSha}\n`;
}

// --------------------------------------------------------------------------
// F-W1 — the two-identity axis: upstreamRepo (reads + dedup endpoint + PR base) vs forkRepo (tree/commit/ref
// writes + rollback). validateForkIdentity is a PURE derivation guard: when forkRepo is ABSENT it resolves to
// the upstream (byte-identical, same-owner); when PRESENT it is structurally DORMANT in F-W1 (no fork write
// yet) but the guards MUST exist before F-W3 populates a real cross-repo head. Each reject ALERTS (observable)
// then throws.
// --------------------------------------------------------------------------

/**
 * Derive the fork write-identity from the upstream + an optional custody fork target. PURE. FAIL-CLOSED — a
 * SECURITY boundary, so each reject emits an observable alert then throws.
 *   - resolvedForkRepo = forkRepo === undefined ? upstreamRepo : forkRepo (EXPLICIT undefined check, NOT `||`:
 *     an empty-string forkRepo from a custody mis-wire must fail LOUD, never silently resolve to upstream — F-5).
 *   - the resolved fork target must be a NORMALIZED owner/name (re-asserted at the write sink — C-1 chain).
 *   - present-target precondition (M-2): a nameless upstream (empty upstreamName) must NOT let a mismatch pass
 *     vacuously (undefined === undefined) — require a non-empty upstream name BEFORE the equality.
 *   - forkOwner must pass OWNER_RE (C-1): a distinct forkOwner var breaks the assertSafeRepoRef chain, and it
 *     interpolates raw into `pulls?head=${forkOwner}:${branch}` — a malformed owner is param-injection.
 *   - a fork must share the repo NAME (forkName === upstreamName) — else fork-identity-mismatch.
 *   - an optional expectedForkOwner (F-W4 custody value) is asserted ONLY when provided.
 * @param {{ upstreamRepo: string, forkRepo?: string, expectedForkOwner?: string }} o
 * @returns {{ resolvedForkRepo: string, forkOwner: string }}
 */
function validateForkIdentity({ upstreamRepo, forkRepo, expectedForkOwner } = {}) {
  const resolvedForkRepo = forkRepo === undefined ? upstreamRepo : forkRepo;
  if (typeof resolvedForkRepo !== 'string' || !NORMALIZED_REPO_RE.test(resolvedForkRepo)) {
    emitEgressAlert('fork-repo-unsafe', { forkRepo: String(resolvedForkRepo).slice(0, 80) });
    throw new Error(`ghEmit: forkRepo is not a normalized owner/name (${JSON.stringify(String(resolvedForkRepo).slice(0, 80))}) — fail-closed`);
  }
  // F-W2 length cap (architect F-6 + code-reviewer LOW): a fail-FAST + observable bound BEFORE the fork string
  // rides into the write argv. Cite GitHub's 39-char login max for the owner; a generous 100 for the whole ref.
  if (resolvedForkRepo.length > MAX_REPO_REF_LEN) {
    emitEgressAlert('fork-repo-unsafe', { reason: 'ref-too-long', length: resolvedForkRepo.length });
    throw new Error(`ghEmit: resolvedForkRepo length ${resolvedForkRepo.length} exceeds ${MAX_REPO_REF_LEN} — fail-closed`);
  }
  const [forkOwner, forkName] = resolvedForkRepo.split('/');
  if (forkOwner.length > MAX_OWNER_LEN) {
    emitEgressAlert('fork-owner-unsafe', { reason: 'owner-too-long', length: forkOwner.length });
    throw new Error(`ghEmit: forkOwner length ${forkOwner.length} exceeds GitHub's ${MAX_OWNER_LEN}-char login max — fail-closed`);
  }
  const [, upstreamName] = String(upstreamRepo).split('/');
  // M-2 present-target precondition: a nameless upstream would let forkName === upstreamName pass vacuously.
  if (typeof upstreamName !== 'string' || upstreamName.length === 0) {
    emitEgressAlert('fork-identity-mismatch', { reason: 'no-upstream-name', upstreamRepo: String(upstreamRepo).slice(0, 80) });
    throw new Error('ghEmit: upstreamRepo has no name segment — cannot derive a fork identity (fail-closed)');
  }
  if (!OWNER_RE.test(forkOwner)) {
    emitEgressAlert('fork-owner-unsafe', { forkOwner: String(forkOwner).slice(0, 80) });
    throw new Error(`ghEmit: forkOwner is not a valid GitHub login (${JSON.stringify(String(forkOwner).slice(0, 80))}) — fail-closed`);
  }
  if (forkName !== upstreamName) {
    emitEgressAlert('fork-identity-mismatch', { forkName, upstreamName });
    throw new Error(`ghEmit: a fork must share the repo NAME (fork ${JSON.stringify(forkName)} != upstream ${JSON.stringify(upstreamName)}) — fail-closed`);
  }
  if (expectedForkOwner !== undefined && forkOwner !== String(expectedForkOwner).toLowerCase()) {
    // M-1: lowercase the expected side (forkOwner is already NORMALIZED_REPO_RE-lowercase) so a canonical-cased
    // custody value does not fail-closed every legit fork emit.
    emitEgressAlert('fork-identity-mismatch', { forkOwner, expectedForkOwner });
    throw new Error(`ghEmit: forkOwner ${JSON.stringify(forkOwner)} != expectedForkOwner ${JSON.stringify(expectedForkOwner)} — fail-closed`);
  }
  return { resolvedForkRepo, forkOwner };
}

// --------------------------------------------------------------------------
// F-W2 — the fork lifecycle (`ensureFork`), DORMANT / byte-identical. Called by ghEmit ONLY when
// resolvedForkRepo !== upstreamRepo (a real distinct fork). Create/verify the bot's fork of THIS upstream
// BEFORE any fork-side write. PURE of any tree/commit/ref write (verify + create only). Each reject ALERTS
// (observable) then throws — a SECURITY boundary (fail-closed: never write to an unconfirmed/wrong fork).
//
// TRUST BINDING (hacker C1): the assert "is a fork of the RIGHT upstream" is NOT sufficient — an attacker who
// owns `attacker/{upstreamName}` (a legit fork of upstream) would pass it, and loom would write into the
// attacker's repo. So expectedForkOwner is MANDATORY and BOTH the resolved target owner AND the API's actual
// `.owner.login` must equal it: the write is bound to LOOM's bot identity, not merely "a fork of upstream".
// --------------------------------------------------------------------------

/**
 * Verify an API `repos/{fork}` 200 body is a fork of `upstreamRepo` owned by `expectedForkOwner`. FAIL-CLOSED
 * with an observable alert on ANY shape violation or mismatch (never a bare TypeError on a null `.source`).
 * Run on BOTH the immediate-200 (fork-exists) path AND the post-poll-200 (create-then-ready) path — the SAME
 * verification, so the two call-sites cannot silently diverge (code-reviewer post-poll-verification fold).
 *   - M1 defensive shape: require repo.fork === true, repo.source.full_name a string, repo.owner.login a string.
 *   - normalize(repo.source.full_name).toLowerCase() === upstreamRepo (LOWERCASE BOTH sides — upstream is
 *     normalized-lowercase, full_name is canonical-cased; a one-sided compare false-mismatches a legit mixed-case
 *     upstream and could false-match a case-variant squat).
 *   - repo.owner.login.toLowerCase() === expectedForkOwner (C1 — the ACTUAL fork owner from the API is the bot).
 * @param {object} repo  the parsed `repos/{fork}` 200 body
 * @param {string} upstreamRepo  the normalized-lowercase upstream owner/name
 * @param {string} expectedForkOwner  the expected bot login (custody value)
 */
function verifyForkRepo(repo, upstreamRepo, expectedForkOwner) {
  if (!repo || typeof repo !== 'object'
    || repo.fork !== true
    || !repo.source || typeof repo.source.full_name !== 'string'
    || !repo.owner || typeof repo.owner.login !== 'string') {
    emitEgressAlert('fork-shape-invalid', { fork: repo && repo.fork });
    throw new Error('ghEmit: fork-shape-invalid — the repos/{fork} body is not a well-formed fork (fork!==true / missing source.full_name / missing owner.login) — fail-closed');
  }
  if (String(repo.source.full_name).toLowerCase() !== upstreamRepo) {
    emitEgressAlert('fork-not-of-upstream', { source: String(repo.source.full_name).slice(0, 80) });
    throw new Error(`ghEmit: fork-not-of-upstream — the target's source ${JSON.stringify(String(repo.source.full_name).slice(0, 80))} is not the upstream — fail-closed`);
  }
  // M-1 (hacker VALIDATE): normalize BOTH sides — the API `owner.login` is canonical-cased (e.g. `LoomBot`), and
  // a custody expectedForkOwner may be canonical-cased too, so a verbatim compare would fail EVERY legit fork emit
  // (safe direction, but an opaque break). Lowercase both.
  if (repo.owner.login.toLowerCase() !== String(expectedForkOwner).toLowerCase()) {
    emitEgressAlert('fork-owner-mismatch', { owner: String(repo.owner.login).slice(0, 80) });
    throw new Error(`ghEmit: fork-owner-mismatch — the fork's actual owner ${JSON.stringify(String(repo.owner.login).slice(0, 80))} != expectedForkOwner — fail-closed`);
  }
}

// F-W4 M1 — request GitHub Actions be disabled on the ephemeral fork BEFORE ensureFork returns ready. A fork INHERITS
// the upstream's .github/workflows at POST /forks (SCAR #21 — the emitted-tree .github/ denial covers only loom's
// EMITTED tree, never the fork's inherited state). A fresh fork defaults Actions-DISABLED, but a REUSED fork (the
// steady-state path — one throwaway fork reused across emits) may have had them enabled, so we EXPLICITLY disable on
// BOTH ready paths. Kernel-constant {enabled:false} body — no actor bytes. DORMANT: reached only via ensureFork,
// itself gated on isForkMode (always false in production => this never fires in prod); M1 is OPTIONAL defense-in-depth
// since M0 set maintainer_can_modify=false.
// BEST-EFFORT on the SUCCESS path (hacker VALIDATE M-1): a non-throwing PUT is treated as disabled. GitHub's PUT
// returns 204 (no body), and a 2xx that did NOT actually disable (an org-policy override / eventual consistency) is
// NOT re-verified here. A hard read-back state-verify (GET .../actions/permissions, assert enabled===false) plus a
// re-check at the H2 rebind (M-2 TOCTOU) are NAMED F-W4 ARMING preconditions (see the plan), deferred while dormant —
// they must land BEFORE isForkMode can ever be true in production. On the FAIL path (the PUT throws non-2xx) we emit a
// SPECIFIC observable alert (security.md fail-silent rule) then re-throw, PRESERVING the underlying gh diagnostic
// fields (.httpStatus/.status/.cause — a public_repo-token 403 on this endpoint is the Q-M1-token-scope signal) — a
// fork whose disable REQUEST failed is exactly the hazard, so the emit must NEVER proceed to write to it.
function disableForkActions(gh, resolvedForkRepo, env) {
  try {
    gh(['api', `repos/${resolvedForkRepo}/actions/permissions`, '--method', 'PUT', '--input', '-'], { env, input: JSON.stringify({ enabled: false }) });
  } catch (err) {
    emitEgressAlert('fork-actions-disable-failed', { resolvedForkRepo: String(resolvedForkRepo).slice(0, 80), httpStatus: err && err.httpStatus, message: String(err && err.message).slice(0, 200) });
    const e = new Error(`ghEmit: fork-actions-disable-failed — the disable-Actions request failed on ${JSON.stringify(String(resolvedForkRepo).slice(0, 80))} — fail-closed (never write to a fork with Actions possibly enabled)`);
    e.cause = err;
    e.httpStatus = err && err.httpStatus;
    e.status = err && err.status;
    throw e;
  }
}

/**
 * Ensure the bot's fork of `upstreamRepo` exists at `resolvedForkRepo` and is verified as LOOM's fork BEFORE any
 * fork-side write. PURE of any tree/commit/ref write. Returns { ready: true } or throws (fail-closed).
 * NOTE (code-reviewer PRINCIPLE): ensureFork DELIBERATELY builds its own `repos/${...}` endpoint strings rather
 * than ghEmit's `forkApi`/`upstreamApi` closures — it is exported + independently unit-tested, so it cannot close
 * over ghEmit's locals. A documented exception to the single-hiding-point convention, not an oversight.
 * @param {{ upstreamRepo: string, resolvedForkRepo: string, forkOwner: string, expectedForkOwner: string }} o
 * @param {{ gh: Function, env: object, sleep?: Function }} deps  gh (mock in tests), sanitized env, injectable sleep
 * @returns {{ ready: true }}
 */
function ensureFork({ upstreamRepo, resolvedForkRepo, forkOwner, expectedForkOwner } = {}, { gh, env, sleep = sleepSync } = {}) {
  // C1 (CRITICAL) — expectedForkOwner is MANDATORY. Absent/empty => bind to nothing => an attacker's fork of
  // upstream would pass a bare "is a fork of upstream" test. Fail-closed + observable.
  if (typeof expectedForkOwner !== 'string' || expectedForkOwner.length === 0) {
    emitEgressAlert('fork-owner-required', { resolvedForkRepo: String(resolvedForkRepo).slice(0, 80) });
    throw new Error('ghEmit: fork-owner-required — ensureFork requires a non-empty expectedForkOwner (bind the write to LOOM identity) — fail-closed');
  }
  // C1 chain — the RESOLVED target owner must already equal the expected bot (validateForkIdentity asserts this
  // when expectedForkOwner is passed, but ensureFork re-asserts so a direct caller cannot bypass it). M-1:
  // lowercase the expected side (forkOwner is NORMALIZED_REPO_RE-lowercase; a canonical-cased custody value must
  // not fail-closed every legit emit).
  if (forkOwner !== String(expectedForkOwner).toLowerCase()) {
    emitEgressAlert('fork-owner-mismatch', { forkOwner: String(forkOwner).slice(0, 80) });
    throw new Error(`ghEmit: fork-owner-mismatch — resolved fork owner ${JSON.stringify(String(forkOwner).slice(0, 80))} != expectedForkOwner — fail-closed`);
  }

  // 1. Idempotency GET. A 404 => proceed to CREATE; any OTHER error => RE-THROW immediately (fail-closed, never
  //    create/keep-polling on an unknown error). A 200 => verify it is LOOM's fork of THIS upstream.
  let existing = null;
  try {
    existing = ghJson(gh, ['api', `repos/${resolvedForkRepo}`], { env });
  } catch (err) {
    if (!isNotFound(err)) throw err;   // 5xx/403/network/unparseable => fail-closed re-throw
    existing = null;
  }
  if (existing !== null) {
    verifyForkRepo(existing, upstreamRepo, expectedForkOwner);
    disableForkActions(gh, resolvedForkRepo, env);   // F-W4 M1 — disable inherited Actions before ready (REUSE path — the common case)
    return { ready: true };
  }

  // 2. CREATE (POST /forks — a kernel-constant envelope: NO input body, so no name/organization/
  //    default_branch_only actor bytes) + a bounded readiness poll. `POST /forks` is 202/async: the git objects
  //    may not be immediately available, so poll GET repos/{fork} with bounded exponential backoff.
  gh(['api', `repos/${upstreamRepo}/forks`, '--method', 'POST'], { env });
  for (let attempt = 1; attempt <= FORK_READINESS_MAX_ATTEMPTS; attempt += 1) {
    let repo = null;
    try {
      repo = ghJson(gh, ['api', `repos/${resolvedForkRepo}`], { env });
    } catch (err) {
      if (!isNotFound(err)) throw err;   // a non-404 error during the poll re-throws immediately (fail-closed)
      repo = null;
    }
    if (repo !== null) {
      verifyForkRepo(repo, upstreamRepo, expectedForkOwner);   // the SAME verify as the immediate-200 path
      disableForkActions(gh, resolvedForkRepo, env);   // F-W4 M1 — disable inherited Actions before ready (CREATE path)
      return { ready: true };
    }
    // still 404: sleep per the backoff then retry — but NO sleep after the last failed attempt.
    if (attempt < FORK_READINESS_MAX_ATTEMPTS) {
      sleep(Math.min(FORK_READINESS_BASE_MS * (2 ** (attempt - 1)), FORK_READINESS_MAX_MS));
    }
  }
  emitEgressAlert('fork-readiness-timeout', { resolvedForkRepo: String(resolvedForkRepo).slice(0, 80), attempts: FORK_READINESS_MAX_ATTEMPTS });
  throw new Error(`ghEmit: fork-readiness-timeout — ${resolvedForkRepo} not ready after ${FORK_READINESS_MAX_ATTEMPTS} attempts — fail-closed (never write to an unconfirmed fork)`);
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
 *   - parse + per-path re-validation: every stanza path is in the validated set AND not egress-denied; ADD
 *     post-images are pre-built (pure). MODIFY content is resolved in ghEmit (needs the base fetch).
 * @returns {{ repo: string, issueRef: number, stanzas: Array }}
 */
function validateEmitInputs({ draft, approvalHash, env }) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    emitEgressAlert('env-missing', { note: 'undefined env would inherit process.env (killswitch bypass)' });
    throw new Error('ghEmit: a sanitized env (from buildEmitEnv) is required — undefined inherits process.env');
  }
  // #405 VALIDATE-hacker M2 (defense-in-depth): an object env is necessary but not sufficient — it must be a
  // buildEmitEnv product. Refuse any key OUTSIDE buildEmitEnv's known output set (process.env carries dozens of
  // extra keys; a hand-rolled env carries the wrong ones) — so a refactor handing the ambient env (re-introducing
  // the dropped credentials) fails closed + observable, WITHOUT false-refusing buildEmitEnv's own hardening keys.
  for (const k of Object.keys(env)) {
    if (!SANITIZED_ENV_KEYS.has(k)) {
      emitEgressAlert('env-not-sanitized', { key: k });
      throw new Error(`ghEmit: env carries ${k} — not a buildEmitEnv-sanitized env (killswitch integrity); refusing`);
    }
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
  // L1 (two-parser drift): derive the validated set from the SAME upstream gate (parseDiffPaths) AND cross-check
  // every stanza path against it — the membership check below makes the two parsers agree or fail-closed.
  const validated = new Set(parseDiffPaths(diff).paths);
  // parseDiffStanzas stays PURE (standalone-testable); its attack-shaped rejects (path-divergence, rename/delete,
  // unsafe path char, count mismatch) are made OBSERVABLE here at the ghEmit boundary (CodeRabbit #402 invariant —
  // "fail-closed must be observable"). Re-throw unchanged (fail-closed).
  let parsed;
  try {
    parsed = parseDiffStanzas(diff);
  } catch (err) {
    emitEgressAlert('cannot-parse-diff', { message: err && err.message });
    throw err;
  }
  // per-stanza path re-validation + pre-build the ADD post-images NOW (pure, NO network) so a malformed / oversize
  // / overlapping ADD refuses with ZERO network calls. MODIFY stanzas defer content to ghEmit (needs the base fetch).
  const stanzas = parsed.map((st) => {
    if (!validated.has(st.pathB) || isEgressDeniedPath(st.pathB)) {
      emitEgressAlert('path-divergence-or-denied', { path: st.pathB });
      throw new Error(`ghEmit: stanza path not in the validated set / egress-denied: ${JSON.stringify(st.pathB)}`);
    }
    if (st.type === 'add') {
      let content;
      try {
        content = applyHunks('', st.hunks);
      } catch (err) {
        emitEgressAlert('cannot-apply-hunk', { path: st.pathB, message: err && err.message });
        throw err;
      }
      return { ...st, content };
    }
    return st;
  });
  // (no zero-stanza guard here — parseDiffStanzas already throws on an empty parse, and .map preserves length.)
  return { repo, issueRef, stanzas };
}

/**
 * Create a real DRAFT PR from the approved scrubbed draft via the gh REST git-data API. Called by emit-pr's
 * armedEmit ONLY after the gate passed. `env` already carries GH_TOKEN (buildEmitEnv) — the sole credential path.
 * F-W1 — `forkRepo` / `expectedForkOwner` are NEW top-level named args (NEVER read from `draft` — draft is
 * hash-bound, so a forkRepo in it would be an unsigned co-forgeable steering field, the C2 #273 trap). When
 * absent, resolvedForkRepo === upstreamRepo and forkOwner === upstreamOwner => byte-identical same-owner emit.
 * F-W2b — `requestedBaseSha` (the approver-INTENDED base commit, bound into the SIGNED approval basis + carried on
 * the verified body) is likewise a NAMED arg, NEVER read from `draft` (same co-forge trap). The moved-base gate
 * below refuses when the LIVE upstream base != this value; '' (the dormant default / omitted) skips => byte-identical.
 * @param {{ draft: object, approvalHash: string, env: object, forkRepo?: string, expectedForkOwner?: string, requestedBaseSha?: string }} args
 * @param {{ runGh?: Function }} [deps]  inject a mock gh for unit tests (the real network is never touched)
 * @returns {{ pr_url: string, number: number, branch: string, base_sha: string, deduped?: boolean }}
 *   base_sha (HEX, the resolved base commit sha) is additive on BOTH returns — the kernel egress
 *   join-key (item 1) seals it; existing callers ignore the extra field.
 */
function ghEmit({ draft, approvalHash, env, forkRepo, expectedForkOwner, requestedBaseSha } = {}, deps = {}) {
  const gh = deps.runGh || runGh;
  // 1. the REAL self-check (BEFORE any network): env guard + hash cross-check + parse + per-path validation. ADD
  //    post-images are pre-built here (pure); MODIFY content is resolved below (it needs the base fetch).
  const { repo: upstreamRepo, issueRef, stanzas } = validateEmitInputs({ draft, approvalHash, env });

  // 1a. F-W1 two-identity derivation (BEFORE any network). forkRepo/expectedForkOwner are read ONLY from the
  //     named args (never draft). Absent => resolvedForkRepo === upstreamRepo, forkOwner === upstreamOwner
  //     (byte-identical). The two local helpers are the SINGLE hiding-point for "which identity" (SRP — F-4):
  //     reads/dedup-endpoint/PR-base use upstreamApi; tree/commit/ref writes + rollback use forkApi.
  const { resolvedForkRepo, forkOwner } = validateForkIdentity({ upstreamRepo, forkRepo, expectedForkOwner });
  const upstreamApi = (s) => (s ? `repos/${upstreamRepo}/${s}` : `repos/${upstreamRepo}`);
  const forkApi = (s) => (s ? `repos/${resolvedForkRepo}/${s}` : `repos/${resolvedForkRepo}`);
  const isForkMode = resolvedForkRepo !== upstreamRepo;   // F-W2 gate: EVERY new fork-mode behavior below is gated on this => byte-identical same-owner.

  // 1b. F-W2 — ensure the bot's fork EXISTS and is verified as LOOM's fork BEFORE any fork-side write. Gated on
  //     fork mode: in the same-owner default resolvedForkRepo === upstreamRepo => ensureFork is NEVER called
  //     (zero /forks or fork-GET calls) => byte-identical. `sleep` is injectable (deps.sleep) for test speed.
  if (isForkMode) {
    ensureFork({ upstreamRepo, resolvedForkRepo, forkOwner, expectedForkOwner }, { gh, env, sleep: deps.sleep });
  }

  // 2. resolve + VALIDATE the base (default) branch — never actor-supplied; the API value rides into argv + a ref.
  const repoMeta = ghJson(gh, ['api', upstreamApi()], { env });
  const base = repoMeta && repoMeta.default_branch;
  if (typeof base !== 'string' || base.length === 0 || !SAFE_BRANCH.test(base) || base.includes('..') || base.includes(':')) {
    emitEgressAlert('default-branch-unsafe', { base: String(base).slice(0, 80) });
    throw new Error(`ghEmit: API default_branch is unsafe (${JSON.stringify(base)})`);
  }
  // D11 — the live base is resolved ONCE here and PINNED as a captured snapshot into every downstream fetch
  //       (contents?ref=, the base_tree) + the commit parent below. The moved-base gate + the frozen-sha reuse sit
  //       adjacent to this single resolution point (a future re-resolve-HEAD regression would be visible here).
  const refObj = ghJson(gh, ['api', upstreamApi(`git/ref/heads/${base}`)], { env });
  const baseCommitSha = refObj && refObj.object && refObj.object.sha;
  // D5 — the live base must be in the SHARED full-hex BASE_SHA_RE domain (40|64), so the moved-base `===` below
  //      compares both operands in one domain. GitHub returns a full 40-hex today (byte-identical on the real path);
  //      a non-full-hex live base fails LOUD (base-sha-malformed), never a silent false-reject.
  if (typeof baseCommitSha !== 'string' || !BASE_SHA_RE.test(baseCommitSha)) {
    throw new Error('ghEmit: could not resolve the base commit sha (base-sha-malformed — not full 40/64-hex)');
  }

  // F-W2b — MOVED-BASE INVALIDATION (fold D3/D4). requestedBaseSha (the approver-intended base, bound into the
  // SIGNED basis and carried on the verified approval body — a NAMED arg, NEVER read from `draft`, so it is
  // provenance-bound to the broker signature) must equal the LIVE upstream base. A non-empty mismatch => the
  // upstream advanced since approval => the approved hunks would rebuild the post-image against a tree the approver
  // never reviewed (#405). Fail CLOSED + observable, BEFORE any base-tree/contents fetch or write; re-approve
  // against the new base. Empty '' (the dormant default / omitted) skips (byte-identical). '' as-disable is the
  // standing same-uid co-forge residual (NARROWS, not closes — consistent with approval-store.js).
  const reqBaseSha = requestedBaseSha === undefined ? '' : requestedBaseSha;
  // VALIDATE fold (hacker LOW + code-reviewer PRINCIPLE) — fail LOUD at this CONSUMER boundary, symmetric with the
  // mint side (approvalSigBasis / recordApproval / broker-bind all THROW on a non-string). A null/0/false reqBaseSha
  // is falsy, so without this it would SILENTLY SKIP the moved-base gate (the unsafe direction) instead of refusing.
  // Unreachable on the live path today (verifyApproval yields '' or a valid lowercase hex), but this closes the
  // consumer/mint asymmetry BEFORE F-W3 arms auto-capture and a bug could feed a non-string (non-bypassable-guard).
  if (!isSafeBaseSha(reqBaseSha)) {
    emitEgressAlert('requested-base-malformed', { got: typeof reqBaseSha });
    throw new Error('ghEmit: requestedBaseSha must be a 40/64-hex sha or empty — fail-closed');
  }
  if (reqBaseSha && reqBaseSha !== baseCommitSha) {
    emitEgressAlert('moved-base', { requested: String(reqBaseSha).slice(0, 16), live: baseCommitSha.slice(0, 16) });
    throw new Error('ghEmit: upstream base moved since approval (requestedBaseSha != live base) — fail-closed');
  }
  const baseCommit = ghJson(gh, ['api', upstreamApi(`git/commits/${baseCommitSha}`)], { env });
  const baseTreeSha = baseCommit && baseCommit.tree && baseCommit.tree.sha;
  if (typeof baseTreeSha !== 'string') throw new Error('ghEmit: could not resolve the base tree sha');

  // 2a. for any MODIFY, resolve the base file MODES (#405 VALIDATE-hacker H2 + CodeRabbit Major): the contents
  //     API carries content but NOT the executable bit, so defaulting a modify to 100644 would silently FLIP a
  //     100755 base file's mode in the candidate PR. Read the base tree ONCE (recursive) for a path->mode map; a
  //     truncated tree (a huge repo) fails CLOSED — base-mode preservation can't be guaranteed, so don't guess.
  let baseModes = null;
  if (stanzas.some((s) => s.type === 'modify')) {
    const treeResp = ghJson(gh, ['api', upstreamApi(`git/trees/${baseTreeSha}?recursive=1`)], { env });
    if (!treeResp || treeResp.truncated === true || !Array.isArray(treeResp.tree)) {
      emitEgressAlert('base-tree-unavailable', { truncated: treeResp && treeResp.truncated });
      throw new Error('ghEmit: base tree truncated/unavailable — cannot resolve modify file modes (fail-closed)');
    }
    baseModes = new Map();
    for (const e of treeResp.tree) {
      if (e && e.type === 'blob' && typeof e.path === 'string') baseModes.set(e.path, e.mode);
    }
  }

  // 2b. build each emitted file's post-image. ADD => the pre-built content + the (allowlisted) declared mode;
  //     MODIFY => fetch the base content at the RESOLVED base commit (gh contents API, the SAME validated
  //     stanza.pathB), apply the approved hunks, and PRESERVE the base file's mode. A moved base / binary /
  //     >1MB base / a non-regular base mode => fail-CLOSED before any tree POST (zero bytes leave on a mismatch).
  const files = stanzas.map((st) => {
    if (st.type === 'add') return { path: st.pathB, mode: st.mode, content: st.content };
    const baseMode = baseModes.get(st.pathB);
    if (!ALLOWED_FILE_MODES.has(baseMode)) {
      // the base path isn't a regular file at HEAD (a symlink/gitlink/submodule, or absent) — don't modify-emit it.
      emitEgressAlert('base-mode-unsupported', { path: st.pathB, mode: baseMode });
      throw new Error(`ghEmit: base file ${JSON.stringify(st.pathB)} mode ${JSON.stringify(baseMode)} is not a regular file (100644/100755) — fail-closed`);
    }
    let enc;
    try {
      enc = ghJson(gh, ['api', upstreamApi(`contents/${st.pathB}?ref=${baseCommitSha}`)], { env });
    } catch (err) {
      emitEgressAlert('base-fetch-failed', { path: st.pathB, message: err && err.message });
      throw err;
    }
    if (!enc || enc.encoding !== 'base64' || typeof enc.content !== 'string') {
      // a file > 1MB returns encoding:'none' (the contents-API ceiling) — refuse (the Blobs/raw API is deferred).
      emitEgressAlert('base-content-unavailable', { path: st.pathB, encoding: enc && enc.encoding });
      throw new Error(`ghEmit: base content for ${JSON.stringify(st.pathB)} is not base64 (>1MB encoding:none / missing) — fail-closed`);
    }
    const buf = Buffer.from(enc.content, 'base64');
    if (buf.includes(0)) {
      emitEgressAlert('base-binary', { path: st.pathB });
      throw new Error(`ghEmit: base content for ${JSON.stringify(st.pathB)} is binary (NUL byte) — fail-closed`);
    }
    if (buf.length > MAX_BASE_BYTES) throw new Error(`ghEmit: base content for ${JSON.stringify(st.pathB)} exceeds MAX_BASE_BYTES — fail-closed`);
    let content;
    try {
      content = applyHunks(buf.toString('utf8'), st.hunks);
    } catch (err) {
      emitEgressAlert('cannot-apply-hunk', { path: st.pathB, message: err && err.message });
      throw err;
    }
    return { path: st.pathB, mode: baseMode, content };   // PRESERVE the base mode (no silent 755->644 flip)
  });

  // 3. tree (base_tree preserves unlisted files; inline content per entry — no separate blob POST). Defense-in-depth
  //    (#405 VALIDATE-hacker C1): re-assert EVERY emitted mode is a regular file (100644/100755) right before the
  //    bytes leave — a symlink/gitlink/tree mode must never ride into a maintainer's repo, even if a future parse
  //    path forgot to allowlist. (Adds are allowlisted at parse; modifies are 100644 — the +x-preservation residual
  //    is documented + deferred. A non-allowlisted mode here is a bug, so fail closed + observable.)
  for (const f of files) {
    if (!ALLOWED_FILE_MODES.has(f.mode)) {
      emitEgressAlert('emit-mode-not-allowed', { path: f.path, mode: f.mode });
      throw new Error(`ghEmit: refusing to emit ${JSON.stringify(f.path)} with non-regular-file mode ${f.mode} — fail-closed`);
    }
  }
  const treeBody = JSON.stringify({
    base_tree: baseTreeSha,
    tree: files.map((f) => ({ path: f.path, mode: f.mode, type: 'blob', content: f.content })),
  });
  // H2 TOCTOU re-bind (hacker H2 — fork mode ONLY => byte-identical same-owner). The fork verified at
  // readiness-200 in ensureFork is NAME-bound (GitHub has no CAS handle), and several upstream GETs intervene
  // between that verify and this first fork WRITE. Re-assert fork-of-upstream IMMEDIATELY before the tree POST so
  // a fork that was deleted+recreated-by-another-owner in the interim fails closed. RESIDUAL (stated honestly):
  // this is still name-bound, not handle-bound — a swap in the microsecond between this GET and the POST is
  // undetectable (no GitHub CAS primitive); this shrinks, not closes, the window.
  if (isForkMode) {
    let forkRebind = null;
    try {
      forkRebind = ghJson(gh, ['api', forkApi()], { env });
    } catch (err) {
      emitEgressAlert('fork-rebind-failed', { message: err && err.message });
      throw err;
    }
    verifyForkRepo(forkRebind, upstreamRepo, expectedForkOwner);
  }
  const tree = ghJson(gh, ['api', forkApi('git/trees'), '--method', 'POST', '--input', '-'], { env, input: treeBody });
  if (!tree || typeof tree.sha !== 'string') throw new Error('ghEmit: tree create returned no sha');

  // 4. commit (message is a kernel constant; the resolved base sha is bound in for attestability). WRITE => fork
  //    (the base tree/parent are the UPSTREAM's shared git objects — fork-object-sharing, an F-W2 live probe).
  const commitBody = JSON.stringify({ message: commitMessage(issueRef, approvalHash, baseCommitSha), tree: tree.sha, parents: [baseCommitSha] });
  const commit = ghJson(gh, ['api', forkApi('git/commits'), '--method', 'POST', '--input', '-'], { env, input: commitBody });
  if (!commit || typeof commit.sha !== 'string') throw new Error('ghEmit: commit create returned no sha');

  // 5. ref (RESERVE) on the FORK (H3 — the write target). The branch name is kernel-built from the validated
  //    integer + the hash — deterministic => the idempotency key. A 422 "already exists" => dedup-reconcile to
  //    the existing PR (no duplicate). The dedup GET endpoint is UPSTREAM (where the PR lives), head=forkOwner.
  const branch = `loom/issue-${issueRef}-${approvalHash.slice(0, 12)}`;
  const refBody = JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha });
  // H3 fork-tip assert (hacker H3 — fork mode ONLY => byte-identical same-owner). Re-read the FORK's branch tip
  // and require it === the commit we just created before laundering loom's envelope onto it. Name-bound (as H2).
  // A pre-existing fork branch whose tip is NOT our commit => `fork-branch-tip-mismatch` + fail-closed.
  const assertForkTip = () => {
    if (!isForkMode) return;
    let refObjFork = null;
    try {
      refObjFork = ghJson(gh, ['api', forkApi(`git/ref/heads/${branch}`)], { env });
    } catch (err) {
      emitEgressAlert('fork-branch-tip-mismatch', { reason: 'ref-read-failed', branch, message: err && err.message });
      throw new Error(`ghEmit: fork-branch-tip-mismatch — could not read the fork branch tip for ${JSON.stringify(branch)} — fail-closed`);
    }
    const tipSha = refObjFork && refObjFork.object && refObjFork.object.sha;
    if (typeof tipSha !== 'string' || tipSha !== commit.sha) {
      emitEgressAlert('fork-branch-tip-mismatch', { branch, got: String(tipSha).slice(0, 64) });
      throw new Error(`ghEmit: fork-branch-tip-mismatch — the fork branch ${JSON.stringify(branch)} tip is not our commit — fail-closed (never launder loom's envelope onto foreign fork content)`);
    }
  };
  let reserved = false;
  try {
    gh(['api', forkApi('git/refs'), '--method', 'POST', '--input', '-'], { env, input: refBody });
    reserved = true;
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
    // dedup-on-key: a 422 "already exists" => reconcile to the existing OPEN PR for THIS exact branch. The dedup
    // predicate is EXACT-SET (C-2 + CodeRabbit Major), not a subset .includes: ALL of head.ref === branch, the
    // HEAD repo is the resolved fork (head.repo.full_name === resolvedForkRepo — the dedup reconciles to a PR we
    // did NOT create, so its head must be OUR fork, not an upstream branch that coincidentally shares the name;
    // re-asserted here, not trusted solely from the `?head=` query filter), draft === true, base.repo.full_name
    // === upstreamRepo, AND base.ref === base. All lowercased (upstream/fork are normalized; full_name is
    // canonical-cased). A subset match is superset-tolerant / laundering-prone.
    const existing = ghJson(gh, ['api', upstreamApi(`pulls?head=${forkOwner}:${branch}&state=open`)], { env });
    const pr = Array.isArray(existing)
      ? existing.find((p) => p
        && p.head && p.head.ref === branch
        && p.head.repo && typeof p.head.repo.full_name === 'string'
        && p.head.repo.full_name.toLowerCase() === resolvedForkRepo
        && p.draft === true
        && p.base && p.base.repo && typeof p.base.repo.full_name === 'string'
        && p.base.repo.full_name.toLowerCase() === upstreamRepo
        && p.base.ref === base)
      : null;
    if (pr) {
      // NOTE (CodeRabbit Major) — NO tip-sha assert on the dedup path. A prior emit created this branch with a
      // DIFFERENT commit sha (GitHub fills the commit author/committer timestamp => the sha is non-deterministic
      // across re-emits), so asserting `existing tip === this-run's commit.sha` here would fail EVERY legitimate
      // 422 retry. The dedup predicate above already binds identity (head.repo === the resolved fork, head.ref ===
      // the approval-hash-derived branch, base.repo/base.ref === upstream, draft). The residual dedup-laundering
      // defense — a STABLE content identity (e.g. the existing head commit's kernel-constant message matching this
      // emit's approval-hash + base-commit) — is an F-W4 arming precondition (fork mode is dormant this wave, and
      // the laundering attack requires push to the bot's OWN fork, the same trust boundary as the whole operation).
      return { pr_url: pr.html_url, number: pr.number, branch, base_sha: baseCommitSha, deduped: true };
    }
    // VALIDATE-hacker MEDIUM (dedup laundering) — the ref EXISTS but no OPEN loom PR points at it. DO NOT auto-create
    // a PR on a pre-existing branch: an actor with push access could pre-create the (publicly-computable) loom branch
    // with arbitrary content, and a silent re-PR would brand attacker content with loom's approval envelope. Fail
    // CLOSED + observable so a genuine partial-prior-emit is operator-reconciled, never auto-laundered.
    emitEgressAlert('ref-exists-no-open-pr', { branch });
    throw new Error(`ghEmit: ref ${branch} exists but no open loom DRAFT PR points at it — refusing to auto-create on a pre-existing branch (operator must verify)`);
  }

  // 6. pull (draft:true is a HARD CONSTANT — never a parameter). The PR-create endpoint is provably UPSTREAM
  //    (H-1 structural pre-network bind: upstreamApi is derived from the validated upstreamRepo kernel value,
  //    NEVER from forkRepo). F-W1 keeps `head` the bare branch (same-owner PR); F-W3 flips it to
  //    `${forkOwner}:${branch}` once the fork exists. reserve->rollback ONLY if WE created the ref.
  try {
    // H3 (ref-CREATE path): immediately before the PR-create, re-read the fork tip === our commit (fork mode
    // only). WE just reserved the ref to commit.sha, but the H3 fold requires this assert on BOTH the ref-CREATE
    // and the 422-reconcile paths so a mid-flight fork-branch force-push between the reserve and the PR-open
    // fails closed rather than opening a PR onto foreign content.
    assertForkTip();
    // F-W3 — the CROSS-REPO PR-open. In fork mode the head is namespaced `${forkOwner}:${branch}` (forkOwner is the
    // SAME kernel value validateForkIdentity OWNER_RE-validated at the identity gate and ensureFork bound to
    // expectedForkOwner — it is an immutable const, so the interpolation sink needs no re-validation; the single
    // validated origin holds, exercised NON-VACUOUSLY by the OWNER_RE test + the F-W4 M4 structural pin), and
    // maintainer_can_modify:false is added (the hard kernel constant — F-W4 M0, no maintainer edit access). In
    // same-owner mode isForkMode is false => head stays bare `branch` and the key is absent (byte-identical).
    // SPREAD appends the fork-only key LAST, so the same-owner key order (and JSON bytes) is provably unchanged.
    const prBase = { title: prTitle(issueRef), head: isForkMode ? `${forkOwner}:${branch}` : branch, base, body: prBody(issueRef, approvalHash, baseCommitSha), draft: true };
    const prPayload = isForkMode ? { ...prBase, maintainer_can_modify: MAINTAINER_CAN_MODIFY } : prBase;
    const prBodyJson = JSON.stringify(prPayload);
    const pr = ghJson(gh, ['api', upstreamApi('pulls'), '--method', 'POST', '--input', '-'], { env, input: prBodyJson });
    // post-create backstop (C1 defense-in-depth half; F-2: NON-LOAD-BEARING in F-W1 — vacuous in same-owner,
    // scaffolding placed early so F-W3 inherits it). The PR-create endpoint is provably UPSTREAM (H-1 pre-network
    // structural bind), so the CREATED PR's base is already guaranteed to be the upstream. This backstop is a
    // detect-after-emit belt-and-suspenders:
    //   - PRESENT-but-MISMATCHED base.repo.full_name  => a real wrong-repo signal: alert + BEST-EFFORT close (may
    //     403 on an unowned repo — does NOT reverse the exfiltration; the real prevention is H-1) + throw.
    //   - ABSENT/malformed base.repo.full_name         => FAIL-SAFE, do NOT throw (VALIDATE-honesty F-1): the field
    //     is schema-guaranteed on a conformant GitHub 201 (rest-api-description: Repository.required includes
    //     full_name, pull-request.base.required includes repo — VALIDATE-hacker OpenAPI deref), so its absence is
    //     an API anomaly, NOT a wrong-repo attack. Since H-1 already guarantees the endpoint was upstream, a
    //     response-shape surprise must NOT regress the working same-owner emit. Alert (observable) + proceed.
    const prBaseFull = pr && pr.base && pr.base.repo && pr.base.repo.full_name;
    if (typeof prBaseFull === 'string' && prBaseFull.toLowerCase() !== upstreamRepo) {
      emitEgressAlert('pr-base-not-upstream', { got: prBaseFull.slice(0, 80), branch });
      try {
        gh(['api', upstreamApi(`pulls/${pr.number}`), '--method', 'PATCH', '--input', '-'], { env, input: JSON.stringify({ state: 'closed' }) });
      } catch { emitEgressAlert('pr-close-attempt-failed', { number: pr && pr.number, branch }); }
      throw new Error(`ghEmit: created PR base repo ${JSON.stringify(prBaseFull.slice(0, 80))} is not the upstream — fail-closed`);
    }
    if (typeof prBaseFull !== 'string') {
      // cannot verify the created PR's base repo (absent/malformed response field) — H-1 is the guarantee; the
      // backstop fails SAFE (alert + proceed) rather than regressing a working same-owner emit on a shape surprise.
      emitEgressAlert('pr-base-unverifiable', { note: 'base.repo.full_name absent/malformed in create response; H-1 structural bind is the guarantee', branch });
    }
    return { pr_url: pr.html_url, number: pr.number, branch, base_sha: baseCommitSha };
  } catch (err) {
    if (reserved) {
      // best-effort rollback of the orphan ref on the FORK (H3 — the ref was created on the fork) so a retry
      // isn't blocked; never throw over the original error.
      try { gh(['api', forkApi(`git/refs/heads/${branch}`), '--method', 'DELETE'], { env }); } catch { /* best-effort */ }
    }
    throw err;
  }
}

module.exports = { ghEmit, validateForkIdentity, ensureFork, verifyForkRepo, runGh, parseDiffStanzas, applyHunks, splitBaseLines, isAlreadyExists, isNotFound, prTitle, commitMessage, prBody };
