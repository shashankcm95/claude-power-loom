#!/usr/bin/env node
'use strict';

// tests/unit/lab/_lib/custody-arming.test.js
//
// A-W1 - the shared ARMING POLICY for the world-anchor custody keys (extracted from world-anchored-recall-cli.js
// now that the observe-merge verify-at-mint arm is a SECOND consumer). Behavioral contract:
//   - resolveArmedCustodyKeys({signingArmed}) -> {} unless admission is COHERENTLY armed (both-or-neither).
//   - resolveArmedBrokerVerifyKey({signingArmed}) -> null unless admission is COHERENTLY armed.
//   - SINGLE-TRUTH (VERIFY-architect Q5-A): the two resolvers share ONE arm-read - never split. For every combo,
//     resolveArmedBrokerVerifyKey(x) === (resolveArmedCustodyKeys(x).brokerVerifyKey ?? null).
//   - the incoherence emit is OBSERVABLE (Q5-C) + DISTINCT (Q5-B): world-anchor-arm-incoherent (not the typo token).

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const MOD = path.join(REPO, 'packages/lab/_lib/custody-arming.js');
const {
  EDGE_VERIFY_KEY_PATH, BROKER_VERIFY_KEY_PATH, resolveArmedCustodyKeys, resolveArmedBrokerVerifyKey,
} = require(MOD);

const ADMIT = 'LOOM_WORLD_ANCHOR_ARM';
const DEPLOYED = fs.existsSync(EDGE_VERIFY_KEY_PATH) && fs.existsSync(BROKER_VERIFY_KEY_PATH);

let passed = 0; let failed = 0;
function test(name, fn) {
  const saved = process.env[ADMIT];
  try { fn(); passed += 1; process.stdout.write(`  PASS ${name}\n`); }
  catch (e) { failed += 1; process.stdout.write(`  FAIL ${name}: ${(e && e.message) || e}\n`); }
  finally { if (saved === undefined) delete process.env[ADMIT]; else process.env[ADMIT] = saved; }
}
function withAdmit(v, fn) { if (v === undefined) delete process.env[ADMIT]; else process.env[ADMIT] = v; fn(); }

// Capture stderr (emitEgressAlert writes there) for the duration of fn.
function captureStderr(fn) {
  const orig = process.stderr.write;
  let buf = '';
  process.stderr.write = (chunk) => { buf += String(chunk); return true; };
  try { fn(); } finally { process.stderr.write = orig; }
  return buf;
}

// === resolveArmedCustodyKeys: the both-or-neither gate ===
test('UN-ARMED (neither flag): resolveArmedCustodyKeys() === {} (byte-identical pre-A un-armed)', () => {
  withAdmit(undefined, () => assert.deepStrictEqual(resolveArmedCustodyKeys({ signingArmed: false }), {}));
});

test('B5-only (admission armed, signing dark): resolveArmedCustodyKeys() === {} (incoherent -> fail-closed dark)', () => {
  withAdmit('1', () => assert.deepStrictEqual(resolveArmedCustodyKeys({ signingArmed: false }), {}));
});

test('B1-only (admission dark, signing armed): resolveArmedCustodyKeys() === {} (admission stays dark)', () => {
  withAdmit(undefined, () => assert.deepStrictEqual(resolveArmedCustodyKeys({ signingArmed: true }), {}));
});

test('COHERENTLY ARMED (both): resolveArmedCustodyKeys() carries selfUid + BOTH key fields (string|null)', () => {
  withAdmit('1', () => {
    const o = resolveArmedCustodyKeys({ signingArmed: true });
    assert.ok('selfUid' in o && 'edgeVerifyKey' in o && 'brokerVerifyKey' in o, 'all three fields present');
    for (const k of ['edgeVerifyKey', 'brokerVerifyKey']) assert.ok(o[k] === null || typeof o[k] === 'string', `${k} string|null`);
    if (DEPLOYED) assert.strictEqual(typeof o.brokerVerifyKey, 'string', 'real broker key resolves on this deployed box');
  });
});

// === resolveArmedBrokerVerifyKey: verify-at-mint's key ===
test('resolveArmedBrokerVerifyKey: null on un-armed / B5-only / B1-only (not coherently armed)', () => {
  withAdmit(undefined, () => assert.strictEqual(resolveArmedBrokerVerifyKey({ signingArmed: false }), null, 'un-armed'));
  withAdmit('1', () => assert.strictEqual(resolveArmedBrokerVerifyKey({ signingArmed: false }), null, 'B5-only'));
  withAdmit(undefined, () => assert.strictEqual(resolveArmedBrokerVerifyKey({ signingArmed: true }), null, 'B1-only'));
});

