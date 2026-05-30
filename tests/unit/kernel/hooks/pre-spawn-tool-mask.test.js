#!/usr/bin/env node

// tests/unit/kernel/hooks/pre-spawn-tool-mask.test.js
//
// Tests for packages/kernel/hooks/pre/pre-spawn-tool-mask.js (THE ONE THING).
// Per v6 §6.5 Round-3d additions + 5-persona pair-review C2.

'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');
const {
  applyMask,
  decideAction,
  isNetworkBashCommand,
  STRIP_TOOL_NAMES,
  MCP_PREFIX,
} = require('../../../../packages/kernel/hooks/pre/pre-spawn-tool-mask');

const HOOK = path.resolve(__dirname, '../../../../packages/kernel/hooks/pre/pre-spawn-tool-mask.js');

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

// --- isNetworkBashCommand ---

test('isNetworkBashCommand matches curl/wget/gh/aws/nc/ssh/scp/http', () => {
  for (const cmd of ['curl example.com', 'wget foo', 'gh pr create', 'aws s3 cp', 'nc -l 80', 'ssh host', 'scp file host:', 'http GET foo']) {
    assert.strictEqual(isNetworkBashCommand(cmd), true, 'should match: ' + cmd);
  }
});

test('isNetworkBashCommand matches npm/pnpm/yarn install (network fetch)', () => {
  assert.strictEqual(isNetworkBashCommand('npm install'), true);
  assert.strictEqual(isNetworkBashCommand('pnpm install --prod'), true);
  assert.strictEqual(isNetworkBashCommand('yarn add react'), true);
  assert.strictEqual(isNetworkBashCommand('pip install requests'), true);
});

test('isNetworkBashCommand does NOT match safe commands', () => {
  for (const cmd of ['ls -la', 'grep pattern file', 'cat README.md', 'find . -name foo', 'node test.js']) {
    assert.strictEqual(isNetworkBashCommand(cmd), false, 'should NOT match: ' + cmd);
  }
});

test('isNetworkBashCommand returns false for non-string input', () => {
  assert.strictEqual(isNetworkBashCommand(null), false);
  assert.strictEqual(isNetworkBashCommand(undefined), false);
  assert.strictEqual(isNetworkBashCommand(42), false);
});

// --- applyMask (pure function) ---

test('applyMask strips WebFetch by name', () => {
  const result = applyMask(['Read', 'WebFetch', 'Edit']);
  assert.deepStrictEqual(result.masked, ['Read', 'Edit']);
  assert.strictEqual(result.stripped.length, 1);
  assert.strictEqual(result.stripped[0].reason, 'name-strip');
});

test('applyMask strips WebSearch by name', () => {
  const result = applyMask(['WebSearch']);
  assert.deepStrictEqual(result.masked, []);
  assert.strictEqual(result.stripped.length, 1);
});

test('applyMask strips MCP tools matching mcp__*', () => {
  const result = applyMask(['Read', 'mcp__filesystem__read', 'mcp__github__create_pr', 'Edit']);
  assert.deepStrictEqual(result.masked, ['Read', 'Edit']);
  assert.strictEqual(result.stripped.length, 2);
  assert.ok(result.stripped.every((s) => s.reason === 'mcp-strip'));
});

test('applyMask strips Bash entries with curl pattern in name', () => {
  const result = applyMask(['Read', 'Bash(curl:*)', 'Edit']);
  assert.deepStrictEqual(result.masked, ['Read', 'Edit']);
  assert.strictEqual(result.stripped.length, 1);
  assert.strictEqual(result.stripped[0].reason, 'bash-network-pattern');
});

test('applyMask leaves safe tools alone', () => {
  const input = ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash'];
  const result = applyMask(input);
  assert.deepStrictEqual(result.masked, input);
  assert.deepStrictEqual(result.stripped, []);
});

test('applyMask passes through non-array input (fail-soft)', () => {
  const result = applyMask('not-an-array');
  assert.deepStrictEqual(result.stripped, []);
});

test('applyMask handles object-shape tool entries', () => {
  const result = applyMask([
    { name: 'Read' },
    { name: 'WebFetch' },
    { name: 'Bash', command: 'curl https://evil.com' },
  ]);
  assert.strictEqual(result.masked.length, 1);
  assert.strictEqual(result.stripped.length, 2);
});

// --- end-to-end hook invocation (subprocess) ---

