#!/usr/bin/env node

// tests/unit/kernel/_lib/k13-k14-interlock.test.js
//
// Property test for INV-28-K13K14SerialClosure per v6 §6.13.
// Round-3d Patch GP1 + Round-3d C4 (clock-injection-from-day-1 discipline).
//
// Property: K13 MUST NOT unblock next-spawn dispatch until prior spawn's K14
// tail window has closed (now() >= prior_spawn.committed_at + LOOM_K14_TAIL_WINDOW_MS).
//
// This test uses the InjectableClock harness rather than real wallclock to
// avoid CI flakiness (per persona-Tess T2). The test exercises the LOGICAL
// invariant on the interlock; the actual K13/K14 implementation lives in
// v3.0-alpha (this PR is the schema-additive reservation).

'use strict';

const assert = require('assert');
const { createInjectableClock } = require('./_test-harness');

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

// --- Mock K13 admission gate using the injectable clock ---
//
// The real K13 lives in `_lib/lock.js` + spawn-state directory scanning.
// For this property test, we model the K13 admission decision as a pure
// function over (priorSpawn.committedAtMs, tailWindowMs, now()).

const LOOM_K14_TAIL_WINDOW_MS_DEFAULT = 3000;

function k13Admits({ priorSpawnCommittedAtMs, tailWindowMs, nowMs }) {
  if (priorSpawnCommittedAtMs === null) return { admitted: true, reason: 'no-prior-spawn' };
  const closesAt = priorSpawnCommittedAtMs + tailWindowMs;
  if (nowMs < closesAt) {
    return { admitted: false, reason: 'tail-window-pending', waitMs: closesAt - nowMs };
  }
  return { admitted: true, reason: 'tail-window-closed' };
}

// --- Tests ---

test('INV-28: spawn S2 within tail window is rejected (reason: tail-window-pending)', () => {
  const clock = createInjectableClock();
  const s1Committed = clock.nowMs();
  clock.advance(1000); // 1s after S1 commit, attempt S2

  const result = k13Admits({
    priorSpawnCommittedAtMs: s1Committed,
    tailWindowMs: LOOM_K14_TAIL_WINDOW_MS_DEFAULT,
    nowMs: clock.nowMs(),
  });
  assert.strictEqual(result.admitted, false);
  assert.strictEqual(result.reason, 'tail-window-pending');
  assert.strictEqual(result.waitMs, 2000);
});

test('INV-28: spawn S3 past tail window is admitted (reason: tail-window-closed)', () => {
  const clock = createInjectableClock();
  const s1Committed = clock.nowMs();
  clock.advance(4000); // 4s after S1 commit, attempt S3

  const result = k13Admits({
    priorSpawnCommittedAtMs: s1Committed,
    tailWindowMs: LOOM_K14_TAIL_WINDOW_MS_DEFAULT,
    nowMs: clock.nowMs(),
  });
  assert.strictEqual(result.admitted, true);
  assert.strictEqual(result.reason, 'tail-window-closed');
});

test('INV-28: spawn exactly at window-close boundary is admitted', () => {
  const clock = createInjectableClock();
  const s1Committed = clock.nowMs();
  clock.advance(LOOM_K14_TAIL_WINDOW_MS_DEFAULT); // exactly at the boundary

  const result = k13Admits({
    priorSpawnCommittedAtMs: s1Committed,
    tailWindowMs: LOOM_K14_TAIL_WINDOW_MS_DEFAULT,
    nowMs: clock.nowMs(),
  });
  assert.strictEqual(result.admitted, true, 'boundary case: closesAt == nowMs should admit');
});

test('INV-28: spawn 1ms before boundary is rejected', () => {
  const clock = createInjectableClock();
  const s1Committed = clock.nowMs();
  clock.advance(LOOM_K14_TAIL_WINDOW_MS_DEFAULT - 1);

  const result = k13Admits({
    priorSpawnCommittedAtMs: s1Committed,
    tailWindowMs: LOOM_K14_TAIL_WINDOW_MS_DEFAULT,
    nowMs: clock.nowMs(),
  });
  assert.strictEqual(result.admitted, false);
  assert.strictEqual(result.waitMs, 1);
});

test('INV-28: no prior spawn → unconditional admit', () => {
  const clock = createInjectableClock();
  const result = k13Admits({
    priorSpawnCommittedAtMs: null,
    tailWindowMs: LOOM_K14_TAIL_WINDOW_MS_DEFAULT,
    nowMs: clock.nowMs(),
  });
  assert.strictEqual(result.admitted, true);
  assert.strictEqual(result.reason, 'no-prior-spawn');
});

test('INV-28: clock-injection makes this test deterministic + flake-free', () => {
  // The whole point of Round-3d C4: this test does NOT touch wallclock.
  // Running it 100x in a tight loop should produce zero variance.
  const clock = createInjectableClock();
  const s1Committed = clock.nowMs();
  clock.advance(1500);

  const outcomes = new Set();
  for (let i = 0; i < 100; i++) {
    const r = k13Admits({
      priorSpawnCommittedAtMs: s1Committed,
      tailWindowMs: LOOM_K14_TAIL_WINDOW_MS_DEFAULT,
      nowMs: clock.nowMs(),
    });
    outcomes.add(r.admitted + ':' + r.reason);
  }
  assert.strictEqual(outcomes.size, 1, 'all 100 invocations must produce identical outcome (no flake)');
});

test('INV-28: custom tail-window respected', () => {
  const clock = createInjectableClock();
  const s1Committed = clock.nowMs();
  clock.advance(500);

  // Custom 10s tail window — 500ms after commit should be rejected.
  const r1 = k13Admits({
    priorSpawnCommittedAtMs: s1Committed,
    tailWindowMs: 10000,
    nowMs: clock.nowMs(),
  });
  assert.strictEqual(r1.admitted, false);
  assert.strictEqual(r1.waitMs, 9500);

  // Same 500ms after commit but with 200ms tail window — admitted.
  const r2 = k13Admits({
    priorSpawnCommittedAtMs: s1Committed,
    tailWindowMs: 200,
    nowMs: clock.nowMs(),
  });
  assert.strictEqual(r2.admitted, true);
});

process.stdout.write(`\nk13-k14-interlock.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
