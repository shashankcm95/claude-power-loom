#!/usr/bin/env node

// tests/unit/kernel/_lib/record-store.test.js
//
// PR-P1 — record-store.js: the provenance state-chain store (ships DORMANT).
// TDD Phase 1: written FIRST, runs RED against a missing module
// (packages/kernel/_lib/record-store.js). Impl (Phase 3) fills the module
// minimum-to-green; no scope creep beyond this set.
//
// Behavioral contract (this file IS the contract for the architect pair-run):
//   - appendRecord/readById round-trip (content-addressed by transaction_id).
//   - appendRecord validation ORDER (F3): validateTransactionRecord FIRST, then
//     the computeTransactionId integrity check. A forged transaction_id is
//     rejected; an invalid record is rejected with NO file written.
//   - appendRecord uses the LENIENT runtime validateTransactionRecord, NOT the
//     schema's additionalProperties:false (INV-K2-SchemaForwardCompat / F4): an
//     extra unknown field is ACCEPTED.
//   - appendRecord REJECTS a record carrying _test_chain_marker (the dedicated
//     validateTransactionRecord :213 branch), before the integrity check (F4-test).
//   - readByPostStateHash(h) returns the record whose post_state_hash === h —
//     THE K9 resolveParent seam (Probe #1: the chain key is post_state_hash, NOT
//     transaction_id). A PENDING record (post_state_hash:null) never matches.
//   - ANTI-FALLACY (load-bearing): over a chain, readByPostStateHash(child
//     .prev_state_hash) returns the parent; AND no stored record has
//     transaction_id === child.prev_state_hash (readById(child.prev_state_hash)
//     === null). Locks Probe #1 as a checked fact over the set.
//   - K9 integration (executable proof): wiring resolveParent =
//     readByPostStateHash makes a genesis-terminating non-genesis walk PASS with
//     depthWalked>=1; wiring resolveParent = readById makes the SAME walk FAIL
//     with reason 'chain-bottomed-out-non-genesis' (the transaction_id keying
//     fails the real gate, for the intended reason).
//   - CWE-22: a non-hex key (e.g. '../../etc/passwd') returns null and NEVER
//     reaches fs.readFileSync (the hex-gate returns before any path.join).
//   - Fail-soft / TOCTOU: readers on an absent run dir return null/[] with no
//     throw (readdirSync/readFileSync wrapped; no existsSync pre-check).
//   - listByRun returns the sibling set, skipping invalid/corrupt record-*.json.
//   - Concurrency: two appendRecord calls for distinct records in one run leave
//     both files present (one-file-per-record, no clobber).
//
// Test-data discipline (verify-plan F1 CRITICAL): records are built via a LOCAL
// valid-record helper that emits records WITHOUT _test_chain_marker from the
// start. synthesizeChain is BANNED for append tests — its transaction_id is
// computed OVER the marker (_test-harness.js:165), so a post-hoc strip makes
// record.transaction_id !== computeTransactionId(strippedRecord), and
// appendRecord's integrity check silently rejects it (a write-reject
// masquerading as a read-miss). Tests 1-9 build genesis with the literal 'GENESIS'
// sentinel. Test 8b (PR-P3b) ADDS the producer-form genesis (prev_state_hash =
// computeGenesisHash) and proves K9's isGenesisPosition now recognizes it after
// P3a's OQ-2 fix — before P3a that walk REJECTed chain-bottomed-out-non-genesis.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const store = require('../../../../packages/kernel/_lib/record-store');
const k9 = require('../../../../packages/kernel/_lib/k9-promote-deltas');
const {
  computeTransactionId,
  computeGenesisHash,
  validateTransactionRecord,
  deriveIdempotencyKey,
} = require('../../../../packages/kernel/_lib/transaction-record');
// PR-P3b — the REAL producer, to prove a producer-form genesis record (prev =
// computeGenesisHash, NOT the literal 'GENESIS') walk-terminates via the real
// store after P3a's OQ-2 fix (test 8b). buildSpawnRecord is the actual emitter the
// live close hook uses, so the proof exercises the genuine record shape.
const { buildSpawnRecord } = require('../../../../packages/kernel/_lib/quarantine-promote');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

// ── Local valid-record helper (NO _test_chain_marker; F1 CRITICAL) ───────────
//
// Emits a canonical, integrity-consistent transaction record (transaction_id
// computed over the marker-free body, so appendRecord's integrity check passes).
// `hashSeed` distinguishes the post_state_hash per record (one per chain link).
// A genesis record (isGenesis) carries the literal 'GENESIS' prev_state_hash so
// K9's isGenesisPosition terminates the walk on it (OQ-2: NOT computeGenesisHash).
function buildRecord(opts = {}) {
  const {
    hashSeed = crypto.randomBytes(8).toString('hex'),
    prevStateHash = 'b'.repeat(64),
    isGenesis = false,
    postStateHash, // explicit override; otherwise derived from hashSeed
    seq = 0,
    // PR-P3b: vary the wall-clock to mint a DIFFERENT transaction_id for the SAME
    // post_state_hash (the F-01 dup repro — a re-fired close time-salts the id).
    intentRecordedAt = '2026-01-01T00:00:00.000Z',
  } = opts;
  const post = postStateHash !== undefined
    ? postStateHash
    : crypto.createHash('sha256').update('post-' + hashSeed).digest('hex');
  const body = {
    prev_state_hash: isGenesis ? 'GENESIS' : prevStateHash,
    writer_persona_id: '04-architect.theo',
    writer_spawn_id: 'sp-2026-01-01T00:00:00.000Z-arch-' + String(seq).padStart(4, '0'),
    operation_class: 'CREATE',
    evidence_refs: isGenesis
      ? ['ROOT_TASK_RECORD:task-' + hashSeed]
      : ['USER_INTENT_AXIOM:' + 'c'.repeat(64)],
    intent_recorded_at: intentRecordedAt,
    commit_outcome: 'COMMITTED',
    schema_version: 'v3',
  };
  // post_state_hash is null for a PENDING record; otherwise the derived hash.
  if (post !== null) body.post_state_hash = post;
  const transaction_id = computeTransactionId(body);
  return { transaction_id, ...body };
}

// Build a 2-link STATE chain: genesis (prev='GENESIS') then a child whose
// prev_state_hash == genesis.post_state_hash (the canonical state-chain edge).
function buildChainOf2() {
  const genesis = buildRecord({ hashSeed: 'gen', isGenesis: true, seq: 0 });
  const child = buildRecord({
    hashSeed: 'child',
    prevStateHash: genesis.post_state_hash, // STATE-chain edge → parent's post_state_hash
    seq: 1,
  });
  return { genesis, child };
}

function tmpStateDir(prefix = 'record-store') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix + '-'));
}
function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

const RUN_ID = 'run-2026-06-01-pr-p1';

// ── 1. round-trip ────────────────────────────────────────────────────────────

test('1. appendRecord + readById round-trip', () => {
  const stateDir = tmpStateDir();
  try {
    const rec = buildRecord({ hashSeed: 'rt' });
    const res = store.appendRecord(rec, { runId: RUN_ID, stateDir });
    assert.strictEqual(res.ok, true, `append must succeed; got ${JSON.stringify(res)}`);
    assert.strictEqual(res.transaction_id, rec.transaction_id, 'append echoes the transaction_id');
    const got = store.readById(rec.transaction_id, { runId: RUN_ID, stateDir });
    assert.ok(got, 'readById must return the stored record');
    assert.strictEqual(got.transaction_id, rec.transaction_id);
    assert.strictEqual(got.post_state_hash, rec.post_state_hash);
  } finally { cleanup(stateDir); }
});

// ── 2. invalid record rejected, no file (validate FIRST) ─────────────────────

