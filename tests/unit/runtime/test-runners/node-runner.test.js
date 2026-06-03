#!/usr/bin/env node

// tests/unit/runtime/test-runners/node-runner.test.js
//
// R12 (v3.2 Wave 2) — the node test-runner adapter. Covers the FROZEN result shape
// (R11 emits ADR-0015 failure_signature from it), the pass/fail/timeout/overflow
// outcomes, and the SECURITY guard (path-escape incl. the join-collapse case,
// no-shell argv, absolute-only contract). Fixtures are *.fixture.js (run via the
// adapter, never discovered as suites).
//
// ── UNSATISFIED v3.5 ACCEPTANCE CRITERIA (ContainerAdapter-tier) — tracked HERE so a
//    future runner-test author sees what R12 does NOT yet contain (anti-drift). The
//    R12 layer is best-effort; full closure needs a real sandbox (ADR-0012: the kernel
//    cannot wrap a subprocess). Canonical record: the plan's "Residual risks TRACKED to
//    the ContainerAdapter-tier" section + MEMORY's R12-residuals line. C2 (pipe-block
//    deadlock) is SATISFIED below; STILL OPEN — `grep "TODO(ARCH-" packages tests`:
//      TODO(ARCH-H1): true fs-sandbox so neither the residual sub-microsecond TOCTOU
//                     symlink race NOR an absolute-path write reaches host paths (cwd
//                     is not a chroot — the standing p-writescope reality).
//      TODO(ARCH-C1): hard output-DoS bound (a flood faster than the pipe drain) +
//                     process-GROUP reaping of detached grandchildren outliving SIGKILL.

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const node = require('../../../../packages/runtime/test-runners/node-runner');

const FIXTURES = path.join(__dirname, 'fixtures');
const fx = (name) => path.join(FIXTURES, name);

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    process.stdout.write(`  PASS ${name}\n`);
    passed++;
  } catch (err) {
    process.stdout.write(`  FAIL ${name}: ${err.message}\n`);
    failed++;
  }
}

// ---- detection (string-only; no I/O) ----

test('appliesTo: true for a .test.js node ctx (with or without explicit runner)', () => {
  assert.strictEqual(node.appliesTo({ testFile: '/a/x.test.js' }), true);
  assert.strictEqual(node.appliesTo({ testFile: '/a/x.test.js', runner: 'node' }), true);
});

test('appliesTo: false for non-.test.js, foreign runner, or junk', () => {
  assert.strictEqual(node.appliesTo({ testFile: '/a/x.py' }), false);
  assert.strictEqual(node.appliesTo({ testFile: '/a/x.test.js', runner: 'pytest' }), false);
  assert.strictEqual(node.appliesTo({ testFile: '/a/x.fixture.js' }), false);
  assert.strictEqual(node.appliesTo(null), false);
  assert.strictEqual(node.appliesTo({}), false);
});

// ---- buildCommand: no-shell proof ----

test('buildCommand returns an argv ARRAY (no shell) preserving metachars as one element', () => {
  const cmd = node.buildCommand({ testFile: '/abs/foo;rm -rf $(pwd).test.js', cwd: '/abs' });
  assert.strictEqual(cmd.cmd, 'node');
  assert.ok(Array.isArray(cmd.args), 'args must be an array');
  // The whole path — metachars and all — is a SINGLE argv element: a shell could
  // never split/expand it because execFileSync does not use a shell.
  assert.deepStrictEqual([...cmd.args], ['/abs/foo;rm -rf $(pwd).test.js']);
});

// ---- run(): outcomes ----

test('run(pass.fixture) -> passed:true, exitCode:0, reason:null', () => {
  const r = node.run({ testFile: fx('pass.fixture.js'), cwd: FIXTURES });
  assert.strictEqual(r.passed, true);
  assert.strictEqual(r.exitCode, 0);
  assert.strictEqual(r.signal, null);
  assert.strictEqual(r.timedOut, false);
  assert.strictEqual(r.reason, null);
  assert.match(r.stdout, /ok/);
  assert.strictEqual(r.stderr, '');
});

test('run(fail.fixture) -> passed:false, exitCode:1, stderr captured', () => {
  const r = node.run({ testFile: fx('fail.fixture.js'), cwd: FIXTURES });
  assert.strictEqual(r.passed, false);
  assert.strictEqual(r.exitCode, 1);
  assert.strictEqual(r.timedOut, false);
  assert.strictEqual(r.reason, null);
  assert.match(r.stderr, /boom/);
});

test('run(hang.fixture, timeoutMs) -> timedOut:true, exitCode:null, signal set', () => {
  const r = node.run({ testFile: fx('hang.fixture.js'), cwd: FIXTURES, timeoutMs: 600 });
  assert.strictEqual(r.passed, false);
  assert.strictEqual(r.timedOut, true);
  assert.strictEqual(r.exitCode, null);
  assert.ok(r.signal, 'a timeout-killed process should carry a signal');
  assert.strictEqual(r.reason, 'timeout');
});

test('run(overflow.fixture, small maxBuffer) -> output-overflow (NOT a silent fail)', () => {
  const r = node.run({ testFile: fx('overflow.fixture.js'), cwd: FIXTURES, maxBufferBytes: 1024 });
  assert.strictEqual(r.passed, false);
  assert.strictEqual(r.reason, 'output-overflow');
  assert.strictEqual(r.exitCode, null);
});

// ---- result shape: frozen + always-string stdout/stderr (R11 contract) ----

