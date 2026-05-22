#!/usr/bin/env node
/**
 * validate-config-redirect.test.js — v2.9.0 Phase D.1 (FIX-I9) coverage
 *
 * Per architect.theo HIGH-5: config-guard.js (PreToolUse:Write) blocks
 * edits to protected config files. But Bash heredocs / redirects bypass
 * that gate by writing the same files via a different tool. The naive
 * fix is "extend config-guard to also parse Bash commands" — but:
 *   1. Bash redirect false-positive surface explodes (logs, /tmp/, fixtures)
 *   2. Inferring file paths from a Bash command is *parsing*, different
 *      architectural layer from "tool_input.file_path"
 *   3. Adding more gates for capability gaps is itself a design-pushback
 *      anti-pattern worth cataloging
 *
 * Resolution: ship the gate as WARN-not-BLOCK by default. Operators
 * get observability (stderr warning) without false-positive lockouts.
 * HARDER block reserved for `--strict-config-guard` opt-in via env var.
 *
 * Tests:
 *   T1: Bash command writing to tsconfig.json via `>` emits stderr WARN + approve
 *   T2: Bash command writing to .eslintrc.js via `>>` emits stderr WARN + approve
 *   T3: Bash command writing to tsconfig via `tee` emits stderr WARN + approve
 *   T4: Bash command unrelated to configs → approve, no warning
 *   T5: Bash command writing to log file (logs/*.log) → approve, no warning
 *   T6: Strict mode (env STRICT_CONFIG_GUARD=1) escalates to block
 *   T7: Non-Bash tool_use (no `command` field) → approve, no warning
 *   T8: kb:design-pushback/syntactic-gate-extension-for-tool-bypass.md exists
 *   T9: Hook is registered/discoverable (file present + chmod-x not enforced)
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '../../..');
const HOOK = path.join(REPO, 'hooks/scripts/validate-config-redirect.js');
const KB_DOC = path.join(REPO, 'skills/agent-team/kb/design-pushback/syntactic-gate-extension-for-tool-bypass.md');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { process.stdout.write('  PASS ' + msg + '\n'); passed++; }
  else { process.stdout.write('  FAIL ' + msg + '\n'); failed++; }
}

function runHook(toolInputCommand, env = {}) {
  const payload = {
    tool_name: 'Bash',
    tool_input: { command: toolInputCommand },
  };
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { /* fall through */ }
  return { stdout: r.stdout, stderr: r.stderr, status: r.status, parsed };
}

process.stdout.write('\n[FIX-I9] validate-config-redirect.js WARN-not-BLOCK\n');

// T1: Bash `> tsconfig.json` -> WARN to stderr + approve
{
  const r = runHook('echo "{}" > tsconfig.json');
  assert(r.parsed && r.parsed.decision === 'approve',
    'T1a: `> tsconfig.json` returns decision=approve (got: ' + JSON.stringify(r.parsed) + ')');
  const stderr = r.stderr || '';
  const hasWarn = /protected config|tsconfig|bypass|Write-tool/.test(stderr);
  assert(hasWarn, 'T1b: stderr contains WARN about protected config bypass (stderr len: ' + stderr.length + ')');
}

// T2: Bash `>> .eslintrc.js` -> WARN + approve
{
  const r = runHook('cat newrule >> .eslintrc.js');
  assert(r.parsed && r.parsed.decision === 'approve',
    'T2a: `>> .eslintrc.js` returns approve');
  const stderr = r.stderr || '';
  const hasWarn = /protected config|eslintrc|bypass/.test(stderr);
  assert(hasWarn, 'T2b: stderr contains WARN');
}

// T3: Bash `tee tsconfig.json` -> WARN + approve
{
  const r = runHook('echo "{}" | tee tsconfig.json');
  assert(r.parsed && r.parsed.decision === 'approve',
    'T3a: `tee tsconfig.json` returns approve');
  const stderr = r.stderr || '';
  const hasWarn = /protected config|tsconfig|bypass/.test(stderr);
  assert(hasWarn, 'T3b: stderr contains WARN');
}

// T4: Bash command unrelated to configs -> approve + no WARN
{
  const r = runHook('npm install lodash');
  assert(r.parsed && r.parsed.decision === 'approve', 'T4a: unrelated command approves');
  const stderr = r.stderr || '';
  const hasWarn = /protected config|bypass.*config-guard/.test(stderr);
  assert(!hasWarn, 'T4b: unrelated command emits NO config-bypass WARN (stderr: "' + stderr.slice(0, 100) + '")');
}

// T5: Bash redirect to a log file -> approve + no WARN (false-positive prevention)
{
  const r = runHook('echo "log entry" >> logs/app.log');
  assert(r.parsed && r.parsed.decision === 'approve', 'T5a: log-file redirect approves');
  const stderr = r.stderr || '';
  const hasWarn = /protected config/.test(stderr);
  assert(!hasWarn, 'T5b: log-file redirect emits NO config WARN');
}

// T6: Strict mode (env STRICT_CONFIG_GUARD=1) escalates to block
{
  const r = runHook('echo "{}" > tsconfig.json', { STRICT_CONFIG_GUARD: '1' });
  assert(r.parsed && r.parsed.decision === 'block',
    'T6: STRICT_CONFIG_GUARD=1 escalates to block (got: ' + JSON.stringify(r.parsed) + ')');
}

// T7: Tool other than Bash (no `command` field) -> approve, no warning
{
  // Send a payload missing the command field (or with tool_name != Bash)
  const payload = { tool_name: 'Read', tool_input: { file_path: '/tmp/foo' } };
  const r = spawnSync('node', [HOOK], { input: JSON.stringify(payload), encoding: 'utf8' });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { /* fall through */ }
  assert(parsed && parsed.decision === 'approve', 'T7: non-Bash tool approves cleanly');
}

// T8: design-pushback kb doc exists
{
  assert(fs.existsSync(KB_DOC),
    'T8: kb:design-pushback/syntactic-gate-extension-for-tool-bypass.md exists at ' + KB_DOC);
}

// T9: Hook script is present + readable
{
  assert(fs.existsSync(HOOK), 'T9a: validate-config-redirect.js script exists');
  if (fs.existsSync(HOOK)) {
    const src = fs.readFileSync(HOOK, 'utf8');
    assert(/PreToolUse|tool_name.*Bash|command/.test(src),
      'T9b: hook source mentions Bash + tool input shape');
  }
}

process.stdout.write('\n=== Summary ===\n');
process.stdout.write('  Passed: ' + passed + '\n');
process.stdout.write('  Failed: ' + failed + '\n');

if (failed > 0) process.exit(1);
