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
const { runActorTrajectory, defaultActorLauncher } = M;

// HERMETIC: neutralize the #412 PR-3 actor-launcher env for the whole suite so the routing default resolves to
// `direct` regardless of the host box (a box where the actor IS deployed has /etc/loom/actor-anthropic.key, which
// would otherwise flip the not-armed tests to `deployed-unconfigured`). Restored in the runner's finally.
const _ENV_KEYS = ['LOOM_ACTOR_USER', 'LOOM_ACTOR_WRAPPER', 'LOOM_ACTOR_REQUIRE_UID_SEP', 'LOOM_ACTOR_KEY_MARKER'];
const _ENV_SAVE = {};
for (const k of _ENV_KEYS) _ENV_SAVE[k] = process.env[k];
function neutralizeLauncherEnv() {
  delete process.env.LOOM_ACTOR_USER; delete process.env.LOOM_ACTOR_WRAPPER; delete process.env.LOOM_ACTOR_REQUIRE_UID_SEP;
  process.env.LOOM_ACTOR_KEY_MARKER = '/nonexistent/loom-actor-marker-hermetic';   // a guaranteed-absent marker => not deployed
}
function restoreLauncherEnv() { for (const k of _ENV_KEYS) { if (_ENV_SAVE[k] === undefined) delete process.env[k]; else process.env[k] = _ENV_SAVE[k]; } }
neutralizeLauncherEnv();

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

// ============================== #412 PR 3 — the actor routing seam ==============================

// run fn() with specific LOOM_ACTOR_* env, then restore the hermetic default.
function withActorEnv(over, fn) {
  const save = {}; for (const k of _ENV_KEYS) save[k] = process.env[k];
  try {
    for (const k of _ENV_KEYS) delete process.env[k];
    for (const [k, v] of Object.entries(over)) process.env[k] = v;
    return fn();
  } finally { for (const k of _ENV_KEYS) { if (save[k] === undefined) delete process.env[k]; else process.env[k] = save[k]; } }
}
// a spawnFn spy: records calls, returns a canned successful claude res.
function spySpawn() {
  const calls = [];
  const fn = (command, args, opts) => { calls.push({ command, args, opts }); return { status: 0, stdout: '{"type":"x"}\n' }; };
  fn.calls = calls; return fn;
}
const OK_MODEL = 'claude-sonnet-4-6';

