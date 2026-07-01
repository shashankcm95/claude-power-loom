#!/usr/bin/env node

// tests/unit/lab/causal-edge/judge-toolless.test.js
//
// ③.2.2c EC.c2a (the VERIFY board HIGH fold) — the live-loop judges MUST be tool-PINNED. Proves:
//   (1) the tool-less recipe constant + toollessArgs() helper,
//   (2) makeBlindSemanticJudge/makeFrictionLabeler thread `--tools "" --strict-mcp-config` into the
//       claude argv when toolless:true, and do NOT when toolless:false (sealed-corpus path unchanged).
// Uses a FAKE claude bin (records its argv to a sidecar) — NO real claude -p, NO API cost.

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// #430 host-deploy-state isolation (shared helper): neutralize the host `claude -p` deploy guard so these tests
// reach their DIRECT dev-spawn path on any host (incl. a deployed box with /etc/loom/actor-anthropic.key present).
require('../_lib/isolate-host-deploy-state').isolateHostDeployState();

const REPO = path.join(__dirname, '..', '..', '..', '..');
const { TOOLLESS_CLAUDE_ARGS, toollessArgs, verifyToollessRuntime } = require(path.join(REPO, 'packages', 'lab', '_lib', 'claude-headless.js'));
const { makeBlindSemanticJudge } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'calibration-issue-run.js'));
const { makeFrictionLabeler } = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'trajectory-friction-run.js'));

const _tests = [];
let passed = 0; let failed = 0;
function test(name, fn) { _tests.push({ name, fn }); }

// A fake `claude` bin: writes its received argv (everything after the script path) to $ARGV_SINK,
// prints a JSON object satisfying both judges, exits 0.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-toolless-'));
const fakeClaude = path.join(tmp, 'fake-claude.js');
fs.writeFileSync(fakeClaude,
  '#!/usr/bin/env node\n'
  + 'const fs=require("fs");\n'
  + 'if(process.env.ARGV_SINK) fs.writeFileSync(process.env.ARGV_SINK, JSON.stringify(process.argv.slice(2)));\n'
  + 'process.stdout.write(JSON.stringify({supported:true,friction_class:"wrong-file",friction_phase:"localization",detection_leg:"behavioral",human_message:"x"}));\n',
  { mode: 0o755 });

function capturedArgv(makeFn, toolless) {
  const sink = path.join(tmp, `argv-${Math.abs((makeFn.name + toolless).split('').reduce((a, c) => a + c.charCodeAt(0), 0))}.json`);
  const prevSink = process.env.ARGV_SINK;
  process.env.ARGV_SINK = sink;
  try {
    const judge = makeFn({ bin: fakeClaude, timeout: 10000, toolless });
    // semanticFn(input, candidate) and frictionFn(input) — both spawn claudeOnce -> the fake bin.
    judge({ id: 'x' }, 'diff');
    return JSON.parse(fs.readFileSync(sink, 'utf8'));
  } finally {
    if (prevSink === undefined) delete process.env.ARGV_SINK; else process.env.ARGV_SINK = prevSink;
  }
}

// The recipe was firsthand-verified against the live CLI init: `--tools "" --strict-mcp-config` alone
// leaves LSP enabled (the dogfood caught it); `--disallowedTools LSP` drops the residual => tools: [].
const RECIPE = ['--tools', '', '--strict-mcp-config', '--disallowedTools', 'LSP'];

test('the tool-less recipe constant is the firsthand-verified tools:[] incantation and frozen', () => {
  assert.deepStrictEqual(TOOLLESS_CLAUDE_ARGS, RECIPE);
  assert.ok(Object.isFrozen(TOOLLESS_CLAUDE_ARGS));
});

test('toollessArgs(true) deep-equals the recipe but is a FRESH array; toollessArgs(false) is []', () => {
  assert.deepStrictEqual(toollessArgs(true), RECIPE);
  assert.notStrictEqual(toollessArgs(true), TOOLLESS_CLAUDE_ARGS, 'returns a copy, never the frozen singleton');
  assert.deepStrictEqual(toollessArgs(false), []);
});

