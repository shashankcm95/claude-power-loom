#!/usr/bin/env node

// tests/unit/lab/solve-queue/dispose-stale.test.js
//
// TDD SPEC for the dispose-on-failure sweep: advance a STALE `solving` entry to `disposed` (re-openable),
// CAS-guarded on `expect_state:'solving'`, TOTAL / SHADOW / weight-0. Both DI-double tests (the sweep logic)
// and a real-store write-through (non-vacuity). Run as `node <file>`.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE_BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-disp-'));
process.env.LOOM_LAB_STATE_DIR = STATE_BASE;   // module-load capture: set BEFORE requiring the lab modules

const REPO = path.join(__dirname, '..', '..', '..', '..');
const queue = require(path.join(REPO, 'packages', 'lab', 'solve-queue', 'solve-queue-store.js'));
const { disposeStaleSolving, DEFAULT_STALE_MS } = require(path.join(REPO, 'packages', 'lab', 'solve-queue', 'dispose-stale.js'));

let passed = 0;
function test(name, fn) { fn(); passed += 1; }

const NOW = 1000000000;   // a fixed deterministic clock

// A queue DI double: records list/advance calls; returns configurable entries + advance outcome.
function queueDouble({ entries = [], advanceFn, listThrows = false, advanceThrows = false } = {}) {
  const calls = { list: [], advance: [] };
  return {
    calls,
    list(input, opts) { calls.list.push({ input, opts }); if (listThrows) throw new Error('list boom'); return entries; },
    advance(input, opts) {
      calls.advance.push({ input, opts });
      if (advanceThrows) throw new Error('advance boom');
      return advanceFn ? advanceFn(input) : { ok: true, entry_id: input.entry_id, state: input.to_state };
    },
  };
}
const solving = (id, updated_at, rev = 1) => ({ entry_id: id, state: 'solving', updated_at, rev });

// ---- the sweep logic (DI double) ----

test('disposes a STALE solving entry: CAS-guarded advance to disposed + reason evidence', () => {
  const q = queueDouble({ entries: [solving('e1', NOW - 2000, 7)] });
  const r = disposeStaleSolving({ now: NOW, staleMs: 1000, queue: q });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.disposed.map((d) => d.entry_id), ['e1']);
  assert.strictEqual(r.disposed[0].age_ms, 2000);
  assert.strictEqual(q.calls.advance.length, 1);
  const a = q.calls.advance[0].input;
  assert.strictEqual(a.to_state, 'disposed');
  assert.strictEqual(a.expect_state, 'solving', 'state CAS guard is passed');
  assert.strictEqual(a.expect_rev, 7, 'version CAS guard pins the snapshot rev (H1, ms-collision-proof)');
  assert.strictEqual(a.evidence.reason, 'stale-solving-timeout');
});

test('a FRESH (not-stale) solving entry is left untouched (the race guard) - advance NOT called', () => {
  const q = queueDouble({ entries: [solving('e1', NOW - 500)] });
  const r = disposeStaleSolving({ now: NOW, staleMs: 1000, queue: q });
  assert.deepStrictEqual(r.disposed, []);
  assert.deepStrictEqual(r.skipped, [{ entry_id: 'e1', reason: 'not-stale', age_ms: 500 }]);
  assert.strictEqual(q.calls.advance.length, 0, 'a live solve is never mutated');
});

test('age EXACTLY at the threshold disposes (age < staleMs is the skip); one ms under skips', () => {
  const at = disposeStaleSolving({ now: NOW, staleMs: 1000, queue: queueDouble({ entries: [solving('e1', NOW - 1000)] }) });
  assert.deepStrictEqual(at.disposed.map((d) => d.entry_id), ['e1'], 'age == staleMs disposes');
  const under = disposeStaleSolving({ now: NOW, staleMs: 1000, queue: queueDouble({ entries: [solving('e2', NOW - 999)] }) });
  assert.deepStrictEqual(under.disposed, [], 'age == staleMs-1 skips');
});

