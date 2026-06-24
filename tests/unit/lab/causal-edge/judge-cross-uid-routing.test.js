'use strict';

// tests/unit/lab/causal-edge/judge-cross-uid-routing.test.js — #430 PR-2: the cross-uid JUDGE routing seam.
// Covers the shared leaf (resolveCrossUidPresence / defaultJudgeLauncher / resolveJudgeLaunch / normalizeBool) +
// the four chokepoints routing through it. The disarmed-window structural close: when uid-611 is deployed + the
// operator has confirmed the wrapper is judge-aware (LOOM_JUDGE_REQUIRE_UID_SEP), the host judge/labeler/deriver
// run as the NON-allowlisted loom-actor uid (so a prompt-injected judge cannot sudo -u loom-broker + mint). The
// polarity is FAIL-CLOSED-on-deployed (VERIFY architect #2: a judge-flag-set + presence-unset box must REFUSE,
// never silently run as 501). The armed guard (PR-1) still precedes routing (hacker M1: armed => neither the
// launcher nor the spawn is reached).

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const G = require(path.join(REPO, 'packages', 'lab', '_lib', 'host-claude-guard.js'));
const CE = path.join(REPO, 'packages', 'lab', 'causal-edge');
const friction = require(path.join(CE, 'trajectory-friction-run.js'));
const calibIssue = require(path.join(CE, 'calibration-issue-run.js'));
const calibRun = require(path.join(CE, 'calibration-run.js'));
const lesson = require(path.join(CE, '_spike', 'lesson-capture-rerun.js'));

