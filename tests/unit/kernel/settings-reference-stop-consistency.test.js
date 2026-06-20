#!/usr/bin/env node
'use strict';

// tests/unit/kernel/settings-reference-stop-consistency.test.js
//
// Ghost Heartbeat go-live readiness. Lock the settings-reference.json <-> hooks.json
// Stop-block agreement. The Wave-2 phase-close caught the Stop carrier (#371) registered
// in hooks.json (the plugin manifest) but ABSENT from settings-reference.json (the
// manual-merge template install.sh directs users to) -> the carrier was deployed by
// NEITHER path. No test cross-checked the two templates, so the divergence was invisible
// to every per-PR review. This test fails the moment the two Stop blocks drift on the
// ordered set of hook scripts. (Stop-scoped: that is the finding; extend per event-type
// if a future divergence appears.)

const assert = require('assert');
const path = require('path');
const hooks = require('../../../packages/kernel/hooks.json');
const settingsRef = require('../../../packages/kernel/settings-reference.json');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

// The ordered list of hook-script basenames in a Stop block. The two configs differ ONLY
// by the command path prefix (hooks.json: ${CLAUDE_PLUGIN_ROOT}; settings-reference:
// HOME_DIR), so compare by basename: every real command is an absolute path, so the
// segment after the last "/" is the .js file (path.basename of the full command string).
function stopScripts(cfg) {
  const stop = (cfg.hooks && cfg.hooks.Stop) || [];
  return stop.map((entry) => (entry.hooks || []).map((h) => path.basename((h.command || '').trim())).join('+'));
}

process.stdout.write('\n=== settings-reference <-> hooks.json Stop consistency ===\n');

test('the two Stop blocks carry the SAME ordered set of hook scripts', () => {
  assert.deepStrictEqual(stopScripts(settingsRef), stopScripts(hooks),
    'settings-reference.json (manual-merge template) Stop block drifted from hooks.json (plugin manifest)');
});

test('the ghost-heartbeat-stop carrier is present in BOTH Stop blocks', () => {
  const present = (cfg) => stopScripts(cfg).some((s) => s.includes('ghost-heartbeat-stop.js'));
  assert.ok(present(hooks), 'ghost-heartbeat-stop.js missing from hooks.json');
  assert.ok(present(settingsRef), 'ghost-heartbeat-stop.js missing from settings-reference.json (manual-merge template -> the carrier would be undeployed)');
});

test('the settings-reference ghost-heartbeat entry carries id stop:ghost-heartbeat', () => {
  const stop = settingsRef.hooks.Stop;
  const entry = stop.find((e) => (e.hooks || []).some((h) => (h.command || '').includes('ghost-heartbeat-stop.js')));
  assert.ok(entry, 'no ghost-heartbeat-stop entry in settings-reference Stop');
  assert.strictEqual(entry.id, 'stop:ghost-heartbeat', `expected id stop:ghost-heartbeat, got ${entry.id}`);
});

process.stdout.write(`\n  Passed: ${passed}  Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
