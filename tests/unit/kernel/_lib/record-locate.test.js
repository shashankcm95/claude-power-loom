#!/usr/bin/env node

// tests/unit/kernel/_lib/record-locate.test.js
//
// v3.6 Wave 2a — findRecordRun: the content-addressed run locator (the run-scoping seam). Given a target
// transaction_id, find which run's record-store holds it, so the manage-op TOMBSTONE is appended into the
// SAME run -> findAffectedByOp links them -> the W1 reader (fed listByRun(R_T)) lights up.
//
// HARDENED per the hacker VERIFY (HIGH): the glob is filename-shaped, so it MUST validate the candidate (a
// decoy garbage record-<T>.json must NOT match) AND realpath-collapse the run dir + checkWithinRoot (a
// SYMLINKED run dir that escapes the store must NOT match). Multi-run (architect MED-2): a txid in >1 run is
// AMBIGUOUS -> the caller refuses (fail-closed), never readdir-roulette.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const K = (...a) => path.join(REPO_ROOT, 'packages', 'kernel', '_lib', ...a);
const { findRecordRun } = require(K('record-locate.js'));
const { appendRecord } = require(K('record-store.js'));
const { buildSpawnRecord } = require(K('quarantine-promote.js'));
const { computePostStateHash } = require(K('transaction-record.js'));

const hx = (ch) => ch.repeat(64);
// A realistic "target" = a genesis spawn provenance record.
const seedRecord = (n) => buildSpawnRecord({
  agentId: 'agent' + n, personaId: 'p' + n, schemaVersion: 'v6', postStateHash: computePostStateHash(hx('f')),
});

let TMP;
function freshStore() {
  TMP = path.join(os.tmpdir(), 'rl-' + crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(TMP, { recursive: true });
  return TMP;
}

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; } catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
  finally { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ } }
}

test('finds the run holding a seeded record', () => {
  const dir = freshStore();
  const rec = seedRecord(1);
  appendRecord(rec, { runId: 'runA', stateDir: dir });
  assert.deepStrictEqual(findRecordRun(rec.transaction_id, { stateDir: dir }), { runId: 'runA' });
});

test('a non-hex txid -> null (zero fs reach)', () => {
  freshStore();
  assert.strictEqual(findRecordRun('not-a-hex-id', { stateDir: TMP }), null);
});

test('a phantom txid (in no run) -> null', () => {
  const dir = freshStore();
  appendRecord(seedRecord(1), { runId: 'runA', stateDir: dir });
  assert.strictEqual(findRecordRun(hx('e'), { stateDir: dir }), null);
});

test('a txid in >1 run -> AMBIGUOUS (fail-closed; the caller refuses)', () => {
  const dir = freshStore();
  const rec = seedRecord(1);
  appendRecord(rec, { runId: 'runA', stateDir: dir });
  appendRecord(rec, { runId: 'runB', stateDir: dir });
  const r = findRecordRun(rec.transaction_id, { stateDir: dir });
  assert.strictEqual(r.ambiguous, true);
  assert.deepStrictEqual(r.runs.sort(), ['runA', 'runB']);
});

test('a SYMLINKED run dir that escapes the store is NOT matched (hacker HIGH)', () => {
  const dir = freshStore();
  const rec = seedRecord(1);
  // Plant the record in an EXTERNAL dir, reachable from the store ONLY via a symlinked run dir.
  const external = path.join(os.tmpdir(), 'rl-ext-' + crypto.randomBytes(6).toString('hex'));
  try { // try/finally so `external` is cleaned even if the assertion throws (CodeRabbit Minor)
    fs.mkdirSync(path.join(external, 'records'), { recursive: true });
    fs.writeFileSync(path.join(external, 'records', `record-${rec.transaction_id}.json`), JSON.stringify(rec));
    try {
      fs.symlinkSync(external, path.join(dir, 'symrun'), 'dir');
    } catch { process.stdout.write('  (symlink unsupported — skipping)\n'); return; }
    // The record is reachable ONLY via the escaping symlink -> findRecordRun must NOT return it.
    assert.strictEqual(findRecordRun(rec.transaction_id, { stateDir: dir }), null);
  } finally {
    try { fs.rmSync(external, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

test('a decoy garbage record-<T>.json does NOT match; a valid record in another run wins (hacker HIGH)', () => {
  const dir = freshStore();
  const rec = seedRecord(1);
  // A decoy file claiming the txid, alphabetically-earlier run, garbage body.
  fs.mkdirSync(path.join(dir, 'aaaa-decoy', 'records'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'aaaa-decoy', 'records', `record-${rec.transaction_id}.json`), 'NOT-JSON-GARBAGE');
  // The real, valid record in a later-sorted run.
  appendRecord(rec, { runId: 'zzzz-real', stateDir: dir });
  assert.deepStrictEqual(findRecordRun(rec.transaction_id, { stateDir: dir }), { runId: 'zzzz-real' });
});

test('ONLY a decoy garbage file -> null (no valid match)', () => {
  const dir = freshStore();
  fs.mkdirSync(path.join(dir, 'runG', 'records'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'runG', 'records', `record-${hx('a')}.json`), '{bad json');
  assert.strictEqual(findRecordRun(hx('a'), { stateDir: dir }), null);
});

process.stdout.write(`\nrecord-locate.test.js (v3.6 W2a): ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
