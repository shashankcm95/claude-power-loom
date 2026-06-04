#!/usr/bin/env node

// tests/unit/kernel/_lib/jsonl-read.test.js
//
// Tests for packages/kernel/_lib/jsonl-read.js — the shared BOUNDED JSONL reader. Extracted so both
// Lab attestation stores survive a flooded/hand-written ledger past V8's ~512MB single-string ceiling
// (v3.4 Wave-2 VALIDATE hacker H1). The load-bearing guarantees: NEVER throws (advisory); on an
// oversized file it TAIL-reads the newest records (NOT [], so a caller's read-modify-write keeps
// newest = no data loss); a corrupt line is skipped.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { readJsonlBounded, lastLines, DEFAULT_MAX_BYTES, HARD_MAX_BYTES } = require('../../../../packages/kernel/_lib/jsonl-read');

const TMP = path.join(os.tmpdir(), 'jsonl-read-' + crypto.randomBytes(6).toString('hex'));
fs.mkdirSync(TMP, { recursive: true });
const LEDGER = path.join(TMP, 'ledger.jsonl');

// Write N records {n:i} as JSONL.
function seed(n) {
  const body = Array.from({ length: n }, (_, i) => JSON.stringify({ n: i })).join('\n') + '\n';
  fs.writeFileSync(LEDGER, body);
  return fs.statSync(LEDGER).size;
}

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fs.rmSync(LEDGER, { force: true }); } catch { /* */ }
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

test('missing file → [] (no throw)', () => {
  assert.deepStrictEqual(readJsonlBounded(LEDGER, { name: 't' }), []);
});

test('normal file (≤ maxBytes) → all records parsed, in order', () => {
  seed(5);
  const recs = readJsonlBounded(LEDGER, { maxBytes: 1 << 20, maxRecords: 100, name: 't' });
  assert.deepStrictEqual(recs.map((r) => r.n), [0, 1, 2, 3, 4]);
});

test('a corrupt line is skipped (fail-soft), the rest parse', () => {
  fs.writeFileSync(LEDGER, `${JSON.stringify({ n: 0 })}\n{not json\n${JSON.stringify({ n: 2 })}\n`);
  const recs = readJsonlBounded(LEDGER, { name: 't' });
  assert.deepStrictEqual(recs.map((r) => r.n), [0, 2]);
});

test('> maxRecords lines → the NEWEST maxRecords are kept (by position)', () => {
  seed(50);
  const recs = readJsonlBounded(LEDGER, { maxBytes: 1 << 20, maxRecords: 10, name: 't' });
  assert.strictEqual(recs.length, 10);
  assert.deepStrictEqual(recs.map((r) => r.n), [40, 41, 42, 43, 44, 45, 46, 47, 48, 49], 'newest 10');
});

// ── ★ H1: an oversized file (> maxBytes) is TAIL-read — newest records, NOT [], NOT a throw, warns.
test('★ oversized file (> maxBytes) → tail read: newest records, never [] (the no-data-loss guarantee)', () => {
  const size = seed(200);                       // 200 small records
  assert.ok(size > 1024, 'fixture is bigger than the tiny maxBytes');
  const recs = readJsonlBounded(LEDGER, { maxBytes: 1024, maxRecords: 10000, name: 't' });
  assert.ok(recs.length > 0, 'NOT empty — a caller RMW must not wipe a large ledger to []');
  assert.ok(recs.length < 200, 'tail only — older records beyond the byte bound are not loaded');
  // the records returned are the NEWEST contiguous tail (highest n), and the last record is n=199
  assert.strictEqual(recs[recs.length - 1].n, 199, 'newest record present');
  for (let i = 1; i < recs.length; i += 1) {
    assert.strictEqual(recs[i].n, recs[i - 1].n + 1, 'contiguous newest tail');
  }
});

test('oversized + maxRecords both bind → newest maxRecords from the tail', () => {
  seed(500);
  const recs = readJsonlBounded(LEDGER, { maxBytes: 4096, maxRecords: 5, name: 't' });
  assert.strictEqual(recs.length, 5);
  assert.strictEqual(recs[recs.length - 1].n, 499, 'newest');
});

test('the default byte bound is < V8 ~512MB single-string ceiling (so readFileSync never trips it)', () => {
  assert.ok(DEFAULT_MAX_BYTES > 0 && DEFAULT_MAX_BYTES < 500 * 1024 * 1024, `bound=${DEFAULT_MAX_BYTES}`);
});

// ── lastLines() — the backward-scan record cap (VALIDATE hacker H-1: never split()+slice the whole file).
test('lastLines: edge cases (empty / no-trailing-nl / trailing-nl / empty-lines-skipped / fewer-than-max)', () => {
  assert.deepStrictEqual(lastLines('', 10), []);
  assert.deepStrictEqual(lastLines('a', 10), ['a']);              // no trailing newline
  assert.deepStrictEqual(lastLines('a\nb\nc\n', 10), ['a', 'b', 'c']); // trailing newline
  assert.deepStrictEqual(lastLines('a\n\nb\n', 10), ['a', 'b']);  // empty line skipped (like filter)
  assert.deepStrictEqual(lastLines('a\nb\nc\n', 2), ['b', 'c']);  // last 2
});

// ── ★ H-1: a many-line string (under the byte bound) is capped WITHOUT materializing all lines.
test('★ H-1: capping is by backward scan — newest maxRecords from a 200k-line input (no full split)', () => {
  const body = Array.from({ length: 200000 }, (_, i) => JSON.stringify({ n: i })).join('\n') + '\n';
  fs.writeFileSync(LEDGER, body);
  const recs = readJsonlBounded(LEDGER, { maxBytes: HARD_MAX_BYTES, maxRecords: 3, name: 't' });
  assert.deepStrictEqual(recs.map((r) => r.n), [199997, 199998, 199999], 'newest 3 of 200k, scanned not split');
});

// ── ★ M-1: an over-cap / non-finite maxBytes is clamped (a caller can shrink, never DISABLE the bound).
test('★ M-1: non-finite / over-HARD_MAX maxBytes is handled gracefully (clamped, no throw)', () => {
  seed(5);
  for (const bad of [Infinity, 1e30, Number.NaN, -1]) {
    let recs;
    assert.doesNotThrow(() => { recs = readJsonlBounded(LEDGER, { maxBytes: bad, maxRecords: 100, name: 't' }); }, `maxBytes=${bad}`);
    assert.deepStrictEqual(recs.map((r) => r.n), [0, 1, 2, 3, 4], 'still reads the small file correctly');
  }
});

// ── M-2: a single line longer than the tail window (no newline) → [] (pathological fail-soft, documented).
test('M-2: a giant single line with no newline in the tail window → [] (fail-soft, not a throw)', () => {
  fs.writeFileSync(LEDGER, 'x'.repeat(5000)); // one 5KB line, no newline
  const recs = readJsonlBounded(LEDGER, { maxBytes: 1024, maxRecords: 100, name: 't' });
  assert.deepStrictEqual(recs, [], 'a single >maxBytes line is dropped (the write path caps field size)');
});

process.stdout.write(`\njsonl-read.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