test('PR3 defaultActorLauncher truth table — fail-closed polarity (empty/whitespace = unset; precedence pinned)', () => {
  const marker = scratch('loom-marker-'); const markerFile = path.join(marker, 'actor-anthropic.key');
  try {
    // both unset + no flag + no marker => direct (SHADOW)
    assert.deepStrictEqual(withActorEnv({ LOOM_ACTOR_KEY_MARKER: markerFile }, () => defaultActorLauncher()), { mode: 'direct' });
    // both set => cross-uid (right fields)
    assert.deepStrictEqual(withActorEnv({ LOOM_ACTOR_USER: 'loom-actor', LOOM_ACTOR_WRAPPER: '/usr/local/bin/loom-actor-run', LOOM_ACTOR_KEY_MARKER: markerFile }, () => defaultActorLauncher()),
      { mode: 'cross-uid', actorUser: 'loom-actor', wrapperPath: '/usr/local/bin/loom-actor-run' });
    // exactly one set => half-configured (each direction)
    assert.strictEqual(withActorEnv({ LOOM_ACTOR_USER: 'loom-actor', LOOM_ACTOR_KEY_MARKER: markerFile }, () => defaultActorLauncher()).reason, 'half-configured');
    assert.strictEqual(withActorEnv({ LOOM_ACTOR_WRAPPER: '/opt/w', LOOM_ACTOR_KEY_MARKER: markerFile }, () => defaultActorLauncher()).reason, 'half-configured');
    // present-but-EMPTY / whitespace wrapper with a set user => half-configured (empty treated as unset => exactly-one)
    assert.strictEqual(withActorEnv({ LOOM_ACTOR_USER: 'loom-actor', LOOM_ACTOR_WRAPPER: '', LOOM_ACTOR_KEY_MARKER: markerFile }, () => defaultActorLauncher()).reason, 'half-configured');
    assert.strictEqual(withActorEnv({ LOOM_ACTOR_USER: 'loom-actor', LOOM_ACTOR_WRAPPER: '   ', LOOM_ACTOR_KEY_MARKER: markerFile }, () => defaultActorLauncher()).reason, 'half-configured');
    // both empty + explicit flag => deployed-unconfigured (fail closed, the PRIMARY signal) — boolean-normalized:
    // a typo'd truthy spelling must STILL fail closed, never silently run as 501 (VALIDATE-hacker M1).
    for (const v of ['1', 'true', 'TRUE', 'yes', 'on', ' 1 ']) {
      assert.strictEqual(withActorEnv({ LOOM_ACTOR_REQUIRE_UID_SEP: v, LOOM_ACTOR_KEY_MARKER: markerFile }, () => defaultActorLauncher()).reason, 'deployed-unconfigured', `flag '${v}' => deployed-unconfigured`);
    }
    // a NON-truthy flag (no marker) => direct (the flag genuinely off)
    assert.deepStrictEqual(withActorEnv({ LOOM_ACTOR_REQUIRE_UID_SEP: '0', LOOM_ACTOR_KEY_MARKER: markerFile }, () => defaultActorLauncher()), { mode: 'direct' });
    // both empty + marker file present => deployed-unconfigured (the backstop)
    fs.writeFileSync(markerFile, 'k');
    assert.strictEqual(withActorEnv({ LOOM_ACTOR_KEY_MARKER: markerFile }, () => defaultActorLauncher()).reason, 'deployed-unconfigured');
    // marker present BUT half-config => half-configured wins (presence checked FIRST)
    assert.strictEqual(withActorEnv({ LOOM_ACTOR_USER: 'loom-actor', LOOM_ACTOR_KEY_MARKER: markerFile }, () => defaultActorLauncher()).reason, 'half-configured');
  } finally { fs.rmSync(marker, { recursive: true, force: true }); }
});

test('PR3 seam: direct mode => spawnFn called with the LEGACY argv (byte-identity SHOWN, not stated)', () => {
  const spy = spySpawn();
  const r = runActorTrajectory({ record: REC, claudeBin: '/stub/claude', model: OK_MODEL, isEmitArmedFn: () => false, actorLauncherFn: () => ({ mode: 'direct' }), spawnFn: spy });
  assert.strictEqual(spy.calls.length, 1, 'exactly one spawn');
  assert.strictEqual(spy.calls[0].command, '/stub/claude');
  assert.deepStrictEqual(spy.calls[0].args, ['-p', '--output-format', 'stream-json', '--verbose', '--model', OK_MODEL, '--allowedTools', 'Read,Grep,Glob,Edit,Write,Bash']);
  assert.strictEqual(spy.calls[0].opts.shell, false);
  assert.ok(typeof spy.calls[0].opts.input === 'string' && spy.calls[0].opts.input.includes('ISSUE'), 'the prompt rides stdin in direct mode too (not argv)');
  assert.strictEqual(r.ok, true);
});

test('PR3 seam: an UNRECOGNIZED launch mode FAILS CLOSED (never silently runs as 501)', () => {
  const spy = spySpawn();
  const { ret } = captureStderr(() => runActorTrajectory({ record: REC, claudeBin: '/stub/claude', isEmitArmedFn: () => false, actorLauncherFn: () => ({ mode: 'suspend' }), spawnFn: spy }));
  assert.strictEqual(ret.ok, false);
  assert.strictEqual(ret.reason, 'actor-launch-unknown-mode', 'an unknown mode must fail closed, not default to direct');
  assert.strictEqual(spy.calls.length, 0, 'no spawn on an unknown mode');
  // a null/garbage launcher result also fails closed (launch || {} => mode undefined => unknown-mode)
  const spy2 = spySpawn();
  const r2 = captureStderr(() => runActorTrajectory({ record: REC, claudeBin: '/stub/claude', isEmitArmedFn: () => false, actorLauncherFn: () => null, spawnFn: spy2 })).ret;
  assert.strictEqual(r2.reason, 'actor-launch-unknown-mode', 'a null launcher result fails closed too');
  assert.strictEqual(spy2.calls.length, 0);
});

