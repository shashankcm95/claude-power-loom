#!/usr/bin/env node

// tests/unit/lab/causal-edge/live-pending-ages.test.js
//
// Gap-9 background-expiry — the store-side surface: listLivePendingAges (the mtime-aware lister) + the
// readNodeRaw -> readNodeVerified refactor. Locks: (F1) listLivePendingAges and listLivePendingLessons
// project from the ONE shared enumerator (same node set, same tombstone-skip); (F2) mtimeMs is the file's
// real mtime, read off the SAME fstat'd fd — NO second fs.statSync (proved by spying); (F10) the refactored
// verified read still emits every refuse-path alert (foreign / oversize / tampered) from INSIDE the verified
// core, not just returning null. Isolated via per-test tmp stores.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const P = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'live-pending-store.js'));
const { mintLivePendingLesson, listLivePendingLessons, listLivePendingAges, tombstonePendingLesson } = P;

const SELF = typeof process.getuid === 'function' ? process.getuid() : null;
let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}
function tmp(pfx) { return fs.mkdtempSync(path.join(os.tmpdir(), pfx)); }
const SHA = 'a'.repeat(64);
function mintPending(dir, over = {}) {
  const r = mintLivePendingLesson({
    repo: 'https://github.com/schmug/colophon', issue_ref: 27, candidate_patch_sha: SHA,
    lesson_signature: 'lesson:x', lesson_body: 'a body', ...over,
  }, { dir, selfUid: SELF });
  assert.strictEqual(r.ok, true);
  return r.node_id;
}
function captureAlerts(fn) {
  const orig = process.stderr.write.bind(process.stderr);
  const lines = [];
  process.stderr.write = (chunk) => { lines.push(String(chunk)); return true; };
  try { const result = fn(); return { result, lines }; }
  finally { process.stderr.write = orig; }
}
function hasAlert(lines, reasonToken, kind) {
  return lines.some((l) => l.includes('[LOOM-EGRESS-ALERT]') && l.includes(`"reason":"${reasonToken}"`) && (kind === undefined || l.includes(`"kind":"${kind}"`)));
}

// ── listLivePendingAges basics ──
test('a1. listLivePendingAges returns {node, mtimeMs}; node is deep-frozen and the tuple is frozen', () => {
  const dir = tmp('ages-a1-');
  const nodeId = mintPending(dir);
  fs.utimesSync(path.join(dir, nodeId + '.json'), 4242, 4242);       // mtimeMs = 4_242_000
  const list = listLivePendingAges({ dir, selfUid: SELF });
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].node.node_id, nodeId);
  assert.strictEqual(list[0].mtimeMs, 4_242_000, 'mtimeMs is the real file mtime');
  assert.ok(Object.isFrozen(list[0]), 'the tuple is frozen');
  assert.ok(Object.isFrozen(list[0].node), 'the node body is frozen');
  assert.throws(() => { list[0].node.repo = 'x'; }, TypeError);
});

test('a2. mtimeMs tracks a utimes change (proves it is the live file mtime, the age input)', () => {
  const dir = tmp('ages-a2-');
  const nodeId = mintPending(dir);
  fs.utimesSync(path.join(dir, nodeId + '.json'), 1000, 1000);
  assert.strictEqual(listLivePendingAges({ dir, selfUid: SELF })[0].mtimeMs, 1_000_000);
  fs.utimesSync(path.join(dir, nodeId + '.json'), 2000, 2000);
  assert.strictEqual(listLivePendingAges({ dir, selfUid: SELF })[0].mtimeMs, 2_000_000, 'reflects the new mtime');
});

// ── F1: the shared enumerator — no drift between the two listers ──
test('a3. listLivePendingAges and listLivePendingLessons return the SAME node set (shared enumerator)', () => {
  const dir = tmp('ages-a3-');
  mintPending(dir, { candidate_patch_sha: 'b'.repeat(64) });
  mintPending(dir, { candidate_patch_sha: 'c'.repeat(64) });
  const ids1 = listLivePendingLessons({ dir, selfUid: SELF }).map((n) => n.node_id).sort();
  const ids2 = listLivePendingAges({ dir, selfUid: SELF }).map((e) => e.node.node_id).sort();
  assert.deepStrictEqual(ids2, ids1, 'identical node ids from both listers');
  assert.strictEqual(ids1.length, 2);
});

