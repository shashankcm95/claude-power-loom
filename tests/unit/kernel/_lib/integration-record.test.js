#!/usr/bin/env node

// tests/unit/kernel/_lib/integration-record.test.js
//
// PR-P3c-c — the BEHAVIORAL SPEC (written test-first, TDD) for the NON-GENESIS
// chained-record builder:
//
//     packages/kernel/_lib/integration-record.js   (NEW — not yet written)
//
// buildChainedRecord mints the integrator's non-genesis APPEND record: prev_state_hash
// = the parent's STORED post (the M1/Case-E seam, NOT a recompute), post_state_hash
// EXPLICIT (= computePostStateHash(mergedTree)), head_anchor:null, evidence_refs =
// [the candidate's genesis record transaction_id] (an A10-satisfying, R10-unverified
// back-reference). Validated isGenesisPosition:false (fail-fast); it round-trips
// through appendRecord + readByPostStateHash, and a chained record (prev = a stored
// genesis post) walks to genesis depthWalked:1.
//
// House test pattern: imperative assert + hand-rolled runner + process.exit.

'use strict';

const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');

// The module under test (NOT YET WRITTEN — this require is why the suite is RED).
const { buildChainedRecord, KERNEL_INTEGRATOR_PERSONA } = require('../../../../packages/kernel/_lib/integration-record');

const { computePostStateHash, computeTransactionId, validateTransactionRecord } = require('../../../../packages/kernel/_lib/transaction-record');
const { buildSpawnRecord } = require('../../../../packages/kernel/_lib/quarantine-promote');
const { appendRecord, readByPostStateHash } = require('../../../../packages/kernel/_lib/record-store');
const { checkEvidenceLinkPreCommit } = require('../../../../packages/kernel/_lib/k9-promote-deltas');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

const SV = 'v3';
const PERSONA = '13-node-backend.tester';
const prevPost = computePostStateHash('a'.repeat(40));
const post = computePostStateHash('b'.repeat(40));
const evidenceTxid = 'c'.repeat(64);

// ── M1a — the field shape ────────────────────────────────────────────────────

test('M1a buildChainedRecord field shape: prev/post verbatim, head_anchor null, APPEND/COMMITTED, evidence, fixed persona, spawn id', () => {
  const r = buildChainedRecord({ prevPost, post, evidenceTxid, safeId: 'agent_c1', schemaVersion: SV });
  assert.strictEqual(r.prev_state_hash, prevPost, 'prev_state_hash verbatim (the M1 seam)');
  assert.strictEqual(r.post_state_hash, post, 'post_state_hash EXPLICIT');
  assert.strictEqual(r.head_anchor, null, 'head_anchor is null for an integration record');
  assert.strictEqual(r.operation_class, 'APPEND', 'operation_class APPEND');
  assert.strictEqual(r.commit_outcome, 'COMMITTED', 'commit_outcome COMMITTED');
  assert.deepStrictEqual(r.evidence_refs, [evidenceTxid], 'evidence_refs = [the candidate genesis txid]');
  assert.strictEqual(r.writer_persona_id, KERNEL_INTEGRATOR_PERSONA, 'fixed integrator persona');
  assert.strictEqual(r.writer_spawn_id, 'loom-integrate-agent_c1', 'writer_spawn_id = loom-integrate-<safeId>');
  assert.strictEqual(r.schema_version, SV, 'schema_version threaded');
  assert.ok(typeof r.intent_recorded_at === 'string' && r.intent_recorded_at.length > 0, 'intent_recorded_at set (= commit time, single-phase)');
});

// ── M1b — the content-addressed id + non-genesis validation ──────────────────

test('M1b transaction_id === computeTransactionId(body); validates at isGenesisPosition:false', () => {
  const r = buildChainedRecord({ prevPost, post, evidenceTxid, safeId: 'agent_c1', schemaVersion: SV });
  const { transaction_id, ...body } = r;
  assert.strictEqual(transaction_id, computeTransactionId(body), 'transaction_id is the content hash of the body');
  assert.ok(/^[a-f0-9]{64}$/.test(transaction_id), 'transaction_id is 64-hex');
  const v = validateTransactionRecord(r, { isGenesisPosition: false });
  assert.ok(v.valid, `must validate at the NON-genesis position; got ${JSON.stringify(v.errors)}`);
});

// ── M1c — the full appendRecord round-trip (the join, not just validation) ───

test('[store] M1c full appendRecord round-trip + readByPostStateHash(post) returns it (the value-equality join)', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ir-m1c-'));
  const runId = 'run-ir';
  try {
    const r = buildChainedRecord({ prevPost, post, evidenceTxid, safeId: 'agent_c1', schemaVersion: SV });
    const a = appendRecord(r, { runId, stateDir });
    assert.ok(a.ok, `appendRecord must accept the chained record; got ${a.reason}`);
    const back = readByPostStateHash(post, { runId, stateDir });
    assert.ok(back, 'readByPostStateHash(post) must resolve the record (the next-candidate parent join)');
    assert.strictEqual(back.transaction_id, r.transaction_id, 'the round-tripped record matches');
  } finally { fs.rmSync(stateDir, { recursive: true, force: true }); }
});

// ── M1d — immutability ───────────────────────────────────────────────────────

test('M1d returns a NEW object (immutability); does not mutate its args', () => {
  const args = { prevPost, post, evidenceTxid, safeId: 'agent_c1', schemaVersion: SV };
  const snapshot = JSON.stringify(args);
  const r = buildChainedRecord(args);
  assert.ok(!Object.is(r, args), 'returns a new object, not the args');
  assert.strictEqual(JSON.stringify(args), snapshot, 'the args object is not mutated');
});

// ── M1e — fail-fast on a malformed prev (never a silently-invalid record) ────

test('M1e fail-fast: a non-64-hex prevPost -> throws (the builder validates isGenesisPosition:false)', () => {
  assert.throws(
    () => buildChainedRecord({ prevPost: 'not-a-hash', post, evidenceTxid, safeId: 'agent_c1', schemaVersion: SV }),
    'a malformed prevPost must throw, not return an invalid record'
  );
});

// ── M1f — a chained record walks to genesis (depthWalked:1) ──────────────────

test('[store] M1f a chained record (prev = a stored genesis post) walks to genesis depthWalked:1', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ir-m1f-'));
  const runId = 'run-ir';
  try {
    const seedPost = computePostStateHash('e'.repeat(40));
    const seed = buildSpawnRecord({ agentId: 'agent_seed', personaId: PERSONA, schemaVersion: SV, postStateHash: seedPost, headAnchor: null });
    appendRecord(seed, { runId, stateDir });
    const seedTxid = readByPostStateHash(seedPost, { runId, stateDir }).transaction_id;

    const r = buildChainedRecord({ prevPost: seedPost, post, evidenceTxid: seedTxid, safeId: 'agent_c1', schemaVersion: SV });
    appendRecord(r, { runId, stateDir });
    const walk = checkEvidenceLinkPreCommit({ record: r, isGenesisPosition: false, resolveParent: (h) => readByPostStateHash(h, { runId, stateDir }) });
    assert.ok(walk.ok, `the chained record must walk ok; got ${JSON.stringify(walk)}`);
    assert.strictEqual(walk.depthWalked, 1, 'depthWalked:1 (terminates at the genesis seed — non-vacuous)');
  } finally { fs.rmSync(stateDir, { recursive: true, force: true }); }
});

process.stdout.write(`\nintegration-record.test: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
