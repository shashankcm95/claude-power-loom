#!/usr/bin/env node

// tests/unit/lab/issue-corpus/container-adapter.test.js
//
// v3.9 W1 — the ContainerAdapter pure-orchestration contract (the RED set).
// MockBackend-ONLY: NO sandbox-exec, NO child_process, NO git — CI-green on
// Linux. The impure macOS backend (sandbox-exec-backend.js) lives OUTSIDE
// tests/unit/** so this tier never auto-globs it; its containment is proven by
// the green-or-block spike (_spike/containment-spike.js), re-run at VALIDATE.
//
// Pins: profile-gen realpath-canonicalization (the D2 CRITICAL: /tmp ->
// /private/tmp), injection-safe profile paths, the D1.5 result taxonomy
// (default-unknown => SETUP_FAILURE => refuse), the clone->candidate->test->
// run->discard lifecycle ORDER (never touches HEAD), fail-closed on
// no-attestation + on backend-throw (discard still runs), and the test-status
// parse + outcome evaluation.

'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const A = require(path.join(REPO, 'packages', 'lab', 'issue-corpus', 'container-adapter.js'));
const {
  buildSandboxProfile, assertSafeProfilePath, classifyRun, parseTestStatus, evaluateOutcome,
  selectBackend, ContainerAdapter, RESULT_CLASS, LOOM_TEST_RESULT_PREFIX,
} = A;

let passed = 0; let failed = 0;
const _asyncTests = [];
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}
// Queue async tests so the summary waits for ALL of them (a dropped promise
// would print "0 failed" before an async assertion rejected).
function atest(name, fn) {
  _asyncTests.push((async () => {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
  })());
}

// A MockBackend that records an ordered call log + returns scripted results.
// It NEVER executes anything — it is the seam that keeps the pure orchestration
// testable on Linux.
class MockBackend {
  constructor({ containmentAttested = true, runResult = null, throwOn = null, name = 'mock' } = {}) {
    this.containmentAttested = containmentAttested;
    this.name = name;
    this._runResult = runResult || { spawnThrew: false, timedOut: false, sentinelSeen: true, exitCode: 0, stdout: '', stderr: '' };
    this._throwOn = throwOn; // a method name that should throw (backend-throw path)
    this.calls = [];
  }
  _maybeThrow(m) { if (this._throwOn === m) throw new Error('mock-throw:' + m); }
  async prepareClone({ repo }) { this.calls.push('prepareClone'); this._maybeThrow('prepareClone'); return { workDir: '/tmp/mock-clone-' + repo.replace(/\W/g, '_') }; }
  async applyPatch({ label }) { this.calls.push('applyPatch:' + label); this._maybeThrow('applyPatch'); return { ok: true }; }
  async runTests() { this.calls.push('runTests'); this._maybeThrow('runTests'); return this._runResult; }
  async discard() { this.calls.push('discard'); /* discard never throws fatally */ }
  // a HEAD-mutation method that MUST never be called (lifecycle is read-mostly).
  async touchHead() { this.calls.push('touchHead'); }
}

const RECORD = { repo: 'octo/widget', base_sha: 'a'.repeat(40), candidate_patch: 'CAND', test_patch: 'TEST', test_ids: ['t1', 't2'] };

// --------------------------------------------------------------------------
// Profile generation — canonicalization + injection-safety + the shape.
// --------------------------------------------------------------------------

test('profile: realpath-canonicalizes allow-paths (/tmp -> /private/tmp on macOS)', () => {
  // On macOS /tmp is a symlink to /private/tmp; on Linux /tmp is itself. The
  // assertion is "the emitted allow-path is the realpath", checked dynamically.
  const fs = require('fs');
  const real = fs.realpathSync(os.tmpdir());
  const probe = path.join(os.tmpdir(), 'loom-adapter-probe-xyz'); // leaf need not exist
  const prof = buildSandboxProfile({ reAllowReadPaths: [], writePaths: [probe] });
  const expected = path.join(real, 'loom-adapter-probe-xyz');
  assert.ok(prof.includes(`(subpath "${expected}")`), `expected canonical write-subpath ${expected} in:\n${prof}`);
});

