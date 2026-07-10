#!/usr/bin/env node

// tests/unit/kernel/_lib/record-store-round-trip.test.js
//
// Regression: appendRecord validated + hashed the in-memory record (S5), but the
// write is JSON.stringify. When canonicalJsonSerialize DIVERGED from native
// JSON.stringify, the in-memory id != the id of the parsed on-disk body, so
// loadRecordFile's S5-on-read re-hash rejected the file — a just-written {ok:true}
// record PERMANENTLY UNREADABLE (silent data loss). The #555 fix rejects such a
// record at append (a loud {ok:false, reason:'record-not-round-trip-stable'}).
//
// #550 UPDATE: the undefined/function/symbol ("JSON-absent") class that originally
// triggered this is now fixed at the ROOT — canonicalJsonSerialize matches native
// (drops the key), so an undefined-bearing record ROUND-TRIPS CLEANLY (accepted +
// readable), no divergence, no ghost. The round-trip guard is still LOAD-BEARING for
// the class #550 did NOT fix — the `toJSON` sibling (e.g. a Date value: canonical
// serializes the empty object shape {}, native emits the ISO string), which still
// diverges and is still rejected. Both cases are asserted below.

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

test('#550: an undefined-valued field now ROUND-TRIPS CLEANLY (accepted + reads back, no ghost)', () => {
  const dir = tmpStateDir();
  try {
    // transaction_id is computed WITH forward_note:undefined present. Post-#550,
    // canonicalJsonSerialize drops it (matching native JSON.stringify), so the id is
    // computed over the undefined-free form and the on-disk read-back re-hashes to
    // the SAME id — round-trip-stable. The record is accepted and reads back.
    const rec = buildRecord({ forward_note: undefined });
    assert.ok('forward_note' in rec, 'precondition: the undefined key is present on the in-memory record');
    const r = store.appendRecord(rec, { runId: RUN_ID, stateDir: dir });
    assert.strictEqual(r.ok, true, `expected accept (undefined now canonical-clean), got ${JSON.stringify(r)}`);
    const back = store.readById(rec.transaction_id, { runId: RUN_ID, stateDir: dir });
    assert.ok(back && back.transaction_id === rec.transaction_id, 'the undefined-bearing record must read back');
    assert.ok(!('forward_note' in back), 'the undefined key is dropped consistently (write + hash agree)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the round-trip guard is still NON-VACUOUS: a toJSON/Date field is REJECTED (#550 did not fix this class)', () => {
  const dir = tmpStateDir();
  try {
    // A Date value: canonicalJsonSerialize walks the empty own-key object shape ({}),
    // but the write path (JSON.stringify) calls toJSON() -> an ISO string. The two
    // diverge, so the on-disk body would re-hash to a different id (silent-unreadable)
    // — the guard rejects it loudly instead of storing a ghost.
    const rec = buildRecord({ when: new Date('2026-01-01T00:00:00.000Z') });
    const r = store.appendRecord(rec, { runId: RUN_ID, stateDir: dir });
    assert.strictEqual(r.ok, false, `expected reject for the toJSON class, got ${JSON.stringify(r)}`);
    assert.ok(/round-trip/.test(r.reason || ''), `expected a round-trip reason, got '${r.reason}'`);
    assert.strictEqual(store.readById(rec.transaction_id, { runId: RUN_ID, stateDir: dir }), null, 'no ghost record');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

process.stdout.write(`\nrecord-store-round-trip.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
