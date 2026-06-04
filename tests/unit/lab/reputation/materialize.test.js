#!/usr/bin/env node

// tests/unit/lab/reputation/materialize.test.js
//
// v3.4 Wave 3 — the off-hot-path A6 materializer. It is the ONLY I/O site for E4 (project.js stays a
// pure deterministic theorem): projectReputation → snapshot body → SHARED content-hash → atomic-rename
// write to the SHARED resolveSnapshotPath(). The round-trip (materialize → readEvolutionSnapshot) and
// the env-mismatch test (verify-plan CR-HIGH-2/CR-MED-4) lock the writer↔reader against path/hash drift.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TMP = path.join(os.tmpdir(), 'w3-a6-mat-' + crypto.randomBytes(6).toString('hex'));
process.env.LOOM_LAB_STATE_DIR = TMP; // BEFORE requiring the store (ENV-BEFORE-REQUIRE)
delete process.env.LOOM_EVOLUTION_SNAPSHOT_PATH;
fs.mkdirSync(TMP, { recursive: true });

const REPO = path.join(__dirname, '..', '..', '..', '..');
const store = require(path.join(REPO, 'packages', 'lab', 'verdict-attestation', 'store.js'));
const { materializeSnapshot } = require(path.join(REPO, 'packages', 'lab', 'reputation', 'materialize.js'));
const { readEvolutionSnapshot, resolveSnapshotPath } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'evolution-snapshot-read.js'));

const NOW = '2026-06-04T00:00:00.000Z';

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fs.rmSync(store.LEDGER_PATH, { force: true }); } catch { /* */ }
  try { fs.rmSync(resolveSnapshotPath(), { force: true }); } catch { /* */ }
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}
function seedEnriched(persona, agentId, txid) {
  const rec = store.recordVerdict({ verdict: 'pass', subject: { persona }, verifier: { identity: 'r.a', kind: 'structural' }, agentId });
  store.enrichRecord(rec.attestation_id, { runId: 'run1', transactionId: txid, recordStatus: 'appended' });
}

test('empty store → writes a VALID snapshot (personas:[]), readable, hash matches', () => {
  const out = materializeSnapshot({ now: NOW });
  assert.strictEqual(out.path, resolveSnapshotPath(), 'writes to the SHARED path');
  assert.strictEqual(out.persona_count, 0);
  const r = readEvolutionSnapshot();
  assert.strictEqual(r.present, true, `present (reason=${r.reason})`);
  assert.strictEqual(r.content_hash, out.content_hash, 'reader confirms the writer hash (self-verify passed)');
  assert.deepStrictEqual(r.value, []);
});

test('★ round-trip after seeding: materialize → readEvolutionSnapshot present:true with the persona', () => {
  seedEnriched('node-backend', 'aMat1', 'txMat1');
  const out = materializeSnapshot({ now: NOW });
  assert.strictEqual(out.persona_count, 1);
  const r = readEvolutionSnapshot();
  assert.strictEqual(r.present, true, `present (reason=${r.reason})`);
  assert.strictEqual(r.value[0].persona, 'node-backend');
  assert.strictEqual(r.content_hash, out.content_hash);
  assert.ok(r.watermark.record_count >= 1, 'watermark carries a record_count');
});

test('★ deterministic: same (ledger, now) → identical content_hash', () => {
  seedEnriched('react-frontend', 'aMat2', 'txMat2');
  const a = materializeSnapshot({ now: NOW });
  const b = materializeSnapshot({ now: NOW });
  assert.strictEqual(a.content_hash, b.content_hash);
});

test('★ re-materialize SUPERSEDES: adding a verdict → new hash; reader picks up the successor', () => {
  seedEnriched('node-backend', 'aMat3', 'txMat3');
  const before = materializeSnapshot({ now: NOW });
  seedEnriched('node-backend', 'aMat4', 'txMat4'); // distinct spawn → distribution changes
  const after = materializeSnapshot({ now: NOW });
  assert.notStrictEqual(before.content_hash, after.content_hash, 'supersession changes the hash');
  assert.strictEqual(readEvolutionSnapshot().content_hash, after.content_hash, 'reader sees the latest');
});

test('does NOT mutate the ledger (project stays pure; materialize only reads + writes the snapshot)', () => {
  seedEnriched('node-backend', 'aMat5', 'txMat5');
  const before = fs.readFileSync(store.LEDGER_PATH, 'utf8');
  materializeSnapshot({ now: NOW });
  assert.strictEqual(fs.readFileSync(store.LEDGER_PATH, 'utf8'), before, 'ledger untouched');
});

test('★ env-mismatch (CR-MED-4): default-path round-trip works; an override mismatch → present:false', () => {
  seedEnriched('node-backend', 'aMat6', 'txMat6');
  materializeSnapshot({ now: NOW }); // writes to the DEFAULT (LOOM_LAB_STATE_DIR base), no override set
  assert.strictEqual(readEvolutionSnapshot().present, true, 'no-env round-trip succeeds (one formula)');
  const saved = process.env.LOOM_EVOLUTION_SNAPSHOT_PATH;
  try {
    process.env.LOOM_EVOLUTION_SNAPSHOT_PATH = path.join(TMP, 'elsewhere.json'); // reader looks elsewhere
    assert.strictEqual(readEvolutionSnapshot().present, false, 'a path override the writer did not use → absent (mismatch IS detectable)');
  } finally {
    if (saved === undefined) delete process.env.LOOM_EVOLUTION_SNAPSHOT_PATH; else process.env.LOOM_EVOLUTION_SNAPSHOT_PATH = saved;
  }
});

process.stdout.write(`\nmaterialize.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
