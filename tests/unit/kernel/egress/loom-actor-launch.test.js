'use strict';

// tests/unit/kernel/egress/loom-actor-launch.test.js — the cross-uid ACTOR argv builder (③.2.5 uid-611). Proves it
// REUSES the broker launcher's sudo flag-injection guards (USERNAME_RE + absolute/no-dotdot wrapper) and adds an
// EXACT-SET model allowlist (#273). PURE (asserts the argv; does not spawn). The model lands as the wrapper's $1
// (the wrapper hardcodes `--model "$1"`), so it can never become a free claude flag.

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const L = require(path.join(REPO, 'packages', 'kernel', 'egress', 'loom-actor-launch.js'));

let passed = 0; let failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const OK_MODEL = L.ALLOWED_ACTOR_MODELS[0];

test('crossUidActorArgs reuses crossUidSudoArgs base + appends the validated model as the LAST arg', () => {
  const { command, args } = L.crossUidActorArgs({ actorUser: 'loom-actor', wrapperPath: '/usr/local/bin/loom-actor-run', model: OK_MODEL });
  assert.strictEqual(command, 'sudo');
  assert.deepStrictEqual(args, ['-n', '-u', 'loom-actor', '/usr/local/bin/loom-actor-run', OK_MODEL]);
});

test('ALLOWED_ACTOR_MODELS is a frozen non-empty set incl. the runActorTrajectory default', () => {
  assert.ok(Array.isArray(L.ALLOWED_ACTOR_MODELS) && L.ALLOWED_ACTOR_MODELS.length > 0);
  assert.ok(Object.isFrozen(L.ALLOWED_ACTOR_MODELS), 'frozen so no importer can widen it at runtime');
  assert.ok(L.ALLOWED_ACTOR_MODELS.includes('claude-sonnet-4-6'), 'the runActorTrajectory default must be allowed');
});

test('model: exact-set membership — a non-member / missing is REFUSED (non-vacuous)', () => {
  assert.throws(() => L.crossUidActorArgs({ actorUser: 'loom-actor', wrapperPath: '/opt/w', model: 'gpt-4' }), /model/);
  assert.throws(() => L.crossUidActorArgs({ actorUser: 'loom-actor', wrapperPath: '/opt/w', model: undefined }), /model/);
  assert.throws(() => L.crossUidActorArgs({ actorUser: 'loom-actor', wrapperPath: '/opt/w' }), /model/);
  assert.throws(() => L.crossUidActorArgs({ actorUser: 'loom-actor', wrapperPath: '/opt/w', model: 123 }), /model/);
});

test('model: a --leading value or a prefix can NEVER slip in (exact-set, not prefix; not a free flag)', () => {
  assert.throws(() => L.crossUidActorArgs({ actorUser: 'loom-actor', wrapperPath: '/opt/w', model: '--dangerously-skip-permissions' }), /model/);
  assert.throws(() => L.crossUidActorArgs({ actorUser: 'loom-actor', wrapperPath: '/opt/w', model: 'claude-sonnet' }), /model/);
});

test('actorUser flag-injection / metachar / over-length -> REFUSED (reuses USERNAME_RE)', () => {
  for (const u of ['-x', 'a b', 'a;b', 'Loom', 'x'.repeat(33), '']) {
    assert.throws(() => L.crossUidActorArgs({ actorUser: u, wrapperPath: '/opt/w', model: OK_MODEL }), /(brokerUser|actorUser|user)/i, 'rejects ' + JSON.stringify(u));
  }
});

test('wrapperPath: non-absolute / dotdot -> REFUSED (reuses assertAbsoluteNoDotDot)', () => {
  assert.throws(() => L.crossUidActorArgs({ actorUser: 'loom-actor', wrapperPath: 'rel/w', model: OK_MODEL }), /ABSOLUTE/);
  assert.throws(() => L.crossUidActorArgs({ actorUser: 'loom-actor', wrapperPath: '/opt/../etc/w', model: OK_MODEL }), /\.\./);
});

