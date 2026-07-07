#!/usr/bin/env node

// tests/unit/lab/causal-edge/live-expiry.test.js
//
// Gap-9 background-expiry — the DORMANT/SHADOW sweep that disposes stale, never-landed live_pending nodes.
// Locks: age = now - file mtime (via listLivePendingAges; injected `now` + `fs.utimesSync` for determinism);
// dispose-then-tombstone reuse (#514); idempotent re-sweep (a tombstoned node drops from the default lister);
// the F3 clock/threshold guards (a bad `now`/`maxAgeMs` disposes NOTHING, not everything); F5 per-node
// fail-soft (a throwing disposeFn never aborts the sweep); F7 observability (per-expiry + summary alerts);
// F8 maxPerSweep blast-radius bound; F9 refused-vs-empty return shape; F15 repoSlug parity. Isolated via
// per-test tmp stores.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const E = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'live-expiry.js'));
const { expirePendingLessons, repoSlug, EXPIRED_REASON } = E;
const P = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'live-pending-store.js'));
const { mintLivePendingLesson, listLivePendingLessons } = P;
const D = require(path.join(REPO, 'packages', 'lab', 'causal-edge', 'live-disposal.js'));
const { listDisposalOutcomes, disposeCandidate } = D;

const SELF = typeof process.getuid === 'function' ? process.getuid() : null;
let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}
function tmp(pfx) { return fs.mkdtempSync(path.join(os.tmpdir(), pfx)); }

const SHA = 'a'.repeat(64);
// Mint a live_pending node (the store enforces a full-URL repo). `over` varies the identity so a test can
// mint several DISTINCT nodes (distinct candidate_patch_sha / lesson_signature -> distinct node_id).
function mintPending(pendingDir, over = {}) {
  const r = mintLivePendingLesson({
    repo: 'https://github.com/schmug/colophon', issue_ref: 27, candidate_patch_sha: SHA,
    lesson_signature: 'lesson:x', lesson_body: 'a body', ...over,
  }, { dir: pendingDir, selfUid: SELF });
  assert.strictEqual(r.ok, true, 'pending node minted');
  return r.node_id;
}
// Set a node's file mtime to `seconds` since epoch (mtimeMs becomes seconds*1000) — deterministic ages.
function setMtimeSeconds(pendingDir, nodeId, seconds) {
  fs.utimesSync(path.join(pendingDir, nodeId + '.json'), seconds, seconds);
}
// Capture [LOOM-EGRESS-ALERT] lines emitted during fn().
function captureAlerts(fn) {
  const orig = process.stderr.write.bind(process.stderr);
  const lines = [];
  process.stderr.write = (chunk) => { lines.push(String(chunk)); return true; };
  try { const result = fn(); return { result, lines }; }
  finally { process.stderr.write = orig; }
}
function alertsWithReason(lines, reasonToken) {
  return lines
    .filter((l) => l.includes('[LOOM-EGRESS-ALERT]'))
    .map((l) => { try { return JSON.parse(l.slice(l.indexOf('{'))); } catch { return null; } })
    .filter((o) => o && o.reason === reasonToken);
}

// ── core age sweep ──
test('e1. a node older than maxAgeMs is disposed + tombstoned; a distinct "expired" disposal record is written', () => {
  const pendingDir = tmp('exp-e1-pend-'); const disposalDir = tmp('exp-e1-disp-');
  const nodeId = mintPending(pendingDir);
  setMtimeSeconds(pendingDir, nodeId, 1000);                         // mtimeMs = 1_000_000
  const res = expirePendingLessons(
    { maxAgeMs: 100, now: 1_000_000 + 101, pendingDir, disposalDir }, { selfUid: SELF },
  );
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual({ scanned: res.scanned, attempted: res.attempted, disposed: res.disposed, tombstoned: res.tombstoned },
    { scanned: 1, attempted: 1, disposed: 1, tombstoned: 1 });
  const recs = listDisposalOutcomes({ dir: disposalDir, selfUid: SELF });
  assert.strictEqual(recs.length, 1);
  assert.strictEqual(recs[0].block_reason, EXPIRED_REASON, 'disposed under the "expired" reason');
  assert.strictEqual(recs[0].repo, 'schmug/colophon', 'repo normalized to a bare slug for the disposal store');
  // the node is now tombstoned: default lister skips it, audit lister still sees it (evidence-preserving).
  assert.deepStrictEqual(listLivePendingLessons({ dir: pendingDir, selfUid: SELF }), [], 'default lister skips the expired node');
  assert.strictEqual(listLivePendingLessons({ dir: pendingDir, selfUid: SELF, includeTombstoned: true }).length, 1, 'audit lister still sees it');
});

