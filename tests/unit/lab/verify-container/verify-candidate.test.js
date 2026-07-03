'use strict';

// @loom-layer: lab (test)
//
// VC-W1a — the QUALITY verifier over an INJECTED (Mock) backend + the advisory sidecar. Proves: a
// contained pass => green + recorded; a contained fail => red; an unattested/throwing backend =>
// unverified (null), never a vacuous verdict; zero observed signal => null (non-vacuous green); and
// QUALITY-not-TRUST (no weight/trust field on the verdict or the record).

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// SCAR #9 — PIN the sidecar dir to a tmp dir BEFORE the store require reads the env default, so a call
// that omits an injected dir cannot write the REAL store.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-w1a-'));
process.env.LOOM_VERIFY_SIDECAR_DIR = TMP;

const REPO = path.join(__dirname, '..', '..', '..', '..');
const { verifyCandidate, verdictOf } = require(path.join(REPO, 'packages', 'lab', 'verify-container', 'verify-candidate.js'));
const { readVerify } = require(path.join(REPO, 'packages', 'lab', 'verify-container', 'verify-sidecar-store.js'));
const { LOOM_TEST_RESULT_PREFIX, RESULT_CLASS } = require(path.join(REPO, 'packages', 'lab', 'issue-corpus', 'container-adapter.js'));

// A MockBackend: containment-attested (or not), records calls, returns a canned runTests result.
function mockBackend({ attested = true, runResult } = {}) {
  const calls = [];
  return {
    containmentAttested: attested,
    async prepareClone(a) { calls.push(['prepareClone', a && a.base_sha]); return { workDir: '/mock/work' }; },
    async applyPatch(a) { calls.push(['applyPatch', a && a.label]); },
    async runTests(a) { calls.push(['runTests', a && a.test_ids]); return runResult; },
    async discard(a) { calls.push(['discard', !!(a && a.workDir)]); },
    _calls: calls,
  };
}
// classifyRun => CONTAINED_RESULT needs sentinelSeen:true + integer exitCode; parseTestStatus reads a
// single __LOOM_TEST_RESULT__<json> line.
function contained(map, exitCode = 0) {
  return { sentinelSeen: true, exitCode, stdout: `${LOOM_TEST_RESULT_PREFIX}${JSON.stringify(map)}\n` };
}

const BASE = 'a'.repeat(40);
const IN = { candidateId: 'issue-42', repo: 'owner/repo', base_sha: BASE, candidate_patch: 'diff', test_patch: '', test_ids: ['t1'] };

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('1 green: a contained all-pass run yields passed=true and records to the advisory sidecar', async () => {
  const be = mockBackend({ runResult: contained({ t1: 'pass' }) });
  const r = await verifyCandidate(IN, { backend: be, sidecarDir: TMP });
  assert.strictEqual(r.passed, true, 'green verdict');
  assert.strictEqual(r.result_class, RESULT_CLASS.CONTAINED_RESULT);
  const rec = readVerify(TMP, 'issue-42');
  assert.ok(rec && rec.passed === true && rec.candidateId === 'issue-42' && rec.base_sha === BASE, 'sidecar recorded the green verdict');
});

test('2 red: a contained run with an observed fail yields passed=false', async () => {
  const be = mockBackend({ runResult: contained({ t1: 'fail' }) });
  const r = await verifyCandidate({ ...IN, candidateId: 'issue-43' }, { backend: be, sidecarDir: TMP });
  assert.strictEqual(r.passed, false, 'red verdict');
  assert.strictEqual(readVerify(TMP, 'issue-43').passed, false);
});

test('3 unverified: an unattested backend yields passed=null (SETUP_FAILURE), never a vacuous verdict', async () => {
  const be = mockBackend({ attested: false, runResult: contained({ t1: 'pass' }) });
  const r = await verifyCandidate({ ...IN, candidateId: 'issue-44' }, { backend: be, sidecarDir: TMP });
  assert.strictEqual(r.passed, null, 'unverified');
  assert.strictEqual(r.result_class, RESULT_CLASS.SETUP_FAILURE);
});

test('4 backend throw => SETUP_FAILURE unverified (adapter.run catches; no false green/red)', async () => {
  const be = mockBackend({ runResult: contained({ t1: 'pass' }) });
  be.runTests = async () => { throw new Error('boom'); };
  const r = await verifyCandidate({ ...IN, candidateId: 'issue-45' }, { backend: be, sidecarDir: TMP });
  assert.strictEqual(r.passed, null, 'a backend throw is unverified, not green');
});

test('5 non-vacuous green: a contained run with ZERO observed tests is unverified (null), not green', () => {
  assert.strictEqual(verdictOf({ result_class: RESULT_CLASS.CONTAINED_RESULT, observed: {} }).passed, null, 'zero-signal is null, not green');
  assert.strictEqual(verdictOf({ result_class: RESULT_CLASS.CONTAINED_RESULT, observed: { t1: 'pass' } }).passed, true, 'a real pass IS green (non-vacuous)');
  assert.strictEqual(verdictOf({ result_class: RESULT_CLASS.CONTAINED_RESULT, observed: { t1: 'pass', t2: 'fail' } }).passed, false, 'any fail is red');
});

test('6 QUALITY-not-TRUST: no weight/trust field on the verdict or the record', async () => {
  const be = mockBackend({ runResult: contained({ t1: 'pass' }) });
  const r = await verifyCandidate({ ...IN, candidateId: 'issue-46' }, { backend: be, sidecarDir: TMP });
  const rec = readVerify(TMP, 'issue-46');
  for (const k of ['weight', 'score', 'world_anchored', 'reputation', 'trust', 'confirmed_by']) {
    assert.ok(!(k in r), `verdict must not carry a trust field: ${k}`);
    assert.ok(!(k in rec), `record must not carry a trust field: ${k}`);
  }
});

test('7 sidecar safe-id: a traversal candidateId is rejected before any run (no path escape)', async () => {
  const be = mockBackend({ runResult: contained({ t1: 'pass' }) });
  await assert.rejects(() => verifyCandidate({ ...IN, candidateId: '../evil' }, { backend: be, sidecarDir: TMP }), /safe token/, 'traversal id rejected');
  assert.strictEqual(be._calls.length, 0, 'fail-fast: no clone/run happened for a bad id');
});

test('8 immutable read: the sidecar read-back is frozen', async () => {
  const be = mockBackend({ runResult: contained({ t1: 'pass' }) });
  await verifyCandidate({ ...IN, candidateId: 'issue-47' }, { backend: be, sidecarDir: TMP });
  assert.ok(Object.isFrozen(readVerify(TMP, 'issue-47')), 'read-back is frozen');
});

(async () => {
  let passed = 0, failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log(`  PASS ${t.name}`); passed += 1; }
    catch (e) { console.log(`  FAIL ${t.name}: ${e && e.message}`); failed += 1; }
  }
  console.log(`=== ${path.basename(__filename)}: ${passed} passed, ${failed} failed ===`);
  process.exit(failed === 0 ? 0 : 1);
})();
