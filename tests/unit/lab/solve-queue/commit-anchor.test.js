#!/usr/bin/env node

// tests/unit/lab/solve-queue/commit-anchor.test.js
//
// TDD SPEC for the commit-level world-anchoring detector. Locks the real-case finding that motivated it:
// a maintainer can carry our commits into THEIR PR, so our PR reads `merged:false` while the work IS in
// upstream main - and one of the landed commits may be ADAPTED, so patch-identity must not gate.
// READ-ONLY, TOTAL, SHADOW, advisory. Run as `node <file>`.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE_BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-anchor-'));
process.env.LOOM_LAB_STATE_DIR = STATE_BASE;   // module-load capture: set BEFORE requiring lab modules

const REPO = path.join(__dirname, '..', '..', '..', '..');
const { detectCommitAnchoring, normalizedPatchHash } = require(path.join(REPO, 'packages', 'lab', 'solve-queue', 'commit-anchor.js'));
const { assertReadOnlyGhArgs } = require(path.join(REPO, 'packages', 'lab', 'world-anchor', 'gh-verify.js'));

let passed = 0;
const pending = [];
function test(name, fn) {
  pending.push(Promise.resolve().then(fn)
    .then(() => { passed += 1; })
    .catch((e) => { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); process.exitCode = 1; }));
}

const SLUG = 'octo/widget';
const OURS_A = 'a'.repeat(40);
const OURS_B = 'b'.repeat(40);
const LANDED_A = 'c'.repeat(40);
const LANDED_B = 'd'.repeat(40);
const EMAIL = 'dev@users.noreply.github.com';
// A commit fixture as the module's own jq projects it: subject + files[{filename,patch}].
const FILES = (body, subject = 'refactor: a change', file = 'src/x.py') => ({
  subject, files: [{ filename: file, patch: `@@ -1,3 +1,3 @@\n-old\n+${body}\n` }],
});

// A dispatching runner double over the endpoints the module uses. `reach` maps sha -> ahead_by.
function runnerFor({ headAhead = 2, ourCommits, candidates, reach = {}, patches = {}, throwOn, prCreated = '2026-07-13T00:00:00Z', baseRef = 'main', defaultBranch = 'main', reachByBase = null } = {}) {
  const calls = [];
  const fn = async (args) => {
    calls.push(args);
    const p = args[3] || '';
    if (throwOn && p.includes(throwOn)) { const e = new Error('gh boom'); e.stderr = 'boom'; throw e; }
    if (/\/pulls\/\d+\/commits/.test(p)) return { stdout: JSON.stringify(ourCommits) };
    if (/\/pulls\/\d+$/.test(p)) return { stdout: JSON.stringify({ head_sha: OURS_B, created_at: prCreated, base_ref: baseRef, default_branch: defaultBranch }) };
    if (p.includes('/compare/')) {
      const sha = p.split('...')[1];
      if (reachByBase) {                       // base-aware: prove we compare against the DEFAULT branch
        const base = decodeURIComponent(p.split('/compare/')[1].split('...')[0]);
        const m = (reachByBase[base] || {});
        return { stdout: JSON.stringify({ status: m[sha] === 0 ? 'behind' : 'diverged', ahead_by: m[sha] === 0 ? 0 : 1 }) };
      }
      const ahead = sha === OURS_B ? headAhead : (Object.prototype.hasOwnProperty.call(reach, sha) ? reach[sha] : 1);
      return { stdout: JSON.stringify({ status: ahead === 0 ? 'behind' : 'diverged', ahead_by: ahead }) };
    }
    if (/\/commits\?author=/.test(p)) return { stdout: JSON.stringify(candidates) };
    if (/\/commits\/[0-9a-f]+/.test(p)) {
      const sha = p.split('/commits/')[1];
      return { stdout: JSON.stringify(patches[sha] || FILES('unknown')) };
    }
    return { stdout: '{}' };
  };
  return { calls, fn };
}
const ourTwo = [{ sha: OURS_A, email: EMAIL }, { sha: OURS_B, email: EMAIL }];

// ---- PATH A: the ordinary merge / fast-forward ----

test('PATH A: a head already contained in the base is anchored/exact in ONE compare', async () => {
  const r = runnerFor({ headAhead: 0 });
  const res = await detectCommitAnchoring({ repo: SLUG, pr_number: 7, runner: r.fn });
  assert.strictEqual(res.anchored, true);
  assert.strictEqual(res.strength, 'exact');
  assert.strictEqual(res.via, 'head-contained');
  assert.strictEqual(r.calls.filter((a) => (a[3] || '').includes('/compare/')).length, 1, 'no PATH-B scan spent');
});

