#!/usr/bin/env node

// tests/unit/lab/causal-edge/live-pending-tombstone.test.js
//
// Gap-9 disposal — the live_pending TOMBSTONE lane. Locks the evidence-preserving + non-suppression
// invariants (VERIFY hacker HIGH "disposal must not be an evidence-erasure lever"): a tombstone is a
// content-address-sealed, uid/O_NOFOLLOW-verified SIDECAR that (a) never touches the immutable node bytes,
// (b) is skipped by the default lister but stays discoverable via the audit lister, and (c) a FOREIGN /
// FORGED tombstone is REJECTED so it can never suppress a legitimate node. Isolated via opts.dir.

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const STORE_SRC_PATH = path.join(REPO, 'packages', 'lab', 'causal-edge', 'live-pending-store.js');
const P = require(STORE_SRC_PATH);
const { mintLivePendingLesson, listLivePendingLessons, tombstonePendingLesson, isPendingTombstoned, deriveLivePendingNodeId } = P;
const { canonicalJsonSerialize } = require(path.join(REPO, 'packages', 'kernel', '_lib', 'canonical-json'));

const SELF = typeof process.getuid === 'function' ? process.getuid() : null;
let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}
function tmp(pfx) { return fs.mkdtempSync(path.join(os.tmpdir(), pfx)); }

const SHA = 'b'.repeat(64);
function mint(dir, over = {}) {
  const r = mintLivePendingLesson({
    repo: 'https://github.com/schmug/colophon', issue_ref: 27, candidate_patch_sha: SHA,
    lesson_signature: 'lesson:x', lesson_body: 'a body', ...over,
  }, { dir, selfUid: SELF });
  assert.strictEqual(r.ok, true, 'node minted');
  return r.node_id;
}

test('pt1. tombstone a real node: sidecar written, isPendingTombstoned true, NODE BYTES unchanged', () => {
  const dir = tmp('pt1-');
  const nodeId = mint(dir);
  const nodeFile = path.join(dir, nodeId + '.json');
  const before = fs.readFileSync(nodeFile);
  const r = tombstonePendingLesson(nodeId, 'pr-creation-restricted', { dir, now: 1000, selfUid: SELF });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(isPendingTombstoned(nodeId, { dir, selfUid: SELF }), true);
  assert.ok(before.equals(fs.readFileSync(nodeFile)), 'the immutable node file is unchanged by the tombstone');
});

test('pt2. default lister SKIPS a tombstoned node; includeTombstoned:true still SEES it (audit path)', () => {
  const dir = tmp('pt2-');
  const nodeId = mint(dir);
  assert.strictEqual(listLivePendingLessons({ dir, selfUid: SELF }).length, 1, 'listed before tombstone');
  tombstonePendingLesson(nodeId, 'pr-creation-restricted', { dir, now: 1, selfUid: SELF });
  assert.deepStrictEqual(listLivePendingLessons({ dir, selfUid: SELF }), [], 'default lister skips it');
  assert.strictEqual(listLivePendingLessons({ dir, selfUid: SELF, includeTombstoned: true }).length, 1, 'audit lister still sees it — never vanishes');
});

test('pt3. a FORGED tombstone (bad content_hash) is REJECTED and does NOT suppress the node (evidence-erasure lever closed)', () => {
  const dir = tmp('pt3-');
  const nodeId = mint(dir);
  // plant a same-uid forged sidecar with a WRONG content_hash (an attacker trying to hide the node).
  const forged = { node_id: nodeId, reason: 'pr-creation-restricted', tombstoned_at: new Date(1).toISOString(), content_hash: 'f'.repeat(64) };
  fs.writeFileSync(path.join(dir, nodeId + '.tombstone'), JSON.stringify(forged), { mode: 0o600 });
  assert.strictEqual(isPendingTombstoned(nodeId, { dir, selfUid: SELF }), false, 'a forged tombstone does not verify');
  assert.strictEqual(listLivePendingLessons({ dir, selfUid: SELF }).length, 1, 'the node is STILL listed (a forged tombstone cannot suppress it)');
});

test('pt4. a foreign-owned tombstone sidecar is REJECTED (does not suppress the node)', () => {
  const dir = tmp('pt4-');
  const nodeId = mint(dir);
  // a VALID-shaped tombstone, but read with a selfUid != the file owner → foreign → rejected.
  tombstonePendingLesson(nodeId, 'pr-creation-restricted', { dir, now: 1, selfUid: SELF });
  const foreignUid = (SELF == null ? 12345 : SELF + 1);
  assert.strictEqual(isPendingTombstoned(nodeId, { dir, selfUid: foreignUid }), false, 'a foreign-owned tombstone is not honored');
  assert.strictEqual(listLivePendingLessons({ dir, selfUid: foreignUid, includeTombstoned: false }).length, 0,
    'the node itself is foreign to this uid too (skipped), so this only proves the tombstone read is uid-scoped');
});

