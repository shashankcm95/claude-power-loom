#!/usr/bin/env node

// tests/unit/kernel/_lib/reject-event-store.test.js
//
// v3.7 W1 — the BEHAVIORAL SPEC (written test-first, TDD) for the REJECT-event
// ledger store:
//
//     packages/kernel/_lib/reject-event-store.js   (NEW — not yet written)
//
// The reject-event ledger is the trust-system's DENIAL-SOURCE producer (the v3.8
// breaker's input). It records the INTEGRATOR's reject decisions (quarantine +
// provenance-reject) as a first-class, content-addressed, tamper-evident record —
// a NON-CHAIN record_kind ('reject-event-v1') that is ISOLATED off the
// post_state_hash keyspace so it can NEVER pollute the K9 chain-walk (the A1
// reshape). The "absorb"/clean-merge side is NOT minted here (it is already the
// P3c-c chained integration record; mechanical clean-merge, display-only — C1).
//
// LOAD-BEARING CONTRACTS THIS SPEC PINS:
//   RS1  build: reject_event_id == computeRejectEventId(body); outcome folded in.
//   RS2  build fail-fast: an invalid outcome / non-hex candidate hash THROWS.
//   RS3  append: writes reject-events/reject-event-<id>.json (NOT records/);
//        listRejectEvents returns it; the read-back is deep-frozen (immutable).
//   RS4  append integrity (S5): a forged reject_event_id is rejected on write.
//   RS5  idempotency: the same (run, candidate, outcome) appends ONCE (deduped).
//   RS6  S5-on-read: an outcome-FLIP planted file (id/filename kept) fails the
//        content<->id re-hash and is skipped by the readers (H2 content-binding).
//   RS7  A1 ISOLATION: a reject-event sharing a candidate_post_state_hash VALUE
//        with a real chained record is INVISIBLE to readByPostStateHash + listByRun
//        (the chain-walk readers) — and the genesis is invisible to listRejectEvents.
//   RS8  S1b: a hostile runId never reaches the filesystem (append + readers).
//   RS9  shape: empty evidence_refs / missing candidate hash -> append reject.
//
// House test pattern mirrors record-store.test.js / integrator.test.js: imperative
// assert + hand-rolled runner + process.exit; hermetic temp stateDir; no git needed
// (computePostStateHash hashes a string — these are pure store-layer tests).

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// The module under test (NOT YET WRITTEN — this require is why the suite is RED
// until reject-event-store.js ships).
const rejectStore = require('../../../../packages/kernel/_lib/reject-event-store');
const {
  buildRejectEvent,
  appendRejectEvent,
  listRejectEvents,
  readRejectEventById,
  computeRejectEventId,
  rejectEventStoreDir,
  REJECT_EVENT_OUTCOMES,
} = rejectStore;

// The REAL chain-walk store + hash primitive (RS7 asserts isolation against them).
const { appendRecord, readByPostStateHash, listByRun } = require('../../../../packages/kernel/_lib/record-store');
const { computePostStateHash } = require('../../../../packages/kernel/_lib/transaction-record');
const { buildSpawnRecord } = require('../../../../packages/kernel/_lib/quarantine-promote');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

function tmpState() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'reject-store-'));
}

// A deterministic 64-hex candidate post_state_hash from a label (the candidate's
// kernel-computed identity; computePostStateHash hashes 'POST_STATE|'+treeSha).
function postFor(label) {
  // A 40-hex fake tree sha derived from the label (sha1-shaped), fed through the
  // canonical formula so the value is a real computePostStateHash output.
  const fakeTree = require('crypto').createHash('sha1').update(label).digest('hex');
  return computePostStateHash(fakeTree);
}

// ── RS1 — build content-addresses the whole body; outcome is folded in ────────

test('RS1 buildRejectEvent: reject_event_id == computeRejectEventId(body) and the outcome is folded into the id (flipping it changes the id)', () => {
  const candPost = postFor('cand-rs1');
  const ev = buildRejectEvent({ runId: 'run-rs1', safeId: 'agent_c1', candidatePostStateHash: candPost, outcome: 'quarantined', schemaVersion: 'v3' });
  assert.strictEqual(ev.record_kind, 'reject-event-v1', 'the record_kind discriminator');
  assert.strictEqual(ev.outcome, 'quarantined');
  assert.strictEqual(ev.candidate_post_state_hash, candPost, 'binds the candidate kernel identity');
  assert.deepStrictEqual(ev.evidence_refs, [candPost], 'evidence_refs is the kernel-attested candidate identity (non-empty, A10-spirit)');
  assert.ok(/^[a-f0-9]{64}$/.test(ev.reject_event_id), 'the id is a 64-hex content hash');
  assert.strictEqual(ev.reject_event_id, computeRejectEventId(ev), 'the id is the content hash of the body (sans the id field)');

  // The outcome is in the content-address (H2): a flip yields a different id.
  const flipped = buildRejectEvent({ runId: 'run-rs1', safeId: 'agent_c1', candidatePostStateHash: candPost, outcome: 'provenance-rejected', schemaVersion: 'v3' });
  assert.notStrictEqual(flipped.reject_event_id, ev.reject_event_id, 'flipping the outcome changes the content-address');
  assert.deepStrictEqual(REJECT_EVENT_OUTCOMES.slice().sort(), ['provenance-rejected', 'quarantined'], 'the two reject outcomes');
});

