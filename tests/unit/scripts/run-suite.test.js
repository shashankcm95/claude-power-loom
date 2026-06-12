#!/usr/bin/env node

// tests/unit/scripts/run-suite.test.js - hermetic coverage for the parallel unit-suite runner.
//
// Builds a tmp suites-root with fixture tiers (an all-pass tier, plus a tier
// containing a plain-fail and a process.exit(1) fixture), spawns
// scripts/run-suite.js with --root <tmp> against them, and asserts on exit
// codes + the PASS/FAIL/summary output. Hermetic: never touches the real
// tests/unit suites; tmp is mkdtempSync'd and removed in finally.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RUNNER = path.resolve(__dirname, '../../../scripts/run-suite.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write('  PASS ' + name + '\n'); passed++; }
  catch (e) { process.stdout.write('  FAIL ' + name + ': ' + e.message + '\n'); failed++; }
}

// A test fixture that prints + exits 0 (an all-pass standalone test).
const PASS_FIXTURE = 'process.stdout.write("fixture ok\\n");\n';
// A fixture that exits non-zero via process.exit(1).
const EXIT1_FIXTURE = 'process.stdout.write("fixture exit1\\n");\nprocess.exit(1);\n';
// A fixture that throws (non-zero exit via an uncaught error).
const THROW_FIXTURE = 'process.stdout.write("fixture throw\\n");\nthrow new Error("boom");\n';

function writeTier(root, tier, files) {
  const dir = path.join(root, tier);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), body);
  }
}

function runSuite(root, tier, extraArgs) {
  const args = [RUNNER, '--root', root, '--tier', tier, '--jobs', '2', ...(extraArgs || [])];
  return spawnSync(process.execPath, args, { encoding: 'utf8' });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-suite-'));
try {
  // kernel = all-pass tier; lab = mixed (pass + exit1 + throw); agents = empty.
  writeTier(tmp, 'kernel', { 'a.test.js': PASS_FIXTURE, 'b.test.js': PASS_FIXTURE });
  writeTier(tmp, 'lab', {
    'pass.test.js': PASS_FIXTURE,
    'exit1.test.js': EXIT1_FIXTURE,
    'throw.test.js': THROW_FIXTURE,
  });
  fs.mkdirSync(path.join(tmp, 'agents'), { recursive: true }); // exists but empty

  test('all-pass tier -> exit 0, PASS lines, summary line', () => {
    const r = runSuite(tmp, 'kernel');
    assert.strictEqual(r.status, 0, 'expected exit 0 for all-pass tier, got ' + r.status);
    assert.ok(/PASS kernel\/a\.test\.js \(\d+ms\)/.test(r.stdout), 'PASS line for a.test.js missing');
    assert.ok(/PASS kernel\/b\.test\.js \(\d+ms\)/.test(r.stdout), 'PASS line for b.test.js missing');
    assert.ok(/kernel: 2 passed, 0 failed \(.+s wall, jobs=2\)/.test(r.stdout), 'summary line missing/wrong');
  });

  test('tier with a failing file -> exit 1 + FAIL line', () => {
    const r = runSuite(tmp, 'lab');
    assert.strictEqual(r.status, 1, 'expected exit 1 when a failing file is included, got ' + r.status);
    assert.ok(/FAIL lab\/exit1\.test\.js \(\d+ms\)/.test(r.stdout), 'FAIL line for exit1 fixture missing');
    assert.ok(/PASS lab\/pass\.test\.js \(\d+ms\)/.test(r.stdout), 'PASS line for the passing sibling missing');
    assert.ok(/lab: 1 passed, 2 failed \(.+s wall, jobs=2\)/.test(r.stdout), 'summary should show 1 passed, 2 failed');
  });

  test('failure prints the captured output (bounded tail)', () => {
    const r = runSuite(tmp, 'lab');
    assert.ok(r.stdout.includes('fixture exit1'), 'captured stdout of the exit1 fixture should be echoed on failure');
    assert.ok(r.stdout.includes('boom'), 'captured throw message should be echoed on failure');
    assert.ok(/--- last 50 lines of lab\/exit1\.test\.js ---/.test(r.stdout), 'bounded-output banner missing');
  });

  test('empty tier dir -> exit 1 with a clear message (no silent pass)', () => {
    const r = runSuite(tmp, 'agents');
    assert.strictEqual(r.status, 1, 'expected exit 1 for an empty tier, got ' + r.status);
    assert.ok(/no \*\.test\.js files found/.test(r.stdout), 'expected a clear no-tests message');
  });

  test('missing tier dir -> exit 1 (treated as zero tests)', () => {
    const r = runSuite(tmp, 'runtime'); // never created under tmp
    assert.strictEqual(r.status, 1, 'expected exit 1 for a missing tier dir, got ' + r.status);
    assert.ok(/no \*\.test\.js files found/.test(r.stdout), 'expected a clear no-tests message');
  });

  test('--tier all aggregates across the populated fixture tiers -> exit 1', () => {
    const r = runSuite(tmp, 'all');
    assert.strictEqual(r.status, 1, 'all includes the failing lab tier -> exit 1, got ' + r.status);
    assert.ok(/all: 3 passed, 2 failed/.test(r.stdout), 'all-summary should count 3 pass (2 kernel + 1 lab) / 2 fail');
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

process.stdout.write('\n=== run-suite.test summary: ' + passed + ' passed, ' + failed + ' failed ===\n');
process.exit(failed === 0 ? 0 : 1);
