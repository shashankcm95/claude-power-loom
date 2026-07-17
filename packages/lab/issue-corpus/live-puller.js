#!/usr/bin/env node

// @loom-layer: lab
//
// ③.2.2a — the READ-ONLY good-first-issue live puller. The bridge from the sealed 18-issue corpus to
// live, uncurated, real-world inputs: it searches GitHub for open good-first-issues, filters to repos
// that are PR-capable + permissively-licensed + the issue is unassigned, and maps each survivor to a
// PUBLIC-ONLY corpus record { id, repo, base_sha, problem_statement }. It CLONES nothing, SOLVES
// nothing, GRADES nothing, EMITS nothing (the stranger-code-execution risk lives in ③.2.2b). Trust-ZERO.
//
// THE UNTRUSTED-INPUT BOUNDARY: the whole GitHub response is attacker-influenceable (anyone can open an
// issue with a crafted title/body and name a repo arbitrarily). Two load-bearing controls:
//
//   (1) PER-ITEM validate-and-DROP (VERIFY H3): each candidate's full chain is wrapped per-item; a throw
//       DROPS that item and the loop continues. NEVER batch-validate (one crafted item must not zero the
//       whole pull).
//   (2) The owner/repo SLUG GUARD (VERIFY H1, CRITICAL): the puller's OWN `gh api repos/<owner>/<repo>`
//       enrichment call runs on a slug parsed from the untrusted `repository_url`. assertSafeRepo is a
//       FULL-URL guard that REJECTS a bare slug, and only runs at clone-time in ③.2.2b — so the slug needs
//       its own guard HERE. `gh api`'s endpoint is a single positional (probed: `gh api -- <ep>` errors),
//       so the control is: assertSafeOwnerRepo (charset excludes `?`/`..`/space/control + rejects a
//       leading `-`) -> a `repos/`-prefixed endpoint re-asserted to a fixed shape -> passed as ONE argv
//       element via execFileSync (no shell, no word-split). Read-only does NOT mean injection-free.
//
// The puller is ORCHESTRATOR-side and READ-only; it uses the ambient `gh` auth (it is NOT the egress
// path — the egress kernel builds its env from scratch). It produces a record that drives the ③.2.2b
// clone+actor half (repo/base_sha/problem_statement) but carries NO sealed oracle — a live OPEN issue
// has none — so it is NOT consumable by real-solve's makeBehavioralFn grade path; ③.2.2b owns the
// live-issue grading source (the behavioral leg degrades to BEHAVIORAL_UNAVAILABLE, already fail-closed).
//
// K12: imports node core + sibling lab modules (corpus, _clone-lifecycle) only; NO kernel/hooks, NO
// runtime. child_process is LAZY-required inside defaultGhRunner so an injected-runner unit test never
// spawns (the "no network in CI" property — EC2.1c).

'use strict';

const { validatePublicRecord } = require('./corpus');
const { assertSafeRepo, assertSafeSha } = require('./_clone-lifecycle');

// A live issue body can be large + attacker-authored; bound it before it ever rides into a ③.2.2b
// `claude -p` actor prompt. 64 KiB is far above any real good-first-issue description.
const MAX_PROBLEM_BYTES = 64 * 1024;

// The permissive-license allowlist (exact-set membership, NOT a substring/.includes test — which would
// mis-accept `Apache-2.0 AND GPL-3.0` or `MIT-but-actually-GPL`). A null/NOASSERTION/unknown license is
// INELIGIBLE (fail-closed: absence of a known-permissive license is a reject, never a default-allow).
const LICENSE_ALLOWLIST = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'Unlicense']);

