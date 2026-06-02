#!/usr/bin/env node

'use strict';

// tests/unit/kernel/hooks/_lib/_log.test.js
//
// Contract for packages/kernel/hooks/_lib/_log.js log-directory resolution.
//
// Closes the test-hygiene debt: _log.js used to bind LOG_DIR to ~/.claude/logs
// at module load, so any hermetic test that runs a hook subprocess (all 4 set
// LOOM_SPAWN_STATE_DIR) leaked fixture noise (nomut01, e2e01, …) into the real
// developer log. The fix is resolveLogDir(), read live at logger creation:
//   1. LOOM_LOG_DIR          — explicit override (tests / operators)
//   2. LOOM_SPAWN_STATE_DIR  — when set, logs go under <dir>/_logs (hermetic)
//   3. ~/.claude/logs        — production default (both unset; UNCHANGED)

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODULE_PATH = path.join(
  __dirname, '..', '..', '..', '..', '..',
  'packages', 'kernel', 'hooks', '_lib', '_log.js',
);
const { log, resolveLogDir } = require(MODULE_PATH);

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// Save/restore the three env vars so no test leaks into another (immutable
// w.r.t. the ambient environment — restored in finally).
const ENV_KEYS = ['LOOM_LOG_DIR', 'LOOM_SPAWN_STATE_DIR', 'CLAUDE_HOOKS_QUIET'];
function withEnv(overrides, fn) {
  const saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(overrides)) process.env[k] = v;
  try { return fn(); }
  finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

// --- resolveLogDir() resolution order ---

test('default: neither env var set → ~/.claude/logs (production unchanged)', () => {
  withEnv({}, () => {
    assert.strictEqual(resolveLogDir(), path.join(os.homedir(), '.claude', 'logs'));
  });
});

test('LOOM_LOG_DIR: explicit override is returned verbatim', () => {
  withEnv({ LOOM_LOG_DIR: '/tmp/explicit-logs' }, () => {
    assert.strictEqual(resolveLogDir(), '/tmp/explicit-logs');
  });
});

test('LOOM_SPAWN_STATE_DIR (no LOOM_LOG_DIR) → <stateDir>/_logs', () => {
  withEnv({ LOOM_SPAWN_STATE_DIR: '/tmp/hermetic-state' }, () => {
    assert.strictEqual(resolveLogDir(), path.join('/tmp/hermetic-state', '_logs'));
  });
});

test('precedence: LOOM_LOG_DIR wins over LOOM_SPAWN_STATE_DIR', () => {
  withEnv({ LOOM_LOG_DIR: '/tmp/explicit', LOOM_SPAWN_STATE_DIR: '/tmp/state' }, () => {
    assert.strictEqual(resolveLogDir(), '/tmp/explicit');
  });
});

// --- integration: the logger writes to the resolved dir, not the real one ---

test('logger writes under LOOM_LOG_DIR and does NOT pollute ~/.claude/logs', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-log-test-'));
  const hookName = 'unit-hermetic-probe-loomlogdir';
  const realPath = path.join(os.homedir(), '.claude', 'logs', `${hookName}.log`);
  // Remove any leftover (e.g. from a RED run on the OLD code that wrote here)
  // so the anti-pollution assertion is robust + idempotent across runs.
  fs.rmSync(realPath, { force: true });
  try {
    withEnv({ LOOM_LOG_DIR: tmp }, () => {
      log(hookName)('probe-event', { ok: true });
      const expected = path.join(tmp, `${hookName}.log`);
      assert.ok(fs.existsSync(expected), `expected log at ${expected}`);
      assert.ok(fs.readFileSync(expected, 'utf8').includes('probe-event'), 'log line written');
      assert.ok(!fs.existsSync(realPath), 'must NOT have written to ~/.claude/logs');
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('logger writes under <LOOM_SPAWN_STATE_DIR>/_logs (auto-hermetic for the 4 subprocess tests)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-state-test-'));
  try {
    withEnv({ LOOM_SPAWN_STATE_DIR: tmp }, () => {
      const hookName = 'unit-state-derived-probe';
      log(hookName)('probe-event', { ok: true });
      const expected = path.join(tmp, '_logs', `${hookName}.log`);
      assert.ok(fs.existsSync(expected), `expected log at ${expected}`);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
