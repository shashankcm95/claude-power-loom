'use strict';

// tests/unit/lab/causal-edge/trajectory-friction-run.test.js — #412 the host-level-actor armed-refusal guard.
//
// runActorTrajectory is the SINGLE chokepoint every HOST-LEVEL (broker-reachable, uid-501) `claude -p` actor spawn
// funnels through (real-solve, earned-grounding-run, calibration-issue-run, spikes). The #412 guard refuses to run
// it while a live emit is ARMED, so a broker-reachable host actor can never run in a window where it could
// `sudo -n -u loom-broker` and mint an approval. The guard fires BEFORE any spawn, so this suite never touches the
// network/claude (it injects the arm-state via the isEmitArmedFn seam, or drives the env-convention default with a
// null claudeBin short-circuit). NON-VACUOUS: the refusal path is exercised RED via a simulated armed state.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const M = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'trajectory-friction-run.js'));
const { runActorTrajectory } = M;

let passed = 0; let failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function scratch(p) { return fs.mkdtempSync(path.join(os.tmpdir(), p)); }

// Capture stderr around fn(); restore unconditionally. Returns the joined output.
function captureStderr(fn) {
  const orig = process.stderr.write;
  const lines = [];
  process.stderr.write = (chunk) => { lines.push(String(chunk)); return true; };
  let ret; try { ret = fn(); } finally { process.stderr.write = orig; }
  return { ret, err: lines.join('') };
}

const REC = { id: 'owner/repo-issue-1', repo: 'https://github.com/owner/repo', problem_statement: 'x', base_sha: 'a'.repeat(40) };

test('#412 guard: isEmitArmedFn -> true REFUSES the host actor (no spawn) + emits one [LOOM-EGRESS-ALERT]', () => {
  // claudeBin:null would ALSO short-circuit, so to prove the GUARD (not the bin check) fires, pass a non-null
  // claudeBin the guard must reject BEFORE reaching: the refusal reason must be the guard's, never 'actor-unavailable'.
  const { ret, err } = captureStderr(() => runActorTrajectory({ record: REC, claudeBin: '/nonexistent/claude', isEmitArmedFn: () => true }));
  assert.strictEqual(ret.ok, false);
  assert.strictEqual(ret.reason, 'host-actor-refused-while-armed', `guard reason (got ${ret.reason})`);
  assert.deepStrictEqual(ret.events, [], 'no events on the refusal');
  assert.ok(err.startsWith('[LOOM-EGRESS-ALERT] '), 'the refusal is OBSERVABLE (fail-closed-observable)');
  const alertJson = JSON.parse(err.slice('[LOOM-EGRESS-ALERT] '.length).trim());
  assert.strictEqual(alertJson.reason, 'host-actor-refused-while-armed', 'the alert reason == the return reason (no detail-key clobber, CodeRabbit #422)');
});

test('#412 guard: isEmitArmedFn -> false does NOT refuse (normal short-circuit applies; claudeBin:null => actor-unavailable)', () => {
  const r = runActorTrajectory({ record: REC, claudeBin: null, isEmitArmedFn: () => false });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'actor-unavailable', 'not armed => the guard is a no-op; the existing bin short-circuit runs');
});

test('#412 guard: NO override — a truthy allowHostActorWhileArmed (or any extra opt) cannot re-enable the host actor when armed', () => {
  // The guard must be NON-BYPASSABLE (security.md): there is no caller flag that softens it.
  const r = runActorTrajectory({ record: REC, claudeBin: '/nonexistent/claude', isEmitArmedFn: () => true, allowHostActorWhileArmed: true, force: true });
  assert.strictEqual(r.reason, 'host-actor-refused-while-armed', 'no override re-enables the armed host actor');
});

