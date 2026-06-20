#!/usr/bin/env node

// @loom-layer: lab
//
// The SHARED hardened git clone/apply lifecycle, extracted (v3.0 Docker wave,
// ARCH-2) from sandbox-exec-backend.js so BOTH containment backends (sandbox-exec
// AND docker) reuse ONE proven implementation of the arg-injection hardening
// rather than two drifting copies (the W2 secret-patterns-factory precedent).
//
// The clone/checkout/apply runs UNSANDBOXED on the host BEFORE any sandbox exists,
// on attacker-influenced inputs (the corpus repo + base_sha + patches). The
// hardening neutralizes repo-side hooks + ext-transport + fsmonitor, drops
// system/global config + the credential prompt, validates the shape of every
// attacker-controlled value, and passes `--` at every flag-parser boundary.
//
// Pure-ish: uses child_process git but applies NO sandbox — the backend layers
// containment on top. This module owns ONLY the host-side git hardening.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { canonicalize, isWithinRoot } = require('../../kernel/_lib/path-canonicalize');

const TEMP_ROOT = canonicalize(os.tmpdir());

// A patch is written UNSANDBOXED to host temp before `git apply`; bound its size +
// type so an oversized/non-string candidate cannot fill temp disk or burn the git
// timeout (VALIDATE CodeRabbit). 5 MB is far above any real diff.
const MAX_PATCH_BYTES = 5 * 1024 * 1024;

function mkScoped(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

// The SSRF host-allowlist for a REMOTE clone URL (W4d A1). The prod corpus is github.com-only; an
// arbitrary remote is an SSRF lever (the clone runs UNSANDBOXED on the host). Frozen so no importer
// can `.push` a host into the default at runtime (the weight-source-gate frozen-default discipline).
const DEFAULT_REPO_HOST_ALLOWLIST = Object.freeze(['github.com']);

// Resolve the allowlist at CALL-TIME (env read per call, like circuit-breaker's resolveSourceId): a
// comma-split LOOM_CLONE_HOST_ALLOWLIST -> trimmed-lowercase Set. An empty / whitespace / all-commas /
// absent env FAILS SAFE to the github.com default -- it can NEVER fail-open to any-host (the safety
// fail-safe). A caller-injected opts.hostAllowlist OVERRIDES the env (caller-owned-override precedence,
// mirror weight-source-gate.isLiveSource).
function resolveHostAllowlist(override) {
  if (Array.isArray(override) && override.length > 0) {
    const set = new Set(override.map((h) => String(h).trim().toLowerCase()).filter(Boolean));
    if (set.size > 0) return set;
  }
  const raw = process.env.LOOM_CLONE_HOST_ALLOWLIST;
  if (typeof raw === 'string') {
    const set = new Set(raw.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean));
    if (set.size > 0) return set;
  }
  return new Set(DEFAULT_REPO_HOST_ALLOWLIST);
}

// HARDEN neutralizes repo-side hooks + ext-transport + fsmonitor, for every git
// call here. NOTE (③.2.0-A / C1): GIT_HARDEN does NOT cover `[filter] clean/smudge`
// drivers (they have no core.* kill-switch) — that surface is closed separately by
// captureActorDiff's pristine-.git/config restore, NOT here.
const GIT_HARDEN = ['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.ext.allow=never', '-c', 'core.fsmonitor=false'];

// ③.2.0-A5: a generous default stdout ceiling so a legal-but-large `diff --cached`
// (a multi-file fix) is captured rather than ENOBUFS-dropped at Node's 1MiB default;
// callers needing a tighter/looser bound pass opts.maxBuffer.
const DEFAULT_GIT_MAXBUFFER = MAX_PATCH_BYTES + 65536;
const DEFAULT_GIT_TIMEOUT_MS = 120000;

// ③.2.0-A4: a host-side clone byte ceiling. The `--network none` sandbox bounds the
// TEST run, NOT the clone; a hostile remote (huge history / packfile bomb / symlink-
// laden tree) is an unbounded host-side DoS. Enforced post-clone (git has no
// --max-size). Env-overridable; fail-safe to the default on absent/non-finite/<=0.
const DEFAULT_MAX_CLONE_BYTES = 1024 * 1024 * 1024; // 1 GiB sanity ceiling (a good-first-issue repo is << this)
function resolveMaxCloneBytes() {
  const raw = process.env.LOOM_MAX_CLONE_BYTES;
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_MAX_CLONE_BYTES;
}

