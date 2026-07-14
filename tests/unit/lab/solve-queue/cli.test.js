#!/usr/bin/env node

// tests/unit/lab/solve-queue/cli.test.js
//
// The solve-queue CLI over the real store, driven as a SUBPROCESS (real shebang / argv / exit code / stdout
// pipe). Isolated via LOOM_LAB_STATE_DIR. Run as `node <file>`.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const STATE_BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-sqcli-'));
const CLI = path.join(__dirname, '..', '..', '..', '..', 'packages', 'lab', 'solve-queue', 'cli.js');

let passed = 0;
function test(name, fn) { fn(); passed += 1; }
function cli(args) {
  try {
    const stdout = execFileSync('node', [CLI, ...args], { env: { ...process.env, LOOM_LAB_STATE_DIR: STATE_BASE }, encoding: 'utf8' });
    return { code: 0, out: JSON.parse(stdout) };
  } catch (err) {
    return { code: err.status, out: err.stdout ? JSON.parse(err.stdout) : null };
  }
}

test('enqueue emits ok + a queued entry, exit 0', () => {
  const r = cli(['enqueue', '--repo', 'octo/widget', '--issue-ref', '42', '--persona', 'node-backend']);
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.out.ok, true);
  assert.strictEqual(r.out.state, 'queued');
});

test('next dequeues the queued entry (solving), exit 0', () => {
  const r = cli(['next']);
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.out.state, 'solving');
});

test('next on an empty queue emits {ok:false, queue-empty}, exit 1', () => {
  const r = cli(['next']);
  assert.strictEqual(r.code, 1);
  assert.strictEqual(r.out.ok, false);
  assert.strictEqual(r.out.reason, 'queue-empty');
});

test('list emits the entries array', () => {
  const r = cli(['list']);
  assert.strictEqual(r.code, 0);
  assert.ok(Array.isArray(r.out.entries));
  assert.strictEqual(r.out.entries.length, 1);
  assert.strictEqual(r.out.entries[0].state, 'solving');
});

test('get on an unknown entry emits {ok:false}, exit 1', () => {
  const r = cli(['get', '--entry-id', 'f'.repeat(64)]);
  assert.strictEqual(r.code, 1);
  assert.strictEqual(r.out.ok, false);
});

test('advance transitions an entry + persists evidence via the CLI (its own flag/dispatch path)', () => {
  cli(['enqueue', '--repo', 'octo/adv', '--issue-ref', '99']);
  const c = cli(['next']);                              // claims octo/adv#99 (the only queued now)
  assert.strictEqual(c.out.state, 'solving');
  const r = cli(['advance', '--entry-id', c.out.entry_id, '--to-state', 'drafted',
    '--candidate-patch-sha', 'a'.repeat(64), '--lesson-signature', 'lesson:x']);
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.out.state, 'drafted');
  const g = cli(['get', '--entry-id', c.out.entry_id]);
  assert.strictEqual(g.out.evidence.candidate_patch_sha, 'a'.repeat(64), 'evidence persisted through the CLI dispatch');
});

test('an unknown subcommand exits 1', () => {
  const r = cli(['bogus']);
  assert.strictEqual(r.code, 1);
});

try { fs.rmSync(STATE_BASE, { recursive: true, force: true }); } catch { /* best-effort */ }
assert.ok(passed >= 7, `anti-vacuity floor: expected >=7, ran ${passed}`);
console.log(`${path.basename(__filename)}: ${passed} passed`);