test('pt5. tombstoning an ABSENT node is refused (no orphan tombstone)', () => {
  const dir = tmp('pt5-');
  fs.mkdirSync(dir, { recursive: true });
  const absent = crypto.createHash('sha256').update('nope').digest('hex');
  const r = tombstonePendingLesson(absent, 'pr-creation-restricted', { dir, now: 1, selfUid: SELF });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'node-absent-or-invalid');
  assert.ok(!fs.existsSync(path.join(dir, absent + '.tombstone')), 'no orphan tombstone written');
});

test('pt6. double-tombstone is idempotent (ok, deduped)', () => {
  const dir = tmp('pt6-');
  const nodeId = mint(dir);
  const a = tombstonePendingLesson(nodeId, 'pr-creation-restricted', { dir, now: 1, selfUid: SELF });
  const b = tombstonePendingLesson(nodeId, 'pr-creation-restricted', { dir, now: 2, selfUid: SELF });
  assert.strictEqual(a.ok, true); assert.strictEqual(a.deduped, false);
  assert.strictEqual(b.ok, true); assert.strictEqual(b.deduped, true);
});

test('pt7. a bad node_id or bad reason is refused (observable), never written', () => {
  const dir = tmp('pt7-');
  assert.strictEqual(tombstonePendingLesson('not-hex', 'r', { dir, selfUid: SELF }).reason, 'bad-node-id');
  const nodeId = mint(dir);
  assert.strictEqual(tombstonePendingLesson(nodeId, '', { dir, selfUid: SELF }).reason, 'bad-reason');
  assert.strictEqual(tombstonePendingLesson(nodeId, 'x'.repeat(65), { dir, selfUid: SELF }).reason, 'bad-reason');
});

test('pt8. tombstoning in a store owned by a DIFFERENT uid is refused (uid-scoped; no tombstone written)', () => {
  const dir = tmp('pt8-');
  const nodeId = mint(dir);
  const foreignUid = (SELF == null ? 12345 : SELF + 1);
  // reading as `foreignUid`, the store dir (owned by SELF) reads as foreign FIRST (the dir-level uid check
  // fires before the node read — a stronger fail-closed). Either way: refused, no tombstone, observable.
  const r = tombstonePendingLesson(nodeId, 'pr-creation-restricted', { dir, now: 1, selfUid: foreignUid });
  assert.strictEqual(r.ok, false, 'refused for a foreign store');
  assert.ok(r.reason === 'store-dir:foreign' || r.reason === 'node-absent-or-invalid', `foreign-refuse reason (got ${r.reason})`);
  assert.ok(!fs.existsSync(path.join(dir, nodeId + '.tombstone')), 'no tombstone written for a foreign store');
});

test('pt9. born-dead canary: a fresh node minted OVER a same-uid PRE-PLANTED valid tombstone fires minted-already-tombstoned (still ok)', () => {
  const dir = tmp('pt9-');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // predict the node_id for the EXACT block mint() uses (the basis is public; deriveLivePendingNodeId exported).
  const node_id = deriveLivePendingNodeId({ provenance: 'live_pending', repo: 'https://github.com/schmug/colophon', issue_ref: 27, candidate_patch_sha: SHA, lesson_signature: 'lesson:x' });
  // hand-forge a VALID sealed tombstone at that id BEFORE the node exists (tombstonePendingLesson would refuse
  // an absent node, so an orphan tombstone can ONLY be a pre-plant — the attack shape this canary surfaces).
  const tb = { node_id, reason: 'pr-creation-restricted', tombstoned_at: new Date(1).toISOString() };
  tb.content_hash = crypto.createHash('sha256').update(canonicalJsonSerialize(tb)).digest('hex');
  fs.writeFileSync(path.join(dir, node_id + '.tombstone'), JSON.stringify(tb), { mode: 0o600 });
  const orig = process.stderr.write.bind(process.stderr);
  let cap = '';
  process.stderr.write = (s) => { cap += s; return true; };
  let r;
  try {
    // call the store directly (the mint() helper asserts + returns only node_id) to inspect the full result.
    r = mintLivePendingLesson({ repo: 'https://github.com/schmug/colophon', issue_ref: 27, candidate_patch_sha: SHA, lesson_signature: 'lesson:x', lesson_body: 'a body' }, { dir, selfUid: SELF });
  } finally { process.stderr.write = orig; }
  assert.strictEqual(r.ok, true, 'the node IS written (born-dead is a signal, not a failure)');
  assert.strictEqual(r.deduped, false, 'it is a FRESH mint (the node file did not pre-exist — only the tombstone did)');
  assert.strictEqual(r.node_id, node_id, 'the mint id matches the predicted (pre-planted) id');
  assert.ok(cap.includes('minted-already-tombstoned'), 'the born-dead pre-plant canary fired (observable)');
});

test('pt10. the store header NAMES the #273 tombstone forward-contract (authenticated provenance before the mint gates a weight)', () => {
  const src = fs.readFileSync(STORE_SRC_PATH, 'utf8');
  assert.ok(/FORWARD-CONTRACT/.test(src), 'the tombstone header names the forward-contract');
  assert.ok(/AUTHENTICATED provenance|authenticated provenance|authenticated minter/i.test(src), 'names the authenticated-provenance prerequisite');
  assert.ok(/minted-already-tombstoned/.test(src), 'documents the born-dead canary');
});

process.stdout.write(`\nlive-pending-tombstone: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
