#!/usr/bin/env node
'use strict';

// tests/unit/lab/causal-edge/world-anchored-recall-cli-arming.test.js
//
// PR-B B5 - D2: the CLI's custody-key arming composition. resolveArmingOpts reads the flag at CALL time (not
// module load), so the opts-shape assertions run in-process; the misconfig emit + end-to-end use a subprocess.
// Contract:
//   - UN-ARMED -> resolveArmingOpts() === {} (byte-identical to pre-B5 SHADOW; no key read).
//   - ARMED -> { selfUid, edgeVerifyKey, brokerVerifyKey } with BOTH keys resolved INDEPENDENTLY.
//     On THIS deployed box (real /etc/loom keys) -> the keys resolve to strings (the Rule-2a real-path
//     dogfood); on CI/clean-dev (absent) -> null. Either way the end-to-end output stays DARK.
//   - a typo arm token -> NOT armed (dark) AND an observable world-anchor-arm-misconfigured emit on STDERR.
//   - env LOOM_EDGE_VERIFY_KEY set has NO effect on the armed output (H2: the reader reads only the pinned path).
//   - end-to-end: un-armed dark; armed-on-this-box still dark (0 signed edges -> no-authenticated-edge).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const CLI = path.join(REPO, 'packages/lab/causal-edge/world-anchored-recall-cli.js');
const { resolveArmingOpts, EDGE_VERIFY_KEY_PATH, BROKER_VERIFY_KEY_PATH } = require(CLI);

const DEPLOYED = fs.existsSync(EDGE_VERIFY_KEY_PATH) && fs.existsSync(BROKER_VERIFY_KEY_PATH);

let passed = 0; let failed = 0;
function test(name, fn) {
  const saved = process.env.LOOM_WORLD_ANCHOR_ARM;
  try { fn(); passed += 1; process.stdout.write(`  PASS ${name}\n`); }
  catch (e) { failed += 1; process.stdout.write(`  FAIL ${name}: ${(e && e.message) || e}\n`); }
  finally { if (saved === undefined) delete process.env.LOOM_WORLD_ANCHOR_ARM; else process.env.LOOM_WORLD_ANCHOR_ARM = saved; }
}
function withArm(v, fn) { if (v === undefined) delete process.env.LOOM_WORLD_ANCHOR_ARM; else process.env.LOOM_WORLD_ANCHOR_ARM = v; fn(); }

// Run the real CLI in a subprocess with a given env; parse the single stdout JSON + return {result, stderr}.
function runCli(armValue, extraEnv) {
  const env = { ...process.env, ...(extraEnv || {}) };
  if (armValue === undefined) delete env.LOOM_WORLD_ANCHOR_ARM; else env.LOOM_WORLD_ANCHOR_ARM = armValue;
  const res = spawnSync(process.execPath, [CLI, '--trigger-class', 'boundary-contract'], { encoding: 'utf8', env, timeout: 10000 });
  return { status: res.status, result: JSON.parse(res.stdout), stderr: res.stderr };
}

// === resolveArmingOpts shape ===
test('UN-ARMED: resolveArmingOpts() === {} (no key read; pre-B5 SHADOW behaviour)', () => {
  withArm(undefined, () => assert.deepStrictEqual(resolveArmingOpts(), {}));
});

test('a typo arm token: resolveArmingOpts() === {} (NOT armed; STRICT dark)', () => {
  withArm('ture', () => assert.deepStrictEqual(resolveArmingOpts(), {}));
});

test('ARMED: resolveArmingOpts() carries selfUid + BOTH key fields (resolved independently)', () => {
  withArm('1', () => {
    const o = resolveArmingOpts();
    assert.ok('selfUid' in o && 'edgeVerifyKey' in o && 'brokerVerifyKey' in o, 'all three fields present');
    // both key fields are string-or-null (independent resolves), never one gating the other
    for (const k of ['edgeVerifyKey', 'brokerVerifyKey']) assert.ok(o[k] === null || typeof o[k] === 'string', `${k} is string|null`);
  });
});

test('ARMED real-key dogfood: on THIS deployed box both keys resolve to strings; on CI they are null', () => {
  withArm('1', () => {
    const o = resolveArmingOpts();
    if (DEPLOYED) {
      assert.strictEqual(typeof o.edgeVerifyKey, 'string', 'the real /etc/loom/edge-verify.pem resolves (mechanism LIVE)');
      assert.strictEqual(typeof o.brokerVerifyKey, 'string', 'the real /etc/loom/verify.pem resolves');
      assert.ok(o.edgeVerifyKey.length > 0 && o.brokerVerifyKey.length > 0, 'non-empty key bytes');
    } else {
      assert.strictEqual(o.edgeVerifyKey, null, 'absent -> null (CI/clean-dev)');
      assert.strictEqual(o.brokerVerifyKey, null);
      process.stdout.write('    (/etc/loom keys absent - CI path)\n');
    }
  });
});

// === end-to-end (subprocess) ===
test('E2E UN-ARMED: the CLI is dark (single JSON stdout, instincts:[])', () => {
  const { status, result } = runCli(undefined);
  assert.strictEqual(status, 0);
  assert.deepStrictEqual(result.instincts, []);
  assert.strictEqual(result.shadow_empty, true);
});

test('E2E ARMED on THIS box: STILL dark - keys resolve but 0 signed edges -> no-authenticated-edge (the Rule-2a proof)', () => {
  const { status, result } = runCli('1');
  assert.strictEqual(status, 0);
  assert.deepStrictEqual(result.instincts, [], 'armed + real keys + 0 signed edges is still dark');
  assert.strictEqual(result.diagnostics.n_admitted, 0, 'nothing admitted (the crypto gate B2 refuses without a signed edge)');
});

test('a typo arm token emits world-anchor-arm-misconfigured on STDERR (never-fail-silent) AND stays dark', () => {
  const { status, result, stderr } = runCli('ture');
  assert.strictEqual(status, 0);
  assert.deepStrictEqual(result.instincts, [], 'a typo does NOT arm - dark');
  assert.ok(/world-anchor-arm-misconfigured/.test(stderr), 'the observable misconfig emit fired on stderr');
  // the misconfig emit must NOT pollute the single stdout JSON B4 parses (it went to stderr) - proven by the JSON.parse above succeeding.
});

test('H2: env LOOM_EDGE_VERIFY_KEY set has NO effect on the armed output (the reader reads only the pinned path)', () => {
  const attacker = '-----BEGIN PUBLIC KEY-----\nATTACKER\n-----END PUBLIC KEY-----\n';
  const withEnv = runCli('1', { LOOM_EDGE_VERIFY_KEY: attacker });
  const without = runCli('1');
  assert.deepStrictEqual(withEnv.result.instincts, [], 'still dark with an attacker env key');
  assert.deepStrictEqual(withEnv.result.instincts, without.result.instincts, 'the env key changes nothing (no env-fallback surface)');
});

process.stdout.write(`\n=== world-anchored-recall-cli-arming: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
