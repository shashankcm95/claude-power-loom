#!/usr/bin/env node

// tests/unit/kernel/_lib/manage-op-record.test.js
//
// v3.6 Wave 2a — buildManageOpRecord: the genesis-rooted COMMITTED SUPERSEDE/TOMBSTONE builder for the
// human-gated manage-promote. Mirrors quarantine-promote.buildSpawnRecord but for a manage op:
//   - operation_class SUPERSEDE/TOMBSTONE (state-changing); affected_records = the targets (NOT evidence_refs);
//   - post_state_hash null (a logical op — no git tree; the architect VERIFY confirmed this is the HONEST choice);
//   - evidence_refs = [USER_INTENT_AXIOM:<sha256(canonical(approved-proposal))>] (the A10 bootstrap = the human approval);
//   - writer_persona_id 'lab:manage-promote' (VERIFY: Lab-originated, never claims kernel authorship);
//   - writer_spawn_id derived from proposalId internally (VERIFY MED-1: the INV-22 binding is checked, not assumed).

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const K = (...a) => path.join(REPO_ROOT, 'packages', 'kernel', '_lib', ...a);
const { buildManageOpRecord } = require(K('manage-op-record.js'));
const {
  computeTransactionId, deriveIdempotencyKey, validateTransactionRecord, isBootstrapSentinel,
} = require(K('transaction-record.js'));
const { canonicalJsonSerialize } = require(K('canonical-json.js'));
const { appendRecord, readById } = require(K('record-store.js'));

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hx = (ch) => ch.repeat(64);
const T0 = '2026-06-08T00:00:00.000Z';

// A minimal approved proposal (the axiom is sha256 of its canonical body).
const proposal = (targets) => ({
  node_type: 'manage-proposal', op_type: 'cull', target_records: targets, disposition: 'approved',
  proposal_id: sha256(canonicalJsonSerialize(['cull', ...targets])), justification: 'stale', proposer_origin: 't',
});
const build = (over = {}) => {
  const p = over.proposal || proposal([hx('a')]);
  return buildManageOpRecord({
    operationClass: 'TOMBSTONE',
    affectedRecords: p.target_records,
    proposalId: p.proposal_id,
    approvalAxiomHash: sha256(canonicalJsonSerialize(p)),
    schemaVersion: 'v6',
    nowIso: T0,
    ...over.fields,
  });
};

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; } catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

test('builds a genesis-valid TOMBSTONE: shape + COMMITTED + lab persona + null post_state_hash', () => {
  const r = build();
  assert.strictEqual(r.operation_class, 'TOMBSTONE');
  assert.strictEqual(r.commit_outcome, 'COMMITTED');
  assert.strictEqual(r.writer_persona_id, 'lab:manage-promote'); // VERIFY: never 'kernel:'
  assert.strictEqual(r.post_state_hash, null);                   // a logical op, no git tree
  assert.deepStrictEqual(r.affected_records, [hx('a')]);         // targets in affected_records
  assert.strictEqual(validateTransactionRecord(r, { isGenesisPosition: true }).valid, true);
});

test('evidence_refs is the USER_INTENT_AXIOM bootstrap bound to the proposal (A10; sentinel-valid)', () => {
  const p = proposal([hx('a')]);
  const r = build({ proposal: p });
  assert.strictEqual(r.evidence_refs[0], `USER_INTENT_AXIOM:${sha256(canonicalJsonSerialize(p))}`);
  assert.ok(isBootstrapSentinel(r.evidence_refs[0]));
});

test('writer_spawn_id is derived from proposalId internally (the INV-22 binding)', () => {
  const p = proposal([hx('a')]);
  assert.strictEqual(build({ proposal: p }).writer_spawn_id, `manage-promote:${p.proposal_id}`);
});

test('transaction_id + idempotency_key are verified content-addresses (appendRecord will accept)', () => {
  const r = build();
  assert.strictEqual(r.transaction_id, computeTransactionId(r));
  assert.strictEqual(deriveIdempotencyKey(r), r.idempotency_key);
});

test('round-trips through appendRecord (S5 + INV-22 pass) + readById', () => {
  const TMP = path.join(os.tmpdir(), 'mor-' + crypto.randomBytes(5).toString('hex'));
  fs.mkdirSync(TMP, { recursive: true });
  const r = build();
  const res = appendRecord(r, { runId: 'run0', stateDir: TMP });
  assert.strictEqual(res.ok, true, JSON.stringify(res));
  assert.deepStrictEqual(readById(r.transaction_id, { runId: 'run0', stateDir: TMP }).affected_records, [hx('a')]);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('different proposals -> different idempotency_key (no cross-target poison via the key)', () => {
  const a = build({ proposal: proposal([hx('a')]) });
  const b = build({ proposal: proposal([hx('b')]) });
  assert.notStrictEqual(a.idempotency_key, b.idempotency_key);
});

test('same proposal, later nowIso -> SAME idempotency_key (re-promote dedups), different transaction_id', () => {
  const p = proposal([hx('a')]);
  const r1 = build({ proposal: p });
  const r2 = build({ proposal: p, fields: { nowIso: '2026-06-09T00:00:00.000Z' } });
  assert.strictEqual(r1.idempotency_key, r2.idempotency_key); // INV-22: same transaction
  assert.notStrictEqual(r1.transaction_id, r2.transaction_id); // distinct intent_recorded_at
});

test('rejects a non-hex approvalAxiomHash (the sentinel must be valid) + an empty affectedRecords', () => {
  assert.throws(() => build({ fields: { approvalAxiomHash: 'not-hex' } }));
  assert.throws(() => buildManageOpRecord({
    operationClass: 'TOMBSTONE', affectedRecords: [], proposalId: hx('a'),
    approvalAxiomHash: hx('a'), schemaVersion: 'v6', nowIso: T0,
  }));
});

test('rejects an invalid operationClass (only SUPERSEDE/TOMBSTONE)', () => {
  assert.throws(() => build({ fields: { operationClass: 'CREATE' } }));
});

process.stdout.write(`\nmanage-op-record.test.js (v3.6 W2a): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
