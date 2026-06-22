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
//      live emission is a SEAM `armedEmit()` deferred to ③.2.4; it THROWS here, so "cannot emit" is true
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
const { scrubEmitDiff } = require('./scrub');                          // ③.2.1b PR-B — body secret-scrub
const { capExceeded, recordEmit, etiquetteKey, alreadyEmitted, recordEmitted } = require('./policy');
const { computeEmissionHash, normalizeRepo } = require('./approval');                       // ③.2.4 — the per-emission gate
const { readVerifiedApproval, consumeApproval } = require('./approval-store');
// NOTE: child_process is STILL intentionally NOT imported — armedEmit() (the only network seam) remains
// unimplemented (throws). ③.2.5 adds the sanitized-env gh REST call there, behind THIS wave's approval gate.

// --------------------------------------------------------------------------
// Env-sanitization — the killswitch core (CRITICAL F1).
// --------------------------------------------------------------------------

// The non-credential vars the gh/git subprocess legitimately needs to RUN. Everything else (esp. the
// GH_*/GITHUB_TOKEN/GIT_ASKPASS credential surface + the GIT_CONFIG_* injection family) is DROPPED by
// starting from {} and copying ONLY this allowlist — nothing ambient can leak.
// ③.2.4 I4 — SSL_CERT_FILE + SSL_CERT_DIR are allowlisted for the ③.2.5 Linux/Docker gh-REST runner whose CA
// bundle path is non-default (gh's TLS fails there without them; macOS uses the keychain). Additive + benign:
// these are CA-bundle PATHS, not credentials, and there is no live network call this wave (armedEmit throws).
const ENV_ALLOWLIST = Object.freeze(['PATH', 'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'USER', 'LOGNAME', 'SHELL', 'SSL_CERT_FILE', 'SSL_CERT_DIR']);

/**
 * Build the emission subprocess env FROM SCRATCH. The token reaches gh/git ONLY if explicitly injected
 * (custody). Killswitch ON => token null => no GH_TOKEN => the sanitized subprocess cannot authenticate
 * even though the host is gh-auth'd (proven). `ghConfigDir` is an EMPTY custody-owned dir so gh finds no
 * inherited hosts.yml / keyring linkage.
 * @param {{token?: string|null, ghConfigDir: string}} opts
 * @returns {object} the scrubbed env
 */
// Enforce the ISOLATION invariant, not just string-presence (CodeRabbit #388): a populated GH_CONFIG_DIR
// (a real hosts.yml / keyring linkage) reintroduces ambient gh auth and weakens the killswitch. The dir
// must be EMPTY if it exists (gh creates a fresh empty one if it does not) — fail-closed otherwise.
function assertIsolatedGhConfigDir(dir) {
  let st;
  try { st = fs.statSync(dir); } catch { return; }                  // absent => gh creates it fresh+empty (isolated)
  if (!st.isDirectory()) throw new Error(`buildEmitEnv: ghConfigDir must be a directory: ${JSON.stringify(dir)}`);
  let entries;
  try { entries = fs.readdirSync(dir); } catch { throw new Error(`buildEmitEnv: ghConfigDir is unreadable: ${JSON.stringify(dir)}`); }
  if (entries.length > 0) {
    throw new Error(`buildEmitEnv: ghConfigDir must be EMPTY/isolated — a populated gh config reintroduces ambient auth (found: ${entries.slice(0, 5).join(',')})`);
  }
}

function buildEmitEnv({ token = null, ghConfigDir } = {}) {
  if (typeof ghConfigDir !== 'string' || ghConfigDir.length === 0) {
    throw new Error('buildEmitEnv: a ghConfigDir (empty custody-owned dir) is required');
  }
  assertIsolatedGhConfigDir(ghConfigDir);
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
// owner/repo shape gate; the per-SEGMENT charset rules (owner vs repo are ASYMMETRIC) + the `..`/`:`
// guards are applied below — REPO_RE is only the coarse shape.
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
// ③.2.3 H1 — the OWNER (GitHub login) charset: alphanumeric + single internal hyphens, NO dots/underscores,
// no leading/trailing hyphen, no consecutive hyphens. This alone rejects a dot-only / `.github`-as-OWNER /
// leading-dot / dotted owner (`o.w`). The REPO name is validated separately (it MAY lead with `.`/`_` — e.g.
// the real, common `owner/.github` community-health repo — but cannot be exactly `.`/`..`, lead with `-`, or
// end with `.`). VERIFY-board VF1: a uniform "every segment alnum-led" rule would over-reject `.github`-the-repo.
// NB GitHub DOES permit a digit-only owner (e.g. some bot accounts), so OWNER_RE accepting `0`/`123`
// is correct, not an over-accept — do not "fix" it to require a leading letter.
const OWNER_RE = /^[A-Za-z0-9](?:-?[A-Za-z0-9])*$/;
const REPO_NAME_RE = /^[A-Za-z0-9._-]+$/;

/** Throws unless `repo` is a bare `owner/repo` on an allowlisted host (owner-vs-repo-typed, ③.2.3 H1). */
function assertSafeRepoRef(repo, { hostAllowlist = DEFAULT_REPO_HOST_ALLOWLIST } = {}) {
  if (typeof repo !== 'string' || !REPO_RE.test(repo)) {
    throw new Error(`emitPR: repo must be a bare owner/repo (got ${JSON.stringify(repo)})`);
  }
  if (repo.includes(':') || repo.includes('..')) {                  // no embedded host, no traversal (incl. mid-name `..`)
    throw new Error(`emitPR: repo contains an unsafe token: ${JSON.stringify(repo)}`);
  }
  const [owner, name] = repo.split('/');
  // OWNER: a GitHub login — alnum + single internal hyphens, no dots/underscores (rejects `.`/`.github`/`o.w`/`-o`).
  if (!OWNER_RE.test(owner)) {
    throw new Error(`emitPR: repo owner must be a valid GitHub login (alnum + single hyphens): ${JSON.stringify(repo)}`);
  }
  // REPO name: alnum + `. _ -`; may lead with `.`/`_` (e.g. `.github`), but NOT be exactly `.`/`..`, lead with
  // `-` (an argv-flag-injection shape), or end with `.` (a git-ref / case-insensitive-FS foot-gun).
  // (NB a `.git` suffix is deliberately NOT rejected here — `etiquetteKey` canonicalizes it for the
  // one-PR-per-issue dedup; reconciling the accept-for-canonicalization vs reject-as-wrong-target tension
  // is a ③.2.4 carry. It is non-exploitable: GitHub bounces a `.git` repo + the diff-path layer blocks `.git*`.)
  if (!REPO_NAME_RE.test(name) || /^\.{1,2}$/.test(name) || name.startsWith('-') || name.endsWith('.')) {
    throw new Error(`emitPR: repo name is unsafe (dot-only / leading-'-' / trailing-'.'): ${JSON.stringify(repo)}`);
  }
  if (!hostAllowlist.includes('github.com')) {
    throw new Error('emitPR: github.com must be in the host allowlist');
  }
}

/** Throws unless `issueRef` is a positive SAFE integer (a github issue number) or `#N` form (③.2.3 H2). */
function assertSafeIssueRef(issueRef) {
  const n = typeof issueRef === 'number' ? issueRef : String(issueRef == null ? '' : issueRef).replace(/^#/, '');
  // /^[0-9]+$/ shape + > 0 + SAFE integer: a 20-digit number passes the shape but loses precision past 2^53
  // (a wrong-issue target once armed) — reject it (VERIFY-board H2; the lab parseRecordRef has the same bound).
  if (!/^[0-9]+$/.test(String(n)) || Number(n) <= 0 || !Number.isSafeInteger(Number(n))) {
    throw new Error(`emitPR: issueRef must be a positive safe-integer issue number (got ${JSON.stringify(issueRef)})`);
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
  // ③.2.1b PR-B — the cap/window/etiquette policy vocabulary AND the custody opts-path names (a poisoned
  // data attempt is REJECTED, not silently ignored): the actor never sets the cap/ledger state OR a path.
  'cap', 'window', 'windowCount', 'windowStart', 'emitCount', 'ledger', 'backpressure',
  'rateLimit', 'perWindowCap', 'windowMs', 'emittedKeys', 'seen', 'now', 'count',
  'custodyCapStatePath', 'custodyEtiquetteLedgerPath', 'custodyTokenPath', 'custodyDispositionPath',
  'killswitchPath', 'lockPath', 'ghConfigDir', 'hostAllowlist',
  // ③.2.4 H7 — the FULL per-emission-approval vocabulary (the actor never sets an approval/custody-approvals
  // path, a pre-baked hash, the clock/ttl/uid the gate reads, OR the injectable emit fn). Exact-set deny (#273).
  'approval', 'approvalHash', 'approved', 'emission', 'approvedAt', 'nonce',
  'custodyApprovalsDir', 'custodyApprovalsPath', 'ttlMs', 'selfUid', 'armedEmitFn',
  // ③.2.5a — the broker-signature verify vocab is CUSTODY-only; an actor must never inject the verify key or a
  // sig via untrusted data (the #273 exact-set deny-list; VERIFY-arch F3 / honesty H1).
  'sig', 'key_id', 'keyId', 'signFn', 'verifyKeyPem', 'verifyKey', 'publicKeyPem', 'custodyVerifyKeyPath',
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
// does not force it on. (The disarm mechanism is wired at ③.2.4; this wave there is no resolvable token
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

/**
 * ③.2.5a — the per-emission approval verify key, from CUSTODY ONLY (the SAME provenance as the token/killswitch:
 * a custody-owned file, NOT an ambient env var, NOT edge-attestation's LOOM_EDGE_VERIFY_KEY — the dedicated
 * loom-broker trust domain, VERIFY-hacker H1/H2). Returns the PEM string, or null (=> verifyApproval fail-closes
 * with 'no-verify-key', so the env fallback in loadPublicKey is never reached). The actor cannot supply this —
 * custodyVerifyKeyPath is in DISPOSITION_KEYS, rejected from untrusted data.
 * NB this is a bare readFileSync — it FOLLOWS symlinks, by DELIBERATE PARITY with resolveToken/resolveDisposition
 * (the custody root's provenance is the host-setup contract, not a per-file O_NOFOLLOW guard). VALIDATE-hacker H3:
 * the verify key is the highest-stakes custody input (it selects WHICH broker sig is authoritative), so whether it
 * warrants the .approved read path's O_NOFOLLOW+fstat+uid treatment is an explicit ③.2.5b arming decision.
 */
function resolveVerifyKey({ custodyVerifyKeyPath } = {}) {
  if (typeof custodyVerifyKeyPath !== 'string') return null;
  try {
    const pem = fs.readFileSync(custodyVerifyKeyPath, 'utf8').trim();
    return pem.length > 0 ? pem : null;
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
// The live-emission SEAM — deferred to ③.2.4 (no live network code this wave).
// --------------------------------------------------------------------------

/**
 * The ONLY place the network would be touched (a gh REST blob->tree->commit->ref->pull, NEVER a git push from
 * the candidate clone). STILL UNIMPLEMENTED: it THROWS, so "cannot emit" is true by construction THIS wave too
 * (the ③.2.4 wave builds + proves the per-emission approval GATE; the live seam is ③.2.5, behind this gate,
 * once the blob-source + signed-minter Forward-Contract is met). Injectable via opts.armedEmitFn so the gated
 * emit-then-record path is provable without the network.
 */
function armedEmit() {
  throw new Error('egress-not-armed-until-3.2.5: the live PR-emission seam is intentionally unimplemented (gate built ③.2.4; network ③.2.5)');
}

// --------------------------------------------------------------------------
// emitPR — the single chokepoint. Fail-closed everywhere; zero bytes this wave.
// --------------------------------------------------------------------------

const DEFAULT_LOCK_PATH = path.join(os.tmpdir(), 'loom-egress-emit.lock');

/**
 * @param {{repo: string, issueRef: number|string, diff: string}} data  UNTRUSTED (actor-influenceable).
 * @param {object} [opts]  TRUSTED policy custody: { custodyTokenPath, custodyDispositionPath,
 *   killswitchPath, ghConfigDir, lockPath, hostAllowlist, custodyCapStatePath,
 *   custodyEtiquetteLedgerPath, perWindowCap, windowMs, now }. (PR-B adds the cap/etiquette state paths.)
 * @returns {{ok: boolean, emitted: boolean, disposition?: object, draft?: object, reason?: string}}
 *   Fail-closed: any validation/lock/error => { ok:false, emitted:false }. This wave NEVER emits.
 */
function emitPR(data, opts = {}) {
  try {
    // 1. untrusted DATA must carry no policy; validate shapes BEFORE any field is used.
    assertDataIsPolicyFree(data);
    assertSafeRepoRef(data.repo, { hostAllowlist: opts.hostAllowlist });
    assertSafeIssueRef(data.issueRef);
    assertEgressSafeDiff(data.diff);   // validates the RAW paths (throws on .github/.git*/CI); the draft derives paths from the SCRUBBED diff (PR-B)

    // 2. serialize: a lock-unavailable acquisition REFUSES the emit (fail-closed), never age-reap-admit.
    const lockPath = typeof opts.lockPath === 'string' ? opts.lockPath : DEFAULT_LOCK_PATH;
    const r = withLockSoft(lockPath, () => {
      // 3. re-read killswitch + re-resolve token TOGETHER inside the held lock (TOCTOU-tight: any flip
      //    that commits before this read is honored; the in-flight-syscall window is irreducible — but
      //    this wave there IS no syscall, so it is moot).
      const killswitchOn = isKillswitchOn({ killswitchPath: opts.killswitchPath });
      const disposition = resolveDisposition({ custodyDispositionPath: opts.custodyDispositionPath });
      const token = resolveToken({ custodyTokenPath: opts.custodyTokenPath, killswitchOn });
      const now = typeof opts.now === 'number' ? opts.now : Date.now();

      // 4. PR-B policy gates (custody state via opts; fail-closed refuse; the cap is GLOBAL; the etiquette
      //    key is CANONICAL) — inside the lock (shared-state). The actor's (repo,issueRef) is ONLY a
      //    validated lookup key; the cap/ledger PATHS come only from opts (custody), never from data.
      if (typeof opts.custodyCapStatePath === 'string'
          && capExceeded(opts.custodyCapStatePath, { now, perWindowCap: opts.perWindowCap, windowMs: opts.windowMs })) {
        return { ok: false, emitted: false, reason: 'cap-exceeded' };
      }
      const etqKey = etiquetteKey(data.repo, data.issueRef);
      if (typeof opts.custodyEtiquetteLedgerPath === 'string'
          && alreadyEmitted(opts.custodyEtiquetteLedgerPath, etqKey)) {
        return { ok: false, emitted: false, reason: 'etiquette-already-emitted' };
      }

      // 5. SCRUB the diff (PR-B), then build the DRAFT SOLELY from the scrubbed diff + the custody-validated
      //    refs. repo is NORMALIZED ONCE (③.2.4 H5) — the SAME canonical the approval axiom hashes AND the
      //    ③.2.5 emit target will read, so the approved identity and the emit target can never diverge.
      //    touched_paths derive from the SCRUBBED diff so a secret in a filename is redacted there too.
      const scrubbedDiff = scrubEmitDiff(data.diff);
      const issueNum = Number(String(data.issueRef).replace(/^#/, ''));
      const draft = Object.freeze({
        repo: normalizeRepo(data.repo),
        issueRef: issueNum,
        title: `loom: candidate for issue #${issueNum}`,
        touched_paths: Object.freeze(parseDiffPaths(scrubbedDiff).paths),
        diff: scrubbedDiff,
      });
      // The content-address the human approval is keyed to (binds the MINIMAL set {repo,issueRef,scrubbed diff};
      // the scrubbed diff IS draft.diff == the bytes ③.2.5 must emit verbatim — the Forward-Contract).
      const approvalHash = computeEmissionHash(draft);

      // 6. emit ONLY when live AND a token AND killswitch-off AND a VALID per-emission human approval (③.2.4).
      if (disposition.mode === 'live' && token && !killswitchOn) {
        // the verify key is resolved from CUSTODY (a file), under the lock — same provenance as the token (H1/H2).
        const verifyKeyPem = resolveVerifyKey({ custodyVerifyKeyPath: opts.custodyVerifyKeyPath });
        const appr = readVerifiedApproval(opts.custodyApprovalsDir, approvalHash, { now, ttlMs: opts.ttlMs, selfUid: opts.selfUid, verifyKeyPem });
        if (!appr.ok) {
          // the EXPECTED pending state (NOT an error): the human has not approved THIS exact content yet.
          return { ok: true, emitted: false, disposition, draft, approvalHash, reason: 'awaiting-approval' };
        }
        // emit-then-record (③.2.4 I2 — fold the reservation-before-throw): armedEmit FIRST (throws this wave);
        // ONLY on success RESERVE the cap + ledger and CONSUME the one-shot approval. A throw -> the outer
        // catch -> fail-closed, with cap + ledger + approval all UNCHANGED (proven via an injected armedEmitFn).
        const armedEmitFn = typeof opts.armedEmitFn === 'function' ? opts.armedEmitFn : armedEmit;
        const pr = armedEmitFn({ draft, token, ghConfigDir: opts.ghConfigDir });
        if (typeof opts.custodyCapStatePath === 'string') recordEmit(opts.custodyCapStatePath, { now, windowMs: opts.windowMs });
        if (typeof opts.custodyEtiquetteLedgerPath === 'string') recordEmitted(opts.custodyEtiquetteLedgerPath, etqKey);
        consumeApproval(opts.custodyApprovalsDir, approvalHash);
        return { ok: true, emitted: true, disposition, draft, approvalHash, pr };
      }
      return { ok: true, emitted: false, disposition, draft, approvalHash };
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
  buildEmitEnv, assertIsolatedGhConfigDir, armedEmit,
  assertDataIsPolicyFree, assertSafeRepoRef, assertSafeIssueRef, assertEgressSafeDiff,
  isKillswitchOn, resolveToken, resolveDisposition, resolveVerifyKey, parseDiffPaths, isEgressDeniedPath,
  DISPOSITION_KEYS, DEFAULT_REPO_HOST_ALLOWLIST, ENV_ALLOWLIST,
};
