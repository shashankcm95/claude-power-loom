#!/usr/bin/env node

// tests/unit/runtime/test-runners/registry.test.js
//
// R12 (v3.2 Wave 2) — the test-runner adapter registry: resolve / lookup /
// Open-Closed / HONEST support (isVerificationSupported is true only when a LIVE
// adapter applies — jest/vitest/pytest are reserved, NOT registered, so the gate
// never claims a test-run it can't deliver — architect VERIFY Q3).

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const registry = require('../../../../packages/runtime/test-runners/registry');

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

const NODE_CTX = { testFile: '/abs/cwd/foo.test.js', cwd: '/abs/cwd', runner: 'node' };

test('resolveAdapter returns the node adapter for a node ctx', () => {
  const a = registry.resolveAdapter(NODE_CTX);
  assert.ok(a, 'expected an adapter');
  assert.strictEqual(a.kind, 'node');
});

test('resolveAdapter returns null when no adapter applies (non-.test.js)', () => {
  assert.strictEqual(registry.resolveAdapter({ testFile: '/abs/foo.py', cwd: '/abs' }), null);
});

test('isVerificationSupported true for a node ctx, false for a non-matching ctx', () => {
  assert.strictEqual(registry.isVerificationSupported(NODE_CTX), true);
  assert.strictEqual(registry.isVerificationSupported({ testFile: '/abs/foo.py', cwd: '/abs' }), false);
});

test('getAdapter: node is live; jest/vitest/pytest are reserved (NOT registered)', () => {
  assert.ok(registry.getAdapter('node'), 'node adapter must be registered');
  // Honest registry: a reserved-but-not-live kind has no adapter — so a leaf can
  // never be routed to a runner R12 cannot actually execute.
  assert.strictEqual(registry.getAdapter('jest'), null);
  assert.strictEqual(registry.getAdapter('vitest'), null);
  assert.strictEqual(registry.getAdapter('pytest'), null);
  assert.strictEqual(registry.getAdapter('nonexistent'), null);
});

test('listRunnerKinds = reserved namespace; listRegisteredKinds = only the live ones', () => {
  assert.deepStrictEqual(registry.listRunnerKinds(), ['node', 'jest', 'vitest', 'pytest']);
  assert.deepStrictEqual(registry.listRegisteredKinds(), ['node']);
  assert.ok(Object.isFrozen(registry.listRunnerKinds()), 'RUNNER_KINDS must be frozen');
});

test('registerAdapter rejects a malformed adapter (fail-fast at the boundary)', () => {
  assert.throws(() => registry.registerAdapter(null), /adapter must be/);
  assert.throws(() => registry.registerAdapter({ kind: 'x' }), /adapter must be/);
  assert.throws(() => registry.registerAdapter({ kind: 'x', appliesTo: () => true }), /adapter must be/);
  assert.throws(() => registry.registerAdapter({ appliesTo: () => true, run: () => ({}) }), /adapter must be/);
});

test('Open/Closed: a newly registered adapter is resolvable without editing existing ones', () => {
  const marker = { picked: false };
  const fake = {
    kind: 'fake-oc-probe',
    appliesTo: (ctx) => ctx && ctx.testFile === '__oc_probe__',
    run: () => { marker.picked = true; return {}; },
  };
  registry.registerAdapter(fake);
  const resolved = registry.resolveAdapter({ testFile: '__oc_probe__', cwd: '/abs' });
  assert.strictEqual(resolved, fake, 'resolveAdapter should pick the newly registered adapter');
  // The node adapter is unaffected.
  assert.strictEqual(registry.resolveAdapter(NODE_CTX).kind, 'node');
});

test('L2: registerAdapter rejects a DUPLICATE kind unless {overwrite:true}', () => {
  // Guards against a stray registerAdapter('node', …) silently hijacking the live
  // runner in a long-lived R11 process (hacker VALIDATE L2).
  assert.throws(
    () => registry.registerAdapter({ kind: 'node', appliesTo: () => true, run: () => ({}) }),
    /already registered/,
  );
  // overwrite:true is the explicit escape hatch.
  const replacement = { kind: 'node', appliesTo: (c) => c && c.testFile === '__never__', run: () => ({}) };
  assert.doesNotThrow(() => registry.registerAdapter(replacement, { overwrite: true }));
  // restore the real node adapter so later tests / consumers are unaffected.
  registry.registerAdapter(require('../../../../packages/runtime/test-runners/node-runner'), { overwrite: true });
  assert.strictEqual(registry.getAdapter('node').kind, 'node');
});

test('F2 INVARIANT: the fixtures dir contains ZERO *.test.js files (CI-greenness)', () => {
  // The *.fixture.js naming is load-bearing: the widened CI glob
  // `find tests/unit/runtime -name '*.test.js'` would RUN any *.test.js fixture as a
  // suite — and fail.fixture's deliberate exit-1 would break CI. This converts the
  // naming convention into a checked invariant.
  const fixturesDir = path.join(__dirname, 'fixtures');
  const offenders = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.test.js'));
  assert.deepStrictEqual(offenders, [], `fixtures must NOT be named *.test.js: ${offenders.join(', ')}`);
});

process.stdout.write(`\nregistry.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
