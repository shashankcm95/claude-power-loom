#!/usr/bin/env node

// tests/unit/lab/reputation/cli.test.js
//
// v3.4 Wave 2 — the E4 reputation CLI. Driven via spawnSync (main() calls process.exit). Seeds the
// store in-process, then runs cli.js with the same LOOM_LAB_STATE_DIR so it reads the same ledger.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const TMP = path.join(os.tmpdir(), 'w2-e4-cli-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = TMP; // BEFORE requiring the store
fs.mkdirSync(TMP, { recursive: true });

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'packages', 'lab', 'reputation', 'cli.js');
const store = require(path.join(REPO_ROOT, 'packages', 'lab', 'verdict-attestation', 'store.js'));

function run(args) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, LOOM_LAB_STATE_DIR: TMP }, encoding: 'utf8',
  });
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
}
function seedEnriched(persona, agentId, txid) {
  const rec = store.recordVerdict({ verdict: 'pass', subject: { persona }, verifier: { identity: 'r.a', kind: 'structural' }, agentId });
  store.enrichRecord(rec.attestation_id, { runId: 'run1', transactionId: txid, recordStatus: 'appended' });
}

const SNAP_PATH = path.join(TMP, 'reputation-snapshot.json');
let passed = 0; let failed = 0;
function test(name, fn) {
  try { fs.rmSync(store.LEDGER_PATH, { force: true }); } catch { /* */ }
  try { fs.rmSync(SNAP_PATH, { force: true }); } catch { /* */ }
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

test('show (empty) → exit 0, honest label + empty personas', () => {
  const r = run(['show']);
  assert.strictEqual(r.code, 0, `exit 0 (stderr=${r.err})`);
  assert.ok(/NOT a quality score/.test(r.out) && /"personas": \[\]/.test(r.out), 'label + empty personas');
});

test('show after seeding → the persona appears with its distribution', () => {
  seedEnriched('node-backend', 'aCli1', 'txCli1');
  const r = run(['show']);
  assert.strictEqual(r.code, 0);
  assert.ok(/"persona": "node-backend"/.test(r.out) && /"distinct_spawns": 1/.test(r.out), 'persona + distinct_spawns');
});

test('show --persona filters to one persona', () => {
  seedEnriched('node-backend', 'aCli2', 'txCli2');
  seedEnriched('react-frontend', 'aCli3', 'txCli3');
  const r = run(['show', '--persona', 'react-frontend']);
  assert.strictEqual(r.code, 0);
  assert.ok(/react-frontend/.test(r.out) && !/node-backend/.test(r.out), 'only the requested persona');
});

test('no command → exit 1, usage', () => {
  const r = run([]);
  assert.strictEqual(r.code, 1);
  assert.ok(/Usage:/.test(r.err), 'usage printed');
});

test('materialize → exit 0 with hash + count; then snapshot reads it back present:true', () => {
  seedEnriched('node-backend', 'aCliM1', 'txCliM1');
  const m = run(['materialize']);
  assert.strictEqual(m.code, 0, `materialize exit 0 (stderr=${m.err})`);
  assert.ok(/"content_hash":/.test(m.out) && /"persona_count": 1/.test(m.out), 'prints hash + persona_count');
  const s = run(['snapshot']);
  assert.strictEqual(s.code, 0);
  assert.ok(/"present": true/.test(s.out) && /node-backend/.test(s.out), 'the advisory read sees the persona');
});

test('snapshot with no materialized file → present:false, exit 0 (reputation-blind, not an error)', () => {
  const s = run(['snapshot']);
  assert.strictEqual(s.code, 0, 'absent snapshot is not an error');
  assert.ok(/"present": false/.test(s.out), 'absent → present:false');
});

process.stdout.write(`\ncli.test.js (E4 reputation): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
