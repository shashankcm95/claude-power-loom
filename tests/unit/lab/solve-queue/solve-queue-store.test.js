#!/usr/bin/env node

// tests/unit/lab/solve-queue/solve-queue-store.test.js
//
// TDD SPEC (written FIRST) for the solve-queue lifecycle store I/O layer (Wave A / item-8 Part-A):
// append-only event log + withLockSoft mutating ops + hardened GROWING-log read + boundary validation +
// observable refuses. SHADOW / weight-inert. Run as `node <file>`.
//
// Isolation: LOOM_LAB_STATE_DIR is pinned to a throwaway tmp dir BEFORE the store is required (the
// lab-state-dir-require-time-capture hazard). Every op takes an explicit `{dir}` too, for belt-and-braces.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const STATE_BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-sq-'));
process.env.LOOM_LAB_STATE_DIR = STATE_BASE;

const STORE_PATH = path.join(__dirname, '..', '..', '..', '..', 'packages', 'lab', 'solve-queue', 'solve-queue-store.js');
const store = require(STORE_PATH);

let passed = 0;
function test(name, fn) { fn(); passed += 1; }
function freshDir() { return fs.mkdtempSync(path.join(STATE_BASE, 'q-')); }

// ---- enqueue: idempotent + re-open ----
test('enqueue lands a queued entry; a second enqueue for the same (repo,issue) is an idempotent no-op', () => {
  const dir = freshDir();
  const a = store.enqueue({ repo: 'octo/widget', issue_ref: 42 }, { dir });
  assert.strictEqual(a.ok, true);
  assert.strictEqual(a.state, 'queued');
  const b = store.enqueue({ repo: 'octo/widget', issue_ref: 42 }, { dir });
  assert.strictEqual(b.ok, true);
  assert.strictEqual(b.entry_id, a.entry_id, 'same entry_id (one per repo+issue)');
  assert.strictEqual(store.list({ state: 'queued' }, { dir }).length, 1, 'no duplicate queued entry');
});

test('enqueue on a DISPOSED entry re-opens it to queued (retry)', () => {
  const dir = freshDir();
  const e = store.enqueue({ repo: 'octo/w', issue_ref: 1 }, { dir });
  store.advance({ entry_id: e.entry_id, to_state: 'disposed', evidence: { reason: 'occupied' } }, { dir });
  assert.strictEqual(store.get({ entry_id: e.entry_id }, { dir }).state, 'disposed');
  const re = store.enqueue({ repo: 'octo/w', issue_ref: 1 }, { dir });
  assert.strictEqual(re.ok, true);
  assert.strictEqual(re.state, 'queued', 're-opened');
});

// ---- claimNext: one-at-a-time, distinct, FIFO, empty ----
test('claimNext returns the oldest queued entry and marks it solving', () => {
  const dir = freshDir();
  const first = store.enqueue({ repo: 'octo/a', issue_ref: 1 }, { dir });
  store.enqueue({ repo: 'octo/b', issue_ref: 2 }, { dir });
  const c = store.claimNext({ dir });
  assert.strictEqual(c.ok, true);
  assert.strictEqual(c.entry_id, first.entry_id, 'FIFO: the earliest-enqueued');
  assert.strictEqual(c.state, 'solving');
  assert.strictEqual(store.get({ entry_id: first.entry_id }, { dir }).state, 'solving');
});

test('two sequential claimNext return DISTINCT entries (state advances, not re-served)', () => {
  const dir = freshDir();
  store.enqueue({ repo: 'octo/a', issue_ref: 1 }, { dir });
  store.enqueue({ repo: 'octo/b', issue_ref: 2 }, { dir });
  const c1 = store.claimNext({ dir });
  const c2 = store.claimNext({ dir });
  assert.notStrictEqual(c1.entry_id, c2.entry_id, 'a claimed entry is not re-served');
  const c3 = store.claimNext({ dir });
  assert.strictEqual(c3.ok, false);
  assert.strictEqual(c3.reason, 'queue-empty');
});

// ---- advance: legality + evidence + refuses ----
test('advance appends a legal transition and persists per-field evidence', () => {
  const dir = freshDir();
  const e = store.enqueue({ repo: 'octo/w', issue_ref: 7, persona: 'node-backend' }, { dir });
  store.claimNext({ dir });
  const d = store.advance({ entry_id: e.entry_id, to_state: 'drafted', evidence: { candidate_patch_sha: 'a'.repeat(64), lesson_signature: 'lesson:x' } }, { dir });
  assert.strictEqual(d.ok, true);
  const got = store.get({ entry_id: e.entry_id }, { dir });
  assert.strictEqual(got.state, 'drafted');
  assert.strictEqual(got.evidence.candidate_patch_sha, 'a'.repeat(64), 'the Wave-B join key persists');
});

