#!/usr/bin/env node

// tests/unit/hooks/contract-reminder-on-agent-spawn.test.js
//
// Regression guard for the GAP-E fix hook. Verifies hook output shape +
// subagent_type routing + plugin-prefix normalization + non-Agent passthrough.

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const HOOK = path.resolve(__dirname, '../../../hooks/scripts/contract-reminder-on-agent-spawn.js');

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

function invokeHook(stdinJson) {
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(stdinJson),
    encoding: 'utf8',
  });
  const out = (r.stdout || '').trim();
  if (!out) throw new Error('hook produced no output');
  return JSON.parse(out);
}

process.stdout.write('\n=== contract-reminder-on-agent-spawn hook ===\n');

test('architect spawn → injects reminder into prompt', () => {
  const out = invokeHook({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'architect', prompt: 'Original task text.' },
    hook_event_name: 'PreToolUse',
  });
  const hs = out.hookSpecificOutput;
  if (!hs) throw new Error('missing hookSpecificOutput');
  if (hs.permissionDecision !== 'allow') throw new Error(`permissionDecision=${hs.permissionDecision}`);
  if (hs.hookEventName !== 'PreToolUse') throw new Error(`hookEventName=${hs.hookEventName}`);
  const p = hs.updatedInput && hs.updatedInput.prompt;
  if (!p) throw new Error('missing updatedInput.prompt');
  if (!p.includes('CONTRACT-REMINDER')) throw new Error('reminder text missing');
  if (!p.includes('## KB Sources Consulted')) throw new Error('KB section name missing');
  if (!p.endsWith('Original task text.')) throw new Error(`prompt does not end with original task: ${p.slice(-50)}`);
});

test('plugin-prefixed power-loom:architect → also injects', () => {
  const out = invokeHook({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'power-loom:architect', prompt: 'x' },
  });
  if (!out.hookSpecificOutput) throw new Error('reminder not injected for plugin-prefixed name');
});

test('reminder includes concrete valid kb_id example', () => {
  const out = invokeHook({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'architect', prompt: 'x' },
  });
  const p = out.hookSpecificOutput.updatedInput.prompt;
  if (!p.includes('kb:architecture/crosscut/single-responsibility')) {
    throw new Error('reminder should include a concrete kb_id example');
  }
});

test('reminder warns against invalid kb-as-file-path format', () => {
  const out = invokeHook({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'architect', prompt: 'x' },
  });
  const p = out.hookSpecificOutput.updatedInput.prompt;
  if (!p.includes('INVALID') || !p.includes('file path')) {
    throw new Error('reminder should warn against kb:<file-path> format');
  }
});

test('code-reviewer spawn (not in CONTRACT_REMINDERS) → passes through', () => {
  const out = invokeHook({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'code-reviewer', prompt: 'review' },
  });
  if (Object.keys(out).length !== 0) {
    throw new Error(`expected empty output for non-contracted subagent_type, got: ${JSON.stringify(out)}`);
  }
});

test('non-Agent tool (Bash) → passes through', () => {
  const out = invokeHook({
    tool_name: 'Bash',
    tool_input: { command: 'ls' },
  });
  if (Object.keys(out).length !== 0) {
    throw new Error(`expected empty output for non-Agent tool, got: ${JSON.stringify(out)}`);
  }
});

test('Task tool name (Claude Code 1.x compat) → also injects', () => {
  const out = invokeHook({
    tool_name: 'Task',
    tool_input: { subagent_type: 'architect', prompt: 'x' },
  });
  if (!out.hookSpecificOutput) throw new Error('Task tool name should also trigger injection');
});

process.stdout.write(`\n=== Summary ===\n`);
process.stdout.write(`  Passed: ${passed}\n`);
process.stdout.write(`  Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
