#!/usr/bin/env node
'use strict';

// tests/unit/lab/causal-edge/world-anchored-recall-cli-arming.test.js
//
// PR-B B5 D2 + A-W1 both-or-neither preflight: the CLI's custody-key arming composition. resolveArmingOpts reads
// the flags at CALL time (not module load), so the opts-shape assertions run in-process; the emits + end-to-end
// use a subprocess. A-W1 CHANGED the contract: admission (LOOM_WORLD_ANCHOR_ARM) now arms the custody resolution
// ONLY when it is COHERENT with the B1 signing arm (LOOM_EDGE_REQUIRE_UID_SEP) - both-or-neither.
// Contract:
//   - UN-ARMED (neither flag) -> resolveArmingOpts() === {} (byte-identical to pre-B5 SHADOW; no key read).
//   - COHERENTLY ARMED (BOTH flags) -> { selfUid, edgeVerifyKey, brokerVerifyKey } with BOTH keys resolved
//     INDEPENDENTLY. On THIS deployed box (real /etc/loom keys) -> the keys resolve to strings (the Rule-2a
//     real-path dogfood); on CI/clean-dev (absent) -> null. Either way the end-to-end output stays DARK.
//   - B5-only (admission armed, signing dark) -> {} (INCOHERENT -> fail-closed dark) + an observable
//     world-anchor-arm-incoherent emit (reason admission-armed-without-signing) on STDERR.
//   - B1-only (signing armed, admission dark) -> {} (legit sign-then-admit staging; admission stays dark) + an
//     observable world-anchor-arm-incoherent emit (reason signing-armed-without-admission) on STDERR.
//   - a typo admission arm token -> NOT armed (dark) AND an observable world-anchor-arm-misconfigured emit.
//   - env LOOM_EDGE_VERIFY_KEY set has NO effect on the armed output (H2: the reader reads only the pinned path).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const CLI = path.join(REPO, 'packages/lab/causal-edge/world-anchored-recall-cli.js');
const { resolveArmingOpts, EDGE_VERIFY_KEY_PATH, BROKER_VERIFY_KEY_PATH } = require(CLI);

const ADMIT = 'LOOM_WORLD_ANCHOR_ARM';
const SIGN = 'LOOM_EDGE_REQUIRE_UID_SEP';
const DEPLOYED = fs.existsSync(EDGE_VERIFY_KEY_PATH) && fs.existsSync(BROKER_VERIFY_KEY_PATH);

let passed = 0; let failed = 0;
function test(name, fn) {
  const savedA = process.env[ADMIT]; const savedS = process.env[SIGN];
  try { fn(); passed += 1; process.stdout.write(`  PASS ${name}\n`); }
  catch (e) { failed += 1; process.stdout.write(`  FAIL ${name}: ${(e && e.message) || e}\n`); }
  finally {
    if (savedA === undefined) delete process.env[ADMIT]; else process.env[ADMIT] = savedA;
    if (savedS === undefined) delete process.env[SIGN]; else process.env[SIGN] = savedS;
  }
}
// set/unset BOTH arm flags for the in-process resolveArmingOpts assertions.
function withArms(admission, signing, fn) {
  if (admission === undefined) delete process.env[ADMIT]; else process.env[ADMIT] = admission;
  if (signing === undefined) delete process.env[SIGN]; else process.env[SIGN] = signing;
  fn();
}

// Run the real CLI in a subprocess with a given env; parse the single stdout JSON + return {status, result, stderr}.
function runCli({ admission, signing, extraEnv } = {}) {
  const env = { ...process.env, ...(extraEnv || {}) };
  if (admission === undefined) delete env[ADMIT]; else env[ADMIT] = admission;
  if (signing === undefined) delete env[SIGN]; else env[SIGN] = signing;
  const res = spawnSync(process.execPath, [CLI, '--trigger-class', 'boundary-contract'], { encoding: 'utf8', env, timeout: 10000 });
  return { status: res.status, result: JSON.parse(res.stdout), stderr: res.stderr };
}

// === resolveArmingOpts shape ===
test('UN-ARMED (neither flag): resolveArmingOpts() === {} (no key read; pre-B5 SHADOW behaviour)', () => {
  withArms(undefined, undefined, () => assert.deepStrictEqual(resolveArmingOpts(), {}));
});

test('a typo admission arm token: resolveArmingOpts() === {} (NOT armed; STRICT dark)', () => {
  withArms('ture', '1', () => assert.deepStrictEqual(resolveArmingOpts(), {}));
});