test('2. appendRecord rejects an invalid record (missing required field); no file written', () => {
  const stateDir = tmpStateDir();
  try {
    const rec = buildRecord({ hashSeed: 'bad' });
    delete rec.writer_persona_id; // now structurally invalid (missing required)
    // The transaction_id is now also stale, but validateTransactionRecord runs
    // FIRST (F3), so the rejection is on the missing field, not the integrity check.
    const res = store.appendRecord(rec, { runId: RUN_ID, stateDir });
    assert.strictEqual(res.ok, false, 'invalid record must be rejected');
    const dir = store.recordStoreDir({ runId: RUN_ID, stateDir });
    const present = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    assert.deepStrictEqual(present, [], 'no file may be written for a rejected record');
  } finally { cleanup(stateDir); }
});

// ── 3. forged transaction_id rejected (integrity guard) ──────────────────────

test('3. appendRecord rejects transaction_id != computeTransactionId(record) (forged-id guard)', () => {
  const stateDir = tmpStateDir();
  try {
    const rec = buildRecord({ hashSeed: 'forge' });
    const forged = { ...rec, transaction_id: 'f'.repeat(64) }; // valid hex shape, wrong content hash
    const res = store.appendRecord(forged, { runId: RUN_ID, stateDir });
    assert.strictEqual(res.ok, false, 'a record cannot be stored under a forged transaction_id');
    assert.strictEqual(store.readById('f'.repeat(64), { runId: RUN_ID, stateDir }), null,
      'the forged id must not resolve to a stored record');
  } finally { cleanup(stateDir); }
});

// ── 4. _test_chain_marker rejected (the :213 branch, before integrity) ───────

test('4. appendRecord rejects a record carrying _test_chain_marker (validateTransactionRecord :213)', () => {
  const stateDir = tmpStateDir();
  try {
    const body = {
      prev_state_hash: 'b'.repeat(64),
      writer_persona_id: '04-architect.theo',
      writer_spawn_id: 'sp-2026-01-01T00:00:00.000Z-arch-0009',
      operation_class: 'CREATE',
      evidence_refs: ['USER_INTENT_AXIOM:' + 'c'.repeat(64)],
      intent_recorded_at: '2026-01-01T00:00:00.000Z',
      commit_outcome: 'COMMITTED',
      schema_version: 'v3',
      post_state_hash: 'a'.repeat(64),
      _test_chain_marker: true, // computed INTO the id so the integrity check would otherwise pass
    };
    const rec = { transaction_id: computeTransactionId(body), ...body };
    const res = store.appendRecord(rec, { runId: RUN_ID, stateDir });
    assert.strictEqual(res.ok, false, 'a _test_chain_marker record must be rejected by validation');
    assert.ok(/marker|admissible|test/i.test(res.reason || ''),
      `rejection reason should name the marker/validation failure, got ${res.reason}`);
    const dir = store.recordStoreDir({ runId: RUN_ID, stateDir });
    const present = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    assert.deepStrictEqual(present, [], 'no file may be written for a marker-bearing record');
  } finally { cleanup(stateDir); }
});

// ── 5. forward-compat: an unknown extra field is ACCEPTED (F4) ───────────────

test('5. appendRecord ACCEPTS a valid record carrying an extra unknown field (INV-K2-SchemaForwardCompat)', () => {
  const stateDir = tmpStateDir();
  try {
    // The unknown field must be hashed INTO the transaction_id (so the integrity
    // check passes) — otherwise this would test the integrity guard, not forward-compat.
    const body = {
      prev_state_hash: 'b'.repeat(64),
      writer_persona_id: '04-architect.theo',
      writer_spawn_id: 'sp-2026-01-01T00:00:00.000Z-arch-0005',
      operation_class: 'CREATE',
      evidence_refs: ['USER_INTENT_AXIOM:' + 'c'.repeat(64)],
      intent_recorded_at: '2026-01-01T00:00:00.000Z',
      commit_outcome: 'COMMITTED',
      schema_version: 'v3',
      post_state_hash: 'a'.repeat(64),
      future_field_v7: 'tolerated-by-lenient-runtime-validator', // unknown to the schema
    };
    const rec = { transaction_id: computeTransactionId(body), ...body };
    const res = store.appendRecord(rec, { runId: RUN_ID, stateDir });
    assert.strictEqual(res.ok, true,
      `the lenient runtime validator must ACCEPT an unknown field (NOT additionalProperties:false); got ${JSON.stringify(res)}`);
    const got = store.readById(rec.transaction_id, { runId: RUN_ID, stateDir });
    assert.ok(got && got.future_field_v7 === 'tolerated-by-lenient-runtime-validator',
      'the unknown field round-trips intact');
  } finally { cleanup(stateDir); }
});

// ── 6. readByPostStateHash returns the post_state_hash match; PENDING never ──

test('6. readByPostStateHash returns the post_state_hash match; a PENDING (null) record never matches', () => {
  const stateDir = tmpStateDir();
  try {
    const committed = buildRecord({ hashSeed: 'committed' });
    const pending = buildRecord({ hashSeed: 'pending', postStateHash: null }); // PENDING: no post_state_hash
    assert.ok(committed.post_state_hash, 'committed record must carry a post_state_hash');
    assert.strictEqual(pending.post_state_hash, undefined, 'PENDING record carries no post_state_hash');
    assert.strictEqual(store.appendRecord(committed, { runId: RUN_ID, stateDir }).ok, true);
    assert.strictEqual(store.appendRecord(pending, { runId: RUN_ID, stateDir }).ok, true);

    const hit = store.readByPostStateHash(committed.post_state_hash, { runId: RUN_ID, stateDir });
    assert.ok(hit, 'the committed record must resolve by its post_state_hash');
    assert.strictEqual(hit.transaction_id, committed.transaction_id);

    // A 64-hex key that no record's post_state_hash equals → null. The PENDING
    // record (no post_state_hash) is in the store but must never match any key.
    const miss = store.readByPostStateHash('e'.repeat(64), { runId: RUN_ID, stateDir });
    assert.strictEqual(miss, null, 'an unmatched hex key returns null; the PENDING record never matches');
  } finally { cleanup(stateDir); }
});

// ── 7. ANTI-FALLACY: post_state_hash is the chain key, NOT transaction_id ─────

test('7. ANTI-FALLACY: child.prev_state_hash resolves the parent by post_state_hash, and is NOT any stored transaction_id', () => {
  const stateDir = tmpStateDir();
  try {
    const { genesis, child } = buildChainOf2();
    assert.strictEqual(store.appendRecord(genesis, { runId: RUN_ID, stateDir }).ok, true);
    assert.strictEqual(store.appendRecord(child, { runId: RUN_ID, stateDir }).ok, true);

    // (a) the state-chain edge resolves the parent via post_state_hash.
    const parent = store.readByPostStateHash(child.prev_state_hash, { runId: RUN_ID, stateDir });
    assert.ok(parent, 'child.prev_state_hash must resolve the parent by post_state_hash');
    assert.strictEqual(parent.transaction_id, genesis.transaction_id, 'resolved parent is the genesis record');
    assert.strictEqual(child.prev_state_hash, genesis.post_state_hash,
      'the chain edge IS the parent post_state_hash (Probe #1 — the canonical state edge)');

    // (b) the load-bearing negative: NO stored record has transaction_id ===
    //     child.prev_state_hash, so readById on the chain key returns null. This
    //     locks the fallacy (transaction_id keying) as a CHECKED fact over the set.
    const all = store.listByRun({ runId: RUN_ID, stateDir });
    assert.ok(all.length >= 2, 'both records are in the run set');
    const anyIdEqualsChainKey = all.some((r) => r.transaction_id === child.prev_state_hash);
    assert.strictEqual(anyIdEqualsChainKey, false,
      'no record transaction_id equals child.prev_state_hash — transaction_id is NOT the chain key');
    assert.strictEqual(store.readById(child.prev_state_hash, { runId: RUN_ID, stateDir }), null,
      'readById(child.prev_state_hash) is null — confirms the chain key is post_state_hash, not transaction_id');
  } finally { cleanup(stateDir); }
});

// ── 8. K9 integration — the executable keying proof ──────────────────────────

