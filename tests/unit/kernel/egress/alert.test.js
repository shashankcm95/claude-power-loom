'use strict';

// tests/unit/kernel/egress/alert.test.js — #412: emitEgressAlert extracted to a shared egress/alert.js so BOTH
// gh-emit (its existing call-sites) and the new runActorTrajectory armed-guard can emit the SAME observable
// signal. The contract is load-bearing: the `[LOOM-EGRESS-ALERT]` prefix is what an operator/CI greps for, and
// the never-throw guard means a logging failure can NEVER fail the gate (security.md fail-closed-observable).

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const A = require(path.join(REPO, 'packages', 'kernel', 'egress', 'alert.js'));

let passed = 0; let failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// Capture stderr writes around fn(); restore unconditionally.
function captureStderr(fn) {
  const orig = process.stderr.write;
  const lines = [];
  process.stderr.write = (chunk) => { lines.push(String(chunk)); return true; };
  try { fn(); } finally { process.stderr.write = orig; }
  return lines.join('');
}

test('emitEgressAlert writes a single [LOOM-EGRESS-ALERT] line with reason + detail as JSON', () => {
  const out = captureStderr(() => A.emitEgressAlert('host-actor-while-armed', { path: '/x', n: 3 }));
  assert.ok(out.startsWith('[LOOM-EGRESS-ALERT] '), `prefix must be byte-identical, got: ${JSON.stringify(out.slice(0, 40))}`);
  assert.ok(out.endsWith('\n'), 'one trailing newline');
  const json = JSON.parse(out.slice('[LOOM-EGRESS-ALERT] '.length).trim());
  assert.strictEqual(json.reason, 'host-actor-while-armed', 'reason is first');
  assert.strictEqual(json.path, '/x'); assert.strictEqual(json.n, 3);
});

test('emitEgressAlert: the POSITIONAL reason is authoritative — a reason key in detail CANNOT clobber it (CodeRabbit #422)', () => {
  const out = captureStderr(() => A.emitEgressAlert('the-real-token', { reason: 'attacker-supplied', spawn: 'x' }));
  const json = JSON.parse(out.slice('[LOOM-EGRESS-ALERT] '.length).trim());
  assert.strictEqual(json.reason, 'the-real-token', 'detail.reason must NOT override the positional token');
  assert.strictEqual(json.spawn, 'x', 'other detail keys still ride along');
});

test('emitEgressAlert tolerates an absent detail (reason only)', () => {
  const out = captureStderr(() => A.emitEgressAlert('forward-contract-violation'));
  const json = JSON.parse(out.slice('[LOOM-EGRESS-ALERT] '.length).trim());
  assert.deepStrictEqual(json, { reason: 'forward-contract-violation' });
});

test('emitEgressAlert NEVER throws even if stderr.write throws (telemetry must not fail the gate)', () => {
  const orig = process.stderr.write;
  process.stderr.write = () => { throw new Error('stderr is broken'); };
  try {
    assert.doesNotThrow(() => A.emitEgressAlert('x', { y: 1 }), 'a broken stderr must be swallowed, not propagated');
  } finally { process.stderr.write = orig; }
});

test('emitEgressAlert tolerates a non-serializable detail without throwing (circular ref)', () => {
  const circular = {}; circular.self = circular;
  // JSON.stringify(circular) throws — the never-throw guard must swallow it (no [LOOM-EGRESS-ALERT] is acceptable,
  // a propagated throw is NOT).
  assert.doesNotThrow(() => captureStderr(() => A.emitEgressAlert('reason', circular)));
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== alert.test.js: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
})();