// ③.2.0-A3: https-only by default. `file:`/`http:` are a local-file-read / downgrade
// lever once a clone's .git/config is attacker-influenced (the actor holds the Write
// tool); allow them ONLY behind allowFileProtocol (the allowLocalRepo path). `ext::`
// stays denied by GIT_HARDEN. The env still drops system/global config + the cred prompt.
function buildGitEnv({ allowFileProtocol = false } = {}) {
  return {
    ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ALLOW_PROTOCOL: allowFileProtocol ? 'file:https:http' : 'https',
  };
}
// Back-compat export: the secure (https-only) env snapshot.
const GIT_ENV = buildGitEnv();

// opts: { maxBuffer, timeout, allowFileProtocol }. Defaults preserve the prior posture
// (https-only protocol; the generous maxBuffer above; 120s timeout). Existing callers
// `git(args, cwd)` are unaffected (opts defaults to {}).
function git(args, cwd, opts = {}) {
  return execFileSync('git', [...GIT_HARDEN, ...args], {
    cwd, env: buildGitEnv(opts),
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: opts.timeout || DEFAULT_GIT_TIMEOUT_MS,
    maxBuffer: opts.maxBuffer || DEFAULT_GIT_MAXBUFFER,
  }).toString();
}

// ③.2.0-A4: sum regular-file bytes under dir, NO symlink-follow (lstat — a symlink is
// counted by its own small size, never traversed), early-exit + throw once > cap.
function assertDirWithinCap(dir, cap) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    let entries;
    const cur = stack.pop();
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      let st;
      try { st = fs.lstatSync(p); } catch { continue; }
      if (st.isSymbolicLink()) total += st.size;        // count the link, never follow it
      else if (st.isDirectory()) stack.push(p);
      else if (st.isFile()) total += st.size;
      if (total > cap) throw new Error(`prepareClone: cloned tree exceeds ${cap} bytes (clone-DoS bound)`);
    }
  }
  return total;
}

// A corpus-author-controlled repo / base_sha crosses into the host git flag
// parser; without a `--` separator a value like `-q` or `--upload-pack=...` is
// consumed as a FLAG (CWE-88 arg-injection on the UNSANDBOXED git). Validate
// the shape AND pass `--` at every call site. A host-LOCAL repo is denied by
// default (the prod path ingests remote URLs; a local path copies host files
// into a sandbox-readable dir) — opt in via the backend's allowLocalRepo.
//
// W4d A1 (SSRF): a REMOTE URL is no longer "always allowed" — it must be https
// to a host on the allowlist (github.com by default; LOOM_CLONE_HOST_ALLOWLIST
// or opts.hostAllowlist can widen it). The validation ORDER is load-bearing:
//   (1) the raw-string parser-differential guard (`@`/`\\`/non-printable) runs
//       BEFORE `new URL`, because WHATWG `new URL` NORMALIZES a `\@` differential
//       away (host=github.com under WHATWG, but libcurl/git resolves evil.com,
//       and the RAW string is what reaches `git clone`);
//   (2) `new URL` in try/catch (clean parse-failure message);
//   (3) https-only (TIGHTENED from http-OR-https);
//   (4) `url.hostname` (NOT `url.host` — no port differential; github.com:PORT
//       is intentionally permitted) must be on the allowlist.
// Every throw is VALUE-REDACTED: the message names the FAILED RULE, never the
// offending value, because it flows into a serialized report (a cred-bearing
// URL `user:pass@host` would otherwise leak).
function assertSafeRepo(repo, { allowLocal = false, hostAllowlist } = {}) {
  if (typeof repo !== 'string' || repo.length === 0) throw new Error('prepareClone: repo required');
  if (repo.startsWith('-')) throw new Error('prepareClone: repo may not start with "-" (arg-injection; value redacted)');
  const isLocal = path.isAbsolute(repo) || /^file:\/\//.test(repo);
  if (!isLocal) {
    // (1) parser-differential guard BEFORE new URL (it normalizes \@ away).
    if (/[@\\]/.test(repo) || /[^\x21-\x7e]/.test(repo)) throw new Error('prepareClone: repo must not contain userinfo/backslash/whitespace/control (value redacted)');
    let url;
    try { url = new URL(repo); } catch { throw new Error('prepareClone: repo is not a parseable URL (value redacted)'); } // (2)
    if (url.protocol !== 'https:') throw new Error('prepareClone: repo scheme must be https (value redacted)');           // (3)
    const allow = resolveHostAllowlist(hostAllowlist);
    if (!allow.has(url.hostname)) throw new Error('prepareClone: repo host not in the clone allowlist (value redacted)');  // (4)
    return repo;
  }
  if (!allowLocal) throw new Error('prepareClone: host-local repo requires allowLocalRepo (default off — remote URL expected; value redacted)');
  return repo;
}
// base_sha is REQUIRED: a backtest must pin clone@base (never the remote's
// default HEAD), else the run is a non-reproducible moving target.
function assertSafeSha(sha) {
  // FULL 40-char commit only (tightened from 7-40 — review feedback): the grading harness pins
  // clone@base for reproducibility, and an abbreviated sha grows ambiguous as a repo gains commits.
  // The committed corpus is all 40-char (probed); both the grader (prepareClone) and the actor clone
  // (real-solve) require this. (prepareClone ALSO post-verifies HEAD resolved to the commit, below.)
  if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) throw new Error(`assertSafeSha: base_sha must be a full 40-char lowercase hex commit: ${sha}`);
  return sha;
}
// `label` becomes a host filename BEFORE sandboxing — a `../` would escape
// .loom-patches into an arbitrary host write. Clamp to a basename-safe slug.
function assertSafeLabel(label) {
  const s = String(label == null ? 'patch' : label);
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(s)) throw new Error(`applyPatch: label must be a basename-safe slug [A-Za-z0-9_-]{1,40}: ${label}`);
  return s;
}