test('8. K9 integration: resolveParent=readByPostStateHash PASSES (depthWalked>=1); resolveParent=readById FAILS chain-bottomed-out', () => {
  const stateDir = tmpStateDir();
  try {
    const { genesis, child } = buildChainOf2();
    assert.strictEqual(store.appendRecord(genesis, { runId: RUN_ID, stateDir }).ok, true);
    assert.strictEqual(store.appendRecord(child, { runId: RUN_ID, stateDir }).ok, true);

    // CORRECT keying: the non-genesis child walks via post_state_hash to the
    // genesis record (prev_state_hash:'GENESIS'), which K9's isGenesisPosition
    // recognizes → ACCEPT, with at least one walk step.
    const okRes = k9.checkEvidenceLinkPreCommit({
      record: child,
      isGenesisPosition: false,
      resolveParent: (h) => store.readByPostStateHash(h, { runId: RUN_ID, stateDir }),
    });
    assert.strictEqual(okRes.ok, true,
      `post_state_hash keying must reach genesis and PASS; got ${JSON.stringify(okRes)}`);
    assert.ok(okRes.depthWalked >= 1, `the walk must take >=1 step; got depthWalked=${okRes.depthWalked}`);

    // WRONG keying (the fallacy): keying the walk by transaction_id never resolves
    // child.prev_state_hash (no record's transaction_id equals it) → the walk
    // bottoms out off-genesis and the gate REJECTS for the intended reason.
    const badRes = k9.checkEvidenceLinkPreCommit({
      record: child,
      isGenesisPosition: false,
      resolveParent: (h) => store.readById(h, { runId: RUN_ID, stateDir }),
    });
    assert.strictEqual(badRes.ok, false, 'transaction_id keying must FAIL the real K9 gate');
    assert.strictEqual(badRes.reason, 'chain-bottomed-out-non-genesis',
      `the failure must be the bottomed-out-non-genesis reason; got ${badRes.reason}`);
  } finally { cleanup(stateDir); }
});

// ── 8b. OQ-2 (P3b): a PRODUCER-form genesis walk-terminates via the real store ──

test('8b. OQ-2 e2e: a real producer genesis (buildSpawnRecord, prev=computeGenesisHash) resolves via readByPostStateHash through real K9 — PASS depthWalked>=1', () => {
  const stateDir = tmpStateDir();
  try {
    // The REAL producer emits prev_state_hash = computeGenesisHash(schema,'per-project')
    // + a post_state_hash. Before P3a's OQ-2 fix, K9's isGenesisPosition did NOT
    // recognize that prev form, so this exact walk REJECTed chain-bottomed-out-non-genesis.
    const genesisPost = 'a'.repeat(64);
    const genesis = buildSpawnRecord({
      agentId: 'oq2-genesis', personaId: '04-architect.theo', schemaVersion: 'v3',
      postStateHash: genesisPost, headAnchor: null,
    });
    assert.strictEqual(genesis.prev_state_hash, computeGenesisHash('v3', 'per-project'),
      'the producer genesis prev IS computeGenesisHash (the OQ-2 form, not the literal GENESIS sentinel)');
    assert.strictEqual(genesis.post_state_hash, genesisPost, 'producer genesis carries the post_state_hash the child chains to');

    // A non-genesis child chaining via the canonical state edge (prev = parent post_state_hash).
    const child = buildRecord({ hashSeed: 'oq2-child', prevStateHash: genesisPost, seq: 1 });

    assert.strictEqual(store.appendRecord(genesis, { runId: RUN_ID, stateDir }).ok, true, 'producer genesis appends');
    assert.strictEqual(store.appendRecord(child, { runId: RUN_ID, stateDir }).ok, true, 'child appends');

    const res = k9.checkEvidenceLinkPreCommit({
      record: child,
      isGenesisPosition: false,
      resolveParent: (h) => store.readByPostStateHash(h, { runId: RUN_ID, stateDir }),
    });
    assert.strictEqual(res.ok, true, `the producer-genesis walk must PASS post-OQ-2-fix; got ${JSON.stringify(res)}`);
    assert.ok(res.depthWalked >= 1, `walk took >=1 step to the producer genesis; got ${res.depthWalked}`);
  } finally { cleanup(stateDir); }
});

// ── 8c. F-01 LEGACY/KEYLESS path: the walk tolerates a sibling DUPLICATE post_state_hash ──
//
// PR-4 REVISION (tolerate-on-read layering): dedup-on-append now keys on
// idempotency_key (timestamp-EXCLUDED), so a KEYED re-fire collapses BEFORE the 2nd
// write (tests 15-16). This 8c case is the KEYLESS/pre-PR-4 record path that
// tolerate-on-read still uniquely guards: two records sharing a post_state_hash but
// carrying NO idempotency_key BOTH store (no dedup), and the chain-walk tolerates the
// sibling. Built via the LOCAL keyless buildRecord helper (NOT buildSpawnRecord, which
// now emits a key — using it here would dedup, collapsing this legacy-path coverage).

test('8c. F-01 (keyless legacy path): two no-key records sharing a post_state_hash — BOTH stored, readByPostStateHash resolves, the walk still PASSES (tolerate-on-read)', () => {
  const stateDir = tmpStateDir();
  try {
    // A re-fired close mints a SECOND record: identical content + post_state_hash,
    // but a different intent_recorded_at -> a distinct transaction_id (the F-01
    // time-salt). NO idempotency_key on either (the keyless legacy shape), so both
    // append (one file per id); they SHARE the post_state_hash.
    const sharedPost = 'a'.repeat(64);
    const genesisA = buildRecord({ hashSeed: 'f01-A', isGenesis: true, postStateHash: sharedPost, intentRecordedAt: '2026-01-01T00:00:00.000Z' });
    const genesisB = buildRecord({ hashSeed: 'f01-A', isGenesis: true, postStateHash: sharedPost, intentRecordedAt: '2030-12-31T23:59:59.000Z' });
    assert.ok(!('idempotency_key' in genesisA), 'the legacy record carries NO idempotency_key (the keyless path)');
    assert.notStrictEqual(genesisB.transaction_id, genesisA.transaction_id, 'the re-fire mints a DISTINCT transaction_id');
    assert.strictEqual(genesisB.post_state_hash, genesisA.post_state_hash, 'but they SHARE the post_state_hash (F-01)');

    assert.strictEqual(store.appendRecord(genesisA, { runId: RUN_ID, stateDir }).ok, true);
    assert.strictEqual(store.appendRecord(genesisB, { runId: RUN_ID, stateDir }).ok, true);
    assert.strictEqual(store.listByRun({ runId: RUN_ID, stateDir }).length, 2,
      'both KEYLESS dup records are stored (one file per id, no clobber) — dedup only fires on idempotency_key');

    // readByPostStateHash resolves to ONE of them (arbitrary; both are valid genesis).
    const hit = store.readByPostStateHash(sharedPost, { runId: RUN_ID, stateDir });
    assert.ok(hit && hit.post_state_hash === sharedPost, 'a duplicated post_state_hash still resolves');

    // The walk tolerates the sibling dup: a child chaining to the shared post_state_hash
    // terminates at whichever genesis is returned (both are genesis -> equivalent resolution).
    const child = buildRecord({ hashSeed: 'f01-child', prevStateHash: sharedPost, seq: 9 });
    const res = k9.checkEvidenceLinkPreCommit({
      record: child,
      isGenesisPosition: false,
      resolveParent: (h) => store.readByPostStateHash(h, { runId: RUN_ID, stateDir }),
    });
    assert.strictEqual(res.ok, true, 'the walk tolerates a sibling dup post_state_hash — the keyless legacy path');
  } finally { cleanup(stateDir); }
});

// ── 9. CWE-22: a non-hex key returns null and NEVER reads the filesystem ──────

