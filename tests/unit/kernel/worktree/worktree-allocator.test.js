#!/usr/bin/env node

// tests/unit/kernel/worktree/worktree-allocator.test.js
//
// K1 worktree-allocator (PR 2 — ships DORMANT; library consumed by PR 4). Covers:
//   - escape-hatch composition (K10): LOOM_DISABLE_WORKTREE → no git, disabled mode
//   - success on first attempt
//   - retry-then-success (cleanup between attempts; backoff invoked)
//   - all attempts fail → "3 retries → escape hatch fires" + Class-4 audit
//   - CWE-78: git invoked via ARG ARRAY (no shell string / word-splitting)
//   - cleanupWorktree standalone (remove --force + prune)
//   - default ref = HEAD
//
// House test pattern: imperative assert + hand-rolled test() runner + exit code.
// git is fully injected (runGitFn) — no real git is ever invoked.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const k1 = require('../../../../packages/kernel/worktree/worktree-allocator');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}
function tmpLog() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'k1-')), 'audit.jsonl');
}
// Recording fake git: `script(args, callIndex)` returns a result object.
function makeRunGit(script) {
  const calls = [];
  const fn = (args) => { calls.push(args); return script(args, calls.length) || { ok: false, stderr: 'no-script' }; };
  fn.calls = calls;
  return fn;
}

// ── K10 escape-hatch composition ────────────────────────────────────────────

test('LOOM_DISABLE_WORKTREE → escape-hatch-disabled, NO git invoked, audited', () => {
  const log = tmpLog();
  const runGit = makeRunGit(() => ({ ok: true }));
  const r = k1.allocateWorktree({
    repoRoot: '/x', worktreePath: '/wt', ref: 'HEAD',
    env: { LOOM_DISABLE_WORKTREE: '1' }, runGitFn: runGit, auditLogPath: log,
  });
  assert.strictEqual(r.allocated, false);
  assert.strictEqual(r.mode, 'escape-hatch-disabled');
  assert.strictEqual(runGit.calls.length, 0, 'git must not run when worktree disabled');
  assert.ok(fs.existsSync(log), 'disabled decision must be audited');
});

// ── success / retry paths ───────────────────────────────────────────────────

test('success on first attempt → allocated, mode=worktree, attempts=1', () => {
  const runGit = makeRunGit(() => ({ ok: true }));
  const r = k1.allocateWorktree({ repoRoot: '/x', worktreePath: '/wt', ref: 'HEAD', env: {}, runGitFn: runGit });
  assert.strictEqual(r.allocated, true);
  assert.strictEqual(r.mode, 'worktree');
  assert.strictEqual(r.attempts, 1);
  assert.deepStrictEqual(runGit.calls[0], ['worktree', 'add', '/wt', 'HEAD']);
});

test('fails once then succeeds → attempts=2, cleanup between, one backoff', () => {
  let adds = 0;
  const runGit = makeRunGit((args) => {
    if (args[1] === 'add') { adds++; return { ok: adds >= 2 }; }
    return { ok: true }; // cleanup remove/prune succeed
  });
  const sleeps = [];
  const r = k1.allocateWorktree({
    repoRoot: '/x', worktreePath: '/wt', ref: 'HEAD', env: {},
    runGitFn: runGit, sleepFn: (a) => sleeps.push(a),
  });
  assert.strictEqual(r.allocated, true);
  assert.strictEqual(r.attempts, 2);
  assert.ok(runGit.calls.some((c) => c[1] === 'remove'), 'partial worktree cleanup (remove) ran');
  assert.ok(runGit.calls.some((c) => c[1] === 'prune'), 'cleanup prune ran');
  assert.strictEqual(sleeps.length, 1, 'exactly one backoff between the two attempts');
});

test('all attempts fail → 3 attempts then escape-hatch-failed + audit', () => {
  const log = tmpLog();
  const runGit = makeRunGit((args) => ({ ok: args[1] !== 'add', stderr: 'boom' })); // add always fails
  const r = k1.allocateWorktree({
    repoRoot: '/x', worktreePath: '/wt', ref: 'HEAD', env: {},
    runGitFn: runGit, maxAttempts: 3, auditLogPath: log, sleepFn: () => {},
  });
  assert.strictEqual(r.allocated, false);
  assert.strictEqual(r.mode, 'escape-hatch-failed');
  assert.strictEqual(r.attempts, 3);
  assert.strictEqual(runGit.calls.filter((c) => c[1] === 'add').length, 3, 'exactly 3 add attempts');
  assert.ok(fs.existsSync(log), 'failure must be audited');
});

// ── CWE-78: arg array, no shell ─────────────────────────────────────────────

test('CWE-78: git invoked via arg ARRAY — paths/refs are single argv elements', () => {
  const runGit = makeRunGit(() => ({ ok: true }));
  k1.allocateWorktree({
    repoRoot: '/x', worktreePath: '/path with spaces/wt', ref: 'feature/x; rm -rf /',
    env: {}, runGitFn: runGit,
  });
  const add = runGit.calls.find((c) => c[1] === 'add');
  assert.ok(Array.isArray(add), 'args must be an array');
  assert.strictEqual(add[2], '/path with spaces/wt', 'path is one argv element (no word-splitting)');
  assert.strictEqual(add[3], 'feature/x; rm -rf /', 'ref is one argv element (no shell interpretation)');
});

// ── cleanupWorktree standalone + defaults ───────────────────────────────────

test('cleanupWorktree runs `worktree remove --force` then `worktree prune`', () => {
  const runGit = makeRunGit(() => ({ ok: true }));
  const r = k1.cleanupWorktree({ repoRoot: '/x', worktreePath: '/wt', runGitFn: runGit });
  assert.strictEqual(r.cleaned, true);
  assert.deepStrictEqual(runGit.calls[0], ['worktree', 'remove', '--force', '/wt']);
  assert.deepStrictEqual(runGit.calls[1], ['worktree', 'prune']);
});

test('default ref is HEAD when not provided', () => {
  const runGit = makeRunGit(() => ({ ok: true }));
  k1.allocateWorktree({ repoRoot: '/x', worktreePath: '/wt', env: {}, runGitFn: runGit });
  assert.strictEqual(runGit.calls[0][3], 'HEAD');
});

process.stdout.write(`\nworktree-allocator.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
