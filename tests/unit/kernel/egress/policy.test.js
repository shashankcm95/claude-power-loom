'use strict';

// tests/unit/kernel/egress/policy.test.js — ③.2.1b PR-B (the egress policy gates).
// Injected clock + injected responses (no live emission this wave).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const REPO = path.join(__dirname, '..', '..', '..', '..');
const P = require(path.join(REPO, 'packages', 'kernel', 'egress', 'policy.js'));

let passed = 0; let failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function scratch() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-policy-')); }

const HOUR = 60 * 60 * 1000;

test('cap: GLOBAL per-window — exceeded after perWindowCap emits; a rolled window resets', () => {
  const dir = scratch(); const state = path.join(dir, 'cap.json');
  try {
    const opts = { now: 1_000_000, perWindowCap: 3, windowMs: 24 * HOUR };
    assert.strictEqual(P.capExceeded(state, opts), false, 'fresh state is under cap');
    P.recordEmit(state, opts); P.recordEmit(state, opts); P.recordEmit(state, opts); // 3 emits == cap
    assert.strictEqual(P.capExceeded(state, opts), true, 'at cap => exceeded (fail-closed)');
    // a window roll (now far in the future) resets the count.
    assert.strictEqual(P.capExceeded(state, { ...opts, now: 1_000_000 + 25 * HOUR }), false, 'a rolled window resets');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('cap: a corrupt/missing state file fails CLOSED to a fresh window (no crash)', () => {
  const dir = scratch(); const state = path.join(dir, 'cap.json');
  try {
    fs.writeFileSync(state, '{ not json');
    assert.strictEqual(P.capExceeded(state, { now: 1, perWindowCap: 1 }), false, 'corrupt => fresh (count 0)');
    assert.strictEqual(P.capExceeded(path.join(dir, 'absent.json'), { now: 1, perWindowCap: 1 }), false, 'absent => fresh');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('etiquetteKey: CANONICAL — Owner/Repo.git + #7 collapses to owner/repo + 7', () => {
  assert.strictEqual(P.etiquetteKey('Owner/Repo.git', '#7'), 'owner/repo#7');
  assert.strictEqual(P.etiquetteKey('owner/repo', 7), 'owner/repo#7');
  assert.strictEqual(P.etiquetteKey('OWNER/REPO', 7), P.etiquetteKey('owner/repo', '7'), 'casing collapses');
});

test('etiquette: a 2nd emit to the same CANONICAL key is detected (one-PR-per-issue)', () => {
  const dir = scratch(); const ledger = path.join(dir, 'ledger');
  try {
    const k1 = P.etiquetteKey('Owner/Repo.git', '#7');
    assert.strictEqual(P.alreadyEmitted(ledger, k1), false, 'first time: not emitted');
    assert.strictEqual(P.recordEmitted(ledger, k1), true, 'records the key');
    // a casing/.git variant canonicalizes to the SAME key => detected.
    assert.strictEqual(P.alreadyEmitted(ledger, P.etiquetteKey('owner/repo', 7)), true, '2nd canonical emit is detected');
    assert.strictEqual(P.recordEmitted(ledger, P.etiquetteKey('owner/repo', 7)), false, 'idempotent: not re-added');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('backpressure: halts iff the last `threshold` responses are ALL 429/abuse', () => {
  assert.strictEqual(P.backpressureHalts([200, 429, 429], 3), false, 'not all of the last 3 are rate-limited');
  assert.strictEqual(P.backpressureHalts([429, 429, 429], 3), true, '3 consecutive 429 => halt');
  assert.strictEqual(P.backpressureHalts([200, 403, 429, 429, 403], 3), true, 'last 3 are abuse/rate-limit => halt');
  assert.strictEqual(P.backpressureHalts([429, 429], 3), false, 'fewer than threshold => no halt');
  assert.strictEqual(P.backpressureHalts([200, 200, 200], 3), false, 'all OK => no halt');
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== policy.test.js: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
})();