test('9. CWE-22: a non-hex key (../../etc/passwd) returns null; fs.readFileSync is NEVER called', () => {
  const stateDir = tmpStateDir();
  try {
    // Seed a real record so the store dir exists (the gate must reject BEFORE any
    // readdir/readFile, not merely because the dir is empty).
    assert.strictEqual(store.appendRecord(buildRecord({ hashSeed: 'seed' }), { runId: RUN_ID, stateDir }).ok, true);

    const realReadFileSync = fs.readFileSync;
    const realReaddirSync = fs.readdirSync;
    let readCalls = 0;
    let readdirCalls = 0;
    fs.readFileSync = function spy(...args) { readCalls++; return realReadFileSync.apply(this, args); };
    fs.readdirSync = function spy(...args) { readdirCalls++; return realReaddirSync.apply(this, args); };
    try {
      const traversal = store.readById('../../etc/passwd', { runId: RUN_ID, stateDir });
      assert.strictEqual(traversal, null, 'a path-traversal key must return null at the hex-gate');
      const notHex = store.readById('NOT_A_HEX_KEY', { runId: RUN_ID, stateDir });
      assert.strictEqual(notHex, null, 'a non-hex key must return null');
      const shortHex = store.readById('abc123', { runId: RUN_ID, stateDir });
      assert.strictEqual(shortHex, null, 'a too-short hex key must return null');
      assert.strictEqual(readCalls, 0,
        'fs.readFileSync must NEVER run for a non-hex readById key (the hex-gate returns before path.join)');

      // code-reviewer FLAG: readByPostStateHash ALSO hex-gates before readdirSync.
      // Assert the SAME CWE-22 guarantee for the K9-seam reader, not just readById.
      const seamTraversal = store.readByPostStateHash('../../etc/passwd', { runId: RUN_ID, stateDir });
      assert.strictEqual(seamTraversal, null, 'a path-traversal key must return null at the readByPostStateHash hex-gate');
      const seamNotHex = store.readByPostStateHash('NOT_A_HEX_KEY', { runId: RUN_ID, stateDir });
      assert.strictEqual(seamNotHex, null, 'a non-hex readByPostStateHash key must return null');
      assert.strictEqual(readdirCalls, 0,
        'fs.readdirSync must NEVER run for a non-hex readByPostStateHash key (the hex-gate returns before readdir)');
      assert.strictEqual(readCalls, 0,
        'fs.readFileSync must NEVER run across either reader for a non-hex key');
    } finally {
      fs.readFileSync = realReadFileSync;
      fs.readdirSync = realReaddirSync;
    }
  } finally { cleanup(stateDir); }
});

// ── 10. fail-soft / TOCTOU on an absent run dir ──────────────────────────────

test('10. fail-soft: readers on a truly-absent run dir return null/[] (no existsSync pre-check, ENOENT wrapped)', () => {
  const stateDir = tmpStateDir();
  try {
    const ABSENT = 'run-never-appended';
    // No append for this run — the records dir does not exist.
    assert.strictEqual(store.readById('a'.repeat(64), { runId: ABSENT, stateDir }), null,
      'readById on an absent run dir is null, not a throw');
    assert.strictEqual(store.readByPostStateHash('a'.repeat(64), { runId: ABSENT, stateDir }), null,
      'readByPostStateHash on an absent run dir is null, not a throw');
    assert.deepStrictEqual(store.listByRun({ runId: ABSENT, stateDir }), [],
      'listByRun on an absent run dir is [], not a throw');
  } finally { cleanup(stateDir); }
});

// ── 11. listByRun skips an invalid/corrupt record-*.json ─────────────────────

test('11. listByRun returns the sibling set and SKIPS an invalid/corrupt record-*.json', () => {
  const stateDir = tmpStateDir();
  try {
    const a = buildRecord({ hashSeed: 'a' });
    const b = buildRecord({ hashSeed: 'b' });
    assert.strictEqual(store.appendRecord(a, { runId: RUN_ID, stateDir }).ok, true);
    assert.strictEqual(store.appendRecord(b, { runId: RUN_ID, stateDir }).ok, true);

    const dir = store.recordStoreDir({ runId: RUN_ID, stateDir });
    // (i) garbage JSON in a record-*.json name → must be skipped (parse-error).
    fs.writeFileSync(path.join(dir, 'record-' + 'd'.repeat(64) + '.json'), '{ this is not json ');
    // (ii) valid JSON but an INVALID record (missing required) → must be skipped.
    fs.writeFileSync(path.join(dir, 'record-' + 'e'.repeat(64) + '.json'), JSON.stringify({ not: 'a record' }));

    const all = store.listByRun({ runId: RUN_ID, stateDir });
    const ids = all.map((r) => r.transaction_id).sort();
    assert.deepStrictEqual(ids, [a.transaction_id, b.transaction_id].sort(),
      'only the two valid records are returned; corrupt + invalid files are skipped');
  } finally { cleanup(stateDir); }
});

// ── 12. concurrency: two appends in one run leave both files present ─────────

test('12. concurrency: two appendRecord calls for distinct records in one run → both files present (no clobber)', () => {
  const stateDir = tmpStateDir();
  try {
    const a = buildRecord({ hashSeed: 'conc-a', seq: 1 });
    const b = buildRecord({ hashSeed: 'conc-b', seq: 2 });
    assert.notStrictEqual(a.transaction_id, b.transaction_id, 'the two records are distinct');
    assert.strictEqual(store.appendRecord(a, { runId: RUN_ID, stateDir }).ok, true);
    assert.strictEqual(store.appendRecord(b, { runId: RUN_ID, stateDir }).ok, true);

    const dir = store.recordStoreDir({ runId: RUN_ID, stateDir });
    const files = fs.readdirSync(dir).filter((n) => /^record-[a-f0-9]{64}\.json$/.test(n));
    assert.strictEqual(files.length, 2, `both one-file-per-record writes must be present; found ${files.length}`);
    assert.ok(store.readById(a.transaction_id, { runId: RUN_ID, stateDir }), 'record a is readable');
    assert.ok(store.readById(b.transaction_id, { runId: RUN_ID, stateDir }), 'record b is readable');
  } finally { cleanup(stateDir); }
});

// ── 13. CWE-22: a traversing runId is rejected on every path (no escape) ──────
//
// code-reviewer MEDIUM (confirmed empirically): recordStoreDir interpolates runId
// into the on-disk path, so a runId like '../../<dir>' would relocate the store
// OUTSIDE stateDir while the per-record checkWithinRoot(file, derivedDir) still
// passes. isSafeRunId must reject it on append AND every reader, BEFORE any fs reach.

test('13. CWE-22: a traversing runId is rejected on every path; no file escapes stateDir', () => {
  const stateDir = tmpStateDir();
  // A sibling temp dir the traversal would target; assert nothing lands in it.
  const escapeTarget = tmpStateDir('record-store-escape');
  try {
    const rec = buildRecord({ hashSeed: 'traverse' });
    const evilRunId = '../' + path.basename(escapeTarget); // resolves to a sibling of stateDir

    // (a) appendRecord refuses the traversing runId with the precise reason; nothing written.
    const res = store.appendRecord(rec, { runId: evilRunId, stateDir });
    assert.strictEqual(res.ok, false, 'appendRecord must reject a traversing runId');
    assert.strictEqual(res.reason, 'invalid-run-id', `reason must be invalid-run-id; got ${res.reason}`);
    const escaped = path.join(escapeTarget, 'records');
    assert.strictEqual(fs.existsSync(escaped), false,
      'no records/ dir may be created outside stateDir via a traversing runId');

    // (b) every reader returns the empty/null result for a traversing runId (no fs reach).
    assert.strictEqual(store.readById(rec.transaction_id, { runId: evilRunId, stateDir }), null,
      'readById on a traversing runId is null');
    assert.strictEqual(store.readByPostStateHash(rec.post_state_hash, { runId: evilRunId, stateDir }), null,
      'readByPostStateHash on a traversing runId is null');
    assert.deepStrictEqual(store.listByRun({ runId: evilRunId, stateDir }), [],
      'listByRun on a traversing runId is []');

    // (c) a runId with an embedded path separator is likewise rejected.
    assert.strictEqual(store.appendRecord(rec, { runId: 'a/b', stateDir }).ok, false,
      'a runId containing a path separator must be rejected');
    assert.strictEqual(store.appendRecord(rec, { runId: '..', stateDir }).reason, 'invalid-run-id',
      'a bare ".." runId must be rejected with invalid-run-id');
  } finally { cleanup(stateDir); cleanup(escapeTarget); }
});