test('an ILLEGAL transition is rejected + observable, never appended', () => {
  const dir = freshDir();
  const e = store.enqueue({ repo: 'octo/w', issue_ref: 8 }, { dir });
  const r = store.advance({ entry_id: e.entry_id, to_state: 'merged', evidence: {} }, { dir }); // queued -> merged illegal
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'illegal-transition');
  assert.strictEqual(store.get({ entry_id: e.entry_id }, { dir }).state, 'queued', 'state unchanged');
});

test('advance / get on an UNKNOWN entry is rejected cleanly', () => {
  const dir = freshDir();
  const r = store.advance({ entry_id: 'f'.repeat(64), to_state: 'solving', evidence: {} }, { dir });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'unknown-entry');
  assert.strictEqual(store.get({ entry_id: 'f'.repeat(64) }, { dir }).ok, false);
});

// ---- boundary validation ----
test('a bad repo / issue_ref at enqueue is rejected + observable', () => {
  const dir = freshDir();
  assert.strictEqual(store.enqueue({ repo: '../evil', issue_ref: 1 }, { dir }).ok, false);
  assert.strictEqual(store.enqueue({ repo: 'octo/w', issue_ref: -3 }, { dir }).ok, false);
  assert.strictEqual(store.enqueue({ repo: 'octo/w', issue_ref: 'x' }, { dir }).ok, false);
  assert.strictEqual(store.enqueue({ repo: 'no-slash', issue_ref: 1 }, { dir }).ok, false);
});

// ---- hardened GROWING-log read ----
test('a fresh/absent store reads empty (no alert, no mutation)', () => {
  const dir = freshDir();
  assert.deepStrictEqual(store.list({}, { dir }), []);
});

test('CR3 regression: a log > 64 KiB (the per-node cap) but < MAX_LOG_BYTES is ACCEPTED', () => {
  const dir = freshDir();
  // enqueue one real entry, then pad the log with many valid events for OTHER entries to exceed 64 KiB
  store.enqueue({ repo: 'octo/keep', issue_ref: 1 }, { dir });
  for (let i = 0; i < 900; i++) store.enqueue({ repo: `octo/pad${i}`, issue_ref: i + 2 }, { dir });
  const eventsFile = path.join(dir, 'events.jsonl');
  assert.ok(fs.statSync(eventsFile).size > 64 * 1024, `log must exceed 64 KiB (got ${fs.statSync(eventsFile).size})`);
  const all = store.list({ state: 'queued' }, { dir });
  assert.ok(all.length >= 901, `all entries still read back (got ${all.length}) - the node cap would have rejected the whole log`);
});

test('an OVERSIZE log (> MAX_LOG_BYTES) is rejected + observable (reads empty, no throw)', () => {
  const dir = freshDir();
  store.enqueue({ repo: 'octo/w', issue_ref: 1 }, { dir });
  const eventsFile = path.join(dir, 'events.jsonl');
  fs.appendFileSync(eventsFile, ' '.repeat(store.MAX_LOG_BYTES + 1));
  assert.deepStrictEqual(store.list({}, { dir }), [], 'an oversize log fails closed to empty');
});

test('a TORN / unparseable trailing line is SKIPPED, not thrown (a read racing an append)', () => {
  const dir = freshDir();
  const e = store.enqueue({ repo: 'octo/w', issue_ref: 1 }, { dir });
  // the store frames each record with a LEADING \n, so a real torn write starts with \n then a partial JSON
  fs.appendFileSync(path.join(dir, 'events.jsonl'), '\n{"entry_id":"partial",');
  const got = store.get({ entry_id: e.entry_id }, { dir });
  assert.strictEqual(got.state, 'queued', 'the valid entry still folds; the torn line is skipped, not glued');
});

// ---- hardened WRITE path (a refuse is observable {ok:false}, never an uncaught throw) ----
test('a symlinked STATE DIR is rejected on WRITE: {ok:false, write-failed}, not an uncaught throw', () => {
  const real = fs.mkdtempSync(path.join(STATE_BASE, 'wreal-'));
  const link = path.join(STATE_BASE, `wlink-${passed}`);
  fs.symlinkSync(real, link);
  const r = store.enqueue({ repo: 'octo/w', issue_ref: 1 }, { dir: link });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'write-failed');
});

