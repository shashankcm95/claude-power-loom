'use strict';

// v3.10-W1 — the REAL-STACK round, as a CHILD PROCESS (the only honest way to test the env-seam
// isolation: the spawner sets HOME + the seams BEFORE node starts, so the stores' module-load dir
// consts resolve to the temp base — the ENV-BEFORE-REQUIRE mitigation). Covers:
//   E3 lane isolation (positive: writes landed in the temp base; negative: NOTHING under the fake
//      HOME/.claude -> every store honored its seam, no hard-coded-path leak),
//   E4 disposal (rm -rf the ONE base removes ALL state),
//   E6 retired-aware availability (a re-assign excludes the retired identity),
//   + the real-stack round itself (real registry identity -> real kernel _lib node -> consumer).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let passed = 0;
function test(name, fn) { fn(); passed += 1; }

const HARNESS = path.resolve(__dirname, '..', '..', '..', '..', 'packages', 'lab', 'persona-consumer', '_spike', 'persona-consumer-round.js');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'w1-round-'));
const fakeHome = path.join(base, 'home');
// A CLEAN env with every state seam rooted under ONE base (incl. the identity store + spawn-state);
// snapshot overrides are intentionally absent so a dev's live-pointing env cannot escape.
const env = {
  PATH: process.env.PATH,
  HOME: fakeHome,
  LOOM_LAB_STATE_DIR: path.join(base, 'lab'),
  HETS_IDENTITY_STORE: path.join(base, 'id.json'),
  LOOM_SPAWN_STATE_DIR: path.join(base, 'spawn'),
};

const proc = spawnSync('node', [HARNESS], { env, encoding: 'utf8' });
const result = (() => { try { return JSON.parse(proc.stdout.trim().split('\n').pop()); } catch { return null; } })();

test('the real-stack round completes: real identity -> kernel _lib node -> mock signal -> recalibrate', () => {
  assert.strictEqual(proc.status, 0, `harness exited ${proc.status}; stderr: ${proc.stderr}`);
  assert.ok(result && result.ok, 'round ok');
  assert.ok(result.node_written && result.signal_written, 'real node + mock signal written');
  assert.strictEqual(result.recalibrated_persona, 'test-probe.t1', 'built_by adapter -> the recalibrated key');
  assert.strictEqual(result.posterior, 2 / 3, '1 support over the real node -> Beta posterior 2/3');
});

test('E6: a re-assign EXCLUDES the retired identity (retired is spawn-enforced)', () => {
  assert.strictEqual(result.e6_reassign_excluded_retired, true);
  assert.strictEqual(result.e6_reassigned, 't2', 'after retiring t1, assign picks t2');
});

test('E3 isolation (positive): every write landed UNDER the temp base', () => {
  for (const [k, dir] of Object.entries(result.store_dirs)) {
    assert.ok(dir.startsWith(base), `${k} dir (${dir}) must be under the temp base`);
  }
  assert.ok(fs.existsSync(path.join(base, 'lab', 'recall-graph-backtest', `${result.node_id}.json`)), 'node file in temp');
  assert.ok(fs.existsSync(path.join(base, 'id.json')), 'identity store in temp');
  const sigDir = path.join(base, 'lab', 'hardening-signals-mock');
  assert.ok(fs.existsSync(sigDir) && fs.readdirSync(sigDir).length === 1, 'one signal file in temp');
});

test('E3 isolation (negative, env-seam): NOTHING leaked to the seam-default (fake HOME/.claude)', () => {
  const realDefault = path.join(fakeHome, '.claude');
  // a store that ignored its env seam would write to homedir()/.claude/{lab-state,agent-identities.json}.
  // (`spawn-state` is forward-looking — cmdAssign writes none this round; kept for the W3 producer.)
  const leaked = fs.existsSync(realDefault)
    ? fs.readdirSync(realDefault).filter((n) => /lab-state|agent-identities|spawn-state/.test(n))
    : [];
  assert.deepStrictEqual(leaked, [], `no store may write under the default HOME/.claude; found: ${leaked}`);
});

test('E3c isolation (hard-coded-path): the round artifacts are ABSENT from the REAL ~/.claude (VALIDATE-reviewer HIGH)', () => {
  // The env-seam check above catches a store that falls back to homedir(); this catches a store that
  // ignores the seam with a LITERAL absolute path. Keyed on the round's UNIQUE artifacts (content-addressed
  // node_id + the unique test-persona token) so the running session's own ~/.claude writes can't make it flaky.
  const realClaude = path.join(os.homedir(), '.claude');
  const realNode = path.join(realClaude, 'lab-state', 'recall-graph-backtest', `${result.node_id}.json`);
  assert.ok(!fs.existsSync(realNode), 'the round node must NOT appear under the real ~/.claude (no abs-path leak)');
  const realIdStore = path.join(realClaude, 'agent-identities.json');
  if (fs.existsSync(realIdStore)) {
    assert.ok(!fs.readFileSync(realIdStore, 'utf8').includes('99-test-probe'), 'the real identity store must never gain the test persona');
  }
});

test('E4 disposal: rm -rf the ONE base removes ALL state, AND a fresh round re-runs clean', () => {
  fs.rmSync(base, { recursive: true, force: true });
  assert.ok(!fs.existsSync(base), 'base gone');
  for (const dir of Object.values(result.store_dirs)) assert.ok(!fs.existsSync(dir), `${dir} gone after disposal`);
  // re-run clean (E4's idempotency half): a fresh base + a fresh round must succeed from empty state.
  const base2 = fs.mkdtempSync(path.join(os.tmpdir(), 'w1-rerun-'));
  const env2 = { ...env, HOME: path.join(base2, 'home'), LOOM_LAB_STATE_DIR: path.join(base2, 'lab'), HETS_IDENTITY_STORE: path.join(base2, 'id.json'), LOOM_SPAWN_STATE_DIR: path.join(base2, 'spawn') };
  const p2 = spawnSync('node', [HARNESS], { env: env2, encoding: 'utf8' });
  const r2 = (() => { try { return JSON.parse(p2.stdout.trim().split('\n').pop()); } catch { return null; } })();
  assert.strictEqual(p2.status, 0, `re-run exited ${p2.status}; stderr: ${p2.stderr}`);
  assert.ok(r2 && r2.ok && r2.posterior === 2 / 3, 'a fresh round from empty state re-runs clean');
  fs.rmSync(base2, { recursive: true, force: true });
});

console.log(`round.test.js: ${passed} passed`);
