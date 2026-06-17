#!/usr/bin/env node

// tests/unit/lab/issue-corpus/docker-backend.test.js
//
// v3.0 (Docker wave) — the PURE half of the Docker containment backend. NO
// `docker`, NO daemon, NO child_process EXECUTION — CI-green on Linux. The
// impure backend (docker-backend.js) lives OUTSIDE tests/unit/**; its live
// containment is proven by _spike/docker-containment-spike.js (re-run at
// VALIDATE), NOT here. This tier pins the VERIFY-folded design:
//   - H1: assertSafeMountPath rejects ":" / "," / whitespace / leading "-" / relative
//   - H1: buildDockerRunArgs uses --mount long-form (not positional -v src:dst)
//   - H2: classifyRun routes killedForDos -> KILLED_FOR_DOS (the OOM path)
//   - H3/H4: the flag set carries --init + --user + --cap-drop ALL + no-new-privileges
//   - ARCH-1: an un-attested Docker backend is SKIPPED by sync selectBackend
//   - ARCH-2: the shared _clone-lifecycle rejects the case-8 arg-injection vectors

'use strict';

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const ISSUE = path.join(REPO, 'packages', 'lab', 'issue-corpus');
const D = require(path.join(ISSUE, 'docker-backend.js'));
const A = require(path.join(ISSUE, 'container-adapter.js'));
const CL = require(path.join(ISSUE, '_clone-lifecycle.js'));
const {
  buildDockerRunArgs, assertSafeMountPath, assertSafeName, hostUser, dockerName, DEFAULT_IMAGE,
} = D;
const { classifyRun, selectBackend, selectAttestedBackend, RESULT_CLASS, STARTUP_SENTINEL } = A;

let passed = 0; let failed = 0;
const _asyncTests = [];
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}
function atest(name, fn) {
  _asyncTests.push((async () => {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
  })());
}
function throws(fn) { assert.throws(fn); }
// value that follows the FIRST occurrence of `flag` in an argv array.
function valAfter(args, flag) { const i = args.indexOf(flag); return i === -1 ? undefined : args[i + 1]; }

// --------------------------------------------------------------------------
// H1 — assertSafeMountPath (the mount-spec injection guard).
// --------------------------------------------------------------------------

test('H1 assertSafeMountPath accepts a clean absolute path', () => {
  assert.strictEqual(assertSafeMountPath('/private/tmp/loom-clone-abc123'), '/private/tmp/loom-clone-abc123');
});
test('H1 assertSafeMountPath REJECTS a colon (the -v src:dst split)', () => throws(() => assertSafeMountPath('/tmp/a:b')));
test('H1 assertSafeMountPath REJECTS a comma (the --mount key=val split)', () => throws(() => assertSafeMountPath('/tmp/a,b')));
test('H1 assertSafeMountPath REJECTS a space', () => throws(() => assertSafeMountPath('/tmp/a b')));
test('H1 assertSafeMountPath REJECTS a tab', () => throws(() => assertSafeMountPath('/tmp/a\tb')));
test('H1 assertSafeMountPath REJECTS a relative path', () => throws(() => assertSafeMountPath('tmp/x')));
test('H1 assertSafeMountPath REJECTS empty', () => throws(() => assertSafeMountPath('')));

// --------------------------------------------------------------------------
// H1/H3/H4 — buildDockerRunArgs (the containment flag set).
// --------------------------------------------------------------------------

const ARGS = buildDockerRunArgs({
  image: DEFAULT_IMAGE, workDir: '/private/tmp/loom-clone-x', command: 'python3',
  argv: ['-c', 'print(1)'], name: 'loom-run-deadbeefdeadbeef',
});