test('profile: has deny-default, allow-root reads, deny /Users, deny network', () => {
  const prof = buildSandboxProfile({ reAllowReadPaths: [], writePaths: [] });
  assert.ok(prof.includes('(version 1)'));
  assert.ok(prof.includes('(deny default)'));
  assert.ok(prof.includes('(allow file-read* (subpath "/"))'));
  assert.ok(/\(deny file-read\*[\s\S]*\(subpath "\/Users"\)/.test(prof), 'must deny reads under /Users');
  assert.ok(prof.includes('(deny network*)'));
  assert.ok(prof.includes('(literal "/dev/null")'));
});

test('profile: re-allow read paths come AFTER the deny (last-match-wins re-permits the interpreter)', () => {
  const prof = buildSandboxProfile({ reAllowReadPaths: ['/usr/local'], writePaths: [] });
  const denyIdx = prof.indexOf('(deny file-read*');
  const reAllowIdx = prof.lastIndexOf('(allow file-read*');
  assert.ok(denyIdx !== -1 && reAllowIdx > denyIdx, 'the re-allow block must follow the deny block');
});

test('injection-safety: assertSafeProfilePath throws on quote/paren/newline/relative', () => {
  assert.throws(() => assertSafeProfilePath('/tmp/a")(allow default)('), /unsafe|inject/i);
  assert.throws(() => assertSafeProfilePath('/tmp/a\nb'), /unsafe|inject/i);
  assert.throws(() => assertSafeProfilePath('relative/path'), /absolute/i);
  assert.throws(() => assertSafeProfilePath(''), /empty|sb-path/i);
  assert.strictEqual(assertSafeProfilePath('/tmp/ok'), '/tmp/ok');
});

test('injection-safety: buildSandboxProfile rejects an unsafe write path (the .sb SQLi analog)', () => {
  assert.throws(() => buildSandboxProfile({ writePaths: ['/tmp/x")(allow file-write* (subpath "/'] }), /unsafe|inject/i);
});

// --------------------------------------------------------------------------
// Result taxonomy (D1.5) — default-unknown => SETUP_FAILURE => refuse.
// --------------------------------------------------------------------------

test('classifyRun: spawn-threw => SETUP_FAILURE', () => {
  assert.strictEqual(classifyRun({ spawnThrew: true }), RESULT_CLASS.SETUP_FAILURE);
});
test('classifyRun: timed-out => KILLED_FOR_DOS', () => {
  assert.strictEqual(classifyRun({ timedOut: true, sentinelSeen: true, exitCode: null }), RESULT_CLASS.KILLED_FOR_DOS);
});
test('classifyRun: sentinel absent => SETUP_FAILURE (child never started)', () => {
  assert.strictEqual(classifyRun({ sentinelSeen: false, exitCode: 0 }), RESULT_CLASS.SETUP_FAILURE);
});
test('classifyRun: sentinel + numeric exit => CONTAINED_RESULT (test-fail is not a containment-fail)', () => {
  assert.strictEqual(classifyRun({ sentinelSeen: true, exitCode: 1 }), RESULT_CLASS.CONTAINED_RESULT);
  assert.strictEqual(classifyRun({ sentinelSeen: true, exitCode: 0 }), RESULT_CLASS.CONTAINED_RESULT);
});
test('classifyRun: non-numeric exit => SETUP_FAILURE (unknown)', () => {
  assert.strictEqual(classifyRun({ sentinelSeen: true, exitCode: 'x' }), RESULT_CLASS.SETUP_FAILURE);
});
test('classifyRun: empty/unknown shape => SETUP_FAILURE (default fail-closed)', () => {
  assert.strictEqual(classifyRun({}), RESULT_CLASS.SETUP_FAILURE);
  assert.strictEqual(classifyRun(null), RESULT_CLASS.SETUP_FAILURE);
});

// --------------------------------------------------------------------------
// Test-status parse + outcome evaluation.
// --------------------------------------------------------------------------

test('parseTestStatus: extracts the __LOOM_TEST_RESULT__ json line; missing ids => missing', () => {
  const stdout = `noise\n${LOOM_TEST_RESULT_PREFIX}{"t1":"pass","t2":"fail"}\nmore`;
  const { observed } = parseTestStatus(stdout, ['t1', 't2', 't3']);
  assert.deepStrictEqual(observed, { t1: 'pass', t2: 'fail', t3: 'missing' });
});
test('parseTestStatus: no result line => all missing', () => {
  const { observed } = parseTestStatus('nothing here', ['t1']);
  assert.deepStrictEqual(observed, { t1: 'missing' });
});
test('parseTestStatus: a malformed json line fails soft to all-missing (never throws)', () => {
  const { observed } = parseTestStatus(`${LOOM_TEST_RESULT_PREFIX}{not json`, ['t1']);
  assert.deepStrictEqual(observed, { t1: 'missing' });
});

test('evaluateOutcome: resolved iff every fail_to_pass passes AND every pass_to_pass holds', () => {
  const ok = evaluateOutcome({ a: 'pass', b: 'pass', c: 'pass' }, { failToPass: ['a'], passToPass: ['b', 'c'] });
  assert.strictEqual(ok.resolved, true);
  const ftpMiss = evaluateOutcome({ a: 'fail', b: 'pass' }, { failToPass: ['a'], passToPass: ['b'] });
  assert.strictEqual(ftpMiss.resolved, false);
  const ptpRegress = evaluateOutcome({ a: 'pass', b: 'fail' }, { failToPass: ['a'], passToPass: ['b'] });
  assert.strictEqual(ptpRegress.resolved, false);
  const missing = evaluateOutcome({ a: 'missing' }, { failToPass: ['a'], passToPass: [] });
  assert.strictEqual(missing.resolved, false);
});

// --------------------------------------------------------------------------
// selectBackend — the first attested backend, else null (fail-closed).
// --------------------------------------------------------------------------

test('selectBackend: returns the first containment-attested backend', () => {
  const b = selectBackend({ backends: [{ containmentAttested: false, name: 'no' }, { containmentAttested: true, name: 'yes' }] });
  assert.strictEqual(b.name, 'yes');
});
test('selectBackend: no attested backend => null (fail-closed)', () => {
  assert.strictEqual(selectBackend({ backends: [{ containmentAttested: false }] }), null);
  assert.strictEqual(selectBackend({ backends: [] }), null);
});

// --------------------------------------------------------------------------
// ContainerAdapter.run — lifecycle order, fail-closed, parse.
// --------------------------------------------------------------------------

atest('run: lifecycle order is clone -> candidate -> test -> run -> discard; never touches HEAD', async () => {
  const be = new MockBackend({ runResult: { sentinelSeen: true, exitCode: 0, stdout: `${LOOM_TEST_RESULT_PREFIX}{"t1":"pass","t2":"pass"}` } });
  const out = await new ContainerAdapter({ backend: be }).run(RECORD);
  assert.deepStrictEqual(be.calls, ['prepareClone', 'applyPatch:candidate', 'applyPatch:test', 'runTests', 'discard']);
  assert.ok(!be.calls.includes('touchHead'), 'must never mutate HEAD');
  assert.strictEqual(out.result_class, RESULT_CLASS.CONTAINED_RESULT);
  assert.strictEqual(out.refused, false);
  assert.deepStrictEqual(out.observed, { t1: 'pass', t2: 'pass' });
});

atest('run: fail-closed when no backend is attested (NEVER attempts execution)', async () => {
  const be = new MockBackend({ containmentAttested: false });
  const out = await new ContainerAdapter({ backend: be }).run(RECORD);
  assert.strictEqual(out.result_class, RESULT_CLASS.SETUP_FAILURE);
  assert.strictEqual(out.refused, true);
  assert.match(out.reason, /attest/i);
  assert.deepStrictEqual(be.calls, [], 'no clone/patch/run may be attempted without attestation');
});

atest('run: a backend throw fails closed (SETUP_FAILURE) and STILL discards (finally)', async () => {
  const be = new MockBackend({ throwOn: 'runTests' });
  const out = await new ContainerAdapter({ backend: be }).run(RECORD);
  assert.strictEqual(out.result_class, RESULT_CLASS.SETUP_FAILURE);
  assert.strictEqual(out.refused, true);
  assert.match(out.reason, /threw|backend/i);
  assert.ok(be.calls.includes('discard'), 'discard must run even when a step throws');
});

atest('run: KILLED_FOR_DOS is refused (not a usable result) and discards', async () => {
  const be = new MockBackend({ runResult: { timedOut: true, sentinelSeen: true, exitCode: null } });
  const out = await new ContainerAdapter({ backend: be }).run(RECORD);
  assert.strictEqual(out.result_class, RESULT_CLASS.KILLED_FOR_DOS);
  assert.strictEqual(out.refused, true);
  assert.ok(be.calls.includes('discard'));
});

atest('run: sentinel-absent contained-uncertain => SETUP_FAILURE refused', async () => {
  const be = new MockBackend({ runResult: { sentinelSeen: false, exitCode: 0, stdout: '' } });
  const out = await new ContainerAdapter({ backend: be }).run(RECORD);
  assert.strictEqual(out.result_class, RESULT_CLASS.SETUP_FAILURE);
  assert.strictEqual(out.refused, true);
});

// --------------------------------------------------------------------------
(async () => {
  await Promise.all(_asyncTests); // wait for every queued async test before the summary.
  process.stdout.write(`\ncontainer-adapter.test.js: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
})();
