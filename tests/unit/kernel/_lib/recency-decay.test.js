#!/usr/bin/env node

// tests/unit/kernel/_lib/recency-decay.test.js
//
// Tests for packages/kernel/_lib/recency-decay.js — the pure recency-decay leaf EXTRACTED from
// trust-scoring.js (v3.4 Wave 2) so the Lab's E4 reputation view can consume it WITHOUT importing
// the runtime identity STATE module (the K12 boundary; the Wave-0 canonical-json precedent).
//
// Locks: (a) the core computeRecencyDecayAt(history, nowMs) is injectable + deterministic (E4 needs
// this — verify-plan HIGH-2); (b) computeRecencyDecay(history) stays the Date.now() back-compat
// wrapper; (c) it reads `entry.ts` (NOT recorded_at) — the contract E4's adapter must satisfy
// (verify-plan HIGH-1); (d) trust-scoring re-exports the SAME function object (no drift).

'use strict';

const assert = require('assert');
const { computeRecencyDecay, computeRecencyDecayAt, RECENCY_HALF_LIFE_DAYS } =
  require('../../../../packages/kernel/_lib/recency-decay');
const trustScoring = require('../../../../packages/runtime/orchestration/identity/trust-scoring');

const NOW = Date.parse('2026-06-04T00:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
const DAY = 86400000;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

test('computeRecencyDecayAt: empty / non-array → null', () => {
  assert.strictEqual(computeRecencyDecayAt([], NOW), null);
  assert.strictEqual(computeRecencyDecayAt(null, NOW), null);
});

test('computeRecencyDecayAt: a zero-age entry → 1; a one-time-constant-old entry → exp(-1)', () => {
  assert.strictEqual(computeRecencyDecayAt([{ ts: iso(NOW) }], NOW), 1, 'dDays=0 → exp(0)=1');
  const old = computeRecencyDecayAt([{ ts: iso(NOW - RECENCY_HALF_LIFE_DAYS * DAY) }], NOW);
  assert.ok(Math.abs(old - Math.exp(-1)) < 1e-9, `≈exp(-1) (got ${old})`);
});

test('computeRecencyDecayAt: recent > old; factor ∈ (0,1]', () => {
  const recent = computeRecencyDecayAt([{ ts: iso(NOW - 1 * DAY) }], NOW);
  const old = computeRecencyDecayAt([{ ts: iso(NOW - 90 * DAY) }], NOW);
  assert.ok(recent > old, 'recent weighted higher');
  assert.ok(recent > 0 && recent <= 1 && old > 0 && old <= 1, 'both in (0,1]');
});

test('★ HIGH-2 determinism: same (history, nowMs) → identical (no Date.now())', () => {
  const h = [{ ts: iso(NOW - 5 * DAY) }, { ts: iso(NOW - 12 * DAY) }];
  assert.strictEqual(computeRecencyDecayAt(h, NOW), computeRecencyDecayAt(h, NOW));
});

test('★ HIGH-1 contract: entries lacking `ts` are skipped (why E4 must adapt recorded_at→ts)', () => {
  // a record-shaped object (recorded_at, no ts) contributes nothing → all-skipped → null
  assert.strictEqual(computeRecencyDecayAt([{ recorded_at: iso(NOW) }], NOW), null);
});

test('computeRecencyDecay(history): the Date.now() wrapper — a just-now entry → ≈1', () => {
  const f = computeRecencyDecay([{ ts: new Date().toISOString() }]);
  assert.ok(typeof f === 'number' && f > 0.99 && f <= 1, `recent → ≈1 (got ${f})`);
});

test('★ injectable: DIFFERENT nowMs → DIFFERENT factor (proves no internal Date.now())', () => {
  const h = [{ ts: iso(NOW - 5 * DAY) }];
  assert.notStrictEqual(computeRecencyDecayAt(h, NOW), computeRecencyDecayAt(h, NOW + 10 * DAY),
    'a later nowMs makes the same entry older → a smaller factor');
});

test('back-compat: trust-scoring re-exports the IDENTICAL function object + constant (no drift)', () => {
  assert.strictEqual(trustScoring.computeRecencyDecay, computeRecencyDecay,
    're-export must be the same reference (runtime behavior unchanged)');
  assert.strictEqual(trustScoring.RECENCY_HALF_LIFE_DAYS, RECENCY_HALF_LIFE_DAYS);
});

test('RECENCY_HALF_LIFE_DAYS value preserved (30)', () => {
  assert.strictEqual(RECENCY_HALF_LIFE_DAYS, 30);
});

process.stdout.write(`\nrecency-decay.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
