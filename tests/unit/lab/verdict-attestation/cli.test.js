#!/usr/bin/env node

// tests/unit/lab/verdict-attestation/cli.test.js
//
// v3.4 Wave 1 — the verdict-attestation CLI. Driven via spawnSync (the CLI's main() calls
// process.exit, so it must run as a subprocess, not in-process). Covers the subcommand dispatch,
// exit codes, the --expires-after-days NaN guard, and the validation error path (VALIDATE
// code-reviewer LOW — no CLI coverage existed).

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const rid = crypto.randomBytes(6).toString('hex');
const LAB_TMP = path.join(os.tmpdir(), 'w1-cli-lab-' + rid);
const SPAWN_TMP = path.join(os.tmpdir(), 'w1-cli-spawn-' + rid);
fs.mkdirSync(LAB_TMP, { recursive: true });
fs.mkdirSync(SPAWN_TMP, { recursive: true });

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'packages', 'lab', 'verdict-attestation', 'cli.js');

function run(args) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, LOOM_LAB_STATE_DIR: LAB_TMP, LOOM_SPAWN_STATE_DIR: SPAWN_TMP },
    encoding: 'utf8',
  });
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
}

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fs.rmSync(path.join(LAB_TMP, 'verdict-attestations'), { recursive: true, force: true }); } catch { /* */ }
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

const RECORD_ARGS = ['record', '--verdict', 'pass', '--subject-persona', 'node-backend',
  '--verifier-identity', '03-code-reviewer.nova', '--verifier-kind', 'structural',
  '--agent-id', 'a104143b476ed011f'];

test('record (happy) → exit 0, prints a record with attestation_id', () => {
  const r = run(RECORD_ARGS);
  assert.strictEqual(r.code, 0, `exit 0 (stderr=${r.err})`);
  assert.ok(/"attestation_id"/.test(r.out) && /"agent_id": "a104143b476ed011f"/.test(r.out), 'prints the record');
});

test('record missing --agent-id → exit 1, clean error (no stack dump)', () => {
  const r = run(['record', '--verdict', 'pass', '--subject-persona', 'p', '--verifier-identity', 'i', '--verifier-kind', 'structural']);
  assert.strictEqual(r.code, 1, 'exit 1');
  assert.ok(/agentId/.test(r.err) && !/at Object\.|at Module/.test(r.err), 'clean message, no stack');
});

test('record --expires-after-days abc → exit 1 (NaN guard)', () => {
  const r = run([...RECORD_ARGS, '--expires-after-days', 'abc']);
  assert.strictEqual(r.code, 1, 'exit 1');
  assert.ok(/positive number/.test(r.err), 'NaN rejected with a clear message');
});

test('list (empty) → exit 0, []', () => {
  const r = run(['list']);
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.out.trim(), '[]');
});

test('record then stats → exit 0, live:1 unenriched:1', () => {
  run(RECORD_ARGS);
  const r = run(['stats']);
  assert.strictEqual(r.code, 0);
  assert.ok(/"live": 1/.test(r.out) && /"unenriched": 1/.test(r.out), 'stats reflect the one record');
});

test('enrich (no journals) → exit 0, summary', () => {
  run(RECORD_ARGS);
  const r = run(['enrich']);
  assert.strictEqual(r.code, 0);
  assert.ok(/"enriched": 0/.test(r.out) && /"unresolved": 1/.test(r.out), 'summary printed; the record is unresolved (no journal)');
});

test('no command → exit 1, usage', () => {
  const r = run([]);
  assert.strictEqual(r.code, 1);
  assert.ok(/Usage:/.test(r.err), 'usage printed');
});

process.stdout.write(`\ncli.test.js (verdict-attestation): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