// ---- PATH B: THE REAL CASE (spec-kitty#2611) ----

test('THE REAL CASE: PR reads not-merged, commits landed under NEW shas, one ADAPTED -> anchored/adapted', async () => {
  // Our two commits landed rebased: A patch-identical, B modified by the maintainer in flight.
  const patches = {
    // patch-exact pair (survived the rebase byte-for-byte)
    [OURS_A]: FILES('same', 'refactor: route sites'), [LANDED_A]: FILES('same', 'refactor: route sites'),
    // ADAPTED in flight: same subject + same file, but the maintainer changed the content
    [OURS_B]: FILES('ours', 'refactor: add the gate'), [LANDED_B]: FILES('adapted', 'refactor: add the gate'),
  };
  const r = runnerFor({
    headAhead: 2,                                   // our head DIVERGED - a head-sha check would miss this
    ourCommits: ourTwo,
    candidates: [{ sha: LANDED_A }, { sha: LANDED_B }],
    reach: { [LANDED_A]: 0, [LANDED_B]: 0 },
    patches,
  });
  const res = await detectCommitAnchoring({ repo: SLUG, pr_number: 2611, runner: r.fn });
  assert.strictEqual(res.anchored, true, 'the work landed even though the PR did not merge');
  assert.strictEqual(res.strength, 'adapted', 'NOT exact: one commit was modified while landing');
  assert.strictEqual(res.via, 'attributed-reachable');
  assert.deepStrictEqual(res.landed.map((l) => l.patch_exact), [true, false], 'per-commit strength is reported');
  assert.strictEqual(res.our_commit_count, 2);
});

test('all landed commits patch-exact -> strength is exact', async () => {
  const patches = { [OURS_A]: FILES('s1', 'feat: one'), [LANDED_A]: FILES('s1', 'feat: one'),
                    [OURS_B]: FILES('s2', 'feat: two'), [LANDED_B]: FILES('s2', 'feat: two') };
  const r = runnerFor({ ourCommits: ourTwo, candidates: [{ sha: LANDED_A }, { sha: LANDED_B }], reach: { [LANDED_A]: 0, [LANDED_B]: 0 }, patches });
  const res = await detectCommitAnchoring({ repo: SLUG, pr_number: 9, runner: r.fn });
  assert.strictEqual(res.strength, 'exact');
});

// ---- reachability is THE trust basis ----

test('an ATTRIBUTED but UNREACHABLE candidate is EXCLUDED (never trust the list endpoint alone)', async () => {
  const r = runnerFor({
    ourCommits: ourTwo,
    candidates: [{ sha: LANDED_A }],
    reach: { [LANDED_A]: 3 },                        // attributed to us, but NOT contained in the base
    patches: { [OURS_A]: FILES('x', 'feat: one'), [OURS_B]: FILES('y', 'feat: two'), [LANDED_A]: FILES('x', 'feat: one') },
  });
  const res = await detectCommitAnchoring({ repo: SLUG, pr_number: 11, runner: r.fn });
  assert.strictEqual(res.anchored, false, 'patch-identical is NOT enough without reachability');
  assert.strictEqual(res.reason, 'no-linked-commits');
});

test('CONTROL-CAUGHT: an unrelated commit by the SAME author does NOT count as anchoring', async () => {
  // The defect a live control exposed: "attributed + reachable" alone meant "this person has committed
  // since", which fired anchored with 104 unrelated release chores. A candidate must LINK to one of ours.
  const r = runnerFor({
    ourCommits: ourTwo,
    candidates: [{ sha: LANDED_A }],
    reach: { [LANDED_A]: 0 },                        // reachable AND attributed to us...
    patches: {
      [OURS_A]: FILES('x', 'feat: our thing', 'src/ours.py'),
      [OURS_B]: FILES('y', 'feat: our other', 'src/ours2.py'),
      [LANDED_A]: FILES('z', 'chore(release): bump version', 'pyproject.toml'),   // ...but unrelated work
    },
  });
  const res = await detectCommitAnchoring({ repo: SLUG, pr_number: 20, runner: r.fn });
  assert.strictEqual(res.anchored, false, 'author attribution alone must NEVER imply anchoring');
  assert.strictEqual(res.reason, 'no-linked-commits');
});

