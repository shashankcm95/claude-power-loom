#!/usr/bin/env node

// tests/unit/lab/causal-edge/live-disposal.test.js
//
// Gap-9 disposal — the content-addressed disposal-outcome store + the disposeCandidate orchestrator. Locks:
// verify-on-write + dedup (EXCLUDE disposed_at from the identity), verify-on-read (content-hash + node-id +
// closed-shape + foreign-uid reject), record-then-tombstone ORDER, fail-soft (never throws into the loop),
// partial-failure re-dispose, and the EVIDENCE-PRESERVING invariant (the pending node bytes are UNCHANGED by
// a tombstone AND stay discoverable via the audit lister). Isolated via opts.dir (per-test tmp store).

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const D = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'live-disposal.js'));
const { disposeCandidate, recordDisposalOutcome, listDisposalOutcomes, deriveDisposalNodeId } = D;
const P = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'live-pending-store.js'));
const { mintLivePendingLesson, listLivePendingLessons } = P;

const SELF = typeof process.getuid === 'function' ? process.getuid() : null;
let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}
function tmp(pfx) { return fs.mkdtempSync(path.join(os.tmpdir(), pfx)); }

const SHA = 'a'.repeat(64);
const BLOCK = { repo: 'schmug/colophon', issue_ref: 27, candidate_patch_sha: SHA, block_reason: 'pr-creation-restricted' };

// ── the disposal-outcome store ──
test('d1. recordDisposalOutcome writes a verifiable record; listDisposalOutcomes reads it back', () => {
  const dir = tmp('disp-d1-');
  const r = recordDisposalOutcome(BLOCK, { dir, now: 1000, selfUid: SELF });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.deduped, false);
  const list = listDisposalOutcomes({ dir, selfUid: SELF });
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].repo, 'schmug/colophon');
  assert.strictEqual(list[0].block_reason, 'pr-creation-restricted');
  assert.strictEqual(list[0].disposed_at, new Date(1000).toISOString());
});

test('d2. a re-record at a DIFFERENT time dedups (first-write-wins; disposed_at excluded from identity)', () => {
  const dir = tmp('disp-d2-');
  const a = recordDisposalOutcome(BLOCK, { dir, now: 1000, selfUid: SELF });
  const b = recordDisposalOutcome(BLOCK, { dir, now: 9999, selfUid: SELF });
  assert.strictEqual(a.node_id, b.node_id, 'same candidate+reason => same node_id (disposed_at not in the basis)');
  assert.strictEqual(b.deduped, true);
  const list = listDisposalOutcomes({ dir, selfUid: SELF });
  assert.strictEqual(list.length, 1, 'exactly one record (deduped)');
  assert.strictEqual(list[0].disposed_at, new Date(1000).toISOString(), 'the FIRST write wins');
});

test('d3. a DIFFERENT block_reason for the same candidate is a distinct record (block_reason is in the basis)', () => {
  const dir = tmp('disp-d3-');
  recordDisposalOutcome(BLOCK, { dir, now: 1, selfUid: SELF });
  recordDisposalOutcome({ ...BLOCK, block_reason: 'issue-closed' }, { dir, now: 2, selfUid: SELF });
  assert.strictEqual(listDisposalOutcomes({ dir, selfUid: SELF }).length, 2);
});

test('d4. verify-on-read: an in-place tamper (edit disposed_at) fails the content-hash seal → skipped', () => {
  const dir = tmp('disp-d4-');
  const r = recordDisposalOutcome(BLOCK, { dir, now: 1000, selfUid: SELF });
  const file = path.join(dir, r.node_id + '.json');
  const body = JSON.parse(fs.readFileSync(file, 'utf8'));
  body.disposed_at = new Date(2000).toISOString();                 // tamper (content_hash now stale)
  fs.writeFileSync(file, JSON.stringify(body));
  assert.deepStrictEqual(listDisposalOutcomes({ dir, selfUid: SELF }), [], 'a tampered record is not read back');
});

