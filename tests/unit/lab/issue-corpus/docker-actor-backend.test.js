#!/usr/bin/env node

// tests/unit/lab/issue-corpus/docker-actor-backend.test.js
//
// ③.2.2b — the Docker ACTOR-write sandbox (the RED set, PURE half — NO daemon, NO network, NO spend).
// Live containment + real auth+cost are proven by _spike/actor-containment-spike.js + _spike/actor-dogfood.js
// (re-run at VALIDATE). This tier pins the VERIFY-folded design:
//   - EC.b1: buildActorRunArgs composes dockerHardeningFlags; /work RW; --network from ACTOR_ALLOWED_NETWORKS
//     (NOT the grade {none}); `-i` for the prompt stdin; `-e ANTHROPIC_API_KEY` NAME-only (NO sk- in argv)
//   - hacker #1: the actor toolset EXCLUDES Bash
//   - EC.b5a: mapActorResult SCRUBS the transcript (a /proc/self/environ key leak is redacted before return)
//   - EC.b5b: mapActorResult returns the strict-SUPERSET contract (host cwd; reason/status + nullable costUsd)

'use strict';

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const ISSUE = path.join(REPO, 'packages', 'lab', 'issue-corpus');
const AB = require(path.join(ISSUE, 'docker-actor-backend.js'));
const {
  buildActorRunArgs, mapActorResult, parseStreamJson, runActorInContainer,
  ACTOR_TOOLS, ACTOR_ALLOWED_NETWORKS, DEFAULT_ACTOR_IMAGE,
} = AB;

let passed = 0; let failed = 0;
const _async = [];
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}
function atest(name, fn) {
  _async.push(Promise.resolve().then(fn)
    .then(() => { process.stdout.write(`  PASS ${name}\n`); passed++; })
    .catch((err) => { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }));
}
function throws(fn) { assert.throws(fn); }
function valAfter(args, flag) { const i = args.indexOf(flag); return i === -1 ? undefined : args[i + 1]; }

// A fake key built at RUNTIME by concatenation — no contiguous secret literal in source (the secrets
// gate scans source bytes). Matches the coarse `sk-[A-Za-z0-9_-]{20,}` scrubber class.
const FAKE_KEY = `sk${'-ant-api03-'}${'L'.repeat(44)}`;

const CLAUDE_ARGV = ['-p', '--output-format', 'stream-json', '--verbose', '--model', 'claude-sonnet-4-6', '--allowedTools', ACTOR_TOOLS.join(',')];
const ARGS = buildActorRunArgs({ image: DEFAULT_ACTOR_IMAGE, workDir: '/private/tmp/loom-clone-x', command: 'claude', argv: CLAUDE_ARGV, name: 'loom-run-deadbeefdeadbeef' });

// ── EC.b1 — buildActorRunArgs posture ──
test('b1.1 composes the SHARED host-isolation posture (cap-drop/no-new-priv/read-only/tmpfs/user/label)', () => {
  assert.strictEqual(valAfter(ARGS, '--cap-drop'), 'ALL');
  assert.strictEqual(valAfter(ARGS, '--security-opt'), 'no-new-privileges');
  assert.ok(ARGS.includes('--read-only'));
  assert.ok(String(valAfter(ARGS, '--tmpfs')).startsWith('/tmp:'));
  assert.ok(/^\d+:\d+$/.test(valAfter(ARGS, '--user')));
  assert.strictEqual(valAfter(ARGS, '--label'), `loom-owner=${process.pid}`);
});
test('b1.2 /work is bind-mounted (RW; the actor edits) via --mount long-form', () => {
  assert.strictEqual(valAfter(ARGS, '--mount'), 'type=bind,source=/private/tmp/loom-clone-x,destination=/work');
  assert.ok(!ARGS.includes('-v'));
  assert.strictEqual(valAfter(ARGS, '-w'), '/work');
});
test('b1.3 --network is the per-actor egress mode (bridge), NOT the grade {none}', () => {
  assert.strictEqual(valAfter(ARGS, '--network'), 'bridge');
  assert.ok(ACTOR_ALLOWED_NETWORKS.has('bridge'));
  assert.ok(!ACTOR_ALLOWED_NETWORKS.has('none'));
  throws(() => buildActorRunArgs({ workDir: '/tmp/x', command: 'claude', name: 'loom-run-aa', network: 'none' }));
  throws(() => buildActorRunArgs({ workDir: '/tmp/x', command: 'claude', name: 'loom-run-aa', network: 'host' }));
});
test('b1.4 `-i` keeps stdin open for the prompt', () => assert.ok(ARGS.includes('-i')));
test('b1.5 the API key is `-e ANTHROPIC_API_KEY` NAME-only — NO sk- VALUE anywhere in the argv', () => {
  const ei = ARGS.indexOf('-e');
  assert.strictEqual(ARGS[ei + 1], 'ANTHROPIC_API_KEY');
  assert.ok(!ARGS.some((a) => /sk-/.test(String(a))), 'argv must never carry an API key value');
});
test('b1.6 the command + argv ride positionally after the image (no shell splice)', () => {
  const tail = ARGS.slice(ARGS.indexOf(DEFAULT_ACTOR_IMAGE));
  assert.deepStrictEqual(tail.slice(0, 5), [DEFAULT_ACTOR_IMAGE, 'sh', '-c', tail[3], 'sh']);
  assert.strictEqual(tail[5], 'claude');
});
test('b1.7 assertSafeMountPath is reused (an injected workDir colon throws)', () => {
  throws(() => buildActorRunArgs({ workDir: '/tmp/a:b', command: 'claude', name: 'loom-run-aa' }));
});