// owner: GitHub caps at 39 chars; repo: 100 is generous. Single `/` separator; the segment charset is
// GitHub-legal AND shell/path-safe ([A-Za-z0-9_.-] only — no `/`, `..`-traversal char beyond the literal
// dot, no `?`, no whitespace, no control). The leading-`-` + dot-only-segment rejects are below.
const OWNER_REPO_RE = /^[A-Za-z0-9_.-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/;
// The constructed gh-api endpoint shape (the belt-and-suspenders re-assertion right before the call).
// The optional suffix is a CLOSED set: `/commits/HEAD` (base_sha), `/issues/<digits>` (a single-issue
// fetch), or `/pulls` (the intake acceptance signal — a TERMINAL literal, no id/sub-resource, so the
// write forms `/pulls/N/merge` [PUT] + `/pulls/N/reviews` cannot pass; query params ride as `-f` GET, never
// in the path). `[0-9]{1,15}` is digit-only + anchored (no `..`/`/`/traversal) AND length-capped below
// 2^53's 16 digits, so the regex is a true re-assertion of — never weaker than — the caller's own
// positive-safe-integer validation of the number before it reaches the path.
const ENDPOINT_RE = /^repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/commits\/HEAD|\/issues\/[0-9]{1,15}|\/pulls)?$/;
// A caller-supplied search term (label/language) is OUR config, not attacker data — but guard it anyway
// so it cannot break the `q=` string (no quotes/newlines/control).
const SEARCH_TERM_RE = /^[A-Za-z0-9 _.-]{1,60}$/;

// ── PURE: the owner/repo slug guard (VERIFY H1) ──
// Returns { owner, repo } for a safe slug; THROWS (value-redacted) otherwise. Every message contains
// "slug" so a per-item drop reason is greppable. This is the puller's OWN guard — assertSafeRepo (a
// full-URL guard) does NOT cover a bare slug.
function assertSafeOwnerRepo(slug) {
  if (typeof slug !== 'string' || slug.length === 0) throw new Error('owner/repo slug: required non-empty string');
  if (!OWNER_REPO_RE.test(slug)) throw new Error('owner/repo slug: must match <owner>/<repo> over [A-Za-z0-9_.-] (value redacted)');
  const [owner, repo] = slug.split('/');
  if (owner.startsWith('-') || repo.startsWith('-')) throw new Error('owner/repo slug: a segment may not start with "-" (arg-injection; value redacted)');
  if (/^\.+$/.test(owner) || /^\.+$/.test(repo)) throw new Error('owner/repo slug: a "."-only segment is rejected (traversal; value redacted)');
  return { owner, repo };
}

// ── PURE: extract a guarded slug from the untrusted repository_url ──
// Host-check via WHATWG URL (parser-differential safe), then capture the slug from the RAW remainder so
// a `repos/../../x` traversal reaches assertSafeOwnerRepo rather than being normalized away by `new URL`.
const REPO_URL_RE = /^https:\/\/(?:api\.)?github\.com\/repos\/(.+)$/;
function parseRepoSlug(repositoryUrl) {
  if (typeof repositoryUrl !== 'string' || repositoryUrl.length === 0) throw new Error('repository_url: required non-empty string (slug source)');
  let u;
  try { u = new URL(repositoryUrl); } catch { throw new Error('repository_url: not a parseable URL (slug)'); }
  if (u.hostname !== 'api.github.com' && u.hostname !== 'github.com') throw new Error('repository_url: host not (api.)github.com (slug rejected)');
  const m = REPO_URL_RE.exec(repositoryUrl);
  if (!m) throw new Error('repository_url: not a /repos/<owner>/<repo> slug path');
  const { owner, repo } = assertSafeOwnerRepo(m[1].replace(/\/+$/, ''));
  return `${owner}/${repo}`;
}

// ── PURE: the eligibility predicates ──
function isLicenseCompatible(spdxId) {
  return typeof spdxId === 'string' && LICENSE_ALLOWLIST.has(spdxId);
}
// Strict-boolean equality so a MISSING field (undefined) fails closed (not PR-capable).
function isPrCapable(meta) {
  return !!meta && meta.archived === false && meta.disabled === false
    && meta.allow_forking === true && meta.is_template === false;
}
function isUnassigned(item) {
  if (!item || typeof item !== 'object') return false;
  const hasAssignees = Array.isArray(item.assignees) && item.assignees.length > 0;
  const hasAssignee = item.assignee !== null && item.assignee !== undefined;
  return !hasAssignees && !hasAssignee;
}

