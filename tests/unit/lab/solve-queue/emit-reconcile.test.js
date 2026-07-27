#!/usr/bin/env node

// tests/unit/lab/solve-queue/emit-reconcile.test.js
//
// TDD SPEC for the emit reconciler: OBSERVE the operator-emitted PR and advance `drafted -> in_flight`.
// READ-ONLY gh, TOTAL, SHADOW. Locks the exact-set match (branch AND head-repo AND watermark), the
// constructed-not-copied pr_url, proven-vs-guessed absence, the CAS, and the rate-limit interlock.
//
// The REAL-RESPONSE fixture below is the load-bearing one: a mock authored from the same wrong jq projection
// as the impl would pass green while production matched nothing (the mock-vs-real gap). Run as `node <file>`.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE_BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-recon-'));
process.env.LOOM_LAB_STATE_DIR = STATE_BASE;   // module-load capture: set BEFORE requiring the lab modules

const REPO = path.join(__dirname, '..', '..', '..', '..');
const queue = require(path.join(REPO, 'packages', 'lab', 'solve-queue', 'solve-queue-store.js'));
const { reconcileDraftedEntries } = require(path.join(REPO, 'packages', 'lab', 'solve-queue', 'emit-reconcile.js'));
const { assertReadOnlyGhArgs } = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'gh-verify.js'));
const { parsePrUrl } = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'parse-pr-url.js'));

let passed = 0;
const pending = [];
function test(name, fn) {
  pending.push(Promise.resolve().then(fn)
    .then(() => { passed += 1; })
    .catch((e) => { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); process.exitCode = 1; }));
}

const SLUG = 'octo/widget';
const CPS = 'a'.repeat(64);
const DRAFTED_AT = Date.parse('2026-07-20T00:00:00.000Z');
const BRANCH = (ref, hash = '0123456789ab') => `loom/issue-${ref}-${hash}`;

// A drafted entry as `list()` returns it.
const drafted = (over = {}) => ({
  entry_id: 'e1', repo: SLUG, issue_ref: 7, state: 'drafted',
  evidence: { candidate_patch_sha: CPS }, updated_at: DRAFTED_AT, rev: 3, ...over,
});

// A gh row AS THE MODULE'S OWN JQ PROJECTS IT ({n, ref, head_repo, created}).
const row = (over = {}) => ({ n: 42, ref: BRANCH(7), head_repo: SLUG, created: '2026-07-21T00:00:00.000Z', ...over });

// A runner double: records args, returns canned page bodies (array of arrays, one per page).
function runnerFor(pages, { throwWith } = {}) {
  const calls = [];
  return {
    calls,
    fn: async (args) => {
      calls.push(args);
      if (throwWith) { const e = new Error('gh boom'); e.stderr = throwWith; throw e; }
      const p = pages.shift();
      return { stdout: JSON.stringify(p === undefined ? [] : p) };
    },
  };
}
function queueDouble(entries, { advanceFn, listThrows = false } = {}) {
  const calls = { advance: [] };
  return {
    calls,
    list() { if (listThrows) throw new Error('list boom'); return entries; },
    advance(input) { calls.advance.push(input); return advanceFn ? advanceFn(input) : { ok: true, entry_id: input.entry_id, state: input.to_state }; },
  };
}

// ---- the exact-set match ----

test('happy: a matching PR advances drafted -> in_flight with a CONSTRUCTED pr_url + CAS args', async () => {
  const q = queueDouble([drafted()]);
  const r = runnerFor([[row()]]);
  const res = await reconcileDraftedEntries({ queue: q, runner: r.fn });
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(res.reconciled.map((x) => x.entry_id), ['e1']);
  const a = q.calls.advance[0];
  assert.strictEqual(a.to_state, 'in_flight');
  assert.strictEqual(a.expect_state, 'drafted', 'state CAS');
  assert.strictEqual(a.expect_rev, 3, 'version CAS pins the snapshot rev');
  assert.strictEqual(a.evidence.pr_url, `https://github.com/${SLUG}/pull/42`, 'CONSTRUCTED, not the gh string');
  assert.strictEqual(a.evidence.pr_number, 42);
  // the constructed URL must satisfy the DOWNSTREAM contract (promoteOneInFlight parses it)
  const round = parsePrUrl(a.evidence.pr_url);
  assert.strictEqual(round.repo, SLUG);
  assert.strictEqual(round.pr_number, 42);
});