// ── 14. recordStoreDir contract (honesty NIT: a dedicated assertion) ─────────

test('14. recordStoreDir returns <stateDir>/<runId>/records', () => {
  const stateDir = tmpStateDir();
  try {
    const dir = store.recordStoreDir({ runId: RUN_ID, stateDir });
    assert.strictEqual(dir, path.join(stateDir, RUN_ID, 'records'),
      'recordStoreDir composes <stateDir>/<runId>/records');
    assert.ok(dir.endsWith(path.join(RUN_ID, 'records')), 'dir ends with <runId>/records');
  } finally { cleanup(stateDir); }
});

// ════════════════════ PR-4 — INV-22 in-substrate idempotency-key enforcement ════════════════════
//
// computeIdempotencyKey existed (transaction-record.js) but was UNENFORCED — no
// producer set idempotency_key + appendRecord did not dedup on it. PR-4 wires the key
// into the producers (buildSpawnRecord here) + dedups on append. These tests are the
// behavioral contract: a keyed re-fire (same persona/spawn/tree, different timestamp)
// collapses to ONE record at the WRITE step (superseding P3's tolerate-on-read);
// two DISTINCT spawns on an identical tree do NOT (the CRITICAL-1 false-merge guard);
// a dirty-null spawn still gets a key + writes; a keyless record keeps current behavior.

// A keyed genesis record via the REAL producer (buildSpawnRecord now emits idempotency_key).
function keyedSpawn(opts = {}) {
  const { agentId = 'pr4-agent', postStateHash = 'a'.repeat(64), schemaVersion = 'v3' } = opts;
  return buildSpawnRecord({ agentId, personaId: '13-node-backend.tester', schemaVersion, postStateHash, headAnchor: null });
}

// Re-mint the SAME record body with a different intent_recorded_at (the F-01 time-salt):
// a DISTINCT transaction_id but — since idempotency_key excludes the timestamp — the
// SAME idempotency_key. Mirrors a re-fired close.
function refire(record, isoTs) {
  const body = { ...record, intent_recorded_at: isoTs };
  delete body.transaction_id;
  return { transaction_id: computeTransactionId(body), ...body };
}

// ── 15. INV-22: a keyed replay (re-fire) dedups -> the FIRST stored id, count unchanged ──

test('15. INV-22: a keyed re-fire (same key, different timestamp) dedups -> deduped:true + the FIRST transaction_id + count UNCHANGED + readById(first) resolves', () => {
  const stateDir = tmpStateDir();
  try {
    const first = keyedSpawn({ agentId: 'inv22', postStateHash: 'a'.repeat(64) });
    assert.match(first.idempotency_key, /^[a-f0-9]{64}$/, 'the producer sets a 64-hex idempotency_key');
    const r1 = store.appendRecord(first, { runId: RUN_ID, stateDir });
    assert.strictEqual(r1.ok, true, `the first append must succeed; got ${JSON.stringify(r1)}`);
    assert.ok(!r1.deduped, 'the first append is not a dedup');

    const second = refire(first, '2031-01-01T00:00:00.000Z');
    assert.strictEqual(second.idempotency_key, first.idempotency_key, 'the re-fire carries the SAME idempotency_key (timestamp excluded)');
    assert.notStrictEqual(second.transaction_id, first.transaction_id, 'but a DISTINCT transaction_id (timestamp salts the id)');

    const r2 = store.appendRecord(second, { runId: RUN_ID, stateDir });
    assert.strictEqual(r2.ok, true, 'the replay returns ok:true (a no-op, not an error)');
    assert.strictEqual(r2.deduped, true, 'the replay is flagged deduped:true');
    assert.strictEqual(r2.transaction_id, first.transaction_id,
      'the replay returns the FIRST/stored transaction_id, NOT the second record fresh id (caller-honesty contract)');

    assert.strictEqual(store.listByRun({ runId: RUN_ID, stateDir }).length, 1, 'the run record-count is UNCHANGED (one record for the transaction)');
    assert.ok(store.readById(first.transaction_id, { runId: RUN_ID, stateDir }), 'readById(first id) resolves the stored record');
    assert.strictEqual(store.readById(second.transaction_id, { runId: RUN_ID, stateDir }), null, 'the second (deduped) id was never stored');
  } finally { cleanup(stateDir); }
});

// ── 16. dedup short-circuits BEFORE any fs mutation (no records dir for a pure replay-miss-dir) ──

test('16. dedup short-circuits BEFORE mkdirSync: a replay creates NO new file (one file total) and writes nothing on the 2nd call', () => {
  const stateDir = tmpStateDir();
  try {
    const first = keyedSpawn({ agentId: 'dedup-sc', postStateHash: 'b'.repeat(64) });
    store.appendRecord(first, { runId: RUN_ID, stateDir });
    const dir = store.recordStoreDir({ runId: RUN_ID, stateDir });
    const before = fs.readdirSync(dir).filter((n) => /^record-[a-f0-9]{64}\.json$/.test(n));
    assert.strictEqual(before.length, 1, 'exactly one record after the first append');

    const r2 = store.appendRecord(refire(first, '2032-02-02T00:00:00.000Z'), { runId: RUN_ID, stateDir });
    assert.strictEqual(r2.deduped, true, 'the replay deduped');
    const after = fs.readdirSync(dir).filter((n) => /^record-[a-f0-9]{64}\.json$/.test(n));
    assert.deepStrictEqual(after, before, 'no new file is written for a pure replay (short-circuit before mkdirSync/write)');
  } finally { cleanup(stateDir); }
});

// ── 17. false-merge prevention (CRITICAL-1 guard): same tree, DISTINCT spawn -> BOTH written ──

test('17. false-merge prevention: two records with DISTINCT writer_spawn_id but an IDENTICAL tree -> DIFFERENT content_hash -> DIFFERENT key -> BOTH written (no false-merge)', () => {
  const stateDir = tmpStateDir();
  try {
    // The SAME post_state_hash (identical tree) but two distinct spawns. content_hash
    // binds writer_spawn_id, so the keys differ and BOTH records must persist — the
    // dedup must NOT collapse two genuinely-distinct transactions.
    const sharedPost = 'c'.repeat(64);
    const spawnA = keyedSpawn({ agentId: 'agent-A', postStateHash: sharedPost });
    const spawnB = keyedSpawn({ agentId: 'agent-B', postStateHash: sharedPost });
    assert.strictEqual(spawnA.post_state_hash, spawnB.post_state_hash, 'both spawns landed on the IDENTICAL tree');
    assert.notStrictEqual(spawnA.idempotency_key, spawnB.idempotency_key,
      'distinct writer_spawn_id -> distinct content_hash -> distinct idempotency_key (the CRITICAL-1 fix)');

    assert.strictEqual(store.appendRecord(spawnA, { runId: RUN_ID, stateDir }).ok, true);
    const rB = store.appendRecord(spawnB, { runId: RUN_ID, stateDir });
    assert.strictEqual(rB.ok, true, 'the second distinct spawn appends');
    assert.ok(!rB.deduped, 'the second distinct spawn is NOT deduped (it is a different transaction)');
    assert.strictEqual(store.listByRun({ runId: RUN_ID, stateDir }).length, 2,
      'BOTH distinct-spawn records persist — same tree must not false-merge');
  } finally { cleanup(stateDir); }
});

// ── 18. dirty-null-post (CR CRITICAL-1 guard): postStateHash=null -> keyed + written; re-fire dedups ──

