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

try { fs.rmSync(STATE_BASE, { recursive: true, force: true }); } catch { /* best-effort */ }
assert.ok(passed >= 16, `anti-vacuity floor: expected >=16 checks, ran ${passed}`);
console.log(`${path.basename(__filename)}: ${passed} passed`);
