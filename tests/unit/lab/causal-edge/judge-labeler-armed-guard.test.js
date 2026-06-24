'use strict';

// tests/unit/lab/causal-edge/judge-labeler-armed-guard.test.js — #430 PR-1: the armed-window guard on the FOUR
// host-side judge/labeler/deriver `claude -p` chokepoints (the #412 follow-on for the non-actor host spawns).
// Each refuses to spawn while a live emit is ARMED — a prompt-injected judge reaching a shell as uid-501 could
// `sudo -n -u loom-broker` and mint an approval. NON-VACUOUS: a mocked-armed source drives the RED refusal AND a
// spawnFn spy proves NO spawn fires; the not-armed path proves the spawn still runs (byte-identity preserved).

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
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
const ARMED = () => true; const NOT_ARMED = () => false;
const GUARD_REASON = 'host-judge-refused-while-armed';

// --- the three claudeOnce chokepoints (opts position differs: friction/calib = arg6; lesson = arg4) ---
const ONCE = [
  { label: 'friction-labeler', call: (opts) => friction.claudeOnce('/stub/claude', 'attacker prompt', 1000, [], null, opts) },
  { label: 'calibration-judge (leg B + leg C)', call: (opts) => calibIssue.claudeOnce('/stub/claude', 'attacker prompt', 1000, [], null, opts) },
  { label: 'lesson-deriver', call: (opts) => lesson.claudeOnce('/stub/claude', 'attacker prompt', 1000, opts) },
];

for (const { label, call } of ONCE) {
  test(`${label}: ARMED => fail-closed {ok:false, ${GUARD_REASON}} + NO spawn (non-vacuity)`, () => {
    const spy = spySpawn();
    const { ret } = captureStderr(() => call({ isEmitArmedFn: ARMED, spawnFn: spy }));
    assert.strictEqual(ret.ok, false, `${label} refuses`);
    assert.strictEqual(ret.reason, GUARD_REASON, `${label} returns the guard reason (got ${ret.reason})`);
    assert.strictEqual(spy.calls.length, 0, `${label}: NO spawn while armed`);
  });
  test(`${label}: NOT armed => the spawn runs with prompt on STDIN (byte-identity preserved)`, () => {
    const spy = spySpawn();
    const r = call({ isEmitArmedFn: NOT_ARMED, spawnFn: spy });
    assert.strictEqual(spy.calls.length, 1, `${label}: spawn runs when not armed`);
    assert.strictEqual(spy.calls[0].command, '/stub/claude');
    assert.ok(spy.calls[0].args.includes('-p'), `${label}: -p present`);
    assert.strictEqual(spy.calls[0].opts.input, 'attacker prompt', `${label}: prompt on stdin (opts.input)`);
    assert.strictEqual(r.ok, true, `${label}: ok on a clean run`);
  });
}

// --- claudePJudge (rung-2 semantic judge) via makeClaudePJudge ---
const EDGE = { relation: 'depends_on', source_block: 'a', target_block: 'b' };

test('rung2-judge (claudePJudge): ARMED => fail-closed {supported:false, host-judge-refused-while-armed} + NO spawn', () => {
  const spy = spySpawn();
  const judge = calibRun.makeClaudePJudge({ bin: '/stub/claude', promptSpec: 'judge spec', isEmitArmedFn: ARMED, spawnFn: spy });
  const { ret } = captureStderr(() => judge(EDGE));
  assert.strictEqual(ret.supported, false);
  assert.strictEqual(ret.fallback_reason, GUARD_REASON, `claudePJudge returns the guard reason (got ${ret.fallback_reason})`);
  assert.strictEqual(spy.calls.length, 0, 'claudePJudge: NO spawn while armed');
});

test('rung2-judge (claudePJudge): NOT armed => the spawn runs + parses the verdict (existing behavior preserved)', () => {
  const spy = spySpawn('{"supported":true,"reason":"ok"}\n');
  const judge = calibRun.makeClaudePJudge({ bin: '/stub/claude', promptSpec: 'judge spec', isEmitArmedFn: NOT_ARMED, spawnFn: spy });
  const r = judge(EDGE);
  assert.strictEqual(spy.calls.length, 1, 'claudePJudge: spawn runs when not armed');
  assert.strictEqual(spy.calls[0].command, '/stub/claude');
  assert.strictEqual(r.supported, true, 'the verdict parses on a clean run');
});

test('all four chokepoints share the SAME guard reason (the polarity lives in one leaf)', () => {
  const reasons = new Set();
  for (const { call } of ONCE) { const { ret } = captureStderr(() => call({ isEmitArmedFn: ARMED, spawnFn: spySpawn() })); reasons.add(ret.reason); }
  const judge = calibRun.makeClaudePJudge({ bin: '/stub/claude', promptSpec: 's', isEmitArmedFn: ARMED, spawnFn: spySpawn() });
  reasons.add(captureStderr(() => judge(EDGE)).ret.fallback_reason);
  assert.deepStrictEqual([...reasons], [GUARD_REASON], 'one shared guard reason across all four');
});

test('CI invariant: every host-side `claude -p` spawn in packages/lab is GUARDED (host-claude-guard) or explicitly allowlisted', () => {
  // Converts the #430 four-chokepoint recon into a MAINTAINED guarantee (mirrors the #412 write-capable-actor
  // invariant in trajectory-friction-run.test.js): a NEW host-side `claude -p` judge/labeler/deriver spawn MUST
  // route through assertHostClaudeAllowed, or be on the allowlist below WITH a reason. Walks _spike too (the 4th
  // chokepoint lives there). A failure here means a new spawn re-opened the armed-window mint vector unguarded.
  const LAB = path.join(REPO, 'packages', 'lab');
  const ALLOW = {
    'issue-corpus/docker-actor-backend.js': 'CONTAINED — claude -p runs inside docker --network none --cap-drop ALL (cannot reach the host broker; plan §0)',
    '_lib/claude-headless.js': 'FIXED-INPUT canary — verifyToollessRuntime probes with the constant "hi", never attacker text (plan §6 residual)',
    'issue-corpus/_spike/live-draft-dogfood.js': 'FIXED-INPUT canary — legP probes with the constant "hi", never attacker text (plan §6 residual)',
  };
  const unguarded = [];
  (function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) { if (ent.name !== 'node_modules') walk(p); continue; }
      if (!ent.name.endsWith('.js') || ent.name.endsWith('.test.js')) continue;
      const src = fs.readFileSync(p, 'utf8');
      // a host-side `claude -p` spawn: a child_process spawn + a `-p` arg + a claude reference. The claude gate
      // EXCLUDES false positives like pytest-runner.js (`pytest.main(['-p','no:cacheprovider'])` — a pytest flag,
      // spawns python3, zero claude references); the real claude spawners all reference the claude bin/recipe.
      const spawnsClaude = /spawnSync|execFileSync|child_process/.test(src) && /'-p'|"-p"/.test(src) && /claude/i.test(src);
      if (!spawnsClaude) continue;
      const rel = path.relative(LAB, p);
      if (/host-claude-guard/.test(src)) continue;   // GUARDED — routes through assertHostClaudeAllowed
      if (Object.prototype.hasOwnProperty.call(ALLOW, rel)) continue;   // explicitly allowlisted WITH a reason
      unguarded.push(rel);
    }
  }(LAB));
  unguarded.sort();
  assert.deepStrictEqual(unguarded, [], `a NEW host-side claude -p spawn must route through assertHostClaudeAllowed (or be allowlisted with a reason in this test): ${JSON.stringify(unguarded)}`);
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== judge-labeler-armed-guard.test.js: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
})();