// ── RS2 — build is fail-fast on bad input (the builder boundary) ──────────────

test('RS2 buildRejectEvent fail-fast: an invalid outcome THROWS; a non-hex candidate_post_state_hash THROWS (fail at the builder boundary, mirrors buildChainedRecord)', () => {
  const candPost = postFor('cand-rs2');
  assert.throws(() => buildRejectEvent({ runId: 'r', safeId: 'a', candidatePostStateHash: candPost, outcome: 'absorbed', schemaVersion: 'v3' }),
    /outcome/i, 'an out-of-enum outcome (e.g. the absorb side) is rejected — the ledger is reject-only');
  assert.throws(() => buildRejectEvent({ runId: 'r', safeId: 'a', candidatePostStateHash: 'not-hex', outcome: 'quarantined', schemaVersion: 'v3' }),
    /hex|candidate/i, 'a non-hex candidate identity is rejected');
  assert.throws(() => buildRejectEvent({ runId: '', safeId: 'a', candidatePostStateHash: candPost, outcome: 'quarantined', schemaVersion: 'v3' }),
    /run/i, 'an empty runId is rejected');
});

// ── RS3 — append writes the isolated namespace; list reads it; frozen ─────────

test('RS3 appendRejectEvent writes reject-events/reject-event-<id>.json (NOT records/); listRejectEvents returns it; the read-back is deep-frozen', () => {
  const stateDir = tmpState();
  const runId = 'run-rs3';
  try {
    const candPost = postFor('cand-rs3');
    const ev = buildRejectEvent({ runId, safeId: 'agent_c1', candidatePostStateHash: candPost, outcome: 'quarantined', schemaVersion: 'v3' });
    const res = appendRejectEvent(ev, { runId, stateDir });
    assert.ok(res.ok, `append ok; got ${JSON.stringify(res)}`);
    assert.strictEqual(res.reject_event_id, ev.reject_event_id);

    // The file lands in the reject-events/ subdir under reject-event-<id>.json.
    const dir = rejectEventStoreDir({ runId, stateDir });
    assert.ok(dir.endsWith(path.join('reject-events')), `the store dir is the reject-events/ subdir; got ${dir}`);
    assert.ok(fs.existsSync(path.join(dir, `reject-event-${ev.reject_event_id}.json`)), 'the file uses the reject-event-<id>.json name');
    assert.ok(!fs.existsSync(path.join(stateDir, runId, 'records')), 'NOTHING is written into the records/ chain-walk dir');

    const list = listRejectEvents({ runId, stateDir });
    assert.strictEqual(list.length, 1, 'listRejectEvents returns the one event');
    assert.strictEqual(list[0].reject_event_id, ev.reject_event_id);
    assert.strictEqual(readRejectEventById(ev.reject_event_id, { runId, stateDir }).outcome, 'quarantined', 'readRejectEventById resolves by the content-address key');

    // Immutable read-back (the #266 / B3 deep-freeze class).
    assert.throws(() => { list[0].evidence_refs.push('mutated'); }, 'the read-back record (nested array) is deep-frozen');
  } finally { fs.rmSync(stateDir, { recursive: true, force: true }); }
});

// ── RS4 — append integrity (S5): a forged id is rejected on write ─────────────

test('RS4 appendRejectEvent S5: a record whose reject_event_id != computeRejectEventId(body) is rejected on write (no storage under a forged id)', () => {
  const stateDir = tmpState();
  const runId = 'run-rs4';
  try {
    const candPost = postFor('cand-rs4');
    const ev = buildRejectEvent({ runId, safeId: 'agent_c1', candidatePostStateHash: candPost, outcome: 'quarantined', schemaVersion: 'v3' });
    const forged = { ...ev, reject_event_id: 'a'.repeat(64) };
    const res = appendRejectEvent(forged, { runId, stateDir });
    assert.strictEqual(res.ok, false, 'a forged id is rejected');
    assert.ok(/mismatch|id/i.test(res.reason || ''), `the reason names an id mismatch; got ${JSON.stringify(res)}`);
    assert.strictEqual(listRejectEvents({ runId, stateDir }).length, 0, 'nothing stored');
  } finally { fs.rmSync(stateDir, { recursive: true, force: true }); }
});