test('makeBlindSemanticJudge({toolless:true}) threads the FULL tool-less recipe into the claude argv', () => {
  const argv = capturedArgv(makeBlindSemanticJudge, true);
  assert.ok(argv.includes('--tools') && argv.includes('--strict-mcp-config'), 'tool-less flags present: ' + JSON.stringify(argv));
  const ti = argv.indexOf('--tools');
  assert.strictEqual(argv[ti + 1], '', '--tools is followed by the empty string');
  const di = argv.indexOf('--disallowedTools');
  assert.ok(di >= 0 && argv[di + 1] === 'LSP', '--disallowedTools LSP present (drops the always-on LSP leak): ' + JSON.stringify(argv));
  assert.ok(argv.includes('-p') && argv.includes('--model'), 'base flags preserved');
});

test('makeBlindSemanticJudge default (toolless:false) does NOT add tool flags (sealed path unchanged)', () => {
  const argv = capturedArgv(makeBlindSemanticJudge, false);
  assert.ok(!argv.includes('--tools') && !argv.includes('--strict-mcp-config'), 'no tool flags by default: ' + JSON.stringify(argv));
  assert.deepStrictEqual(argv, ['-p', '--model', 'claude-sonnet-4-6']);
});

test('makeFrictionLabeler({toolless:true}) threads the tool-less flags into the claude argv', () => {
  const argv = capturedArgv(makeFrictionLabeler, true);
  assert.ok(argv.includes('--tools') && argv.includes('--strict-mcp-config'), 'tool-less flags present: ' + JSON.stringify(argv));
});

test('makeFrictionLabeler default (toolless:false) does NOT add tool flags', () => {
  const argv = capturedArgv(makeFrictionLabeler, false);
  assert.ok(!argv.includes('--tools') && !argv.includes('--strict-mcp-config'), 'no tool flags by default: ' + JSON.stringify(argv));
});

// === ③.2.3 H5 — verifyToollessRuntime FAILS CLOSED on every path but a parsed EMPTY tools[] (VF3) ===
const initOut = (tools) => ({ status: 0, stdout: JSON.stringify({ type: 'system', subtype: 'init', tools }) + '\n' });
test('H5: verifyToollessRuntime ok ONLY on a parsed empty tools[]', () => {
  assert.strictEqual(verifyToollessRuntime({ bin: 'x', spawnFn: () => initOut([]) }).ok, true);
});
test('H5: a non-empty tools[] (a leak) FAILS CLOSED', () => {
  const r = verifyToollessRuntime({ bin: 'x', spawnFn: () => initOut(['LSP']) });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'tools-leaked');
  assert.deepStrictEqual(r.tools, ['LSP']);
});
test('H5: every inconclusive path FAILS CLOSED (bin-absent / spawn-throw / nonzero-exit / timeout / no-init / non-array)', () => {
  assert.strictEqual(verifyToollessRuntime({ bin: null }).ok, false);
  assert.strictEqual(verifyToollessRuntime({ bin: 'x', spawnFn: () => { throw new Error('boom'); } }).ok, false);
  assert.strictEqual(verifyToollessRuntime({ bin: 'x', spawnFn: () => ({ status: 1, stdout: '' }) }).ok, false);
  assert.strictEqual(verifyToollessRuntime({ bin: 'x', spawnFn: () => ({ error: { code: 'ETIMEDOUT' } }) }).ok, false);
  assert.strictEqual(verifyToollessRuntime({ bin: 'x', spawnFn: () => ({ status: 0, stdout: 'not json\n' }) }).ok, false);
  assert.strictEqual(verifyToollessRuntime({ bin: 'x', spawnFn: () => ({ status: 0, stdout: JSON.stringify({ type: 'system', subtype: 'init', tools: 'nope' }) + '\n' }) }).ok, false);
});

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && e.message}`); }
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* cleanup best-effort */ }
  console.log(`\njudge-toolless: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