test('d5. foreign-uid: a record whose file uid != selfUid is skipped (foreign-owned)', () => {
  const dir = tmp('disp-d5-');
  recordDisposalOutcome(BLOCK, { dir, now: 1000, selfUid: SELF });
  // read with a DIFFERENT selfUid than the file's real owner → the file reads as foreign, skipped.
  const foreignUid = (SELF == null ? 12345 : SELF + 1);
  assert.deepStrictEqual(listDisposalOutcomes({ dir, selfUid: foreignUid }), [], 'a foreign-owned record is skipped');
});

test('d6. a malformed block is refused (observable), never written', () => {
  const dir = tmp('disp-d6-');
  for (const [bad, why] of [
    [{ ...BLOCK, repo: 'no-slash' }, 'bad-repo'],
    [{ ...BLOCK, issue_ref: 0 }, 'bad-issue-ref'],
    [{ ...BLOCK, candidate_patch_sha: 'short' }, 'bad-candidate-sha'],
    [{ ...BLOCK, block_reason: 'Not A Kebab Token!' }, 'bad-block-reason'],
  ]) {
    const r = recordDisposalOutcome(bad, { dir, now: 1, selfUid: SELF });
    assert.strictEqual(r.ok, false, `refused: ${why}`);
    assert.strictEqual(r.reason, why);
  }
  assert.deepStrictEqual(listDisposalOutcomes({ dir, selfUid: SELF }), [], 'nothing written for any malformed block');
});

// ── disposeCandidate orchestration ──
function mintPending(pendingDir, over = {}) {
  const r = mintLivePendingLesson({
    repo: 'https://github.com/schmug/colophon', issue_ref: 27, candidate_patch_sha: SHA,
    lesson_signature: 'lesson:x', lesson_body: 'a body', ...over,
  }, { dir: pendingDir, selfUid: SELF });
  assert.strictEqual(r.ok, true, 'pending node minted');
  return r.node_id;
}

test('d7. disposeCandidate records the outcome AND tombstones the pending node; node BYTES unchanged; audit lister still sees it', () => {
  const dir = tmp('disp-d7-'); const pendingDir = tmp('pend-d7-');
  const nodeId = mintPending(pendingDir);
  const nodeFile = path.join(pendingDir, nodeId + '.json');
  const before = fs.readFileSync(nodeFile);                        // capture the immutable node bytes
  const res = disposeCandidate(
    { repo: 'schmug/colophon', issueRef: 27, candidatePatchSha: SHA, blockReason: 'pr-creation-restricted', pendingNodeId: nodeId },
    { dir, pendingDir, now: 1000, selfUid: SELF },
  );
  assert.deepStrictEqual({ disposed: res.disposed, recorded: res.recorded, tombstoned: res.tombstoned }, { disposed: true, recorded: true, tombstoned: true });
  assert.strictEqual(listDisposalOutcomes({ dir, selfUid: SELF }).length, 1, 'the disposal outcome is recorded');
  // EVIDENCE-PRESERVING: the node file bytes are UNCHANGED (tombstone is a sidecar, never an in-place edit).
  assert.ok(before.equals(fs.readFileSync(nodeFile)), 'the pending node file bytes are unchanged by the tombstone');
  assert.ok(fs.existsSync(path.join(pendingDir, nodeId + '.tombstone')), 'a tombstone sidecar was written');
  // the disposed node is SKIPPED by the default lister but STILL discoverable via the audit lister.
  assert.deepStrictEqual(listLivePendingLessons({ dir: pendingDir, selfUid: SELF }), [], 'default lister skips the tombstoned node');
  assert.strictEqual(listLivePendingLessons({ dir: pendingDir, selfUid: SELF, includeTombstoned: true }).length, 1, 'audit lister still sees it (never vanishes)');
});

test('d8. disposeCandidate is FAIL-SOFT: a throwing recordFn returns {disposed:false}, never throws', () => {
  let threw = false; let res;
  try {
    res = disposeCandidate(
      { repo: 'schmug/colophon', issueRef: 27, candidatePatchSha: SHA, blockReason: 'pr-creation-restricted' },
      { recordFn: () => { throw new Error('store boom'); } },
    );
  } catch { threw = true; }
  assert.strictEqual(threw, false, 'never throws into the caller');
  assert.strictEqual(res.disposed, false);
  assert.strictEqual(res.recorded, false);
});

