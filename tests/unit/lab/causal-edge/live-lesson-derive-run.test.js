#!/usr/bin/env node

// tests/unit/lab/causal-edge/live-lesson-derive-run.test.js
//
// item-3-live leg 1 - the IMPURE real `claude -p` live-lesson deriver leg (makeLiveLessonDeriver). This
// is the deriveFn the PURE deriveLiveLesson maps onto the frozen floor; it spawns a TOOL-LESS, host-guarded
// `claude -p` over the bounded, public-safe leg input. NO real claude here: a `spawnFn` spy proves the argv.
//
// THE CRITICAL ASSERTION (Rule 2a - the silent-drop is the bug): a green parse-only test does NOT prove the
// tool-less pin or the cost cap actually RODE on the spawn. We assert the spawned argv CONTAINS the tool-less
// recipe (`--tools` '' `--strict-mcp-config` `--disallowedTools` LSP) AND `--max-budget-usd`. The prompt rides
// on STDIN (opts.input), never argv (no token/text in argv). Plus the fail-closed mapping (nonzero/parse -> null).

'use strict';

// HERMETIC: a DEPLOYED box may carry /etc/loom/actor-anthropic.key (the cross-uid deployed-marker), which makes
// defaultJudgeLauncher REFUSE `deployed-unconfigured` before any spawn. Point the marker at a nonexistent path so
// the NOT-armed direct-launch path is exercised regardless of the host (a clean CI box has no such marker anyway).
process.env.LOOM_ACTOR_KEY_MARKER = '/nonexistent/loom/marker.key';

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const RUN = path.join(REPO, 'packages', 'lab', 'causal-edge', 'live-lesson-derive-run.js');
const { makeLiveLessonDeriver } = require(RUN);

let passed = 0; let failed = 0;
const _tests = [];
function test(name, fn) { _tests.push({ name, fn }); }

// A legInput shaped like buildLegInput's output (the object the leg receives + fences).
function legInput(over = {}) {
  return {
    problem_statement_digest: '0123456789abcdef',
    candidate_patch_sha: 'a'.repeat(64),
    semantic_supported: true,
    friction: {
      friction_class: 'wrong-file', friction_phase: 'localization', detection_leg: 'semantic-lens',
      _diagnostic: { human_message: 'edited the wrong module', expected: 'src/parser.js', observed: 'src/index.js' },
    },
    ...over,
  };
}

// A spawnFn spy that records the (command, args, opts) and returns a clean JSON verdict on stdout.
function spySpawn(stdout) {
  const calls = [];
  const fn = (command, args, opts) => {
    calls.push({ command, args, opts });
    return { status: 0, stdout: stdout || '{"trigger_class":"boundary-contract","gotcha_class":"unguarded-edge-case","corrective_class":"fail-closed","lesson_body":"guard the edge"}\n' };
  };
  fn.calls = calls; return fn;
}

// ---- CRITICAL: the tool-less pin + cost cap actually ride on the spawn argv ----
test('CRITICAL argv: the spawn carries the tool-less recipe (--tools "" --strict-mcp-config --disallowedTools LSP) AND --max-budget-usd', async () => {
  const spy = spySpawn();
  const leg = makeLiveLessonDeriver({ bin: '/stub/claude', maxBudgetUsd: 0.5, spawnFn: spy });
  await leg(legInput());
  assert.strictEqual(spy.calls.length, 1, 'the leg spawned exactly once');
  const args = spy.calls[0].args;
  // the tool-less recipe - every element must be present (a silent drop of any one re-opens host-action blast radius)
  assert.ok(args.includes('--tools'), 'argv carries --tools');
  assert.ok(args.includes(''), 'argv carries the empty-string toolset (drops the default tools)');
  assert.ok(args.includes('--strict-mcp-config'), 'argv carries --strict-mcp-config (blocks ambient MCP)');
  assert.ok(args.includes('--disallowedTools'), 'argv carries --disallowedTools');
  assert.ok(args.includes('LSP'), 'argv carries LSP (the always-on built-in the tool-less recipe denies)');
  // the cost cap rode
  assert.ok(args.includes('--max-budget-usd'), 'argv carries --max-budget-usd (the per-call cost cap)');
  const i = args.indexOf('--max-budget-usd');
  assert.strictEqual(args[i + 1], '0.5', 'the cost-cap value rode immediately after the flag');
  // -p + pinned model
  assert.ok(args.includes('-p'), 'argv carries -p (print mode)');
  assert.ok(args.includes('--model'), 'argv carries --model (pinned, not inherited)');
});