test('PR3 seam: cross-uid mode => spawnFn called with the sudo crossUidActorArgs argv (prompt on stdin, NOT argv)', () => {
  const spy = spySpawn();
  const r = runActorTrajectory({ record: REC, model: OK_MODEL, isEmitArmedFn: () => false,
    actorLauncherFn: () => ({ mode: 'cross-uid', actorUser: 'loom-actor', wrapperPath: '/usr/local/bin/loom-actor-run' }), spawnFn: spy });
  assert.strictEqual(spy.calls[0].command, 'sudo');
  assert.deepStrictEqual(spy.calls[0].args, ['-n', '-u', 'loom-actor', '/usr/local/bin/loom-actor-run', OK_MODEL]);
  assert.ok(typeof spy.calls[0].opts.input === 'string' && spy.calls[0].opts.input.includes('ISSUE'), 'the prompt rides stdin (opts.input), never argv');
  assert.ok(!spy.calls[0].args.some((a) => a.includes('ISSUE')), 'the prompt is NEVER an argv element');
  assert.strictEqual(r.ok, true);
});

test('PR3 seam: refuse mode => {ok:false, actor-launch-refused} + alert carries launchMode (sub-reason survives) + NO spawn', () => {
  const spy = spySpawn();
  const { ret, err } = captureStderr(() => runActorTrajectory({ record: REC, isEmitArmedFn: () => false, actorLauncherFn: () => ({ mode: 'refuse', reason: 'deployed-unconfigured' }), spawnFn: spy }));
  assert.strictEqual(ret.ok, false);
  assert.strictEqual(ret.reason, 'actor-launch-refused');
  assert.strictEqual(spy.calls.length, 0, 'no spawn on a refuse');
  const alert = JSON.parse(err.slice('[LOOM-EGRESS-ALERT] '.length).trim());
  assert.strictEqual(alert.reason, 'actor-launch-refused', 'positional reason wins (clobber-safe)');
  assert.strictEqual(alert.launchMode, 'deployed-unconfigured', 'the sub-reason survives under a non-reason key');
});

test('PR3 seam: a THROWING crossUidActorArgs (bad wrapper) FAILS CLOSED to actor-launch-build-failed, never throws', () => {
  const spy = spySpawn();
  const { ret } = captureStderr(() => runActorTrajectory({ record: REC, model: OK_MODEL, isEmitArmedFn: () => false,
    actorLauncherFn: () => ({ mode: 'cross-uid', actorUser: 'loom-actor', wrapperPath: '/opt/../etc/evil' }), spawnFn: spy }));   // dotdot => crossUidActorArgs throws
  assert.strictEqual(ret.ok, false);
  assert.strictEqual(ret.reason, 'actor-launch-build-failed', 'a build throw is caught + mapped fail-closed, not propagated');
  assert.strictEqual(spy.calls.length, 0, 'no spawn when the argv build failed');
});

test('PR3 ordering invariant: armed => NEITHER the launcher NOR spawnFn is invoked (de-correlation guard)', () => {
  const spy = spySpawn(); let launcherCalls = 0;
  const { ret } = captureStderr(() => runActorTrajectory({ record: REC, claudeBin: '/stub/claude', isEmitArmedFn: () => true,
    actorLauncherFn: () => { launcherCalls += 1; return { mode: 'direct' }; }, spawnFn: spy }));
  assert.strictEqual(ret.reason, 'host-actor-refused-while-armed');
  assert.strictEqual(launcherCalls, 0, 'the launcher is NEVER resolved while armed (#422 stays first)');
  assert.strictEqual(spy.calls.length, 0, 'NO spawn while armed');
});

(async () => {
  try {
    for (const { name, fn } of tests) {
      try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
      catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
    }
  } finally { restoreLauncherEnv(); }
  process.stdout.write(`\n=== trajectory-friction-run.test.js: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
})();