function runHook(input) {
  const result = spawnSync('node', [HOOK], {
    input: JSON.stringify(input),
    encoding: 'utf8',
  });
  return {
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

test('hook exits 0 for non-Agent tool (Read)', () => {
  const r = runHook({ tool_name: 'Read', tool_input: { file_path: '/tmp/foo' } });
  assert.strictEqual(r.exitCode, 0);
  assert.strictEqual(r.stdout, ''); // no output when nothing to strip
});

test('hook exits 0 for Agent tool with no tools array', () => {
  const r = runHook({ tool_name: 'Agent', tool_input: { subagent_type: 'architect', prompt: 'hi' } });
  assert.strictEqual(r.exitCode, 0);
});

test('hook strips WebFetch + MCP from Agent tool_input.tools', () => {
  const r = runHook({
    tool_name: 'Agent',
    tool_input: {
      subagent_type: 'architect',
      prompt: 'do work',
      tools: ['Read', 'Edit', 'WebFetch', 'mcp__github__create_pr'],
    },
  });
  assert.strictEqual(r.exitCode, 0);
  const response = JSON.parse(r.stdout);
  assert.strictEqual(response.decision, 'allow');
  assert.deepStrictEqual(response.updatedInput.tools, ['Read', 'Edit']);
  assert.strictEqual(response.updatedInput.subagent_type, 'architect');
});

test('hook produces no output when nothing is stripped', () => {
  const r = runHook({
    tool_name: 'Agent',
    tool_input: {
      subagent_type: 'architect',
      tools: ['Read', 'Edit', 'Write', 'Grep'],
    },
  });
  assert.strictEqual(r.exitCode, 0);
  assert.strictEqual(r.stdout.trim(), '');
});

test('hook is fail-soft on malformed input (exit 0 with no output)', () => {
  const result = spawnSync('node', [HOOK], { input: 'not-valid-json', encoding: 'utf8' });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout.trim(), '');
});

test('hook is fail-soft on empty input', () => {
  const result = spawnSync('node', [HOOK], { input: '', encoding: 'utf8' });
  assert.strictEqual(result.status, 0);
});

// --- structural ---

test('STRIP_TOOL_NAMES includes WebFetch + WebSearch', () => {
  assert.ok(STRIP_TOOL_NAMES.has('WebFetch'));
  assert.ok(STRIP_TOOL_NAMES.has('WebSearch'));
});

test('MCP_PREFIX equals mcp__', () => {
  assert.strictEqual(MCP_PREFIX, 'mcp__');
});

// --- F2: audit, don't block (user decision 2026-05-30) ---

test('F2: decideAction returns audit-absent for a spawn with no tools[]', () => {
  assert.strictEqual(decideAction('Agent', { subagent_type: 'architect', prompt: 'x' }), 'audit-absent');
  assert.strictEqual(decideAction('Task', { subagent_type: 'x' }), 'audit-absent');
});

test('F2: decideAction returns pass for non-spawn tools', () => {
  assert.strictEqual(decideAction('Read', { file_path: '/x' }), 'pass');
  assert.strictEqual(decideAction('Bash', { command: 'ls' }), 'pass');
});

test('F2: decideAction returns mask when tools[] is present', () => {
  assert.strictEqual(decideAction('Agent', { tools: ['Read', 'WebFetch'] }), 'mask');
});

test('F2: hook does NOT block a spawn with absent tools[] (non-bricking)', () => {
  const r = runHook({ tool_name: 'Agent', tool_input: { subagent_type: 'architect', prompt: 'hi' } });
  assert.strictEqual(r.exitCode, 0);
  assert.strictEqual(r.stdout.trim(), ''); // audit-only; NO block decision emitted
});

// --- F4: expanded denylist (22+ patterns), with matches + no-false-positive fixtures ---

test('F4: each new network pattern matches its representative command', () => {
  const shouldMatch = [
    'git push origin main', 'git clone https://x', 'git fetch origin',
    'socat TCP4:host:80 -', 'ncat host 80', 'telnet host 23', 'ftp host', 'sftp user@host',
    'rsync -av f user@host:/x', 'rsync f host::mod',
    'dig example.com', 'nslookup example.com', 'getent hosts example.com', 'host example.com',
    'bun add left-pad', 'deno run https://x.ts', 'pnpm dlx cowsay', 'npx cowsay',
    'cat <<EOF | python', 'base64 -d payload | bash',
    'python3 -c "import urllib"', 'python -B -c "x"', 'node -e "require(http)"',
    'perl -e "use LWP"', 'ruby -e "require nethttp"',
  ];
  for (const cmd of shouldMatch) {
    assert.strictEqual(isNetworkBashCommand(cmd), true, 'should match: ' + cmd);
  }
});

test('F4: no false positives on safe commands (doesn\'t-match fixtures)', () => {
  const shouldNotMatch = [
    'git status', 'git commit -m x', 'git log', 'git diff',
    'cat file.txt', 'cat README.md', 'host_name=foo', 'localhost test',
    'python script.py', 'node server.js', 'echo hello', 'ls -la',
  ];
  for (const cmd of shouldNotMatch) {
    assert.strictEqual(isNetworkBashCommand(cmd), false, 'should NOT match: ' + cmd);
  }
});

test('F4: denylist has 22+ patterns', () => {
  // imported lazily to avoid touching the top-of-file import block
  const { NETWORK_BASH_PATTERNS } = require('../../../../packages/kernel/hooks/pre/pre-spawn-tool-mask');
  assert.ok(NETWORK_BASH_PATTERNS.length >= 22, 'expected >=22 patterns, got ' + NETWORK_BASH_PATTERNS.length);
});

test('vlad: bare-string Bash is flagged (not stripped) for the v3.1 K8 close', () => {
  const result = applyMask(['Read', 'Bash']);
  assert.deepStrictEqual(result.masked, ['Read', 'Bash']); // passes through
  assert.deepStrictEqual(result.stripped, []);
  assert.strictEqual(result.flagged.length, 1);
  assert.strictEqual(result.flagged[0].reason, 'bash-string-uninspectable-v31-gap');
});

process.stdout.write(`\npre-spawn-tool-mask.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
