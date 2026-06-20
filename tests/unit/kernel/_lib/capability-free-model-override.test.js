#!/usr/bin/env node
'use strict';

// tests/unit/kernel/_lib/capability-free-model-override.test.js
//
// RFC OQ-W2-1: the judge model defaults to a PINNED cheap model but is overridable via
// GHOST_HEARTBEAT_JUDGE_MODEL, with an explicit `model` arg still winning (JS default-param
// precedence). Stub the bin with /bin/echo so the RESOLVED `--model` flows to argv (echoed
// to stdout) without spawning a real claude -- a deterministic, claude-free unit test.

const assert = require('assert');
const { runCapabilityFreeJudge, DEFAULT_MODEL } = require('../../../../packages/kernel/_lib/capability-free-claude');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

// /bin/echo prints its argv, so the resolved `--model <m>` is observable in the result text.
function resolvedModel(opts) {
  const r = runCapabilityFreeJudge({ prompt: 'x', bin: '/bin/echo', ...opts });
  assert.ok(r.ok, `expected ok; got ${JSON.stringify(r)}`);
  const m = r.text.match(/--model\s+(\S+)/);
  return m ? m[1] : null;
}

const SAVED = process.env.GHOST_HEARTBEAT_JUDGE_MODEL;
function withEnv(v, fn) {
  if (v === undefined) delete process.env.GHOST_HEARTBEAT_JUDGE_MODEL;
  else process.env.GHOST_HEARTBEAT_JUDGE_MODEL = v;
  try { fn(); } finally {
    if (SAVED === undefined) delete process.env.GHOST_HEARTBEAT_JUDGE_MODEL;
    else process.env.GHOST_HEARTBEAT_JUDGE_MODEL = SAVED;
  }
}

process.stdout.write('\n=== capability-free judge model override (OQ-W2-1) ===\n');

test('no env, no arg -> DEFAULT_MODEL (the pin holds)', () => {
  withEnv(undefined, () => assert.strictEqual(resolvedModel({}), DEFAULT_MODEL));
});

test('GHOST_HEARTBEAT_JUDGE_MODEL overrides the default', () => {
  withEnv('claude-sonnet-4-6', () => assert.strictEqual(resolvedModel({}), 'claude-sonnet-4-6'));
});

test('an explicit model arg WINS over the env (default-param precedence)', () => {
  withEnv('claude-sonnet-4-6', () => assert.strictEqual(resolvedModel({ model: 'claude-opus-4-8' }), 'claude-opus-4-8'));
});

process.stdout.write(`\n  Passed: ${passed}  Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
