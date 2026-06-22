#!/usr/bin/env node

// tests/unit/lab/issue-corpus/cost-ledger.test.js
//
// ③.2.2b — the actor cost-guard (the RED set). Locks: parseCostFromStreamJson (+ fail-safe null, last
// finite wins), the ledger round-trip with a SURFACED malformed-line count (VERIFY hacker #5), the
// fail-CLOSED budget guard on BOTH over-cap AND a corrupt ledger, the frozen cap + frozen estimate, and
// the secret-hygiene invariant (the API key VALUE never lands in a ledger line). No daemon, no network.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const L = require(path.join(REPO, 'packages', 'lab', 'issue-corpus', 'cost-ledger.js'));
const {
  resolveBudgetCap, parseCostFromStreamJson, readLedgerTotal, recordCost,
  assertWithinBudget, resolveActorApiKey, DEFAULT_COST_CAP_USD, DEFAULT_ESTIMATED_USD,
} = L;

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

function tmpLedger() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-ledger-test-'));
  return { dir, ledgerPath: path.join(dir, 'cost-ledger.jsonl') };
}
function cleanup(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } }

const RESULT_EVENT = { type: 'result', subtype: 'success', total_cost_usd: 0.0273 };

// ── parseCostFromStreamJson ──
test('p1. parses total_cost_usd from a stream-json NDJSON string (last result wins)', () => {
  const ndjson = [
    JSON.stringify({ type: 'system' }),
    JSON.stringify({ type: 'assistant' }),
    JSON.stringify(RESULT_EVENT),
  ].join('\n');
  assert.strictEqual(parseCostFromStreamJson(ndjson), 0.0273);
});
test('p2. parses from a parsed events array', () => {
  assert.strictEqual(parseCostFromStreamJson([{ type: 'system' }, RESULT_EVENT]), 0.0273);
});
test('p3. the LAST finite cost wins (a later result supersedes)', () => {
  assert.strictEqual(parseCostFromStreamJson([RESULT_EVENT, { type: 'result', total_cost_usd: 0.99 }]), 0.99);
});
test('p4. fail-safe null on an absent/non-finite cost (NEVER a fabricated 0)', () => {
  assert.strictEqual(parseCostFromStreamJson([{ type: 'result' }]), null);
  assert.strictEqual(parseCostFromStreamJson([{ type: 'result', total_cost_usd: 'NaN' }]), null);
  assert.strictEqual(parseCostFromStreamJson(''), null);
  assert.strictEqual(parseCostFromStreamJson(null), null);
  assert.strictEqual(parseCostFromStreamJson('{ not json'), null);
});

// ── readLedgerTotal ──
test('r1. an absent ledger is empty { total: 0, malformed: 0 }', () => {
  const { dir, ledgerPath } = tmpLedger();
  try { assert.deepStrictEqual(readLedgerTotal({ ledgerPath }), { total: 0, malformed: 0 }); }
  finally { cleanup(dir); }
});
test('r2. sums valid costUsd lines, skips blank lines', () => {
  const { dir, ledgerPath } = tmpLedger();
  try {
    fs.writeFileSync(ledgerPath, `${JSON.stringify({ costUsd: 0.1 })}\n\n${JSON.stringify({ costUsd: 0.25 })}\n`);
    assert.deepStrictEqual(readLedgerTotal({ ledgerPath }), { total: 0.35, malformed: 0 });
  } finally { cleanup(dir); }
});
test('r3. SURFACES the malformed-line count (bad JSON / missing / non-finite costUsd)', () => {
  const { dir, ledgerPath } = tmpLedger();
  try {
    fs.writeFileSync(ledgerPath, [
      JSON.stringify({ costUsd: 0.5 }),
      '{ truncated',
      JSON.stringify({ runId: 'x' }),            // missing costUsd
      JSON.stringify({ costUsd: 'free' }),        // non-finite
    ].join('\n'));
    const out = readLedgerTotal({ ledgerPath });
    assert.strictEqual(out.total, 0.5);
    assert.strictEqual(out.malformed, 3);
  } finally { cleanup(dir); }
});

// ── recordCost ──
test('c1. appends a record; cumulative is RE-DERIVED from the prior on-disk total', () => {
  const { dir, ledgerPath } = tmpLedger();
  try {
    const a = recordCost({ ledgerPath, runId: 'run1', issueId: 'o__r-issue-1', costUsd: 0.10, now: 0 });
    const b = recordCost({ ledgerPath, runId: 'run2', issueId: 'o__r-issue-2', costUsd: 0.25, now: 1000 });
    assert.strictEqual(a.cumulativeUsd, 0.10);
    assert.strictEqual(b.cumulativeUsd, 0.35);
    assert.strictEqual(readLedgerTotal({ ledgerPath }).total, 0.35);
    assert.strictEqual(a.ts, '1970-01-01T00:00:00.000Z'); // injected now → deterministic
  } finally { cleanup(dir); }
});
test('c2. rejects a non-finite costUsd', () => {
  const { dir, ledgerPath } = tmpLedger();
  try { assert.throws(() => recordCost({ ledgerPath, costUsd: NaN }), /finite/); }
  finally { cleanup(dir); }
});
test('c3. the ledger file is written chmod 600 (host-only secret-adjacent hygiene)', () => {
  const { dir, ledgerPath } = tmpLedger();
  try {
    recordCost({ ledgerPath, costUsd: 0.01, now: 0 });
    const mode = fs.statSync(ledgerPath).mode & 0o777;
    assert.strictEqual(mode, 0o600, `expected 600, got ${mode.toString(8)}`);
  } finally { cleanup(dir); }
});

