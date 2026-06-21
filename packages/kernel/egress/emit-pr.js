'use strict';

// @loom-layer: kernel
//
// ③.2.1b — the PR-egress kernel: the SINGLE in-process `emitPR` chokepoint that is the SOLE holder of
// the GitHub token and the SOLE place the network is (eventually) touched. The gate is ARCHITECTURAL,
// not a hook — a `PreToolUse:Bash` hook on `gh`/`git push` is advisory/evadable (ADR-0012; the lesson
// `network-egress-audit.js` already encodes as "DETECT + advise, never block"). So the killswitch
// REMOVES the emission CAPABILITY rather than intercepting a command.
//
// THE LOAD-BEARING DESIGN (VERIFY board, 2 CRITICAL folded):
//   1. ENV-SANITIZATION IS THE KILLSWITCH. "No token in my custody path" is NOT capability-removal —
//      `gh`/`git` resolve AMBIENT creds (GITHUB_TOKEN/GH_TOKEN, gh keychain + ~/.config/gh/hosts.yml,
//      git credential.helper). buildEmitEnv() constructs the subprocess env FROM SCRATCH (allowlist,
//      not inherit) so the ONLY credential path is the explicit token injection. VERIFIED on a gh-authed
//      dev host: the sanitized env reports `gh auth status` = not-logged-in even with the token in the
//      keyring (the LIVE EC1b.1 test; it SKIPS in CI where the host is not gh-authed — host-conditional).
//   2. The PR is built via the gh REST API from the diff-as-DATA — NEVER a `git push` from the candidate
//      clone (a push runs the clone's pre-push hooks / credential.helper / insteadOf / submodules). The
//      live emission is a SEAM `armedEmit()` deferred to ③.2.3; it THROWS here, so "cannot emit" is true
//      BY CONSTRUCTION (no live network code exists this wave).
//   3. UNTRUSTED DATA is separated from TRUSTED POLICY: `data` carries only the bounded candidate diff +
//      the repo/issue ref (actor-influenceable); the disposition + token come ONLY from custody. A
//      disposition-shaped key in `data` is fail-closed REJECTED (the #273 exact-set lesson — never merge).
//   4. Fail-closed EVERYWHERE: any validation/lock/error → zero bytes leave, never a fall-through.
//
// KERNEL-tier: node core + kernel/_lib only (the diff flows in as DATA, so the kernel imports no lab/
// runtime). buildEmitEnv / the host-allowlist / the diff path-parse are fresh kernel implementations of
// the lab `_clone-lifecycle` discipline (buildGitEnv / resolveHostAllowlist) — kernel cannot import lab.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { withLockSoft } = require('../_lib/lock');
// NOTE: child_process is intentionally NOT imported this wave — armedEmit() (the only network seam) is
// unimplemented (throws). ③.2.3 adds the sanitized-env gh REST call there.

// --------------------------------------------------------------------------
// Env-sanitization — the killswitch core (CRITICAL F1).
// --------------------------------------------------------------------------