test('e2. a node YOUNGER than maxAgeMs is untouched; the boundary (age === maxAgeMs) is NOT expired', () => {
  const pendingDir = tmp('exp-e2-pend-'); const disposalDir = tmp('exp-e2-disp-');
  const nodeId = mintPending(pendingDir);
  setMtimeSeconds(pendingDir, nodeId, 1000);                         // mtimeMs = 1_000_000
  // age exactly maxAgeMs -> skip (strictly older than maxAgeMs expires)
  const res = expirePendingLessons({ maxAgeMs: 100, now: 1_000_100, pendingDir, disposalDir }, { selfUid: SELF });
  assert.deepStrictEqual({ ok: res.ok, attempted: res.attempted, disposed: res.disposed }, { ok: true, attempted: 0, disposed: 0 });
  assert.deepStrictEqual(listDisposalOutcomes({ dir: disposalDir, selfUid: SELF }), [], 'nothing disposed');
  assert.strictEqual(listLivePendingLessons({ dir: pendingDir, selfUid: SELF }).length, 1, 'node still live');
});

test('e3. mixed: two old + one fresh -> exactly the two old are disposed', () => {
  const pendingDir = tmp('exp-e3-pend-'); const disposalDir = tmp('exp-e3-disp-');
  const old1 = mintPending(pendingDir, { candidate_patch_sha: 'b'.repeat(64) });
  const old2 = mintPending(pendingDir, { candidate_patch_sha: 'c'.repeat(64) });
  const fresh = mintPending(pendingDir, { candidate_patch_sha: 'd'.repeat(64) });
  setMtimeSeconds(pendingDir, old1, 1000);
  setMtimeSeconds(pendingDir, old2, 1000);
  setMtimeSeconds(pendingDir, fresh, 2000);                          // mtimeMs = 2_000_000
  const res = expirePendingLessons({ maxAgeMs: 100, now: 1_000_500, pendingDir, disposalDir }, { selfUid: SELF });
  assert.deepStrictEqual({ scanned: res.scanned, attempted: res.attempted, disposed: res.disposed }, { scanned: 3, attempted: 2, disposed: 2 });
  assert.strictEqual(listDisposalOutcomes({ dir: disposalDir, selfUid: SELF }).length, 2);
  const live = listLivePendingLessons({ dir: pendingDir, selfUid: SELF });
  assert.strictEqual(live.length, 1, 'the fresh node survives');
  assert.strictEqual(live[0].candidate_patch_sha, 'd'.repeat(64));
});

test('e4. idempotent re-sweep: a second sweep scans only the survivors; no new records', () => {
  const pendingDir = tmp('exp-e4-pend-'); const disposalDir = tmp('exp-e4-disp-');
  const oldId = mintPending(pendingDir, { candidate_patch_sha: 'b'.repeat(64) });
  const freshId = mintPending(pendingDir, { candidate_patch_sha: 'd'.repeat(64) });
  setMtimeSeconds(pendingDir, oldId, 1000);
  setMtimeSeconds(pendingDir, freshId, 5000);                        // mtimeMs = 5_000_000 (never expires here)
  const first = expirePendingLessons({ maxAgeMs: 100, now: 1_000_500, pendingDir, disposalDir }, { selfUid: SELF });
  assert.deepStrictEqual({ scanned: first.scanned, disposed: first.disposed }, { scanned: 2, disposed: 1 });
  // re-sweep at the SAME now: the disposed node is tombstoned -> not scanned; the fresh node is still fresh.
  const second = expirePendingLessons({ maxAgeMs: 100, now: 1_000_500, pendingDir, disposalDir }, { selfUid: SELF });
  assert.deepStrictEqual({ scanned: second.scanned, attempted: second.attempted, disposed: second.disposed },
    { scanned: 1, attempted: 0, disposed: 0 }, 'second sweep sees only the survivor, disposes nothing');
  assert.strictEqual(listDisposalOutcomes({ dir: disposalDir, selfUid: SELF }).length, 1, 'still exactly one disposal record');
});