test('a symlinked events.jsonl is rejected on WRITE (O_NOFOLLOW): {ok:false}, not an uncaught throw', () => {
  const dir = freshDir();
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(STATE_BASE, `wtarget-${passed}.jsonl`);
  fs.writeFileSync(target, '');
  fs.symlinkSync(target, path.join(dir, 'events.jsonl'));
  const r = store.enqueue({ repo: 'octo/w', issue_ref: 2 }, { dir });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'write-failed');
});

test('a SYMLINKED events file is rejected (O_NOFOLLOW) + reads empty', () => {
  const dir = freshDir();
  const real = path.join(STATE_BASE, 'elsewhere.jsonl');
  fs.writeFileSync(real, `${JSON.stringify({ entry_id: 'x', repo: 'octo/w', issue_ref: 1, from_state: null, to_state: 'queued', ts: 0, evidence: {} })}\n`);
  fs.symlinkSync(real, path.join(dir, 'events.jsonl'));
  assert.deepStrictEqual(store.list({}, { dir }), [], 'a symlinked log is not followed');
});

// ---- concurrency: the lock prevents a double-claim (invariant, non-vacuity-verified: with the lock
// BYPASSED this test REDs — proven via a mutation probe at VALIDATE). Each of N workers LOOP-claims until
// empty, so M entries create M race points across N racers — a wide-enough window that a missing lock
// reliably double-claims, unlike a single claim whose read->append window is too small to hit. ----
test('CONCURRENCY: N loop-claimers over M entries claim each EXACTLY ONCE (the store-wide lock)', () => {
  const dir = freshDir();
  const M = 30;
  const N = 8;
  for (let i = 0; i < M; i++) store.enqueue({ repo: `octo/c${i}`, issue_ref: i + 1 }, { dir });
  // each worker drains the queue in a tight loop, printing every entry_id it claimed
  const worker = `const s=require(${JSON.stringify(STORE_PATH)});const c=[];for(;;){const r=s.claimNext({dir:${JSON.stringify(dir)}});if(!r.ok)break;c.push(r.entry_id);}process.stdout.write(JSON.stringify(c));`;
  const outs = [];
  for (let i = 0; i < N; i++) {
    const of = path.join(dir, `res-${i}.json`);
    outs.push(of);
    // background-launch so all N race concurrently (spawnSync would serialize them)
    execFileSync('bash', ['-c', `node -e ${JSON.stringify(worker)} > ${JSON.stringify(of)} 2>/dev/null &`], { env: { ...process.env, LOOM_LAB_STATE_DIR: STATE_BASE } });
  }
  const deadline = Date.now() + 20000;
  const readAll = () => outs.map((f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } });
  while (readAll().some((s) => s.length === 0) && Date.now() < deadline) { execFileSync('bash', ['-c', 'sleep 0.1']); }
  const claimed = readAll().filter((s) => s.length).flatMap((s) => JSON.parse(s));
  assert.strictEqual(new Set(claimed).size, claimed.length, `no entry double-claimed (dups in ${JSON.stringify(claimed)})`);
  assert.strictEqual(claimed.length, M, `every entry claimed exactly once (got ${claimed.length}/${M})`);
});

// ---- advance compare-and-swap (expect_state) — the dispose-sweep TOCTOU guard ----
test('advance with a MATCHING expect_state commits the transition', () => {
  const dir = freshDir();
  const e = store.enqueue({ repo: 'octo/w', issue_ref: 3 }, { dir });
  const r = store.advance({ entry_id: e.entry_id, to_state: 'solving', expect_state: 'queued' }, { dir });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(store.get({ entry_id: e.entry_id }, { dir }).state, 'solving');
});

test('advance with a MISMATCHED expect_state REFUSES (state-changed) and writes NO event', () => {
  const dir = freshDir();
  const e = store.enqueue({ repo: 'octo/w', issue_ref: 4 }, { dir });   // state = queued
  const r = store.advance({ entry_id: e.entry_id, to_state: 'solving', expect_state: 'solving' }, { dir });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'state-changed');
  assert.strictEqual(store.get({ entry_id: e.entry_id }, { dir }).state, 'queued', 'the entry is UNCHANGED (no lost-update)');
});

test('advance WITHOUT expect_state is unchanged (backward-compatible)', () => {
  const dir = freshDir();
  const e = store.enqueue({ repo: 'octo/w', issue_ref: 5 }, { dir });
  assert.strictEqual(store.advance({ entry_id: e.entry_id, to_state: 'solving' }, { dir }).ok, true);
});

test('advance with a BAD expect_state value -> bad-input', () => {
  const dir = freshDir();
  const e = store.enqueue({ repo: 'octo/w', issue_ref: 6 }, { dir });
  const r = store.advance({ entry_id: e.entry_id, to_state: 'disposed', expect_state: 'bogus' }, { dir });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'bad-input');
});

