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
// masquerading as a read-miss). The genesis record's prev_state_hash is the
// literal 'GENESIS' sentinel K9 recognizes (k9-promote-deltas.js:88-92), NOT
// computeGenesisHash (which isGenesisPosition does not recognize — OQ-2).

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
} = require('../../../../packages/kernel/_lib/transaction-record');

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
    intent_recorded_at: '2026-01-01T00:00:00.000Z',
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

// `os` is used by tmpStateDir (mkdtempSync). This void keeps lint quiet without a
// suppression comment if a future refactor stops using it directly.
void os;

process.stdout.write(`\nrecord-store.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