test('B5-only (admission armed, signing dark): resolveArmingOpts() === {} (INCOHERENT -> fail-closed dark)', () => {
  withArms('1', undefined, () => assert.deepStrictEqual(resolveArmingOpts(), {}));
});

test('B1-only (signing armed, admission dark): resolveArmingOpts() === {} (legit staging; admission dark)', () => {
  withArms(undefined, '1', () => assert.deepStrictEqual(resolveArmingOpts(), {}));
});

test('COHERENTLY ARMED (BOTH flags): resolveArmingOpts() carries selfUid + BOTH key fields (resolved independently)', () => {
  withArms('1', '1', () => {
    const o = resolveArmingOpts();
    assert.ok('selfUid' in o && 'edgeVerifyKey' in o && 'brokerVerifyKey' in o, 'all three fields present');
    for (const k of ['edgeVerifyKey', 'brokerVerifyKey']) assert.ok(o[k] === null || typeof o[k] === 'string', `${k} is string|null`);
  });
});

test('COHERENTLY ARMED real-key dogfood: on THIS deployed box both keys resolve to strings; on CI they are null', () => {
  withArms('1', '1', () => {
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
  const { status, result } = runCli({});
  assert.strictEqual(status, 0);
  assert.deepStrictEqual(result.instincts, []);
  assert.strictEqual(result.shadow_empty, true);
});

test('E2E COHERENTLY ARMED on THIS box: STILL dark - keys resolve but 0 signed edges -> no-authenticated-edge (Rule-2a)', () => {
  const { status, result } = runCli({ admission: '1', signing: '1' });
  assert.strictEqual(status, 0);
  assert.deepStrictEqual(result.instincts, [], 'coherently armed + real keys + 0 signed edges is still dark');
  assert.strictEqual(result.diagnostics.n_admitted, 0, 'nothing admitted (B2 refuses without a signed edge)');
});

test('E2E B5-only emits world-anchor-arm-incoherent (admission-armed-without-signing) on STDERR AND stays dark', () => {
  const { status, result, stderr } = runCli({ admission: '1' });
  assert.strictEqual(status, 0);
  assert.deepStrictEqual(result.instincts, [], 'B5-only is incoherent -> dark');
  assert.ok(/world-anchor-arm-incoherent/.test(stderr), 'the observable incoherence emit fired on stderr');
  assert.ok(/admission-armed-without-signing/.test(stderr), 'the reason distinguishes the real misconfig (B5-only)');
});

test('E2E B1-only emits world-anchor-arm-incoherent (signing-armed-without-admission) on STDERR AND stays dark', () => {
  const { status, result, stderr } = runCli({ signing: '1' });
  assert.strictEqual(status, 0);
  assert.deepStrictEqual(result.instincts, [], 'B1-only leaves admission dark');
  assert.ok(/world-anchor-arm-incoherent/.test(stderr), 'the observable incoherence emit fired on stderr');
  assert.ok(/signing-armed-without-admission/.test(stderr), 'the reason distinguishes the legit staging (B1-only)');
});

test('a typo admission arm token emits world-anchor-arm-misconfigured on STDERR (never-fail-silent) AND stays dark', () => {
  const { status, result, stderr } = runCli({ admission: 'ture', signing: '1' });
  assert.strictEqual(status, 0);
  assert.deepStrictEqual(result.instincts, [], 'a typo does NOT arm - dark');
  assert.ok(/world-anchor-arm-misconfigured/.test(stderr), 'the observable misconfig emit fired on stderr');
});

test('H2: env LOOM_EDGE_VERIFY_KEY set has NO effect on the coherently-armed output (reader reads only the pinned path)', () => {
  const attacker = '-----BEGIN PUBLIC KEY-----\nATTACKER\n-----END PUBLIC KEY-----\n';
  const withEnv = runCli({ admission: '1', signing: '1', extraEnv: { LOOM_EDGE_VERIFY_KEY: attacker } });
  const without = runCli({ admission: '1', signing: '1' });
  assert.deepStrictEqual(withEnv.result.instincts, [], 'still dark with an attacker env key');
  assert.deepStrictEqual(withEnv.result.instincts, without.result.instincts, 'the env key changes nothing (no env-fallback surface)');
});

process.stdout.write(`\n=== world-anchored-recall-cli-arming: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