test('CRITICAL-2 provenance bind: a FORK head repo is refused (foreign-head-refused), never bound', async () => {
  const q = queueDouble([drafted()]);
  const r = runnerFor([[row({ head_repo: 'stranger/widget' })]]);
  const res = await reconcileDraftedEntries({ queue: q, runner: r.fn });
  assert.deepStrictEqual(res.reconciled, []);
  assert.strictEqual(res.skipped[0].reason, 'foreign-head-refused');
  assert.strictEqual(q.calls.advance.length, 0, 'a stranger PR can never capture the entry');
});

test('a null head_repo (deleted head fork) is a NON-match, not a crash', async () => {
  const q = queueDouble([drafted()]);
  const res = await reconcileDraftedEntries({ queue: q, runner: runnerFor([[row({ head_repo: null })]]).fn });
  assert.deepStrictEqual(res.reconciled, []);
  assert.strictEqual(q.calls.advance.length, 0);
});

test('branch discipline: a different issue_ref, a prefix near-miss, and a non-loom branch all fail to match', async () => {
  for (const ref of [BRANCH(8), BRANCH(70), 'loom/issue-7-XYZ', 'loom/issue-7-0123456789abc', 'feature/x']) {
    const q = queueDouble([drafted()]);
    const res = await reconcileDraftedEntries({ queue: q, runner: runnerFor([[row({ ref })]]).fn });
    assert.strictEqual(q.calls.advance.length, 0, `must not match ${ref}`);
    assert.ok(res.skipped.length === 1, `skipped for ${ref}`);
  }
});

test('HIGH-3: TWO matching PRs -> ambiguous-match refusal carrying the candidate NUMBERS, never a guess', async () => {
  const q = queueDouble([drafted()]);
  const r = runnerFor([[row({ n: 42 }), row({ n: 43, ref: BRANCH(7, 'beefbeefbeef') })]]);
  const res = await reconcileDraftedEntries({ queue: q, runner: r.fn });
  assert.deepStrictEqual(res.reconciled, []);
  assert.strictEqual(res.skipped[0].reason, 'ambiguous-match');
  assert.strictEqual(q.calls.advance.length, 0, 'never picks one');
});

// ---- absence: PROVEN vs merely unseen ----

test('HIGH-4: a row older than the watermark PROVES absence -> silent no-open-pr (and stops paging)', async () => {
  const q = queueDouble([drafted()]);
  // A FULL page (so short-page exhaustion cannot be what stops it) whose rows predate the watermark, PLUS a
  // second page that must never be fetched - this proves WATERMARK early-stop, not end-of-list.
  const page = Array.from({ length: 100 }, (_, i) => row({ n: 1000 + i, ref: `other/b${i}`, created: '2026-01-01T00:00:00.000Z' }));
  const r = runnerFor([page, page]);
  const res = await reconcileDraftedEntries({ queue: q, runner: r.fn });
  assert.strictEqual(res.skipped[0].reason, 'no-open-pr');
  assert.strictEqual(r.calls.length, 1, 'early-stopped on the watermark: the second page was never fetched');
});

test('HIGH-4: exhausting the page cap BEFORE the watermark is list-truncated (never silent absence)', async () => {
  const q = queueDouble([drafted()]);
  // every page full of recent non-matching rows => never crosses the watermark => truncated
  const full = () => Array.from({ length: 100 }, (_, i) => row({ n: 1000 + i, ref: `other/b${i}`, created: '2026-07-22T00:00:00.000Z' }));
  const r = runnerFor([full(), full(), full()]);
  const res = await reconcileDraftedEntries({ queue: q, runner: r.fn, maxPages: 3 });
  assert.strictEqual(res.skipped[0].reason, 'list-truncated');
  assert.strictEqual(r.calls.length, 3, 'bounded at maxPages, never unbounded');
});

