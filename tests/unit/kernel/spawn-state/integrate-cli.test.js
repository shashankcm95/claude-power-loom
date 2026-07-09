#!/usr/bin/env node

// tests/unit/kernel/spawn-state/integrate-cli.test.js
//
// PR-P3c-c — the CLI composition root's argv parsing. The lib (integrateCandidates) is
// exhaustively tested in integrator.test.js; this pins the thin CLI surface: the flag
// parsing + the flag-eating guard (a mistyped --run-id must NOT silently mint against
// the wrong store — review-on-diff CR LOW) + the state-dir resolution.

'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { parseArgs, resolveStateDir, resolveGitDir } = require('../../../../packages/kernel/spawn-state/integrate-cli');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

test('C1 positional ids + flags parse correctly', () => {
  const r = parseArgs(['a', 'b', '--ref', 'refs/heads/x', '--root', '/repo', '--run-id', 'run-7', '--state-dir', '/state']);
  assert.deepStrictEqual(r.ids, ['a', 'b'], 'positional ids');
  assert.strictEqual(r.ref, 'refs/heads/x');
  assert.strictEqual(r.root, '/repo');
  assert.strictEqual(r.runId, 'run-7');
  assert.strictEqual(r.stateDir, '/state');
  assert.ok(!r.error, 'no error on a well-formed argv');
});

test('C2 bare ids only -> minting OFF (no runId)', () => {
  const r = parseArgs(['x', 'y', 'z']);
  assert.deepStrictEqual(r.ids, ['x', 'y', 'z']);
  assert.strictEqual(r.runId, undefined, 'no --run-id -> minting stays off');
});

test('C3 a flag with NO value -> error (not silently eaten)', () => {
  assert.ok(parseArgs(['a', '--run-id']).error, 'trailing --run-id -> error');
  assert.ok(parseArgs(['a', '--ref']).error, 'trailing --ref -> error');
});

test('C4 a flag followed by ANOTHER flag -> error (the next flag is not eaten as the value)', () => {
  const r = parseArgs(['a', '--run-id', '--root', '/repo']);
  assert.ok(r.error, 'a mistyped --run-id (followed by --root) must error, never mint against runId="--root"');
});

test('C5 resolveStateDir: explicit wins, then env, then the producer default', () => {
  assert.strictEqual(resolveStateDir('/explicit'), '/explicit', 'explicit --state-dir wins');
  const saved = process.env.LOOM_SPAWN_STATE_DIR;
  try {
    process.env.LOOM_SPAWN_STATE_DIR = '/from-env';
    assert.strictEqual(resolveStateDir(undefined), '/from-env', 'env var is the fallback');
    delete process.env.LOOM_SPAWN_STATE_DIR;
    assert.strictEqual(resolveStateDir(undefined), path.join(os.homedir(), '.claude', 'spawn-state'), 'producer default');
  } finally {
    if (saved === undefined) delete process.env.LOOM_SPAWN_STATE_DIR; else process.env.LOOM_SPAWN_STATE_DIR = saved;
  }
});

test('C6 an UNRECOGNIZED --flag is rejected, not absorbed as a positional id (#13)', () => {
  // A mistyped --reff (for --ref) used to fall through to ids as ["--reff","<value>"],
  // silently running against the DEFAULT ref. It must now error.
  const r = parseArgs(['a', '--reff', 'refs/heads/other', 'b']);
  assert.ok(r.error, 'unknown --reff must error');
  assert.ok(/unknown flag --reff/.test(r.error), `error should name the bad flag, got: ${r.error}`);
  // A well-formed argv with only known flags still parses (no false rejection).
  assert.ok(!parseArgs(['a', '--ref', 'refs/heads/x']).error, 'known flags still parse');
});

test('C7 resolveGitDir from a LINKED WORKTREE returns a real dir, not the .git FILE (#12)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'integrate-cli-wt-'));
  const g = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' });
  try {
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(repo);
    g(['init', '-q'], repo);
    g(['config', 'user.email', 't@t'], repo);
    g(['config', 'user.name', 't'], repo);
    g(['commit', '-q', '--allow-empty', '-m', 'init'], repo);
    const wt = path.join(tmp, 'wt');
    g(['worktree', 'add', '--detach', wt, 'HEAD'], repo);

    // Bug precondition: a linked worktree's `.git` is a FILE, so the old
    // path.join(wt,'.git','lock') resolved its dirname to that file and
    // acquireLock's mkdirSync EEXIST-failed -> opaque 'lock-error'.
    assert.ok(fs.statSync(path.join(wt, '.git')).isFile(), 'worktree .git is a FILE (bug precondition)');

    const gitDir = resolveGitDir(wt);
    assert.ok(fs.statSync(gitDir).isDirectory(), 'resolveGitDir must return a real directory');
    const lockPath = path.join(gitDir, 'loom-integration.lock');
    assert.ok(fs.statSync(path.dirname(lockPath)).isDirectory(), 'the lock parent dir must exist (mkdir would succeed)');
    // It is the SHARED common dir (repo/.git) — one integration lock per repo.
    assert.strictEqual(fs.realpathSync(gitDir), fs.realpathSync(path.join(repo, '.git')), 'common git dir == repo/.git');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

process.stdout.write(`\nintegrate-cli.test: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