test('resolveArmedBrokerVerifyKey: coherently armed -> the broker key (string on this deployed box, null on CI)', () => {
  withAdmit('1', () => {
    const k = resolveArmedBrokerVerifyKey({ signingArmed: true });
    if (DEPLOYED) assert.strictEqual(typeof k, 'string', 'real broker key resolves');
    else assert.strictEqual(k, null, 'absent -> null (CI)');
  });
});

// === Q5-A single-truth: the two resolvers can NEVER split ===
test('SINGLE-TRUTH: resolveArmedBrokerVerifyKey(x) === (resolveArmedCustodyKeys(x).brokerVerifyKey ?? null) for EVERY combo', () => {
  for (const admission of [undefined, '1', 'ture']) {
    for (const signingArmed of [true, false]) {
      withAdmit(admission, () => {
        const custody = resolveArmedCustodyKeys({ signingArmed });
        const broker = resolveArmedBrokerVerifyKey({ signingArmed });
        const custodyBroker = ('brokerVerifyKey' in custody) ? custody.brokerVerifyKey : null;
        assert.strictEqual(broker, custodyBroker, `combo admit=${admission} sign=${signingArmed}: never split`);
      });
    }
  }
});

// === Q5-B / Q5-C: distinct, observable, non-vacuous incoherence emit ===
test('B5-only EMITS world-anchor-arm-incoherent (admission-armed-without-signing) BEFORE dark (non-vacuous)', () => {
  withAdmit('1', () => {
    const err = captureStderr(() => { const o = resolveArmedCustodyKeys({ signingArmed: false }); assert.deepStrictEqual(o, {}); });
    assert.ok(/world-anchor-arm-incoherent/.test(err), 'the incoherence emit fired');
    assert.ok(/admission-armed-without-signing/.test(err), 'the reason names the real misconfig');
  });
});

test('B1-only EMITS world-anchor-arm-incoherent (signing-armed-without-admission)', () => {
  withAdmit(undefined, () => {
    const err = captureStderr(() => resolveArmedCustodyKeys({ signingArmed: true }));
    assert.ok(/world-anchor-arm-incoherent/.test(err), 'the incoherence emit fired');
    assert.ok(/signing-armed-without-admission/.test(err), 'the reason names the legit staging');
  });
});

test('COHERENT states do NOT emit world-anchor-arm-incoherent (non-vacuity: the guard is silent when coherent)', () => {
  withAdmit('1', () => {
    const err = captureStderr(() => resolveArmedCustodyKeys({ signingArmed: true }));   // both armed
    assert.ok(!/world-anchor-arm-incoherent/.test(err), 'no incoherence emit when both armed');
  });
  withAdmit(undefined, () => {
    const err = captureStderr(() => resolveArmedCustodyKeys({ signingArmed: false }));  // neither
    assert.ok(!/world-anchor-arm-incoherent/.test(err), 'no incoherence emit when neither armed');
  });
});

test('DISTINCT tokens (Q5-B) + typo suppresses -incoherent (CodeRabbit F2): a typo admission arm emits ONLY -misconfigured, even with signing armed', () => {
  withAdmit('ture', () => {
    const errDark = captureStderr(() => resolveArmedCustodyKeys({ signingArmed: false }));
    assert.ok(/world-anchor-arm-misconfigured/.test(errDark), 'typo -> misconfigured token');
    assert.ok(!/world-anchor-arm-incoherent/.test(errDark), 'typo alone: no -incoherent');
    // typo admission + signing armed: the TYPO is the real cause -> ONLY -misconfigured, never a misleading
    // -incoherent(cause=signing-armed-without-admission), which would misreport a parse failure as a coherence XOR.
    const errArmed = captureStderr(() => resolveArmedCustodyKeys({ signingArmed: true }));
    assert.ok(/world-anchor-arm-misconfigured/.test(errArmed), 'typo+signing -> misconfigured token');
    assert.ok(!/world-anchor-arm-incoherent/.test(errArmed), 'typo+signing does NOT emit -incoherent (F2)');
  });
});

test('the pinned paths are HARD CONSTANTS (the /etc/loom trust anchors, never argv/env-derived)', () => {
  assert.strictEqual(EDGE_VERIFY_KEY_PATH, '/etc/loom/edge-verify.pem');
  assert.strictEqual(BROKER_VERIFY_KEY_PATH, '/etc/loom/verify.pem');
});

process.stdout.write(`\n=== custody-arming: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