test('18. dirty-null-post: a buildSpawnRecord with postStateHash=null gets a VALID idempotency_key + writes (no throw); a re-fire dedups', () => {
  const stateDir = tmpStateDir();
  try {
    // The dirty-worktree shape: the live producer passes postStateHash=null. The record
    // must still get a key (computeContentHash is null-safe) and store; the re-fire dedups.
    let dirty;
    assert.doesNotThrow(() => {
      dirty = buildSpawnRecord({ agentId: 'dirty-spawn', personaId: '13-node-backend.tester', schemaVersion: 'v3', postStateHash: null, headAnchor: null });
    }, 'a null postStateHash must NOT throw in the producer (the provenance-blackout regression guard)');
    assert.match(dirty.idempotency_key, /^[a-f0-9]{64}$/, 'a dirty-null spawn still carries a valid 64-hex idempotency_key');
    assert.strictEqual(dirty.post_state_hash, null, 'a dirty spawn records post_state_hash:null (schema null-tolerant); the dedup axis is the key, not the post');

    assert.strictEqual(store.appendRecord(dirty, { runId: RUN_ID, stateDir }).ok, true, 'the dirty-null record writes');
    const r2 = store.appendRecord(refire(dirty, '2033-03-03T00:00:00.000Z'), { runId: RUN_ID, stateDir });
    assert.strictEqual(r2.deduped, true, 'a dirty-null re-fire dedups on the key (post_state_hash is not the dedup axis)');
    assert.strictEqual(store.listByRun({ runId: RUN_ID, stateDir }).length, 1, 'one record for the dirty transaction');
  } finally { cleanup(stateDir); }
});

// ── 19. no-key forward-compat: a record WITHOUT idempotency_key still writes (no dedup) ──

test('19. forward-compat: a record carrying NO idempotency_key still writes; a second no-key record (different id) also writes — dedup only fires on the key', () => {
  const stateDir = tmpStateDir();
  try {
    const a = buildRecord({ hashSeed: 'nokey-a', postStateHash: 'a'.repeat(64), seq: 1 });
    const b = buildRecord({ hashSeed: 'nokey-b', postStateHash: 'a'.repeat(64), seq: 2 }); // same tree, distinct id, no key
    assert.ok(!('idempotency_key' in a) && !('idempotency_key' in b), 'neither record carries an idempotency_key');
    assert.notStrictEqual(a.transaction_id, b.transaction_id, 'the two keyless records are genuinely distinct (different writer_spawn_id)');
    assert.strictEqual(store.appendRecord(a, { runId: RUN_ID, stateDir }).ok, true);
    const rb = store.appendRecord(b, { runId: RUN_ID, stateDir });
    assert.strictEqual(rb.ok, true, 'a keyless record always writes (Open/Closed — current behavior preserved)');
    assert.ok(!rb.deduped, 'a keyless append is never flagged deduped');
    assert.strictEqual(store.listByRun({ runId: RUN_ID, stateDir }).length, 2, 'both keyless records persist (no dedup without a key)');
  } finally { cleanup(stateDir); }
});

// ── 20. readByIdempotencyKey unit (mirrors readByPostStateHash: hex-gate / hostile runId / miss / hit) ──

test('20. readByIdempotencyKey: non-hex -> null (no fs); hostile runId -> null; miss -> null; hit -> the record', () => {
  const stateDir = tmpStateDir();
  try {
    const rec = keyedSpawn({ agentId: 'rbik', postStateHash: 'd'.repeat(64) });
    store.appendRecord(rec, { runId: RUN_ID, stateDir });

    // hex-gate: a non-hex key returns null BEFORE any readdir (mirror test 9's spy approach).
    const realReaddirSync = fs.readdirSync;
    let readdirCalls = 0;
    fs.readdirSync = function spy(...args) { readdirCalls++; return realReaddirSync.apply(this, args); };
    try {
      assert.strictEqual(store.readByIdempotencyKey('../../etc/passwd', { runId: RUN_ID, stateDir }), null, 'a path-traversal key returns null at the hex-gate');
      assert.strictEqual(store.readByIdempotencyKey('NOT_A_HEX', { runId: RUN_ID, stateDir }), null, 'a non-hex key returns null');
      assert.strictEqual(readdirCalls, 0, 'fs.readdirSync NEVER runs for a non-hex key (hex-gate before readdir)');
    } finally { fs.readdirSync = realReaddirSync; }

    // hostile runId -> null (S1b), before any fs reach.
    assert.strictEqual(store.readByIdempotencyKey(rec.idempotency_key, { runId: '../escape', stateDir }), null, 'a traversing runId returns null');
    // miss: a valid 64-hex key no record carries -> null.
    assert.strictEqual(store.readByIdempotencyKey('e'.repeat(64), { runId: RUN_ID, stateDir }), null, 'an unmatched 64-hex key returns null');
    // hit: the stored record resolves by its idempotency_key.
    const hit = store.readByIdempotencyKey(rec.idempotency_key, { runId: RUN_ID, stateDir });
    assert.ok(hit, 'the stored record resolves by its idempotency_key');
    assert.strictEqual(hit.transaction_id, rec.transaction_id, 'the resolved record is the one stored');
  } finally { cleanup(stateDir); }
});

// ════════ PR-4 HARDENING — content-address verification (3-lens hacker HIGH) ════════
//
// The dedup must NOT trust a self-asserted idempotency_key. A record's key is re-derived
// from its body (deriveIdempotencyKey); a forged/inconsistent key is REJECTED on append
// (incoming) and SKIPPED as a dedup target on read (stored-side). Closes the record-
// SUPPRESSION vector: a poison record pre-seeding a victim's key (but with attacker content)
// must NOT suppress the victim's legitimate provenance write. The store dir is NOT a sandbox
// (p-writescope), so a poison record can land directly on disk — the read-side check defends.

// Craft a poison record on disk: it carries `forgedKey` in idempotency_key but its BODY
// (attacker content) derives to a DIFFERENT key. transaction_id is computed over the body so
// it passes the S5 integrity gate + loads. Written DIRECTLY to the records dir (bypassing
// appendRecord, which would reject it) — simulating the non-sandbox direct-disk write.
function writePoisonOnDisk(forgedKey, stateDir) {
  const body = {
    prev_state_hash: 'GENESIS',
    writer_persona_id: 'ATTACKER',
    writer_spawn_id: 'attacker-spawn',
    operation_class: 'CREATE',
    evidence_refs: ['ROOT_TASK_RECORD:attacker'],
    intent_recorded_at: '2026-01-01T00:00:00.000Z',
    commit_outcome: 'COMMITTED',
    schema_version: 'v3',
    post_state_hash: 'f'.repeat(64),
    idempotency_key: forgedKey, // FORGED: does not match this body's own derivation
  };
  const transaction_id = computeTransactionId(body);
  const poison = { transaction_id, ...body };
  const dir = path.join(stateDir, RUN_ID, 'records');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `record-${transaction_id}.json`), JSON.stringify(poison, null, 2));
  return poison;
}

test('21. record-suppression guard (stored-side): a poison record forging a victim key does NOT suppress the victim\'s legitimate append', () => {
  const stateDir = tmpStateDir();
  try {
    const victim = keyedSpawn({ agentId: 'victim', postStateHash: 'a'.repeat(64) });
    const K = victim.idempotency_key; // the victim's REAL (self-consistent) key
    const poison = writePoisonOnDisk(K, stateDir); // attacker pre-seeds K with attacker content
    assert.notStrictEqual(deriveIdempotencyKey(poison), K, 'the poison key is forged (its body derives to a DIFFERENT key)');

    const r = store.appendRecord(victim, { runId: RUN_ID, stateDir });
    assert.strictEqual(r.ok, true, 'the victim append succeeds');
    assert.ok(!r.deduped, 'the victim is NOT suppressed by the poison (no false dedup against a forged-key record)');
    assert.ok(store.readById(victim.transaction_id, { runId: RUN_ID, stateDir }), 'the victim\'s real record IS stored on disk');
  } finally { cleanup(stateDir); }
});

