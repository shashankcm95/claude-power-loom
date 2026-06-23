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
const { computeEmissionHash } = require('./approval');
const { parseDiffPaths, isEgressDeniedPath, ENV_ALLOWLIST } = require('./emit-pr');

const HASH64 = /^[0-9a-f]{64}$/;
const SAFE_BRANCH = /^[A-Za-z0-9._/-]+$/;          // the API-resolved default_branch charset (rides into argv + a ref path)
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
 * @param {{ draft: object, approvalHash: string, env: object }} args
 * @param {{ runGh?: Function }} [deps]  inject a mock gh for unit tests (the real network is never touched)
 * @returns {{ pr_url: string, number: number, branch: string, deduped?: boolean }}
 */
function ghEmit({ draft, approvalHash, env } = {}, deps = {}) {
  const gh = deps.runGh || runGh;
  // 1. the REAL self-check (BEFORE any network): env guard + hash cross-check + parse + per-path validation. ADD
  //    post-images are pre-built here (pure); MODIFY content is resolved below (it needs the base fetch).
  const { repo, issueRef, stanzas } = validateEmitInputs({ draft, approvalHash, env });

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

  // 2a. for any MODIFY, resolve the base file MODES (#405 VALIDATE-hacker H2 + CodeRabbit Major): the contents
  //     API carries content but NOT the executable bit, so defaulting a modify to 100644 would silently FLIP a
  //     100755 base file's mode in the candidate PR. Read the base tree ONCE (recursive) for a path->mode map; a
  //     truncated tree (a huge repo) fails CLOSED — base-mode preservation can't be guaranteed, so don't guess.
  let baseModes = null;
  if (stanzas.some((s) => s.type === 'modify')) {
    const treeResp = ghJson(gh, ['api', `repos/${repo}/git/trees/${baseTreeSha}?recursive=1`], { env });
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
      enc = ghJson(gh, ['api', `repos/${repo}/contents/${st.pathB}?ref=${baseCommitSha}`], { env });
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
  const tree = ghJson(gh, ['api', `repos/${repo}/git/trees`, '--method', 'POST', '--input', '-'], { env, input: treeBody });
  if (!tree || typeof tree.sha !== 'string') throw new Error('ghEmit: tree create returned no sha');

  // 4. commit (message is a kernel constant; the resolved base sha is bound in for attestability).
  const commitBody = JSON.stringify({ message: commitMessage(issueRef, approvalHash, baseCommitSha), tree: tree.sha, parents: [baseCommitSha] });
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
    const prBodyJson = JSON.stringify({ title: prTitle(issueRef), head: branch, base, body: prBody(issueRef, approvalHash, baseCommitSha), draft: true });
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

module.exports = { ghEmit, runGh, parseDiffStanzas, applyHunks, splitBaseLines, isAlreadyExists, prTitle, commitMessage, prBody };
