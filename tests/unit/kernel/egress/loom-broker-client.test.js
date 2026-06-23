'use strict';

// tests/unit/kernel/egress/loom-broker-client.test.js — the host-side signFn. Proves the env-allowlist (process.env
// NEVER inherited; RESERVED_ENV throw), the non-hex-basis no-spawn gate, the keyFile channel, the DoS bounds
// (non-zero exit / output flood -> null), and the canonical-base64 + 64-byte output re-gate. Spawns a fake broker
// script to exercise the real execFileSync path.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const { loomBrokerSigner } = require(path.join(REPO, 'packages', 'kernel', 'egress', 'loom-broker-client.js'));
const EA = path.join(REPO, 'packages', 'kernel', '_lib', 'edge-attestation.js');
const { generateEdgeKeypair, verifyRecordSig } = require(EA);

let passed = 0; let failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function scratch() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-bc-')); }

const HEX = 'a'.repeat(64);
const NODE = process.execPath;

// a fake broker: reads basis (argv[2]) + ctx (stdin), records its env view to LB_SIDE, signs the basis with the
// key at LOOM_BROKER_KEY_FILE, prints ONLY the sig. Two knobs: LB_MODE=flood (huge stdout) / LB_MODE=exit1.
function fakeBrokerScript() {
  return [
    'const fs=require("fs");',
    'const {signRecordId}=require(' + JSON.stringify(EA) + ');',
    'const basis=process.argv[2];',
    'let ctx="";process.stdin.on("data",d=>ctx+=d);process.stdin.on("end",()=>{',
    '  if(process.env.LB_SIDE)fs.writeFileSync(process.env.LB_SIDE,JSON.stringify({leak:process.env.SECRET_LEAK||"undefined",benign:process.env.BENIGN||"undefined",ctxlen:ctx.length}));',
    '  if(process.env.LB_MODE==="exit1"){process.exit(1)}',
    '  if(process.env.LB_MODE==="flood"){process.stdout.write("x".repeat(100000));process.exit(0)}',
    '  if(process.env.LB_MODE==="garbage"){process.stdout.write("not base64 @@@\\n");process.exit(0)}',
    '  const pem=fs.readFileSync(process.env.LOOM_BROKER_KEY_FILE,"utf8");',
    '  const sig=signRecordId(basis,{privateKeyPem:pem});',
    '  process.stdout.write(sig+"\\n");',
    '});',
  ].join('\n');
}

function setup(extraEnv, mode) {
  const dir = scratch();
  const broker = path.join(dir, 'fake-broker.js'); fs.writeFileSync(broker, fakeBrokerScript());
  const kp = generateEdgeKeypair();
  const keyFile = path.join(dir, 'key.pem'); fs.writeFileSync(keyFile, kp.privateKeyPem, { mode: 0o600 });
  const env = Object.assign({}, extraEnv); if (mode) env.LB_MODE = mode;
  const signer = loomBrokerSigner({ command: NODE, args: [broker], keyFile, env, timeoutMs: 5000, maxBytes: 4096 });
  return { dir, signer, pub: kp.publicKeyPem };
}

test('happy path: returns a sig that verifies over the basis', () => {
  const { dir, signer, pub } = setup({}, null);
  try {
    const sig = signer(HEX, { emission: { repo: 'o/r', issueRef: 1, diff: 'd' }, approvedAt: 1, nonce: 'n', key_id: 'v0' });
    assert.ok(sig && verifyRecordSig(HEX, sig, { publicKeyPem: pub }), 'sig verifies');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('process.env is NEVER inherited; an allowlisted opts.env extra IS passed', () => {
  process.env.SECRET_LEAK = 'TOPSECRET';
  const side = path.join(os.tmpdir(), 'loom-bc-side-' + process.pid + '.json');
  const { dir, signer } = setup({ LB_SIDE: side, BENIGN: 'yes' }, null);
  try {
    signer(HEX, { emission: { repo: 'o/r', issueRef: 1, diff: 'd' }, approvedAt: 1, nonce: 'n', key_id: 'v0' });
    const view = JSON.parse(fs.readFileSync(side, 'utf8'));
    assert.strictEqual(view.leak, 'undefined', 'SECRET_LEAK must NOT be inherited by the child');
    assert.strictEqual(view.benign, 'yes', 'an allowlisted opts.env extra IS passed');
    assert.ok(view.ctxlen > 0, 'the ctx preimage is written to stdin');
  } finally { delete process.env.SECRET_LEAK; fs.rmSync(dir, { recursive: true, force: true }); try { fs.unlinkSync(side); } catch { /* */ } }
});

test('RESERVED_ENV: opts.env with NODE_OPTIONS / LOOM_BROKER_KEY_FILE / LD_* -> throw at construction', () => {
  assert.throws(() => loomBrokerSigner({ command: NODE, args: [], env: { NODE_OPTIONS: '--require evil' } }), /code-loading\/key-path/);
  assert.throws(() => loomBrokerSigner({ command: NODE, args: [], env: { LOOM_BROKER_KEY_FILE: '/etc/x' } }), /code-loading\/key-path/);
  assert.throws(() => loomBrokerSigner({ command: NODE, args: [], env: { LD_PRELOAD: '/x.so' } }), /code-loading\/key-path/);
});

test('non-hex basis -> null, NEVER spawns (no side-effect)', () => {
  const side = path.join(os.tmpdir(), 'loom-bc-nospawn-' + process.pid + '.json');
  const { dir, signer } = setup({ LB_SIDE: side }, null);
  try {
    assert.strictEqual(signer('not-hex', { a: 1 }), null);
    assert.strictEqual(fs.existsSync(side), false, 'the broker was NEVER spawned (no side file)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); try { fs.unlinkSync(side); } catch { /* */ } }
});

test('oversized ctx (> MAX_CTX_BYTES) -> null, NEVER spawns (fail-fast; CodeRabbit)', () => {
  const side = path.join(os.tmpdir(), 'loom-bc-big-' + process.pid + '.json');
  const { dir, signer } = setup({ LB_SIDE: side }, null);
  try {
    const huge = { emission: { repo: 'o/r', issueRef: 1, diff: 'a'.repeat(1100000) }, approvedAt: 1, nonce: 'n', key_id: 'v0' };
    assert.strictEqual(signer(HEX, huge), null);
    assert.strictEqual(fs.existsSync(side), false, 'the broker was NEVER spawned (no wasted serialize/spawn)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); try { fs.unlinkSync(side); } catch { /* */ } }
});

test('non-zero exit / output flood / garbage output -> null (fail-closed, DoS bounds + re-gate)', () => {
  for (const mode of ['exit1', 'flood', 'garbage']) {
    const { dir, signer } = setup({}, mode);
    try {
      assert.strictEqual(signer(HEX, { emission: { repo: 'o/r', issueRef: 1, diff: 'd' }, approvedAt: 1, nonce: 'n', key_id: 'v0' }), null, mode + ' -> null');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== loom-broker-client.test.js: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
})();
