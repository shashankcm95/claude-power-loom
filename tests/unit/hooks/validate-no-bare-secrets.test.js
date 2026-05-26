#!/usr/bin/env node
/**
 * validate-no-bare-secrets.test.js — v2.8.4 FIX-E coverage
 *
 * Tests the documentation-context carve-out: literal-secret-assignment
 * inside markdown fenced code blocks is suppressed; hard-key patterns
 * are NEVER suppressed (defense > documentation).
 */

'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');

const HOOK_PATH = path.resolve(__dirname, '../../../packages/kernel/validators/validate-no-bare-secrets.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { process.stdout.write('  PASS ' + message + '\n'); passed++; }
  else { process.stdout.write('  FAIL ' + message + '\n'); failed++; }
}

function runHook(toolName, toolInput) {
  const payload = JSON.stringify({ tool_name: toolName, tool_input: toolInput });
  const result = spawnSync('node', [HOOK_PATH], { input: payload, encoding: 'utf8' });
  try { return JSON.parse(result.stdout); } catch { return { decision: 'parse-error', stdout: result.stdout, stderr: result.stderr }; }
}

function writeTmpFile(content, ext) {
  const p = path.join(os.tmpdir(), 'sgt-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.' + ext);
  fs.writeFileSync(p, content);
  return p;
}

// Build pattern strings via concat so this test file doesn't trip its own gate.
const VAR = 'POSTGRES_' + 'PASSWORD';
const VAL = 'tutorial_dev_long_enough_pattern_value_xxxxxxxxxxx';

process.stdout.write('\n[FIX-E] documentation-context carve-out\n');

// T1: inside fenced block in .md -> approve
{
  const md = '# Audit\n\n```\n' + VAR + '=' + VAL + '\n```\n';
  const r = runHook('Write', { file_path: '/tmp/audit.md', content: md });
  assert(r.decision === 'approve', 'T1: literal-assignment in fenced block (.md) -> approve');
}

// T2: outside fenced block in .md -> block
{
  const md = '# Report\n\nInline body: ' + VAR + '=' + VAL + ' present.';
  const r = runHook('Write', { file_path: '/tmp/audit.md', content: md });
  assert(r.decision === 'block', 'T2: literal-assignment OUTSIDE fence in .md -> block');
}

// T3: real key (sk-ant-) in fenced block -> STILL block
{
  const ANTH = 'sk-' + 'ant-' + 'fake12345678901234567890abcdef';
  const md = '# Doc\n\n```\nANTHROPIC_API_KEY=' + ANTH + '\n```\n';
  const r = runHook('Write', { file_path: '/tmp/doc.md', content: md });
  assert(r.decision === 'block', 'T3: sk-ant- in fenced block -> STILL block');
}

// T4: literal-assignment in non-markdown (.env) -> block
{
  const env = VAR + '=' + VAL;
  const r = runHook('Write', { file_path: '/tmp/.env', content: env });
  assert(r.decision === 'block', 'T4: literal-assignment in .env -> block');
}

// T5: PEM in fenced block -> STILL block
{
  const PEM = '-----BEG' + 'IN RSA PRIVATE KEY-----';
  const md = '```\n' + PEM + '\nfake\n-----END\n```\n';
  const r = runHook('Write', { file_path: '/tmp/doc.md', content: md });
  assert(r.decision === 'block', 'T5: PEM in fenced block -> STILL block');
}

// T6: AKIA in fenced block -> STILL block
{
  const AKIA = 'AK' + 'IA' + 'IOSFODNN7EXAMPLE';
  const md = '```\n' + AKIA + '\n```\n';
  const r = runHook('Write', { file_path: '/tmp/doc.md', content: md });
  assert(r.decision === 'block', 'T6: AKIA in fenced block -> STILL block');
}

// T7: tilde fence variant
{
  const md = '~~~\n' + VAR + '=' + VAL + '\n~~~\n';
  const r = runHook('Write', { file_path: '/tmp/audit.md', content: md });
  assert(r.decision === 'approve', 'T7: tilde-fenced block -> approve');
}

// T8: Edit-tool variant
{
  const existing = writeTmpFile('# Existing\n\n', 'md');
  const newStr = '# Audit\n\n```\n' + VAR + '=' + VAL + '\n```\n';
  const r = runHook('Edit', { file_path: existing, old_string: '# Existing', new_string: newStr });
  fs.unlinkSync(existing);
  assert(r.decision === 'approve', 'T8: Edit-tool fenced literal-assignment -> approve');
}

// T9: .mdx extension
{
  const md = '```\nDB_PASS' + 'WORD=' + VAL + '\n```\n';
  const r = runHook('Write', { file_path: '/tmp/audit.mdx', content: md });
  assert(r.decision === 'approve', 'T9: .mdx extension -> approve');
}

// T10: pre-existing skip path still works
{
  const env = 'API_TOK' + 'EN=' + 'production_value_definitely_real_xxxxxxxxxxxx';
  const r = runHook('Write', { file_path: '/tmp/.env.example', content: env });
  assert(r.decision === 'approve', 'T10: .env.example skip-path still works');
}

// T11: inline backtick (single) is NOT fenced -> still block
{
  const md = '# Report\n\nFinding: `' + VAR + '=' + VAL + '` should redact.\n';
  const r = runHook('Write', { file_path: '/tmp/report.md', content: md });
  assert(r.decision === 'block', 'T11: inline backtick (not fenced) -> still block');
}

process.stdout.write('\n=== Summary ===\n');
process.stdout.write('  Passed: ' + passed + '\n');
process.stdout.write('  Failed: ' + failed + '\n');

if (failed > 0) process.exit(1);