test('the honest negative: no attributed commits at all -> anchored:false', async () => {
  const r = runnerFor({ ourCommits: ourTwo, candidates: [] });
  const res = await detectCommitAnchoring({ repo: SLUG, pr_number: 12, runner: r.fn });
  assert.strictEqual(res.anchored, false);
  assert.strictEqual(res.reason, 'no-attributed-commits');
});

// ---- the probed mechanism facts ----

test('the candidate scan uses the author EMAIL form (the login form was probed to return ZERO)', async () => {
  const r = runnerFor({ ourCommits: ourTwo, candidates: [] });
  await detectCommitAnchoring({ repo: SLUG, pr_number: 13, runner: r.fn });
  const scan = r.calls.map((a) => a[3] || '').find((p) => p.includes('/commits?author='));
  assert.ok(scan, 'a candidate scan happened');
  assert.ok(scan.includes(encodeURIComponent(EMAIL)), `must query by EMAIL, got: ${scan}`);
  assert.ok(scan.includes('since='), 'bounded by the PR creation time');
});

test('normalization survives hunk-header drift but NOT a real content change', async () => {
  const a = normalizedPatchHash([{ filename: 'f.py', patch: '@@ -1,3 +1,3 @@\n-old\n+new\n' }]);
  const shifted = normalizedPatchHash([{ filename: 'f.py', patch: '@@ -820,3 +911,3 @@\n-old\n+new\n' }]);
  const changed = normalizedPatchHash([{ filename: 'f.py', patch: '@@ -1,3 +1,3 @@\n-old\n+different\n' }]);
  assert.strictEqual(a, shifted, 'a rebase shifts line numbers; the change is the same');
  assert.notStrictEqual(a, changed, 'a real content change MUST change the hash');
});

test('a full candidate page is reported as truncated, never silent absence', async () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ sha: String(i).repeat(40).slice(0, 40) }));
  const r = runnerFor({ ourCommits: ourTwo, candidates: many, reach: {} });   // none reachable
  const res = await detectCommitAnchoring({ repo: SLUG, pr_number: 14, runner: r.fn, maxCandidates: 5 });
  assert.strictEqual(res.anchored, false);
  assert.strictEqual(res.reason, 'candidates-truncated', 'absence from a truncated list is NOT proven');
});

// ---- read-only + totality ----

test('every built arg passes the read-only gate; a mutated write verb is REFUSED (non-vacuous)', async () => {
  const r = runnerFor({ headAhead: 0 });
  await detectCommitAnchoring({ repo: SLUG, pr_number: 15, runner: r.fn });
  assert.ok(r.calls.length > 0);
  for (const args of r.calls) {
    assert.doesNotThrow(() => assertReadOnlyGhArgs(args), `args must be read-only: ${args.join(' ')}`);
    assert.strictEqual(args[1], '-X');
    assert.strictEqual(args[2], 'GET');
  }
  assert.throws(() => assertReadOnlyGhArgs(['api', '-X', 'POST', 'repos/o/r']), /only -X GET/i, 'the gate CAN fail');
});

test('TOTAL: bad inputs and hostile runner output are classified, never thrown', async () => {
  for (const bad of [{ repo: 'not-a-slug', pr_number: 1 }, { repo: SLUG, pr_number: 0 }, { repo: SLUG, pr_number: 'x' }, {}]) {
    const res = await detectCommitAnchoring({ ...bad, runner: runnerFor({}).fn });
    assert.strictEqual(res.ok, false, JSON.stringify(bad));
    assert.strictEqual(res.anchored, false);
  }
  const thrower = await detectCommitAnchoring({ repo: SLUG, pr_number: 16, runner: runnerFor({ throwOn: '/pulls/' }).fn });
  assert.strictEqual(thrower.ok, false);
  assert.strictEqual(thrower.anchored, false);

  const junk = await detectCommitAnchoring({ repo: SLUG, pr_number: 17, runner: async () => ({ stdout: 'not json' }) });
  assert.strictEqual(junk.ok, false);
  assert.strictEqual(junk.reason, 'bad-json');

  let threw = false;
  try { await detectCommitAnchoring({ repo: SLUG, pr_number: 18, runner: async () => ({ stdout: JSON.stringify(null) }) }); }
  catch { threw = true; }
  assert.strictEqual(threw, false, 'a null body must never throw');
});

