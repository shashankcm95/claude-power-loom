#!/usr/bin/env node

// tests/unit/kernel/_lib/invoke-git.test.js
//
// Shared no-shell git invoker (PR 3 DRY extraction — architect HIGH).
//
// K1 (worktree-allocator) and K9 (promote-deltas) both consumed a byte-for-byte
// identical runGitDefault. The duplicate was extracted into
// packages/kernel/_lib/invoke-git.js so the security-load-bearing primitive (the
// no-shell execFile arg-array git call) lives in exactly ONE place — a future
// CWE-78 hardening can never be applied to one copy and missed in the other.
//
// This test pins (a) the {ok,code,stdout,stderr} contract via a real git call,
// (b) that BOTH K1 and K9 source the runner from the shared module (no local
// copy survives), and (c) the never-throws + bounded-stderr discipline.
//
// House test pattern: imperative assert + hand-rolled runner + exit code.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { runGitDefault } = require('../../../../packages/kernel/_lib/invoke-git');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

function gitAvailable() {
  try { execFileSync('git', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] }); return true; }
  catch { return false; }
}

// ── contract shape ──────────────────────────────────────────────────────────

test('runGitDefault returns {ok,code,stdout,stderr} and never throws on a bad cwd', () => {
  const res = runGitDefault('/nonexistent-dir-xyz-12345', ['status']);
  assert.strictEqual(typeof res, 'object');
  assert.strictEqual(res.ok, false, 'a failing git call must report ok:false, not throw');
  assert.strictEqual(typeof res.code, 'number');
  assert.strictEqual(typeof res.stdout, 'string');
  assert.strictEqual(typeof res.stderr, 'string');
});

test('runGitDefault caps stderr at 500 chars (no unbounded result bloat)', () => {
  const res = runGitDefault('/nonexistent-dir-xyz-12345', ['status']);
  assert.ok(res.stderr.length <= 500, `stderr must be bounded, got ${res.stderr.length}`);
});

test('runGitDefault [real git]: a successful invocation reports ok + stdout', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const res = runGitDefault(os.tmpdir(), ['--version']);
  assert.strictEqual(res.ok, true, 'git --version must succeed');
  assert.ok(/git version/.test(res.stdout), `stdout must carry the version, got ${JSON.stringify(res.stdout)}`);
});

// ── DRY: both K1 and K9 consume the shared module (no surviving local copy) ──

test('DRY: worktree-allocator (K1) imports the shared invoke-git (no local runGitDefault def)', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', 'packages', 'kernel', 'worktree', 'worktree-allocator.js'),
    'utf8'
  );
  assert.ok(/require\(['"][^'"]*invoke-git['"]\)/.test(src), 'K1 must import _lib/invoke-git');
  assert.ok(!/function runGitDefault\s*\(/.test(src), 'K1 must NOT define its own runGitDefault (extracted)');
});

test('DRY: k9-promote-deltas imports the shared invoke-git (no local runGitDefault def)', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', 'packages', 'kernel', '_lib', 'k9-promote-deltas.js'),
    'utf8'
  );
  assert.ok(/require\(['"]\.\/invoke-git['"]\)/.test(src), 'K9 must import ./invoke-git');
  assert.ok(!/function runGitDefault\s*\(/.test(src), 'K9 must NOT define its own runGitDefault (extracted)');
});

test('DAG: invoke-git is a leaf (no kernel imports — only child_process)', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', 'packages', 'kernel', '_lib', 'invoke-git.js'),
    'utf8'
  );
  // The only require is child_process; no kernel module is imported (so it
  // cannot create a cycle in either K1's or K9's DAG).
  const requires = (src.match(/require\(([^)]*)\)/g) || []);
  assert.deepStrictEqual(requires, ["require('child_process')"], `unexpected imports: ${JSON.stringify(requires)}`);
});

// ── PR-3c-a: the optional extraEnv 3rd param (additive, backward-compatible) ──
//
// quarantine-promote.materializeDelta squashes a spawn's delta into a TEMP index
// (so the worktree's real .git/index is never touched). The temp index is
// selected via GIT_INDEX_FILE — which the runner must forward into the child
// git's env. PR-3c-a adds `runGitDefault(repoRoot, args, extraEnv)`: extraEnv is
// merged AFTER the locale pins, so a caller can inject GIT_INDEX_FILE without
// disturbing LANG/LC_ALL. The two assertions below pin (a) the round-trip — a
// staged add against a temp index leaves the worktree's REAL index clean — and
// (b) backward-compat: the existing 2-arg call shape is unaffected.

// A throwaway one-commit git repo for the env round-trip; returns {repo, g} or
// null when git is unavailable. Mirrors the transaction-loop initRepo pattern.
function initTinyRepo() {
  if (!gitAvailable()) return null;
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-invokegit-env-'));
  const g = (args) => execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  g(['init', '-q']);
  g(['config', 'user.email', 'loom-invokegit@example.invalid']);
  g(['config', 'user.name', 'loom-invokegit']);
  g(['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(repo, 'base.txt'), 'base\n');
  g(['add', 'base.txt']); g(['commit', '-q', '-m', 'base']);
  return { repo, g };
}

test('runGitDefault [real git]: extraEnv GIT_INDEX_FILE round-trips — staging to a temp index leaves the real index clean', () => {
  const ctx = initTinyRepo();
  if (!ctx) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const { repo, g } = ctx;
  const tmpIndex = path.join(os.tmpdir(), `loom-idx-${process.pid}-${Date.now()}`);
  try {
    // A new uncommitted file...
    fs.writeFileSync(path.join(repo, 'staged-into-temp.txt'), 'temp\n');
    // ...added via a TEMP index selected by the injected GIT_INDEX_FILE.
    const add = runGitDefault(repo, ['add', '-A'], { GIT_INDEX_FILE: tmpIndex });
    assert.strictEqual(add.ok, true, `add against temp index must succeed, got ${JSON.stringify(add)}`);

    // The injected env routed staging to the temp index: it was created on disk.
    assert.ok(fs.existsSync(tmpIndex), 'GIT_INDEX_FILE must have been honored (temp index created)');
    // The temp index actually carries the staged file.
    const lsTmp = runGitDefault(repo, ['ls-files'], { GIT_INDEX_FILE: tmpIndex });
    assert.ok(/staged-into-temp\.txt/.test(lsTmp.stdout), 'temp index must list the staged file');

    // The worktree's REAL index is untouched: a plain (2-arg) status shows the
    // file still untracked because the real index never saw the `add`.
    const status = runGitDefault(repo, ['status', '--porcelain']);
    assert.ok(/\?\?\s+staged-into-temp\.txt/.test(status.stdout),
      `real index must be clean (file still untracked); got status: ${JSON.stringify(status.stdout)}`);
    void g;
  } finally {
    fs.rmSync(tmpIndex, { force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('runGitDefault [real git]: a 2-arg call still works (extraEnv is optional — backward-compat)', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const res = runGitDefault(os.tmpdir(), ['--version']);
  assert.strictEqual(res.ok, true, 'the existing 2-arg call shape must remain valid');
  assert.ok(/git version/.test(res.stdout), 'a 2-arg call must still capture stdout');
});

process.stdout.write(`\ninvoke-git.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
