#!/usr/bin/env node

// tests/unit/lab/solve-queue/dispose-closed.test.js
//
// TDD SPEC for GAP-2 closed-unmerged disposal. The load-bearing case is the ANCHOR VETO: a closed-unmerged
// PR whose work LANDED anyway (a maintainer carried the commits into their own PR) must NEVER be disposed
// as a rejection - that would poison the only signal that hardens trust. Run as `node <file>`.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE_BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-gap2-'));
process.env.LOOM_LAB_STATE_DIR = STATE_BASE;   // module-load capture: BEFORE requiring lab modules

const REPO = path.join(__dirname, '..', '..', '..', '..');
const queue = require(path.join(REPO, 'packages', 'lab', 'solve-queue', 'solve-queue-store.js'));
const { disposeClosedUnmerged } = require(path.join(REPO, 'packages', 'lab', 'solve-queue', 'dispose-closed.js'));
const { assertReadOnlyGhArgs } = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'gh-verify.js'));

let passed = 0;
const pending = [];
function test(name, fn) {
  pending.push(Promise.resolve().then(fn)
    .then(() => { passed += 1; })
    .catch((e) => { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); process.exitCode = 1; }));
}

const SLUG = 'octo/widget';
const CPS = 'a'.repeat(64);
const entry = (over = {}) => ({
  entry_id: 'e1', repo: SLUG, issue_ref: 7, state: 'in_flight', rev: 4,
  evidence: { candidate_patch_sha: CPS, pr_url: `https://github.com/${SLUG}/pull/42`, pr_number: 42 }, ...over,
});
function runnerFor({ merged = false, state = 'closed', throwWith } = {}) {
  const calls = [];
  return { calls, fn: async (args) => { calls.push(args); if (throwWith) { const e = new Error('x'); e.stderr = throwWith; throw e; } return { stdout: JSON.stringify({ merged, state }) }; } };
}
function queueDouble(entries, { advanceFn, listThrows = false } = {}) {
  const calls = { advance: [] };
  return {
    calls,
    list() { if (listThrows) throw new Error('list boom'); return entries; },
    advance(input) { calls.advance.push(input); return advanceFn ? advanceFn(input) : { ok: true }; },
  };
}
const notAnchored = async () => ({ ok: true, anchored: false });
const isAnchored = async () => ({ ok: true, anchored: true, strength: 'adapted', landed: [{ sha: 'x' }] });

// ---- THE ANCHOR VETO (the reason this was unsafe before the detector) ----

test('VETO: a closed-unmerged PR whose work LANDED is NEVER disposed', async () => {
  const q = queueDouble([entry()]);
  const r = await disposeClosedUnmerged({ queue: q, runner: runnerFor({}).fn, anchorFn: isAnchored });
  assert.strictEqual(q.calls.advance.length, 0, 'a real world-anchor must never be recorded as a rejection');
  assert.deepStrictEqual(r.disposed, []);
  assert.deepStrictEqual(r.anchored.map((a) => a.entry_id), ['e1']);
  assert.strictEqual(r.anchored[0].strength, 'adapted');
});

test('FAIL-SAFE: an UNREADABLE anchor verdict is NOT treated as "not anchored"', async () => {
  const q = queueDouble([entry()]);
  const r = await disposeClosedUnmerged({ queue: q, runner: runnerFor({}).fn, anchorFn: async () => ({ ok: false, reason: 'rate-limited' }) });
  assert.strictEqual(q.calls.advance.length, 0, 'no verdict must never become a rejection');
  assert.strictEqual(r.skipped[0].reason, 'anchor-unverifiable');
});

test('a throwing anchorFn lands in errors and never disposes', async () => {
  const q = queueDouble([entry()]);
  const r = await disposeClosedUnmerged({ queue: q, runner: runnerFor({}).fn, anchorFn: async () => { throw new Error('boom'); } });
  assert.strictEqual(q.calls.advance.length, 0);
  assert.strictEqual(r.errors.length, 1);
});

// ---- the disposal itself ----

test('a genuinely rejected PR (closed, unmerged, NOT anchored) is disposed with a CAS + reason', async () => {
  const q = queueDouble([entry()]);
  const r = await disposeClosedUnmerged({ queue: q, runner: runnerFor({}).fn, anchorFn: notAnchored });
  assert.deepStrictEqual(r.disposed.map((d) => d.entry_id), ['e1']);
  const a = q.calls.advance[0];
  assert.strictEqual(a.to_state, 'disposed');
  assert.strictEqual(a.expect_state, 'in_flight', 'state CAS');
  assert.strictEqual(a.expect_rev, 4, 'version CAS');
  assert.strictEqual(a.evidence.reason, 'closed-unmerged');
});

test('a MERGED pr is left to PASS 2 (state:closed alone must never imply rejection)', async () => {
  const q = queueDouble([entry()]);
  const r = await disposeClosedUnmerged({ queue: q, runner: runnerFor({ merged: true, state: 'closed' }).fn, anchorFn: notAnchored });
  assert.strictEqual(q.calls.advance.length, 0);
  assert.strictEqual(r.skipped[0].reason, 'merged');
});

test('a STILL-OPEN pr is skipped benignly (the common case, no alert-worthy event)', async () => {
  const q = queueDouble([entry()]);
  const r = await disposeClosedUnmerged({ queue: q, runner: runnerFor({ merged: false, state: 'open' }).fn, anchorFn: notAnchored });
  assert.strictEqual(q.calls.advance.length, 0);
  assert.strictEqual(r.skipped[0].reason, 'still-open');
});

