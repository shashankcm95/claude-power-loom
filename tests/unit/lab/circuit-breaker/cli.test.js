#!/usr/bin/env node

// tests/unit/lab/circuit-breaker/cli.test.js
//
// v3.4 Wave 4 — the E11 breaker CLI. Driven via spawnSync (main() calls process.exit). Seeds the E1
// store in-process (real Date.now() so denials are in the default 10-min window), then runs cli.js with
// the same LOOM_LAB_STATE_DIR so it reads the same ledger.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const TMP = path.join(os.tmpdir(), 'w4-e11-cli-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = TMP; // BEFORE requiring the store
// E11-rescue: PIN the E1 source (the default is now verdict-fail). Set at module scope so it rides
// `...process.env` into the spawned CLI (run() below) AND the in-process store require.
process.env.LOOM_BREAKER_SOURCE = 'negative-attestation';
fs.mkdirSync(TMP, { recursive: true });

const REPO = path.join(__dirname, '..', '..', '..', '..');
const CLI = path.join(REPO, 'packages', 'lab', 'circuit-breaker', 'cli.js');
const store = require(path.join(REPO, 'packages', 'lab', 'negative-attestation', 'store.js'));

function run(args, extraEnv) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, LOOM_LAB_STATE_DIR: TMP, ...(extraEnv || {}) }, encoding: 'utf8',
  });
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
}
let seq = 0;
function seed(persona) { // real Date.now() → in the default window
  seq += 1;
  store.recordAttestation({ failureSignature: { sig: `s${seq}` }, identity: { subagentType: persona }, runId: `r${seq}`, leafRef: `l${seq}` });
}

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fs.rmSync(store.LEDGER_PATH, { force: true }); } catch { /* */ }
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

test('show (empty) → exit 0, shadow label + empty personas', () => {
  const r = run(['show']);
  assert.strictEqual(r.code, 0, `exit 0 (stderr=${r.err})`);
  assert.ok(/halts nothing yet/.test(r.out) && /"personas": \[\]/.test(r.out), 'shadow label + empty personas');
});

test('show after seeding a denial storm → the persona shows tripped', () => {
  for (let i = 0; i < 5; i += 1) seed('node-backend');
  const r = run(['show']);
  assert.strictEqual(r.code, 0);
  assert.ok(/"persona": "node-backend"/.test(r.out) && /"tripped": true/.test(r.out), 'persona tripped at the threshold');
});

test('check --persona (tripped) → exit 0, tripped:true scope:persona', () => {
  for (let i = 0; i < 5; i += 1) seed('node-backend');
  const r = run(['check', '--persona', 'node-backend']);
  assert.strictEqual(r.code, 0);
  assert.ok(/"tripped": true/.test(r.out) && /"scope": "persona"/.test(r.out), 'persona decision');
});

test('check --persona (clear) → exit 0, tripped:false scope:clear', () => {
  seed('node-backend'); // 1 denial, below threshold
  const r = run(['check', '--persona', 'react-frontend']);
  assert.strictEqual(r.code, 0);
  assert.ok(/"tripped": false/.test(r.out) && /"scope": "clear"/.test(r.out), 'clear decision');
});

test('bypass env → check returns scope:bypassed, exit 0', () => {
  for (let i = 0; i < 20; i += 1) seed('node-backend');
  const r = run(['check', '--persona', 'node-backend'], { LOOM_DISABLE_CIRCUIT_BREAKER: '1' });
  assert.strictEqual(r.code, 0);
  assert.ok(/"scope": "bypassed"/.test(r.out) && /"tripped": false/.test(r.out), 'bypassed');
});

test('no command → exit 1, usage', () => {
  const r = run([]);
  assert.strictEqual(r.code, 1);
  assert.ok(/Usage:/.test(r.err), 'usage printed');
});

process.stdout.write(`\ncli.test.js (E11 breaker): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
