#!/usr/bin/env node
'use strict';

// tests/unit/kernel/_lib/close-path-concurrency-probe.test.js -- ③.2.0-B (ARCH-PC-4)
//
// The re-targeted close-path concurrency probe. Two deterministic assertions:
//   (1) a multi-process run produces a well-formed measurement: every fork acquires the lock (no
//       loss/crash under contention), and the wall-time stays well under the 10s close-hook budget;
//   (2) the soft-fail DROP is REACHABLE + measurable: a lock held by a LIVE foreign pid times out to
//       {ok:false} (the drop-rate the probe reports is a real, exercisable number — not a structural 0).

const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const { measureLockContention, CLOSE_HOOK_BUDGET_MS } = require(path.join(REPO_ROOT, 'packages', 'kernel', '_lib', 'close-path-concurrency-probe.js'));
const { withLockSoft } = require(path.join(REPO_ROOT, 'packages', 'kernel', '_lib', 'lock.js'));

let passed = 0, failed = 0;
const tests = [];
const TMP = [];
function test(name, fn) { tests.push({ name, fn }); }
function scratch(prefix) { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); TMP.push(d); return d; }

test('multi-process measurement: all forks acquire, wall-time within the 10s close-hook budget', async () => {
  const m = await measureLockContention({ processes: 4, opsPerProcess: 25, maxWaitMs: 3000, stateDir: scratch('loom-archpc4-') });
  assert.ok(m.all_children_ok, 'all forked children exited 0');
  assert.strictEqual(m.attempts, 100, '4 x 25 = 100 lock attempts');
  assert.strictEqual(m.acquired, 100, 'every attempt acquired under a generous timeout (no loss)');
  assert.strictEqual(m.dropped, 0, 'no drops at realistic params (the instant critical section never holds long)');
  assert.ok(m.within_close_hook_budget, `wall-time ${m.wall_ms}ms under the ${CLOSE_HOOK_BUDGET_MS}ms budget`);
  assert.ok(typeof m.drop_rate === 'number' && typeof m.per_op_ms === 'number', 'the measurement carries drop_rate + per_op_ms');
  assert.ok(/NOT the shadow-stubbed K13/.test(m.seam), 'the seam label is honest (primitive, not the close-resolver lock)');
});

test('the soft-fail DROP is reachable + measurable (a live foreign-pid-held lock times out)', async () => {
  const dir = scratch('loom-archpc4-drop-');
  const lockPath = path.join(dir, 'held.lock');
  // a real child that just sleeps -> its pid is alive AND signalable by us, so acquireLock sees a live
  // holder and will NOT reclaim the lock; withLockSoft then times out -> a measurable drop.
  const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  try {
    await new Promise((r) => setTimeout(r, 100)); // let it start
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(lockPath, String(sleeper.pid));
    const res = withLockSoft(lockPath, () => 0, { maxWaitMs: 150 });
    assert.strictEqual(res.ok, false, 'a lock held by a live foreign pid yields a soft-fail drop');
    assert.strictEqual(res.reason, 'lock-timeout', 'the drop reason is lock-timeout (not an exit/throw)');
  } finally {
    try { sleeper.kill(); } catch { /* best-effort */ }
  }
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed++; }
  }
  for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } }
  process.stdout.write(`\nclose-path-concurrency-probe.test.js: ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