// Only ever rm -rf a path that canonicalizes strictly within the OS temp root —
// a discard must never be coerced into deleting outside the scoped sandbox tree.
function safeDiscard(target) {
  const real = canonicalize(target);
  if (!real || !isWithinRoot(real, TEMP_ROOT) || real === TEMP_ROOT) return false;
  fs.rmSync(real, { recursive: true, force: true });
  return true;
}

// clone@base_sha into a FRESH STANDALONE scoped temp. --no-hardlinks: a fresh
// standalone object store (never share the user's), so the sandboxed test can't
// read the user's whole history. `--` ends option parsing so repo can't be
// consumed as a flag. On a partial-clone failure, discard the scoped temp before
// re-throwing (don't leak it). Returns { workDir }.
async function prepareClone({ repo, base_sha, allowLocalRepo = false }) {
  assertSafeRepo(repo, { allowLocal: allowLocalRepo });
  assertSafeSha(base_sha); // REQUIRED — pin clone@base, never the remote default HEAD
  const isLocal = path.isAbsolute(repo) || /^file:\/\//.test(repo);
  const gitOpts = { allowFileProtocol: allowLocalRepo }; // A3: file: only for the opt-in local path
  const workDir = mkScoped('loom-clone-');
  try {
    // A4: --filter=blob:none on a REMOTE clone bounds the up-front blob fetch (blobs
    // lazy-fetch per checkout); skipped for a local clone (no partial-clone server). The
    // post-clone size cap below is the ENFORCED, portable DoS bound (git has no --max-size).
    const filterArgs = isLocal ? [] : ['--filter=blob:none'];
    git(['clone', '--no-hardlinks', '--quiet', ...filterArgs, '--', repo, workDir], os.tmpdir(), gitOpts);
    // NO `--` for checkout: `git checkout -- <x>` treats <x> as a PATHSPEC, not
    // a commit. assertSafeSha already guarantees base_sha is [0-9a-f]{40}
    // (can't be a flag), so the positional is safe without the separator. NO
    // `--detach` either: a full-40-char-SHA checkout ALWAYS detaches HEAD; the
    // HEAD re-verify below is the backstop (the actor paths' prior --detach was
    // redundant — VALIDATE F1).
    git(['checkout', '--quiet', base_sha], workDir, gitOpts);
    // Verify HEAD resolved to the intended COMMIT, not a hex-looking branch/tag
    // (git name resolution can match a ref). Reproducibility guard (VALIDATE CodeRabbit).
    const head = git(['rev-parse', '--verify', 'HEAD'], workDir, gitOpts).trim();
    if (!head.startsWith(base_sha)) throw new Error(`prepareClone: checkout resolved ${head}, expected base_sha ${base_sha}`);
    assertDirWithinCap(workDir, resolveMaxCloneBytes()); // A4: byte-bound the host-side tree
    // A1: snapshot the PRISTINE .git/config (post-clone, BEFORE any actor edits it) so
    // captureActorDiff can restore it — closing the actor-written filter-driver RCE.
    const configSnapshot = fs.readFileSync(path.join(workDir, '.git', 'config'), 'utf8');
    return { workDir, configSnapshot };
  } catch (e) {
    safeDiscard(workDir); // don't leak the scoped temp on a partial-clone / over-cap failure
    throw e;
  }
}

