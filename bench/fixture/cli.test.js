#!/usr/bin/env node

// bench/fixture/cli.test.js — smoke test for the fixture CLI.
//
// Tiny self-contained test runner (no Jest/Mocha dep). Tests existing list+add
// commands. The boot task asks Claude to ADD a test for the new `export`
// feature here — exercising the toolkit's testing rules (workflow.md).

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, 'cli.js');
const DATA_FILE = path.join(__dirname, 'todos.json');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    process.stdout.write(`  PASS ${name}\n`);
    passed++;
  } catch (err) {
    process.stdout.write(`  FAIL ${name}: ${err.message}\n`);
    failed++;
  }
}

function reset() {
  if (fs.existsSync(DATA_FILE)) fs.unlinkSync(DATA_FILE);
}

function runCli(args) {
  return spawnSync('node', [CLI, ...args], { encoding: 'utf8' });
}

test('list with no data → "(no todos)"', () => {
  reset();
  const r = runCli(['list']);
  if (r.status !== 0) throw new Error(`exit ${r.status}`);
  if (!r.stdout.includes('(no todos)')) throw new Error(`stdout: ${r.stdout}`);
});

test('add → assigns id 1', () => {
  reset();
  const r = runCli(['add', 'first item']);
  if (r.status !== 0) throw new Error(`exit ${r.status}`);
  if (!r.stdout.includes('added: 1')) throw new Error(`stdout: ${r.stdout}`);
});

test('add x2 → list shows both', () => {
  reset();
  runCli(['add', 'first']);
  runCli(['add', 'second']);
  const r = runCli(['list']);
  if (!r.stdout.includes('first') || !r.stdout.includes('second')) {
    throw new Error(`stdout: ${r.stdout}`);
  }
});

reset();
process.stdout.write(`\n  Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