// ── resolveBudgetCap (frozen default) ──
test('b1. resolveBudgetCap reads a valid env, else fail-safes to the $20 default', () => {
  const saved = process.env.LOOM_COST_CAP_USD;
  try {
    process.env.LOOM_COST_CAP_USD = '5';
    assert.strictEqual(resolveBudgetCap(), 5);
    process.env.LOOM_COST_CAP_USD = '0';      // <= 0 can NEVER fail-open
    assert.strictEqual(resolveBudgetCap(), DEFAULT_COST_CAP_USD);
    process.env.LOOM_COST_CAP_USD = 'abc';     // non-finite
    assert.strictEqual(resolveBudgetCap(), DEFAULT_COST_CAP_USD);
    delete process.env.LOOM_COST_CAP_USD;       // absent
    assert.strictEqual(resolveBudgetCap(), 20);
  } finally { if (saved === undefined) delete process.env.LOOM_COST_CAP_USD; else process.env.LOOM_COST_CAP_USD = saved; }
});

// ── assertWithinBudget (fail-closed on BOTH over-cap AND corrupt ledger) ──
test('g1. passes when projected (total + frozen estimate) is under cap', () => {
  const { dir, ledgerPath } = tmpLedger();
  try {
    recordCost({ ledgerPath, costUsd: 1.0, now: 0 });
    const r = assertWithinBudget({ ledgerPath, capUsd: 20 });
    assert.strictEqual(r.ok, true);
    assert.ok(Math.abs(r.projected - (1.0 + DEFAULT_ESTIMATED_USD)) < 1e-9);
    assert.strictEqual(r.warn, false);
  } finally { cleanup(dir); }
});
test('g2. REFUSES (throws) when projected exceeds the cap', () => {
  const { dir, ledgerPath } = tmpLedger();
  try {
    recordCost({ ledgerPath, costUsd: 19.5, now: 0 });
    assert.throws(() => assertWithinBudget({ ledgerPath, capUsd: 20 }), /REFUSE.*cap.*fail-closed/);
  } finally { cleanup(dir); }
});
test('g3. fail-CLOSED on a corrupt ledger (malformed > 0 → REFUSE, never undercount)', () => {
  const { dir, ledgerPath } = tmpLedger();
  try {
    fs.writeFileSync(ledgerPath, `${JSON.stringify({ costUsd: 0.1 })}\n{ corrupted line\n`);
    assert.throws(() => assertWithinBudget({ ledgerPath, capUsd: 20 }), /REFUSE.*malformed.*fail-closed/);
  } finally { cleanup(dir); }
});
test('g5. VALIDATE hacker H1 — a finite NEGATIVE costUsd is malformed (cannot subtract the total below the cap)', () => {
  const { dir, ledgerPath } = tmpLedger();
  try {
    // a real $19.9 spend + a crafted negative line that would sink the total to -30.1 and fail OPEN.
    fs.writeFileSync(ledgerPath, `${JSON.stringify({ costUsd: 19.9 })}\n${JSON.stringify({ costUsd: -50 })}\n`);
    const out = readLedgerTotal({ ledgerPath });
    assert.strictEqual(out.total, 19.9);   // the negative line does NOT subtract
    assert.strictEqual(out.malformed, 1);  // it is counted malformed
    assert.throws(() => assertWithinBudget({ ledgerPath, capUsd: 20 }), /REFUSE.*malformed.*fail-closed/);
  } finally { cleanup(dir); }
});
test('g6. recordCost rejects a negative costUsd', () => {
  const { dir, ledgerPath } = tmpLedger();
  try { assert.throws(() => recordCost({ ledgerPath, costUsd: -1 }), /non-negative/); }
  finally { cleanup(dir); }
});
test('g4. warns at >= 80% of the cap (without refusing)', () => {
  const { dir, ledgerPath } = tmpLedger();
  try {
    recordCost({ ledgerPath, costUsd: 15.0, now: 0 });
    const r = assertWithinBudget({ ledgerPath, capUsd: 20, estimatedUsd: 1.0 }); // projected 16 = 80%
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.warn, true);
  } finally { cleanup(dir); }
});

// ── resolveActorApiKey ──
test('k1. reads + trims the key file; absent/empty → null', () => {
  const { dir } = tmpLedger();
  try {
    const keyPath = path.join(dir, 'anthropic-api-key');
    fs.writeFileSync(keyPath, '  sk-ant-EXAMPLE\n');
    assert.strictEqual(resolveActorApiKey({ keyPath }), 'sk-ant-EXAMPLE');
    fs.writeFileSync(keyPath, '   \n');
    assert.strictEqual(resolveActorApiKey({ keyPath }), null);
    assert.strictEqual(resolveActorApiKey({ keyPath: path.join(dir, 'nope') }), null);
  } finally { cleanup(dir); }
});

// ── secret hygiene (EC.b6): the API key VALUE never lands in a ledger line ──
test('s1. recordCost writes only cost fields — no sk- substring even if an issueId looks key-ish', () => {
  const { dir, ledgerPath } = tmpLedger();
  try {
    recordCost({ ledgerPath, runId: 'run', issueId: 'owner__repo-issue-1', costUsd: 0.02, now: 0 });
    const raw = fs.readFileSync(ledgerPath, 'utf8');
    assert.ok(!/sk-ant-/.test(raw), 'ledger must never contain an API key');
    const rec = JSON.parse(raw.trim());
    assert.deepStrictEqual(Object.keys(rec).sort(), ['costUsd', 'cumulativeUsd', 'issueId', 'runId', 'ts']);
  } finally { cleanup(dir); }
});

process.on('exit', () => {
  process.stdout.write(`\ncost-ledger: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
});