test('22. incoming forged-key guard: appendRecord rejects a record whose idempotency_key != its own content-derivation', () => {
  const stateDir = tmpStateDir();
  try {
    const legit = keyedSpawn({ agentId: 'tamper', postStateHash: 'a'.repeat(64) });
    // Tamper the key to a different valid 64-hex, then recompute transaction_id so the S5
    // integrity gate still passes — only the content-address (key-vs-body) check catches it.
    const body = { ...legit, idempotency_key: 'd'.repeat(64) };
    delete body.transaction_id;
    const forged = { transaction_id: computeTransactionId(body), ...body };
    const r = store.appendRecord(forged, { runId: RUN_ID, stateDir });
    assert.strictEqual(r.ok, false, 'a self-inconsistent idempotency_key is rejected (not stored)');
    assert.match(r.reason, /idempotency-key-mismatch/, 'the reason names the content-address mismatch');
    assert.strictEqual(store.listByRun({ runId: RUN_ID, stateDir }).length, 0, 'nothing written');
  } finally { cleanup(stateDir); }
});

test('23. validator shape-check: a non-hex idempotency_key is rejected by validateTransactionRecord', () => {
  const bad = { ...keyedSpawn({ agentId: 'shape' }), idempotency_key: 'NOT-HEX' };
  const v = validateTransactionRecord(bad, { isGenesisPosition: true });
  assert.strictEqual(v.valid, false, 'a non-hex idempotency_key fails validation');
  assert.ok((v.errors || []).some((e) => /idempotency_key/.test(e)), 'the error names idempotency_key');
});

test('24. deriveIdempotencyKey: a legit producer record is self-consistent (key == its own derivation); a record missing inputs -> null', () => {
  const legit = keyedSpawn({ agentId: 'derive', postStateHash: 'a'.repeat(64) });
  assert.strictEqual(deriveIdempotencyKey(legit), legit.idempotency_key, 'a legit record\'s key IS a content-address of its body');
  assert.strictEqual(deriveIdempotencyKey({ idempotency_key: 'a'.repeat(64) }), null, 'a record missing the 4 key inputs -> null (a verification failure)');
});

// ── 25-26. crash-suppression guard (3-lens hacker re-verify, NEW HIGH): a poison/record
// with a pathologically DEEP hashed field must NOT crash an append via unbounded recursion
// in canonicalJsonSerialize. The deep value is carried in writer_spawn_id — a field the
// lenient validator does NOT type-check but computeContentHash DOES hash — so the test
// genuinely exercises the depth bound + the fail-closed catches (head_anchor/post_state_hash
// are separately rejected on TYPE by the validator; see transaction-record.test.js).
// Depth 200 is comfortably OVER MAX_CANONICAL_DEPTH=100 (so the bound fires) yet far UNDER
// the native JSON.stringify/parse stack limit (so the test fixture itself is portable — a
// 5000-deep fixture overflowed native JSON.stringify on the CI runner; the CODE was fine). ──

const OVER_BOUND_DEPTH = 200; // > MAX_CANONICAL_DEPTH (100); << native JSON stack limit

function deeplyNested(depth) {
  let v = 'x';
  for (let i = 0; i < depth; i++) v = { n: v };
  return v;
}

test('25. crash-suppression guard (stored-side): a poison with a DEEP writer_spawn_id + a victim key does NOT crash the victim\'s append; the victim is stored', () => {
  const stateDir = tmpStateDir();
  try {
    const victim = keyedSpawn({ agentId: 'crashvictim', postStateHash: 'a'.repeat(64) });
    const K = victim.idempotency_key;
    const dir = path.join(stateDir, RUN_ID, 'records');
    fs.mkdirSync(dir, { recursive: true });
    // The poison carries K but a deeply-nested writer_spawn_id (passes the lenient validator,
    // which does not type-check writer_spawn_id). Hand-written to disk (a direct non-sandbox
    // drop). On the victim's append, readByIdempotencyKey re-derives the poison's key via
    // computeContentHash(writer_spawn_id) → the depth bound throws → deriveIdempotencyKey
    // fail-closes to null → the poison is SKIPPED as a dedup target, no RangeError escapes.
    const poison = {
      transaction_id: 'e'.repeat(64), prev_state_hash: 'GENESIS', writer_persona_id: 'ATTACKER',
      writer_spawn_id: deeplyNested(OVER_BOUND_DEPTH), operation_class: 'CREATE', evidence_refs: ['ROOT_TASK_RECORD:atk'],
      intent_recorded_at: '2026-01-01T00:00:00.000Z', commit_outcome: 'COMMITTED', schema_version: 'v3',
      post_state_hash: 'f'.repeat(64), head_anchor: null, idempotency_key: K,
    };
    fs.writeFileSync(path.join(dir, `record-${'e'.repeat(64)}.json`), JSON.stringify(poison));

    const r = store.appendRecord(victim, { runId: RUN_ID, stateDir });
    assert.strictEqual(r.ok, true, 'the victim append succeeds — no RangeError escapes the dedup scan');
    assert.ok(!r.deduped, 'the deep-field poison is NOT honored as a dedup target');
    assert.ok(store.readById(victim.transaction_id, { runId: RUN_ID, stateDir }), 'the victim\'s record IS stored');
  } finally { cleanup(stateDir); }
});

test('26. crash guard (incoming): appendRecord REJECTS a record with a pathologically deep writer_spawn_id (no RangeError; record-uncomputable); nothing written', () => {
  const stateDir = tmpStateDir();
  try {
    // writer_spawn_id is hashed by the S5 computeTransactionId but not type-checked by the
    // validator, so it reaches canonicalJsonSerialize → the depth bound throws → appendRecord's
    // S5 try/catch rejects (record-uncomputable) rather than letting the RangeError escape.
    const bad = {
      transaction_id: 'e'.repeat(64), prev_state_hash: 'GENESIS', writer_persona_id: 'p',
      writer_spawn_id: deeplyNested(OVER_BOUND_DEPTH), operation_class: 'CREATE', evidence_refs: ['ROOT_TASK_RECORD:x'],
      intent_recorded_at: '2026-01-01T00:00:00.000Z', commit_outcome: 'COMMITTED', schema_version: 'v3',
      post_state_hash: 'f'.repeat(64), head_anchor: null,
    };
    const r = store.appendRecord(bad, { runId: RUN_ID, stateDir });
    assert.strictEqual(r.ok, false, 'a pathologically deep hashed field is rejected, not crashed');
    assert.match(r.reason, /uncomputable|invalid-record/, 'the reason names the rejection');
    assert.strictEqual(store.listByRun({ runId: RUN_ID, stateDir }).length, 0, 'nothing written');
  } finally { cleanup(stateDir); }
});

// ── 27. WIDTH guard (hardening L1): a record with a huge (valid-shape) evidence_refs is
// rejected at the S5 hash via the canonicalJsonSerialize node budget — record-uncomputable,
// NOT a slow multi-hundred-ms clean hash. The depth bound does not catch a WIDE structure;
// the total-node budget does. 20000 entries comfortably exceeds MAX_CANONICAL_NODES (10000). ──

test('27. width guard: a record with a huge evidence_refs is rejected at the hash (record-uncomputable via the node budget); nothing written', () => {
  const stateDir = tmpStateDir();
  try {
    const wide = new Array(20000).fill('USER_INTENT_AXIOM:' + 'c'.repeat(64)); // valid-shape (array of strings), but huge
    const bad = {
      transaction_id: 'e'.repeat(64), prev_state_hash: 'GENESIS', writer_persona_id: 'p',
      writer_spawn_id: 's', operation_class: 'CREATE', evidence_refs: wide,
      intent_recorded_at: '2026-01-01T00:00:00.000Z', commit_outcome: 'COMMITTED', schema_version: 'v3',
      post_state_hash: 'f'.repeat(64), head_anchor: null,
    };
    const r = store.appendRecord(bad, { runId: RUN_ID, stateDir });
    assert.strictEqual(r.ok, false, 'a huge record is rejected, not hashed slowly to completion');
    assert.match(r.reason, /uncomputable/, 'the node budget fires at the S5 hash -> record-uncomputable');
    assert.strictEqual(store.listByRun({ runId: RUN_ID, stateDir }).length, 0, 'nothing written');
  } finally { cleanup(stateDir); }
});