test('CRITICAL (production default): makeLiveLessonDeriver({ spawnFn }) rides --max-budget-usd 0.5 with NO cost cap passed', async () => {
  // the wiring builds the leg as makeLiveLessonDeriver({}) (no maxBudgetUsd). The cap must STILL ride - the
  // finite-by-default DERIVE_MAX_BUDGET_USD makes the cost-DoS guard non-bypassable on the path production takes
  // (the explicit-0.5 test above proves a PASSED value rides; THIS proves the DEFAULT rides).
  const spy = spySpawn();
  const leg = makeLiveLessonDeriver({ bin: '/stub/claude', spawnFn: spy });   // NO maxBudgetUsd (the production-default shape; bin pinned for hermeticity)
  await leg(legInput());
  assert.strictEqual(spy.calls.length, 1, 'the leg spawned (the default cap path is exercised)');
  const args = spy.calls[0].args;
  assert.ok(args.includes('--max-budget-usd'), 'the default cost cap rides on makeLiveLessonDeriver({}) with no cap passed');
  const i = args.indexOf('--max-budget-usd');
  assert.strictEqual(args[i + 1], '0.5', 'the finite default (0.5) rides - never null/uncapped on production');
});

test('CRITICAL: the prompt rides on STDIN (opts.input), NEVER on argv (no token/text in argv)', async () => {
  const spy = spySpawn();
  const leg = makeLiveLessonDeriver({ bin: '/stub/claude', spawnFn: spy });
  await leg(legInput());
  const { args, opts } = spy.calls[0];
  assert.ok(typeof opts.input === 'string' && opts.input.length > 0, 'the prompt is on STDIN (opts.input)');
  assert.ok(opts.input.includes('edited the wrong module'), 'the fenced diagnostic rides in the STDIN prompt');
  // the bounded diagnostic free-text must NOT appear as an argv element
  assert.ok(!args.some((a) => typeof a === 'string' && a.includes('edited the wrong module')), 'the diagnostic is NOT in argv');
  assert.strictEqual(opts.shell, false, 'shell:false (never shell-interpreted)');
});

test('the leg maps a clean verdict onto {trigger,gotcha,corrective,lesson_body}', async () => {
  const spy = spySpawn();
  const leg = makeLiveLessonDeriver({ bin: '/stub/claude', spawnFn: spy });
  const r = await leg(legInput());
  assert.ok(r, 'a clean spawn returns the mapped leg output');
  assert.strictEqual(r.trigger_class, 'boundary-contract');
  assert.strictEqual(r.gotcha_class, 'unguarded-edge-case');
  assert.strictEqual(r.corrective_class, 'fail-closed');
  assert.strictEqual(r.lesson_body, 'guard the edge');
});

// ---- fail-closed mapping (nonzero exit / parse-failure -> null) ----------------
test('fail-closed: a NONZERO exit => null (-> the PURE deriveLiveLesson benign null)', async () => {
  const fn = () => ({ status: 1, stdout: '' });
  const leg = makeLiveLessonDeriver({ bin: '/stub/claude', spawnFn: fn });
  assert.strictEqual(await leg(legInput()), null, 'a nonzero exit maps to null');
});

test('fail-closed: a PARSE-FAILURE (non-JSON stdout) => null', async () => {
  const leg = makeLiveLessonDeriver({ bin: '/stub/claude', spawnFn: spySpawn('not json at all') });
  assert.strictEqual(await leg(legInput()), null, 'unparseable stdout maps to null');
});

test('fail-closed: an ABSENT bin => null (no spawn, never throws)', async () => {
  const spy = spySpawn();
  const leg = makeLiveLessonDeriver({ bin: null, spawnFn: spy });
  const r = await leg(legInput());
  assert.strictEqual(r, null, 'a null bin maps to null');
  assert.strictEqual(spy.calls.length, 0, 'no spawn when the bin is absent');
});

// ---- per-call nonce: two derivations use DIFFERENT fences (unguessable per call) ----
test('per-call nonce: two derivations carry DIFFERENT fence nonces (crypto.randomBytes per call)', async () => {
  const spy = spySpawn();
  const leg = makeLiveLessonDeriver({ bin: '/stub/claude', spawnFn: spy });
  await leg(legInput());
  await leg(legInput());
  const m = (s) => { const r = /LOOM_UNTRUSTED_([0-9a-f]{16})_BEGIN/.exec(s); return r && r[1]; };
  const n1 = m(spy.calls[0].opts.input);
  const n2 = m(spy.calls[1].opts.input);
  assert.ok(n1 && n2, 'both prompts carry a 16-hex nonce fence');
  assert.notStrictEqual(n1, n2, 'each call uses a fresh unguessable nonce');
});

(async () => {
  for (const t of _tests) {
    try { await t.fn(); passed += 1; }
    catch (e) { failed += 1; console.error(`FAIL: ${t.name}\n      ${e && (e.stack || e.message)}`); }
  }
  console.log(`\nlive-lesson-derive-run.test.js: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
