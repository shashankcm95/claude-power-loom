#!/usr/bin/env node

// tests/unit/hooks/redirect-plan-mode-in-headless.test.js
//
// Regression guard for the GAP-G (v2.5.1) PreToolUse:EnterPlanMode hook.
// Verifies: headless detection via env-var, interactive pass-through,
// permission_mode signal, non-EnterPlanMode pass-through, malformed input
// fail-safe, observability log append.

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = path.resolve(__dirname, '../../../packages/kernel/hooks/pre/redirect-plan-mode-in-headless.js');

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

/**
 * Run the hook. opts.headless: '1' | '0' | undefined (use real detection).
 */
function runHook(envelope, opts = {}) {
  const env = {
    ...process.env,
    CLAUDE_HOOKS_QUIET: '1',
  };
  if (opts.headless !== undefined) env.CLAUDE_HEADLESS = opts.headless;

  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(envelope),
    encoding: 'utf8',
    env,
  });
  return { stdout: r.stdout || '', stderr: r.stderr || '', exitCode: r.status };
}

process.stdout.write('\n=== redirect-plan-mode-in-headless hook ===\n');

test('CLAUDE_HEADLESS=1 + EnterPlanMode → deny with redirect', () => {
  const out = runHook(
    { tool_name: 'EnterPlanMode', tool_input: {}, session_id: 'test-1' },
    { headless: '1' }
  );
  if (!out.stdout) throw new Error('expected JSON output, got empty');
  const decision = JSON.parse(out.stdout);
  const hs = decision.hookSpecificOutput;
  if (!hs) throw new Error('missing hookSpecificOutput');
  if (hs.hookEventName !== 'PreToolUse') throw new Error(`hookEventName=${hs.hookEventName}`);
  if (hs.permissionDecision !== 'deny') throw new Error(`expected deny, got ${hs.permissionDecision}`);
  if (!hs.permissionDecisionReason.includes('[HEADLESS-PLAN-MODE-DENIED]')) {
    throw new Error('reason missing forcing-instruction tag');
  }
  if (!hs.permissionDecisionReason.includes('TodoWrite')) {
    throw new Error('reason should redirect to TodoWrite');
  }
});

test('CLAUDE_HEADLESS=0 + EnterPlanMode → pass-through (allow)', () => {
  const out = runHook(
    { tool_name: 'EnterPlanMode', tool_input: {} },
    { headless: '0' }
  );
  // Empty output = no permissionDecision = tool proceeds normally
  if (out.stdout.trim() !== '') {
    throw new Error(`expected empty output for interactive, got: ${out.stdout}`);
  }
});

test('headless + non-EnterPlanMode tool → pass-through', () => {
  // The hooks.json matcher should filter, but defensive check too.
  const out = runHook(
    { tool_name: 'Bash', tool_input: { command: 'ls' } },
    { headless: '1' }
  );
  if (out.stdout.trim() !== '') {
    throw new Error(`expected empty output for non-EnterPlanMode tool, got: ${out.stdout}`);
  }
});

test('permission_mode=bypassPermissions → detected as headless without env override', () => {
  // No CLAUDE_HEADLESS env var; detection should fire on permission_mode signal alone.
  const out = runHook(
    { tool_name: 'EnterPlanMode', tool_input: {}, permission_mode: 'bypassPermissions' }
  );
  if (!out.stdout) throw new Error('expected JSON output');
  const decision = JSON.parse(out.stdout);
  if (decision.hookSpecificOutput.permissionDecision !== 'deny') {
    throw new Error(`expected deny on bypassPermissions, got ${decision.hookSpecificOutput.permissionDecision}`);
  }
  if (!decision.hookSpecificOutput.permissionDecisionReason.includes('permission_mode:bypassPermissions')) {
    throw new Error('reason should cite the permission_mode signal');
  }
});

test('permission_mode=auto → not headless (allow)', () => {
  const out = runHook(
    { tool_name: 'EnterPlanMode', tool_input: {}, permission_mode: 'auto' },
    { headless: '0' } // explicit non-headless via env to override ps-detection
  );
  if (out.stdout.trim() !== '') {
    throw new Error(`expected pass-through for auto mode, got: ${out.stdout}`);
  }
});