test('crossUidActorVersionProbeArgs builds sudo+wrapper+sentinel (no model needed; sentinel is a trusted constant)', () => {
  const { command, args } = L.crossUidActorVersionProbeArgs({ actorUser: 'loom-actor', wrapperPath: '/opt/w' });
  assert.strictEqual(command, 'sudo');
  assert.deepStrictEqual(args, ['-n', '-u', 'loom-actor', '/opt/w', L.VERSION_PROBE_SENTINEL]);
  assert.ok(typeof L.VERSION_PROBE_SENTINEL === 'string' && L.VERSION_PROBE_SENTINEL.startsWith('--'), 'a wrapper-arg sentinel, never a sudo flag');
});

test('crossUidActorVersionProbeArgs still validates the user + wrapper (reuses crossUidSudoArgs)', () => {
  assert.throws(() => L.crossUidActorVersionProbeArgs({ actorUser: '-x', wrapperPath: '/opt/w' }), /(brokerUser|actorUser|user)/i);
  assert.throws(() => L.crossUidActorVersionProbeArgs({ actorUser: 'loom-actor', wrapperPath: 'rel/w' }), /ABSOLUTE/);
});

// ---- #430 PR-2 — the cross-uid JUDGE argv builders (mirror the actor builders; NO model passthrough) ----

test('crossUidJudgeArgs reuses the sudo base + appends ONLY the frozen --loom-judge sentinel (no model arg)', () => {
  const { command, args } = L.crossUidJudgeArgs({ actorUser: 'loom-actor', wrapperPath: '/usr/local/bin/loom-actor-run' });
  assert.strictEqual(command, 'sudo');
  assert.deepStrictEqual(args, ['-n', '-u', 'loom-actor', '/usr/local/bin/loom-actor-run', '--loom-judge']);
  assert.strictEqual(args[args.length - 1], L.JUDGE_SENTINEL);
  assert.strictEqual(L.JUDGE_SENTINEL, '--loom-judge');
});

test('JUDGE_SENTINEL / JUDGE_PROBE_SENTINEL are dash-leading constants (so an OLD wrapper rejects them as a --model value)', () => {
  assert.ok(typeof L.JUDGE_SENTINEL === 'string' && L.JUDGE_SENTINEL.startsWith('--'), 'dash-leading by design (H1 deploy-ordering)');
  assert.ok(typeof L.JUDGE_PROBE_SENTINEL === 'string' && L.JUDGE_PROBE_SENTINEL.startsWith('--'));
  assert.notStrictEqual(L.JUDGE_SENTINEL, L.JUDGE_PROBE_SENTINEL);
});

test('crossUidJudgeProbeArgs builds sudo+wrapper+probe-sentinel (the C5 leg; no model)', () => {
  const { command, args } = L.crossUidJudgeProbeArgs({ actorUser: 'loom-actor', wrapperPath: '/opt/w' });
  assert.strictEqual(command, 'sudo');
  assert.deepStrictEqual(args, ['-n', '-u', 'loom-actor', '/opt/w', L.JUDGE_PROBE_SENTINEL]);
});

test('crossUidJudgeArgs/ProbeArgs THROW on a flag-injection user / relative / dotdot wrapper (reuses crossUidSudoArgs)', () => {
  for (const build of [L.crossUidJudgeArgs, L.crossUidJudgeProbeArgs]) {
    assert.throws(() => build({ actorUser: '-x', wrapperPath: '/opt/w' }), /(brokerUser|actorUser|user)/i);
    assert.throws(() => build({ actorUser: 'a;b', wrapperPath: '/opt/w' }), /(brokerUser|actorUser|user)/i);
    assert.throws(() => build({ actorUser: 'loom-actor', wrapperPath: 'rel/w' }), /ABSOLUTE/);
    assert.throws(() => build({ actorUser: 'loom-actor', wrapperPath: '/opt/../etc/w' }), /\.\./);
  }
});

test('crossUidJudgeArgs carries NO attacker-influenced positional — the args are EXACTLY base + the constant sentinel', () => {
  // the judge model + recipe + budget are wrapper LITERALS; the cross-uid argv must never carry a model/extraArg.
  const { args } = L.crossUidJudgeArgs({ actorUser: 'loom-actor', wrapperPath: '/opt/w' });
  assert.strictEqual(args.length, 5, 'exactly [-n,-u,user,wrapper,--loom-judge] — no 6th positional');
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== loom-actor-launch.test.js: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
})();