// ── hacker #1 — the toolset EXCLUDES Bash ──
test('h1.1 ACTOR_TOOLS excludes Bash (no socket-exfil on network-on)', () => {
  assert.ok(!ACTOR_TOOLS.includes('Bash'));
  assert.deepStrictEqual([...ACTOR_TOOLS], ['Read', 'Grep', 'Glob', 'Edit', 'Write']);
});
test('h1.2 the --allowedTools value carries no Bash', () => {
  assert.ok(!/Bash/.test(valAfter(ARGS, '--allowedTools')));
});

// ── EC.b5a — mapActorResult SCRUBS the transcript before return (the /proc key-leak sink) ──
test('b5a.1 a key leaked into the raw stdout is REDACTED in the returned transcript', () => {
  const leaked = [
    JSON.stringify({ type: 'user', content: `leaked from /proc: ${FAKE_KEY}` }),
    JSON.stringify({ type: 'result', subtype: 'success', total_cost_usd: 0.03 }),
  ].join('\n');
  assert.ok(leaked.includes(FAKE_KEY), 'precondition: the raw transcript carries the key');
  const out = mapActorResult({ stdout: leaked, sentinelSeen: true, exitCode: 0 }, { workDir: '/host/clone' });
  assert.ok(!out.stdout.includes(FAKE_KEY), 'the API key must be scrubbed from the returned transcript');
  assert.ok(/REDACTED/.test(out.stdout));
  assert.strictEqual(out.costUsd, 0.03); // the cost field (a number) survives the scrub
  assert.strictEqual(out.redacted, true); // the scrub FIRED (non-vacuous telemetry — the raw carried a secret)
});
test('b5a.2 redacted=false when the raw transcript carries no secret', () => {
  const clean = JSON.stringify({ type: 'result', total_cost_usd: 0.01 });
  const out = mapActorResult({ stdout: clean, sentinelSeen: true, exitCode: 0 }, { workDir: '/h' });
  assert.strictEqual(out.redacted, false);
});

// ── EC.b5b — the strict-SUPERSET contract ──
test('b5b.1 success: { ok:true, cwd=HOST path, costUsd } (cwd is NOT /work)', () => {
  const ok = mapActorResult({ stdout: JSON.stringify({ type: 'result', total_cost_usd: 0.1 }), sentinelSeen: true, exitCode: 0 }, { workDir: '/host/clone' });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.cwd, '/host/clone'); // the HOST bind-mount path — ③.2.2c captures the diff here
  assert.strictEqual(ok.costUsd, 0.1);
});
test('b5b.2 failure branches carry reason + nullable costUsd (③.2.2c reads cap.reason)', () => {
  const timeout = mapActorResult({ timedOut: true, stdout: '' }, { workDir: '/h' });
  assert.strictEqual(timeout.ok, false); assert.strictEqual(timeout.reason, 'timeout'); assert.strictEqual(timeout.costUsd, null);
  const nonzero = mapActorResult({ sentinelSeen: true, exitCode: 2, stdout: JSON.stringify({ type: 'result', total_cost_usd: 0.02 }) }, { workDir: '/h' });
  assert.strictEqual(nonzero.ok, false); assert.strictEqual(nonzero.reason, 'actor-nonzero-exit'); assert.strictEqual(nonzero.status, 2);
  assert.strictEqual(nonzero.costUsd, 0.02); // a non-zero-exit run that still spent records its cost
  const setup = mapActorResult({ sentinelSeen: false, exitCode: 0, stdout: '' }, { workDir: '/h' });
  assert.strictEqual(setup.reason, 'setup-failure');
  const threw = mapActorResult({ spawnThrew: true }, { workDir: '/h' });
  assert.strictEqual(threw.reason, 'spawn-threw');
});
test('b5b.3 parseStreamJson skips the sentinel / partial lines', () => {
  const evs = parseStreamJson('__LOOM_SANDBOX_STARTED__\n{"type":"result","total_cost_usd":0.5}\n{ partial');
  assert.strictEqual(evs.length, 1);
  assert.strictEqual(evs[0].total_cost_usd, 0.5);
});

// ── fail-closed: no apiKey -> no run (no daemon touched) ──
atest('fc.1 runActorInContainer fail-closes (no spawn) when apiKey is absent', async () => {
  const r = await runActorInContainer({ workDir: '/host/clone', prompt: 'x', apiKey: null });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.cwd, '/host/clone');
  assert.strictEqual(r.costUsd, null);
});

Promise.all(_async).then(() => {
  process.stdout.write(`\ndocker-actor-backend pure: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
});
