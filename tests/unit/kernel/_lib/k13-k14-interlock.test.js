#!/usr/bin/env node

// tests/unit/kernel/_lib/k13-k14-interlock.test.js
//
// INV-28-K13K14SerialClosure — HONEST v3.0-alpha status + a REAL-code test.
//
// PRIOR STATE (fixed here, per the MVP-review QA finding): this file modeled K13
// admission with a LOCAL `k13Admits` mock implementing a K14-TAIL-WINDOW interlock
// (don't admit S2 until S1's K14 tail window closes). That mock tested an invariant
// the shipped K13 does NOT implement, and would have PASSED even if the real
// enforcer were deleted — a test that can't fail manufactures false confidence.
//
// REALITY: v3.0-alpha K13 is SERIAL-MARKER + AGE-REAP, not tail-window. The real
// `decideAdmission(currentMarker, nowMs, maxSpawnAgeMs)` admits when there is no
// live marker (or reaps a stale one past maxSpawnAgeMs) and blocks when a live
// marker exists. INV-28's tail-window CLOSURE (gating S2 on S1's K14 window) is a
// v3.1 property — it arrives when K13 + K14 compose with the tail window in the
// live spawn path. The end-to-end composition is now covered by
// tests/unit/kernel/integration/transaction-loop.test.js.
//
// This test now exercises the REAL k13.decideAdmission (it FAILS if that function
// is deleted or its serial-only semantics regress). The injectable clock keeps the
// age math deterministic (no wallclock flake).

'use strict';

const assert = require('assert');
const { createInjectableClock } = require('./_test-harness');
const k13 = require('../../../../packages/kernel/enforcement/k13-serial-enforcer');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

const MAX_AGE = 30000; // serial-marker age-reap horizon (ms)

test('decideAdmission: no active marker -> admit (no-active-spawn)', () => {
  const d = k13.decideAdmission(null, 1000, MAX_AGE);
  assert.strictEqual(d.admit, true);
  assert.strictEqual(d.reason, 'no-active-spawn');
  assert.strictEqual(d.reaped, false);
});

test('decideAdmission: a LIVE marker (age < maxSpawnAgeMs) -> BLOCK (serial-only-spawn-active)', () => {
  const clock = createInjectableClock();
  const created = clock.nowMs();
  clock.advance(1000); // 1s later, still inside the 30s horizon
  const d = k13.decideAdmission({ created_at_ms: created }, clock.nowMs(), MAX_AGE);
  assert.strictEqual(d.admit, false, 'a live serial marker must block a concurrent spawn');
  assert.strictEqual(d.reason, 'serial-only-spawn-active');
  assert.strictEqual(d.reaped, false);
});

test('decideAdmission: a STALE marker (age >= maxSpawnAgeMs) -> admit + reaped', () => {
  const clock = createInjectableClock();
  const created = clock.nowMs();
  clock.advance(MAX_AGE + 1);
  const d = k13.decideAdmission({ created_at_ms: created }, clock.nowMs(), MAX_AGE);
  assert.strictEqual(d.admit, true);
  assert.strictEqual(d.reason, 'reaped-stale-marker');
  assert.strictEqual(d.reaped, true);
});

test('decideAdmission: age EXACTLY at maxSpawnAgeMs reaps (>= boundary)', () => {
  const clock = createInjectableClock();
  const created = clock.nowMs();
  clock.advance(MAX_AGE);
  const d = k13.decideAdmission({ created_at_ms: created }, clock.nowMs(), MAX_AGE);
  assert.strictEqual(d.admit, true, 'boundary age == maxSpawnAgeMs is reaped (>=)');
  assert.strictEqual(d.reaped, true);
});

test('decideAdmission: a marker missing created_at_ms is treated as no-active-spawn', () => {
  const d = k13.decideAdmission({ spawn_id: 'x' }, 1000, MAX_AGE);
  assert.strictEqual(d.admit, true);
  assert.strictEqual(d.reason, 'no-active-spawn');
});

test('decideAdmission: deterministic — 100 evaluations of a live marker are identical (no flake)', () => {
  const clock = createInjectableClock();
  const created = clock.nowMs();
  clock.advance(1500);
  const outcomes = new Set();
  for (let i = 0; i < 100; i++) {
    const d = k13.decideAdmission({ created_at_ms: created }, clock.nowMs(), MAX_AGE);
    outcomes.add(d.admit + ':' + d.reason);
  }
  assert.strictEqual(outcomes.size, 1, 'all 100 evaluations must be identical (no flake)');
});

test('INV-28 tail-window closure is NOT a v3.0-alpha K13 property (documented deferral guard)', () => {
  // Guard against a future reader mistaking serial-only for the tail-window
  // interlock: decideAdmission has NO tailWindowMs parameter in v3.0-alpha. The
  // K14-tail-window gating of next-spawn dispatch is v3.1 (K13+K14 compose in the
  // live spawn path); the composition itself is proven by the integration test.
  assert.strictEqual(
    k13.decideAdmission.length, 3,
    'decideAdmission(currentMarker, nowMs, maxSpawnAgeMs) — no tail-window arg in v3.0-alpha',
  );
});

process.stdout.write(`\nk13-k14-interlock.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
