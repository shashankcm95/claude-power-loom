#!/usr/bin/env node

// tests/unit/kernel/spawn-state/delta-promote-demo-e2e.test.js
//
// v3.7 W3 — the demo IS the regression test. Runs the documented end-to-end
// delta-promote workflow (examples/delta-promote-demo.js --json) and asserts its
// machine-readable summary. This guards the WHOLE chain in one pass — the REAL
// producer (stageCandidate: genesis records + hidden candidate refs), the REAL
// human surface (integrate-cli fold, minting ON), the v3.7 W1 ledger (one absorbed
// -> a chained integration record; one quarantined -> a reject-event), the
// NEVER-TOUCH-HEAD invariant under the fold, and the human review-and-merge step
// — so the walkthrough doc (docs/delta-promote-walkthrough.md) can never silently
// rot relative to the code it documents.
//
// House test pattern: imperative assert + hand-rolled runner + process.exit; the
// demo is hermetic (its own temp repo) and cleans up after itself.

'use strict';

const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');

const DEMO = path.join(__dirname, '../../../../examples/delta-promote-demo.js');

let passed = 0;
let failed = 0;
// On a demo failure the execFileSync throw carries the demo's narration on
// err.stderr — surface it (bounded), else a CI failure is non-diagnosable
// (the generic "Command failed" message says nothing about WHICH step broke).
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) {
    const diag = err.stderr ? `\n    stderr: ${String(err.stderr).slice(0, 800)}` : '';
    process.stdout.write(`  FAIL ${name}: ${err.message}${diag}\n`);
    failed++;
  }
}

function gitAvailable() {
  try { execFileSync('git', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] }); return true; }
  catch { return false; }
}

test('[real git+store] E2E: the documented delta-promote demo runs clean — 3 staged, seed+clean absorbed, conflicter quarantined, 1 integration record + 1 quarantined reject-event, HEAD untouched under the fold, human merge clean, quarantine parked', () => {
  if (!gitAvailable()) { process.stdout.write('    (skipped: git unavailable)\n'); return; }
  const out = execFileSync(process.execPath, [DEMO, '--json'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000,
  });
  const s = JSON.parse(out);
  assert.strictEqual(s.stagedCandidates, 3, 'three hidden candidate refs staged');
  assert.deepStrictEqual(s.integratedIds, ['demo-seed', 'demo-logger'], 'the seed + the clean candidate are absorbed, in declared order');
  assert.deepStrictEqual(s.quarantinedIds, ['demo-conflict'], 'the conflicting candidate is quarantined');
  assert.strictEqual(s.integrationRecords, 1, 'ONE chained integration (APPEND) record — the absorb side (mechanical, display-only)');
  assert.deepStrictEqual(s.rejectEvents, [{ outcome: 'quarantined', candidate: 'demo-conflict' }], 'ONE reject-event with the integrator-decided outcome — the W1 denial source');
  assert.strictEqual(s.headUntouchedDuringFold, true, 'HEAD + working tree byte-unchanged across stage + fold (NEVER-TOUCH-HEAD)');
  assert.strictEqual(s.mergedClean, true, 'the human merge of loom/integration lands both absorbed deltas on main');
  assert.strictEqual(s.quarantineParked, true, 'the quarantined delta stays parked on loom-promote/* for manual review');
  assert.strictEqual(s.ok, true, 'the demo self-reports ok');
});

process.stdout.write(`\ndelta-promote-demo-e2e.test: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
