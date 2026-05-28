#!/usr/bin/env node

// tests/unit/kernel/_lib/transaction-record.test.js
//
// Tests for packages/kernel/_lib/transaction-record.js per v6 §4.2.

'use strict';

const assert = require('assert');
const {
  canonicalJsonSerialize,
  computeTransactionId,
  computeGenesisHash,
  computeIdempotencyKey,
  isStateChanging,
  isBootstrapSentinel,
  validateTransactionRecord,
} = require('../../../../packages/kernel/_lib/transaction-record');

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

// --- canonicalJsonSerialize ---

test('canonicalJsonSerialize sorts object keys deterministically', () => {
  const a = canonicalJsonSerialize({ b: 2, a: 1, c: 3 });
  const b = canonicalJsonSerialize({ c: 3, a: 1, b: 2 });
  assert.strictEqual(a, b);
  assert.strictEqual(a, '{"a":1,"b":2,"c":3}');
});

test('canonicalJsonSerialize handles nested objects + arrays', () => {
  const out = canonicalJsonSerialize({ y: [1, { z: 2, a: 3 }], x: 'foo' });
  assert.strictEqual(out, '{"x":"foo","y":[1,{"a":3,"z":2}]}');
});

test('canonicalJsonSerialize handles null + primitives', () => {
  assert.strictEqual(canonicalJsonSerialize(null), 'null');
  assert.strictEqual(canonicalJsonSerialize(42), '42');
  assert.strictEqual(canonicalJsonSerialize('hello'), '"hello"');
});

// --- computeTransactionId ---

test('computeTransactionId excludes transaction_id field (fixed-point)', () => {
  const record = {
    prev_state_hash: 'a'.repeat(64),
    operation_class: 'CREATE',
    writer_persona_id: '04-architect.theo',
  };
  const idA = computeTransactionId(record);
  const idB = computeTransactionId({ ...record, transaction_id: 'arbitrary-value' });
  assert.strictEqual(idA, idB, 'transaction_id field must be excluded from hash input');
});

test('computeTransactionId is deterministic + 64-char hex', () => {
  const record = { foo: 'bar', n: 42 };
  const id1 = computeTransactionId(record);
  const id2 = computeTransactionId(record);
  assert.strictEqual(id1, id2);
  assert.match(id1, /^[a-f0-9]{64}$/);
});

test('computeTransactionId throws on non-object input', () => {
  assert.throws(() => computeTransactionId(null));
  assert.throws(() => computeTransactionId('string'));
});

// --- computeGenesisHash (§4.3) ---

test('computeGenesisHash matches spec formula', () => {
  const expected = require('crypto')
    .createHash('sha256')
    .update('GENESIS|v6.0|per-user')
    .digest('hex');
  assert.strictEqual(computeGenesisHash('v6.0', 'per-user'), expected);
});

test('computeGenesisHash disambiguates per-user vs per-project (Patch 4 + 7)', () => {
  const userHash = computeGenesisHash('v6.0', 'per-user');
  const projectHash = computeGenesisHash('v6.0', 'per-project');
  assert.notStrictEqual(userHash, projectHash, 'scope must differentiate genesis hashes');
});

test('computeGenesisHash disambiguates schema_versions', () => {
  const v6 = computeGenesisHash('v6.0', 'per-user');
  const v7 = computeGenesisHash('v7.0', 'per-user');
  assert.notStrictEqual(v6, v7);
});

test('computeGenesisHash rejects invalid scope', () => {
  assert.throws(() => computeGenesisHash('v6.0', 'invalid-scope'));
});

// --- computeIdempotencyKey (§5a.6) ---

test('computeIdempotencyKey is deterministic over its 4 inputs', () => {
  const opts = {
    writerPersonaId: '04-architect.theo',
    operationClass: 'CREATE',
    contentHash: 'b'.repeat(64),
    prevStateHash: 'c'.repeat(64),
  };
  const k1 = computeIdempotencyKey(opts);
  const k2 = computeIdempotencyKey(opts);
  assert.strictEqual(k1, k2);
  assert.match(k1, /^[a-f0-9]{64}$/);
});

test('computeIdempotencyKey differs when any input differs', () => {
  const base = {
    writerPersonaId: 'a',
    operationClass: 'CREATE',
    contentHash: 'b'.repeat(64),
    prevStateHash: 'c'.repeat(64),
  };
  const k0 = computeIdempotencyKey(base);
  assert.notStrictEqual(k0, computeIdempotencyKey({ ...base, writerPersonaId: 'b' }));
  assert.notStrictEqual(k0, computeIdempotencyKey({ ...base, operationClass: 'APPEND' }));
});

