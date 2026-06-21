#!/usr/bin/env node
'use strict';

// tests/unit/kernel/_lib/capability-free-judge-bin.test.js
//
// Ghost Heartbeat W2-PR-C: the judge bin is overridable via GHOST_HEARTBEAT_JUDGE_BIN so the
// SCHEDULER can bake the ABSOLUTE claude path for launchd/cron's minimal PATH (where a bare
// PATH resolution ENOENTs -- the dogfooded failure). Precedence: explicit `bin` arg > env >
// PATH > bare 'claude'. Observed without a real claude: a real exec'able env bin (/bin/echo)
// echoes the argv flags -> ok:true; a bogus env bin -> spawn-error (proving the env value, not
// a PATH claude, was used). SAVE/RESTORE the env so it never leaks into the G3 sentinel test.

const assert = require('assert');
const { spawnSync } = require('child_process');
const { runCapabilityFreeJudge } = require('../../../../packages/kernel/_lib/capability-free-claude');

function hasClaude() {
  const r = spawnSync('command', ['-v', 'claude'], { shell: '/bin/bash', encoding: 'utf8' });
  return !!(r.stdout || '').trim();
}

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

const SAVED = process.env.GHOST_HEARTBEAT_JUDGE_BIN;
function withEnv(v, fn) {
  if (v === undefined) delete process.env.GHOST_HEARTBEAT_JUDGE_BIN;
  else process.env.GHOST_HEARTBEAT_JUDGE_BIN = v;
  try { fn(); } finally {
    if (SAVED === undefined) delete process.env.GHOST_HEARTBEAT_JUDGE_BIN;
    else process.env.GHOST_HEARTBEAT_JUDGE_BIN = SAVED;
  }
}

const BOGUS = '/nonexistent/definitely/not/claude';

process.stdout.write('\n=== capability-free judge bin override (w2-pr-c) ===\n');

test('GHOST_HEARTBEAT_JUDGE_BIN is used when no explicit bin arg is given', () => {
  withEnv('/bin/echo', () => {
    const r = runCapabilityFreeJudge({ prompt: 'x' });
    assert.ok(r.ok, `expected ok (the env bin /bin/echo ran); got ${JSON.stringify(r)}`);
    assert.ok(r.text.includes('--strict-mcp-config'), 'the capability-free flags reached the env bin (echoed argv)');
  });
});

test('a bogus GHOST_HEARTBEAT_JUDGE_BIN -> spawn-error (the env value is used, not a PATH claude)', () => {
  withEnv(BOGUS, () => {
    const r = runCapabilityFreeJudge({ prompt: 'x' });
    assert.strictEqual(r.ok, false);
    assert.ok(/^spawn-error:/.test(r.reason), `expected spawn-error; got ${JSON.stringify(r)}`);
  });
});

test('an explicit bin arg WINS over the env', () => {
  withEnv(BOGUS, () => {
    const r = runCapabilityFreeJudge({ prompt: 'x', bin: '/bin/echo' });
    assert.ok(r.ok, `explicit bin must win over the (bogus) env; got ${JSON.stringify(r)}`);
    assert.ok(r.text.includes('--strict-mcp-config'));
  });
});

// The env value beats a PRESENT PATH claude (the structural precedence env-before-`command -v`).
// Self-skips where claude is absent (CI) -- there a PATH miss falls to bare 'claude' anyway.
if (!hasClaude()) {
  process.stdout.write('  SKIP env-over-PATH: `claude` not on PATH (the precedence is structural; see resolveClaude)\n');
} else {
  test('the env value beats a PRESENT PATH claude (env checked before `command -v`)', () => {
    withEnv('/bin/echo', () => {
      const r = runCapabilityFreeJudge({ prompt: 'x' });
      assert.ok(r.ok && r.text.includes('--strict-mcp-config'), `the env /bin/echo ran, not the PATH claude; got ${JSON.stringify(r)}`);
    });
  });
}

process.stdout.write(`\n  Passed: ${passed}  Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