// The non-credential vars the gh/git subprocess legitimately needs to RUN. Everything else (esp. the
// GH_*/GITHUB_TOKEN/GIT_ASKPASS credential surface + the GIT_CONFIG_* injection family) is DROPPED by
// starting from {} and copying ONLY this allowlist — nothing ambient can leak.
// TODO(③.2.3): add SSL_CERT_FILE + SSL_CERT_DIR for Linux/Docker runners whose CA bundle path is
// non-default — gh's TLS would fail there without them (macOS uses the keychain, so this wave is fine;
// there is no live network call here regardless — armedEmit throws).
const ENV_ALLOWLIST = Object.freeze(['PATH', 'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'USER', 'LOGNAME', 'SHELL']);

/**
 * Build the emission subprocess env FROM SCRATCH. The token reaches gh/git ONLY if explicitly injected
 * (custody). Killswitch ON => token null => no GH_TOKEN => the sanitized subprocess cannot authenticate
 * even though the host is gh-auth'd (proven). `ghConfigDir` is an EMPTY custody-owned dir so gh finds no
 * inherited hosts.yml / keyring linkage.
 * @param {{token?: string|null, ghConfigDir: string}} opts
 * @returns {object} the scrubbed env
 */
function buildEmitEnv({ token = null, ghConfigDir } = {}) {
  if (typeof ghConfigDir !== 'string' || ghConfigDir.length === 0) {
    throw new Error('buildEmitEnv: a ghConfigDir (empty custody-owned dir) is required');
  }
  const env = {};
  for (const k of ENV_ALLOWLIST) {
    if (typeof process.env[k] === 'string') env[k] = process.env[k];
  }
  // Pin the hardening (the buildGitEnv precedent + the gh surface):
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  env.GIT_TERMINAL_PROMPT = '0';
  env.GIT_ALLOW_PROTOCOL = 'https';
  env.GH_CONFIG_DIR = ghConfigDir;     // empty => no inherited hosts.yml / keyring linkage
  env.GH_PROMPT_DISABLED = '1';
  env.GH_NO_UPDATE_NOTIFIER = '1';
  // The token is the SOLE injected credential path (custody). Absent => capability gone.
  if (typeof token === 'string' && token.length > 0) env.GH_TOKEN = token;
  return env;
}

// --------------------------------------------------------------------------
// Input-shape validation (HIGH F-input) — BEFORE any field reaches an argv.
// --------------------------------------------------------------------------

const DEFAULT_REPO_HOST_ALLOWLIST = Object.freeze(['github.com']);
// owner/repo chars only; the `..` traversal + a dash-leading SEGMENT (an argv-flag injection shape) are
// caught by the secondary per-segment checks below, NOT by REPO_RE itself.
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Throws unless `repo` is a bare `owner/repo` on an allowlisted host. */
function assertSafeRepoRef(repo, { hostAllowlist = DEFAULT_REPO_HOST_ALLOWLIST } = {}) {
  if (typeof repo !== 'string' || !REPO_RE.test(repo)) {
    throw new Error(`emitPR: repo must be a bare owner/repo (got ${JSON.stringify(repo)})`);
  }
  if (repo.includes(':') || repo.includes('..')) {                  // no embedded host, no traversal
    throw new Error(`emitPR: repo contains an unsafe token: ${JSON.stringify(repo)}`);
  }
  // reject a dash-leading owner OR repo segment — an argv-flag injection shape for the ③.2.3 emission
  // (e.g. `owner/--upload-file`) — VALIDATE-hacker. REPO_RE alone allows a `-` anywhere.
  const [owner, name] = repo.split('/');
  if (owner.startsWith('-') || name.startsWith('-')) {
    throw new Error(`emitPR: a repo segment must not begin with '-' (argv-flag injection): ${JSON.stringify(repo)}`);
  }
  if (!hostAllowlist.includes('github.com')) {
    throw new Error('emitPR: github.com must be in the host allowlist');
  }
}

/** Throws unless `issueRef` is a positive integer (a github issue number) or `#N` form. */
function assertSafeIssueRef(issueRef) {
  const n = typeof issueRef === 'number' ? issueRef : String(issueRef == null ? '' : issueRef).replace(/^#/, '');
  if (!/^[0-9]+$/.test(String(n)) || Number(n) <= 0) {
    throw new Error(`emitPR: issueRef must be a positive issue number (got ${JSON.stringify(issueRef)})`);
  }
}

// --------------------------------------------------------------------------
// Disposition deny-by-default (HIGH F2) — untrusted DATA must carry NO policy.
// --------------------------------------------------------------------------

// Keys that set emission POLICY. They live ONLY in custody; their presence in untrusted `data` is an
// influence attempt → fail-closed reject (never a silent merge / ?? gap-fill — the #273 exact-set lesson).
const DISPOSITION_KEYS = Object.freeze([
  'dryRun', 'dry_run', 'dry-run', 'live', 'draft', 'disposition', 'mode', 'emit', 'killswitch',
  'token', 'ghToken', 'gh_token', 'GH_TOKEN', 'GITHUB_TOKEN', 'armed', 'force',
]);
// CASE-FOLDED match set (+ the prototype-pollution keys) so a casing/spelling variant (Live / DRY_RUN /
// __proto__) cannot slip the deny-list (VALIDATE-hacker).
const DISPOSITION_KEY_SET = new Set(
  [...DISPOSITION_KEYS, '__proto__', 'constructor', 'prototype'].map((k) => k.toLowerCase()),
);

/** Throws if untrusted `data` carries ANY disposition/policy-shaped key (case-insensitive). */
function assertDataIsPolicyFree(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('emitPR: data must be a plain object { repo, issueRef, diff }');
  }
  for (const k of Object.keys(data)) {
    if (DISPOSITION_KEY_SET.has(k.toLowerCase())) {
      throw new Error(`emitPR: untrusted data carries a policy key '${k}' (rejected; policy comes only from custody)`);
    }
  }
}

// --------------------------------------------------------------------------
// Egress-time diff path-scope (HIGH F-egress) — distinct from the grading scope.
// --------------------------------------------------------------------------

// Paths that must never ride in an emitted PR diff (CI/identity/attribute surfaces the maintainer's repo
// would execute or that smuggle config). Distinct from the grading-time test-infra scope.
function isEgressDeniedPath(p) {
  const rel = String(p || '');
  // fail-closed on a quote (the c-quoting bypass: `b/".github/..."` parses with a leading quote) OR any
  // control char (NUL/newline smuggled into a path) — VALIDATE-hacker. No control-regex (ADR-0006).
  if (rel.includes('"') || Array.prototype.some.call(rel, (c) => c.charCodeAt(0) < 0x20)) return true;
  if (rel.startsWith('/') || rel.includes('..')) return true;        // absolute / traversal
  if (/(^|\/)\.github(\/|$)/i.test(rel)) return true;                // workflows / actions (case-insensitive — the .GITHUB bypass)
  if (/(^|\/)\.git[a-z]*$/i.test(rel.split('/').pop() || '')) return true; // .gitmodules/.gitattributes/.gitignore/.git*
  if (/(^|\/)\.git(\/|$)/i.test(rel)) return true;                  // a literal .git/ path (case-insensitive)
  if (/(^|\/)(\.gitlab-ci\.yml|\.circleci|\.travis\.yml|azure-pipelines\.yml|Jenkinsfile)(\/|$)/i.test(rel)) return true;
  return false;
}

/** Parse touched paths from a unified diff (kernel-tier; the +++ b/ + diff --git + rename/copy forms). */
function parseDiffPaths(diff) {
  const paths = new Set();
  let unparseable = false;
  for (const line of String(diff || '').split('\n')) {
    let m;
    if ((m = /^\+\+\+ "?b\/(.+?)"?$/.exec(line))) paths.add(m[1].trim());
    else if ((m = /^rename to "?(.+?)"?$/.exec(line))) paths.add(m[1].trim());
    else if ((m = /^copy to "?(.+?)"?$/.exec(line))) paths.add(m[1].trim());
    else if ((m = /^diff --git "?a\/(.+?)"? "?b\/(.+?)"?\s*$/.exec(line))) paths.add(m[2].trim());
    else if (/^diff --git /.test(line)) unparseable = true;
  }
  return { paths: [...paths], unparseable };
}

// A generous fail-closed upper bound on the candidate diff (ahead of PR-B's per-window cap) — a bounded
// single-issue patch is far under this; rejects a memory-amplification DoS (VALIDATE-hacker).
const MAX_DIFF_BYTES = 5 * 1024 * 1024;

/** Throws if the candidate diff is empty/oversize/unparseable or touches an egress-denied path. */
function assertEgressSafeDiff(diff) {
  if (typeof diff !== 'string' || diff.trim().length === 0) {
    throw new Error('emitPR: diff must be a non-empty unified diff (the bounded candidate patch)');
  }
  if (Buffer.byteLength(diff, 'utf8') > MAX_DIFF_BYTES) {
    throw new Error(`emitPR: diff exceeds ${MAX_DIFF_BYTES} bytes (fail-closed)`);
  }
  const { paths, unparseable } = parseDiffPaths(diff);
  if (unparseable) throw new Error('emitPR: diff has an unparseable `diff --git` header (fail-closed)');
  if (paths.length === 0) throw new Error('emitPR: diff touched no parseable path (fail-closed)');
  const denied = paths.filter(isEgressDeniedPath);
  if (denied.length > 0) {
    throw new Error(`emitPR: diff touches egress-denied path(s) ${JSON.stringify(denied)} (.github/.git*/CI rejected)`);
  }
  return paths;
}

// --------------------------------------------------------------------------
// Killswitch (file-backed) + custody (TRUSTED policy) — re-read under the lock.
// --------------------------------------------------------------------------

// DEFAULT-ON this wave: the killswitch is ON unless a custody-owned disarm file is present AND the env
// does not force it on. (The disarm mechanism is wired at ③.2.3; this wave there is no resolvable token
// AND no live emission seam, so it is doubly fail-closed.)
function isKillswitchOn({ killswitchPath } = {}) {
  if (process.env.LOOM_BETA_KILLSWITCH === '1') return true;          // explicit force-on always wins
  // A custody-owned ARM file must exist with the literal armed token to disarm. Absent/unreadable => ON.
  if (typeof killswitchPath !== 'string') return true;
  let armed;
  try { armed = fs.readFileSync(killswitchPath, 'utf8').trim(); } catch { return true; }
  return armed !== 'ARMED';                                           // anything but the exact token => ON
}

/** Resolve the GitHub token from custody. Returns null when the killswitch is on or no custody token. */
function resolveToken({ custodyTokenPath, killswitchOn } = {}) {
  if (killswitchOn) return null;                                     // capability removed
  if (typeof custodyTokenPath !== 'string') return null;
  try {
    const t = fs.readFileSync(custodyTokenPath, 'utf8').trim();
    return t.length > 0 ? t : null;
  } catch { return null; }
}

/** Disposition is computed SOLELY from custody. Default = dry-run + DRAFT (fail-closed). */
function resolveDisposition({ custodyDispositionPath } = {}) {
  const fallback = Object.freeze({ mode: 'dry-run', draft: true });
  if (typeof custodyDispositionPath !== 'string') return fallback;
  let raw;
  try { raw = JSON.parse(fs.readFileSync(custodyDispositionPath, 'utf8')); } catch { return fallback; }
  if (!raw || typeof raw !== 'object') return fallback;
  const mode = raw.mode === 'live' ? 'live' : 'dry-run';            // anything but the exact 'live' => dry-run
  const draft = raw.draft === false ? false : true;                 // default DRAFT
  return Object.freeze({ mode, draft });
}

// --------------------------------------------------------------------------
// The live-emission SEAM — deferred to ③.2.3 (no live network code this wave).
// --------------------------------------------------------------------------

/**
 * The ONLY place the network would be touched (a gh REST blob->tree->commit->ref->pull from the diff-as-
 * DATA, NEVER a git push from the candidate clone). UNIMPLEMENTED this wave: it THROWS, so "cannot emit"
 * is true by construction. ③.2.3 implements it inside the sanitized env (buildEmitEnv).
 */
function armedEmit() {
  throw new Error('egress-not-armed-until-3.2.3: the live PR-emission seam is intentionally unimplemented this wave');
}

// --------------------------------------------------------------------------
// emitPR — the single chokepoint. Fail-closed everywhere; zero bytes this wave.
// --------------------------------------------------------------------------

const DEFAULT_LOCK_PATH = path.join(os.tmpdir(), 'loom-egress-emit.lock');

/**
 * @param {{repo: string, issueRef: number|string, diff: string}} data  UNTRUSTED (actor-influenceable).
 * @param {object} [opts]  TRUSTED policy custody: { custodyTokenPath, custodyDispositionPath,
 *   killswitchPath, ghConfigDir, lockPath, hostAllowlist }.
 * @returns {{ok: boolean, emitted: boolean, disposition?: object, draft?: object, reason?: string}}
 *   Fail-closed: any validation/lock/error => { ok:false, emitted:false }. This wave NEVER emits.
 */
function emitPR(data, opts = {}) {
  try {
    // 1. untrusted DATA must carry no policy; validate shapes BEFORE any field is used.
    assertDataIsPolicyFree(data);
    assertSafeRepoRef(data.repo, { hostAllowlist: opts.hostAllowlist });
    assertSafeIssueRef(data.issueRef);
    const touched = assertEgressSafeDiff(data.diff);

    // 2. serialize: a lock-unavailable acquisition REFUSES the emit (fail-closed), never age-reap-admit.
    const lockPath = typeof opts.lockPath === 'string' ? opts.lockPath : DEFAULT_LOCK_PATH;
    const r = withLockSoft(lockPath, () => {
      // 3. re-read killswitch + re-resolve token TOGETHER inside the held lock (TOCTOU-tight: any flip
      //    that commits before this read is honored; the in-flight-syscall window is irreducible — but
      //    this wave there IS no syscall, so it is moot).
      const killswitchOn = isKillswitchOn({ killswitchPath: opts.killswitchPath });
      const disposition = resolveDisposition({ custodyDispositionPath: opts.custodyDispositionPath });
      const token = resolveToken({ custodyTokenPath: opts.custodyTokenPath, killswitchOn });

      // 4. build the would-be PR artifact (the DRAFT) from the bounded diff-as-DATA. Body-scrub is PR-B.
      const draft = Object.freeze({
        repo: data.repo,
        issueRef: Number(String(data.issueRef).replace(/^#/, '')),
        title: `loom: candidate for issue #${String(data.issueRef).replace(/^#/, '')}`,
        touched_paths: Object.freeze([...touched]),
        diff: data.diff,                                              // PR-B scrubs this before any send
      });

      // 5. emit ONLY when disposition is live AND a token resolved AND the killswitch is off. In the
      //    DEFAULT posture that conjunction is FALSE (killswitch on => token null); a disarmed custody
      //    makes it REACHABLE (EC1b.5), at which point armedEmit() THROWS not-armed => fail-closed. So
      //    it is fail-closed by construction either way (no live network code exists this wave).
      if (disposition.mode === 'live' && token && !killswitchOn) {
        armedEmit();                                                  // throws not-armed (no live network)
      }
      return { ok: true, emitted: false, disposition, draft };
    });

    if (!r.ok) return { ok: false, emitted: false, reason: `lock-unavailable:${r.reason}` };
    return r.value;
  } catch (err) {
    // fail-CLOSED: any validation / lock / build / seam error => zero bytes leave.
    return { ok: false, emitted: false, reason: (err && err.message) || 'emit-error' };
  }
}

module.exports = {
  emitPR,
  buildEmitEnv, armedEmit,
  assertDataIsPolicyFree, assertSafeRepoRef, assertSafeIssueRef, assertEgressSafeDiff,
  isKillswitchOn, resolveToken, resolveDisposition, parseDiffPaths, isEgressDeniedPath,
  DISPOSITION_KEYS, DEFAULT_REPO_HOST_ALLOWLIST, ENV_ALLOWLIST,
};
