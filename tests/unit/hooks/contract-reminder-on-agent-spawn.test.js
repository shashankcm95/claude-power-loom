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
  // The reminder must steer the model away from kb_id formats that aren't in
  // the canonical index. v2.4.3 reworded the warning to avoid using a
  // kb:-formatted "do not cite" example (the model literally cited that
  // example in scenario 02 verification — security-auditor produced
  // `kb:my-rules/foo` because the reminder included it as a counterexample).
  const out = invokeHook({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'architect', prompt: 'x' },
  });
  const p = out.hookSpecificOutput.updatedInput.prompt;
  if (!p.includes('NOT a filesystem path')) throw new Error('reminder should warn against filesystem-path kb_ids');
  if (!p.includes('do NOT invent kb_ids')) throw new Error('reminder should forbid inventing kb_ids');
});

test('unknown subagent_type (general-purpose) → passes through', () => {
  // Pre-v2.4.3 this test used code-reviewer as the non-contracted example;
  // v2.4.3 added code-reviewer + security-auditor + planner + optimizer as
  // contracted types. Use general-purpose (Claude Code built-in, no plugin
  // contract) as the new control for the passthrough path.
  const out = invokeHook({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'general-purpose', prompt: 'do something' },
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

// --- Extended coverage (v2.4.3): contract-reminders for 4 additional agents ---

test('code-reviewer → injects per-finding inline citation contract', () => {
  const out = invokeHook({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'code-reviewer', prompt: 'review my diff' },
  });
  const p = out.hookSpecificOutput && out.hookSpecificOutput.updatedInput.prompt;
  if (!p) throw new Error('reminder not injected for code-reviewer');
  if (!p.includes('PRINCIPLE-severity finding MUST cite')) throw new Error('per-finding inline-cite contract missing');
  if (!p.includes('[needs-kb-cite]')) throw new Error('needs-kb-cite tag mechanism not mentioned');
  if (!p.includes('APPROVE | APPROVE-WITH-NITS | REQUEST-CHANGES | BLOCK')) throw new Error('verdict line missing');
  if (!p.includes('kb:security-dev/auth-patterns')) throw new Error('CRITICAL kb_id example missing');
});

test('security-auditor → injects severity + kb:security-dev contract', () => {
  const out = invokeHook({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'security-auditor', prompt: 'audit my code' },
  });
  const p = out.hookSpecificOutput && out.hookSpecificOutput.updatedInput.prompt;
  if (!p) throw new Error('reminder not injected for security-auditor');
  if (!p.includes('CRITICAL / HIGH finding MUST cite')) throw new Error('CRITICAL/HIGH cite contract missing');
  if (!p.includes('kb:security-dev/auth-patterns')) throw new Error('auth-patterns kb_id example missing');
  if (!p.includes('CRITICAL / HIGH / MEDIUM / LOW')) throw new Error('severity scale missing');
});

test('planner → injects Principle Audit + kb-anchored phase rationale contract', () => {
  const out = invokeHook({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'planner', prompt: 'plan this feature' },
  });
  const p = out.hookSpecificOutput && out.hookSpecificOutput.updatedInput.prompt;
  if (!p) throw new Error('reminder not injected for planner');
  if (!p.includes('## Principle Audit')) throw new Error('Principle Audit section name missing');
  if (!p.includes('SOLID, DRY, KISS, YAGNI')) throw new Error('foundational principles list missing');
  if (!p.includes('## HETS Spawn Plan')) throw new Error('HETS-routed plan section reference missing');
});

test('optimizer → injects KB Sources Consulted section contract', () => {
  const out = invokeHook({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'optimizer', prompt: 'optimize my code' },
  });
  const p = out.hookSpecificOutput && out.hookSpecificOutput.updatedInput.prompt;
  if (!p) throw new Error('reminder not injected for optimizer');
  if (!p.includes('## KB Sources Consulted')) throw new Error('KB Sources Consulted section name missing');
  if (!p.includes('kb:infra-dev/observability-basics')) throw new Error('observability kb_id example missing');
  if (!p.includes('kb:architecture/discipline/reliability-scalability-maintainability')) throw new Error('RSM kb_id example missing');
});

test('plugin-prefixed power-loom:code-reviewer → also injects (normalization)', () => {
  const out = invokeHook({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'power-loom:code-reviewer', prompt: 'x' },
  });
  if (!out.hookSpecificOutput) throw new Error('plugin-prefixed code-reviewer should inject');
});

test('plugin-prefixed power-loom:security-auditor → also injects (normalization)', () => {
  const out = invokeHook({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'power-loom:security-auditor', prompt: 'x' },
  });
  if (!out.hookSpecificOutput) throw new Error('plugin-prefixed security-auditor should inject');
});

process.stdout.write(`\n=== Summary ===\n`);
process.stdout.write(`  Passed: ${passed}\n`);
process.stdout.write(`  Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
