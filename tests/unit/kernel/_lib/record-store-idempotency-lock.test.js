#!/usr/bin/env node

// tests/unit/kernel/_lib/record-store-idempotency-lock.test.js
//
// Regression: appendRecord's INV-22 dedup gate was a check-then-write TOCTOU —
// readByIdempotencyKey (a dir scan) fired BEFORE mkdirSync+writeAtomicString with
// no cross-process lock, so two racing appends of the SAME idempotency_key (a
// re-fire whose transaction_id is time-salted -> a DIFFERENT file) both observed
// "no existing" and both wrote, leaving two records for one transaction. The fix
// serializes the dedup-check + write on a per-idempotency-key lock.
//
// Records here share an idempotency_key (persona/op/prev/post/spawn are fixed) but
// differ in intent_recorded_at, which time-salts the transaction_id -> distinct
// files absent the dedup. The invariant: exactly ONE record survives.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const RS = path.join(REPO, 'packages', 'kernel', '_lib', 'record-store.js');
const TR = path.join(REPO, 'packages', 'kernel', '_lib', 'transaction-record.js');
const store = require(RS);
const { computeTransactionId, deriveIdempotencyKey } = require(TR);

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// A keyed record; `salt` (intent_recorded_at) varies the transaction_id but NOT
// the idempotency_key. Derive the key FIRST, add it to the body, THEN hash the id
// (computeTransactionId includes idempotency_key).
function build(salt) {
  const body = {
    prev_state_hash: 'GENESIS',
    writer_persona_id: '04-architect.theo',
    writer_spawn_id: 'sp-fixed-0000',
    operation_class: 'CREATE',
    evidence_refs: ['ROOT_TASK_RECORD:task-x'],
    intent_recorded_at: salt,
    commit_outcome: 'COMMITTED',
    schema_version: 'v3',
    post_state_hash: crypto.createHash('sha256').update('post-fixed').digest('hex'),
  };
  body.idempotency_key = deriveIdempotencyKey(body);
  const transaction_id = computeTransactionId(body);
  return { transaction_id, ...body };
}

function recordsDir(stateDir, runId) { return path.join(stateDir, runId, 'records'); }
function countRecords(stateDir, runId) {
  try { return fs.readdirSync(recordsDir(stateDir, runId)).filter((f) => /^record-[a-f0-9]{64}\.json$/.test(f)).length; }
  catch { return 0; }
}

// The child: build a keyed record with a unique salt, append it.
const CHILD = `
  const crypto = require('crypto');
  const store = require(process.env.RS);
  const { computeTransactionId, deriveIdempotencyKey } = require(process.env.TR);
  const body = { prev_state_hash:'GENESIS', writer_persona_id:'04-architect.theo',
    writer_spawn_id:'sp-fixed-0000', operation_class:'CREATE',
    evidence_refs:['ROOT_TASK_RECORD:task-x'], intent_recorded_at: process.env.SALT,
    commit_outcome:'COMMITTED', schema_version:'v3',
    post_state_hash: crypto.createHash('sha256').update('post-fixed').digest('hex') };
  body.idempotency_key = deriveIdempotencyKey(body);
  const transaction_id = computeTransactionId(body);
  const r = store.appendRecord({ transaction_id, ...body }, { runId: process.env.RUN_ID, stateDir: process.env.STATE_DIR });
  process.exit(r.ok ? 0 : 1);
`;

function runConcurrent(stateDir, runId, n) {
  const launches = [];
  for (let i = 0; i < n; i += 1) {
    launches.push(new Promise((resolve) => {
      const child = spawn('node', ['-e', CHILD], {
        env: { ...process.env, RS, TR, RUN_ID: runId, STATE_DIR: stateDir, SALT: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z` },
        stdio: 'ignore',
      });
      child.on('exit', (code) => resolve(code));
      child.on('error', () => resolve(-1));
    }));
  }
  return Promise.all(launches);
}

test('sequential: a re-fired same-key record dedups to one on disk', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-idem-seq-'));
  try {
    const a = build('2026-01-01T00:00:00.000Z');
    const b = build('2026-01-01T00:00:09.000Z'); // same key, different txid
    assert.strictEqual(a.idempotency_key, b.idempotency_key);
    assert.notStrictEqual(a.transaction_id, b.transaction_id);
    assert.strictEqual(store.appendRecord(a, { runId: 'r', stateDir }).ok, true);
    const rb = store.appendRecord(b, { runId: 'r', stateDir });
    assert.strictEqual(rb.deduped, true, 'the re-fire must dedup');
    assert.strictEqual(rb.transaction_id, a.transaction_id, 'dedup returns the STORED id');
    assert.strictEqual(countRecords(stateDir, 'r'), 1, 'exactly one record on disk');
  } finally { fs.rmSync(stateDir, { recursive: true, force: true }); }
});

test('fail-OPEN: a planted un-reclaimable lock does NOT suppress the append (hacker HIGH)', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-idem-plant-'));
  try {
    const rec = build('2026-01-01T00:00:33.000Z');
    // Plant an EMPTY .idem-<key>.lock. acquireLock refuses to steal empty / non-
    // numeric content, so a hard fail-closed would suppress THIS key's provenance
    // append forever (a same-uid write-suppression DoS). The fix falls open.
    const dir = recordsDir(stateDir, 'r');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.idem-' + rec.idempotency_key + '.lock'), '');
    const t0 = Date.now();
    const r = store.appendRecord(rec, { runId: 'r', stateDir, idempotencyLockMaxWaitMs: 150 });
    const ms = Date.now() - t0;
    assert.strictEqual(r.ok, true, `a planted lock must NOT suppress the append (got ${JSON.stringify(r)})`);
    assert.strictEqual(countRecords(stateDir, 'r'), 1, 'the record was written despite the planted lock');
    assert.ok(ms < 2000, `fail-open is bounded by the (short) lock wait, took ${ms}ms`);
  } finally { fs.rmSync(stateDir, { recursive: true, force: true }); }
});

async function main() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-idem-conc-'));
  const N = 12;
  try {
    const codes = await runConcurrent(stateDir, 'race', N);
    test('concurrent: N same-key appends leave exactly ONE record (dedup race closed)', () => {
      assert.ok(codes.every((c) => c === 0), `every child should append ok, got ${JSON.stringify(codes)}`);
      assert.strictEqual(countRecords(stateDir, 'race'), 1,
        `INV-22 race: expected 1 record, got ${countRecords(stateDir, 'race')}`);
    });
  } finally { fs.rmSync(stateDir, { recursive: true, force: true }); }
}

main().then(() => {
  process.stdout.write(`\nrecord-store-idempotency-lock.test.js: ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
});
