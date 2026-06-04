#!/usr/bin/env node

// tests/unit/kernel/_lib/evolution-snapshot-read.test.js
//
// v3.4 Wave 3 — the A6 hot-path snapshot reader leaf (the 4th extract-to-leaf). This is the kernel
// side of the §3.6 Lab→Kernel data contract: spawn-record.js reads the lab-materialized reputation
// snapshot AS A FILE (K12-clean — no lab import). The leaf is the SINGLE SOURCE OF TRUTH for the
// cross-layer contract: the path resolver (verify-plan CR-HIGH-2) + the hash basis (A-LOW-5) + the
// bounded fail-open read. It MUST NEVER throw (the spawn hot path is fail-soft) and MUST self-verify
// the stored content-hash (INV-22 — never trust a self-asserted hash).

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TMP = path.join(os.tmpdir(), 'w3-a6-read-' + crypto.randomBytes(6).toString('hex'));
fs.mkdirSync(TMP, { recursive: true });

const {
  resolveSnapshotPath,
  snapshotHashBody,
  computeSnapshotHash,
  readEvolutionSnapshot,
} = require('../../../../packages/kernel/_lib/evolution-snapshot-read');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// Build a VALID snapshot file (using the leaf's own hash fn so the fixture is self-consistent).
function validSnapshot(overrides) {
  const body = {
    schema_version: 'v1',
    kind: 'evolution-snapshot/reputation',
    generated_at: '2026-06-04T00:00:00.000Z',
    source: 'verdict-attestation',
    label: 'advisory-verdict distribution over kernel-attested spawns — NOT a quality score',
    watermark: { record_count: 3, max_recorded_at: '2026-06-03T00:00:00.000Z', excluded_unenriched: 1 },
    personas: [
      { persona: 'node-backend', total: 2, distinct_spawns: 2, by_verdict: { pass: 2, partial: 0, fail: 0 } },
    ],
    ...(overrides || {}),
  };
  return { ...body, content_hash: computeSnapshotHash(body) };
}
function writeSnap(file, obj) {
  fs.writeFileSync(file, typeof obj === 'string' ? obj : JSON.stringify(obj));
  return file;
}

// ---- resolveSnapshotPath: the one formula both sides share (CR-HIGH-2) ----
test('resolveSnapshotPath: LOOM_EVOLUTION_SNAPSHOT_PATH wins over LOOM_LAB_STATE_DIR', () => {
  const saved = { ...process.env };
  try {
    process.env.LOOM_EVOLUTION_SNAPSHOT_PATH = '/explicit/snap.json';
    process.env.LOOM_LAB_STATE_DIR = '/some/lab';
    assert.strictEqual(resolveSnapshotPath(), '/explicit/snap.json');
  } finally { process.env = saved; }
});

test('resolveSnapshotPath: falls back to LOOM_LAB_STATE_DIR/reputation-snapshot.json', () => {
  const saved = { ...process.env };
  try {
    delete process.env.LOOM_EVOLUTION_SNAPSHOT_PATH;
    process.env.LOOM_LAB_STATE_DIR = '/some/lab';
    assert.strictEqual(resolveSnapshotPath(), path.join('/some/lab', 'reputation-snapshot.json'));
  } finally { process.env = saved; }
});

test('resolveSnapshotPath: default is ~/.claude/lab-state/reputation-snapshot.json', () => {
  const saved = { ...process.env };
  try {
    delete process.env.LOOM_EVOLUTION_SNAPSHOT_PATH;
    delete process.env.LOOM_LAB_STATE_DIR;
    assert.strictEqual(resolveSnapshotPath(), path.join(os.homedir(), '.claude', 'lab-state', 'reputation-snapshot.json'));
  } finally { process.env = saved; }
});

// ---- snapshotHashBody / computeSnapshotHash: one basis, excludes content_hash ----
test('snapshotHashBody EXCLUDES content_hash (no self-reference)', () => {
  const snap = validSnapshot();
  const body = snapshotHashBody(snap);
  assert.ok(!('content_hash' in body), 'content_hash stripped from the hash basis');
  assert.strictEqual(body.generated_at, snap.generated_at, 'generated_at retained (deterministic given now)');
});

test('computeSnapshotHash is deterministic + insertion-order-independent', () => {
  const a = computeSnapshotHash({ source: 'x', personas: [], watermark: { a: 1, b: 2 } });
  const b = computeSnapshotHash({ watermark: { b: 2, a: 1 }, personas: [], source: 'x' });
  assert.strictEqual(a, b, 'canonical key-sort → same hash regardless of key order');
});

// ---- readEvolutionSnapshot: fail-open totality (NEVER throws) ----
test('absent file → {present:false, reason:absent}', () => {
  const r = readEvolutionSnapshot(path.join(TMP, 'nope.json'));
  assert.deepStrictEqual({ present: r.present, reason: r.reason }, { present: false, reason: 'absent' });
});

