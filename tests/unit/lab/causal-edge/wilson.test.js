#!/usr/bin/env node

// tests/unit/lab/causal-edge/wilson.test.js
//
// v-next MV-W1 — the Wilson score interval (95%, NO continuity correction). A pure stats helper
// (none existed in the repo). Reference values computed independently (R binom.confint / known
// tables). Used by the lesson-merge-lift harden-gate's disjoint-interval test. CI-safe.

'use strict';

const assert = require('assert');
const path = require('path');
const REPO = path.join(__dirname, '..', '..', '..', '..');
const { wilson, Z } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'wilson.js'));

let passed = 0; let failed = 0;
const _tests = [];
function test(name, fn) { _tests.push({ name, fn }); }
function near(a, b, eps = 1e-3) { return Math.abs(a - b) <= eps; }

test('Z is the 95% two-sided z (1.96)', () => { assert.ok(near(Z, 1.96, 1e-9)); });

test('reference: wilson(0,10) ~ [0, 0.2775] (lower clamps to 0)', () => {
  const w = wilson(0, 10);
  assert.ok(near(w.lower, 0), `lower ${w.lower}`);
  assert.ok(near(w.upper, 0.2775), `upper ${w.upper}`);
});

test('reference: wilson(10,10) ~ [0.7225, 1] (upper clamps to 1)', () => {
  const w = wilson(10, 10);
  assert.ok(near(w.lower, 0.7225), `lower ${w.lower}`);
  assert.ok(near(w.upper, 1), `upper ${w.upper}`);
});

test('reference: wilson(5,10) is symmetric around 0.5 ~ [0.2366, 0.7634]', () => {
  const w = wilson(5, 10);
  assert.ok(near(w.lower, 0.2366), `lower ${w.lower}`);
  assert.ok(near(w.upper, 0.7634), `upper ${w.upper}`);
  assert.ok(near((w.lower + w.upper) / 2, 0.5), 'symmetric about 0.5');
});

test('bounds are clamped to [0,1] and lower <= upper', () => {
  for (const [s, n] of [[0, 1], [1, 1], [1, 3], [19, 20], [2, 20]]) {
    const w = wilson(s, n);
    assert.ok(w.lower >= 0 && w.upper <= 1, `clamp ${s}/${n}`);
    assert.ok(w.lower <= w.upper, `ordered ${s}/${n}`);
  }
});

test('a larger N narrows the interval (more data -> tighter)', () => {
  const wide = wilson(1, 2);    // 50% at n=2
  const narrow = wilson(50, 100); // 50% at n=100
  assert.ok((narrow.upper - narrow.lower) < (wide.upper - wide.lower), 'n=100 tighter than n=2');
});

test('invalid input -> null, never throws', () => {
  assert.strictEqual(wilson(-1, 10), null);
  assert.strictEqual(wilson(11, 10), null);   // successes > n
  assert.strictEqual(wilson(5, 0), null);     // n=0 (the n<=0 guard)
  assert.strictEqual(wilson(null, 10), null); // non-number successes
  assert.strictEqual(wilson(5, null), null);  // non-number n
  assert.strictEqual(wilson(1.5, 10), null);  // non-integer
  assert.strictEqual(wilson('5', 10), null);  // non-number
  assert.strictEqual(wilson(5, -3), null);
});

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && e.message}`); }
  }
  console.log(`\nwilson: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