// ── RS5 — idempotency: same (run, candidate, outcome) -> one record ───────────

test('RS5 idempotency: appending the SAME reject event twice -> one stored file, the second is deduped, listRejectEvents length stays 1', () => {
  const stateDir = tmpState();
  const runId = 'run-rs5';
  try {
    const candPost = postFor('cand-rs5');
    const ev = buildRejectEvent({ runId, safeId: 'agent_c1', candidatePostStateHash: candPost, outcome: 'quarantined', schemaVersion: 'v3' });
    const a = appendRejectEvent(ev, { runId, stateDir });
    const b = appendRejectEvent(ev, { runId, stateDir });
    assert.ok(a.ok && b.ok, 'both appends report ok');
    assert.strictEqual(b.deduped, true, 'the second append is a dedup (same content-address)');
    assert.strictEqual(listRejectEvents({ runId, stateDir }).length, 1, 'only one record on disk');
  } finally { fs.rmSync(stateDir, { recursive: true, force: true }); }
});

// ── RS6 — S5-on-read: an outcome-flip planted file is skipped ─────────────────

test('RS6 S5-on-read (H2 content-binding): a same-uid PLANTED file whose body has a FLIPPED outcome but keeps the original id/filename fails the content<->id re-hash and is skipped by the readers', () => {
  const stateDir = tmpState();
  const runId = 'run-rs6';
  try {
    const candPost = postFor('cand-rs6');
    const ev = buildRejectEvent({ runId, safeId: 'agent_c1', candidatePostStateHash: candPost, outcome: 'quarantined', schemaVersion: 'v3' });
    const dir = rejectEventStoreDir({ runId, stateDir });
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `reject-event-${ev.reject_event_id}.json`);
    // Plant: keep the id + filename, FLIP the outcome (the breaker would read 'provenance-rejected').
    const poison = { ...ev, outcome: 'provenance-rejected' };
    fs.writeFileSync(file, JSON.stringify(poison, null, 2));

    assert.strictEqual(listRejectEvents({ runId, stateDir }).length, 0, 'the outcome-flipped poison is skipped (content != id)');
    assert.strictEqual(readRejectEventById(ev.reject_event_id, { runId, stateDir }), null, 'readRejectEventById fail-softs the tampered file to null');
  } finally { fs.rmSync(stateDir, { recursive: true, force: true }); }
});

// ── RS7 — A1 ISOLATION from the chain-walk readers (the reshape's crux) ───────

test('RS7 A1 isolation: a reject-event sharing a candidate_post_state_hash VALUE with a real chained record is INVISIBLE to readByPostStateHash + listByRun; the genesis is invisible to listRejectEvents (the keyspaces never cross)', () => {
  const stateDir = tmpState();
  const runId = 'run-rs7';
  try {
    // A genuine chained/genesis record in records/, keyed by post = P.
    const P = postFor('shared-identity');
    const genesis = buildSpawnRecord({ agentId: 'agent_seed', personaId: '13-node-backend.tester', schemaVersion: 'v3', postStateHash: P, headAnchor: null });
    assert.ok(appendRecord(genesis, { runId, stateDir }).ok, 'the genesis record is stored in records/');

    // A reject-event whose candidate_post_state_hash is the SAME value P.
    const ev = buildRejectEvent({ runId, safeId: 'agent_c1', candidatePostStateHash: P, outcome: 'quarantined', schemaVersion: 'v3' });
    assert.ok(appendRejectEvent(ev, { runId, stateDir }).ok, 'the reject-event is stored in reject-events/');

    // The chain-walk readers must resolve ONLY the genesis — never the reject-event.
    const walked = readByPostStateHash(P, { runId, stateDir });
    assert.ok(walked, 'readByPostStateHash finds the genesis');
    assert.strictEqual(walked.transaction_id, genesis.transaction_id, 'readByPostStateHash returns the chained record, NEVER the reject-event (no post_state_hash pollution)');
    const runRecs = listByRun({ runId, stateDir });
    assert.strictEqual(runRecs.length, 1, 'listByRun (the chain-walk lister) sees ONLY the records/ entry');
    assert.ok(runRecs.every((r) => r.record_kind !== 'reject-event-v1'), 'no reject-event leaks into the chain-walk list');

    // And the reject-event reader sees ONLY the reject-event.
    const rejects = listRejectEvents({ runId, stateDir });
    assert.strictEqual(rejects.length, 1, 'listRejectEvents sees only the reject-events/ entry');
    assert.strictEqual(rejects[0].reject_event_id, ev.reject_event_id);
  } finally { fs.rmSync(stateDir, { recursive: true, force: true }); }
});