// --- isStateChanging (Round-3e GP4) ---

test('isStateChanging returns true for CREATE/APPEND/SUPERSEDE/TOMBSTONE', () => {
  assert.strictEqual(isStateChanging('CREATE'), true);
  assert.strictEqual(isStateChanging('APPEND'), true);
  assert.strictEqual(isStateChanging('SUPERSEDE'), true);
  assert.strictEqual(isStateChanging('TOMBSTONE'), true);
});

test('isStateChanging returns false for DERIVED-VIEW-INVALIDATE (Round-3e GP4)', () => {
  assert.strictEqual(isStateChanging('DERIVED-VIEW-INVALIDATE'), false);
});

test('isStateChanging returns false for unknown/missing operation_class', () => {
  assert.strictEqual(isStateChanging('UPDATE'), false);
  assert.strictEqual(isStateChanging(null), false);
  assert.strictEqual(isStateChanging(undefined), false);
});

// --- isBootstrapSentinel (Round-3d Patch GPT-1.B) ---

test('isBootstrapSentinel matches USER_INTENT_AXIOM', () => {
  assert.strictEqual(isBootstrapSentinel('USER_INTENT_AXIOM:' + 'a'.repeat(64)), true);
  assert.strictEqual(isBootstrapSentinel('USER_INTENT_AXIOM:tooshort'), false);
});

test('isBootstrapSentinel matches GENESIS_EVIDENCE', () => {
  assert.strictEqual(isBootstrapSentinel('GENESIS_EVIDENCE:v6.0:per-user'), true);
  assert.strictEqual(isBootstrapSentinel('GENESIS_EVIDENCE:v6.0:per-project'), true);
  assert.strictEqual(isBootstrapSentinel('GENESIS_EVIDENCE:v6.0:invalid-scope'), false);
});

test('isBootstrapSentinel matches ROOT_TASK_RECORD', () => {
  assert.strictEqual(isBootstrapSentinel('ROOT_TASK_RECORD:task-001'), true);
});

test('isBootstrapSentinel rejects non-sentinel strings', () => {
  assert.strictEqual(isBootstrapSentinel('arbitrary-record-id'), false);
  assert.strictEqual(isBootstrapSentinel(''), false);
  assert.strictEqual(isBootstrapSentinel(null), false);
});

// --- validateTransactionRecord ---

function validRecord(overrides = {}) {
  return {
    transaction_id: 'a'.repeat(64),
    prev_state_hash: 'b'.repeat(64),
    writer_persona_id: '04-architect.theo',
    writer_spawn_id: 'sp-2026-01-01T00:00:00.000Z-arch-0001',
    operation_class: 'CREATE',
    intent_recorded_at: '2026-01-01T00:00:00.000Z',
    commit_outcome: 'PENDING',
    schema_version: 'v3',
    evidence_refs: ['USER_INTENT_AXIOM:' + 'c'.repeat(64)],
    ...overrides,
  };
}

test('validateTransactionRecord accepts valid record', () => {
  const result = validateTransactionRecord(validRecord());
  assert.strictEqual(result.valid, true, 'expected valid, got errors: ' + JSON.stringify(result.errors));
});

test('validateTransactionRecord rejects missing required fields', () => {
  const record = validRecord();
  delete record.writer_persona_id;
  const result = validateTransactionRecord(record);
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('writer_persona_id')));
});

test('validateTransactionRecord rejects invalid operation_class', () => {
  const result = validateTransactionRecord(validRecord({ operation_class: 'UPDATE' }));
  assert.strictEqual(result.valid, false);
});

test('A10: state-changing record with empty evidence_refs is rejected', () => {
  const result = validateTransactionRecord(validRecord({ evidence_refs: [] }));
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('A10')));
});

test('Round-3e GP4: DERIVED-VIEW-INVALIDATE with empty evidence_refs is OK', () => {
  const result = validateTransactionRecord(
    validRecord({
      operation_class: 'DERIVED-VIEW-INVALIDATE',
      commit_outcome: 'NOT_APPLICABLE',
      evidence_refs: [],
    })
  );
  assert.strictEqual(result.valid, true, 'expected valid, got: ' + JSON.stringify(result.errors));
});

test('Round-3e GP4: DERIVED-VIEW-INVALIDATE must have NOT_APPLICABLE outcome', () => {
  const result = validateTransactionRecord(
    validRecord({
      operation_class: 'DERIVED-VIEW-INVALIDATE',
      commit_outcome: 'COMMITTED',
      evidence_refs: [],
    })
  );
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('Round-3e GP4')));
});