test('a rate-limited scan is classified as such (not a silent not-anchored)', async () => {
  const r = { fn: async () => { const e = new Error('HTTP 429'); e.stderr = 'gh: API rate limit exceeded'; throw e; } };
  const res = await detectCommitAnchoring({ repo: SLUG, pr_number: 19, runner: r.fn });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'rate-limited', 'a rate limit must not read as "no evidence"');
});


// ---- CodeRabbit folds ----

test('CR Major: reachability is checked against the repo DEFAULT branch, not the PR base ref', async () => {
  // A PR targeting `release` may be reachable from `release` while ABSENT from `main`. Anchoring on the
  // base ref would claim a landing on a branch the trust argument never covered.
  const r = runnerFor({
    baseRef: 'release', defaultBranch: 'main',
    ourCommits: ourTwo,
    candidates: [{ sha: LANDED_A }],
    reachByBase: { release: { [LANDED_A]: 0, [OURS_B]: 1 }, main: { [LANDED_A]: 1, [OURS_B]: 1 } },
    patches: { [OURS_A]: FILES('x', 'feat: one'), [OURS_B]: FILES('y', 'feat: two'), [LANDED_A]: FILES('x', 'feat: one') },
  });
  const res = await detectCommitAnchoring({ repo: SLUG, pr_number: 21, runner: r.fn });
  assert.strictEqual(res.anchored, false, 'reachable only from `release` must NOT read as anchored');
  const bases = r.calls.map((a) => a[3] || '').filter((x) => x.includes('/compare/')).map((x) => decodeURIComponent(x.split('/compare/')[1].split('...')[0]));
  assert.ok(bases.every((b) => b === 'main'), `every compare must use the default branch, got ${JSON.stringify(bases)}`);
});

test('CR Major: a BINARY / patch-less file can never produce patch_exact', async () => {
  // The API omits `patch` for binary + too-large files. Two unrelated binary commits would both hash an
  // EMPTY body and claim exactness. They must fall back to the weaker link, never `exact`.
  const bin = (subject) => ({ subject, files: [{ filename: 'img.png' }] });   // no `patch` key at all
  const r = runnerFor({
    ourCommits: ourTwo,
    candidates: [{ sha: LANDED_A }],
    reach: { [LANDED_A]: 0 },
    patches: { [OURS_A]: bin('chore: add asset'), [OURS_B]: FILES('y', 'feat: two'), [LANDED_A]: bin('chore: add asset') },
  });
  const res = await detectCommitAnchoring({ repo: SLUG, pr_number: 22, runner: r.fn });
  assert.strictEqual(res.anchored, true, 'the subject+file link still holds');
  assert.strictEqual(res.landed[0].patch_exact, false, 'two empty bodies must NEVER be called patch-exact');
  assert.strictEqual(res.strength, 'adapted');
});

test('CR Major: a removed line whose content starts with `--` is NOT eaten by the header filter', async () => {
  // `-` (removal) + `--count;` renders as `---count;`. A bare prefix filter drops it, so two commits that
  // differ ONLY in such lines would hash identically.
  const withDecr = normalizedPatchHash([{ filename: 'a.c', patch: '@@ -1,2 +1,2 @@\n---count;\n+++count;\n' }]);
  const withOther = normalizedPatchHash([{ filename: 'a.c', patch: '@@ -1,2 +1,2 @@\n---other;\n+++other;\n' }]);
  assert.notStrictEqual(withDecr, withOther, 'content lines beginning with --/++ must survive normalization');
  // ...while a REAL unified-diff file header is still stripped.
  const a = normalizedPatchHash([{ filename: 'a.c', patch: '--- a/a.c\n+++ b/a.c\n@@ -1,1 +1,1 @@\n-x\n+y\n' }]);
  const b = normalizedPatchHash([{ filename: 'a.c', patch: '@@ -9,1 +9,1 @@\n-x\n+y\n' }]);
  assert.strictEqual(a, b, 'real file headers are structurally stripped');
});

Promise.all(pending).then(() => {
  try { fs.rmSync(STATE_BASE, { recursive: true, force: true }); } catch { /* best-effort */ }
  assert.ok(passed >= 15, `anti-vacuity floor: expected >=11, ran ${passed}`);
  process.stdout.write(`${path.basename(__filename)}: ${passed} passed\n`);
});
