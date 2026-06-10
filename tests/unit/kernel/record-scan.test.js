#!/usr/bin/env node

// tests/unit/kernel/record-scan.test.js
//
// v3.6 W2b.2 — scanCommittedOps: the cross-run, mtime-windowed read the promote-path
// breaker counts over. RED-first. Reuses the record-locate enumeration gates
// (isSafePathSegment + realpathSync + checkWithinRoot). Windows on FS mtime (NOT the
// content-hashed intent_recorded_at — the hacker C1 back-date evasion). No content-verify
// (halt-only count). Distinguishes absent-store ([] clean) from unreadable-base (throw →
// the consumer fails CLOSED, M3).

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..', '..', '..');
const { scanCommittedOps } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'record-scan.js'));

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; } catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

const hex64 = () => crypto.randomBytes(32).toString('hex');
function freshStore() {
  const d = path.join(os.tmpdir(), 'rscan-' + crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(d, { recursive: true });
  return d;
}
// Write a record-<64hex>.json into <stateDir>/<runId>/records/ with the given op_class +
// set its mtime to mtimeMs (the window axis). Returns the txid.
function writeRecord(stateDir, runId, opClass, mtimeMs) {
  const txid = hex64();
  const dir = path.join(stateDir, runId, 'records');
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, 'record-' + txid + '.json');
  fs.writeFileSync(fp, JSON.stringify({ transaction_id: txid, operation_class: opClass }));
  const sec = mtimeMs / 1000;
  fs.utimesSync(fp, sec, sec);
  return txid;
}

const NOW = 1_750_000_000_000; // fixed wall-clock for determinism
const MIN = 60 * 1000;

// -- cross-run: counts destructive ops across MULTIPLE runs (the H1 fix).
test('scanCommittedOps: aggregates TOMBSTONE/SUPERSEDE across runs, in-window by mtime', () => {
  const s = freshStore();
  try {
    writeRecord(s, 'runA', 'TOMBSTONE', NOW - 1 * MIN);
    writeRecord(s, 'runB', 'SUPERSEDE', NOW - 2 * MIN);
    writeRecord(s, 'runC', 'TOMBSTONE', NOW - 3 * MIN);
    const got = scanCommittedOps({ opClasses: ['TOMBSTONE', 'SUPERSEDE'], sinceMs: NOW - 10 * MIN, stateDir: s });
    assert.strictEqual(got.length, 3, 'all three destructive ops across runs are counted');
    assert.ok(got.every((r) => typeof r.transaction_id === 'string' && typeof r.mtime_ms === 'number'));
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

// -- mtime window: a record older than sinceMs (by mtime) is excluded; a back-dated
// intent_recorded_at is irrelevant (we never read it) — the C1 evasion is closed.
test('scanCommittedOps: excludes records with mtime older than sinceMs (windows on mtime)', () => {
  const s = freshStore();
  try {
    writeRecord(s, 'r', 'TOMBSTONE', NOW - 2 * MIN);   // in 10-min window
    writeRecord(s, 'r', 'TOMBSTONE', NOW - 20 * MIN);  // aged out
    const got = scanCommittedOps({ opClasses: ['TOMBSTONE', 'SUPERSEDE'], sinceMs: NOW - 10 * MIN, stateDir: s });
    assert.strictEqual(got.length, 1, 'only the in-window record by mtime');
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

// -- op_class filter: a non-destructive op (CREATE/APPEND) is NOT counted.
test('scanCommittedOps: excludes non-destructive operation_class', () => {
  const s = freshStore();
  try {
    writeRecord(s, 'r', 'CREATE', NOW - 1 * MIN);
    writeRecord(s, 'r', 'APPEND', NOW - 1 * MIN);
    writeRecord(s, 'r', 'SUPERSEDE', NOW - 1 * MIN);
    const got = scanCommittedOps({ opClasses: ['TOMBSTONE', 'SUPERSEDE'], sinceMs: NOW - 10 * MIN, stateDir: s });
    assert.strictEqual(got.length, 1, 'only the SUPERSEDE');
    assert.strictEqual(got[0].operation_class, 'SUPERSEDE');
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

// -- path-traversal: a run dir that is a SYMLINK escaping the store root is skipped (the real
// checkWithinRoot gate — VALIDATE code-reviewer HIGH: the prior `..evil` test was vacuous, as
// isSafePathSegment PASSES `..evil`; this exercises the gate that actually matters).
test('scanCommittedOps: skips a run symlinked OUTSIDE the store root (checkWithinRoot)', () => {
  const s = freshStore();
  const outside = freshStore();
  try {
    writeRecord(s, 'goodrun', 'TOMBSTONE', NOW - 1 * MIN);
    writeRecord(outside, 'x', 'TOMBSTONE', NOW - 1 * MIN);           // a destructive record OUTSIDE the store
    fs.symlinkSync(path.join(outside, 'x'), path.join(s, 'escaperun'), 'dir'); // an in-store run → outside
    const got = scanCommittedOps({ opClasses: ['TOMBSTONE'], sinceMs: NOW - 10 * MIN, stateDir: s });
    assert.strictEqual(got.length, 1, 'the symlinked-out run is refused by checkWithinRoot; only the in-store run counts');
  } finally { fs.rmSync(s, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

// -- a run dir lacking a records/ subdir is silently skipped (resilience — not a security gate).
test('scanCommittedOps: a run dir without a records/ subdir is silently skipped', () => {
  const s = freshStore();
  try {
    writeRecord(s, 'goodrun', 'TOMBSTONE', NOW - 1 * MIN);
    fs.mkdirSync(path.join(s, 'norecords'), { recursive: true });
    const got = scanCommittedOps({ opClasses: ['TOMBSTONE'], sinceMs: NOW - 10 * MIN, stateDir: s });
    assert.strictEqual(got.length, 1);
  } finally { fs.rmSync(s, { recursive: true, force: true }); }
});

// -- absent store: a non-existent stateDir is a CLEAN empty result (0 mints) -> [] (NOT a throw).
test('scanCommittedOps: an absent store -> [] (clean empty, not an error)', () => {
  const missing = path.join(os.tmpdir(), 'rscan-absent-' + crypto.randomBytes(6).toString('hex'));
  assert.deepStrictEqual(scanCommittedOps({ opClasses: ['TOMBSTONE'], sinceMs: 0, stateDir: missing }), []);
});

// -- M3: an unreadable base THROWS (so the consumer can fail CLOSED), distinct from clean-empty.
test('scanCommittedOps: an unreadable base throws (M3 fail-closed signal)', () => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) { process.stdout.write('    (skipped: root bypasses perms)\n'); return; }
  const s = freshStore();
  try {
    fs.chmodSync(s, 0o000); // base exists but unreadable
    let threw = false;
    try { scanCommittedOps({ opClasses: ['TOMBSTONE'], sinceMs: 0, stateDir: s }); } catch { threw = true; }
    assert.strictEqual(threw, true, 'an unreadable base must throw, not silently return []');
  } finally { fs.chmodSync(s, 0o700); fs.rmSync(s, { recursive: true, force: true }); }
});

process.stdout.write(`\nrecord-scan.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