test('C-1: a superseded PR from a PRIOR solve cycle cannot bind a fresh draft (watermark BOUNDARY)', async () => {
  // The 12-hex branch suffix is a SHAPE, not an identity (the queue carries no approval hash), so the
  // watermark is the ONLY thing separating this cycle's PR from a superseded one. Exercise the BOUNDARY,
  // not a comfortable 19-day gap: a PR opened 1 hour before this draft (i.e. during the previous cycle)
  // must NOT bind, or a forged (merge_sha, candidate_patch_sha) tuple reaches the world-anchored mint.
  const priorCycle = row({ created: new Date(DRAFTED_AT - 60 * 60 * 1000).toISOString() });
  const q = queueDouble([drafted()]);
  const res = await reconcileDraftedEntries({ queue: q, runner: runnerFor([[priorCycle]]).fn });
  assert.strictEqual(q.calls.advance.length, 0, 'a prior-cycle PR never binds to a fresh draft');
  assert.strictEqual(res.skipped[0].reason, 'no-open-pr');

  // ...and the legitimate case still works: a PR opened just AFTER the draft binds.
  const q2 = queueDouble([drafted()]);
  const after = row({ created: new Date(DRAFTED_AT + 60 * 1000).toISOString() });
  const ok = await reconcileDraftedEntries({ queue: q2, runner: runnerFor([[after]]).fn });
  assert.strictEqual(ok.reconciled.length, 1, 'this cycle\'s PR still binds (the gate is not vacuous)');
});

test('C-1: the default skew is TIGHT (clock drift only) - a days-old PR is outside it', async () => {
  const q = queueDouble([drafted()]);
  const twoDaysBefore = row({ created: new Date(DRAFTED_AT - 2 * 24 * 60 * 60 * 1000).toISOString() });
  const res = await reconcileDraftedEntries({ queue: q, runner: runnerFor([[twoDaysBefore]]).fn });
  assert.strictEqual(q.calls.advance.length, 0, 'a generous skew would re-open the provenance hole');
  assert.strictEqual(res.skipped[0].reason, 'no-open-pr');
});

test('H-1: two CASE-VARIANT entries cannot both bind the SAME PR (pr-already-claimed)', async () => {
  // entry_id = sha256({repo, issue_ref}) is case-SENSITIVE, so these are distinct entries that both
  // lowercase-match one PR; binding both would mint two nodes claiming different patches for one merge.
  const a = drafted({ entry_id: 'A', repo: 'Acme/Widget', evidence: { candidate_patch_sha: 'a'.repeat(64) } });
  const b = drafted({ entry_id: 'B', repo: 'acme/widget', evidence: { candidate_patch_sha: 'b'.repeat(64) } });
  const q = queueDouble([a, b]);
  const r = runnerFor([[row({ n: 42, head_repo: 'acme/widget' })]]);
  const res = await reconcileDraftedEntries({ queue: q, runner: r.fn });
  assert.strictEqual(r.calls.length, 1, 'one gh call (the group key is case-normalized)');
  assert.strictEqual(res.reconciled.length, 1, 'exactly ONE entry may claim the PR');
  assert.ok(res.skipped.some((s) => s.reason === 'pr-already-claimed'), 'the second is refused');
});

test('M-1: a case-folding homoglyph head_repo (U+212A KELVIN) is REFUSED, not folded into a match', async () => {
  const q = queueDouble([drafted({ repo: 'acme/kite' })]);
  // U+212A KELVIN SIGN folds to 'k', so this lowercases to exactly 'acme/kite' (escaped: ASCII source).
  const spoof = row({ ref: BRANCH(7), head_repo: 'ACME/\u212AITE' });
  assert.strictEqual(spoof.head_repo.toLowerCase(), 'acme/kite', 'the case-fold collision premise is real');
  const res = await reconcileDraftedEntries({ queue: q, runner: runnerFor([[spoof]]).fn });
  assert.strictEqual(q.calls.advance.length, 0, 'a non-ASCII vendor slug can never spoof the identity');
  assert.strictEqual(res.skipped[0].reason, 'foreign-head-refused');
});

test('CR-HIGH-1: a systemic gh failure still ACCOUNTS for every later repo (no entry vanishes)', async () => {
  const entries = ['one', 'two', 'three'].map((n, i) => drafted({ entry_id: `e${i}`, repo: `octo/${n}` }));
  const q = queueDouble(entries);
  const runner = async () => { throw new Error('gh boom'); };       // every repo fails, non-rate-limit
  const res = await reconcileDraftedEntries({ queue: q, runner });
  const accounted = res.reconciled.length + res.skipped.length + res.errors.length;
  assert.strictEqual(accounted, 3, `every entry lands in a bucket (got ${accounted})`);
  assert.strictEqual(res.rate_limited, false, 'a plain failure is not a rate limit');
});

// ---- gates ----

