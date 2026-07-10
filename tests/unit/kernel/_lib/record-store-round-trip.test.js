#!/usr/bin/env node

// tests/unit/kernel/_lib/record-store-round-trip.test.js
//
// Regression: appendRecord validated + hashed the in-memory record (S5), but the
// write is JSON.stringify, which DROPS undefined-valued object keys (and coerces
// NaN/Infinity to null). computeTransactionId (via canonicalJsonSerialize /
// Object.keys) INCLUDES such a key, so the in-memory id != the id of the parsed
// on-disk body. loadRecordFile's S5-on-read re-hash then rejects the file, making
// a just-written {ok:true} record PERMANENTLY UNREADABLE (silent data loss).
//
// Probed real: computeTransactionId({...,k:undefined}) != computeTransactionId({...})
// while JSON.stringify drops k. The fix rejects such a record at append (a loud
// {ok:false, reason:'record-not-round-trip-stable'}) instead of storing a ghost.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const store = require('../../../../packages/kernel/_lib/record-store');
const { computeTransactionId } = require('../../../../packages/kernel/_lib/transaction-record');

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

const RUN_ID = 'run-round-trip';
function tmpStateDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'record-store-rt-')); }

// A valid COMMITTED body; `extra` injects a pathological field (e.g. an
// undefined-valued one) BEFORE the id is computed, so transaction_id hashes over
// the body AS GIVEN (exactly what a buggy producer would emit).
function buildRecord(extra = {}) {
  const seed = crypto.randomBytes(6).toString('hex');
  const body = {
    prev_state_hash: 'GENESIS',
    writer_persona_id: '04-architect.theo',
    writer_spawn_id: 'sp-2026-01-01T00:00:00.000Z-arch-0000',
    operation_class: 'CREATE',
    evidence_refs: ['ROOT_TASK_RECORD:task-' + seed],
    intent_recorded_at: '2026-01-01T00:00:00.000Z',
    commit_outcome: 'COMMITTED',
    schema_version: 'v3',
    post_state_hash: crypto.createHash('sha256').update('post-' + seed).digest('hex'),
    ...extra,
  };
  return { transaction_id: computeTransactionId(body), ...body };
}

test('clean record appends AND reads back (baseline unchanged)', () => {
  const dir = tmpStateDir();
  try {
    const rec = buildRecord();
    const r = store.appendRecord(rec, { runId: RUN_ID, stateDir: dir });
    assert.strictEqual(r.ok, true, `expected ok, got ${JSON.stringify(r)}`);
    const back = store.readById(rec.transaction_id, { runId: RUN_ID, stateDir: dir });
    assert.ok(back && back.transaction_id === rec.transaction_id, 'a clean record must read back');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an undefined-valued field is REJECTED at append (no silent-unreadable ghost)', () => {
  const dir = tmpStateDir();
  try {
    // transaction_id is computed WITH forward_note:undefined present (Object.keys
    // includes it); JSON.stringify then drops it on write. The old code returned
    // {ok:true} and the record was permanently unreadable; the fix rejects here.
    const rec = buildRecord({ forward_note: undefined });
    assert.ok('forward_note' in rec, 'precondition: the undefined key is present on the record');
    const r = store.appendRecord(rec, { runId: RUN_ID, stateDir: dir });
    assert.strictEqual(r.ok, false, `expected reject, got ${JSON.stringify(r)}`);
    assert.ok(/round-trip/.test(r.reason || ''), `expected a round-trip reason, got '${r.reason}'`);
    // And no ghost record was created (readById returns null; nothing to be lost).
    assert.strictEqual(store.readById(rec.transaction_id, { runId: RUN_ID, stateDir: dir }), null, 'no ghost record');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

process.stdout.write(`\nrecord-store-round-trip.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
