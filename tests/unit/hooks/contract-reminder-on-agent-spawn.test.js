#!/usr/bin/env node

// tests/unit/hooks/contract-reminder-on-agent-spawn.test.js
//
// Contract: this hook is OBSERVABILITY ONLY (ADR-0012 — a PreToolUse hook's
// `updatedInput` is inert on Agent/Task spawns, so the hook must NOT emit it).
// For a contracted persona it passes through unchanged AND appends a log entry
// recording which reminder maps to the spawn (applied:false). Non-contracted /
// non-Agent inputs pass through with no log entry.

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = path.resolve(__dirname, '../../../packages/kernel/hooks/pre/contract-reminder-on-agent-spawn.js');
const CONTRACTED = ['architect', 'code-reviewer', 'security-auditor', 'planner', 'optimizer'];

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

function invokeHook(stdinJson, homeDir) {
  const env = { ...process.env };
  if (homeDir) env.HOME = homeDir;
  const r = spawnSync('node', [HOOK], { input: JSON.stringify(stdinJson), encoding: 'utf8', env });
  const out = (r.stdout || '').trim();
  if (!out) throw new Error('hook produced no output');
  return JSON.parse(out);
}

function readLog(homeDir) {
  const p = path.join(homeDir, '.claude/checkpoints/contract-reminder-log.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function withTmpHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'crh-'));
  try { return fn(home); } finally { fs.rmSync(home, { recursive: true, force: true }); }
}

function assertPassthrough(out) {
  if (out.hookSpecificOutput) throw new Error(`must not emit hookSpecificOutput (updatedInput is inert per ADR-0012); got ${JSON.stringify(out)}`);
  if (Object.keys(out).length !== 0) throw new Error(`expected empty pass-through output, got ${JSON.stringify(out)}`);
}

process.stdout.write('\n=== contract-reminder-on-agent-spawn hook (observability-only, ADR-0012) ===\n');

test('architect spawn → pass-through (no prompt mutation) + observability log', () => {
  withTmpHome((home) => {
    const out = invokeHook({
      tool_name: 'Agent',
      tool_input: { subagent_type: 'architect', prompt: 'Original task text.' },
      hook_event_name: 'PreToolUse',
    }, home);
    assertPassthrough(out);
    const log = readLog(home);
    if (log.length !== 1) throw new Error(`expected 1 log entry, got ${log.length}`);
    const e = log[0];
    if (e.subagent_base !== 'architect') throw new Error(`subagent_base=${e.subagent_base}`);
    if (e.applied !== false) throw new Error('log must record applied:false');
    if (!(e.reminder_len > 0)) throw new Error('expected a non-empty mapped reminder');
    if (e.original_prompt_len !== 'Original task text.'.length) throw new Error(`original_prompt_len=${e.original_prompt_len}`);
    if (typeof e.new_prompt_len !== 'undefined') throw new Error('must not record a misleading new_prompt_len (no mutation happens)');
  });
});

for (const persona of CONTRACTED) {
  test(`${persona} → pass-through + logs applied:false (never emits updatedInput)`, () => {
    withTmpHome((home) => {
      const out = invokeHook({ tool_name: 'Agent', tool_input: { subagent_type: persona, prompt: 'x' } }, home);
      assertPassthrough(out);
      const log = readLog(home);
      if (log.length !== 1 || log[0].subagent_base !== persona || log[0].applied !== false) {
        throw new Error(`expected one applied:false log for ${persona}, got ${JSON.stringify(log)}`);
      }
    });
  });
}

test('plugin-prefixed power-loom:architect → normalized to architect, pass-through + logged', () => {
  withTmpHome((home) => {
    const out = invokeHook({ tool_name: 'Agent', tool_input: { subagent_type: 'power-loom:architect', prompt: 'x' } }, home);
    assertPassthrough(out);
    const log = readLog(home);
    if (log.length !== 1 || log[0].subagent_base !== 'architect') throw new Error(`expected normalized architect log, got ${JSON.stringify(log)}`);
  });
});

test('Task tool name (Claude Code 1.x compat) → recognized, pass-through + logged', () => {
  withTmpHome((home) => {
    const out = invokeHook({ tool_name: 'Task', tool_input: { subagent_type: 'architect', prompt: 'x' } }, home);
    assertPassthrough(out);
    if (readLog(home).length !== 1) throw new Error('Task spawn of a contracted persona should still be logged');
  });
});

test('unknown subagent_type (general-purpose) → pass-through, NO log entry', () => {
  withTmpHome((home) => {
    const out = invokeHook({ tool_name: 'Agent', tool_input: { subagent_type: 'general-purpose', prompt: 'do something' } }, home);
    assertPassthrough(out);
    if (readLog(home).length !== 0) throw new Error('non-contracted subagent must not be logged');
  });
});

test('non-Agent tool (Bash) → pass-through, NO log entry', () => {
  withTmpHome((home) => {
    const out = invokeHook({ tool_name: 'Bash', tool_input: { command: 'ls' } }, home);
    assertPassthrough(out);
    if (readLog(home).length !== 0) throw new Error('non-Agent tool must not be logged');
  });
});

process.stdout.write('\n=== Summary ===\n');
process.stdout.write(`  Passed: ${passed}\n`);
process.stdout.write(`  Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