// ── F3: the clock/threshold guards (the "disposes everything" failure this closes) ──
test('e5. a bad maxAgeMs is refused (ok:false), disposes NOTHING', () => {
  const pendingDir = tmp('exp-e5-pend-'); const disposalDir = tmp('exp-e5-disp-');
  const nodeId = mintPending(pendingDir); setMtimeSeconds(pendingDir, nodeId, 1000);
  for (const bad of [NaN, 0, -1, undefined, Infinity, '100']) {
    const res = expirePendingLessons({ maxAgeMs: bad, now: 9_999_999, pendingDir, disposalDir }, { selfUid: SELF });
    assert.strictEqual(res.ok, false, `refused for maxAgeMs=${String(bad)}`);
    assert.strictEqual(res.reason, 'bad-max-age-ms');
  }
  assert.deepStrictEqual(listDisposalOutcomes({ dir: disposalDir, selfUid: SELF }), [], 'nothing disposed on a refused sweep');
  assert.strictEqual(listLivePendingLessons({ dir: pendingDir, selfUid: SELF }).length, 1, 'node untouched');
});

test('e6. a bad `now` is refused (ok:false), disposes NOTHING (the NaN-flips-eligibility guard)', () => {
  const pendingDir = tmp('exp-e6-pend-'); const disposalDir = tmp('exp-e6-disp-');
  const nodeId = mintPending(pendingDir); setMtimeSeconds(pendingDir, nodeId, 1000);
  for (const bad of [NaN, null, -1, Infinity]) {
    const res = expirePendingLessons({ maxAgeMs: 100, now: bad, pendingDir, disposalDir }, { selfUid: SELF });
    assert.strictEqual(res.ok, false, `refused for now=${String(bad)}`);
    assert.strictEqual(res.reason, 'bad-now');
  }
  assert.deepStrictEqual(listDisposalOutcomes({ dir: disposalDir, selfUid: SELF }), [], 'a NaN clock disposes NOTHING (not everything)');
});

// ── F5: per-node fail-soft ──
test('e7. a THROWING disposeFn degrades that node, never aborts the sweep (TOTAL)', () => {
  const pendingDir = tmp('exp-e7-pend-'); const disposalDir = tmp('exp-e7-disp-');
  const a = mintPending(pendingDir, { candidate_patch_sha: 'b'.repeat(64) });
  const b = mintPending(pendingDir, { candidate_patch_sha: 'c'.repeat(64) });
  setMtimeSeconds(pendingDir, a, 1000); setMtimeSeconds(pendingDir, b, 1000);
  let threw = false; let res;
  try {
    res = expirePendingLessons(
      { maxAgeMs: 100, now: 1_000_500, pendingDir, disposalDir },
      { selfUid: SELF, disposeFn: () => { throw new Error('boom'); } },
    );
  } catch { threw = true; }
  assert.strictEqual(threw, false, 'the sweep never throws into the caller');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.attempted, 2, 'both attempted nodes were processed (the throw on the first did not abort)');
  assert.strictEqual(res.disposed, 0, 'a throwing disposer disposes nothing');
  assert.strictEqual(res.results.filter((r) => r.disposed === false).length, 2);
});

// ── totality on odd stores ──
test('e8. empty / absent / foreign store -> ok:true, scanned:0 (TOTAL)', () => {
  const empty = tmp('exp-e8-empty-');
  assert.deepStrictEqual(
    expirePendingLessons({ maxAgeMs: 100, now: 9_999_999, pendingDir: empty, disposalDir: tmp('exp-e8-d1-') }, { selfUid: SELF }),
    { ok: true, scanned: 0, attempted: 0, disposed: 0, tombstoned: 0, capped: false, results: [] },
  );
  // absent pending dir
  const res2 = expirePendingLessons({ maxAgeMs: 100, now: 9_999_999, pendingDir: path.join(empty, 'nope'), disposalDir: tmp('exp-e8-d2-') }, { selfUid: SELF });
  assert.deepStrictEqual({ ok: res2.ok, scanned: res2.scanned }, { ok: true, scanned: 0 });
  // foreign pending dir (selfUid != owner) -> listLivePendingAges returns [] -> scanned 0
  const pend = tmp('exp-e8-foreign-'); mintPending(pend);
  const foreignUid = (SELF == null ? 12345 : SELF + 1);
  const res3 = expirePendingLessons({ maxAgeMs: 100, now: 9_999_999, pendingDir: pend, disposalDir: tmp('exp-e8-d3-') }, { selfUid: foreignUid });
  assert.deepStrictEqual({ ok: res3.ok, scanned: res3.scanned }, { ok: true, scanned: 0 });
});

