#!/usr/bin/env node

// tests/unit/runtime/contracts/budget-tracker-boundary-hardening.test.js
//
// Two boundary guards in budget-tracker.js, both from the bug-bounty audit:
//
//   1. cmdExtend maxExtensions cap was a TOCTOU: the approve/deny decision was
//      computed from the PRE-lock read, so N concurrent extenders all passed the
//      `extensionsUsed >= maxExtensions` check before any incremented, then all
//      incremented inside their serialized locks — extensionsUsed climbs past the
//      cap while every call reports "approve". The fix re-checks the cap against
//      the fresh read INSIDE withBudgetLock. This test seeds maxExtensions=1,
//      fires N concurrent extends, and asserts exactly ONE approval + the cap
//      holds (extensionsUsed == 1). Against the OLD code all N approve.
//
//   2. cmdRecord accepted negative token counts (only NaN was rejected), letting
//      a caller deflate recorded usage below the true total and mask an
//      over-budget spawn. The fix rejects ti<0 || to<0 at the boundary.
//
// Run-state is isolated to a tmp HETS_RUN_STATE_DIR (module-load capture in the
// child), so the real ~/.claude ledger is never touched.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

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

// Launch all N children at once so they truly race on the budget file.
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
  const stateDir = path.join(os.tmpdir(), 'budget-harden-' + crypto.randomBytes(6).toString('hex'));
  try {
    // ---- Guard 1: extend cap holds under concurrency (TOCTOU) ----
    const runId = 'run-extend-cap';
    const identity = '01-hacker.test';
    const N = 12;
    const budgetFile = seedBudgets(stateDir, runId, identity, 1); // cap = 1
    const exitCodes = await runConcurrentExtends(stateDir, runId, identity, N);

    test('extend cap: exactly ONE approval under N concurrent requests', () => {
      const approvals = exitCodes.filter((c) => c === 0).length;
      assert.strictEqual(approvals, 1, `TOCTOU: expected 1 approval, got ${approvals}`);
    });
    test('extend cap: maxExtensions honored (extensionsUsed == 1)', () => {
      const final = JSON.parse(fs.readFileSync(budgetFile, 'utf8'));
      const entry = final.spawns[identity];
      assert.strictEqual(entry.extensionsUsed, 1,
        `cap bypass: extensionsUsed=${entry.extensionsUsed}, expected 1`);
      assert.strictEqual(entry.extensionsLog.length, 1,
        `cap bypass: extensionsLog has ${entry.extensionsLog.length} entries, expected 1`);
    });

    // ---- Guard 2: cmdRecord rejects negative token counts ----
    const runId2 = 'run-negtok';
    const identity2 = '01-hacker.neg';
    const budgetFile2 = seedBudgets(stateDir, runId2, identity2, 3);
    const res = spawnSync('node', [
      BUDGET_TRACKER, 'record',
      '--run-id', runId2,
      '--identity', identity2,
      '--tokens-input', '-5000',
      '--tokens-output', '10',
    ], { env: { ...process.env, HETS_RUN_STATE_DIR: stateDir }, encoding: 'utf8' });

    test('record: negative --tokens-input is rejected (non-zero exit + message)', () => {
      assert.notStrictEqual(res.status, 0, `expected non-zero exit, got ${res.status}`);
      assert.ok(/non-negative/.test(res.stderr || ''),
        `expected a 'non-negative' error, got stderr=${JSON.stringify(res.stderr)}`);
    });
    test('record: rejected negative record does NOT mutate usage', () => {
      const final = JSON.parse(fs.readFileSync(budgetFile2, 'utf8'));
      const entry = final.spawns[identity2];
      assert.strictEqual(entry.tokensInput, 0, `usage mutated: tokensInput=${entry.tokensInput}`);
      assert.strictEqual(entry.totalTokens, 0, `usage mutated: totalTokens=${entry.totalTokens}`);
    });
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

main().then(() => {
  process.stdout.write(`\nbudget-tracker-boundary-hardening.test.js: ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
});