// Restore .git/config from the pristine snapshot, SYMLINK-SAFE (VALIDATE H1, CRITICAL). The actor
// holds the Write tool with cwd=workDir, so it can pre-replace .git/config with a SYMLINK to any host
// path; a bare writeFileSync would FOLLOW it and overwrite the victim with our config bytes (an
// unsandboxed host-integrity primitive). Open with O_NOFOLLOW so the syscall itself refuses an
// actor-planted symlink — atomic, no lstat->write TOCTOU. A fresh clone's .git/config is ALWAYS a
// regular file, so a symlink here is an attack, never legitimate (mirrors the read path's lstat-no-
// follow + the substrate's withRegularFileFd discipline). O_CREAT restores an actor-deleted config.
function restoreConfigNoFollow(cfgPath, configSnapshot) {
  const O = fs.constants;
  if (typeof O.O_NOFOLLOW === 'number') {
    let fd;
    try { fd = fs.openSync(cfgPath, O.O_WRONLY | O.O_CREAT | O.O_TRUNC | O.O_NOFOLLOW, 0o600); }
    catch (e) {
      if (e && e.code === 'ELOOP') throw new Error('captureActorDiff: .git/config is a symlink (actor host-overwrite attempt; refused)');
      throw e;
    }
    try { fs.writeFileSync(fd, configSnapshot); } finally { fs.closeSync(fd); }
    return;
  }
  // Fallback (no O_NOFOLLOW): lstat-reject — a residual TOCTOU window, platform-limited.
  let st = null;
  try { st = fs.lstatSync(cfgPath); } catch { /* absent -> create below */ }
  if (st && st.isSymbolicLink()) throw new Error('captureActorDiff: .git/config is a symlink (actor host-overwrite attempt; refused)');
  fs.writeFileSync(cfgPath, configSnapshot);
}

// ③.2.0-A1 (the C1 RCE close). The actor can poison .git/config with a `[filter "x"] clean=<sh>`
// driver that the harness's `git add -A` would execute on the HOST — proven live, and UNDER the full
// GIT_HARDEN set (filter drivers have no core.* kill-switch). Restore .git/config to the pristine
// post-clone snapshot FIRST (symlink-safe — H1): with the driver undefined, a poisoned
// `.gitattributes filter=x` is an inert no-op. Then stage + diff through the hardened git
// (core.attributesFile=/dev/null = belt-and-suspenders vs a global attributes file). The candidate is
// the staged WORKING-TREE delta — .git/ is never part of a diff, so restoring it does not perturb it.
//
// DEFERRED to ③.2.1a (a DIFFERENT trust boundary — the grader's apply+test path): the actor's
// `.gitattributes`/`.gitignore` FILE itself still rides into the captured candidate. ③.2.1a path-scopes
// the candidate diff to non-config paths; the GRADER must ALSO apply+test under
// core.attributesFile=/dev/null + a pristine config, else it inherits the smuggled attributes silently.
function captureActorDiff({ workDir, configSnapshot, maxBuffer } = {}) {
  if (typeof workDir !== 'string' || !workDir) throw new Error('captureActorDiff: workDir required');
  if (typeof configSnapshot !== 'string') throw new Error('captureActorDiff: configSnapshot (pristine .git/config) required');
  restoreConfigNoFollow(path.join(workDir, '.git', 'config'), configSnapshot); // A1 + H1: pristine restore, symlink-refused
  const opts = { maxBuffer: maxBuffer || DEFAULT_GIT_MAXBUFFER };
  git(['-c', 'core.attributesFile=/dev/null', 'add', '-A'], workDir, opts);
  return git(['-c', 'core.attributesFile=/dev/null', 'diff', '--cached'], workDir, opts);
}

// Write patch into .loom-patches/<label>.diff and `git apply --` it. git apply
// refuses `..`/symlink-through writes; `--` guards the patch-path positional
// from flag-injection; label -> basename-safe slug (no ../ host write).
async function applyPatch({ workDir, patch, label }) {
  if (!patch) return { ok: true, skipped: true };
  if (typeof patch !== 'string' && !Buffer.isBuffer(patch)) throw new Error('applyPatch: patch must be a string or Buffer');
  const patchBytes = Buffer.isBuffer(patch) ? patch.length : Buffer.byteLength(patch, 'utf8');
  if (patchBytes > MAX_PATCH_BYTES) throw new Error(`applyPatch: patch exceeds ${MAX_PATCH_BYTES} bytes (${patchBytes})`);
  const pdir = path.join(workDir, '.loom-patches');
  fs.mkdirSync(pdir, { recursive: true });
  const pfile = path.join(pdir, `${assertSafeLabel(label)}.diff`);
  fs.writeFileSync(pfile, patch);
  git(['apply', '--', pfile], workDir);
  return { ok: true };
}

module.exports = {
  mkScoped, git, GIT_HARDEN, GIT_ENV, buildGitEnv, TEMP_ROOT,
  assertSafeRepo, assertSafeSha, assertSafeLabel, safeDiscard,
  prepareClone, applyPatch, captureActorDiff,
  assertDirWithinCap, resolveMaxCloneBytes,
  DEFAULT_GIT_MAXBUFFER, DEFAULT_MAX_CLONE_BYTES,
  DEFAULT_REPO_HOST_ALLOWLIST, resolveHostAllowlist,
};