// ── 28. filename/body integrity (W2b.1 VALIDATE hacker MEDIUM, parser-differential / filename-confusion):
// the store keys a record by its FILENAME (record-<txid>.json), but the body carries its OWN transaction_id.
// A tampered / hand-planted file whose basename txid != body txid must NOT be returned under the filename's
// key — else a content-addressed consumer (e.g. the lab manage-promote eligibility gate) is fooled into
// acting on the WRONG record. loadRecordFile rejects the mismatch (fail-soft null). On every legit write the
// filename IS record-<body.txid>.json (recordFilePath(id) where id is the S5-verified body txid), so no legit
// flow is affected. ──
test('28. filename/body integrity: a record-<A>.json whose body.transaction_id is B(!=A) is not returned under key A; the legit record-<B>.json is unaffected', () => {
  const stateDir = tmpStateDir();
  try {
    // A legit record B written the normal way (filename === body txid via appendRecord).
    const recB = keyedSpawn({ agentId: 'legitB', postStateHash: 'b'.repeat(64) });
    assert.strictEqual(store.appendRecord(recB, { runId: RUN_ID, stateDir }).ok, true);
    const B = recB.transaction_id;
    // A TAMPERED file: named record-<A>.json but its body is recB (transaction_id === B != A).
    const A = 'a'.repeat(64);
    assert.notStrictEqual(A, B, 'A and B are distinct keys');
    const dir = path.join(stateDir, RUN_ID, 'records');
    fs.writeFileSync(path.join(dir, `record-${A}.json`), JSON.stringify(recB, null, 2));
    // readById(A) keys by the filename A, but the body says B -> filename/body mismatch -> null.
    assert.strictEqual(store.readById(A, { runId: RUN_ID, stateDir }), null, 'a filename/body-txid mismatch is not returned under the wrong key');
    // readById(B) via its OWN correct file is unaffected.
    const got = store.readById(B, { runId: RUN_ID, stateDir });
    assert.ok(got && got.transaction_id === B, 'the legit record-<B>.json still loads under its own key');
    // listByRun skips the mismatched file, keeps the legit one (exactly 1).
    const all = store.listByRun({ runId: RUN_ID, stateDir });
    assert.strictEqual(all.length, 1, 'listByRun skips the filename/body-mismatch file');
    assert.strictEqual(all[0].transaction_id, B, 'the surviving record is the legit B');
  } finally { cleanup(stateDir); }
});

// ── 29. content-address integrity, part (a) — TYPE-COERCION (VALIDATE hacker CRITICAL-1): the lenient
// validator only hex-checks transaction_id WHEN it is a string, so a non-string field (the array [A]) passes
// validation and string-COERCES past a bare basename compare ('record-'+[A]+'.json' === 'record-A.json'). The
// typeof-string gate must reject it BEFORE the compare. ──
test('29. content-address integrity (type-coercion): a body transaction_id of the ARRAY [A] does not load under key A', () => {
  const stateDir = tmpStateDir();
  try {
    const A = 'a'.repeat(64);
    const base = keyedSpawn({ agentId: 'arr', postStateHash: 'b'.repeat(64) });
    const decoy = { ...base, transaction_id: [A], writer_persona_id: '07-attacker' }; // array coerces to "A"
    const dir = path.join(stateDir, RUN_ID, 'records');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `record-${A}.json`), JSON.stringify(decoy, null, 2));
    assert.strictEqual(store.readById(A, { runId: RUN_ID, stateDir }), null, 'a non-string txid cannot coerce past the filename check');
    assert.strictEqual(store.listByRun({ runId: RUN_ID, stateDir }).length, 0, 'listByRun skips the coercion decoy');
  } finally { cleanup(stateDir); }
});

// ── 30. content-address integrity, part (c) — S5-ON-READ (VALIDATE hacker CRITICAL-2): a planted body whose
// transaction_id FIELD == the filename A but whose CONTENT does not hash to A (computeTransactionId excludes the
// field) must NOT load — else a same-uid attacker substitutes an eligible body under a victim key with no type
// trick, re-opening the manage-promote IDOR. ──
test('30. content-address integrity (S5-on-read): a field==filename body whose content does not hash to A does not load', () => {
  const stateDir = tmpStateDir();
  try {
    const A = 'a'.repeat(64);
    const base = keyedSpawn({ agentId: 'planted', postStateHash: 'b'.repeat(64) });
    const decoy = { ...base, transaction_id: A, writer_persona_id: '07-attacker' };
    delete decoy.idempotency_key; // a direct disk plant, not an appendRecord-keyed write
    assert.notStrictEqual(computeTransactionId(decoy), A, 'the planted body does NOT hash to its claimed txid A');
    const dir = path.join(stateDir, RUN_ID, 'records');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `record-${A}.json`), JSON.stringify(decoy, null, 2));
    assert.strictEqual(store.readById(A, { runId: RUN_ID, stateDir }), null, 'S5-on-read rejects a field==filename body whose content does not hash to it');
    assert.strictEqual(store.listByRun({ runId: RUN_ID, stateDir }).length, 0, 'listByRun skips the content-mismatch plant');
  } finally { cleanup(stateDir); }
});

// ── B3 (2026-06-10 chip): read paths return DEEPLY-FROZEN rows (the #266 class) ──
// Before the fix, loadRecordFile returned the raw parsed object — a caller could
// mutate a record's NESTED arrays/objects (a shallow Object.freeze would not have
// closed it). All read paths funnel through loadRecordFile, so freezing there
// covers readById / readBy* / listByRun.

test('B3: readById returns a DEEPLY-frozen row — nested evidence_refs is immutable', () => {
  const stateDir = tmpStateDir();
  try {
    const rec = buildRecord({ hashSeed: 'b3-readById' });
    store.appendRecord(rec, { runId: RUN_ID, stateDir });
    const got = store.readById(rec.transaction_id, { runId: RUN_ID, stateDir });
    assert.ok(got, 'precondition: record reads back');
    assert.ok(Object.isFrozen(got), 'top-level row must be frozen');
    assert.ok(Array.isArray(got.evidence_refs) && Object.isFrozen(got.evidence_refs), 'NESTED evidence_refs must be frozen (the leak)');
    assert.throws(() => { got.evidence_refs[0] = 'POISON'; }, TypeError, 'nested element write must throw');
    assert.throws(() => { got.evidence_refs.push('INJECTED'); }, TypeError, 'nested push must throw');
    assert.throws(() => { got.commit_outcome = 'TAMPERED'; }, TypeError, 'top-level write must throw');
  } finally { cleanup(stateDir); }
});

test('B3: listByRun rows are DEEPLY frozen (the exact read-back/dedup leak class)', () => {
  const stateDir = tmpStateDir();
  try {
    const rec = buildRecord({ hashSeed: 'b3-listByRun' });
    store.appendRecord(rec, { runId: RUN_ID, stateDir });
    const rows = store.listByRun({ runId: RUN_ID, stateDir });
    assert.strictEqual(rows.length, 1);
    assert.ok(Object.isFrozen(rows[0]) && Object.isFrozen(rows[0].evidence_refs), 'listByRun row + nested must be frozen');
    assert.throws(() => { rows[0].evidence_refs.push('X'); }, TypeError);
  } finally { cleanup(stateDir); }
});

// `os` is used by tmpStateDir (mkdtempSync). This void keeps lint quiet without a
// suppression comment if a future refactor stops using it directly.
void os;

process.stdout.write(`\nrecord-store.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
