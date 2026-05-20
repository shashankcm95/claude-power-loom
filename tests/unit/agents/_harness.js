#!/usr/bin/env node

// tests/unit/agents/_harness.js — shared utilities for agent unit tests.
//
// Two test categories:
//   1. STATIC — file-content assertions on agents/<name>.md. Cheap (~10ms).
//   2. BEHAVIORAL — spawn the agent via `claude -p` against a fixture task and
//      assert on the structured response. Expensive (~30-60s, ~$0.10-0.30/test).
//
// Behavioral tests are opt-in via env var BEHAVIORAL=1 because they cost
// tokens. CI + default `node test.js` runs only static.
//
// Pattern mirrors scripts/agent-team/_h70-test.js (custom runner, no Jest dep).

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TOOLKIT_ROOT = path.resolve(__dirname, '../../..');
const AGENTS_DIR = path.join(TOOLKIT_ROOT, 'agents');

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    passed += 1;
    process.stdout.write(`  ✓ ${message}\n`);
  } else {
    failed += 1;
    failures.push(message);
    process.stdout.write(`  ✗ ${message}\n`);
  }
}

function assertMatch(haystack, pattern, message) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  assert(re.test(haystack), `${message} (pattern: ${re.source})`);
}

function assertContains(haystack, substr, message) {
  assert(haystack.includes(substr), `${message} (expected substring: ${JSON.stringify(substr).slice(0, 80)})`);
}

function readAgentDefinition(agentName) {
  const file = path.join(AGENTS_DIR, `${agentName}.md`);
  if (!fs.existsSync(file)) throw new Error(`agent not found: ${file}`);
  return fs.readFileSync(file, 'utf8');
}

function describe(name, fn) {
  process.stdout.write(`\n=== ${name} ===\n`);
  fn();
}

function describeBehavioral(name, fn) {
  if (!process.env.BEHAVIORAL) {
    process.stdout.write(`\n=== ${name} (SKIP — set BEHAVIORAL=1 to run) ===\n`);
    return;
  }
  process.stdout.write(`\n=== ${name} (behavioral; spawning agent) ===\n`);
  fn();
}

/**
 * Spawn an agent via `claude -p` with a fixture task and capture the response.
 * Returns the full stream-json output (parseable per line).
 *
 * Cost: ~30-60s wallclock, ~$0.10-0.30 in tokens depending on task size.
 */
function spawnAgentBehavioral(agentName, fixtureTask, timeoutSecs = 180) {
  const promptWrapper = `Use the ${agentName} agent (via the Agent tool with subagent_type="${agentName}") to handle this task:\n\n${fixtureTask}\n\nReturn the agent's full response verbatim.`;

  const result = spawnSync('claude', [
    '-p', promptWrapper,
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'bypassPermissions',
  ], { encoding: 'utf8', timeout: timeoutSecs * 1000 });

  return {
    exitCode: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

/**
 * Parse stream-json output, extract the Agent tool's result text (the
 * sub-agent's reply to its parent).
 */
function extractAgentResultText(streamJsonStr) {
  const lines = streamJsonStr.split('\n').filter(Boolean);
  const agentToolIds = new Set();
  const resultTexts = [];

  for (const line of lines) {
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }

    if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
      for (const block of ev.message.content) {
        if (block.type === 'tool_use' && (block.name === 'Agent' || block.name === 'Task')) {
          agentToolIds.add(block.id);
        }
      }
    }
    if (ev.type === 'user' && ev.message && Array.isArray(ev.message.content)) {
      for (const block of ev.message.content) {
        if (block.type === 'tool_result' && agentToolIds.has(block.tool_use_id)) {
          const content = block.content;
          if (typeof content === 'string') resultTexts.push(content);
          else if (Array.isArray(content)) {
            resultTexts.push(content.map(c => (c && typeof c === 'object' ? (c.text || '') : String(c))).join('\n'));
          }
        }
      }
    }
  }

  return resultTexts.join('\n---\n');
}

function summary() {
  process.stdout.write(`\n=== Summary ===\n`);
  process.stdout.write(`  Passed: ${passed}\n`);
  process.stdout.write(`  Failed: ${failed}\n`);
  if (failed > 0) {
    process.stdout.write(`\n  Failures:\n`);
    for (const f of failures) process.stdout.write(`    ✗ ${f}\n`);
  }
  return failed === 0;
}

function run(suite) {
  suite();
  const ok = summary();
  process.exit(ok ? 0 : 1);
}

module.exports = {
  assert,
  assertMatch,
  assertContains,
  readAgentDefinition,
  describe,
  describeBehavioral,
  spawnAgentBehavioral,
  extractAgentResultText,
  summary,
  run,
  AGENTS_DIR,
  TOOLKIT_ROOT,
};