test('MED-2: an entry without a valid rev is skipped (no-rev) - the CAS is non-bypassable', async () => {
  const q = queueDouble([drafted({ rev: undefined })]);
  const res = await reconcileDraftedEntries({ queue: q, runner: runnerFor([[row()]]).fn });
  assert.strictEqual(res.skipped[0].reason, 'no-rev');
  assert.strictEqual(q.calls.advance.length, 0);
});

test('MED-3: an entry without candidate_patch_sha is REFUSED (no-join-key), not advanced to a dead end', async () => {
  const q = queueDouble([drafted({ evidence: {} })]);
  const res = await reconcileDraftedEntries({ queue: q, runner: runnerFor([[row()]]).fn });
  assert.strictEqual(res.skipped[0].reason, 'no-join-key');
  assert.strictEqual(q.calls.advance.length, 0, 'never manufactures an unpromotable in_flight');
});

test('CAS refusals (state-changed / version-changed) are benign SKIPS, not errors', async () => {
  for (const reason of ['state-changed', 'version-changed']) {
    const q = queueDouble([drafted()], { advanceFn: () => ({ ok: false, reason }) });
    const res = await reconcileDraftedEntries({ queue: q, runner: runnerFor([[row()]]).fn });
    assert.deepStrictEqual(res.errors, [], reason);
    assert.strictEqual(res.skipped[0].reason, reason);
  }
});

// ---- efficiency + isolation ----

test('ONE gh call per REPO serves every entry of that repo', async () => {
  const entries = [drafted({ entry_id: 'a', issue_ref: 7 }), drafted({ entry_id: 'b', issue_ref: 8 }), drafted({ entry_id: 'c', issue_ref: 9 })];
  const q = queueDouble(entries);
  const r = runnerFor([[row({ n: 42, ref: BRANCH(7) }), row({ n: 43, ref: BRANCH(8) }), row({ n: 44, ref: BRANCH(9) })]]);
  const res = await reconcileDraftedEntries({ queue: q, runner: r.fn });
  assert.strictEqual(r.calls.length, 1, 'one list call, not one per entry');
  assert.strictEqual(res.reconciled.length, 3);
});

test('a repo whose gh call fails does not stop the OTHER repo from reconciling', async () => {
  const entries = [drafted({ entry_id: 'a', repo: 'octo/one' }), drafted({ entry_id: 'b', repo: 'octo/two' })];
  const q = queueDouble(entries);
  let call = 0;
  // the second repo's row must carry ITS OWN head_repo - the provenance bind refuses a foreign one.
  const runner = async () => { call += 1; if (call === 1) throw new Error('gh boom'); return { stdout: JSON.stringify([row({ head_repo: 'octo/two' })]) }; };
  const res = await reconcileDraftedEntries({ queue: q, runner });
  assert.strictEqual(res.reconciled.length, 1, 'repo two still reconciled');
  assert.ok(res.skipped.some((s) => s.entry_id === 'a' && s.reason === 'gh-unverifiable'));
});

test('MED-1: a rate-limit signal sets rate_limited and stops spending gh calls', async () => {
  const entries = [drafted({ entry_id: 'a', repo: 'octo/one' }), drafted({ entry_id: 'b', repo: 'octo/two' })];
  const q = queueDouble(entries);
  const r = runnerFor([], { throwWith: 'gh: API rate limit exceeded' });
  const res = await reconcileDraftedEntries({ queue: q, runner: r.fn });
  assert.strictEqual(res.rate_limited, true);
  assert.strictEqual(r.calls.length, 1, 'stopped after the first rate-limited repo');
  assert.strictEqual(res.skipped.length, 2, 'BOTH entries accounted for, including the never-attempted repo');
  assert.ok(res.skipped.every((s) => s.reason === 'rate-limited'));
});

// ---- read-only + totality ----

test('MED-6: the args the module builds PASS the read-only gate; a mutated write verb is REFUSED (non-vacuous)', async () => {
  const q = queueDouble([drafted()]);
  const r = runnerFor([[row()]]);
  await reconcileDraftedEntries({ queue: q, runner: r.fn });
  const args = r.calls[0];
  assert.doesNotThrow(() => assertReadOnlyGhArgs(args), 'the real args are read-only');
  assert.strictEqual(args[1], '-X');
  assert.strictEqual(args[2], 'GET');
  // prove the gate CAN fail (a guard that never failed is theater)
  assert.throws(() => assertReadOnlyGhArgs(['api', '-X', 'POST', 'repos/o/r/pulls']), /only -X GET/i);
});