test('advance expect_rev (version CAS): a stale rev REFUSED (version-changed), matching commits', () => {
  const dir = freshDir();
  const e = store.enqueue({ repo: 'octo/w', issue_ref: 8 }, { dir });
  assert.strictEqual(store.get({ entry_id: e.entry_id }, { dir }).rev, 1, 'one accepted event -> rev 1');

  const stale = store.advance({ entry_id: e.entry_id, to_state: 'solving', expect_rev: 0 }, { dir });
  assert.strictEqual(stale.reason, 'version-changed', 'a decision made against an OLD rev is refused');
  assert.strictEqual(store.get({ entry_id: e.entry_id }, { dir }).state, 'queued', 'no mutation on a version mismatch');

  assert.strictEqual(store.advance({ entry_id: e.entry_id, to_state: 'solving', expect_rev: -1 }, { dir }).reason, 'bad-input');
  assert.strictEqual(store.advance({ entry_id: e.entry_id, to_state: 'solving', expect_rev: 1 }, { dir }).ok, true, 'the matching rev commits');
});

test('CAS is MS-COLLISION-PROOF: a solving->disposed->queued->solving cycle at ONE ts cannot pass a stale rev', () => {
  const dir = freshDir();
  const eid = store.entryId('octo/w', 9);
  // 5 accepted events ALL sharing ts=100 (the ms-collision the ts-based CAS was vulnerable to). rev still
  // distinguishes the fresh solve (rev 5) from the stale snapshot (rev 2).
  const seq = [['queued', null], ['solving', 'queued'], ['disposed', 'solving'], ['queued', 'disposed'], ['solving', 'queued']];
  const evs = seq.map(([to, from]) => ({ entry_id: eid, repo: 'octo/w', issue_ref: 9, from_state: from, to_state: to, ts: 100, evidence: to === 'disposed' ? { reason: 'x' } : {} }));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${evs.map((x) => JSON.stringify(x)).join('\n')}\n`, { mode: 0o600 });
  const cur = store.get({ entry_id: eid }, { dir });
  assert.strictEqual(cur.state, 'solving');
  assert.strictEqual(cur.rev, 5, 'the fresh solve is rev 5 despite every event sharing ts=100');
  assert.strictEqual(cur.updated_at, 100, 'ts collides across the whole cycle');
  // A dispose decided against the STALE rev-2 snapshot is refused -> the fresh live solve is NOT reaped.
  const r = store.advance({ entry_id: eid, to_state: 'disposed', expect_state: 'solving', expect_rev: 2 }, { dir });
  assert.strictEqual(r.reason, 'version-changed', 'ms-collision does not let a stale snapshot through');
  assert.strictEqual(store.get({ entry_id: eid }, { dir }).state, 'solving', 'fresh solve preserved');
});

// ---- MED-2a: adding updated_at must NOT change claimNext ordering (LINE ORDER stays the sort key) ----
test('claimNext orders by LINE ORDER, not updated_at (a is MIDDLE-aged by ts yet claimed first)', () => {
  const dir = freshDir();
  const idA = store.entryId('octo/a', 1);
  const idB = store.entryId('octo/b', 2);
  const idC = store.entryId('octo/c', 3);
  // Line order A,B,C but ts order B(100) < A(200) < C(300): A is the MIDDLE by updated_at. If claimNext ever
  // sorted by ascending updated_at it would return B; FIFO by line order must return A. Crafted log so the
  // ts values are deterministic (and diverge from line order, which enqueue's live Date.now() cannot).
  const rows = [
    { entry_id: idA, repo: 'octo/a', issue_ref: 1, from_state: null, to_state: 'queued', ts: 200, evidence: {} },
    { entry_id: idB, repo: 'octo/b', issue_ref: 2, from_state: null, to_state: 'queued', ts: 100, evidence: {} },
    { entry_id: idC, repo: 'octo/c', issue_ref: 3, from_state: null, to_state: 'queued', ts: 300, evidence: {} },
  ];
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, { mode: 0o600 });
  for (const row of store.list({ state: 'queued' }, { dir })) assert.strictEqual(typeof row.updated_at, 'number', 'the staleness clock is exposed on list rows');
  assert.strictEqual(store.claimNext({ dir }).entry_id, idA, 'FIFO by line order, NOT ascending updated_at (which would pick B)');
});

try { fs.rmSync(STATE_BASE, { recursive: true, force: true }); } catch { /* best-effort */ }
assert.ok(passed >= 23, `anti-vacuity floor: expected >=23 checks, ran ${passed}`);
console.log(`${path.basename(__filename)}: ${passed} passed`);
