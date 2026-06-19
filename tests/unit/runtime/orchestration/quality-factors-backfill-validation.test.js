#!/usr/bin/env node

// tests/unit/runtime/orchestration/quality-factors-backfill-validation.test.js
//
// quality-factors-backfill-validation - pins the store.identities shape guard
// in quality-factors-backfill.js.
//
// The prior main() ran `Object.entries(store.identities)` with no validation
// that store.identities existed or was the expected shape. A store JSON missing
// the `identities` key (or with it null / an array / a primitive) threw
// `TypeError: Cannot convert undefined or null to object` - a fail-loud crash
// instead of a graceful 0-identity summary. The fix validates via
// hasValidIdentities() and fail-softs to an empty identities map.
//
// Two layers:
//   1. Unit - hasValidIdentities() across well-formed and malformed shapes.
//   2. Integration - run the CLI as a subprocess against a malformed store and
//      assert it exits 0 (no crash) and reports a graceful 0-identity summary.
//
// Dependency-free: node + node:assert only (matches the repo's unit suites).

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const BACKFILL = path.join(
  __dirname,
  '../../../../packages/runtime/orchestration/quality-factors-backfill.js',
);
const { hasValidIdentities } = require(BACKFILL);

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// --- Layer 1: hasValidIdentities() unit coverage ---------------------------

test('accepts a well-formed { identities: {} } store', () => {
  assert.strictEqual(hasValidIdentities({ identities: {} }), true);
  assert.strictEqual(hasValidIdentities({ identities: { 'a.x': {} } }), true);
});

test('rejects a store with no `identities` key', () => {
  assert.strictEqual(hasValidIdentities({}), false);
});

test('rejects `identities: null`', () => {
  assert.strictEqual(hasValidIdentities({ identities: null }), false);
});

test('rejects `identities` as an array', () => {
  assert.strictEqual(hasValidIdentities({ identities: [] }), false);
});

test('rejects `identities` as a primitive', () => {
  assert.strictEqual(hasValidIdentities({ identities: 'nope' }), false);
  assert.strictEqual(hasValidIdentities({ identities: 7 }), false);
});

test('rejects a null / undefined store', () => {
  assert.strictEqual(hasValidIdentities(null), false);
  assert.strictEqual(hasValidIdentities(undefined), false);
});

// --- Layer 2: malformed-store CLI path does not crash ----------------------

function withTmpHome(storeContent, fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qfb-home-'));
  const claudeDir = path.join(home, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  // A present spawn-history file so the CLI passes readSpawnHistory() and
  // reaches the identities-iteration path under test.
  fs.writeFileSync(
    path.join(claudeDir, 'spawn-history.jsonl'),
    `${JSON.stringify({ identity: 'x', verdict: 'pass', tokens: 1000 })}\n`,
  );
  const storePath = path.join(claudeDir, 'agent-identities.json');
  fs.writeFileSync(storePath, storeContent);
  try {
    return fn({ home, storePath });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function runBackfill({ home, storePath, dryRun }) {
  const argv = dryRun ? [BACKFILL, '--dry-run'] : [BACKFILL];
  return spawnSync(process.execPath, argv, {
    env: { ...process.env, HOME: home, HETS_IDENTITY_STORE: storePath },
    encoding: 'utf8',
  });
}

test('malformed store (no identities key) exits 0 with a 0-identity summary', () => {
  withTmpHome(JSON.stringify({ version: 1 }), ({ home, storePath }) => {
    const res = runBackfill({ home, storePath, dryRun: true });
    assert.strictEqual(res.status, 0, `expected exit 0, got ${res.status} (stderr: ${res.stderr})`);
    const out = JSON.parse(res.stdout);
    assert.strictEqual(out.summary.backfilled, 0);
    assert.strictEqual(out.summary.skipped, 0);
    assert.strictEqual(out.summary.untouched, 0);
    assert.deepStrictEqual(out.summary.perIdentity, {});
  });
});

test('malformed store (identities: null) does not throw', () => {
  withTmpHome(JSON.stringify({ identities: null }), ({ home, storePath }) => {
    const res = runBackfill({ home, storePath, dryRun: true });
    assert.strictEqual(res.status, 0, `expected exit 0, got ${res.status} (stderr: ${res.stderr})`);
    assert.ok(/no valid `identities`/i.test(res.stderr), 'expected a malformed-store warning on stderr');
  });
});

test('malformed store (identities: array) does not throw', () => {
  withTmpHome(JSON.stringify({ identities: [] }), ({ home, storePath }) => {
    const res = runBackfill({ home, storePath, dryRun: true });
    assert.strictEqual(res.status, 0, `expected exit 0, got ${res.status} (stderr: ${res.stderr})`);
    const out = JSON.parse(res.stdout);
    assert.strictEqual(out.summary.backfilled, 0);
  });
});

test('non-dry-run on a malformed store leaves the store file untouched', () => {
  const original = JSON.stringify({ identities: null });
  withTmpHome(original, ({ home, storePath }) => {
    const res = runBackfill({ home, storePath, dryRun: false });
    assert.strictEqual(res.status, 0, `expected exit 0, got ${res.status} (stderr: ${res.stderr})`);
    assert.strictEqual(fs.readFileSync(storePath, 'utf8'), original, 'malformed store was rewritten');
  });
});

test('well-formed store still backfills from spawn history', () => {
  const store = JSON.stringify({ identities: { x: { quality_factors_history: [] } } });
  withTmpHome(store, ({ home, storePath }) => {
    const res = runBackfill({ home, storePath, dryRun: true });
    assert.strictEqual(res.status, 0, `expected exit 0, got ${res.status} (stderr: ${res.stderr})`);
    const out = JSON.parse(res.stdout);
    assert.strictEqual(out.summary.backfilled, 1, 'expected the one verdict-bearing identity to be backfilled');
  });
});

if (failed > 0) {
  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  process.exit(1);
}
process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