test('MED-5: a non-array gh body is refused (node-side backstop to the jq type guard)', async () => {
  const q = queueDouble([drafted()]);
  const res = await reconcileDraftedEntries({ queue: q, runner: async () => ({ stdout: '{"not":"an array"}' }) });
  assert.strictEqual(q.calls.advance.length, 0);
  assert.strictEqual(res.skipped[0].reason, 'gh-unverifiable');
});

test('TOTAL: throwing list / throwing advance / junk rows never throw', async () => {
  const a = await reconcileDraftedEntries({ queue: queueDouble([], { listThrows: true }), runner: runnerFor([[]]).fn });
  assert.strictEqual(a.ok, false);
  assert.strictEqual(a.reason, 'list-threw');

  const qThrow = queueDouble([drafted()], { advanceFn: () => { throw new Error('advance boom'); } });
  const b = await reconcileDraftedEntries({ queue: qThrow, runner: runnerFor([[row()]]).fn });
  assert.strictEqual(b.errors.length, 1);

  const c = await reconcileDraftedEntries({ queue: queueDouble([drafted()]), runner: runnerFor([[null, 'junk', 7, row()]]).fn });
  assert.strictEqual(c.reconciled.length, 1, 'junk rows skipped, the real one still matched');

  const d = await reconcileDraftedEntries({ queue: queueDouble('not-an-array'), runner: runnerFor([[]]).fn });
  assert.strictEqual(d.ok, true);
});

test('a bad pr number from gh is a classified skip, never an opaque advance bad-input', async () => {
  const q = queueDouble([drafted()]);
  const res = await reconcileDraftedEntries({ queue: q, runner: runnerFor([[row({ n: -5 })]]).fn });
  assert.strictEqual(q.calls.advance.length, 0);
  assert.strictEqual(res.skipped[0].reason, 'bad-pr-number');
});

// ---- CRITICAL-1: the REAL captured gh response (the mock-vs-real gap) ----

test('CRITICAL-1: the jq projection paths are correct against a REAL captured gh PR-list body', async () => {
  // A trimmed, secret-free capture of a genuine `gh api -X GET repos/O/R/pulls?...` element. The point is the
  // SHAPE: the branch lives at .head.ref (a top-level .ref does not exist) and .url is the API url while
  // .html_url is the web one. A fixture authored from a wrong projection would hide exactly that.
  const realElement = {
    url: 'https://api.github.com/repos/octo/widget/pulls/42',
    html_url: 'https://github.com/octo/widget/pull/42',
    number: 42,
    state: 'open',
    created_at: '2026-07-21T00:00:00.000Z',
    head: { ref: BRANCH(7), sha: 'f'.repeat(40), repo: { full_name: 'octo/widget' } },
    base: { ref: 'main', repo: { full_name: 'octo/widget' } },
  };
  assert.strictEqual(realElement.ref, undefined, 'a TOP-LEVEL .ref does not exist - the impl must read .head.ref');
  assert.ok(realElement.url.startsWith('https://api.github.com/'), '.url is the API url - must NOT be stored');
  assert.throws(() => parsePrUrl(realElement.url), /pr-url/i, 'storing .url would wedge promote forever');

  // Apply the module's OWN projection shape to the real element, then drive the sweep with it.
  const projected = { n: realElement.number, ref: realElement.head.ref, head_repo: realElement.head.repo.full_name, created: realElement.created_at };
  const q = queueDouble([drafted()]);
  const res = await reconcileDraftedEntries({ queue: q, runner: runnerFor([[projected]]).fn });
  assert.strictEqual(res.reconciled.length, 1, 'the real-shaped row matches');
  assert.strictEqual(q.calls.advance[0].evidence.pr_url, realElement.html_url, 'constructed == the real html_url');
});

// ---- real-store write-through (non-vacuity) ----