// Strip C0/DEL control chars except \t (0x09) and \n (0x0a). Char-code filter (NOT a control-char regex
// literal — ADR-0006 forbids eslint-disable, and `no-control-regex` flags a control char in a pattern):
// keep tab, newline, and every code point >= 0x20 except DEL (0x7f). High code units (>= 0x80, incl
// multibyte halves) are non-control and preserved.
function stripControlChars(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code === 9 || code === 10 || (code >= 32 && code !== 127)) out += s[i];
  }
  return out;
}

// ── PURE: bound the untrusted problem statement (VERIFY M1) ──
// Compose title + body, TRUNCATE to MAX_PROBLEM_BYTES (byte-safe) FIRST (so the strip below does bounded
// work), then STRIP control chars (so a NUL/ANSI/BEL payload cannot corrupt a log/terminal or a
// downstream prompt). An empty title+body yields '' — the caller's validatePublicRecord drops it
// (non-empty required).
function boundProblemStatement(title, body) {
  const t = typeof title === 'string' ? title : '';
  const b = typeof body === 'string' ? body : '';
  let s = b ? `${t}\n\n${b}` : t;
  if (Buffer.byteLength(s, 'utf8') > MAX_PROBLEM_BYTES) {
    s = Buffer.from(s, 'utf8').subarray(0, MAX_PROBLEM_BYTES).toString('utf8');
    // A multibyte char straddling the byte cut decodes to U+FFFD (3 bytes), which can push the
    // re-encoded string up to 2 bytes OVER the cap (VALIDATE F1). Trim backward to a valid <= cap
    // boundary (at most a couple of iterations — only the trailing replacement char).
    while (Buffer.byteLength(s, 'utf8') > MAX_PROBLEM_BYTES) s = s.slice(0, -1);
  }
  return stripControlChars(s);
}

// ── PURE: build the public record (canonical github.com URL, never the raw repository_url) ──
function buildPublicRecord({ owner, repo, number, title, body, base_sha } = {}) {
  if (!Number.isInteger(number) || number <= 0) throw new Error('issue number: must be a positive integer');
  const { owner: o, repo: r } = assertSafeOwnerRepo(`${owner}/${repo}`); // re-guard (defense-in-depth)
  return {
    id: `${o}__${r}-issue-${number}`,
    repo: `https://github.com/${o}/${r}`, // CONSTRUCTED — never the attacker-supplied repository_url/html_url
    base_sha,
    problem_statement: boundProblemStatement(title, body),
  };
}

