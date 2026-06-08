#!/usr/bin/env node

// tests/unit/lab/causal-edge/loop-and-exclusion.test.js
//
// v3.5 Wave 2 - the causal-edge graph LOOP integration + the EC4/R3 exclusion assertions. The per-module
// unit tests prove each piece in isolation; THIS proves the producer + consumer cohere end-to-end through
// the REAL store (the loop is what makes the store NOT a dark producer), and that the loop stays SHADOW:
//   store.createEdge (produce) -> faithfulness.rung2AdvisoryCheck (judge) -> store.updateEdgeStatus
//     (promote) -> store.listEdges -> walker.walk (consume).
//
// The loop honest-claim is FUNCTION-LEVEL (store -> walker), NOT production-wired (store -> walker ->
// live recall) - like A6's materialize shipping "not yet wired to a router". 0 kernel/hooks.json refs.
//
// ENV-BEFORE-REQUIRE: LOOM_LAB_STATE_DIR set before requiring the store.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const TMP = path.join(os.tmpdir(), 'w2-causal-loop-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = TMP; // BEFORE the requires below
fs.mkdirSync(TMP, { recursive: true });

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const store = require(path.join(REPO_ROOT, 'packages', 'lab', 'causal-edge', 'store.js'));
const walker = require(path.join(REPO_ROOT, 'packages', 'lab', 'causal-edge', 'walker.js'));
const faithfulness = require(path.join(REPO_ROOT, 'packages', 'lab', 'causal-edge', 'faithfulness.js'));

const T0 = '2026-06-07T00:00:00.000Z';
const sorted = (xs) => xs.slice().sort();

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fs.rmSync(store.LEDGER_PATH, { force: true }); } catch { /* no ledger yet */ }
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// -- 1. ★ THE FULL LOOP: produce -> judge -> promote -> consume. A fresh edge is AUDIT-ONLY (not
//        traversable); only after rung-2 promotes it does the walker reach across it.
test('* full loop: produce -> rung2 judge -> updateEdgeStatus -> the walker now reaches across it', () => {
  const e = store.createEdge({ relation: 'caused_by', sourceBlock: 'A', targetBlock: 'B', sourceOrigin: 'run/architect', now: T0 });
  assert.strictEqual(e.faithfulness_status, 'unvalidated', 'born unvalidated (R1)');
  // before promotion: B is unreachable (the only edge is AUDIT-ONLY)
  assert.deepStrictEqual(walker.walk('A', store.listEdges(), { mode: 'cluster' }).reachedBlocks, ['A'], 'AUDIT-ONLY edge is not traversable');
  // rung-2 judges it supported -> the caller applies the promotion via updateEdgeStatus
  const verdict = faithfulness.rung2AdvisoryCheck(e, () => ({ supported: true, reason: 'the commit links them' }));
  assert.ok(verdict.promoted && verdict.status === 'advisory_llm_checked', 'rung-2 supported -> advisory_llm_checked');
  store.updateEdgeStatus(e.edge_id, verdict.status);
  // after promotion: the walker reaches B across the now-eligible edge
  assert.deepStrictEqual(sorted(walker.walk('A', store.listEdges(), { mode: 'cluster' }).reachedBlocks), ['A', 'B'], 'promoted edge is now traversable');
});

// -- 2. ★ EC4/R3 end-to-end through the REAL store: an AUDIT-ONLY edge mixed with eligible ones is
//        excluded by the walker fed from store.listEdges (not just a hand-built array).
test('* EC4/R3 through the real store: an AUDIT-ONLY edge is excluded from the listEdges->walk loop', () => {
  store.createEdge({ relation: 'caused_by', sourceBlock: 'A', targetBlock: 'B', faithfulnessStatus: 'advisory_llm_checked', sourceOrigin: 'o', now: T0 });
  store.createEdge({ relation: 'caused_by', sourceBlock: 'B', targetBlock: 'C', faithfulnessStatus: 'unvalidated', sourceOrigin: 'o', now: T0 });
  const out = walker.walk('A', store.listEdges(), { mode: 'cluster' });
  assert.deepStrictEqual(sorted(out.reachedBlocks), ['A', 'B'], 'C (behind the unvalidated edge) is excluded end-to-end');
});

// -- 3. EC4 conflicted-stays-reachable through the real store.
test('EC4 (real store): a contradicts edge keeps its endpoints reachable', () => {
  store.createEdge({ relation: 'contradicts', conflictType: 'temporal', sourceBlock: 'A', targetBlock: 'B', faithfulnessStatus: 'human_confirmed', sourceOrigin: 'o', now: T0 });
  const out = walker.walk('A', store.listEdges(), { mode: 'related' });
  assert.deepStrictEqual(sorted(out.reachedBlocks), ['A', 'B'], 'the contradicts edge connects A-B, not removes them');
});

// -- 4. ★ A6 / recall EXCLUSION (asserted, not just structural): the reputation materializer + the K4
//        recall surface read NOTHING from the causal-edge store (probe-verified 2026-06-07).
test('* A6/recall exclusion: reputation + kernel/recall sources reference no causal-edge store', () => {
  const targets = [
    'packages/lab/reputation/materialize.js',
    'packages/lab/reputation/project.js',
    'packages/kernel/recall/loom-recall.js',
  ];
  for (const rel of targets) {
    const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    assert.ok(!/causal-edge|causal-edges|causal/.test(src), `${rel} must not read the causal-edge store (advisory edges feed the walker only, never the A6 snapshot / recall)`);
  }
});

// -- 5. ★ SHADOW: 0 kernel/hooks.json deep refs to the causal-edge layer (probe-verified 2026-06-07).
test('* SHADOW: packages/kernel/hooks.json has zero causal / lab refs (never kernel-wired)', () => {
  const hooks = fs.readFileSync(path.join(REPO_ROOT, 'packages', 'kernel', 'hooks.json'), 'utf8');
  assert.ok(!/causal/.test(hooks), 'no causal ref in hooks.json');
  assert.ok(!/lab\//.test(hooks), 'no lab/ ref in hooks.json');
});

// -- 6. CLI smoke (subprocess): create -> list -> walk exercises the cli.js wrapper + the store->walker loop.
test('CLI smoke: create two eligible edges, then `walk --seed A` reaches the cluster', () => {
  const cli = path.join(REPO_ROOT, 'packages', 'lab', 'causal-edge', 'cli.js');
  const env = { ...process.env, LOOM_LAB_STATE_DIR: TMP };
  const run = (args) => execFileSync('node', [cli, ...args], { env, encoding: 'utf8' });
  run(['create', '--relation', 'caused_by', '--source', 'A', '--target', 'B', '--status', 'advisory_llm_checked']);
  run(['create', '--relation', 'caused_by', '--source', 'B', '--target', 'C', '--status', 'human_confirmed']);
  const listed = JSON.parse(run(['list']));
  assert.strictEqual(listed.length, 2, 'two edges created via the CLI');
  const walked = JSON.parse(run(['walk', '--seed', 'A', '--mode', 'cluster']));
  assert.deepStrictEqual(sorted(walked.reachedBlocks), ['A', 'B', 'C'], 'the CLI walk reaches the eligible cluster');
});

// Best-effort temp cleanup.
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* tmpdir reclaim is the OS's job */ }

process.stdout.write(`\nloop-and-exclusion.test.js (causal-edge): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
