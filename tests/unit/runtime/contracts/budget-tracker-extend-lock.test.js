#!/usr/bin/env node

// tests/unit/runtime/contracts/budget-tracker-extend-lock.test.js
//
// Regression for budget-cmdextend-lock: cmdExtend in budget-tracker.js did a
// read-modify-write of the budget state WITHOUT withBudgetLock (the same lock
// cmdRecord + enterDepth/exitDepth already use), creating a lost-update race —
// a concurrent extender's increment is clobbered (last writer wins).
//
// This test fires N TRULY concurrent `extend` subprocesses against a single
// seeded budget entry and asserts every extension lands (extensionsUsed == N
// and the extensionsLog has N entries). Against the OLD unlocked code the count
// comes out < N: multiple processes load the same pre-increment state, then
// serialize their writes, so the last writer wins and the others' increments
// are lost. Run-state is isolated to a tmp HETS_RUN_STATE_DIR per child.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const BUDGET_TRACKER = path.join(
  REPO_ROOT, 'packages', 'runtime', 'orchestration', 'budget-tracker.js',
);

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// Seed a budget file with one entry that allows plenty of extensions, so the
// race (not a maxExtensions cap) is what the assertion measures.
function seedBudgets(stateDir, runId, identity, maxExtensions) {
  const dir = path.join(stateDir, runId);
  fs.mkdirSync(dir, { recursive: true });
  const data = {
    runId,
    createdAt: '2026-06-18T00:00:00.000Z',
    spawns: {
      [identity]: {
        persona: identity.split('.').slice(0, -1).join('.'),
        identity,
        contractPath: null,
        budgetTokens: 30000,
        extensible: true,
        maxExtensions,
        extensionAmount: 1000,
        extensionsUsed: 0,
        tokensInput: 0,
        tokensOutput: 0,
        totalTokens: 0,
        extensionsLog: [],
        recordedAt: '2026-06-18T00:00:00.000Z',
      },
    },
  };
  fs.writeFileSync(path.join(dir, 'budgets.json'), JSON.stringify(data, null, 2));
  return path.join(dir, 'budgets.json');
}

// Launch all N children at once (non-blocking spawn) so they truly race on the
// budget file; resolve when every child has exited.
function runConcurrentExtends(stateDir, runId, identity, n) {
  const launches = [];
  for (let i = 0; i < n; i++) {
    launches.push(new Promise((resolve) => {
      const child = spawn('node', [
        BUDGET_TRACKER, 'extend',
        '--run-id', runId,
        '--identity', identity,
        '--reason', 'concurrent-' + i,
      ], {
        env: { ...process.env, HETS_RUN_STATE_DIR: stateDir },
        stdio: 'ignore',
      });
      child.on('exit', (code) => resolve(code));
      child.on('error', () => resolve(-1));
    }));
  }
  return Promise.all(launches);
}

async function main() {
  const stateDir = path.join(os.tmpdir(), 'budget-extend-' + crypto.randomBytes(6).toString('hex'));
  const runId = 'run-extend-race';
  const identity = '01-hacker.test';
  const N = 12;
  const budgetFile = seedBudgets(stateDir, runId, identity, N + 5);

  let exitCodes;
  try {
    exitCodes = await runConcurrentExtends(stateDir, runId, identity, N);
    test('concurrent extend: every child approved its extension', () => {
      const approvals = exitCodes.filter((c) => c === 0).length;
      assert.strictEqual(approvals, N, `expected ${N} approvals, got ${approvals}`);
    });
    test('concurrent extend: no lost updates (extensionsUsed == N)', () => {
      const final = JSON.parse(fs.readFileSync(budgetFile, 'utf8'));
      const entry = final.spawns[identity];
      assert.strictEqual(entry.extensionsUsed, N,
        `lost-update race: extensionsUsed=${entry.extensionsUsed}, expected ${N}`);
      assert.strictEqual(entry.extensionsLog.length, N,
        `lost-update race: extensionsLog has ${entry.extensionsLog.length} entries, expected ${N}`);
    });
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

main().then(() => {
  process.stdout.write(`\nbudget-tracker-extend-lock.test.js: ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
});
