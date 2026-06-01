#!/usr/bin/env node

'use strict';

// tests/unit/kernel/_lib/integrate-merge.test.js
//
// PR-P3a — the DORMANT integration merge primitives the P3c ordered integrator
// will consume. integrate-merge.js exports three stateless, git-seam-injected
// primitives that stack a candidate delta onto loom/integration WITHOUT touching
// any working tree:
//   mergeTreeWriteTree({mergeBase, ours, theirs, runGit}) -> {ok, conflict, tree, conflictPaths}
//   commitMergedTree({tree, parents, message, runGit})    -> {ok, commit}
//   casAdvanceRef({ref, newOid, oldOid, runGit})          -> {ok, created|reason}
//
// WHY A REAL-GIT HARNESS: out-of-tree 3-way merge (`merge-tree --write-tree`),
// the 2-parent merge commit (`commit-tree`), and the old-oid CAS (`update-ref`)
// are git-plumbing behaviors only real git exercises — the P3 design spike
// (/tmp/p3-git-spike.sh) proved the shapes; this pins them as an executable
// contract. Ships DORMANT — only this test imports the module (P3a: no
// production importer; P3c is the first live caller).
//
// Skips cleanly (not a failure) where git is unavailable.
// House test pattern: imperative assert + hand-rolled runner + exit code.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { runGitDefault } = require('../../../../packages/kernel/_lib/invoke-git');

// The module under test ships DORMANT — only THIS test imports it (P3a).
const im = require('../../../../packages/kernel/_lib/integrate-merge');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
}

function gitAvailable() {
  try { execFileSync('git', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] }); return true; }
  catch { return false; }
}

const GIT_SHA_RE = /^[a-f0-9]{40}$|^[a-f0-9]{64}$/;