test('result is frozen with the full 7-field shape; stdout/stderr always strings', () => {
  const r = node.run({ testFile: fx('fail.fixture.js'), cwd: FIXTURES });
  assert.ok(Object.isFrozen(r), 'result must be frozen (immutability)');
  for (const k of ['passed', 'exitCode', 'signal', 'stdout', 'stderr', 'timedOut', 'reason']) {
    assert.ok(k in r, `result must carry ${k}`);
  }
  assert.strictEqual(typeof r.stdout, 'string');
  assert.strictEqual(typeof r.stderr, 'string');
});

// ---- security guard ----

test('run rejects an absolute testFile OUTSIDE cwd (absolute-outside-root)', () => {
  assert.throws(
    () => node.run({ testFile: '/etc/passwd', cwd: FIXTURES }),
    /refusing to run|absolute-outside-root|escapes-root/,
  );
});

test('run rejects the join-collapse traversal case (literal ".." in an absolute path)', () => {
  // A path that WOULD escape if normalized; the raw-token belt catches the literal
  // `..` BEFORE any collapse can blind the containment check.
  const evil = FIXTURES + '/../../../etc/passwd';
  assert.throws(() => node.run({ testFile: evil, cwd: FIXTURES }), /traversal-markers|refusing to run/);
});

test('run rejects a relative testFile (absolute-only contract)', () => {
  assert.throws(
    () => node.run({ testFile: 'pass.fixture.js', cwd: FIXTURES }),
    /test-file-not-absolute|refusing to run/,
  );
});

test('run rejects a non-absolute cwd', () => {
  assert.throws(
    () => node.run({ testFile: fx('pass.fixture.js'), cwd: 'relative/dir' }),
    /cwd-not-absolute|refusing to run/,
  );
});

test('run throws on a missing (but in-scope) test file — distinct from a fail', () => {
  assert.throws(
    () => node.run({ testFile: fx('does-not-exist.test.js'), cwd: FIXTURES }),
    /does not exist/,
  );
});

// ---- VALIDATE folds (hacker C1/H1/M1/M2 + reviewer L6) ----

test('M1: a leaf self-SIGKILL is reason:killed-by-signal, NOT timeout', () => {
  const r = node.run({ testFile: fx('selfkill.fixture.js'), cwd: FIXTURES, timeoutMs: 30000 });
  assert.strictEqual(r.passed, false);
  assert.strictEqual(r.timedOut, false, 'a fast self-kill must NOT be laundered into the timeout bucket');
  assert.strictEqual(r.reason, 'killed-by-signal');
  assert.ok(r.signal, 'the kill signal must be captured for R11');
});

test('C1: pass/fail follows the EXIT CODE even when output floods past the buffer', () => {
  // A flooding test that exits 1 is still a FAIL (no forge-a-green); output is
  // truncated (ContainerAdapter-tier to fully capture) but integrity is preserved.
  const r = node.run({ testFile: fx('floodfail.fixture.js'), cwd: FIXTURES });
  assert.strictEqual(r.passed, false);
  assert.strictEqual(r.exitCode, 1);
});

test('H1: a symlinked test file is rejected at exec (TOCTOU window-narrowing)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r12-toctou-'));
  try {
    const target = path.join(tmp, 'target.js');
    const link = path.join(tmp, 'link.js');
    fs.writeFileSync(target, 'process.exit(0);\n');
    fs.symlinkSync(target, link); // a symlink INSIDE cwd → checkWithinRoot passes, lstat rejects
    assert.throws(
      () => node.run({ testFile: link, cwd: tmp }),
      /symlink/i,
      'a symlinked testFile must be rejected even though it resolves within cwd',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('M2: the child gets least-privilege env (parent SECRET scrubbed; ctx.env passed)', () => {
  const prev = process.env.LOOM_SECRET;
  process.env.LOOM_SECRET = 'topsecret-token';
  try {
    const r = node.run({
      testFile: fx('env.fixture.js'), cwd: FIXTURES, env: { LOOM_DECLARED: 'yes' },
    });
    assert.strictEqual(r.passed, true);
    assert.match(r.stdout, /SECRET=\|/, 'the parent secret must NOT reach the child');
    assert.match(r.stdout, /DECLARED=yes/, 'a declared ctx.env var SHOULD reach the child');
  } finally {
    if (prev === undefined) delete process.env.LOOM_SECRET; else process.env.LOOM_SECRET = prev;
  }
});

test('C2: a pipe-pressured child that hangs is bounded by the timeout (no deadlock)', () => {
  // The child fills the OS pipe (1 MiB > 64 KiB) then hangs forever. spawnSync drains
  // the pipe concurrently AND the wall-clock timeout SIGKILLs it — so run() returns
  // within ~timeout, never deadlocking on an un-drained pipe (user residual-risk C2).
  const startedAt = Date.now();
  const r = node.run({ testFile: fx('pipeblock.fixture.js'), cwd: FIXTURES, timeoutMs: 600 });
  const elapsed = Date.now() - startedAt;
  assert.strictEqual(r.passed, false);
  assert.strictEqual(r.timedOut, true, 'a pipe-blocked hang must be killed by the timeout');
  assert.strictEqual(r.reason, 'timeout');
  assert.ok(elapsed < 5000, `must return promptly near the timeout, not hang (elapsed ${elapsed}ms)`);
});

test('L6: run throws when testFile is a directory (not a regular file)', () => {
  assert.throws(
    () => node.run({ testFile: FIXTURES, cwd: path.dirname(FIXTURES) }),
    /not a regular file|refusing to run/,
  );
});

process.stdout.write(`\nnode-runner.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
