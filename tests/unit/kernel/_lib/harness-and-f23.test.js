#!/usr/bin/env node

// tests/unit/kernel/_lib/harness-and-f23.test.js
//
// Coverage for the PR-2 harness extensions + F23 test-marker tripwire:
//   F23  validateTransactionRecord REJECTS `_test_chain_marker`; validateTestRecord strips it
//   F6   synthesizeChain uses the REAL computeIdempotencyKey (unique keys; INV-22 lightweight)
//   _fs-watch-harness / _crash-harness sanity

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { validateTransactionRecord } = require('../../../../packages/kernel/_lib/transaction-record');
const { validateTestRecord } = require('./_test-validate');
const { synthesizeChain } = require('./_test-harness');
const { createInjectableFsWatch } = require('./_fs-watch-harness');
const {
  simulateInterruptedAtomicWrite,
  appendTornWALLine,
  writeWalWithOrphanPending,
} = require('./_crash-harness');

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
function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-f23-'));
}

// --- F23: production validator rejects the test marker ---

test('F23: validateTransactionRecord REJECTS a record carrying _test_chain_marker', () => {
  const rec = synthesizeChain({ count: 1 })[0];
  assert.ok(Object.prototype.hasOwnProperty.call(rec, '_test_chain_marker'), 'synthesized record must carry the marker');
  const res = validateTransactionRecord(rec);
  assert.strictEqual(res.valid, false);
  assert.deepStrictEqual(res.errors, ['test-marker-not-admissible-in-production']);
});

test('F23: marker rejection fires even when the rest of the record is structurally valid', () => {
  // A marker-bearing record that would otherwise pass must STILL be rejected,
  // and the marker error must short-circuit before other checks.
  const rec = synthesizeChain({ count: 2 })[1];
  const res = validateTransactionRecord(rec);
  assert.strictEqual(res.valid, false);
  assert.ok(res.errors.includes('test-marker-not-admissible-in-production'));
});

test('F23: validateTestRecord strips the marker, then validates the rest', () => {
  const rec = synthesizeChain({ count: 2 })[1]; // non-genesis: strict prev-hash applies
  const res = validateTestRecord(rec);
  assert.strictEqual(res.valid, true, JSON.stringify(res.errors));
});

test('F23: validateTestRecord does not mutate the caller record (immutability)', () => {
  const rec = synthesizeChain({ count: 1 })[0];
  validateTestRecord(rec, { isGenesisPosition: true });
  assert.ok(Object.prototype.hasOwnProperty.call(rec, '_test_chain_marker'), 'original record must keep its marker');
});

// --- F6: real idempotency keys ---

test('F6: synthesizeChain idempotency_key is the real derivation, not idem-i', () => {
  const chain = synthesizeChain({ count: 1 })[0];
  assert.ok(/^[a-f0-9]{64}$/.test(chain.idempotency_key), 'must be a 64-char sha256');
  assert.ok(!chain.idempotency_key.startsWith('idem-'));
});

test('F6: idempotency keys are unique across a chain (INV-22 lightweight)', () => {
  const chain = synthesizeChain({ count: 8 });
  const keys = new Set(chain.map((r) => r.idempotency_key));
  assert.strictEqual(keys.size, chain.length, 'all 8 keys must be distinct');
});

// --- _fs-watch-harness ---

test('_fs-watch-harness: push-driven events reach registered listeners', () => {
  const w = createInjectableFsWatch();
  const seen = [];
  w.on('change', (type, file) => seen.push([type, file]));
  w.emit('change', 'src/x.js');
  w.emit('rename', 'src/y.js'); // not a 'change' listener → ignored
  assert.deepStrictEqual(seen, [['change', 'src/x.js']]);
  assert.strictEqual(w.events().length, 2);
});

test('_fs-watch-harness: emit after close throws (no silent loss)', () => {
  const w = createInjectableFsWatch();
  w.close();
  assert.throws(() => w.emit('change', 'a'), /after close/);
});

// --- _crash-harness ---

test('_crash-harness: interrupted atomic write leaves the target absent', () => {
  const d = tmp();
  const target = path.join(d, 'mem.json');
  const { tmpPath } = simulateInterruptedAtomicWrite(target, '{"never":"committed"}');
  assert.strictEqual(fs.existsSync(target), false, 'target must not exist (rename never happened)');
  assert.strictEqual(fs.existsSync(tmpPath), true, 'orphan tmp sidecar exists');
  fs.rmSync(d, { recursive: true, force: true });
});

test('_crash-harness: interrupted atomic write preserves a pre-existing target byte-for-byte', () => {
  const d = tmp();
  const target = path.join(d, 'mem.json');
  fs.writeFileSync(target, 'OLD');
  simulateInterruptedAtomicWrite(target, 'NEW-that-crashes');
  assert.strictEqual(fs.readFileSync(target, 'utf8'), 'OLD');
  fs.rmSync(d, { recursive: true, force: true });
});

test('_crash-harness: torn WAL line is un-terminated (recovery must tolerate)', () => {
  const d = tmp();
  const wal = path.join(d, 'wal.jsonl');
  fs.writeFileSync(wal, JSON.stringify({ ok: 1 }) + '\n');
  const full = JSON.stringify({ a: 'b'.repeat(40) });
  appendTornWALLine(wal, full);
  const raw = fs.readFileSync(wal, 'utf8');
  assert.ok(!raw.endsWith('\n'), 'final torn line must NOT be newline-terminated');
  assert.ok(raw.split('\n')[0] === JSON.stringify({ ok: 1 }), 'prior complete record intact');
  fs.rmSync(d, { recursive: true, force: true });
});

test('_crash-harness: writeWalWithOrphanPending yields a final PENDING line', () => {
  const d = tmp();
  const wal = path.join(d, 'wal.jsonl');
  const committed = synthesizeChain({ count: 2 });
  const orphan = { ...committed[0], commit_outcome: 'PENDING', committed_at: null, post_state_hash: null };
  const { totalLines } = writeWalWithOrphanPending(wal, committed, orphan);
  const lines = fs.readFileSync(wal, 'utf8').trim().split('\n');
  assert.strictEqual(lines.length, totalLines);
  assert.strictEqual(JSON.parse(lines[lines.length - 1]).commit_outcome, 'PENDING');
  fs.rmSync(d, { recursive: true, force: true });
});

process.stdout.write(`\nharness-and-f23.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
