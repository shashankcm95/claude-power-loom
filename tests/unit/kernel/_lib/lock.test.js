#!/usr/bin/env node

// tests/unit/kernel/_lib/lock.test.js
//
// W1-A (2026-06-17): withLockSoft — the soft-fail sibling of withLock. withLock
// process.exit(2)s when it cannot acquire the lock within the timeout, which KILLS
// the hook process on the synchronous close/Edit hot path under concurrent spawns.
// withLockSoft instead RETURNS { ok:false, reason:'lock-timeout' } — never exits —
// so a hook fails soft (a best-effort write drops; the hook still exits 0). On
// acquire success it returns { ok:true, value: fn() } and releases the lock; an
// fn() throw still releases the lock and PROPAGATES (the soft part is acquisition
// failure only, matching withLock's fn-error posture).

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { withLockSoft, withLock, acquireLock, releaseLock } =
  require(path.join(__dirname, '..', '..', '..', '..', 'packages', 'kernel', '_lib', 'lock.js'));

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-lock-'));
function lp(name) { return path.join(tmp, name); }

test('withLockSoft is exported as a function (additive; withLock + acquireLock/releaseLock still exported)', () => {
  assert.strictEqual(typeof withLockSoft, 'function');
  assert.strictEqual(typeof withLock, 'function');         // unchanged sibling
  assert.strictEqual(typeof acquireLock, 'function');
  assert.strictEqual(typeof releaseLock, 'function');
});

test('withLockSoft returns {ok:true, value} on a free lock + releases it', () => {
  const lock = lp('free.lock');
  const r = withLockSoft(lock, () => 41 + 1, { maxWaitMs: 1000 });
  assert.deepStrictEqual(r, { ok: true, value: 42 });
  assert.ok(!fs.existsSync(lock), 'lock released on success');
});

test('withLockSoft returns {ok:false, reason:lock-timeout} on a HELD lock — NO process.exit', () => {
  const lock = lp('held.lock');
  // A long-lived child WE own → acquireLock sees a live, non-self pid → waits → times out.
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)'], { stdio: 'ignore' });
  try {
    fs.writeFileSync(lock, String(child.pid));
    const r = withLockSoft(lock, () => 'MUST-NOT-RUN', { maxWaitMs: 200, sleepMs: 20 });
    assert.strictEqual(r.ok, false, 'must soft-fail, not run fn');
    assert.strictEqual(r.reason, 'lock-timeout');
    assert.notStrictEqual(r.value, 'MUST-NOT-RUN', 'fn must not have run');
  } finally {
    child.kill();
    try { fs.unlinkSync(lock); } catch { /* ignore */ }
  }
});

test('withLockSoft releases the lock on fn() THROW and propagates the throw', () => {
  const lock = lp('throw.lock');
  assert.throws(
    () => withLockSoft(lock, () => { throw new Error('boom'); }, { maxWaitMs: 1000 }),
    /boom/,
    'fn throw must propagate (soft applies to acquisition, not fn errors)'
  );
  assert.ok(!fs.existsSync(lock), 'lock released even on fn throw');
  // and the lock is reusable afterward
  const r = withLockSoft(lock, () => 'ok', { maxWaitMs: 1000 });
  assert.deepStrictEqual(r, { ok: true, value: 'ok' });
});

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }

process.stdout.write(`\nlock.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
