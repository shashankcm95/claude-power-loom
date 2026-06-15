'use strict';

// v3.10-W2 (E5) — THE internal-proof gate for the multi-author claim. Spawns the round harness with
// `--shared` as a CHILD PROCESS (env seams pre-set: the ENV-BEFORE-REQUIRE isolation). Two REAL identities
// (t1, t2) build the SAME worked example on the REAL kernel+runtime+lab stack -> a node_id collision -> two
// authorship edges -> a mock signal credits BOTH. Pinned assertions (honesty HIGH: on the RESULT object,
// NEVER a boolean conflating collision-fired with both-credited): (1) persona_collision === true, (2) EXACTLY
// 2 authorship edges for the shared node, (3) BOTH test-probe.t1 AND test-probe.t2 credited each posterior
// 2/3. Plus isolation (nothing leaks to the real ~/.claude) + disposal. The W1 solo round.test.js stays green.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let passed = 0;
function test(name, fn) { fn(); passed += 1; }

const HARNESS = path.resolve(__dirname, '..', '..', '..', '..', 'packages', 'lab', 'persona-consumer', '_spike', 'persona-consumer-round.js');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'w2-shared-'));
const fakeHome = path.join(base, 'home');
const env = {
  PATH: process.env.PATH,
  HOME: fakeHome,
  LOOM_LAB_STATE_DIR: path.join(base, 'lab'),
  HETS_IDENTITY_STORE: path.join(base, 'id.json'),
  LOOM_SPAWN_STATE_DIR: path.join(base, 'spawn'),
};

const proc = spawnSync('node', [HARNESS, '--shared'], { env, encoding: 'utf8' });
const result = (() => { try { return JSON.parse(proc.stdout.trim().split('\n').pop()); } catch { return null; } })();

test('the SHARED round completes on the real stack: two real identities -> collided node -> credit both', () => {
  assert.strictEqual(proc.status, 0, `harness exited ${proc.status}; stderr: ${proc.stderr}`);
  assert.ok(result && result.ok && result.shared, 'shared round ok');
  assert.ok(result.node1_written && result.signal_written, 'real node + mock signal written');
});

test('W2-E5 assertion 1 — the 2nd writeNode FIRED persona_collision (same worked example, different built_by)', () => {
  assert.strictEqual(result.persona_collision, true, 'a node_id collision must be observed at the 2nd write');
});

test('W2-E5 assertion 2 — the authorship store has EXACTLY 2 edges for the shared node', () => {
  assert.strictEqual(result.authorship_edge_count, 2, 'one edge per author (t1, t2) for the shared node_id');
});

test('W2-E5 assertion 3 — BOTH test-probe.t1 AND test-probe.t2 credited, each posterior 2/3 (multi-author)', () => {
  const t1 = result.credited['test-probe.t1'];
  const t2 = result.credited['test-probe.t2'];
  assert.ok(t1 && t2, 'both co-authors must appear in per_persona');
  assert.strictEqual(t1.n_support, 1); assert.strictEqual(t1.posterior, 2 / 3);
  assert.strictEqual(t2.n_support, 1); assert.strictEqual(t2.posterior, 2 / 3);
  assert.strictEqual(result.both_credited, true, 'both-credited (the multi-author merge) — never collision-fired-but-only-t1');
});

test('E3 isolation (positive): every write landed UNDER the temp base (incl. the authorship lane)', () => {
  for (const [k, dir] of Object.entries(result.store_dirs)) {
    assert.ok(dir.startsWith(base), `${k} dir (${dir}) must be under the temp base`);
  }
  const authDir = path.join(base, 'lab', 'recall-authorship');
  assert.ok(fs.existsSync(authDir) && fs.readdirSync(authDir).length === 2, 'two authorship edge files in temp');
  // Non-vacuous POSITIVE isolation proof (honesty LOW): the REAL assign landed in the TEMP id store -- so
  // the negative checks below aren't merely "the real store happens to be absent". (Without this, an absent
  // real id-store would let the negative assertion pass vacuously.)
  const tempId = result.store_dirs.identities;
  assert.ok(fs.existsSync(tempId) && fs.readFileSync(tempId, 'utf8').includes('99-test-probe'),
    'the temp identity store MUST hold the assigned test persona (proves the assign was isolated, not no-op)');
});

test('E3 isolation (negative): NOTHING leaked to the real ~/.claude (no test persona, no shared node)', () => {
  const realClaude = path.join(os.homedir(), '.claude');
  const realIdStore = path.join(realClaude, 'agent-identities.json');
  if (fs.existsSync(realIdStore)) {
    assert.ok(!fs.readFileSync(realIdStore, 'utf8').includes('99-test-probe'), 'the real identity store must never gain the test persona');
  }
  const realAuth = path.join(realClaude, 'lab-state', 'recall-authorship', `${result.node_id}.json`);
  assert.ok(!fs.existsSync(realAuth), 'no shared-node authorship edge under the real ~/.claude');
  const realNode = path.join(realClaude, 'lab-state', 'recall-graph-backtest', `${result.node_id}.json`);
  assert.ok(!fs.existsSync(realNode), 'no shared node under the real ~/.claude');
});

test('E4 disposal: rm -rf the ONE base removes ALL state (nodes + signals + authorships + identities)', () => {
  fs.rmSync(base, { recursive: true, force: true });
  assert.ok(!fs.existsSync(base), 'base gone');
  for (const dir of Object.values(result.store_dirs)) assert.ok(!fs.existsSync(dir), `${dir} gone after disposal`);
});

console.log(`round-shared.test.js: ${passed} passed`);
