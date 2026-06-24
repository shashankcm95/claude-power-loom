'use strict';

// tests/unit/lab/_lib/host-claude-guard.test.js — #430 the shared fail-closed armed-decision LEAF.
// assertHostClaudeAllowed is the ONE place the host-side `claude -p` armed polarity lives (the resolution actor +
// the four judge/labeler/deriver chokepoints). NON-VACUOUS: the refusal path is exercised RED via a simulated armed
// state, and the THROW path proves fail-CLOSED.

const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const { assertHostClaudeAllowed, defaultIsEmitArmed } = require(path.join(REPO, 'packages', 'lab', '_lib', 'host-claude-guard.js'));

let passed = 0; let failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function captureStderr(fn) {
  const orig = process.stderr.write; const lines = [];
  process.stderr.write = (chunk) => { lines.push(String(chunk)); return true; };
  let ret; try { ret = fn(); } finally { process.stderr.write = orig; }
  return { ret, err: lines.join('') };
}

test('not armed (isEmitArmedFn -> false) => { allowed:true }, NO alert', () => {
  const { ret, err } = captureStderr(() => assertHostClaudeAllowed({ isEmitArmedFn: () => false, spawn: 's' }));
  assert.deepStrictEqual(ret, { allowed: true });
  assert.strictEqual(err, '', 'no alert emitted when allowed');
});

test('armed (isEmitArmedFn -> true) => { allowed:false, reason } + ONE observable alert (default judge token)', () => {
  const { ret, err } = captureStderr(() => assertHostClaudeAllowed({ isEmitArmedFn: () => true, spawn: 'rung2-judge' }));
  assert.strictEqual(ret.allowed, false);
  assert.strictEqual(ret.reason, 'host-judge-refused-while-armed');
  assert.ok(err.startsWith('[LOOM-EGRESS-ALERT] '), 'a refusal is OBSERVABLE (fail-closed-observable)');
  const a = JSON.parse(err.slice('[LOOM-EGRESS-ALERT] '.length).trim());
  assert.strictEqual(a.reason, 'host-judge-refused-while-armed', 'the alert reason == the return reason');
  assert.strictEqual(a.spawn, 'rung2-judge', 'the spawn label is carried in the alert detail');
});

test('a custom alertToken is preserved (the ACTOR keeps its exact token — byte-identity vs the inline #422 guard)', () => {
  const { ret, err } = captureStderr(() => assertHostClaudeAllowed({ isEmitArmedFn: () => true, spawn: 'runActorTrajectory', alertToken: 'host-actor-refused-while-armed' }));
  assert.strictEqual(ret.reason, 'host-actor-refused-while-armed');
  const a = JSON.parse(err.slice('[LOOM-EGRESS-ALERT] '.length).trim());
  assert.strictEqual(a.reason, 'host-actor-refused-while-armed');
  assert.strictEqual(a.spawn, 'runActorTrajectory');
});

test('a THROWING isEmitArmedFn fails CLOSED (allowed:false), never propagates', () => {
  const { ret } = captureStderr(() => assertHostClaudeAllowed({ isEmitArmedFn: () => { throw new Error('arm-check boom'); }, spawn: 's' }));
  assert.strictEqual(ret.allowed, false, 'a guard that CANNOT decide must REFUSE');
  assert.strictEqual(ret.reason, 'host-judge-refused-while-armed');
});

test('defaultIsEmitArmed: LOOM_EGRESS_KILLSWITCH_PATH unset => false (fail-safe not-armed)', () => {
  const save = process.env.LOOM_EGRESS_KILLSWITCH_PATH; delete process.env.LOOM_EGRESS_KILLSWITCH_PATH;
  try { assert.strictEqual(defaultIsEmitArmed(), false); }
  finally { if (save === undefined) delete process.env.LOOM_EGRESS_KILLSWITCH_PATH; else process.env.LOOM_EGRESS_KILLSWITCH_PATH = save; }
});

test('the DEFAULT arm source (no isEmitArmedFn) with unset env => allowed:true (the production non-bypassable path)', () => {
  const save = process.env.LOOM_EGRESS_KILLSWITCH_PATH; delete process.env.LOOM_EGRESS_KILLSWITCH_PATH;
  try { assert.deepStrictEqual(assertHostClaudeAllowed({ spawn: 's' }), { allowed: true }); }
  finally { if (save === undefined) delete process.env.LOOM_EGRESS_KILLSWITCH_PATH; else process.env.LOOM_EGRESS_KILLSWITCH_PATH = save; }
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  PASS ${name}\n`); passed += 1; }
    catch (err) { process.stdout.write(`  FAIL ${name}: ${err && err.message}\n`); failed += 1; }
  }
  process.stdout.write(`\n=== host-claude-guard.test.js: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
})();