test('a4. listLivePendingAges skips tombstoned by default; includeTombstoned:true reveals them (audit)', () => {
  const dir = tmp('ages-a4-');
  const live = mintPending(dir, { candidate_patch_sha: 'b'.repeat(64) });
  const dead = mintPending(dir, { candidate_patch_sha: 'c'.repeat(64) });
  assert.strictEqual(tombstonePendingLesson(dead, 'expired', { dir, selfUid: SELF }).ok, true);
  const def = listLivePendingAges({ dir, selfUid: SELF });
  assert.deepStrictEqual(def.map((e) => e.node.node_id), [live], 'default skips the tombstoned node');
  const audit = listLivePendingAges({ dir, selfUid: SELF, includeTombstoned: true }).map((e) => e.node.node_id).sort();
  assert.deepStrictEqual(audit, [live, dead].sort(), 'audit path reveals the tombstoned node');
});

// ── F2: the mtime comes off the SAME fstat'd fd — NO second path-based stat ──
test('a5. F2: listLivePendingAges does NO fs.statSync (path re-resolution) — mtime is off the fstat fd', () => {
  const dir = tmp('ages-a5-');
  const ids = ['b', 'c', 'e'].map((c) => mintPending(dir, { candidate_patch_sha: c.repeat(64) }));
  const realOpen = fs.openSync; const realStat = fs.statSync;
  let opens = 0; let pathStats = 0;
  fs.openSync = (...args) => { opens += 1; return realOpen(...args); };
  fs.statSync = (...args) => { pathStats += 1; return realStat(...args); };
  try { listLivePendingAges({ dir, selfUid: SELF }); }
  finally { fs.openSync = realOpen; fs.statSync = realStat; }
  assert.strictEqual(pathStats, 0, 'ZERO path-based fs.statSync (a second stat would re-resolve a swapped symlink — TOCTOU)');
  assert.strictEqual(opens, ids.length, 'exactly one O_NOFOLLOW open per node (no extra open for mtime)');
});

// ── F10: the refactored verified read still emits every refuse-path alert from inside readNodeVerified ──
test('a6. F10: a foreign-owned store dir is skipped AND emits read-dir/foreign (observable, not silent)', () => {
  // A foreign selfUid trips the DIR-level validateReadDir first (a foreign FILE needs chown, not unit-testable
  // without root; the node-level isForeign is the identical unchanged check, exercised by the tamper/oversize
  // node-level alerts in a7/a8). This locks the enumerator's foreign-read observability.
  const dir = tmp('ages-a6-'); mintPending(dir);
  const foreignUid = (SELF == null ? 12345 : SELF + 1);
  const { result, lines } = captureAlerts(() => listLivePendingAges({ dir, selfUid: foreignUid }));
  assert.deepStrictEqual(result, [], 'foreign store dir -> empty');
  assert.ok(lines.some((l) => l.includes('"reason":"live-pending-read-dir"') && l.includes('"dir_reason":"foreign"')), 'the foreign dir read is observable');
});

test('a7. F10: a tampered node (content-hash edit) is skipped AND emits verify-mismatch/content-hash', () => {
  const dir = tmp('ages-a7-');
  const nodeId = mintPending(dir);
  const file = path.join(dir, nodeId + '.json');
  const body = JSON.parse(fs.readFileSync(file, 'utf8'));
  body.lesson_body = 'tampered after the seal';                     // content_hash now stale
  fs.writeFileSync(file, JSON.stringify(body));
  const { result, lines } = captureAlerts(() => listLivePendingAges({ dir, selfUid: SELF }));
  assert.deepStrictEqual(result, [], 'tampered node skipped');
  assert.ok(hasAlert(lines, 'live-pending-verify-mismatch', 'content-hash'), 'the content-hash alert fires from inside the verified read');
});

test('a8. F10: an oversize node file is skipped AND emits verify-mismatch/oversize', () => {
  const dir = tmp('ages-a8-');
  const nodeId = mintPending(dir);
  const file = path.join(dir, nodeId + '.json');
  fs.writeFileSync(file, ' '.repeat(70 * 1024) + '{}');             // > MAX_RECORD_BYTES (64KB)
  const { result, lines } = captureAlerts(() => listLivePendingAges({ dir, selfUid: SELF }));
  assert.deepStrictEqual(result, [], 'oversize node skipped');
  assert.ok(hasAlert(lines, 'live-pending-verify-mismatch', 'oversize'), 'the oversize alert fires from inside the verified read');
});

process.stdout.write(`\nlive-pending-ages: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
