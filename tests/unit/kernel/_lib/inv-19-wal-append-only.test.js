#!/usr/bin/env node

// tests/unit/kernel/_lib/inv-19-wal-append-only.test.js
//
// Property test for INV-19-WALAppendOnly per v6 §6.13.
//
// Property: After N transactions, the WAL file has exactly N lines. mtime of
// any historical line equals its original write time (no in-place mutation).
//
// Implementation: synthesize a WAL with K records → snapshot byte-length + line-count
// → append M more records → assert first-K-lines byte-prefix unchanged.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  createTmpDir,
  synthesizeChain,
  writeWAL,
  appendWAL,
  readWAL,
  walSnapshot,
} = require('./_test-harness');

let passed = 0;
let failed = 0;

function test(name, fn) {
  const tmp = createTmpDir('inv19-test');
  try {
    fn(tmp);
    process.stdout.write(`  PASS ${name}\n`);
    passed++;
  } catch (err) {
    process.stdout.write(`  FAIL ${name}: ${err.message}\n`);
    failed++;
  } finally {
    tmp.cleanup();
  }
}

test('INV-19: WAL line count equals transaction count', (tmp) => {
  const walPath = path.join(tmp.path, 'attestation-log.jsonl');
  const records = synthesizeChain({ count: 10 });
  writeWAL(walPath, records);

  const snap = walSnapshot(walPath);
  assert.strictEqual(snap.lineCount, 10);
});

test('INV-19: appending records preserves prior records byte-for-byte', (tmp) => {
  const walPath = path.join(tmp.path, 'attestation-log.jsonl');
  const initial = synthesizeChain({ count: 5 });
  writeWAL(walPath, initial);

  const prefix = fs.readFileSync(walPath, 'utf8');
  const prefixBytes = Buffer.byteLength(prefix, 'utf8');

  // Append 5 more records (with proper chain linkage).
  const more = synthesizeChain({ count: 5, startAt: '2026-02-01T00:00:00Z' });
  for (const r of more) appendWAL(walPath, r);

  const after = fs.readFileSync(walPath, 'utf8');
  const afterPrefix = after.slice(0, prefixBytes);

  assert.strictEqual(afterPrefix, prefix, 'first N bytes of WAL must match pre-append snapshot');
});

test('INV-19: total line count = original + appended', (tmp) => {
  const walPath = path.join(tmp.path, 'attestation-log.jsonl');
  writeWAL(walPath, synthesizeChain({ count: 3 }));
  for (const r of synthesizeChain({ count: 4, startAt: '2026-03-01T00:00:00Z' })) {
    appendWAL(walPath, r);
  }

  const snap = walSnapshot(walPath);
  assert.strictEqual(snap.lineCount, 7);
});

test('INV-19: each WAL line is valid JSON', (tmp) => {
  const walPath = path.join(tmp.path, 'attestation-log.jsonl');
  writeWAL(walPath, synthesizeChain({ count: 5 }));

  const records = readWAL(walPath);
  assert.strictEqual(records.length, 5);
  for (const r of records) {
    assert.ok(r.transaction_id);
    assert.match(r.transaction_id, /^[a-f0-9]{64}$/);
  }
});

test('INV-19: synthesized chain has proper prev_state_hash linkage', (tmp) => {
  const records = synthesizeChain({ count: 4 });
  for (let i = 1; i < records.length; i++) {
    assert.strictEqual(
      records[i].prev_state_hash,
      records[i - 1].post_state_hash,
      `record ${i} prev_state_hash must equal record ${i - 1} post_state_hash`
    );
  }
});

process.stdout.write(`\ninv-19-wal-append-only.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