// ── IO seam: the gh runner (lazy child_process; injectable for tests) ──
// THE READ-ONLY GET-GATE (VALIDATE-hacker re-probe of #390, the bounded positive invariant): the puller
// must NEVER mutate anything via its write-capable ambient `gh` auth. Rather than the egress chokepoint
// lint enumerating gh's effectively-unbounded write surface (the syntactic-gate-extension anti-pattern —
// it would forever miss `gh api -f` AUTO-POST, glued `-XPOST`, `gh release/issue create`, shell-string
// push), the puller pins a POSITIVE invariant: every spawn is `gh api` with an EXPLICIT `-X GET`, no
// write verb. `gh` auto-switches to POST when `-f`/`-F` data fields are present and no `-X` is set, so
// the explicit `-X GET` is load-bearing (it forces GET even with `-f` query params). defaultGhRunner
// enforces this before any subprocess runs, so the puller is GET-only BY CONSTRUCTION; the egress lint
// then merely verifies the gate EXISTS, not that it caught every write-form.
function assertReadOnlyGhArgs(args) {
  if (!Array.isArray(args) || String(args[0]) !== 'api') throw new Error('gh-readonly: only `gh api` reads are permitted');
  let getPinned = false;
  for (let i = 0; i < args.length; i++) {
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
function defaultGhRunner(args, { timeout = 30000, maxBuffer = 8 * 1024 * 1024 } = {}) {
  assertReadOnlyGhArgs(args);                          // GET-only by construction — refuse any write before spawn
  const { execFileSync } = require('child_process');   // lazy — an injected runner never loads this
  return execFileSync('gh', args, { encoding: 'utf8', timeout, maxBuffer, stdio: ['ignore', 'pipe', 'pipe'] });
}
// F1/F2 (fetch-stage resilience) — classify a failed `gh` call into three kinds so a brief blip is retried,
// a rate-limit is retried-LATER (never hammered), and a real error drops. Grounded firsthand: `gh` exits
// non-zero and writes its status as `gh: HTTP <code>` on stderr; GitHub's OWN rate-limit is a 403 ("API rate
// limit exceeded" / "secondary rate limit") or a 429 — NOT a 5xx. The classifier reads ONLY the status/kind
// off the raw error and NEVER surfaces that raw text (it can echo ambient-token context — the redaction
// invariant); the caller rethrows a value-free, KIND-differentiated reason so an orchestrator/cron backs off.
//
//   'transient'    5xx / network blip        -> retried in-puller (short exponential backoff)
//   'rate-limited' 403-ratelimit / 429       -> NOT retried in-puller (a short retry escalates the secondary
//                                               limit / self-DoSes the token); tagged retry-later so the
//                                               CALLER (the F3 cron) does the long, Retry-After-aware backoff.
//   'terminal'     404 / auth 401/403 / else -> never retried.
const TRANSIENT_NET_RE = /\b(?:ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|socket hang up)\b/;
const RATELIMIT_TEXT_RE = /\b(?:rate limit|secondary rate limit|abuse detection)\b/i;
// gh's OWN status token (`gh: HTTP <code>`), with a positional fallback to the FIRST HTTP token (gh writes
// its status before any echoed body). Anchored so a terminal error whose JSON body merely CONTAINS an
// "HTTP 5xx" substring is not mis-read as transient — a body substring never carries the `gh:` prefix.
function ghHttpStatus(s) {
  const m = s.match(/\bgh:\s*HTTP\s+(\d{3})\b/) || s.match(/\bHTTP\s+(\d{3})\b/);
  return m ? Number(m[1]) : null;
}
function classifyGhError(e) {
  const s = `${(e && e.stderr) || ''} ${(e && e.message) || ''}`;
  const status = ghHttpStatus(s);
  if (status !== null) {
    if (status >= 500) return 'transient';
    if (status === 429) return 'rate-limited';
    if (status === 403 && RATELIMIT_TEXT_RE.test(s)) return 'rate-limited';
    return 'terminal';                                         // 404 / 401 / 403-auth / any other 4xx
  }
  return TRANSIENT_NET_RE.test(s) ? 'transient' : 'terminal';  // no HTTP status => a spawn / network failure
}
// Back-compat predicate (also the unit surface): true ONLY for the in-puller-retryable 'transient' class.
function isTransientGhError(e) { return classifyGhError(e) === 'transient'; }
// A blocking backoff between retries — Atomics.wait, never a busy-wait (the puller is synchronous by
// design). A non-positive delay is a no-op (tests inject backoffMs:0 to stay fast).
function sleepSync(ms) {
  if (!(ms > 0)) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
// Run `fn` with a BOUNDED retry on a 'transient' failure ONLY. A 'rate-limited' or 'terminal' failure is NOT
// retried in-puller — rate-limited fails fast tagged retry-later so the caller does the long backoff (never
// hammering the cooldown). retries/backoffMs are CLAMPED and each sleep is capped, so a NaN/huge value can
// never spin the loop forever or block Atomics.wait indefinitely (a latent hazard once a caller wires them).
function retryTransient(fn, { retries = 2, backoffMs = 500 } = {}) {
  const maxRetries = Number.isInteger(retries) && retries >= 0 ? Math.min(retries, 10) : 2;
  const base = Number.isFinite(backoffMs) && backoffMs >= 0 ? Math.min(backoffMs, 30000) : 500;
  for (let attempt = 0; ; attempt++) {
    try { return fn(); }
    catch (e) {
      const kind = classifyGhError(e);
      if (kind !== 'transient' || attempt >= maxRetries) {
        const err = new Error('gh: request-failed');
        err.kind = kind;                                                 // 'transient' | 'rate-limited' | 'terminal'
        err.transient = kind === 'transient' || kind === 'rate-limited'; // "retry later" (either non-terminal class)
        throw err;
      }
      sleepSync(Math.min(base * (2 ** attempt), 30000));
    }
  }
}
function ghJson(ghRunner, args, retryOpts) {
  const out = retryTransient(() => ghRunner(args), retryOpts);
  try { return JSON.parse(out); } catch { throw new Error('gh: non-JSON response'); }
}
// The constructed endpoint is re-asserted to a fixed shape before it becomes a single argv positional.
function ghApiEndpoint(owner, repo, suffix = '') {
  const ep = `repos/${owner}/${repo}${suffix}`;
  if (!ENDPOINT_RE.test(ep)) throw new Error('gh-endpoint: constructed endpoint failed the shape re-assertion');
  return ep;
}
// A read-only `gh api` GET for a repos endpoint — the explicit `-X GET` is the load-bearing pin.
function ghApiReadArgs(owner, repo, suffix = '') {
  return ['api', '-X', 'GET', ghApiEndpoint(owner, repo, suffix)];
}
// A read-only GET for a repo's CLOSED pull requests (the intake acceptance signal). state/per_page/sort
// ride as `-f` GET query params — the explicit `-X GET` keeps them a GET (never gh's auto-POST) and the
// endpoint is the `/pulls` literal re-asserted by ghApiEndpoint (no id/sub-resource, so no write path).
function ghApiClosedPullsArgs(owner, repo, perPage = 30) {
  const n = Number.isInteger(perPage) && perPage > 0 && perPage <= 100 ? perPage : 30;
  return ['api', '-X', 'GET', ghApiEndpoint(owner, repo, '/pulls'),
    '-f', 'state=closed', '-f', `per_page=${n}`, '-f', 'sort=updated', '-f', 'direction=desc'];
}

// A merged PR by one of these author associations does NOT prove the repo accepts OUTSIDER PRs (an owner /
// org member / added collaborator is an insider). Everyone else — CONTRIBUTOR, FIRST_TIME_CONTRIBUTOR, an
// unknown string — is an outsider whose merged PR proves the repo takes external contributions.
const PR_INSIDER_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

// Intake PR-acceptance signal (Gap 7 / Part A): has this repo ever MERGED a PR from a non-insider? A repo
// that restricts PR creation to collaborators (e.g. schmug/colophon) never can, so its apex-merge signal is
// structurally unreachable and it is not worth an autonomous solve. READ-ONLY (the GET-pinned /pulls list).
// TRI-STATE so a transient error is NOT read as a structural block (hacker VALIDATE MEDIUM):
//   true  — a merged PR from a non-insider was found;
//   false — a VALID read showed NONE (a confirmed "never merged an external PR");
//   null  — could NOT assess (network / rate-limit / non-JSON / a non-array/malformed body).
// Callers act ONLY on an explicit `false` (drop / warn); `null` (unknown) triggers nothing — a flaky /pulls
// read must never drop a good candidate or emit a false "no-external-merge" reason. The whole body is still
// wrapped so no crafted response throws out. A merge counts as external only when author_association is a
// STRING not in the insider set: a non-string (a crafted object/array/number) is skipped, never KEEP-forcing
// (hacker VERIFY); an unknown STRING counts as external (lenient — a false-KEEP is only a wasted solve,
// which the FUTURE submit-time Part-B fail-fast will recover; a false-DROP would silently lose a good
// candidate). Inspects the most-recent `perPage` closed PRs (deeper pagination is a deferred follow-up — a
// repo whose sole external merge is older than the page reads false).
function hasExternalMergeHistory(owner, repo, ghRunner = defaultGhRunner, { perPage = 30 } = {}) {
  try {
    const pulls = ghJson(ghRunner, ghApiClosedPullsArgs(owner, repo, perPage));
    if (!Array.isArray(pulls)) return null; // malformed body — unknown, not a confirmed "no external merge"
    return pulls.some((pr) => pr && typeof pr === 'object' && pr.merged_at
      && typeof pr.author_association === 'string' && !PR_INSIDER_ASSOCIATIONS.has(pr.author_association));
  } catch {
    return null; // could not assess — transient (network / rate-limit / non-JSON); NOT a structural block
  }
}
function assertSearchTerm(v, name) {
  if (typeof v !== 'string' || !SEARCH_TERM_RE.test(v)) throw new Error(`${name}: must match [A-Za-z0-9 _.-]{1,60}`);
}
function buildSearchArgs({ label, language, limit }) {
  const q = `label:"${label}" language:${language} state:open type:issue`;
  return ['api', '-X', 'GET', 'search/issues', '-f', `q=${q}`, '-f', `per_page=${limit}`, '-f', 'sort=created', '-f', 'order=desc'];
}

/**
 * Pull a filtered, read-only set of live good-first-issues as PUBLIC corpus records.
 * @param {object}   [opts]
 * @param {(args:string[])=>string} [opts.ghRunner]  injectable gh runner (default: defaultGhRunner). The
 *                                  unit suite injects a mock so the full pull runs with NO network.
 * @param {number}   [opts.limit]          per-window candidate cap [1,100] (default 30).
 * @param {string[]} [opts.licenseAllowlist] override the permissive SPDX allowlist (default LICENSE_ALLOWLIST).
 * @param {string}   [opts.label]          the issue label (default 'good first issue').
 * @param {string}   [opts.language]       the repo language (default 'python').
 * @param {(e:object)=>void} [opts.logger] optional drop/observe logger.
 * @param {boolean} [opts.dropOnNoExternalMerge] SHADOW arm (default false): when true, drop a repo the intake
 *                                  guard CONFIRMS has never merged an external-contributor PR. Default OFF =
 *                                  the guard is not invoked (no extra /pulls call, no behavior change).
 * @returns {Promise<{records: object[], stats: {searched, eligible, dropped, dropReasons}}>}
 */
async function pullLiveCorpus({
  ghRunner = defaultGhRunner, limit = 30, licenseAllowlist,
  label = 'good first issue', language = 'python', logger, dropOnNoExternalMerge = false,
} = {}) {
  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) throw new Error('limit: must be an integer in [1,100]');
  assertSearchTerm(label, 'label');
  assertSearchTerm(language, 'language');
  const licOk = Array.isArray(licenseAllowlist)
    ? ((set) => (spdx) => typeof spdx === 'string' && set.has(spdx))(new Set(licenseAllowlist))
    : isLicenseCompatible;

  const searchResp = ghJson(ghRunner, buildSearchArgs({ label, language, limit }));
  const items = Array.isArray(searchResp && searchResp.items) ? searchResp.items : [];

  const records = [];
  const dropReasons = [];
  let dropped = 0;
  for (const item of items.slice(0, limit)) {
    try {
      // (1) guard the slug from the untrusted repository_url BEFORE any gh-api call uses it.
      const { owner, repo } = assertSafeOwnerRepo(parseRepoSlug(item && item.repository_url));
      // (2) cheap rejects first (no gh call): an assigned issue is not an unsolicited-PR candidate.
      if (!isUnassigned(item)) throw new Error('drop: issue is assigned');
      // (3) enrich (the guarded, shape-re-asserted endpoint, GET-pinned, as a single argv positional).
      const meta = ghJson(ghRunner, ghApiReadArgs(owner, repo));
      if (!isPrCapable(meta)) throw new Error('drop: repo not PR-capable');
      if (!licOk(meta && meta.license && meta.license.spdx_id)) throw new Error('drop: license not compatible');
      // (3b) intake acceptance (Gap 7 / Part A) — SHADOW-gated OFF by default: the guard (an extra /pulls GET)
      // fires ONLY when armed. Drop ONLY on an explicit `false` (a CONFIRMED "never merged an external PR" —
      // the colophon shape, whose apex-merge signal is structurally unreachable); a `null` (couldn't assess —
      // a transient /pulls error) keeps the candidate, so a network blip never silently loses a good repo.
      // Runs AFTER the cheap metadata guards so the extra read only hits otherwise-eligible repos.
      if (dropOnNoExternalMerge && hasExternalMergeHistory(owner, repo, ghRunner) === false) {
        throw new Error('drop: no external PR ever merged');
      }
      // (4) resolve base_sha — the gh `.sha` field is untrusted; assertSafeSha drops a non-40-hex/missing.
      const shaResp = ghJson(ghRunner, ghApiReadArgs(owner, repo, '/commits/HEAD'));
      const base_sha = assertSafeSha(shaResp && shaResp.sha);
      // (5) build + round-trip the canonical URL through assertSafeRepo (F2) + validate the public shape.
      const record = buildPublicRecord({ owner, repo, number: item.number, title: item.title, body: item.body, base_sha });
      assertSafeRepo(record.repo);
      validatePublicRecord(record);
      records.push(record);
    } catch (err) {
      dropped++;
      const reason = (err && err.message) || 'drop';
      dropReasons.push(reason);
      if (typeof logger === 'function') logger({ level: 'drop', reason });
    }
  }
  return { records, stats: { searched: items.length, eligible: records.length, dropped, dropReasons } };
}

/**
 * Fetch ONE explicitly-targeted open issue as a PUBLIC-ONLY record — the single-item analog of
 * pullLiveCorpus (SAME guard sequence, no search). `owner`/`repo`/`number` are operator-supplied; the
 * slug is still guarded and the number validated BEFORE any gh call. HARD-refuses a non-PR-capable or
 * non-permissive-license repo (safety gates: never autonomously solve where we cannot / should not open a
 * PR) and a PR-number (the issues endpoint returns PRs too). Does NOT enforce isUnassigned — assignment is
 * a candidate-discovery filter, not a safety property, and the operator has already made the targeting
 * call. Read-only + trust-ZERO: title/body from the response are control-stripped + byte-bounded ONLY
 * inside buildPublicRecord; gh errors are rethrown TYPED + value-redacted (the raw execFileSync stderr can
 * carry ambient-token context). The caller (CLI) converts a throw into a clean non-zero exit.
 * @param {object} opts
 * @param {string} opts.owner
 * @param {string} opts.repo
 * @param {number} opts.number  a positive safe-integer issue number
 * @param {(args:string[])=>string} [opts.ghRunner]  injectable gh runner (default defaultGhRunner)
 * @param {(e:object)=>void} [opts.logger]  optional advisory sink. When provided, the intake guard runs and,
 *                                  on a CONFIRMED no-external-merge repo, emits {level:'warn',reason,repo} —
 *                                  a WARN only, never a drop; the call is fail-soft. Absent = guard not invoked.
 * @returns {object} the PUBLIC record { id, repo, base_sha, problem_statement }
 */
function fetchOneIssueRecord({ owner, repo, number, ghRunner = defaultGhRunner, logger, retryOpts } = {}) {
  // (1) slug guard FIRST, on the rejoined caller string; use the returned {owner,repo} EXCLUSIVELY
  // downstream (architect HIGH — never re-split, never trust the raw args past this point).
  const { owner: o, repo: r } = assertSafeOwnerRepo(`${owner}/${repo}`);
  // (2) validate the number BEFORE it reaches the endpoint path (the ENDPOINT_RE [0-9]{1,15} is the belt;
  // this is the suspenders). Non-positive / float / oversized is refused here.
  if (!Number.isInteger(number) || number <= 0 || number > Number.MAX_SAFE_INTEGER) {
    throw new Error(`fetchOneIssueRecord: issue number must be a positive safe integer (got ${JSON.stringify(number)})`);
  }
  // a redacting GET: route through ghApiReadArgs (the -X GET pin + ENDPOINT_RE re-assertion) and NEVER
  // surface the raw gh stderr (it can echo ambient-token context) — rethrow a typed, value-free reason.
  const get = (suffix, cls) => {
    try { return ghJson(ghRunner, ghApiReadArgs(o, r, suffix), retryOpts); }
    catch (e) {
      // F2: value-free BUT KIND-differentiated (raw gh stderr never surfaces — only the classified kind).
      // 'transient' = brief retry-later; 'rate-limited' = retry after the cooldown (the caller/cron owns the
      // long, Retry-After-aware backoff); else terminal (not-found / auth).
      const k = (e && e.kind) || (e && e.transient ? 'transient' : 'terminal');
      const label = k === 'transient' ? 'transient - retry later'
        : k === 'rate-limited' ? 'rate-limited - retry after cooldown'
          : 'terminal - not-found / auth';
      throw new Error(`fetchOneIssueRecord: ${cls} for ${o}/${r}${suffix} failed (${label})`);
    }
  };
  // (3) the issue (title + body). Refuse a PR-number: the REST issues endpoint returns pull requests too
  // (they carry a `pull_request` field) and solving a PR-as-issue is nonsensical.
  const issue = get(`/issues/${number}`, 'issue-fetch');
  if (issue && issue.pull_request) throw new Error(`fetchOneIssueRecord: ${o}/${r}#${number} is a pull request, not an issue`);
  // (4) SAFETY gates (hard-refuse, reused BY IMPORT so the fail-closed / exact-set semantics can't drift).
  const meta = get('', 'repo-meta');
  if (!isPrCapable(meta)) throw new Error(`fetchOneIssueRecord: refuse — ${o}/${r} is not PR-capable (archived / disabled / forks-off)`);
  if (!isLicenseCompatible(meta && meta.license && meta.license.spdx_id)) {
    throw new Error(`fetchOneIssueRecord: refuse — ${o}/${r} license is not in the permissive allowlist`);
  }
  // (4b) intake acceptance ADVISORY (Gap 7 / Part A) — opt-in via `logger` (the guard, an extra /pulls GET,
  // fires ONLY when a logger is provided). The operator explicitly targeted this issue, so this WARNS, never
  // drops: a repo that has never merged an external PR may block ours (the colophon shape). Warns ONLY on an
  // explicit `false` (not on a `null` couldn't-assess). The logger call is fail-soft: an advisory logging
  // side-effect must NEVER abort an otherwise-valid fetch (VALIDATE MEDIUM). Record unchanged.
  if (typeof logger === 'function' && hasExternalMergeHistory(o, r, ghRunner) === false) {
    try { logger({ level: 'warn', reason: 'no-external-merge-history', repo: `${o}/${r}` }); }
    catch { /* swallow — the record is valid; a broken logger must not convert a warn into a hard failure */ }
  }
  // (5) base_sha — the gh `.sha` is untrusted; assertSafeSha rejects a non-40-hex / missing. (Pinned at
  // fetch time: the draft clones this exact sha; upstream HEAD may advance — a Part-B/emit staleness
  // concern, inert in SHADOW.)
  const shaResp = get('/commits/HEAD', 'sha-fetch');
  const base_sha = assertSafeSha(shaResp && shaResp.sha);
  // (6) build + round-trip through the canonical-URL guard + the public-shape validator. Returns EXACTLY
  // the 4 PUBLIC_FIELDS; `id` is end-anchored `-issue-N` (a repo literally named `*-issue-*` is safe —
  // parseRecordRef extracts from the END).
  const record = buildPublicRecord({ owner: o, repo: r, number, title: issue && issue.title, body: issue && issue.body, base_sha });
  assertSafeRepo(record.repo);
  validatePublicRecord(record);
  return record;
}

module.exports = {
  assertSafeOwnerRepo, parseRepoSlug, isLicenseCompatible, isPrCapable, isUnassigned,
  boundProblemStatement, buildPublicRecord, pullLiveCorpus, fetchOneIssueRecord,
  defaultGhRunner, assertReadOnlyGhArgs, ghApiEndpoint, ghApiReadArgs, buildSearchArgs,
  ghApiClosedPullsArgs, hasExternalMergeHistory,
  isTransientGhError, classifyGhError, retryTransient,
  MAX_PROBLEM_BYTES, LICENSE_ALLOWLIST,
};
