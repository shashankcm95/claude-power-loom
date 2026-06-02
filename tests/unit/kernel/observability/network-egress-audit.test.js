#!/usr/bin/env node

// tests/unit/kernel/observability/network-egress-audit.test.js
//
// Integration smoke (subprocess stdin -> stdout) + unit for the PostToolUse:Bash
// network-egress audit hook. Confirms fail-soft (never non-zero exit), advisory
// emission on undeclared hosts, silence on allowlisted/loopback/low-confidence,
// and the sub-agent attribution breadcrumb.

'use strict';

const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');

// Test hygiene: redirect this test's hook logging (the in-process require below
// + the execFileSync subprocesses, which inherit env) to a hermetic temp dir so
// it never pollutes the real ~/.claude/logs/network-egress-audit.log.
require('../_lib/_hermetic-hook-logs');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const HOOK = path.join(REPO_ROOT, 'packages', 'kernel', 'observability', 'network-egress-audit.js');
const { spawnOrigin, loadAllowlist } = require(HOOK);

const MARKER = '[NETWORK-EGRESS-UNDECLARED]';

function runHook(payload, rawOverride) {
  const input = rawOverride !== undefined ? rawOverride : JSON.stringify(payload);
  try {
    const out = execFileSync('node', [HOOK], { input, encoding: 'utf8', timeout: 5000 });
    return { out, exit: 0 };
  } catch (err) {
    return { out: err.stdout || '', exit: err.status == null ? -1 : err.status };
  }
}

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

// (9) fail-soft on bad input
test('malformed stdin => exit 0, no advisory', () => {
  const r = runHook(null, '{ not valid json');
  assert.strictEqual(r.exit, 0);
  assert.ok(!r.out.includes(MARKER));
});
test('empty stdin => exit 0', () => {
  const r = runHook(null, '');
  assert.strictEqual(r.exit, 0);
});

// (10) undeclared host => advisory emitted
test('Bash curl https://evil.com => advisory naming evil.com', () => {
  const r = runHook({ tool_name: 'Bash', tool_input: { command: 'curl -s https://evil.com/x' }, cwd: '/repo' });
  assert.strictEqual(r.exit, 0);
  assert.ok(r.out.includes(MARKER), `expected advisory, got: ${r.out}`);
  assert.ok(r.out.includes('evil.com'));
});

// allowlisted / loopback / non-Bash / low-confidence => silent
test('Bash curl api.anthropic.com => no advisory (allowlisted)', () => {
  const r = runHook({ tool_name: 'Bash', tool_input: { command: 'curl https://api.anthropic.com/v1/messages' } });
  assert.ok(!r.out.includes(MARKER));
});
test('Bash curl localhost => no advisory (loopback)', () => {
  const r = runHook({ tool_name: 'Bash', tool_input: { command: 'curl http://localhost:3000/health' } });
  assert.ok(!r.out.includes(MARKER));
});
test('non-Bash tool => ignored', () => {
  const r = runHook({ tool_name: 'Read', tool_input: { file_path: '/x' } });
  assert.strictEqual(r.exit, 0);
  assert.ok(!r.out.includes(MARKER));
});
test('curl "$URL" => no advisory (egress verb, no parseable host)', () => {
  const r = runHook({ tool_name: 'Bash', tool_input: { command: 'curl -s "$URL"' } });
  assert.ok(!r.out.includes(MARKER));
});

// unit: sub-agent attribution breadcrumb
test('spawnOrigin extracts agentId from worktree cwd', () => {
  const o = spawnOrigin('/Users/x/repo/.claude/worktrees/agent-abc123def/inner');
  assert.strictEqual(o.origin, 'sub-agent');
  assert.strictEqual(o.agentId, 'agent-abc123def');
  assert.strictEqual(spawnOrigin('/Users/x/repo').origin, 'main');
  assert.strictEqual(spawnOrigin(undefined).origin, 'main');
});

// unit: allowlist sourced from the live registry
test('loadAllowlist includes api.anthropic.com', () => {
  assert.ok(loadAllowlist().includes('api.anthropic.com'));
});

process.stdout.write(`\nnetwork-egress-audit.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
