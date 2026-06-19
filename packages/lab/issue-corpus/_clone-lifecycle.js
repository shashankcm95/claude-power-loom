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

// HARDEN neutralizes repo-side hooks + ext-transport + fsmonitor, and the env
// drops system/global config + the credential prompt, for every git call here.
const GIT_HARDEN = ['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.ext.allow=never', '-c', 'core.fsmonitor=false'];
const GIT_ENV = {
  ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: 'file:https:http',
};

function git(args, cwd) {
  return execFileSync('git', [...GIT_HARDEN, ...args], { cwd, env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 }).toString();
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
  const workDir = mkScoped('loom-clone-');
  try {
    git(['clone', '--no-hardlinks', '--quiet', '--', repo, workDir], os.tmpdir());
    // NO `--` for checkout: `git checkout -- <x>` treats <x> as a PATHSPEC, not
    // a commit. assertSafeSha already guarantees base_sha is [0-9a-f]{40}
    // (can't be a flag), so the positional is safe without the separator.
    git(['checkout', '--quiet', base_sha], workDir);
    // Verify HEAD resolved to the intended COMMIT, not a hex-looking branch/tag
    // (git name resolution can match a ref). Reproducibility guard (VALIDATE CodeRabbit).
    const head = git(['rev-parse', '--verify', 'HEAD'], workDir).trim();
    if (!head.startsWith(base_sha)) throw new Error(`prepareClone: checkout resolved ${head}, expected base_sha ${base_sha}`);
  } catch (e) {
    safeDiscard(workDir); // don't leak the scoped temp on a partial-clone failure
    throw e;
  }
  return { workDir };
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
  mkScoped, git, GIT_HARDEN, GIT_ENV, TEMP_ROOT,
  assertSafeRepo, assertSafeSha, assertSafeLabel, safeDiscard,
  prepareClone, applyPatch,
  DEFAULT_REPO_HOST_ALLOWLIST, resolveHostAllowlist,
};
