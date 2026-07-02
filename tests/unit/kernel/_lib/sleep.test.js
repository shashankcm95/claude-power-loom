#!/usr/bin/env node

'use strict';

// tests/unit/kernel/_lib/sleep.test.js — F-W2 DRY extraction of the synchronous sleep primitive
// out of _lib/lock.js's `_waitSleep`. The SAME core (SharedArrayBuffer + Atomics.wait, the
// SAB-unavailable busy-wait fallback, the NaN/zero/negative guard) now lives in _lib/sleep.js and
// is imported by BOTH lock.js and gh-emit's fork-readiness poll. This locks the behavioral
// contract so a future edit to the shared primitive cannot silently change either consumer.

const assert = require('assert');
const path = require('path');

const { sleepSync, clampSleepMs, MAX_SLEEP_MS } = require(path.join(__dirname, '..', '..', '..', '..', 'packages', 'kernel', '_lib', 'sleep.js'));

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

test('sleepSync is exported as a function', () => {
  assert.strictEqual(typeof sleepSync, 'function');
});

test('sleepSync(ms) waits AT LEAST ms wall-clock (true-sleep, not an instant no-op)', () => {
  const start = Date.now();
  sleepSync(40);
  const elapsed = Date.now() - start;
  // allow OS scheduler slack downward (Atomics.wait may return a hair early), but it must be a
  // real wait, not an instant return — a hand-rolled second copy that dropped the wait would fail.
  assert.ok(elapsed >= 25, `elapsed ${elapsed}ms should be a real wait of ~40ms`);
});

test('sleepSync(NaN) does NOT block forever — the guard clamps to a safe default and returns', () => {
  // Atomics.wait(NaN) blocks forever per ECMA-262 §25.4.5; the guard must clamp. If this test
  // hangs, the guard regressed. The clamp default is 50ms, so it returns quickly.
  const start = Date.now();
  sleepSync(NaN);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 5000, `NaN must clamp + return promptly (elapsed ${elapsed}ms), never block forever`);
});

test('sleepSync(0) and sleepSync(-5) clamp to the safe default (never a forever-block / negative wait)', () => {
  const start = Date.now();
  sleepSync(0);
  sleepSync(-5);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 5000, `zero/negative must clamp + return (elapsed ${elapsed}ms)`);
});

test('M-2 clampSleepMs caps a large FINITE ms at MAX_SLEEP_MS (a future caller cannot hang the process)', () => {
  // pure clamp — no real wait. A huge finite ms would otherwise block for that duration.
  assert.strictEqual(clampSleepMs(3600000), MAX_SLEEP_MS, 'a 1h request is capped at MAX_SLEEP_MS');
  assert.strictEqual(clampSleepMs(MAX_SLEEP_MS + 1), MAX_SLEEP_MS, 'just over the cap => the cap');
  assert.strictEqual(clampSleepMs(200), 200, 'a value under the cap is unchanged');
  assert.strictEqual(clampSleepMs(NaN), 50, 'NaN clamps to the 50ms safe default (never a forever-block)');
  assert.strictEqual(clampSleepMs(-5), 50, 'negative clamps to the safe default');
  assert.strictEqual(clampSleepMs(Infinity), 50, 'Infinity is non-finite => the safe default');
  assert.ok(MAX_SLEEP_MS > 0 && MAX_SLEEP_MS <= 60000, 'MAX_SLEEP_MS is a sane hard ceiling');
});

process.stdout.write(`\nsleep.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