// ── real-git harness ─────────────────────────────────────────────────────────
// Build a hermetic repo: a base commit, then branches that each fork from base —
// two that add DISTINCT files (clean merge) and two that edit the SAME line
// (conflict). Returns {repo, runGit, base, addA, addB, editY, editX} or null.
function setupMergeRepo() {
  if (!gitAvailable()) return null;
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-im-'));
  const repo = path.join(baseDir, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  const g = (args) => execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
  g(['init', '-q']);
  g(['config', 'user.email', 'loom-im@example.invalid']);
  g(['config', 'user.name', 'loom-im']);
  g(['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(repo, 'f.txt'), 'a\nb\nc\n');
  g(['add', '-A']); g(['commit', '-qm', 'base']);
  const base = g(['rev-parse', 'HEAD']);

  // addA: base + a.txt (distinct file)
  g(['checkout', '-q', '-b', 'addA', base]);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'A\n');
  g(['add', '-A']); g(['commit', '-qm', 'add a.txt']);
  const addA = g(['rev-parse', 'HEAD']);

  // addB: base + b.txt (distinct file → merges cleanly with addA)
  g(['checkout', '-q', '-b', 'addB', base]);
  fs.writeFileSync(path.join(repo, 'b.txt'), 'B\n');
  g(['add', '-A']); g(['commit', '-qm', 'add b.txt']);
  const addB = g(['rev-parse', 'HEAD']);

  // editY: base + f.txt line2 -> Y
  g(['checkout', '-q', '-b', 'editY', base]);
  fs.writeFileSync(path.join(repo, 'f.txt'), 'a\nY\nc\n');
  g(['add', '-A']); g(['commit', '-qm', 'edit line2 Y']);
  const editY = g(['rev-parse', 'HEAD']);

  // editX: base + f.txt line2 -> X (conflicts with editY)
  g(['checkout', '-q', '-b', 'editX', base]);
  fs.writeFileSync(path.join(repo, 'f.txt'), 'a\nX\nc\n');
  g(['add', '-A']); g(['commit', '-qm', 'edit line2 X']);
  const editX = g(['rev-parse', 'HEAD']);

  g(['checkout', '-q', base]); // detach off the branches so refs are mutable
  return { baseDir, repo, runGit: (args) => runGitDefault(repo, args), g, base, addA, addB, editY, editX };
}

function withRepo(fn) {
  const h = setupMergeRepo();
  if (!h) { process.stdout.write('  SKIP (git unavailable)\n'); return; }
  try { fn(h); } finally { fs.rmSync(h.baseDir, { recursive: true, force: true }); }
}

// ── mergeTreeWriteTree ───────────────────────────────────────────────────────

test('mergeTreeWriteTree: CLEAN 3-way merge returns {ok,conflict:false,tree}; tree carries both deltas', () => {
  withRepo((h) => {
    const r = im.mergeTreeWriteTree({ mergeBase: h.base, ours: h.addA, theirs: h.addB, runGit: h.runGit });
    assert.strictEqual(r.ok, true, 'clean merge ok');
    assert.strictEqual(r.conflict, false, 'no conflict');
    assert.ok(GIT_SHA_RE.test(r.tree), `tree is a sha, got ${r.tree}`);
    // the merged tree must list BOTH a.txt and b.txt (proves a real 3-way union)
    const names = h.g(['ls-tree', '--name-only', r.tree]).split('\n');
    assert.ok(names.includes('a.txt') && names.includes('b.txt'), `merged tree has both files, got ${names}`);
  });
});

test('mergeTreeWriteTree: CONFLICT returns {ok:true,conflict:true,conflictPaths:[f.txt]}', () => {
  withRepo((h) => {
    const r = im.mergeTreeWriteTree({ mergeBase: h.base, ours: h.editY, theirs: h.editX, runGit: h.runGit });
    assert.strictEqual(r.ok, true, 'a detected conflict is ok:true (ran successfully, reported conflict) — NOT a git error');
    assert.strictEqual(r.conflict, true, 'conflict flagged');
    assert.ok(Array.isArray(r.conflictPaths) && r.conflictPaths.includes('f.txt'),
      `conflictPaths names f.txt, got ${JSON.stringify(r.conflictPaths)}`);
  });
});

test('mergeTreeWriteTree: a bad object id is a git ERROR ({ok:false}), distinct from a conflict', () => {
  withRepo((h) => {
    const r = im.mergeTreeWriteTree({ mergeBase: h.base, ours: h.addA, theirs: 'deadbeef'.repeat(5), runGit: h.runGit });
    assert.strictEqual(r.ok, false, 'a bad sha is an error, not a conflict');
    assert.strictEqual(r.conflict, false, 'error path is not flagged as a conflict');
  });
});

test('mergeTreeWriteTree: throws without a runGit seam', () => {
  assert.throws(() => im.mergeTreeWriteTree({ mergeBase: 'x', ours: 'y', theirs: 'z' }), /runGit/);
});

// ── commitMergedTree ─────────────────────────────────────────────────────────

test('commitMergedTree: builds a 2-parent merge commit from a merged tree', () => {
  withRepo((h) => {
    const merged = im.mergeTreeWriteTree({ mergeBase: h.base, ours: h.addA, theirs: h.addB, runGit: h.runGit });
    const c = im.commitMergedTree({ tree: merged.tree, parents: [h.addA, h.addB], message: 'loom integ', runGit: h.runGit });
    assert.strictEqual(c.ok, true, 'commit ok');
    assert.ok(GIT_SHA_RE.test(c.commit), `commit is a sha, got ${c.commit}`);
    const parents = h.g(['rev-list', '--parents', '-n', '1', c.commit]).split(/\s+/).filter(Boolean);
    assert.strictEqual(parents.length, 3, `1 commit + 2 distinct parents, got ${parents.length}: ${parents}`);
  });
});

test('commitMergedTree: rejects a non-sha tree (fail-fast)', () => {
  withRepo((h) => {
    assert.throws(() => im.commitMergedTree({ tree: 'not-a-tree', parents: [h.base], message: 'x', runGit: h.runGit }), /tree/);
  });
});

// ── casAdvanceRef ────────────────────────────────────────────────────────────

test('casAdvanceRef: CREATE form (oldOid null) succeeds on an absent ref, fails if it already exists', () => {
  withRepo((h) => {
    const ref = 'refs/loom/integration';
    const created = im.casAdvanceRef({ ref, newOid: h.addA, oldOid: null, runGit: h.runGit });
    assert.strictEqual(created.ok, true, 'create on absent ref ok');
    assert.strictEqual(created.created, true, 'flagged as a create');
    assert.strictEqual(h.g(['rev-parse', ref]), h.addA, 'ref points at the new oid');
    // a second create (ref now exists) must FAIL — the "" oldvalue means "must not exist"
    const again = im.casAdvanceRef({ ref, newOid: h.addB, oldOid: null, runGit: h.runGit });
    assert.strictEqual(again.ok, false, 'create on an existing ref fails (atomic)');
    assert.strictEqual(h.g(['rev-parse', ref]), h.addA, 'ref unchanged after a failed create');
  });
});

test('casAdvanceRef: UPDATE with the correct oldOid advances; a STALE oldOid fails atomically', () => {
  withRepo((h) => {
    const ref = 'refs/loom/integration';
    im.casAdvanceRef({ ref, newOid: h.addA, oldOid: null, runGit: h.runGit }); // create at addA
    const ok = im.casAdvanceRef({ ref, newOid: h.addB, oldOid: h.addA, runGit: h.runGit });
    assert.strictEqual(ok.ok, true, 'correct old-oid advances');
    assert.strictEqual(h.g(['rev-parse', ref]), h.addB, 'ref advanced to addB');
    // a racing loser: oldOid is now stale (ref moved to addB)
    const stale = im.casAdvanceRef({ ref, newOid: h.editY, oldOid: h.addA, runGit: h.runGit });
    assert.strictEqual(stale.ok, false, 'stale old-oid rejected (the sibling-concurrency backstop)');
    assert.strictEqual(stale.reason, 'cas-failed', 'a CAS loss is labeled, not thrown');
    assert.strictEqual(h.g(['rev-parse', ref]), h.addB, 'ref unchanged after a lost CAS');
  });
});

test('casAdvanceRef: rejects a non-refs/ name and a non-sha newOid (fail-fast)', () => {
  withRepo((h) => {
    assert.throws(() => im.casAdvanceRef({ ref: 'loom/x', newOid: h.addA, oldOid: null, runGit: h.runGit }), /refs\//);
    assert.throws(() => im.casAdvanceRef({ ref: 'refs/loom/x', newOid: 'nope', oldOid: null, runGit: h.runGit }), /newOid/);
  });
});

test('casAdvanceRef: throws without a runGit seam', () => {
  assert.throws(() => im.casAdvanceRef({ ref: 'refs/loom/x', newOid: 'a'.repeat(40), oldOid: null }), /runGit/);
});

// ── hardening (code-reviewer Findings 1/2/4) ─────────────────────────────────

test('hardening F4: commitMergedTree rejects a 0-parent call (never a root commit)', () => {
  withRepo((h) => {
    const merged = im.mergeTreeWriteTree({ mergeBase: h.base, ours: h.addA, theirs: h.addB, runGit: h.runGit });
    assert.throws(() => im.commitMergedTree({ tree: merged.tree, parents: [], message: 'x', runGit: h.runGit }), /at least one parent/);
    assert.throws(() => im.commitMergedTree({ tree: merged.tree, message: 'x', runGit: h.runGit }), /at least one parent/);
  });
});

test('hardening F2: parseConflictPaths unquotes a git-quoted path (special-char filename)', () => {
  // A synthetic conflicted-file section line for a path git quoted (tab in name).
  const synthetic = 'abc123\n100644 ' + 'd'.repeat(40) + ' 1\t"a\\tb.txt"\n';
  const paths = im.parseConflictPaths(synthetic);
  assert.deepStrictEqual(paths, ['a\tb.txt'], `unquoted path, got ${JSON.stringify(paths)}`);
});

test('hardening F1: mergeTreeWriteTree treats an {ok:true} stub with no numeric code as CLEAN', () => {
  const sha = 'e'.repeat(40);
  const stubRunGit = () => ({ ok: true, stdout: sha + '\n' }); // no `code` field
  const r = im.mergeTreeWriteTree({ mergeBase: 'x', ours: 'y', theirs: 'z', runGit: stubRunGit });
  assert.strictEqual(r.ok, true, 'ok');
  assert.strictEqual(r.conflict, false, 'code-absent + ok:true reads CLEAN, not a spurious conflict');
  assert.strictEqual(r.tree, sha, 'tree extracted');
});

process.stdout.write(`\nintegrate-merge.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