test('e9. an "expired" disposal is DISTINCT from a terminal-block disposal for the same candidate (both coexist)', () => {
  const pendingDir = tmp('exp-e9-pend-'); const disposalDir = tmp('exp-e9-disp-');
  const nodeId = mintPending(pendingDir); setMtimeSeconds(pendingDir, nodeId, 1000);
  // first a #514-style terminal-block disposal for this candidate (no tombstone -> node stays live)
  disposeCandidate({ repo: 'schmug/colophon', issueRef: 27, candidatePatchSha: SHA, blockReason: 'pr-creation-restricted' },
    { dir: disposalDir, now: 1, selfUid: SELF });
  // then the expiry sweep disposes it under 'expired' -> a SECOND, distinct record + tombstones the node
  const res = expirePendingLessons({ maxAgeMs: 100, now: 1_000_500, pendingDir, disposalDir }, { selfUid: SELF });
  assert.strictEqual(res.disposed, 1);
  const reasons = listDisposalOutcomes({ dir: disposalDir, selfUid: SELF }).map((r) => r.block_reason).sort();
  assert.deepStrictEqual(reasons, ['expired', 'pr-creation-restricted'], 'both disposal causes recorded (dual-cause history)');
});

// ── F8: maxPerSweep blast-radius bound ──
test('e10. maxPerSweep caps the sweep (capped:true); the remaining stale node is untouched', () => {
  const pendingDir = tmp('exp-e10-pend-'); const disposalDir = tmp('exp-e10-disp-');
  for (const c of ['b', 'c', 'e']) setMtimeSeconds(pendingDir, mintPending(pendingDir, { candidate_patch_sha: c.repeat(64) }), 1000);
  const res = expirePendingLessons({ maxAgeMs: 100, now: 1_000_500, pendingDir, disposalDir }, { selfUid: SELF, maxPerSweep: 2 });
  assert.strictEqual(res.capped, true, 'capped because 3 age-eligible > maxPerSweep 2');
  assert.strictEqual(res.attempted, 2, 'only 2 attempted');
  assert.strictEqual(res.disposed, 2);
  assert.strictEqual(listLivePendingLessons({ dir: pendingDir, selfUid: SELF }).length, 1, 'one stale node left unswept');
});

test('e15. maxPerSweep:0 is a real ZERO-item cap (capped:true, disposes nothing) — NOT silently unbounded', () => {
  const pendingDir = tmp('exp-e15-pend-'); const disposalDir = tmp('exp-e15-disp-');
  const nodeId = mintPending(pendingDir); setMtimeSeconds(pendingDir, nodeId, 1000);
  const res = expirePendingLessons({ maxAgeMs: 100, now: 1_000_500, pendingDir, disposalDir }, { selfUid: SELF, maxPerSweep: 0 });
  assert.deepStrictEqual({ ok: res.ok, capped: res.capped, disposed: res.disposed, attempted: res.attempted }, { ok: true, capped: true, disposed: 0, attempted: 0 });
  assert.deepStrictEqual(listDisposalOutcomes({ dir: disposalDir, selfUid: SELF }), [], 'a 0-cap disposes NOTHING (the safest value is the safest behavior)');
  assert.strictEqual(listLivePendingLessons({ dir: pendingDir, selfUid: SELF }).length, 1, 'the stale node is left for a later, wider sweep');
});

test('e16. F5 per-node ISOLATION: a disposeFn that throws on the FIRST node still disposes the SECOND', () => {
  const disposalDir = tmp('exp-e16-disp-');
  let call = 0;
  const listFn = () => [
    { node: { node_id: 'a'.repeat(64), repo: 'https://github.com/o/r', issue_ref: 1, candidate_patch_sha: SHA }, mtimeMs: 1_000_000 },
    { node: { node_id: 'b'.repeat(64), repo: 'https://github.com/o/r', issue_ref: 2, candidate_patch_sha: SHA }, mtimeMs: 1_000_000 },
  ];
  const disposeFn = () => { call += 1; if (call === 1) throw new Error('boom on node 1'); return { disposed: true, tombstoned: true }; };
  const res = expirePendingLessons({ maxAgeMs: 100, now: 1_000_500, disposalDir }, { selfUid: SELF, listFn, disposeFn });
  assert.strictEqual(res.attempted, 2, 'both nodes attempted (the first throw did not abort)');
  assert.strictEqual(res.disposed, 1, 'the SECOND node disposed despite the first throwing (per-node isolation)');
  assert.deepStrictEqual(res.results.map((r) => r.disposed), [false, true]);
});

