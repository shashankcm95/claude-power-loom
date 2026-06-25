#!/usr/bin/env node

// tests/unit/lab/world-anchor/recall-graph-store-rejects-live.test.js
//
// The REAL live-consumer firewall (item 3, design D5). The world_anchored live store is SHADOW: it
// is recallable in NAME only. The structural dam is recall-graph-store.js:56 + :76 -- writeNode AND
// verifyNode REJECT any node whose provenance is not the single `backtest` value, EVEN when pointed
// at a live dir. So a `world_anchored` node minted into recall-graph-live/ can NEVER be read by the
// recall-graph retrieval path nor surface in a persona grounding slice. We assert that firewall
// FIRSTHAND (a planted node), and assert the source-admission firewall (LIVE_SOURCES) is still
// Object.freeze([]) with no production ranking driver wired. Opening either dam is ladder item 5
// (the authenticated edge minter).

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Test isolation: pin the lab-state base to a throwaway tmp dir BEFORE the store modules are required
// (they read LOOM_LAB_STATE_DIR at module load), so a test that omits an injected dir can NEVER write to
// the real ~/.claude/lab-state store.
process.env.LOOM_LAB_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-test-labstate-'));

const REPO = path.join(__dirname, '..', '..', '..', '..');
const recallStore = require(path.join(REPO, 'packages', 'lab', 'attribution', 'recall-graph-store.js'));
const groundingSlice = require(path.join(REPO, 'packages', 'lab', 'persona-experiment', 'grounding-slice.js'));
const weightGate = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'weight-source-gate.js'));
const liveStore = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'live-recall-store.js'));

let passed = 0;
function test(name, fn) { fn(); passed += 1; }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loom-firewall-')); }

// Plant a world_anchored live node into `dir` (the real mint, so the file is a genuine, internally
// consistent world_anchored node -- the firewall must reject it NOT because it is malformed, but
// because its provenance is not `backtest`). Returns the node_id.
function plantLiveNode(dir) {
  const m = liveStore.mintWorldAnchoredNode({
    anchor_id: 'a'.repeat(64),
    merge_sha: 'd91785ea',
    lesson_signature: 'lesson:boundary-contract|unguarded-edge-case|handle-edge-explicitly',
    lesson_body: 'a world-grounded lesson that must never reach the recall retrieval path',
  }, { dir });
  assert.strictEqual(m.ok, true, 'the live node is a genuine, internally-consistent world_anchored node');
  return m.node_id;
}

test('recall-graph-store.listNodes SKIPS a world_anchored node planted in a live dir (the :56 firewall)', () => {
  const dir = tmp();
  const node_id = plantLiveNode(dir);
  assert.ok(fs.existsSync(path.join(dir, `${node_id}.json`)), 'the live node file exists on disk');
  const nodes = recallStore.listNodes({ dir });
  assert.deepStrictEqual(nodes, [], 'recall-graph-store reads ZERO nodes from a live dir (provenance-rejected)');
});

test('recall-graph-store.loadNode returns null for a world_anchored node (verifyNode :56 provenance reject)', () => {
  const dir = tmp();
  const node_id = plantLiveNode(dir);
  const loaded = recallStore.loadNode(node_id, { dir });
  assert.strictEqual(loaded, null, 'a world_anchored node never loads through the recall-graph store');
});

test('recall-graph-store.writeNode REJECTS a world_anchored node (the write-side :76 firewall)', () => {
  const dir = tmp();
  const w = recallStore.writeNode({ provenance: liveStore.WORLD_ANCHORED, node_id: 'a'.repeat(64) }, { dir });
  assert.strictEqual(w.ok, false, 'the write side refuses a non-backtest provenance');
  assert.strictEqual(w.reason, 'provenance-rejected');
});

test('grounding-slice returns "" for a persona whose only "lessons" are planted world_anchored nodes', () => {
  const dir = tmp();
  plantLiveNode(dir);
  // point the grounding slice's node store at the live dir; the recall-graph firewall skips every
  // world_anchored node, so the persona has zero confirmed recall lessons -> an empty slice.
  const slice = groundingSlice.buildGroundingSlice('node-backend', { dir });
  assert.strictEqual(slice, '', 'a world_anchored node never contributes to a persona grounding slice');
});

test('source-admission firewall: LIVE_SOURCES is still Object.freeze([]) (no live weight lane admits)', () => {
  assert.ok(Array.isArray(weightGate.LIVE_SOURCES), 'LIVE_SOURCES is an array');
  assert.strictEqual(weightGate.LIVE_SOURCES.length, 0, 'LIVE_SOURCES is empty');
  assert.ok(Object.isFrozen(weightGate.LIVE_SOURCES), 'LIVE_SOURCES is frozen (cannot be poisoned at runtime)');
  // a world_anchored-tagged weight is admitted as 0 (the gate keys on `source`, never `provenance`)
  const admitted = weightGate.admitWeightForRanking({ source: liveStore.WORLD_ANCHORED, weight: 1 });
  assert.strictEqual(admitted, 0, 'a world_anchored source admits no weight (the empty live-allow-set)');
});

test('no new live-store code references buildRankingWeights / admitWeightForRanking (two-dam inertness)', () => {
  const src = fs.readFileSync(path.join(REPO, 'packages', 'lab', 'world-anchor', 'live-recall-store.js'), 'utf8');
  assert.ok(!/buildRankingWeights|admitWeightForRanking/.test(src), 'the live store wires no ranking driver');
  const cliSrc = fs.readFileSync(path.join(REPO, 'packages', 'lab', 'world-anchor', 'cli.js'), 'utf8');
  assert.ok(!/buildRankingWeights|admitWeightForRanking/.test(cliSrc), 'the mint wire wires no ranking driver');
});

console.log(`recall-graph-store-rejects-live.test.js: ${passed} passed`);