// ── RS8 — S1b: a hostile runId never reaches the filesystem ───────────────────

test('RS8 S1b: a traversing runId (../../etc) is rejected by append and the readers BEFORE any fs reach (no relocation of the store outside stateDir)', () => {
  const stateDir = tmpState();
  try {
    const candPost = postFor('cand-rs8');
    const ev = buildRejectEvent({ runId: 'safe', safeId: 'a', candidatePostStateHash: candPost, outcome: 'quarantined', schemaVersion: 'v3' });
    const res = appendRejectEvent(ev, { runId: '../../etc/injected', stateDir });
    assert.strictEqual(res.ok, false, 'a hostile runId append is refused');
    assert.ok(/run/i.test(res.reason || ''), `the reason names the run-id; got ${JSON.stringify(res)}`);
    assert.deepStrictEqual(listRejectEvents({ runId: '../../etc/injected', stateDir }), [], 'list with a hostile runId -> [] (no readdir reach)');
    assert.strictEqual(readRejectEventById('a'.repeat(64), { runId: '../../etc/injected', stateDir }), null, 'read with a hostile runId -> null');
  } finally { fs.rmSync(stateDir, { recursive: true, force: true }); }
});

// ── RS9 — shape: empty evidence_refs / missing candidate hash -> reject ───────

test('RS9 append shape validation: a record with empty evidence_refs OR a missing candidate_post_state_hash is rejected (A10-spirit + the load-bearing identity field)', () => {
  const stateDir = tmpState();
  const runId = 'run-rs9';
  try {
    const candPost = postFor('cand-rs9');
    const ev = buildRejectEvent({ runId, safeId: 'agent_c1', candidatePostStateHash: candPost, outcome: 'quarantined', schemaVersion: 'v3' });

    // Empty evidence_refs — re-content-address it so it is NOT an id-mismatch, isolating
    // the A10-spirit emptiness check.
    const noEvidence = { ...ev, evidence_refs: [] };
    const reId1 = { ...noEvidence, reject_event_id: computeRejectEventId(noEvidence) };
    const r1 = appendRejectEvent(reId1, { runId, stateDir });
    assert.strictEqual(r1.ok, false, 'empty evidence_refs is rejected');
    assert.ok(/evidence/i.test(r1.reason || ''), `the reason names evidence_refs; got ${JSON.stringify(r1)}`);

    // Missing candidate_post_state_hash.
    const noHash = { ...ev };
    delete noHash.candidate_post_state_hash;
    const reId2 = { ...noHash, reject_event_id: computeRejectEventId(noHash) };
    const r2 = appendRejectEvent(reId2, { runId, stateDir });
    assert.strictEqual(r2.ok, false, 'a missing candidate identity is rejected');
  } finally { fs.rmSync(stateDir, { recursive: true, force: true }); }
});

// ── RS10 — run-binding: a cross-run record/plant is refused on write + skipped on read ─

test('RS10 run-binding (VALIDATE fold): appendRejectEvent refuses a record whose run_id != opts.runId; a same-uid PLANT of an S5-valid run-X event into run-Y is invisible to run-Y readers (no reject-rate inflation for the breaker)', () => {
  const stateDir = tmpState();
  try {
    const candPost = postFor('cand-rs10');
    const evX = buildRejectEvent({ runId: 'run-X', safeId: 'agent_c1', candidatePostStateHash: candPost, outcome: 'quarantined', schemaVersion: 'v3' });

    // (a) append-side: a record stamped run-X cannot be written under runId run-Y.
    const r = appendRejectEvent(evX, { runId: 'run-Y', stateDir });
    assert.strictEqual(r.ok, false, 'a run_id-vs-store mismatch is refused on write');
    assert.ok(/run-id-mismatch/.test(r.reason || ''), `the reason names the run mismatch; got ${JSON.stringify(r)}`);

    // (b) read-side: a direct same-uid plant of the (internally S5-valid) run-X event into
    // run-Y's dir is skipped by run-Y readers (the dir is not a sandbox; the run-binding closes it).
    const yDir = rejectEventStoreDir({ runId: 'run-Y', stateDir });
    fs.mkdirSync(yDir, { recursive: true });
    fs.writeFileSync(path.join(yDir, `reject-event-${evX.reject_event_id}.json`), JSON.stringify(evX, null, 2));
    assert.strictEqual(listRejectEvents({ runId: 'run-Y', stateDir }).length, 0, 'the cross-run plant is invisible to run-Y listRejectEvents');
    assert.strictEqual(readRejectEventById(evX.reject_event_id, { runId: 'run-Y', stateDir }), null, 'readRejectEventById run-binds too');
  } finally { fs.rmSync(stateDir, { recursive: true, force: true }); }
});

process.stdout.write(`\nreject-event-store.test: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