test('malformed JSON stdin → fail-safe pass-through', () => {
  const env = { ...process.env, CLAUDE_HOOKS_QUIET: '1', CLAUDE_HEADLESS: '1' };
  const r = spawnSync('node', [HOOK], { input: 'not json at all', encoding: 'utf8', env });
  if (r.status !== 0) throw new Error(`hook exit non-zero on bad JSON: ${r.status}`);
  if (r.stdout.trim() !== '') throw new Error(`expected empty output on bad JSON, got: ${r.stdout}`);
});

test('empty stdin → fail-safe pass-through', () => {
  const env = { ...process.env, CLAUDE_HOOKS_QUIET: '1', CLAUDE_HEADLESS: '1' };
  const r = spawnSync('node', [HOOK], { input: '', encoding: 'utf8', env });
  if (r.status !== 0) throw new Error(`hook exit non-zero on empty: ${r.status}`);
  // Empty envelope means tool_name is undefined, hook defensively passes through.
  if (r.stdout.trim() !== '') throw new Error(`expected empty output on empty input, got: ${r.stdout}`);
});

test('observability log records denial', () => {
  const LOG_FILE = path.join(os.homedir(), '.claude/checkpoints/headless-plan-redirect-log.jsonl');
  let preSize = 0;
  try { preSize = fs.statSync(LOG_FILE).size; } catch { /* may not exist yet */ }

  runHook(
    { tool_name: 'EnterPlanMode', tool_input: {}, session_id: 'test-obs-1' },
    { headless: '1' }
  );

  const postSize = fs.statSync(LOG_FILE).size;
  if (postSize <= preSize) throw new Error('observability log was not appended');

  const fd = fs.openSync(LOG_FILE, 'r');
  const buf = Buffer.alloc(postSize - preSize);
  fs.readSync(fd, buf, 0, postSize - preSize, preSize);
  fs.closeSync(fd);
  const lines = buf.toString('utf8').trim().split('\n').filter(Boolean);
  const last = JSON.parse(lines[lines.length - 1]);
  if (last.action !== 'deny_with_redirect') {
    throw new Error(`expected action='deny_with_redirect', got '${last.action}'`);
  }
  if (last.session_id !== 'test-obs-1') {
    throw new Error(`expected session_id='test-obs-1', got '${last.session_id}'`);
  }
  if (!Array.isArray(last.signals) || last.signals.length === 0) {
    throw new Error('expected signals array with at least one entry');
  }
});

test('redirect reason mentions GAP-G context + scenario 04', () => {
  const out = runHook(
    { tool_name: 'EnterPlanMode', tool_input: {} },
    { headless: '1' }
  );
  const decision = JSON.parse(out.stdout);
  const reason = decision.hookSpecificOutput.permissionDecisionReason;
  if (!reason.includes('GAP-G')) throw new Error('reason should mention GAP-G');
  if (!reason.includes('scenario 04')) throw new Error('reason should mention scenario 04 source');
  if (!reason.includes('12th forcing instruction')) throw new Error('should label itself as 12th in family');
  if (!reason.includes('Class 4')) throw new Error('should declare Class 4 (denial+redirect)');
});

test('redirect reason includes actionable TodoWrite usage hint', () => {
  const out = runHook(
    { tool_name: 'EnterPlanMode', tool_input: {} },
    { headless: '1' }
  );
  const reason = JSON.parse(out.stdout).hookSpecificOutput.permissionDecisionReason;
  if (!reason.includes('Call TodoWrite with')) {
    throw new Error('reason should give a concrete TodoWrite usage pattern');
  }
  if (!reason.includes('in_progress')) {
    throw new Error('reason should mention the in_progress status convention');
  }
});

process.stdout.write(`\n=== Summary ===\n`);
process.stdout.write(`  Passed: ${passed}\n`);
process.stdout.write(`  Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
