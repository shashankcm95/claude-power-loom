#!/usr/bin/env node
'use strict';

// tests/unit/lab/causal-edge/world-anchored-recall-arming-composition.test.js
//
// PR-B B5 - the COMPOSITION proof: the recall driver's per-node source gate (admittedWeight) HONORS the D1
// arming flip. This is the transitive link the full chain rests on:
//   - B2 admit-world-anchor-node.test.js proves a valid quadruple -> source 'world-anchor' (existing).
//   - weight-source-gate-arming.test.js proves armed -> LIVE_SOURCES ['world-anchor'] (D1).
//   - world-anchored-recall.test.js proves rankInstincts surfaces a w>0 entry, drops w=0 (existing B3).
//   - THIS proves the middle link: admittedWeight({source:'world-anchor', verdict:HARDEN}) is >0 ONLY when
//     armed (0 when unarmed). So an admitted node surfaces iff LIVE_SOURCES is armed - via a MODULE CONSTANT,
//     never an opts injection (the B3 no-injection-seam CRITICAL: there is no seam to dial the gate off).
// admittedWeight reads the gate's module-load LIVE_SOURCES, so the arm-state matrix uses a SUBPROCESS harness.

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const RECALL = path.join(REPO, 'packages/lab/causal-edge/world-anchored-recall.js');

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; process.stdout.write(`  PASS ${name}\n`); }
  catch (e) { failed += 1; process.stdout.write(`  FAIL ${name}: ${(e && e.message) || e}\n`); }
}

function admittedUnderArm(armValue) {
  const script = `
    const { admittedWeight } = require(${JSON.stringify(RECALL)});
    const { VERDICT } = require(${JSON.stringify(path.join(REPO, 'packages/lab/causal-edge/lesson-merge-lift.js'))});
    process.stdout.write(JSON.stringify({
      waHarden: admittedWeight({ source: 'world-anchor', verdict: VERDICT.HARDEN }),
      waWithhold: admittedWeight({ source: 'world-anchor', verdict: VERDICT.WITHHOLD }),
      mockHarden: admittedWeight({ source: 'mock', verdict: VERDICT.HARDEN }),
    }));
  `;
  const env = { ...process.env };
  if (armValue === undefined) delete env.LOOM_WORLD_ANCHOR_ARM; else env.LOOM_WORLD_ANCHOR_ARM = armValue;
  const res = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env, timeout: 10000 });
  assert.strictEqual(res.status, 0, `exit 0 (stderr=${res.stderr})`);
  return JSON.parse(res.stdout);
}

test('UNARMED: admittedWeight is 0 for EVERY source (world-anchor HARDEN included) - the driver gate is dark', () => {
  const r = admittedUnderArm(undefined);
  assert.strictEqual(r.waHarden, 0, 'world-anchor HARDEN not admitted while unarmed');
  assert.strictEqual(r.waWithhold, 0);
  assert.strictEqual(r.mockHarden, 0);
});

test('ARMED: admittedWeight({source:world-anchor, verdict:HARDEN}) > 0; WITHHOLD still 0; a mock source still 0', () => {
  const r = admittedUnderArm('1');
  assert.ok(r.waHarden > 0, 'an admitted world-anchor HARDEN node now carries a positive ranking weight');
  assert.strictEqual(r.waWithhold, 0, 'a WITHHOLD verdict weighs 0 even when armed (verdict gate)');
  assert.strictEqual(r.mockHarden, 0, 'a mock-source node is 0 even armed (source gate: only world-anchor flips)');
});

test('a typo arm token leaves the driver gate dark (STRICT)', () => {
  assert.strictEqual(admittedUnderArm('ture').waHarden, 0);
});

process.stdout.write(`\n=== world-anchored-recall-arming-composition: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