test('a directory at the path → {present:false} (no throw)', () => {
  const d = path.join(TMP, 'a-dir'); fs.mkdirSync(d, { recursive: true });
  const r = readEvolutionSnapshot(d);
  assert.strictEqual(r.present, false);
});

test('unparseable (not JSON) → {present:false, reason:unparseable}', () => {
  const f = writeSnap(path.join(TMP, 'bad.json'), 'this is not json{{{');
  const r = readEvolutionSnapshot(f);
  assert.strictEqual(r.present, false);
  assert.strictEqual(r.reason, 'unparseable');
});

test('malformed (missing personas / content_hash) → {present:false, reason:malformed}', () => {
  const f = writeSnap(path.join(TMP, 'malformed.json'), { source: 'x' });
  const r = readEvolutionSnapshot(f);
  assert.strictEqual(r.present, false);
  assert.strictEqual(r.reason, 'malformed');
});

test('★ hash-mismatch (tampered body) → {present:false, reason:hash-mismatch} (INV-22 self-verify)', () => {
  const snap = validSnapshot();
  snap.watermark.record_count = 9999; // tamper AFTER the hash was computed
  const f = writeSnap(path.join(TMP, 'tampered.json'), snap);
  const r = readEvolutionSnapshot(f);
  assert.strictEqual(r.present, false);
  assert.strictEqual(r.reason, 'hash-mismatch');
});

test('★ oversized (> env-capped bytes) → {present:false, reason:oversized}', () => {
  const saved = process.env.LOOM_SNAPSHOT_MAX_BYTES;
  try {
    process.env.LOOM_SNAPSHOT_MAX_BYTES = '256'; // tiny cap for the test
    const f = writeSnap(path.join(TMP, 'big.json'), validSnapshot()); // > 256 bytes
    const r = readEvolutionSnapshot(f);
    assert.strictEqual(r.present, false);
    assert.strictEqual(r.reason, 'oversized');
  } finally {
    if (saved === undefined) delete process.env.LOOM_SNAPSHOT_MAX_BYTES; else process.env.LOOM_SNAPSHOT_MAX_BYTES = saved;
  }
});

test('valid snapshot → {present:true} with matching hash + value + watermark', () => {
  const snap = validSnapshot();
  const f = writeSnap(path.join(TMP, 'ok.json'), snap);
  const r = readEvolutionSnapshot(f);
  assert.strictEqual(r.present, true, `present (reason=${r.reason})`);
  assert.strictEqual(r.content_hash, snap.content_hash);
  assert.strictEqual(r.source, 'verdict-attestation');
  assert.ok(Array.isArray(r.value) && r.value[0].persona === 'node-backend', 'value carries the personas distribution');
  assert.strictEqual(r.watermark.record_count, 3);
  assert.strictEqual(r.truncated, false);
});

test('★ a __proto__ persona key reads safely (no prototype pollution) + hashes deterministically (A-LOW-4)', () => {
  const snap = validSnapshot({ personas: [{ persona: '__proto__', total: 1, distinct_spawns: 1, by_verdict: { pass: 1, partial: 0, fail: 0 } }] });
  const f = writeSnap(path.join(TMP, 'proto.json'), snap);
  const r = readEvolutionSnapshot(f);
  assert.strictEqual(r.present, true, `present (reason=${r.reason})`);
  assert.strictEqual({}.total, undefined, 'Object.prototype not polluted');
  // deterministic re-read
  assert.strictEqual(readEvolutionSnapshot(f).content_hash, r.content_hash);
});

test('a UTF-8 BOM-prefixed file → {present:false, reason:unparseable} (documents cross-platform behavior)', () => {
  const f = writeSnap(path.join(TMP, 'bom.json'), `\uFEFF${JSON.stringify(validSnapshot())}`);
  const r = readEvolutionSnapshot(f);
  assert.strictEqual(r.present, false);
  assert.strictEqual(r.reason, 'unparseable'); // fail-open (safe); BOM is not valid JSON whitespace
});

test('★ FIFO at the path → {present:false} WITHOUT hanging (hacker MED — type-TOCTOU/handle discipline)', () => {
  const fifo = path.join(TMP, 'a.fifo');
  try { fs.rmSync(fifo, { force: true }); } catch { /* */ }
  const mk = require('child_process').spawnSync('mkfifo', [fifo]);
  if (mk.status !== 0) { process.stdout.write('  (skip: mkfifo unavailable)\n'); return; }
  const start = Date.now();
  const r = readEvolutionSnapshot(fifo); // must NOT block on a no-writer FIFO
  assert.ok(Date.now() - start < 1000, 'returned promptly (no blocking read)');
  assert.strictEqual(r.present, false);
});

test('★ never throws on a weird/empty/garbage path', () => {
  for (const p of ['', '/', '\0bad', path.join(TMP, 'x'.repeat(300))]) {
    let threw = false;
    try { const r = readEvolutionSnapshot(p); assert.strictEqual(r.present, false); }
    catch { threw = true; }
    assert.strictEqual(threw, false, `no throw for path ${JSON.stringify(p)}`);
  }
});

process.stdout.write(`\nevolution-snapshot-read.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