test('an entry with no numeric updated_at is skipped (no-timestamp), never disposed', () => {
  const q = queueDouble({ entries: [solving('e1', undefined), solving('e2', 'nope')] });
  const r = disposeStaleSolving({ now: NOW, staleMs: 1000, queue: q });
  assert.deepStrictEqual(r.disposed, []);
  assert.deepStrictEqual(r.skipped.map((s) => s.reason), ['no-timestamp', 'no-timestamp']);
  assert.strictEqual(q.calls.advance.length, 0);
});

test('an entry without a valid rev is skipped (no-rev): the version-CAS is non-bypassable', () => {
  const q = queueDouble({ entries: [{ entry_id: 'e1', state: 'solving', updated_at: NOW - 2000 }] });   // no rev
  const r = disposeStaleSolving({ now: NOW, staleMs: 1000, queue: q });
  assert.deepStrictEqual(r.disposed, []);
  assert.deepStrictEqual(r.skipped, [{ entry_id: 'e1', reason: 'no-rev' }]);
  assert.strictEqual(q.calls.advance.length, 0, 'never disposed without version protection');
});

test('a MATERIALLY future ts is fail-safe (skipped, never disposed) AND emits the observable future-ts-suspect alert (M1)', () => {
  const q = queueDouble({ entries: [solving('e1', NOW + 999999)] });   // age -999999 < -staleMs(1000): materially future
  const orig = process.stderr.write.bind(process.stderr);
  const lines = [];
  process.stderr.write = (s) => { lines.push(String(s)); return true; };
  let r;
  try { r = disposeStaleSolving({ now: NOW, staleMs: 1000, queue: q }); } finally { process.stderr.write = orig; }
  assert.deepStrictEqual(r.disposed, []);
  assert.strictEqual(r.skipped[0].reason, 'not-stale');
  assert.strictEqual(q.calls.advance.length, 0, 'fail-safe: a future-ts entry is never disposed');
  assert.ok(lines.some((l) => l.includes('future-ts-suspect')), 'the materially-future ts is OBSERVABLE (non-vacuous)');
});

test('the sweep lists ONLY solving entries', () => {
  const q = queueDouble({ entries: [] });
  disposeStaleSolving({ now: NOW, staleMs: 1000, queue: q });
  assert.deepStrictEqual(q.calls.list[0].input, { state: 'solving' });
});

test('a CAS lost race (advance -> state-changed) is a benign SKIP, not an error', () => {
  const q = queueDouble({ entries: [solving('e1', NOW - 2000)], advanceFn: () => ({ ok: false, reason: 'state-changed' }) });
  const r = disposeStaleSolving({ now: NOW, staleMs: 1000, queue: q });
  assert.deepStrictEqual(r.disposed, []);
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.skipped, [{ entry_id: 'e1', reason: 'state-changed' }]);
});

test('a version CAS lost race (advance -> version-changed) is ALSO a benign SKIP (H1 age-TOCTOU)', () => {
  const q = queueDouble({ entries: [solving('e1', NOW - 2000)], advanceFn: () => ({ ok: false, reason: 'version-changed' }) });
  const r = disposeStaleSolving({ now: NOW, staleMs: 1000, queue: q });
  assert.deepStrictEqual(r.disposed, []);
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.skipped, [{ entry_id: 'e1', reason: 'version-changed' }]);
});

test('L1 TOTAL: a hostile throwing entry_id getter lands in errors (null id), never throws', () => {
  const hostile = { state: 'solving', updated_at: NOW - 2000, get entry_id() { throw new Error('getter-pwn'); } };
  let r;
  assert.doesNotThrow(() => { r = disposeStaleSolving({ now: NOW, staleMs: 1000, queue: queueDouble({ entries: [hostile] }) }); });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.errors.length, 1, 'recorded, the sweep does not crash');
  assert.strictEqual(r.errors[0].entry_id, null, 'the un-readable id is null-safe');
});

test('a non-CAS advance failure lands in errors (observable)', () => {
  const q = queueDouble({ entries: [solving('e1', NOW - 2000)], advanceFn: () => ({ ok: false, reason: 'write-failed' }) });
  const r = disposeStaleSolving({ now: NOW, staleMs: 1000, queue: q });
  assert.deepStrictEqual(r.disposed, []);
  assert.deepStrictEqual(r.errors, [{ entry_id: 'e1', message: 'write-failed' }]);
});

