#!/usr/bin/env node
/**
 * fact-force-gate.test.js — v2.8.5 FIX-H5 coverage
 *
 * Tests that Write satisfies fact-knowledge: after a Write to file X, a
 * subsequent Edit to X passes the gate (no spurious "must Read first" block).
 *
 * Bug class (pre-v2.8.5): Write→Edit blocked because tracker wasn't updated
 * on Write. v2.8.4 self-witnessed (Claude hit it 3× authoring v2.8.4).
 */

'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');

const HOOK_PATH = path.resolve(__dirname, '../../../hooks/scripts/fact-force-gate.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { process.stdout.write('  PASS ' + msg + '\n'); passed++; }
  else { process.stdout.write('  FAIL ' + msg + '\n'); failed++; }
}

function runHook(toolName, toolInput, sessionId) {
  const payload = JSON.stringify({ tool_name: toolName, tool_input: toolInput });
  const env = { ...process.env };
  if (sessionId) env.CLAUDE_SESSION_ID = sessionId;
  const result = spawnSync('node', [HOOK_PATH], { input: payload, encoding: 'utf8', env });
  try { return JSON.parse(result.stdout); }
  catch { return { decision: 'parse-error', stdout: result.stdout, stderr: result.stderr }; }
}

function tmpFile(content = '') {
  const p = path.join(os.tmpdir(), 'ffg-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.txt');
  if (content !== null) fs.writeFileSync(p, content);
  return p;
}

process.stdout.write('\n[FIX-H5] fact-force-gate Write satisfies fact-knowledge\n');

// T1: Write to new file → approve + record in tracker
{
  const session = 'ffg-test-T1-' + Date.now();
  const file = path.join(os.tmpdir(), 'ffg-new-' + Date.now() + '.txt');
  // Don't create the file; let Write be the first appearance
  const r = runHook('Write', { file_path: file, content: 'hello' }, session);
  assert(r.decision === 'approve', 'T1a: Write to new file -> approve');
}

// T2: Write to new file then Edit to same file → both approve (the bug case)
//
// NOTE: We use a canonical /private/tmp path on macOS to avoid the
// /tmp ↔ /private/tmp realpathSync resolution split. In production
// (user paths under /Users, /home), this isn't an issue.
{
  const session = 'ffg-test-T2-' + Date.now();
  const tmpdir = fs.realpathSync(os.tmpdir());
  const file = path.join(tmpdir, 'ffg-new2-' + Date.now() + '.txt');
  const r1 = runHook('Write', { file_path: file, content: 'initial' }, session);
  assert(r1.decision === 'approve', 'T2a: Write to new file -> approve');
  // Simulate file existence (in real flow, Write would create it; here we mock)
  fs.writeFileSync(file, 'initial');
  const r2 = runHook('Edit', { file_path: file, old_string: 'initial', new_string: 'updated' }, session);
  assert(r2.decision === 'approve', 'T2b: Edit after Write -> approve (FIX-H5 main case)');
  fs.unlinkSync(file);
}

// T3: Write to EXISTING file → approve + records tracker
{
  const session = 'ffg-test-T3-' + Date.now();
  const file = tmpFile('existing content');
  const r1 = runHook('Write', { file_path: file, content: 'overwrite' }, session);
  assert(r1.decision === 'approve', 'T3a: Write to existing file -> approve');
  const r2 = runHook('Edit', { file_path: file, old_string: 'foo', new_string: 'bar' }, session);
  assert(r2.decision === 'approve', 'T3b: Edit after Write-to-existing -> approve');
  fs.unlinkSync(file);
}

// T4: Edit WITHOUT prior Read or Write → BLOCK (gate still enforces)
{
  const session = 'ffg-test-T4-' + Date.now();
  const file = tmpFile('content');
  const r = runHook('Edit', { file_path: file, old_string: 'foo', new_string: 'bar' }, session);
  assert(r.decision === 'block', 'T4: Edit without prior Read/Write -> block (gate still enforces)');
  fs.unlinkSync(file);
}

// T5: Read then Edit → approve (pre-v2.8.5 behavior preserved)
{
  const session = 'ffg-test-T5-' + Date.now();
  const file = tmpFile('content');
  const r1 = runHook('Read', { file_path: file }, session);
  assert(r1.decision === 'approve', 'T5a: Read -> approve');
  const r2 = runHook('Edit', { file_path: file, old_string: 'content', new_string: 'new' }, session);
  assert(r2.decision === 'approve', 'T5b: Edit after Read -> approve (regression check)');
  fs.unlinkSync(file);
}

// T6: Write then Write then Edit → all approve (multiple Writes record tracker each time)
{
  const session = 'ffg-test-T6-' + Date.now();
  const file = path.join(os.tmpdir(), 'ffg-multi-' + Date.now() + '.txt');
  const r1 = runHook('Write', { file_path: file, content: 'v1' }, session);
  fs.writeFileSync(file, 'v1');
  const r2 = runHook('Write', { file_path: file, content: 'v2' }, session);
  const r3 = runHook('Edit', { file_path: file, old_string: 'v2', new_string: 'v3' }, session);
  assert(r1.decision === 'approve', 'T6a: first Write -> approve');
  assert(r2.decision === 'approve', 'T6b: second Write -> approve');
  assert(r3.decision === 'approve', 'T6c: subsequent Edit -> approve');
  fs.unlinkSync(file);
}

process.stdout.write('\n=== Summary ===\n');
process.stdout.write('  Passed: ' + passed + '\n');
process.stdout.write('  Failed: ' + failed + '\n');

if (failed > 0) process.exit(1);
