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

function mkScoped(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

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
function assertSafeRepo(repo, { allowLocal = false } = {}) {
  if (typeof repo !== 'string' || repo.length === 0) throw new Error('prepareClone: repo required');
  if (repo.startsWith('-')) throw new Error(`prepareClone: repo may not start with "-" (arg-injection): ${repo}`);
  if (/^https?:\/\//.test(repo)) return repo;                       // remote URL — always allowed
  const isLocal = path.isAbsolute(repo) || /^file:\/\//.test(repo);
  if (!isLocal) throw new Error(`prepareClone: repo must be http(s):// (or, with allowLocalRepo, an absolute path / file:// URL): ${repo}`);
  if (!allowLocal) throw new Error('prepareClone: host-local repo requires allowLocalRepo (default off — remote URL expected)');
  return repo;
}
// base_sha is REQUIRED: a backtest must pin clone@base (never the remote's
// default HEAD), else the run is a non-reproducible moving target.
function assertSafeSha(sha) {
  if (typeof sha !== 'string' || !/^[0-9a-f]{7,40}$/.test(sha)) throw new Error(`prepareClone: base_sha required, must be 7-40 lowercase hex: ${sha}`);
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
    // a commit. assertSafeSha already guarantees base_sha is [0-9a-f]{7,40}
    // (can't be a flag), so the positional is safe without the separator.
    git(['checkout', '--quiet', base_sha], workDir);
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
};