let passed = 0; let failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function captureStderr(fn) {
  const orig = process.stderr.write; const lines = [];
  process.stderr.write = (chunk) => { lines.push(String(chunk)); return true; };
  let ret; try { ret = fn(); } finally { process.stderr.write = orig; }
  return { ret, err: lines.join('') };
}
function spySpawn(stdout) {
  const calls = [];
  const fn = (command, args, opts) => { calls.push({ command, args, opts }); return { status: 0, stdout: stdout || '{"supported":true}\n' }; };
  fn.calls = calls; return fn;
}
// run fn with the given env keys SET (others among the launcher-read set DELETED), restore after.
const ENV_KEYS = ['LOOM_ACTOR_USER', 'LOOM_ACTOR_WRAPPER', 'LOOM_JUDGE_REQUIRE_UID_SEP', 'LOOM_ACTOR_REQUIRE_UID_SEP', 'LOOM_ACTOR_KEY_MARKER'];
function withEnv(set, fn) {
  const saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  // point the marker at a definitely-absent path unless the case overrides it (so a real /etc/loom file can't leak in)
  process.env.LOOM_ACTOR_KEY_MARKER = '/nonexistent/loom/actor-marker-test';
  for (const [k, v] of Object.entries(set)) process.env[k] = v;
  try { return fn(); } finally {
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}
const USER = 'loom-actor'; const WRAP = '/usr/local/bin/loom-actor-run';

// ---------------------------------------------------------------------------
// normalizeBool + resolveCrossUidPresence (pure)
// ---------------------------------------------------------------------------

test('normalizeBool (STRICT, enables cross-uid): valid truthy + real booleans => true; a typo / falsey => false', () => {
  for (const v of ['1', 'true', 'TRUE', ' yes ', 'On', true]) assert.strictEqual(G.normalizeBool(v), true, `truthy: ${JSON.stringify(v)}`);
  for (const v of ['0', 'false', 'no', '', '  ', 'tru', 'ture', 'enabled', undefined, null, 2, false]) assert.strictEqual(G.normalizeBool(v), false, `falsey: ${JSON.stringify(v)}`);
});

test('isDeployFlagSet (LENIENT, fail-closed direction): a TYPO counts as deployed; only explicit-falsey/unset is off', () => {
  for (const v of ['1', 'true', 'on', 'ture', 'enabled', 'yes please', '2', true]) assert.strictEqual(G.isDeployFlagSet(v), true, `set: ${JSON.stringify(v)}`);
  for (const v of ['0', 'false', 'no', 'off', '', '  ', undefined, null, false]) assert.strictEqual(G.isDeployFlagSet(v), false, `not-set: ${JSON.stringify(v)}`);
});

test('resolveCrossUidPresence: present / half-configured / deployed-unconfigured / clean', () => {
  assert.deepStrictEqual(G.resolveCrossUidPresence({ actorUser: USER, wrapperPath: WRAP, deployedSignal: false }), { mode: 'present', actorUser: USER, wrapperPath: WRAP });
  assert.strictEqual(G.resolveCrossUidPresence({ actorUser: USER, wrapperPath: '', deployedSignal: true }).mode, 'half-configured');
  assert.strictEqual(G.resolveCrossUidPresence({ actorUser: '', wrapperPath: WRAP, deployedSignal: true }).mode, 'half-configured');
  assert.strictEqual(G.resolveCrossUidPresence({ actorUser: '  ', wrapperPath: '  ', deployedSignal: true }).mode, 'deployed-unconfigured', 'whitespace = unset');
  assert.strictEqual(G.resolveCrossUidPresence({ deployedSignal: false }).mode, 'clean');
});

// ---------------------------------------------------------------------------
// defaultJudgeLauncher — the FAIL-CLOSED-on-deployed polarity truth table
// ---------------------------------------------------------------------------

test('judge launcher: presence pair + judge flag truthy => cross-uid', () => {
  for (const flag of ['1', 'true', 'yes', 'on']) {
    const r = withEnv({ LOOM_ACTOR_USER: USER, LOOM_ACTOR_WRAPPER: WRAP, LOOM_JUDGE_REQUIRE_UID_SEP: flag }, () => G.defaultJudgeLauncher());
    assert.deepStrictEqual(r, { mode: 'cross-uid', actorUser: USER, wrapperPath: WRAP }, `flag ${flag} => cross-uid`);
  }
});

test('judge launcher: presence pair but judge flag NOT truthy => refuse:judge-wrapper-unconfirmed (old wrapper guard)', () => {
  for (const flag of ['0', 'false', '', 'typo']) {
    const r = withEnv({ LOOM_ACTOR_USER: USER, LOOM_ACTOR_WRAPPER: WRAP, LOOM_JUDGE_REQUIRE_UID_SEP: flag }, () => G.defaultJudgeLauncher());
    assert.strictEqual(r.mode, 'refuse');
    assert.strictEqual(r.reason, 'judge-wrapper-unconfirmed', `flag ${JSON.stringify(flag)} => unconfirmed`);
  }
  // also: presence pair, judge flag entirely UNSET
  const r2 = withEnv({ LOOM_ACTOR_USER: USER, LOOM_ACTOR_WRAPPER: WRAP }, () => G.defaultJudgeLauncher());
  assert.strictEqual(r2.reason, 'judge-wrapper-unconfirmed');
});

test('judge launcher: exactly one of user/wrapper => refuse:half-configured', () => {
  assert.strictEqual(withEnv({ LOOM_ACTOR_USER: USER, LOOM_JUDGE_REQUIRE_UID_SEP: '1' }, () => G.defaultJudgeLauncher()).reason, 'half-configured');
  assert.strictEqual(withEnv({ LOOM_ACTOR_WRAPPER: WRAP, LOOM_JUDGE_REQUIRE_UID_SEP: '1' }, () => G.defaultJudgeLauncher()).reason, 'half-configured');
  // a present-but-EMPTY wrapper with a set user => half-configured (empty treated as unset)
  assert.strictEqual(withEnv({ LOOM_ACTOR_USER: USER, LOOM_ACTOR_WRAPPER: '   ', LOOM_JUDGE_REQUIRE_UID_SEP: '1' }, () => G.defaultJudgeLauncher()).reason, 'half-configured');
});

test('judge launcher (architect #2): judge flag set but presence pair UNSET => refuse:deployed-unconfigured (NEVER direct/501)', () => {
  const r = withEnv({ LOOM_JUDGE_REQUIRE_UID_SEP: '1' }, () => G.defaultJudgeLauncher());
  assert.strictEqual(r.mode, 'refuse');
  assert.strictEqual(r.reason, 'deployed-unconfigured', 'a judge-flag-only box must fail CLOSED, not run as 501');
});

test('judge launcher (CodeRabbit major): a TYPO\'d flag fails CLOSED, never silent-direct', () => {
  // typo + presence UNSET => deployed-unconfigured (was fail-OPEN to direct under the strict normalizeBool deployed-signal)
  assert.strictEqual(withEnv({ LOOM_JUDGE_REQUIRE_UID_SEP: 'ture' }, () => G.defaultJudgeLauncher()).reason, 'deployed-unconfigured');
  assert.strictEqual(withEnv({ LOOM_ACTOR_REQUIRE_UID_SEP: 'enabled' }, () => G.defaultJudgeLauncher()).reason, 'deployed-unconfigured');
  // typo + presence SET => judge-wrapper-unconfirmed (judgeAware stays STRICT — a typo does NOT enable cross-uid)
  assert.strictEqual(withEnv({ LOOM_ACTOR_USER: USER, LOOM_ACTOR_WRAPPER: WRAP, LOOM_JUDGE_REQUIRE_UID_SEP: 'ture' }, () => G.defaultJudgeLauncher()).reason, 'judge-wrapper-unconfirmed');
  // an EXPLICIT-falsey flag (no other signal) stays direct — a typo is not the same as 'off'
  assert.deepStrictEqual(withEnv({ LOOM_JUDGE_REQUIRE_UID_SEP: 'off' }, () => G.defaultJudgeLauncher()), { mode: 'direct' });
});

test('judge launcher: both unset + ANY deployed-signal (actor flag OR marker) => refuse:deployed-unconfigured', () => {
  assert.strictEqual(withEnv({ LOOM_ACTOR_REQUIRE_UID_SEP: '1' }, () => G.defaultJudgeLauncher()).reason, 'deployed-unconfigured');
  // the marker backstop: point it at THIS test file (a path that definitely exists)
  assert.strictEqual(withEnv({ LOOM_ACTOR_KEY_MARKER: __filename }, () => G.defaultJudgeLauncher()).reason, 'deployed-unconfigured');
});

test('judge launcher: clean box (nothing set, no marker) => direct (the common dev/CI/shadow case)', () => {
  assert.deepStrictEqual(withEnv({}, () => G.defaultJudgeLauncher()), { mode: 'direct' });
});

// ---------------------------------------------------------------------------
// resolveJudgeLaunch — the routing seam (fail-closed on throw / unknown / build-fail)
// ---------------------------------------------------------------------------

test('resolveJudgeLaunch: direct launcher => {mode:direct}', () => {
  assert.deepStrictEqual(G.resolveJudgeLaunch({ judgeLauncherFn: () => ({ mode: 'direct' }) }), { mode: 'direct' });
});

test('resolveJudgeLaunch: cross-uid => builds the validated --loom-judge argv via crossUidJudgeArgs', () => {
  const r = G.resolveJudgeLaunch({ judgeLauncherFn: () => ({ mode: 'cross-uid', actorUser: USER, wrapperPath: WRAP }) });
  assert.strictEqual(r.mode, 'cross-uid');
  assert.strictEqual(r.command, 'sudo');
  assert.deepStrictEqual(r.args, ['-n', '-u', USER, WRAP, '--loom-judge']);
});

test('resolveJudgeLaunch: a launcher that THROWS => fail-closed refuse:judge-launch-resolver-threw', () => {
  const r = G.resolveJudgeLaunch({ judgeLauncherFn: () => { throw new Error('boom'); } });
  assert.deepStrictEqual(r, { mode: 'refuse', reason: 'judge-launch-resolver-threw' });
});

test('resolveJudgeLaunch: an UNKNOWN mode => fail-closed refuse:judge-launch-unknown-mode', () => {
  const { ret } = captureStderr(() => G.resolveJudgeLaunch({ judgeLauncherFn: () => ({ mode: 'wat' }) }));
  assert.strictEqual(ret.mode, 'refuse');
  assert.strictEqual(ret.reason, 'judge-launch-unknown-mode');
});

test('resolveJudgeLaunch: cross-uid with a BAD actorUser (crossUidJudgeArgs throws) => refuse:judge-launch-build-failed', () => {
  const { ret } = captureStderr(() => G.resolveJudgeLaunch({ judgeLauncherFn: () => ({ mode: 'cross-uid', actorUser: '-x', wrapperPath: WRAP }) }));
  assert.strictEqual(ret.mode, 'refuse');
  assert.strictEqual(ret.reason, 'judge-launch-build-failed');
});

test('resolveJudgeLaunch: an explicit refuse passes the sub-reason through', () => {
  const { ret } = captureStderr(() => G.resolveJudgeLaunch({ judgeLauncherFn: () => ({ mode: 'refuse', reason: 'deployed-unconfigured' }) }));
  assert.deepStrictEqual(ret, { mode: 'refuse', reason: 'deployed-unconfigured' });
});

// ---------------------------------------------------------------------------
// the four chokepoints routing through resolveJudgeLaunch (the security payoff)
// ---------------------------------------------------------------------------

const NOT_ARMED = () => false; const ARMED = () => true;
const CROSS = () => ({ mode: 'cross-uid', actorUser: USER, wrapperPath: WRAP });
const REFUSE = () => ({ mode: 'refuse', reason: 'deployed-unconfigured' });
const EDGE = { relation: 'depends_on', source_block: 'a', target_block: 'b' };

// the three claudeOnce chokepoints (opts position differs: friction/calib = arg6; lesson = arg4)
const ONCE = [
  { label: 'friction-labeler', call: (opts) => friction.claudeOnce('/stub/claude', 'attacker prompt', 1000, [], null, opts) },
  { label: 'calibration-judge', call: (opts) => calibIssue.claudeOnce('/stub/claude', 'attacker prompt', 1000, [], null, opts) },
  { label: 'lesson-deriver', call: (opts) => lesson.claudeOnce('/stub/claude', 'attacker prompt', 1000, opts) },
];

for (const { label, call } of ONCE) {
  test(`${label}: CROSS-UID => spawns sudo ... --loom-judge with the prompt on STDIN (never /stub/claude, never argv)`, () => {
    const spy = spySpawn();
    call({ isEmitArmedFn: NOT_ARMED, spawnFn: spy, judgeLauncherFn: CROSS });
    assert.strictEqual(spy.calls.length, 1, `${label}: one spawn`);
    assert.strictEqual(spy.calls[0].command, 'sudo', `${label}: routed through sudo, not /stub/claude`);
    assert.deepStrictEqual(spy.calls[0].args, ['-n', '-u', USER, WRAP, '--loom-judge'], `${label}: exact --loom-judge argv (no model/extraArg)`);
    assert.strictEqual(spy.calls[0].opts.input, 'attacker prompt', `${label}: prompt on STDIN`);
  });
  test(`${label}: REFUSE => fail-closed {ok:false, deployed-unconfigured} + NO spawn`, () => {
    const spy = spySpawn();
    const { ret } = captureStderr(() => call({ isEmitArmedFn: NOT_ARMED, spawnFn: spy, judgeLauncherFn: REFUSE }));
    assert.strictEqual(ret.ok, false);
    assert.strictEqual(ret.reason, 'deployed-unconfigured');
    assert.strictEqual(spy.calls.length, 0, `${label}: no spawn on refuse`);
  });
  test(`${label}: ARMED beats routing — neither the launcher NOR the spawn is reached (hacker M1)`, () => {
    const spy = spySpawn();
    let launcherCalls = 0;
    const launcherSpy = () => { launcherCalls += 1; return { mode: 'cross-uid', actorUser: USER, wrapperPath: WRAP }; };
    const { ret } = captureStderr(() => call({ isEmitArmedFn: ARMED, spawnFn: spy, judgeLauncherFn: launcherSpy }));
    assert.strictEqual(ret.ok, false);
    assert.strictEqual(ret.reason, 'host-judge-refused-while-armed');
    assert.strictEqual(launcherCalls, 0, `${label}: launcher NOT consulted while armed (de-correlation)`);
    assert.strictEqual(spy.calls.length, 0, `${label}: NO spawn while armed`);
  });
}

// claudePJudge (rung-2) — the stdin-normalize + cross-uid + refuse
test('rung2-judge: DIRECT now rides the prompt on STDIN with args=[-p] (the PR-2 stdin-normalize, not a positional)', () => {
  const spy = spySpawn('{"supported":true}\n');
  const judge = calibRun.makeClaudePJudge({ bin: '/stub/claude', promptSpec: 'JUDGE-SPEC', isEmitArmedFn: NOT_ARMED, spawnFn: spy, judgeLauncherFn: () => ({ mode: 'direct' }) });
  judge(EDGE);
  assert.strictEqual(spy.calls.length, 1);
  assert.deepStrictEqual(spy.calls[0].args, ['-p'], 'no model set => exactly [-p], the prompt is NOT a positional');
  assert.ok(typeof spy.calls[0].opts.input === 'string' && spy.calls[0].opts.input.includes('JUDGE-SPEC'), 'prompt on STDIN');
  assert.ok(!spy.calls[0].args.some((a) => a.includes('JUDGE-SPEC')), 'the prompt never rides argv');
});

test('rung2-judge: DIRECT with a model => args=[-p,--model,<m>] + prompt on stdin', () => {
  const spy = spySpawn('{"supported":true}\n');
  const judge = calibRun.makeClaudePJudge({ bin: '/stub/claude', promptSpec: 's', model: 'claude-opus-4-8', isEmitArmedFn: NOT_ARMED, spawnFn: spy, judgeLauncherFn: () => ({ mode: 'direct' }) });
  judge(EDGE);
  assert.deepStrictEqual(spy.calls[0].args, ['-p', '--model', 'claude-opus-4-8']);
});

test('rung2-judge: toolless:true pins the tool-less recipe in the DIRECT path (B superset A)', () => {
  const spy = spySpawn('{"supported":true}\n');
  const judge = calibRun.makeClaudePJudge({ bin: '/stub/claude', promptSpec: 's', toolless: true, isEmitArmedFn: NOT_ARMED, spawnFn: spy, judgeLauncherFn: () => ({ mode: 'direct' }) });
  judge(EDGE);
  assert.deepStrictEqual(spy.calls[0].args, ['-p', '--tools', '', '--strict-mcp-config', '--disallowedTools', 'LSP']);
});

test('rung2-judge: CROSS-UID => sudo ... --loom-judge + prompt on STDIN (never the bin, never argv)', () => {
  const spy = spySpawn('{"supported":true}\n');
  const judge = calibRun.makeClaudePJudge({ bin: '/stub/claude', promptSpec: 'JUDGE-SPEC', isEmitArmedFn: NOT_ARMED, spawnFn: spy, judgeLauncherFn: CROSS });
  judge(EDGE);
  assert.strictEqual(spy.calls[0].command, 'sudo');
  assert.deepStrictEqual(spy.calls[0].args, ['-n', '-u', USER, WRAP, '--loom-judge']);
  assert.ok(spy.calls[0].opts.input.includes('JUDGE-SPEC'), 'prompt on STDIN');
});

test('rung2-judge: REFUSE => {supported:false, deployed-unconfigured} + NO spawn', () => {
  const spy = spySpawn();
  const judge = calibRun.makeClaudePJudge({ bin: '/stub/claude', promptSpec: 's', isEmitArmedFn: NOT_ARMED, spawnFn: spy, judgeLauncherFn: REFUSE });
  const { ret } = captureStderr(() => judge(EDGE));
  assert.strictEqual(ret.supported, false);
  assert.strictEqual(ret.fallback_reason, 'deployed-unconfigured');
  assert.strictEqual(spy.calls.length, 0);
});

test('rung2-judge: ARMED beats routing — launcher + spawn both unreached', () => {
  const spy = spySpawn();
  let launcherCalls = 0;
  const judge = calibRun.makeClaudePJudge({ bin: '/stub/claude', promptSpec: 's', isEmitArmedFn: ARMED, spawnFn: spy, judgeLauncherFn: () => { launcherCalls += 1; return CROSS(); } });
  const { ret } = captureStderr(() => judge(EDGE));
  assert.strictEqual(ret.fallback_reason, 'host-judge-refused-while-armed');
  assert.strictEqual(launcherCalls, 0);
  assert.strictEqual(spy.calls.length, 0);
});

// the deriver's claudeOnce gained maxBudgetUsd parity (VALIDATE code-reviewer MEDIUM)
test('lesson-deriver claudeOnce: DIRECT path appends --max-budget-usd when finite (cost-cap parity)', () => {
  const spy = spySpawn('{"trigger_class":"x"}\n');
  lesson.claudeOnce('/stub/claude', 'p', 1000, { isEmitArmedFn: NOT_ARMED, spawnFn: spy, judgeLauncherFn: () => ({ mode: 'direct' }), extraArgs: [], maxBudgetUsd: 0.25 });
  assert.deepStrictEqual(spy.calls[0].args, ['-p', '--model', 'claude-sonnet-4-6', '--max-budget-usd', '0.25']);
});

test('lesson-deriver claudeOnce: DIRECT path with toolless extraArgs + budget composes in order', () => {
  const spy = spySpawn('{"trigger_class":"x"}\n');
  lesson.claudeOnce('/stub/claude', 'p', 1000, { isEmitArmedFn: NOT_ARMED, spawnFn: spy, judgeLauncherFn: () => ({ mode: 'direct' }), extraArgs: ['--tools', '', '--strict-mcp-config', '--disallowedTools', 'LSP'], maxBudgetUsd: 0.25 });
  assert.deepStrictEqual(spy.calls[0].args, ['-p', '--model', 'claude-sonnet-4-6', '--tools', '', '--strict-mcp-config', '--disallowedTools', 'LSP', '--max-budget-usd', '0.25']);
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== judge-cross-uid-routing.test.js: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
})();