test('the CAS is non-bypassable: a rev-less entry is skipped, never disposed', async () => {
  const q = queueDouble([entry({ rev: undefined })]);
  const r = await disposeClosedUnmerged({ queue: q, runner: runnerFor({}).fn, anchorFn: notAnchored });
  assert.strictEqual(q.calls.advance.length, 0);
  assert.strictEqual(r.skipped[0].reason, 'no-rev');
});

test('CAS refusals are benign skips, not errors', async () => {
  for (const reason of ['state-changed', 'version-changed']) {
    const q = queueDouble([entry()], { advanceFn: () => ({ ok: false, reason }) });
    const r = await disposeClosedUnmerged({ queue: q, runner: runnerFor({}).fn, anchorFn: notAnchored });
    assert.deepStrictEqual(r.errors, [], reason);
    assert.strictEqual(r.skipped[0].reason, reason);
  }
});

// ---- boundary + totality ----

test('a mismatched repo / bad url / missing url are classified, never disposed', async () => {
  for (const [ev, want] of [
    [{ pr_url: 'https://github.com/other/repo/pull/1' }, 'repo-mismatch'],
    [{ pr_url: 'not-a-url' }, 'bad-pr-url'],
    [{}, 'missing-pr-url'],
  ]) {
    const q = queueDouble([entry({ evidence: ev })]);
    const r = await disposeClosedUnmerged({ queue: q, runner: runnerFor({}).fn, anchorFn: notAnchored });
    assert.strictEqual(q.calls.advance.length, 0, want);
    assert.strictEqual(r.skipped[0].reason, want);
  }
});

test('a non-boolean merged / bad state is refused (mirrors gh-verify strictness), never disposed', async () => {
  for (const body of [{ merged: 'true', state: 'closed' }, { merged: false, state: 'weird' }, null, 'junk']) {
    const q = queueDouble([entry()]);
    const runner = async () => ({ stdout: JSON.stringify(body) });
    const r = await disposeClosedUnmerged({ queue: q, runner, anchorFn: notAnchored });
    assert.strictEqual(q.calls.advance.length, 0, JSON.stringify(body));
    assert.ok(r.skipped.length === 1);
  }
});

test('read-only: built args pass the gate, and the gate CAN fail (non-vacuous)', async () => {
  const r = runnerFor({});
  await disposeClosedUnmerged({ queue: queueDouble([entry()]), runner: r.fn, anchorFn: notAnchored });
  assert.ok(r.calls.length > 0);
  for (const args of r.calls) {
    assert.doesNotThrow(() => assertReadOnlyGhArgs(args));
    assert.strictEqual(args[2], 'GET');
  }
  assert.throws(() => assertReadOnlyGhArgs(['api', '-X', 'DELETE', 'repos/o/r']), /only -X GET/i);
});

test('a rate limit stops the sweep and is surfaced, never a silent not-anchored', async () => {
  const q = queueDouble([entry({ entry_id: 'a' }), entry({ entry_id: 'b' })]);
  const r = await disposeClosedUnmerged({ queue: q, runner: runnerFor({ throwWith: 'gh: API rate limit exceeded' }).fn, anchorFn: notAnchored });
  assert.strictEqual(r.rate_limited, true);
  assert.strictEqual(q.calls.advance.length, 0);
  assert.strictEqual(r.skipped.length, 2, 'both entries accounted for');
});

test('TOTAL: a throwing list / non-array / junk entries never throw', async () => {
  const a = await disposeClosedUnmerged({ queue: queueDouble([], { listThrows: true }), runner: runnerFor({}).fn, anchorFn: notAnchored });
  assert.strictEqual(a.ok, false);
  assert.strictEqual(a.reason, 'list-threw');
  const b = await disposeClosedUnmerged({ queue: queueDouble('nope'), runner: runnerFor({}).fn, anchorFn: notAnchored });
  assert.strictEqual(b.ok, true);
  const c = await disposeClosedUnmerged({ queue: queueDouble([null, 7, entry()]), runner: runnerFor({}).fn, anchorFn: notAnchored });
  assert.strictEqual(c.disposed.length, 1, 'junk skipped, the real entry still handled');
});

// ---- real-store write-through (non-vacuity) ----

test('REAL store: a rejected entry genuinely reaches `disposed` on disk and is re-openable', async () => {
  const dir = fs.mkdtempSync(path.join(STATE_BASE, 'q-'));
  const e = queue.enqueue({ repo: SLUG, issue_ref: 7 }, { dir });
  queue.advance({ entry_id: e.entry_id, to_state: 'solving' }, { dir });
  queue.advance({ entry_id: e.entry_id, to_state: 'drafted', evidence: { candidate_patch_sha: CPS } }, { dir });
  queue.advance({ entry_id: e.entry_id, to_state: 'in_flight', evidence: { pr_url: `https://github.com/${SLUG}/pull/42`, pr_number: 42 } }, { dir });

  const r = await disposeClosedUnmerged({ queueDir: dir, runner: runnerFor({}).fn, anchorFn: notAnchored });
  assert.strictEqual(r.disposed.length, 1, JSON.stringify(r.skipped));
  const after = queue.get({ entry_id: e.entry_id }, { dir });
  assert.strictEqual(after.state, 'disposed');
  assert.strictEqual(after.evidence.reason, 'closed-unmerged');
  assert.strictEqual(queue.enqueue({ repo: SLUG, issue_ref: 7 }, { dir }).state, 'queued', 'disposed stays re-openable');
});

Promise.all(pending).then(() => {
  try { fs.rmSync(STATE_BASE, { recursive: true, force: true }); } catch { /* best-effort */ }
  assert.ok(passed >= 14, `anti-vacuity floor: expected >=14, ran ${passed}`);
  process.stdout.write(`${path.basename(__filename)}: ${passed} passed\n`);
});
