#!/usr/bin/env node
/**
 * counter-history-invariant.test.js — v2.9.0 Phase A.2 (FIX-I3) coverage
 *
 * TDD for the counter/history sync invariant:
 *   - _backfillSchema initializes dropped_to_cap_count = max(0, sum(verdicts) - history.length)
 *   - Invariant: sum(verdicts) == history.length + dropped_to_cap_count (equality)
 *   - Auto-reconcile on mismatch (drift_detected warning + recompute)
 *   - Cap-trim increments dropped_to_cap_count
 *   - 6-callsite enumeration: verdicts.{} reads through reconciled value
 */

'use strict';

const path = require('node:path');

const registry = require(path.resolve(__dirname, '../../../scripts/agent-team/identity/registry'));
const { _backfillSchema } = registry;

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { process.stdout.write('  PASS ' + msg + '\n'); passed++; }
  else { process.stdout.write('  FAIL ' + msg + '\n'); failed++; }
}

function mkIdentity(overrides = {}) {
  return {
    persona: '04-architect',
    name: 'test-id',
    createdAt: new Date().toISOString(),
    lastSpawnedAt: null,
    totalSpawns: 0,
    verdicts: { pass: 0, partial: 0, fail: 0 },
    specializations: [],
    skillInvocations: {},
    quality_factors_history: [],
    ...overrides,
  };
}

process.stdout.write('\n[FIX-I3] counter/history invariant + auto-reconcile\n');

// T1: _backfillSchema initializes dropped_to_cap_count to 0 for new identity
{
  const id = mkIdentity();
  _backfillSchema(id);
  assert(id.dropped_to_cap_count === 0, 'T1: fresh identity gets dropped_to_cap_count=0');
}

// T2: _backfillSchema computes dropped_to_cap_count = max(0, sum(verdicts) - history.length) for legacy
// (legacy mio-shape: 5 verdicts, 4 history entries -> dropped_to_cap_count=1)
{
  const id = mkIdentity({
    verdicts: { pass: 4, partial: 1, fail: 0 },
    quality_factors_history: [{ ts: '2026-05-01', verdict: 'pass' }, { ts: '2026-05-02', verdict: 'pass' }, { ts: '2026-05-03', verdict: 'pass' }, { ts: '2026-05-04', verdict: 'partial' }],
  });
  _backfillSchema(id);
  assert(id.dropped_to_cap_count === 1, 'T2: legacy mio-shape (5 verdicts, 4 history) -> dropped_to_cap_count=1');
}

// T3: backfilled identity preserves the invariant after backfill
{
  const id = mkIdentity({
    verdicts: { pass: 7, partial: 2, fail: 1 },
    quality_factors_history: [{ ts: '1' }, { ts: '2' }, { ts: '3' }],
  });
  _backfillSchema(id);
  const total = id.verdicts.pass + id.verdicts.partial + id.verdicts.fail;
  const invariant = total === id.quality_factors_history.length + id.dropped_to_cap_count;
  assert(invariant, 'T3: invariant holds post-backfill (sum=10, history=3, dropped=7 -> 10==3+7)');
}

// T4: invariant violated by external mutation -> reconcile fires
{
  const id = mkIdentity({
    verdicts: { pass: 5, partial: 0, fail: 0 },
    quality_factors_history: [{ ts: '1' }, { ts: '2' }, { ts: '3' }, { ts: '4' }],
    dropped_to_cap_count: 0,
  });
  // External mutation broke invariant: 5 != 4 + 0
  // _backfillSchema should auto-reconcile by adjusting dropped_to_cap_count
  _backfillSchema(id);
  const total = id.verdicts.pass + id.verdicts.partial + id.verdicts.fail;
  const invariant = total === id.quality_factors_history.length + id.dropped_to_cap_count;
  assert(invariant, 'T4: auto-reconcile on invariant violation (5 verdicts, 4 history -> dropped=1)');
}

// T5: cap-trim simulation (manually trim history; verify _backfillSchema reconciles)
{
  const history = Array.from({ length: 55 }, (_, i) => ({ ts: String(i) }));
  const id = mkIdentity({
    verdicts: { pass: 55, partial: 0, fail: 0 },
    quality_factors_history: history.slice(-50), // cap-trim happened externally
    dropped_to_cap_count: 0,
  });
  _backfillSchema(id);
  const total = id.verdicts.pass + id.verdicts.partial + id.verdicts.fail;
  const invariant = total === id.quality_factors_history.length + id.dropped_to_cap_count;
  assert(invariant && id.dropped_to_cap_count === 5,
    'T5: cap-trim reconciliation (55 verdicts, 50 history -> dropped=5)');
}

// T6: drift_detected warning emitted on read with invariant violation (BEFORE reconcile)
{
  const id = mkIdentity({
    verdicts: { pass: 10, partial: 0, fail: 0 },
    quality_factors_history: [],
    dropped_to_cap_count: 0,
  });
  // Capture stderr
  let stderrCaptured = '';
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => { stderrCaptured += chunk; return true; };
  try {
    _backfillSchema(id);
  } finally {
    process.stderr.write = origWrite;
  }
  // Either: warn fired (drift_detected) OR auto-reconcile fixed it (post-fix invariant must hold)
  // Both are acceptable per design; the load-bearing requirement is the invariant.
  const total = id.verdicts.pass + id.verdicts.partial + id.verdicts.fail;
  const invariant = total === id.quality_factors_history.length + id.dropped_to_cap_count;
  const warnFired = /drift_detected|invariant/i.test(stderrCaptured);
  assert(invariant && warnFired, 'T6: invariant violation fires drift_detected warning + auto-reconciles (warn:' + warnFired + ' invariant:' + invariant + ')');
}

// T7: _backfillSchema is idempotent (running twice doesn't double-count)
{
  const id = mkIdentity({
    verdicts: { pass: 5, partial: 0, fail: 0 },
    quality_factors_history: [{ ts: '1' }, { ts: '2' }, { ts: '3' }],
  });
  _backfillSchema(id);
  const after1 = id.dropped_to_cap_count;
  _backfillSchema(id);
  const after2 = id.dropped_to_cap_count;
  assert(after1 === after2 && after1 === 2, 'T7: _backfillSchema idempotent (drop=2 both times)');
}

// T8: helper getTotalVerdicts returns the reconciled value
{
  // (Skip if helper not exported)
  const helperName = 'reconciledVerdictsTotal';
  if (typeof registry[helperName] === 'function') {
    const id = mkIdentity({
      verdicts: { pass: 5, partial: 0, fail: 0 },
      quality_factors_history: [{ ts: '1' }, { ts: '2' }, { ts: '3' }],
    });
    _backfillSchema(id);
    const total = registry[helperName](id);
    assert(total === 5, 'T8: reconciledVerdictsTotal returns 5');
  } else {
    process.stdout.write('  SKIP T8: reconciledVerdictsTotal helper not exported yet (optional);\n');
  }
}

process.stdout.write('\n=== Summary ===\n');
process.stdout.write('  Passed: ' + passed + '\n');
process.stdout.write('  Failed: ' + failed + '\n');

if (failed > 0) process.exit(1);