test('TOTAL: a throwing list returns {ok:false, list-threw}, never throws', () => {
  const q = queueDouble({ entries: [], listThrows: true });
  const r = disposeStaleSolving({ now: NOW, staleMs: 1000, queue: q });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'list-threw');
});

test('TOTAL: a throwing advance lands in errors + the sweep CONTINUES to the next entry', () => {
  const q = queueDouble({ entries: [solving('e1', NOW - 2000), solving('e2', NOW - 2000)], advanceThrows: true });
  const r = disposeStaleSolving({ now: NOW, staleMs: 1000, queue: q });
  assert.deepStrictEqual(r.disposed, []);
  assert.strictEqual(r.errors.length, 2, 'both entries attempted, both recorded');
  assert.ok(r.errors.every((e) => /advance-threw|advance boom/.test(e.message)));
});

test('DEFAULT_STALE_MS is the exported 2h window', () => {
  assert.strictEqual(DEFAULT_STALE_MS, 2 * 60 * 60 * 1000);
});

// ---- real-store write-through (non-vacuity) ----

test('REAL store: a genuinely stale solving entry becomes `disposed` on disk (non-vacuous)', () => {
  const dir = fs.mkdtempSync(path.join(STATE_BASE, 'q-'));
  const enq = queue.enqueue({ repo: 'octo/widget', issue_ref: 11 }, { dir });
  assert.strictEqual(enq.ok, true);
  const adv = queue.advance({ entry_id: enq.entry_id, to_state: 'solving' }, { dir });
  assert.strictEqual(adv.ok, true);

  // NOT stale under a real-time clock -> untouched (proves the guard is real, not vacuous).
  const fresh = disposeStaleSolving({ queueDir: dir });   // now = Date.now(), staleMs = 2h default
  assert.deepStrictEqual(fresh.disposed, []);
  assert.strictEqual(queue.get({ entry_id: enq.entry_id }, { dir }).state, 'solving');

  // Back-date the clock so the entry ages out -> disposed on disk, reason recorded, re-openable.
  const got = queue.get({ entry_id: enq.entry_id }, { dir });
  const r = disposeStaleSolving({ now: got.updated_at + DEFAULT_STALE_MS + 1, queueDir: dir });
  assert.deepStrictEqual(r.disposed.map((d) => d.entry_id), [enq.entry_id]);
  const after = queue.get({ entry_id: enq.entry_id }, { dir });
  assert.strictEqual(after.state, 'disposed');
  assert.strictEqual(after.evidence.reason, 'stale-solving-timeout');

  // Re-openable: enqueue re-queues a disposed entry, and the fold RESETS the stale reason.
  const re = queue.enqueue({ repo: 'octo/widget', issue_ref: 11 }, { dir });
  assert.strictEqual(re.state, 'queued');
  assert.strictEqual(queue.get({ entry_id: enq.entry_id }, { dir }).evidence.reason, undefined, 're-open resets evidence');
});

test('REAL store: an entry that advanced to `drafted` is not even listed as solving (only solving swept)', () => {
  const dir = fs.mkdtempSync(path.join(STATE_BASE, 'q2-'));
  const enq = queue.enqueue({ repo: 'octo/widget', issue_ref: 22 }, { dir });
  queue.advance({ entry_id: enq.entry_id, to_state: 'solving' }, { dir });
  queue.advance({ entry_id: enq.entry_id, to_state: 'drafted' }, { dir });
  const r = disposeStaleSolving({ now: Date.now() + DEFAULT_STALE_MS * 2, queueDir: dir });
  assert.deepStrictEqual(r.disposed, [], 'a drafted entry is never disposed by the solving sweep');
  assert.strictEqual(queue.get({ entry_id: enq.entry_id }, { dir }).state, 'drafted');
});

try { fs.rmSync(STATE_BASE, { recursive: true, force: true }); } catch { /* best-effort */ }
assert.ok(passed >= 16, `anti-vacuity floor: expected >=16, ran ${passed}`);
console.log(`${path.basename(__filename)}: ${passed} passed`);