test('REAL store: a drafted entry genuinely reaches in_flight on disk with the join key intact', async () => {
  const dir = fs.mkdtempSync(path.join(STATE_BASE, 'q-'));
  const enq = queue.enqueue({ repo: SLUG, issue_ref: 7 }, { dir });
  queue.advance({ entry_id: enq.entry_id, to_state: 'solving' }, { dir });
  queue.advance({ entry_id: enq.entry_id, to_state: 'drafted', evidence: { candidate_patch_sha: CPS } }, { dir });
  const before = queue.get({ entry_id: enq.entry_id }, { dir });
  assert.strictEqual(before.state, 'drafted');

  const runner = async () => ({ stdout: JSON.stringify([{ n: 99, ref: BRANCH(7), head_repo: SLUG, created: new Date(before.updated_at + 1000).toISOString() }]) });
  const res = await reconcileDraftedEntries({ queueDir: dir, runner });
  assert.strictEqual(res.reconciled.length, 1, `expected a reconcile, got ${JSON.stringify(res.skipped)}`);
  const after = queue.get({ entry_id: enq.entry_id }, { dir });
  assert.strictEqual(after.state, 'in_flight');
  assert.strictEqual(after.evidence.pr_url, `https://github.com/${SLUG}/pull/99`);
  assert.strictEqual(after.evidence.pr_number, 99);
  assert.strictEqual(after.evidence.candidate_patch_sha, CPS, 'the Wave-B join key survives into in_flight');
});

// ---- the DOWNSTREAM contract (integration: reconcile -> promote) ----

test('INTEGRATION: a reconciled entry is consumable by promoteMergedEntries (pr_url is not merely well-formed)', async () => {
  // The reconciler's constructed pr_url must survive the ACTUAL downstream parse + repo-equality check, not
  // just our own round-trip assert. Nothing else in the suite exercises the real consumer.
  const { promoteMergedEntries } = require(path.join(REPO, 'packages', 'lab', 'solve-queue', 'merge-promote.js'));
  const b = fs.mkdtempSync(path.join(STATE_BASE, 'i-'));
  const dirs = { queueDir: path.join(b, 'q'), pendingDir: path.join(b, 'p'), anchorDir: path.join(b, 'a'), liveDir: path.join(b, 'l') };

  const enq = queue.enqueue({ repo: SLUG, issue_ref: 7 }, { dir: dirs.queueDir });
  queue.advance({ entry_id: enq.entry_id, to_state: 'solving' }, { dir: dirs.queueDir });
  queue.advance({ entry_id: enq.entry_id, to_state: 'drafted', evidence: { candidate_patch_sha: CPS } }, { dir: dirs.queueDir });
  const at = queue.get({ entry_id: enq.entry_id }, { dir: dirs.queueDir }).updated_at;

  const rec = await reconcileDraftedEntries({
    queueDir: dirs.queueDir,
    runner: async () => ({ stdout: JSON.stringify([{ n: 77, ref: BRANCH(7), head_repo: SLUG, created: new Date(at + 1000).toISOString() }]) }),
  });
  assert.strictEqual(rec.reconciled.length, 1, 'reconciled');

  // Drive the REAL consumer with a merged-PR gh double; it must NOT reject on bad-pr-url / repo-mismatch.
  const SHA40 = 'c0ffee'.repeat(6) + 'cafe';
  const gh = async (args) => {
    const s = args.join(' ');
    if (s.includes('/commits/')) return { stdout: 'diff --git a/x b/x\n+one\n' };
    if (s.includes('.user.login')) return { stdout: JSON.stringify({ author: 'octocat', merged_by: 'maintainer', merged_at: '2026-07-22T00:00:00.000Z', base_sha: 'b'.repeat(40), branch: 'x' }) };
    return { stdout: JSON.stringify({ merged: true, merge_commit_sha: SHA40, state: 'closed' }) };
  };
  const promoted = await promoteMergedEntries({ ...dirs, ghRunner: gh });
  const rejected = (promoted.skipped || []).filter((s) => s.entry_id === enq.entry_id && /bad-pr-url|repo-mismatch/.test(s.reason || ''));
  assert.deepStrictEqual(rejected, [], `the constructed pr_url must satisfy the real consumer (${JSON.stringify(promoted.skipped)})`);
  assert.strictEqual(queue.get({ entry_id: enq.entry_id }, { dir: dirs.queueDir }).state !== 'in_flight', true, 'the entry advanced past in_flight');
});

Promise.all(pending).then(() => {
  try { fs.rmSync(STATE_BASE, { recursive: true, force: true }); } catch { /* best-effort */ }
  assert.ok(passed >= 25, `anti-vacuity floor: expected >=18, ran ${passed}`);
  process.stdout.write(`${path.basename(__filename)}: ${passed} passed\n`);
});