test('#412 guard default (env-convention): LOOM_EGRESS_KILLSWITCH_PATH unset => fail-safe NOT armed (tests/shadow run)', () => {
  const saveKs = process.env.LOOM_EGRESS_KILLSWITCH_PATH; const saveDp = process.env.LOOM_EGRESS_DISPOSITION_PATH;
  delete process.env.LOOM_EGRESS_KILLSWITCH_PATH; delete process.env.LOOM_EGRESS_DISPOSITION_PATH;
  try {
    // no isEmitArmedFn injected => the default reads the env convention; unset => not armed => the bin:null short-circuit.
    const r = runActorTrajectory({ record: REC, claudeBin: null });
    assert.strictEqual(r.reason, 'actor-unavailable', 'unset env => not armed => guard no-op (existing behavior preserved)');
  } finally {
    if (saveKs === undefined) delete process.env.LOOM_EGRESS_KILLSWITCH_PATH; else process.env.LOOM_EGRESS_KILLSWITCH_PATH = saveKs;
    if (saveDp === undefined) delete process.env.LOOM_EGRESS_DISPOSITION_PATH; else process.env.LOOM_EGRESS_DISPOSITION_PATH = saveDp;
  }
});

test('#412 guard default (env-convention): an ARMED custody via the env vars REFUSES the host actor', () => {
  const saveKs = process.env.LOOM_EGRESS_KILLSWITCH_PATH; const saveDp = process.env.LOOM_EGRESS_DISPOSITION_PATH;
  const saveForce = process.env.LOOM_BETA_KILLSWITCH; delete process.env.LOOM_BETA_KILLSWITCH;
  const dir = scratch('loom-armed-env-');
  try {
    fs.writeFileSync(path.join(dir, 'killswitch'), 'ARMED');
    fs.writeFileSync(path.join(dir, 'disposition'), JSON.stringify({ mode: 'live', draft: false }));
    process.env.LOOM_EGRESS_KILLSWITCH_PATH = path.join(dir, 'killswitch');
    process.env.LOOM_EGRESS_DISPOSITION_PATH = path.join(dir, 'disposition');
    const { ret } = captureStderr(() => runActorTrajectory({ record: REC, claudeBin: '/nonexistent/claude' }));
    assert.strictEqual(ret.reason, 'host-actor-refused-while-armed', 'the env-convention default detects the armed custody and refuses');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    if (saveKs === undefined) delete process.env.LOOM_EGRESS_KILLSWITCH_PATH; else process.env.LOOM_EGRESS_KILLSWITCH_PATH = saveKs;
    if (saveDp === undefined) delete process.env.LOOM_EGRESS_DISPOSITION_PATH; else process.env.LOOM_EGRESS_DISPOSITION_PATH = saveDp;
    if (saveForce === undefined) delete process.env.LOOM_BETA_KILLSWITCH; else process.env.LOOM_BETA_KILLSWITCH = saveForce;
  }
});

test('#412 guard: a THROWING isEmitArmedFn fails CLOSED (refuses), never propagates / never proceeds to spawn (VALIDATE-hacker)', () => {
  const { ret } = captureStderr(() => runActorTrajectory({ record: REC, claudeBin: '/nonexistent/claude', isEmitArmedFn: () => { throw new Error('arm-check exploded'); } }));
  assert.strictEqual(ret.reason, 'host-actor-refused-while-armed', 'a guard that cannot decide must REFUSE (fail-closed), not throw or run');
});

test('#412 chokepoint invariant: the ONLY production lab modules that spawn a WRITE-capable claude actor are the two known sites', () => {
  // Converts the "all host actors funnel through runActorTrajectory" recon claim into a CI-enforced invariant
  // (VALIDATE-architect): if a NEW production module spawns a write-capable `claude -p` actor, it would bypass the
  // guard — this test fails until it is routed through runActorTrajectory (host) or runActorInContainer (contained).
  const LAB = path.join(REPO, 'packages', 'lab');
  const found = [];
  (function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) { if (ent.name !== 'node_modules' && ent.name !== '_spike') walk(p); continue; }
      if (!ent.name.endsWith('.js') || ent.name.endsWith('.test.js')) continue;
      const src = fs.readFileSync(p, 'utf8');
      const spawnsClaude = /spawnSync|child_process/.test(src) && /'-p'|"-p"/.test(src);
      const writeCapable = /'Edit'|'Write'|ACTOR_TOOLS/.test(src);
      if (spawnsClaude && writeCapable) found.push(path.relative(LAB, p));
    }
  }(LAB));
  found.sort();
  assert.deepStrictEqual(found, ['causal-edge/trajectory-friction-run.js', 'issue-corpus/docker-actor-backend.js'],
    `a NEW write-capable actor spawn would bypass the #412 guard — route it through runActorTrajectory / runActorInContainer (found: ${JSON.stringify(found)})`);
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== trajectory-friction-run.test.js: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
})();
