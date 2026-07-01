#!/usr/bin/env node
'use strict';

// tests/unit/lab/causal-edge/weight-source-gate-arming.test.js
//
// PR-B B5 - D1: the LIVE_SOURCES arming flip in the pure weight gate. The flip is read ONCE at module load,
// so the arm-state matrix uses a SUBPROCESS harness (VERIFY-reviewer HIGH-1 / architect MED-1: `delete
// require.cache` re-require is leak-prone for sticky module-load env; a child_process per arm-state is the
// only harness that actually exercises the load-time read). Contract:
//   - unarmed / typo -> LIVE_SOURCES deep-equals [] ; admitWeightForRanking('world-anchor') === 0.
//   - armed (1/true/yes/on) -> LIVE_SOURCES deep-equals ['world-anchor'] ; admit('world-anchor') === 1 ;
//     a 'mock' source is still 0 (the flip admits ONLY the world-anchor token).
//   - frozen either way (push throws) - the Object.freeze(array) immutability invariant.
//   - the armed token === WORLD_ANCHOR_SOURCE (byte-parity pin, no drift; no cross-dir import in the gate).
//   - M3 poison-proof: reassigning the EXPORTED LIVE_SOURCES does NOT change admitWeightForRanking's verdict
//     (isLiveSource closes over the module-internal const, VERIFY-hacker M3 probe 3).

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const GATE = path.join(REPO, 'packages/lab/causal-edge/weight-source-gate.js');
const EDGE_STORE = path.join(REPO, 'packages/lab/world-anchor/world-anchor-edge-store.js');
// test-only cross-dir import for the parity pin (the SHADOW import-graph dam scans packages/ source, NOT the
// test tree, so this import is legal + does not couple the pure gate to the edge store).
const { WORLD_ANCHOR_SOURCE } = require(EDGE_STORE);

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; process.stdout.write(`  PASS ${name}\n`); }
  catch (e) { failed += 1; process.stdout.write(`  FAIL ${name}: ${(e && e.message) || e}\n`); }
}

// Run the gate under a given LOOM_WORLD_ANCHOR_ARM value in a fresh process (module-load read).
function gateUnderArm(armValue) {
  const script = `
    const g = require(${JSON.stringify(GATE)});
    let pushThrows = false;
    try { g.LIVE_SOURCES.push('x'); } catch { pushThrows = true; }
    process.stdout.write(JSON.stringify({
      liveSources: g.LIVE_SOURCES,
      admitWA: g.admitWeightForRanking({ source: 'world-anchor', weight: 1 }),
      admitMock: g.admitWeightForRanking({ source: 'mock', weight: 1 }),
      pushThrows,
    }));
  `;
  const env = { ...process.env };
  if (armValue === undefined) delete env.LOOM_WORLD_ANCHOR_ARM; else env.LOOM_WORLD_ANCHOR_ARM = armValue;
  const res = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env, timeout: 10000 });
  assert.strictEqual(res.status, 0, `subprocess exit 0 (stderr=${res.stderr})`);
  return JSON.parse(res.stdout);
}

test('UNARMED (flag unset): LIVE_SOURCES === [] ; admit world-anchor 0 ; frozen (push throws)', () => {
  const r = gateUnderArm(undefined);
  assert.deepStrictEqual(r.liveSources, []);
  assert.strictEqual(r.admitWA, 0);
  assert.strictEqual(r.pushThrows, true, 'frozen-empty array: push throws');
});

test('ARMED (=1): LIVE_SOURCES === ["world-anchor"] ; admit world-anchor 1 ; mock still 0 ; frozen', () => {
  const r = gateUnderArm('1');
  assert.deepStrictEqual(r.liveSources, ['world-anchor']);
  assert.strictEqual(r.admitWA, 1, 'the world-anchor source now admits its weight');
  assert.strictEqual(r.admitMock, 0, 'a mock source is still 0 (only world-anchor flips)');
  assert.strictEqual(r.pushThrows, true, 'frozen-armed array: push throws');
});

test('ARMED via true/yes/on all flip; a typo ("ture") does NOT (STRICT, dark)', () => {
  for (const v of ['true', 'yes', 'on']) assert.deepStrictEqual(gateUnderArm(v).liveSources, ['world-anchor'], `armed via ${v}`);
  for (const v of ['ture', '0', 'false', '']) assert.deepStrictEqual(gateUnderArm(v).liveSources, [], `dark via ${JSON.stringify(v)}`);
});

test('the armed token === WORLD_ANCHOR_SOURCE (byte-parity pin, no drift)', () => {
  const r = gateUnderArm('1');
  assert.strictEqual(r.liveSources[0], WORLD_ANCHOR_SOURCE, `gate literal must equal the canonical ${WORLD_ANCHOR_SOURCE}`);
});

test('M3: reassigning the EXPORTED LIVE_SOURCES does NOT change admitWeightForRanking (closure over the internal const)', () => {
  const script = `
    const g = require(${JSON.stringify(GATE)});
    const before = g.admitWeightForRanking({ source: 'world-anchor', weight: 1 });
    let reassigned = false;
    try { g.LIVE_SOURCES = ['world-anchor']; reassigned = (g.LIVE_SOURCES[0] === 'world-anchor'); } catch { /* */ }
    const after = g.admitWeightForRanking({ source: 'world-anchor', weight: 1 });
    process.stdout.write(JSON.stringify({ before, after, reassigned }));
  `;
  const env = { ...process.env }; delete env.LOOM_WORLD_ANCHOR_ARM;  // unarmed: the gate default is dark
  const res = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env, timeout: 10000 });
  assert.strictEqual(res.status, 0, `exit 0 (stderr=${res.stderr})`);
  const r = JSON.parse(res.stdout);
  assert.strictEqual(r.before, 0, 'unarmed: dark before');
  assert.strictEqual(r.after, 0, 'STILL dark after reassigning the export - the gate reads the internal const, not the property');
});

process.stdout.write(`\n=== weight-source-gate-arming: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
