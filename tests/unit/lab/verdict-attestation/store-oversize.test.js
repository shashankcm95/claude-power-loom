#!/usr/bin/env node

// tests/unit/lab/verdict-attestation/store-oversize.test.js
//
// H1 (deep fix) — the verdict-attestation store survives a ledger past the byte bound WITHOUT the
// write-path RMW losing data. Sets a TINY LOOM_LAB_MAX_LEDGER_BYTES before requiring the store so the
// tail-read path triggers deterministically (no 64MB fixture). The CRITICAL constraint: readLedger on
// an oversized file returns the newest TAIL (never []), so recordVerdict's read-modify-write keeps
// newest + adds the new record — it must NOT wipe the ledger to just the one new record.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TMP = path.join(os.tmpdir(), 'w2-vstore-oversize-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = TMP;
process.env.LOOM_LAB_MAX_LEDGER_BYTES = '2048'; // tiny → exercise the tail-read path
fs.mkdirSync(TMP, { recursive: true });

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const store = require(path.join(REPO_ROOT, 'packages', 'lab', 'verdict-attestation', 'store.js'));

const NOW = '2026-06-04T00:00:00.000Z';
let passed = 0; let failed = 0;
function test(name, fn) {
  try { fs.rmSync(store.LEDGER_PATH, { force: true }); } catch { /* */ }
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

function seedOversize(n) {
  fs.mkdirSync(store.STORE_DIR, { recursive: true });
  const lines = [];
  for (let i = 0; i < n; i += 1) {
    lines.push(JSON.stringify({
      attestation_id: 'seed' + i, schema_version: 'v3.4', verdict: 'pass',
      subject: { persona: 'p' }, verifier: { identity: 'v' + i, kind: 'structural' },
      evidence_refs: { agent_id: 'a' + i, run_id: 'r', transaction_id: 'tx' + i, record_status: 'appended' },
      recorded_at: NOW, expires_after_days: 365,
    }));
  }
  fs.writeFileSync(store.LEDGER_PATH, lines.join('\n') + '\n');
  return fs.statSync(store.LEDGER_PATH).size;
}

test('★ H1: oversized ledger → listVerdicts tail-reads (NOT [], NOT a throw)', () => {
  const size = seedOversize(100);
  assert.ok(size > 2048, 'fixture exceeds the tiny byte bound');
  const live = store.listVerdicts({ now: NOW });
  assert.ok(live.length > 0, 'NOT [] — the oversized ledger is tail-read, not silently wiped');
  assert.ok(live.length < 100, 'tail only — older records beyond the byte bound not loaded');
});

test('★ CRITICAL: a recordVerdict RMW on an oversized ledger keeps the newest tail (no data loss to [])', () => {
  seedOversize(100);
  const before = store.listVerdicts({ now: NOW }).length;
  assert.ok(before > 1, 'precondition: the tail has multiple records');
  store.recordVerdict({ verdict: 'pass', subject: { persona: 'p' }, verifier: { identity: 'NEW', kind: 'structural' }, agentId: 'aNEW', now: NOW });
  const after = store.listVerdicts({ now: NOW });
  assert.ok(after.length > 1, 'the RMW preserved the tail + added the new record — did NOT wipe to just the 1 new');
  assert.ok(after.some((r) => r.evidence_refs.agent_id === 'aNEW'), 'the new record landed');
  assert.ok(after.some((r) => r.attestation_id === 'seed99'), 'a known prior tail record (seed99) survived the RMW');
});

process.stdout.write(`\nstore-oversize.test.js (verdict-attestation): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
