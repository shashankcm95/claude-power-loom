#!/usr/bin/env node
'use strict';

// tests/unit/kernel/_lib/env-int.test.js
// The canonical whole-digit env-int reader (extracted from the two ghost-heartbeat copies).

const assert = require('assert');
const { envInt } = require('../../../../packages/kernel/_lib/env-int');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}
function withEnv(name, val, fn) {
  const prev = process.env[name];
  if (val === undefined) delete process.env[name]; else process.env[name] = val;
  try { fn(); } finally { if (prev === undefined) delete process.env[name]; else process.env[name] = prev; }
}

process.stdout.write('\n=== env-int ===\n');

test('E1: unset -> default', () => {
  withEnv('EI_X', undefined, () => assert.strictEqual(envInt('EI_X', 42), 42));
});

test('E2: a whole-digit value parses', () => {
  withEnv('EI_X', '5000', () => assert.strictEqual(envInt('EI_X', 42), 5000));
});

test('E3: garbage / footgun tokens -> default (not a silent parseInt truncation)', () => {
  for (const bad of ['', '   ', 'garbage', '0x10', '1e9', '-1', '12x', '3.5']) {
    withEnv('EI_X', bad, () => assert.strictEqual(envInt('EI_X', 42), 42, `bad=${JSON.stringify(bad)}`));
  }
});

test('E4: [min,max] clamp — huge clamps to max, tiny floors to min, in-range passes', () => {
  withEnv('EI_X', '999999', () => assert.strictEqual(envInt('EI_X', 20, { min: 1, max: 500 }), 500));
  withEnv('EI_X', '0', () => assert.strictEqual(envInt('EI_X', 20, { min: 1, max: 500 }), 1));
  withEnv('EI_X', '250', () => assert.strictEqual(envInt('EI_X', 20, { min: 1, max: 500 }), 250));
});

test('E5: min-only / max-only clamps apply independently', () => {
  withEnv('EI_X', '10', () => assert.strictEqual(envInt('EI_X', 0, { min: 100 }), 100));
  withEnv('EI_X', '10', () => assert.strictEqual(envInt('EI_X', 0, { max: 5 }), 5));
});

test('E6: no-opts call is unclamped (stop.js compat)', () => {
  withEnv('EI_X', '999999', () => assert.strictEqual(envInt('EI_X', 20), 999999));
});

process.stdout.write(`\n  Passed: ${passed}  Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