test('validateTransactionRecord rejects non-hex transaction_id', () => {
  const result = validateTransactionRecord(validRecord({ transaction_id: 'not-hex!' }));
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('transaction_id')));
});

// --- F9 INV-K2-SchemaForwardCompat genesis-position (post-compact PR-1 R1 F-1) ---
//
// Per plan PR 1 phase 5: add isGenesisPosition param to validateTransactionRecord.
// At genesis position (chain head), prev_state_hash MAY be the bootstrap sentinel
// "GENESIS" (or another sentinel) instead of a 64-char sha256 hex. The validator
// currently rejects any non-64-char-hex prev_state_hash — these tests assert the
// new opt-in {isGenesisPosition: true} path accepts the bootstrap shape.
//
// Note (FL on F9): K9 is the first production caller of isGenesisPosition=true
// and ships in PR 3, NOT PR 1. PR-1 tests call validator with the option
// directly to exercise the new branch. Implementer MUST NOT mistake the
// unused-in-PR-1 param for dead code.

test('F9 INV-K2-SchemaForwardCompat: genesis-position accepts GENESIS prev_state_hash', () => {
  const record = validRecord({ prev_state_hash: 'GENESIS' });
  const result = validateTransactionRecord(record, { isGenesisPosition: true });
  assert.strictEqual(
    result.valid,
    true,
    'isGenesisPosition=true should accept GENESIS sentinel; got errors: ' + JSON.stringify(result.errors),
  );
});

test('F9 INV-K2-SchemaForwardCompat: non-genesis still rejects GENESIS sentinel', () => {
  // The new opt-in must NOT loosen validation when isGenesisPosition is absent
  // or false — that's the forward-compat contract: existing callers see no
  // behavior change.
  const record = validRecord({ prev_state_hash: 'GENESIS' });
  const resultNoFlag = validateTransactionRecord(record);
  assert.strictEqual(resultNoFlag.valid, false, 'omitted flag must reject GENESIS sentinel');
  const resultFalse = validateTransactionRecord(record, { isGenesisPosition: false });
  assert.strictEqual(resultFalse.valid, false, 'isGenesisPosition=false must reject GENESIS sentinel');
});

test('F9 INV-K2-SchemaForwardCompat: genesis-position still validates other required fields', () => {
  // isGenesisPosition relaxes ONLY prev_state_hash format — other required
  // fields (writer_persona_id, operation_class, etc.) still mandatory.
  const record = validRecord({ prev_state_hash: 'GENESIS' });
  delete record.writer_persona_id;
  const result = validateTransactionRecord(record, { isGenesisPosition: true });
  assert.strictEqual(result.valid, false, 'genesis-position must still require writer_persona_id');
  assert.ok(result.errors.some((e) => e.includes('writer_persona_id')));
});

test('F9 INV-K2-SchemaForwardCompat: genesis-position with valid 64-hex prev_state_hash is also OK', () => {
  // Genesis-position is permissive — accepts EITHER bootstrap sentinel OR
  // valid hash. (Otherwise it would force a sentinel-only chain head.)
  const result = validateTransactionRecord(validRecord(), { isGenesisPosition: true });
  assert.strictEqual(result.valid, true, 'errors: ' + JSON.stringify(result.errors));
});

// --- F16 clearSchemaCache export (post-compact PR-1 R1 F-1) ---

test('F16 clearSchemaCache: exported as top-level function', () => {
  const mod = require('../../../../packages/kernel/_lib/transaction-record');
  assert.strictEqual(typeof mod.clearSchemaCache, 'function', 'expected top-level clearSchemaCache export');
});

test('F16 clearSchemaCache: call is idempotent + does not throw', () => {
  const { clearSchemaCache } = require('../../../../packages/kernel/_lib/transaction-record');
  assert.doesNotThrow(() => {
    clearSchemaCache();
    clearSchemaCache();
    clearSchemaCache();
  });
});

test('F16 clearSchemaCache: re-validation after clear still works (no broken state)', () => {
  const mod = require('../../../../packages/kernel/_lib/transaction-record');
  mod.clearSchemaCache();
  const result = mod.validateTransactionRecord(validRecord());
  assert.strictEqual(result.valid, true, 'errors: ' + JSON.stringify(result.errors));
});

// --- summary ---

process.stdout.write(`\ntransaction-record.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
