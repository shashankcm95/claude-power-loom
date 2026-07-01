#!/usr/bin/env node
'use strict';

// tests/unit/lab/_lib/world-anchor-arming.test.js
//
// PR-B B5 - the SINGLE arming-flag source (VERIFY-architect HIGH-1: one flag name, one parse, both gate
// sites consume it). The suite is the behavioral contract:
//   - isWorldAnchorArmed is STRICT (VERIFY-hacker M2): only 1/true/yes/on -> true; a typo / any other token
//     -> false -> dark. This is the fails-CLOSED-for-ARM polarity (never the LENIENT isDeployFlagSet).
//   - isWorldAnchorArmMisconfigured is the LENIENT typo DETECTOR (observability only, never gates).
//   - the two predicates read the ONE canonical env var WORLD_ANCHOR_ARM_ENV.

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const MOD = path.join(REPO, 'packages/lab/_lib/world-anchor-arming.js');
const { WORLD_ANCHOR_ARM_ENV, isWorldAnchorArmed, isWorldAnchorArmMisconfigured } = require(MOD);
// Parity anchor: the arm parse MUST be the blessed STRICT normalizeBool (no second hand-rolled parser -
// VERIFY-reviewer LOW-1 / hacker M2). We assert isWorldAnchorArmed === normalizeBool over the token space.
const { normalizeBool } = require(path.join(REPO, 'packages/lab/_lib/host-claude-guard.js'));

let passed = 0; let failed = 0;
function test(name, fn) {
  const saved = process.env[WORLD_ANCHOR_ARM_ENV];
  try { fn(); passed += 1; process.stdout.write(`  PASS ${name}\n`); }
  catch (e) { failed += 1; process.stdout.write(`  FAIL ${name}: ${(e && e.message) || e}\n`); }
  finally { if (saved === undefined) delete process.env[WORLD_ANCHOR_ARM_ENV]; else process.env[WORLD_ANCHOR_ARM_ENV] = saved; }
}
function withArm(v, fn) { if (v === undefined) delete process.env[WORLD_ANCHOR_ARM_ENV]; else process.env[WORLD_ANCHOR_ARM_ENV] = v; fn(); }

test('the canonical env var name is LOOM_WORLD_ANCHOR_ARM', () => {
  assert.strictEqual(WORLD_ANCHOR_ARM_ENV, 'LOOM_WORLD_ANCHOR_ARM');
});

test('isWorldAnchorArmed: STRICT-true ONLY for 1/true/yes/on (trimmed, case-insensitive)', () => {
  for (const v of ['1', 'true', 'TRUE', 'yes', 'YES', 'on', 'ON', ' on ', ' 1 ']) {
    withArm(v, () => assert.strictEqual(isWorldAnchorArmed(), true, `armed for ${JSON.stringify(v)}`));
  }
});

test('isWorldAnchorArmed: DARK (false) for unset / empty / explicit-falsey / ANY typo or garbage', () => {
  for (const v of [undefined, '', '0', 'false', 'no', 'off', 'ture', 'enabled', 'truthy', '2', '01', '0x1', '-1', '[object Object]', 'y']) {
    withArm(v, () => assert.strictEqual(isWorldAnchorArmed(), false, `dark for ${JSON.stringify(v)}`));
  }
});

test('isWorldAnchorArmed === normalizeBool over the token space (no second parser, VERIFY-hacker M2 / reviewer LOW-1)', () => {
  for (const v of [undefined, '', '0', '1', 'true', 'false', 'yes', 'no', 'on', 'off', 'ture', 'enabled', '2', ' on ', 'TRUE', 'YES']) {
    withArm(v, () => assert.strictEqual(isWorldAnchorArmed(), normalizeBool(v), `parity for ${JSON.stringify(v)}`));
  }
});

test('isWorldAnchorArmMisconfigured: TRUE only for a non-falsey-but-not-valid token (an arm typo)', () => {
  for (const v of ['ture', 'enabled', 'truthy', '2', '01', '0x1', 'y', '[object Object]']) {
    withArm(v, () => assert.strictEqual(isWorldAnchorArmMisconfigured(), true, `misconfig for ${JSON.stringify(v)}`));
  }
});

test('isWorldAnchorArmMisconfigured: FALSE for unset / explicit-falsey / a valid-truthy (not a typo)', () => {
  for (const v of [undefined, '', '0', 'false', 'no', 'off', '1', 'true', 'yes', 'on']) {
    withArm(v, () => assert.strictEqual(isWorldAnchorArmMisconfigured(), false, `not-misconfig for ${JSON.stringify(v)}`));
  }
});

test('a valid-truthy arms AND is NOT misconfigured; a typo does NOT arm AND IS misconfigured (mutually exclusive on the gating branch)', () => {
  withArm('on', () => { assert.strictEqual(isWorldAnchorArmed(), true); assert.strictEqual(isWorldAnchorArmMisconfigured(), false); });
  withArm('ture', () => { assert.strictEqual(isWorldAnchorArmed(), false); assert.strictEqual(isWorldAnchorArmMisconfigured(), true); });
});

process.stdout.write(`\n=== world-anchor-arming: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
