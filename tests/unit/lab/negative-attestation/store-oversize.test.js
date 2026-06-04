#!/usr/bin/env node

// tests/unit/lab/negative-attestation/store-oversize.test.js
//
// H1 (deep fix) — the negative-attestation (E1) store survives a ledger past the byte bound WITHOUT
// the write-path RMW losing data. Same shape as the verdict-attestation oversize test: a tiny
// LOOM_LAB_MAX_LEDGER_BYTES triggers the tail-read; readLedger returns the newest TAIL (never []), so
// recordAttestation's read-modify-write keeps the recent witnesses and self-heals the flooded ledger.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TMP = path.join(os.tmpdir(), 'w2-nstore-oversize-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = TMP;
process.env.LOOM_LAB_MAX_LEDGER_BYTES = '2048';
fs.mkdirSync(TMP, { recursive: true });

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const store = require(path.join(REPO_ROOT, 'packages', 'lab', 'negative-attestation', 'store.js'));

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
      attestation_id: 'seed' + i, schema_version: 'v3.3',
      failure_signature: { failed_criterion_id: 'cost-justified', discipline: 'spec-driven', verifier_kind: 'structural' },
      identity: { subagent_type: 'p', task_signature: null, tags: [] },
      run_id: 'r' + i, recorded_at: NOW, expires_after_days: 365,
    }));
  }
  fs.writeFileSync(store.LEDGER_PATH, lines.join('\n') + '\n');
  return fs.statSync(store.LEDGER_PATH).size;
}

test('★ H1: oversized ledger → listAttestations tail-reads (NOT [], NOT a throw)', () => {
  const size = seedOversize(100);
  assert.ok(size > 2048, 'fixture exceeds the tiny byte bound');
  const live = store.listAttestations({ now: NOW });
  assert.ok(live.length > 0 && live.length < 100, 'tail only — not [] and not the whole file');
});

test('★ CRITICAL: a recordAttestation RMW on an oversized ledger keeps the newest tail (no data loss)', () => {
  seedOversize(100);
  assert.ok(store.listAttestations({ now: NOW }).length > 1, 'precondition: tail has multiple records');
  store.recordAttestation({
    failureSignature: { failed_criterion_id: 'cost-justified' },
    identity: { subagentType: 'p' }, runId: 'rNEW', leafRef: 'lNEW', now: NOW,
  });
  const after = store.listAttestations({ now: NOW });
  assert.ok(after.length > 1, 'the RMW preserved the tail + added the new witness — did NOT wipe to just the 1 new');
  assert.ok(after.some((r) => r.run_id === 'rNEW'), 'the new witness landed');
  assert.ok(after.some((r) => r.attestation_id === 'seed99'), 'a known prior tail record (seed99) survived the RMW');
});

process.stdout.write(`\nstore-oversize.test.js (negative-attestation): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