test('H3 flag set includes --init (PID-1 reaper)', () => assert.ok(ARGS.includes('--init')));
test('flag set denies network (--network none)', () => assert.strictEqual(valAfter(ARGS, '--network'), 'none'));
test('H2 mem bound: --memory == --memory-swap (no swap escape)', () => {
  assert.strictEqual(valAfter(ARGS, '--memory'), valAfter(ARGS, '--memory-swap'));
  assert.ok(valAfter(ARGS, '--memory'));
});
test('pids + cpu bounds present', () => {
  assert.ok(valAfter(ARGS, '--pids-limit'));
  assert.ok(valAfter(ARGS, '--cpus'));
});
test('H4 cap-drop ALL + no-new-privileges + non-root --user', () => {
  assert.strictEqual(valAfter(ARGS, '--cap-drop'), 'ALL');
  assert.strictEqual(valAfter(ARGS, '--security-opt'), 'no-new-privileges');
  assert.ok(/^\d+:\d+$/.test(valAfter(ARGS, '--user')));
});
test('read-only root + tmpfs /tmp', () => {
  assert.ok(ARGS.includes('--read-only'));
  assert.ok(String(valAfter(ARGS, '--tmpfs')).startsWith('/tmp:'));
});
test('H1 uses --mount long-form (type=bind,source=,destination=/work), NOT -v', () => {
  assert.strictEqual(valAfter(ARGS, '--mount'), 'type=bind,source=/private/tmp/loom-clone-x,destination=/work');
  assert.ok(!ARGS.includes('-v'));
  assert.strictEqual(valAfter(ARGS, '-w'), '/work');
});
test('no --rm (the OOMKilled inspect needs the container post-exit)', () => assert.ok(!ARGS.includes('--rm')));
test('startup sentinel is echoed FIRST in the sh wrapper', () => {
  const wi = ARGS.indexOf('-c');
  const wrapper = ARGS[wi + 1];
  assert.ok(wrapper.includes(`echo ${STARTUP_SENTINEL}`));
  assert.ok(wrapper.includes('exec "$@"'));
});
test('command + argv ride positionally after the image (no shell splice)', () => {
  const tail = ARGS.slice(ARGS.indexOf(DEFAULT_IMAGE));
  assert.deepStrictEqual(tail, [DEFAULT_IMAGE, 'sh', '-c', tail[3], 'sh', 'python3', '-c', 'print(1)']);
});
test('H1 buildDockerRunArgs throws on an injected workDir (colon)', () => throws(() => buildDockerRunArgs({
  image: DEFAULT_IMAGE, workDir: '/tmp/a:b', command: 'sh', name: 'loom-run-aa',
})));
test('H1 buildDockerRunArgs tags the owner pid (--label loom-owner, for reapOrphans)', () => {
  assert.strictEqual(valAfter(ARGS, '--label'), `loom-owner=${process.pid}`);
});
test('L1 buildDockerRunArgs REJECTS network other than the allow-list (no --network host)', () => throws(() => buildDockerRunArgs({
  image: DEFAULT_IMAGE, workDir: '/tmp/x', command: 'sh', name: 'loom-run-aa', network: 'host',
})));
test('L1 buildDockerRunArgs REJECTS a tmpfsSize carrying an injected option', () => throws(() => buildDockerRunArgs({
  image: DEFAULT_IMAGE, workDir: '/tmp/x', command: 'sh', name: 'loom-run-aa', tmpfsSize: '256m,exec',
})));
test('L1 buildDockerRunArgs accepts a bare tmpfsSize', () => {
  const a = buildDockerRunArgs({ image: DEFAULT_IMAGE, workDir: '/tmp/x', command: 'sh', name: 'loom-run-aa', tmpfsSize: '128m' });
  assert.ok(a.includes('/tmp:rw,nosuid,nodev,size=128m'));
});

// --------------------------------------------------------------------------
// --name + helpers.
// --------------------------------------------------------------------------

test('assertSafeName accepts a CSPRNG loom name, rejects a flag/colon', () => {
  assert.ok(assertSafeName('loom-run-deadbeefdeadbeef'));
  throws(() => assertSafeName('-rm'));
  throws(() => assertSafeName('loom:run'));
});
test('dockerName is argv-safe + matches assertSafeName', () => {
  const n = dockerName();
  assert.ok(/^loom-run-[a-f0-9]{16}$/.test(n));
  assert.strictEqual(assertSafeName(n), n);
});
test('hostUser is uid:gid', () => assert.ok(/^\d+:\d+$/.test(hostUser())));

// --------------------------------------------------------------------------
// H2 — classifyRun routes the OOM (killedForDos) path.
// --------------------------------------------------------------------------

