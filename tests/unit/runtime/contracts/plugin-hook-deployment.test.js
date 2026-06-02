#!/usr/bin/env node

// tests/unit/runtime/contracts/plugin-hook-deployment.test.js
//
// Unit tests for the `contract-plugin-hook-deployment` validator's
// out-of-session behavior (previously covered only by tests/smoke-h7.sh
// Test 38). Closes the env-dependent `hook-not-deployed` false-positive
// diagnosed after #206:
//
//   When run from a bare shell (CLAUDE_PLUGIN_ROOT unset) on a real install,
//   the plugin is enabled via settings.json `enabledPlugins` but its hooks are
//   injected by the plugin loader (NOT written to settings.json.hooks), so the
//   validator used to count every plugin hook as "not deployed."
//
// The fix COMPLETES H.7.24 (it does not reverse the deliberate
// don't-auto-pass-on-enabledPlugins decision): when enabledPlugins is truthy,
// VERIFY the real install via ~/.claude/plugins/installed_plugins.json ->
// installPath/packages/kernel/hooks.json. Present + non-empty -> the loader
// deploys the hooks -> pass. Absent (broken/failed install) -> still flag.
//
// The validator reads settings.json + installed_plugins.json from $HOME and the
// plugin hooks.json from the toolkit root (cwd). These tests mock $HOME and run
// against the real repo hooks.json.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const VALIDATOR = path.join(
  REPO_ROOT, 'packages', 'runtime', 'orchestration', 'contracts-validate.js',
);
const VALIDATOR_NAME = 'contract-plugin-hook-deployment';
const PLUGIN_ID = 'power-loom@power-loom-marketplace';

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

// Build a mock $HOME. Options:
//   settings:false      -> no .claude/settings.json (CI / fresh-install path)
//   enabled:true        -> settings.json declares enabledPlugins[power-loom]=true, hooks:{}
//   installRecord:true  -> installed_plugins.json points at a cache dir that
//                          CONTAINS packages/kernel/hooks.json (a real install)
//   cacheMode           -> what the cached hooks.json carries:
//                          'full'    = a copy of the REAL repo hooks.json (covers
//                                      every repo triple — the up-to-date install)
//                          'partial' = a non-empty cache MISSING the repo hooks
//                                      (a STALE install — repo added hooks since)
//                          'empty'   = `{ hooks: {} }` (corrupt/partial install)
function makeMockHome({ settings = true, enabled = true, installRecord = false, cacheMode = 'full' }) {
  const home = path.join(os.tmpdir(), 'plugin-hook-dep-' + crypto.randomBytes(6).toString('hex'));
  const claudeDir = path.join(home, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });

  if (settings) {
    const s = { hooks: {}, enabledPlugins: enabled ? { [PLUGIN_ID]: true } : {} };
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify(s, null, 2));
  }

  if (installRecord) {
    const pluginsDir = path.join(claudeDir, 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
    const installPath = path.join(pluginsDir, 'cache', 'power-loom-marketplace', 'power-loom', '3.1.0');
    const kernelDir = path.join(installPath, 'packages', 'kernel');
    fs.mkdirSync(kernelDir, { recursive: true });
    let hooks;
    if (cacheMode === 'full') {
      // copy the REAL repo hooks.json so the cache covers every repo triple
      hooks = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'packages', 'kernel', 'hooks.json'), 'utf8'));
    } else if (cacheMode === 'partial') {
      // a non-empty cache that does NOT carry the repo hooks (stale install)
      hooks = { hooks: { PreToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'node stale-only.js' }] }] } };
    } else { // 'empty'
      hooks = { hooks: {} };
    }
    fs.writeFileSync(path.join(kernelDir, 'hooks.json'), JSON.stringify(hooks, null, 2));
    const record = { version: 2, plugins: { [PLUGIN_ID]: [{ scope: 'user', installPath, version: '3.1.0' }] } };
    fs.writeFileSync(path.join(pluginsDir, 'installed_plugins.json'), JSON.stringify(record, null, 2));
  }
  return home;
}

function runValidator(mockHome) {
  const env = { ...process.env, HOME: mockHome };
  delete env.CLAUDE_PLUGIN_ROOT; // force the out-of-session path
  const r = spawnSync('node', [VALIDATOR, '--scope', VALIDATOR_NAME, '--json'], {
    env, cwd: REPO_ROOT, encoding: 'utf8',
  });
  let report = null;
  try { report = JSON.parse(r.stdout); } catch { /* leave null */ }
  return { report, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// --- the pass path: enabled + a cache that COVERS all repo hooks => 0 violations ---

test('enabled + install cache that COVERS all repo hooks => 0 violations', () => {
  const home = makeMockHome({ enabled: true, installRecord: true, cacheMode: 'full' });
  const { report, stderr } = runValidator(home);
  assert.ok(report, 'expected JSON report');
  assert.strictEqual(report.totalViolations, 0, JSON.stringify((report.violations[VALIDATOR_NAME] || {}).violations));
  assert.ok(/covers all|deployed/i.test(stderr), 'expected the cache-covers-all informational stderr');
});

// --- preserved fall-through: enabled but NO install record => still flags + H.7.24 message ---

test('enabled but NO installed_plugins.json => violations + H.7.24 informational stderr (preserved)', () => {
  const home = makeMockHome({ enabled: true, installRecord: false });
  const { report, stderr } = runValidator(home);
  assert.ok(report.totalViolations > 0, 'an unconfirmable install must still flag (broken-cache detection)');
  assert.ok(/enabledPlugins shows.*enabled/.test(stderr), 'H.7.24 informational message must still fire (smoke Test 38)');
});

// --- false-pass guard (code-review Finding 1/3): a STALE cache missing repo
//     hooks must NOT auto-pass — it must flag exactly the missing delta ---

test('enabled + STALE cache (non-empty, missing repo hooks) => flags the missing delta', () => {
  const home = makeMockHome({ enabled: true, installRecord: true, cacheMode: 'partial' });
  const { report } = runValidator(home);
  assert.ok(report.totalViolations > 0, 'a stale cache missing repo hooks must NOT pass (false-pass guard)');
  const v = ((report.violations[VALIDATOR_NAME] || {}).violations || [])
    .find((x) => x.kind === 'hook-not-in-installed-cache');
  assert.ok(v, 'expected hook-not-in-installed-cache violations for the stale delta');
});

// --- corrupt cache: enabled + install record but EMPTY cache hooks.json => still flags ---

test('enabled + install record but EMPTY cache hooks.json => still flags (corrupt install)', () => {
  const home = makeMockHome({ enabled: true, installRecord: true, cacheMode: 'empty' });
  const { report } = runValidator(home);
  assert.ok(report.totalViolations > 0, 'an empty/corrupt cache hooks.json must NOT pass');
});

// --- CI / fresh-install path: no settings.json => 0 violations (auto-pass) ---

test('no settings.json (CI / fresh install) => 0 violations', () => {
  const home = makeMockHome({ settings: false });
  const { report } = runValidator(home);
  assert.strictEqual(report.totalViolations, 0, 'absent settings.json => informational auto-pass');
});

process.stdout.write(`\nplugin-hook-deployment.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
