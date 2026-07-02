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
//      live emission SEAM `armedEmit()` IS armed (③.2.5c): it delegates to gh-emit.js (the gh-REST
//      tree->commit->ref->pull) and the live network egress has been proven (spec-kitty#2137). Emission is
//      gated by the full chain (live AND token AND killswitch-off AND a VALID signed human approval), not
//      by an absent seam.
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
const { emitEgressAlert } = require('./alert');                        // observable signal for the additive join-key write
const { writeJoinKey } = require('./join-key-store');                  // gap-map item 1 — the SHADOW egress join-key (write-only here)
// NOTE: child_process is STILL intentionally NOT imported here — the network is touched by gh-emit.js (the
// gh-REST mechanism armedEmit() lazily delegates to), behind THIS module's approval gate, not by a direct
// child_process call in emit-pr.

// --------------------------------------------------------------------------
// Env-sanitization — the killswitch core (CRITICAL F1).
// --------------------------------------------------------------------------

// The non-credential vars the gh/git subprocess legitimately needs to RUN. Everything else (esp. the
// GH_*/GITHUB_TOKEN/GIT_ASKPASS credential surface + the GIT_CONFIG_* injection family) is DROPPED by
// starting from {} and copying ONLY this allowlist — nothing ambient can leak.
// ③.2.4 I4 — SSL_CERT_FILE + SSL_CERT_DIR are allowlisted for the ③.2.5 Linux/Docker gh-REST runner whose CA
// bundle path is non-default (gh's TLS fails there without them; macOS uses the keychain). Additive + benign:
// these are CA-bundle PATHS, not credentials. The live gh-REST call (via armedEmit -> gh-emit) needs them on
// the Linux/Docker runner; macOS uses the keychain.
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
  // F-W2 length cap (consistent with gh-emit's validateForkIdentity): GitHub's login (owner) max is 39 chars.
  // A fail-FAST + observable bound; turns a fail-late (a 500-char owner 404s at the network) into a fail-fast.
  if (owner.length > 39) {
    throw new Error(`emitPR: repo owner exceeds GitHub's 39-char login max: ${JSON.stringify(repo)}`);
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

// OQ-3 (RFC §5.3) — the lesson_commitment shape gate. The actor-influenceable `data` may carry a lesson_commitment
// (the captured-lesson digest the human/broker approved alongside the diff). It is emission-ADJACENT data (like the
// diff), NOT a disposition key, so it passes assertDataIsPolicyFree and is threaded into the approval gate. Coerce
// absent/undefined -> '' (the no-lesson sentinel); accept ONLY '' or a LOWERCASE 64-hex (fold F4 — an UPPERCASE
// commitment is rejected so a casing variant cannot slip a cross-boundary mismatch); throw on anything else. PURE.
const LESSON_COMMITMENT_RE = /^[a-f0-9]{64}$/;
function assertSafeLessonCommitment(v) {
  if (v === undefined) return '';                 // ABSENT/undefined is the only no-lesson coercion; an explicit
  // null (a malformed value from actor-influenced data) falls through to the throw — fail-closed, never silently
  // laundered into a no-lesson request (CodeRabbit Major — reject explicit null instead of treating it as no lesson).
  if (typeof v !== 'string' || !(v === '' || LESSON_COMMITMENT_RE.test(v))) {
    throw new Error(`emitPR: lesson_commitment must be a lowercase 64-hex digest or '' (got ${JSON.stringify(v)})`);
  }
  return v;
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
  // gap-map item 1 — the egress join-key custody dir + the recorded-claim metadata are CUSTODY/orchestrator-
  // supplied; an actor must never inject the store path OR the (recorded-but-not-trusted) metadata via data
  // (VERIFY Q6b — the #273 exact-set deny-list).
  'custodyJoinKeyDir', 'joinKeyMeta',
  // F-W1 (M-1) — the fork/identity policy vocabulary. The bot-account fork target + the identity-derivation
  // fields are CUSTODY values (operator-configured); an actor must never inject a fork/head/base repo via
  // untrusted data (the #273 exact-set deny-list). The set is case-folded at :204 (casing variants collapse),
  // but hyphen and underscore spellings are DISTINCT own-key shapes AFTER lowercasing — so every identity field
  // is listed in ALL THREE spellings (camelCase, snake_case, kebab-case) or a variant would slip the deny-list.
  'forkRepo', 'fork_repo', 'fork-repo', 'forkOwner', 'fork_owner', 'fork-owner',
  'upstreamRepo', 'upstream_repo', 'upstream-repo',
  'expectedForkOwner', 'expected_fork_owner', 'expected-fork-owner',
  'forkName', 'fork_name', 'fork-name',
  'headRepo', 'head_repo', 'head-repo',
  'baseRepo', 'base_repo', 'base-repo',
  'sourceRepo', 'source_repo', 'source-repo',
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

// gap-map item 1 — the recorded-claim metadata cap on the bounded built_by string.
const MAX_JOIN_KEY_BUILT_BY = 256;

/**
 * The join-key METADATA gate. opts.joinKeyMeta is custody/orchestrator-supplied recorded-claim
 * provenance — NOT trusted, just RECORDED (the join-key's AUTHORITY is approval_hash + pr_url, both
 * kernel-derived). Returns the allowlisted `{built_by}` (or `{}`), or THROWS. The throw is caught at the
 * write site (additive, non-reverting) — it never reverts the emission. Fail-closed against injection:
 *  - absent => {} (no recorded claim; the join-key omits built_by).
 *  - must be a plain object (non-array) — else throw.
 *  - the DISPOSITION_KEY_SET check over its keys (a disposition/token/__proto__-shaped key => throw; the
 *    #273 exact-set lesson — metadata can never carry policy).
 *  - built_by, if present, must be a bounded plain string (<=256 chars, no control chars) — else throw.
 *  - returns ONLY {built_by} (no other key is forwarded into the record).
 * @param {object|undefined} joinKeyMeta
 * @returns {{built_by?: string}}
 */
function assertRecordedClaim(joinKeyMeta) {
  if (joinKeyMeta === undefined || joinKeyMeta === null) return {};
  if (typeof joinKeyMeta !== 'object' || Array.isArray(joinKeyMeta)) {
    throw new Error('emitPR: joinKeyMeta must be a plain object { built_by? }');
  }
  for (const k of Object.keys(joinKeyMeta)) {
    if (DISPOSITION_KEY_SET.has(k.toLowerCase())) {
      throw new Error(`emitPR: joinKeyMeta carries a policy key '${k}' (rejected; metadata is recorded-claim only)`);
    }
  }
  const builtBy = joinKeyMeta.built_by;
  if (builtBy === undefined) return {};
  const bounded = typeof builtBy === 'string' && builtBy.length >= 1 && builtBy.length <= MAX_JOIN_KEY_BUILT_BY
    && !Array.prototype.some.call(builtBy, (c) => c.charCodeAt(0) < 0x20);
  if (!bounded) throw new Error('emitPR: joinKeyMeta.built_by must be a bounded plain string (<=256 chars, no control chars)');
  return { built_by: builtBy };
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

// DEFAULT-ON: the killswitch is ON unless a custody-owned disarm file is present AND the env does not
// force it on. The live emission seam (armedEmit -> gh-emit) IS armed now, so the killswitch is the
// load-bearing capability gate: ON => no resolvable token => buildEmitEnv injects no GH_TOKEN => gh cannot
// authenticate (capability removed), and the seam is never reached.
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

/**
 * #412 — the single "is a live emit currently possible?" predicate. TRUE iff the killswitch is DISARMED (the custody
 * ARM file holds the literal token AND LOOM_BETA_KILLSWITCH is not forcing on) AND the disposition resolves to 'live'.
 * Composes the EXISTING isKillswitchOn + resolveDisposition (the same custody the emit gate honors) — no new policy.
 * Fail-safe: a missing/unset/unreadable path => killswitch reads ON / disposition reads dry-run => false. The
 * host-level-actor guard (runActorTrajectory) reads this so a broker-reachable host actor never runs while armed.
 */
function isEmitArmed({ killswitchPath, custodyDispositionPath } = {}) {
  if (isKillswitchOn({ killswitchPath })) return false;
  return resolveDisposition({ custodyDispositionPath }).mode === 'live';
}

// --------------------------------------------------------------------------
// The live-emission SEAM — ③.2.5c: armed (delegates to the gh-REST mechanism).
// --------------------------------------------------------------------------

// F-W4 ARMING CONSTANT (hacker/honesty VERIFY H1) — the fork-object-sharing claim (Q3) is DOC-SILENT and UNPROBED
// (can a fork commit reference an upstream-only sha?). A LIVE fork write is fail-closed-forbidden until an operator
// records that probe result. HARD kernel constant, NEVER an arg/opt (security.md non-bypassable-guard): F-W4 flips
// it to `true` ONLY after the live probe passes, with the evidence in that commit. `false` here => armedEmit
// refuses any populated forkRepo. Dormant in F-W1/F-W2 (emitPR never populates forkRepo).
const OBJECT_SHARING_PROBE_RECORDED = false;

/**
 * The ONLY place the network is touched: a gh REST tree->commit->ref->pull (NEVER a git push from the candidate
 * clone). ③.2.5c flips this from a throw to a real DRAFT-PR creation, delegating to gh-emit.js, behind the
 * now-complete gate (live AND token AND killswitch-off AND a VALID signed human approval). The token reaches gh
 * ONLY via buildEmitEnv({token, ghConfigDir}).GH_TOKEN — the sole credential path (killswitch off => no token =>
 * capability gone, and this seam is never reached). approvalHash is the gate's independently-computed emission
 * hash, threaded so gh-emit's self-check has a value to cross-check against (CRITICAL-2 — re-hashing the same
 * draft would be a tautology). The require of gh-emit is LAZY (inside the function) so the back-edge gh-emit ->
 * emit-pr (for parseDiffPaths/isEgressDeniedPath) is not a load-time cycle. Injectable via opts.armedEmitFn so
 * the gated emit-then-record path stays unit-provable without the network.
 * F-W1 — two DORMANT custody-only params thread through to ghEmit's two-identity axis: `forkRepo` (the
 * fork write-target) + `expectedForkOwner` (the asserted fork owner). Both are `undefined` on emitPR's call
 * below (F-W1 never populates them — same-owner, byte-identical); they enter ONLY via a direct armedEmit
 * caller (the custody-only entry point). They are NEVER read from `draft` (draft is hash-bound; a forkRepo in
 * it would be an unsigned co-forgeable steering field — the C2 #273 trap), so they are explicit named args.
 * @param {{ draft: object, token: string, ghConfigDir: string, approvalHash: string, forkRepo?: string, expectedForkOwner?: string }} args
 */
function armedEmit({ draft, token, ghConfigDir, approvalHash, forkRepo, expectedForkOwner } = {}) {
  // F-W4 ARMING GATE (hacker/honesty VERIFY H1) — a LIVE fork write depends on the UNPROBED fork-object-sharing
  // claim (Q3: can a fork-side commit reference an upstream-only sha; DOC-SILENT — see the F-W2 plan's F-W4 arming
  // preconditions). armedEmit is the custody-only production entry F-W4 will use to POPULATE a live forkRepo, so
  // this is the gate: a live fork write is fail-closed-forbidden until the operator records the object-sharing
  // probe result. OBJECT_SHARING_PROBE_RECORDED is a HARD kernel constant (non-overridable — never an arg/opt);
  // F-W4 flips it to true ONLY after the live probe passes, with the evidence in that commit. DORMANT in F-W1/F-W2
  // (emitPR never populates forkRepo => forkRepo is undefined here => this never fires in production yet). The
  // ghEmit fork-mode MECHANISM is exercised only by direct-ghEmit unit tests, which bypass this production entry.
  if (forkRepo !== undefined && !OBJECT_SHARING_PROBE_RECORDED) {
    emitEgressAlert('object-sharing-unprobed', { forkRepo: String(forkRepo).slice(0, 80) });
    throw new Error('armedEmit: a live fork write requires a recorded object-sharing probe (Q3) — fail-closed until F-W4 arming (OBJECT_SHARING_PROBE_RECORDED)');
  }
  const { ghEmit } = require('./gh-emit');                            // lazy — breaks the emit-pr<->gh-emit cycle
  const env = buildEmitEnv({ token, ghConfigDir });
  return ghEmit({ draft, approvalHash, env, forkRepo, expectedForkOwner });
}

// --------------------------------------------------------------------------
// emitPR — the single chokepoint. Fail-closed everywhere; bytes leave ONLY when the full gate passes
// (live AND token AND killswitch-off AND a VALID signed human approval).
// --------------------------------------------------------------------------

const DEFAULT_LOCK_PATH = path.join(os.tmpdir(), 'loom-egress-emit.lock');

/**
 * @param {{repo: string, issueRef: number|string, diff: string}} data  UNTRUSTED (actor-influenceable).
 * @param {object} [opts]  TRUSTED policy custody: { custodyTokenPath, custodyDispositionPath,
 *   killswitchPath, ghConfigDir, lockPath, hostAllowlist, custodyCapStatePath,
 *   custodyEtiquetteLedgerPath, perWindowCap, windowMs, now }. (PR-B adds the cap/etiquette state paths.)
 * @returns {{ok: boolean, emitted: boolean, disposition?: object, draft?: object, reason?: string}}
 *   Fail-closed: any validation/lock/error => { ok:false, emitted:false }. A real PR is emitted only on
 *   the full armed path (live AND token AND killswitch-off AND a VALID signed human approval).
 */
function emitPR(data, opts = {}) {
  try {
    // 1. untrusted DATA must carry no policy; validate shapes BEFORE any field is used.
    assertDataIsPolicyFree(data);
    assertSafeRepoRef(data.repo, { hostAllowlist: opts.hostAllowlist });
    assertSafeIssueRef(data.issueRef);
    assertEgressSafeDiff(data.diff);   // validates the RAW paths (throws on .github/.git*/CI); the draft derives paths from the SCRUBBED diff (PR-B)
    // OQ-3 (RFC §5.3) — the captured-lesson commitment the human/broker approved alongside the diff. Shape-gated
    // (lowercase 64-hex or '' for no-lesson) before it is threaded into the approval gate as requestedLessonCommitment.
    const lessonCommitment = assertSafeLessonCommitment(data.lesson_commitment);

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
        // OQ-3 — thread the data lesson_commitment so the gate refuses a post-approval lesson swap (a commitment the
        // human/broker did not approve fail-closes with appr.reason === 'lesson-commitment-mismatch').
        const appr = readVerifiedApproval(opts.custodyApprovalsDir, approvalHash, { now, ttlMs: opts.ttlMs, selfUid: opts.selfUid, verifyKeyPem, requestedLessonCommitment: lessonCommitment });
        if (!appr.ok) {
          // the EXPECTED pending state (NOT an error): the human has not approved THIS exact content yet. OQ-3 (fold
          // F3): surface the underlying gate reason (e.g. lesson-commitment-mismatch) so the emit layer is debuggable
          // — a plain reason token, no payload. The outer `reason: 'awaiting-approval'` value is unchanged (consumers key on it).
          return { ok: true, emitted: false, disposition, draft, approvalHash, reason: 'awaiting-approval', approvalReason: appr.reason };
        }
        // OQ-3 W3 (RFC §5.4) — capture the broker-sig provenance bundle from the VERIFIED approval body so the
        // join-key SEALS lesson_commitment + RECORDS {approvedAt, nonce, key_id, broker_sig}. readVerifiedApproval
        // returns the body { hash, emission, approvedAt, nonce, sig, key_id, lesson_commitment } (approval-store.js).
        // A missing body -> undefined fields -> writeJoinKey's validateRecord rejects -> the existing observable,
        // non-reverting jk.ok===false branch below; this NEVER throws the emission (the additive-write contract).
        const { approvedAt, nonce, key_id: apprKeyId, sig: brokerSig } = appr.body || {};
        // emit-then-record (③.2.4 I2 — fold the reservation-before-throw): armedEmit FIRST (throws this wave);
        // ONLY on success RESERVE the cap + ledger and CONSUME the one-shot approval. A throw -> the outer
        // catch -> fail-closed, with cap + ledger + approval all UNCHANGED (proven via an injected armedEmitFn).
        const armedEmitFn = typeof opts.armedEmitFn === 'function' ? opts.armedEmitFn : armedEmit;
        const pr = armedEmitFn({ draft, token, ghConfigDir: opts.ghConfigDir, approvalHash });
        if (typeof opts.custodyCapStatePath === 'string') recordEmit(opts.custodyCapStatePath, { now, windowMs: opts.windowMs });
        if (typeof opts.custodyEtiquetteLedgerPath === 'string') recordEmitted(opts.custodyEtiquetteLedgerPath, etqKey);
        consumeApproval(opts.custodyApprovalsDir, approvalHash);
        // gap-map item 1 — ADDITIVE, NON-REVERTING: persist the kernel-authoritative join-key sealing the
        // approved approval_hash to the gh PR identity + base_sha. A failure (incl. a thrown
        // assertRecordedClaim) NEVER reverts the emission — the PR already shipped; it is observable but
        // non-fatal. SKIP on pr.deduped (a prior emit already wrote THIS join-key; the deduped path's
        // re-resolved base_sha could be a wrong current base — first write is authoritative). SHADOW: no
        // consumer reads the join-key yet (PR-2 wires the lab merge-ingress join).
        if (typeof opts.custodyJoinKeyDir === 'string' && pr && !pr.deduped) {
          try {
            const { built_by } = assertRecordedClaim(opts.joinKeyMeta);   // throws on a policy-shaped/oversized key
            // writeJoinKey NEVER throws: a collision / write-failed / validation refusal RETURNS {ok:false,reason}
            // (with its OWN store-internal alert). The catch below only catches the assertRecordedClaim THROW, so
            // surface the non-throwing refusal here too — a fail-silent {ok:false} would otherwise skip the
            // write-site signal (the double-emit on store self-alerting paths is acceptable defense-in-depth).
            const jk = writeJoinKey({
              repo: draft.repo,
              issueRef: draft.issueRef,
              pr_number: pr.number,
              pr_url: pr.pr_url,
              approval_hash: approvalHash,
              base_sha: pr.base_sha,
              // OQ-3 W3 — the SEALED lesson_commitment (the shape-gated data value) + the RECORDED broker-sig
              // bundle copied from the verified approval body (RFC §5.4). computeEmissionHash / the draft / the
              // emission Forward-Contract / consumeApproval are UNTOUCHED.
              lesson_commitment: lessonCommitment,
              approvedAt,
              nonce,
              key_id: apprKeyId,
              broker_sig: brokerSig,
              ...(built_by ? { built_by } : {}),
              emitted_at: new Date(now).toISOString(),
            }, { dir: opts.custodyJoinKeyDir, selfUid: opts.selfUid });
            if (jk && jk.ok === false) {
              emitEgressAlert('egress-join-key-write-failed', { pr_url: pr.pr_url, reason: jk.reason });
            }
          } catch (e) {
            emitEgressAlert('egress-join-key-write-failed', { pr_url: pr && pr.pr_url, reason: (e && e.message) || 'error' });
          }
        }
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
  assertDataIsPolicyFree, assertRecordedClaim, assertSafeRepoRef, assertSafeIssueRef, assertEgressSafeDiff, assertSafeLessonCommitment,
  isKillswitchOn, isEmitArmed, resolveToken, resolveDisposition, resolveVerifyKey, parseDiffPaths, isEgressDeniedPath,
  DISPOSITION_KEYS, DEFAULT_REPO_HOST_ALLOWLIST, ENV_ALLOWLIST, OWNER_RE,
};