// ── F7: observability ──
test('e11. per-expiry alert carries {node_id, mtimeMs, age_ms, block_reason}; a sweep-summary alert fires', () => {
  const pendingDir = tmp('exp-e11-pend-'); const disposalDir = tmp('exp-e11-disp-');
  const nodeId = mintPending(pendingDir); setMtimeSeconds(pendingDir, nodeId, 1000);
  const { lines } = captureAlerts(() => expirePendingLessons({ maxAgeMs: 100, now: 1_000_101, pendingDir, disposalDir }, { selfUid: SELF }));
  const expired = alertsWithReason(lines, 'expiry-expired');
  assert.strictEqual(expired.length, 1, 'one per-expiry alert');
  assert.strictEqual(expired[0].node_id, nodeId);
  assert.strictEqual(expired[0].mtimeMs, 1_000_000);
  assert.strictEqual(expired[0].age_ms, 101);
  assert.strictEqual(expired[0].block_reason, EXPIRED_REASON, 'the disposal cause survives (block_reason, not the clobbered reason key)');
  const summary = alertsWithReason(lines, 'expiry-sweep');
  assert.strictEqual(summary.length, 1, 'one sweep-summary alert');
  assert.deepStrictEqual({ scanned: summary[0].scanned, disposed: summary[0].disposed }, { scanned: 1, disposed: 1 });
});

// ── F9: refused-vs-empty return distinguishable ──
test('e12. F9: a refused sweep (ok:false) is distinguishable from a legitimate empty sweep (ok:true, scanned:0)', () => {
  const refused = expirePendingLessons({ maxAgeMs: -1, now: 100 }, { selfUid: SELF });
  const empty = expirePendingLessons({ maxAgeMs: 100, now: 100, pendingDir: tmp('exp-e12-') }, { selfUid: SELF });
  assert.strictEqual(refused.ok, false);
  assert.strictEqual(empty.ok, true);
  assert.notStrictEqual(refused.ok, empty.ok, 'the return value alone distinguishes them (no alert side-channel needed)');
});

// ── F15: repoSlug parity (pins live-expiry's local copy to the canonical mint behavior) ──
test('e13. repoSlug matches the canonical mint behavior on URL / bare / .git / garbage', () => {
  assert.strictEqual(repoSlug('https://github.com/schmug/colophon'), 'schmug/colophon');
  assert.strictEqual(repoSlug('schmug/colophon'), 'schmug/colophon');
  assert.strictEqual(repoSlug('https://github.com/o/r.git'), 'o/r', '.git stripped');
  assert.strictEqual(repoSlug('o/r.git'), 'o/r');
  assert.strictEqual(repoSlug('not-a-url'), null);
  assert.strictEqual(repoSlug('https://gitlab.com/o/r'), null, 'non-github rejected');
  assert.strictEqual(repoSlug(42), null, 'non-string rejected');
});

test('e14. a node whose repo does not normalize is skipped (fail-safe), the sweep continues (injected lister)', () => {
  const disposalDir = tmp('exp-e14-disp-');
  let disposeCalls = 0;
  const listFn = () => [
    { node: { node_id: 'x'.repeat(64), repo: 'garbage-not-a-url', issue_ref: 1, candidate_patch_sha: SHA }, mtimeMs: 1_000_000 },
    { node: { node_id: 'y'.repeat(64), repo: 'https://github.com/o/r', issue_ref: 2, candidate_patch_sha: SHA }, mtimeMs: 1_000_000 },
  ];
  const disposeFn = () => { disposeCalls += 1; return { disposed: true, tombstoned: true }; };
  const res = expirePendingLessons({ maxAgeMs: 100, now: 1_000_500, disposalDir }, { selfUid: SELF, listFn, disposeFn });
  assert.strictEqual(res.attempted, 2, 'both nodes crossed the age gate');
  assert.strictEqual(disposeCalls, 1, 'only the valid-repo node was disposed');
  assert.strictEqual(res.results.find((r) => r.node_id === 'x'.repeat(64)).reason, 'bad-repo-slug');
});

process.stdout.write(`\nlive-expiry: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