test('d9. partial failure: record ok but tombstone fails (bad node id) → disposed:true, tombstoned:false; re-dispose completes', () => {
  const dir = tmp('disp-d9-'); const pendingDir = tmp('pend-d9-');
  const first = disposeCandidate(
    { repo: 'schmug/colophon', issueRef: 27, candidatePatchSha: SHA, blockReason: 'pr-creation-restricted', pendingNodeId: 'not-a-valid-hex-node-id' },
    { dir, pendingDir, now: 1, selfUid: SELF },
  );
  assert.strictEqual(first.disposed, true, 'the durable why was recorded');
  assert.strictEqual(first.tombstoned, false, 'the tombstone failed (bad node id)');
  // re-dispose with a REAL node id → record dedups (idempotent), tombstone now succeeds.
  const nodeId = mintPending(pendingDir);
  const second = disposeCandidate(
    { repo: 'schmug/colophon', issueRef: 27, candidatePatchSha: SHA, blockReason: 'pr-creation-restricted', pendingNodeId: nodeId },
    { dir, pendingDir, now: 2, selfUid: SELF },
  );
  assert.strictEqual(second.disposed, true);
  assert.strictEqual(second.tombstoned, true, 're-dispose completes the tombstone');
  assert.strictEqual(listDisposalOutcomes({ dir, selfUid: SELF }).length, 1, 'still exactly one disposal record (deduped)');
});

test('d10. disposeCandidate with NO pendingNodeId records only (no tombstone attempted)', () => {
  const dir = tmp('disp-d10-'); const pendingDir = tmp('pend-d10-');
  const res = disposeCandidate(
    { repo: 'schmug/colophon', issueRef: 27, candidatePatchSha: SHA, blockReason: 'pr-creation-restricted' },
    { dir, pendingDir, now: 1, selfUid: SELF },
  );
  assert.strictEqual(res.recorded, true);
  assert.strictEqual(res.tombstoned, false);
});

test('d11. FAIL-SOFT != fail-silent: a foreign disposal store dir returns {disposed:false} (observable), never throws', () => {
  const dir = tmp('disp-d11-');
  const foreignUid = (SELF == null ? 12345 : SELF + 1);
  // ensureStoreDir will see the dir as foreign-owned (selfUid != the dir's real owner) → refuse.
  const res = disposeCandidate(
    { repo: 'schmug/colophon', issueRef: 27, candidatePatchSha: SHA, blockReason: 'pr-creation-restricted' },
    { dir, now: 1, selfUid: foreignUid },
  );
  assert.strictEqual(res.disposed, false);
  assert.strictEqual(res.recorded, false);
});

test('d12. deriveDisposalNodeId is deterministic + basis-scoped (excludes disposed_at)', () => {
  const a = deriveDisposalNodeId({ repo: 'o/r', issue_ref: 1, candidate_patch_sha: SHA, block_reason: 'x', disposed_at: 'T1' });
  const b = deriveDisposalNodeId({ repo: 'o/r', issue_ref: 1, candidate_patch_sha: SHA, block_reason: 'x', disposed_at: 'T2' });
  assert.strictEqual(a, b, 'disposed_at does not affect the node id');
  assert.ok(/^[0-9a-f]{64}$/.test(a));
});

test('d13. listDisposalOutcomes returns DEEP-FROZEN records (read-path immutability)', () => {
  const dir = tmp('disp-d13-');
  recordDisposalOutcome(BLOCK, { dir, now: 1000, selfUid: SELF });
  const rec = listDisposalOutcomes({ dir, selfUid: SELF })[0];
  assert.ok(Object.isFrozen(rec), 'the returned record is frozen');
  assert.throws(() => { rec.block_reason = 'tampered'; }, TypeError, 'a mutation of a frozen record throws');
});

process.stdout.write(`\nlive-disposal: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