test('H2 killedForDos (OOM, timedOut=false, exit 137) -> KILLED_FOR_DOS', () => {
  assert.strictEqual(classifyRun({ killedForDos: true, timedOut: false, sentinelSeen: true, exitCode: 137 }), RESULT_CLASS.KILLED_FOR_DOS);
});
test('H2 a wall-clock timeout still -> KILLED_FOR_DOS (unchanged)', () => {
  assert.strictEqual(classifyRun({ timedOut: true }), RESULT_CLASS.KILLED_FOR_DOS);
});
test('H2 a non-OOM test FAILURE (exit 1, no DoS flag) -> CONTAINED_RESULT (not mis-killed)', () => {
  assert.strictEqual(classifyRun({ killedForDos: false, timedOut: false, sentinelSeen: true, exitCode: 1 }), RESULT_CLASS.CONTAINED_RESULT);
});

// --------------------------------------------------------------------------
// ARCH-1 — selection: sync skips un-attested Docker; async attests.
// --------------------------------------------------------------------------

test('ARCH-1 sync selectBackend SKIPS an un-attested backend (fail-closed)', () => {
  assert.strictEqual(selectBackend({ backends: [{ name: 'x', containmentAttested: false }] }), null);
});
test('sync selectBackend returns an already-attested backend', () => {
  const b = { name: 'x', containmentAttested: true };
  assert.strictEqual(selectBackend({ backends: [b] }), b);
});
test('ARCH-1 env=docker, un-attested -> sync selectBackend returns null (cached-boolean getter)', () => {
  assert.strictEqual(selectBackend({ env: { LOOM_SANDBOX_BACKEND: 'docker' } }), null);
});
atest('ARCH-1 selectAttestedBackend awaits attest() then returns the now-attested backend', async () => {
  const fake = { name: 'fake', _a: false, get containmentAttested() { return this._a; }, async attest() { this._a = true; } };
  const got = await selectAttestedBackend({ backends: [fake] });
  assert.strictEqual(got, fake);
});
atest('selectAttestedBackend returns null when attest leaves it un-attested', async () => {
  const fake = { name: 'fake', get containmentAttested() { return false; }, async attest() { /* still false */ } };
  assert.strictEqual(await selectAttestedBackend({ backends: [fake] }), null);
});

// --------------------------------------------------------------------------
// ARCH-2 — the shared _clone-lifecycle rejects the case-8 arg-injection vectors.
// --------------------------------------------------------------------------

test('ARCH-2 assertSafeSha rejects a flag-shaped sha', () => throws(() => CL.assertSafeSha('-q')));
test('ARCH-2 assertSafeSha rejects too-short / requires hex', () => { throws(() => CL.assertSafeSha('abc')); assert.ok(CL.assertSafeSha('a'.repeat(40))); });
test('ARCH-2 assertSafeRepo rejects a leading-dash (--upload-pack) repo', () => throws(() => CL.assertSafeRepo('--upload-pack=touch /tmp/pwn')));
test('ARCH-2 assertSafeRepo rejects ext:: transport', () => throws(() => CL.assertSafeRepo('ext::sh -c touch /tmp/pwn')));
test('ARCH-2 assertSafeRepo denies a local path by default, allows with allowLocal', () => {
  throws(() => CL.assertSafeRepo('/tmp/x'));
  assert.ok(CL.assertSafeRepo('/tmp/x', { allowLocal: true }));
  assert.ok(CL.assertSafeRepo('https://example.com/r.git'));
});
test('ARCH-2 assertSafeLabel rejects ../ traversal', () => throws(() => CL.assertSafeLabel('../evil')));

// VALIDATE #2 — the patch-size/type guard (rejects BEFORE the host-side write).
atest('VALIDATE#2 applyPatch rejects a non-string patch', async () => {
  await assert.rejects(() => CL.applyPatch({ workDir: '/tmp/loom-no-such-dir', patch: 12345, label: 'x' }));
});
atest('VALIDATE#2 applyPatch rejects an oversized patch', async () => {
  await assert.rejects(() => CL.applyPatch({ workDir: '/tmp/loom-no-such-dir', patch: 'x'.repeat(6 * 1024 * 1024), label: 'x' }));
});
test('VALIDATE#11 docker-backend exports reapOrphans', () => assert.strictEqual(typeof D.reapOrphans, 'function'));

Promise.all(_asyncTests).then(() => {
  process.stdout.write(`\ndocker-backend pure: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
});
