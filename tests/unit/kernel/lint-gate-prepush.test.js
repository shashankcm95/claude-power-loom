#!/usr/bin/env node

// tests/unit/kernel/lint-gate-prepush.test.js
//
// TDD red-first for the git-native pre-push lint gate
// (packages/kernel/validators/lint-gate-prepush.js; plan
// 2026-05..2026-07-03-lint-gate-prepush-hook.md §10, git-native pivot).
//
// The pure decision core is the behavioral spec. The two headline VERIFY
// findings both live here and are pinned by this suite:
//   - CR-1 (CRITICAL): a git range/merge-base ERROR must full-lint, NEVER
//     collapse to an empty changed-set = silent APPROVE. Distinguish
//     "diff succeeded, 0 files" (skip) from "diff errored" (full).
//   - H-A (HIGH): in a multi-ref push, each file is bound to ITS OWN ref's
//     sha — never a unioned file-list against one surviving loop-sha.
//
// The pure fns take an INJECTED `git` (diffNames / mergeBase that return
// arrays or throw), so the CR-1 error path and the H-A binding are unit
// testable without a real repo. The live all-zeros / missing-object shas
// are covered by the separate bare-remote integration test (Rule-2a
// corollary: a mock cannot produce those).

'use strict';

const assert = require('assert');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const {
  parseRefLine,
  classifyRef,
  decideLintScope,
  planLint,
  filterExisting,
  extractFrontmatter,
  ZERO_RE,
} = require(path.join(REPO_ROOT, 'packages/kernel/validators/lint-gate-prepush.js'));

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write(`  PASS ${name}\n`); passed++; } catch (e) { process.stdout.write(`  FAIL ${name}: ${e.message}\n`); failed++; }
}

const ZERO40 = '0'.repeat(40);
const ZERO64 = '0'.repeat(64);
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);

// A git stub: diffNames/mergeBase return canned arrays keyed by the sha pair,
// or throw when the key is registered as an error (models a missing object).
function makeGit({ diffs = {}, mergeBases = {}, errors = new Set() } = {}) {
  return {
    diffNames(from, to) {
      const key = `${from}..${to}`;
      if (errors.has(key)) throw new Error(`fatal: bad object ${from}`);
      return diffs[key] || [];
    },
    mergeBase(sha, ref) {
      const key = `mb:${sha}:${ref}`;
      if (errors.has(key)) throw new Error(`fatal: no merge base for ${sha}`);
      return mergeBases[key];
    },
  };
}

// ---- parseRefLine ----------------------------------------------------------

test('parseRefLine: a well-formed line parses into 4 fields', () => {
  const p = parseRefLine(`refs/heads/main ${A} refs/heads/main ${B}`);
  assert.deepStrictEqual(p, { localRef: 'refs/heads/main', localSha: A, remoteRef: 'refs/heads/main', remoteSha: B });
});

test('parseRefLine: collapses irregular inter-field whitespace', () => {
  const p = parseRefLine(`  refs/heads/x   ${A}   refs/heads/x   ${B}  `);
  assert.ok(p && p.localSha === A && p.remoteSha === B);
});

test('parseRefLine: a short (<4 field) line is malformed -> null', () => {
  assert.strictEqual(parseRefLine(`refs/heads/x ${A} ${B}`), null);
  assert.strictEqual(parseRefLine(''), null);
  assert.strictEqual(parseRefLine('   '), null);
});

test('parseRefLine: a line with MORE than 4 fields is malformed -> null (CodeRabbit F6)', () => {
  assert.strictEqual(parseRefLine(`refs/heads/x ${A} refs/heads/x ${B} extra`), null);
});

test('extractFrontmatter: tolerates CRLF line endings (CodeRabbit F7)', () => {
  const crlf = '---\r\nname: x\r\nkind: y\r\n---\r\nbody\r\n';
  assert.strictEqual(extractFrontmatter(crlf), 'name: x\nkind: y');
  assert.strictEqual(extractFrontmatter('no frontmatter here'), null);
});

// ---- classifyRef -----------------------------------------------------------

test('classifyRef: local-sha all-zeros = a delete -> skip', () => {
  const c = classifyRef({ localRef: 'refs/heads/gone', localSha: ZERO40, remoteRef: 'refs/heads/gone', remoteSha: A }, { mainRef: 'main' });
  assert.strictEqual(c.kind, 'skip');
  assert.strictEqual(c.reason, 'delete');
});

test('classifyRef: a tag push -> skip (no lint scope), even when new', () => {
  const c = classifyRef({ localRef: 'refs/tags/v1.0', localSha: A, remoteRef: 'refs/tags/v1.0', remoteSha: ZERO40 }, { mainRef: 'main' });
  assert.strictEqual(c.kind, 'skip');
  assert.strictEqual(c.reason, 'tag');
});

test('classifyRef: remote-sha all-zeros = a new branch -> new-branch', () => {
  const c = classifyRef({ localRef: 'refs/heads/feat', localSha: A, remoteRef: 'refs/heads/feat', remoteSha: ZERO40 }, { mainRef: 'main' });
  assert.strictEqual(c.kind, 'new-branch');
  assert.strictEqual(c.localSha, A);
});

test('classifyRef: sha256 all-zeros (64 hex) is also recognized as new-branch', () => {
  const c = classifyRef({ localRef: 'refs/heads/feat', localSha: A, remoteRef: 'refs/heads/feat', remoteSha: ZERO64 }, { mainRef: 'main' });
  assert.strictEqual(c.kind, 'new-branch');
});

test('classifyRef: an ordinary update -> range (remote..local)', () => {
  const c = classifyRef({ localRef: 'refs/heads/main', localSha: B, remoteRef: 'refs/heads/main', remoteSha: A }, { mainRef: 'main' });
  assert.strictEqual(c.kind, 'range');
  assert.strictEqual(c.remoteSha, A);
  assert.strictEqual(c.localSha, B);
});

test('ZERO_RE matches any all-zeros sha length and nothing else', () => {
  assert.ok(ZERO_RE.test(ZERO40));
  assert.ok(ZERO_RE.test(ZERO64));
  assert.ok(!ZERO_RE.test(A));
  assert.ok(!ZERO_RE.test('0'.repeat(39) + '1'));
});

// ---- decideLintScope: the CR-1 + H-A core ---------------------------------

test('decideLintScope: a single range -> scoped, files tagged with the local sha', () => {
  const git = makeGit({ diffs: { [`${A}..${B}`]: ['packages/x.js', 'docs/y.md'] } });
  const r = decideLintScope({ stdinText: `refs/heads/main ${B} refs/heads/main ${A}`, git, mainRef: 'main' });
  assert.strictEqual(r.mode, 'scoped');
  assert.deepStrictEqual(r.files, [
    { path: 'packages/x.js', sha: B },
    { path: 'docs/y.md', sha: B },
  ]);
});

test('decideLintScope: a new branch diffs against merge-base(local, main)', () => {
  const git = makeGit({
    mergeBases: { [`mb:${B}:main`]: A },
    diffs: { [`${A}..${B}`]: ['new.js'] },
  });
  const r = decideLintScope({ stdinText: `refs/heads/feat ${B} refs/heads/feat ${ZERO40}`, git, mainRef: 'main' });
  assert.strictEqual(r.mode, 'scoped');
  assert.deepStrictEqual(r.files, [{ path: 'new.js', sha: B }]);
});

test('CR-1: a diff that ERRORS -> full mode (never empty-approve), error recorded', () => {
  const git = makeGit({ errors: new Set([`${A}..${B}`]) });
  const r = decideLintScope({ stdinText: `refs/heads/main ${B} refs/heads/main ${A}`, git, mainRef: 'main' });
  assert.strictEqual(r.mode, 'full');
  assert.ok(r.errors.length >= 1, 'the range error must be surfaced');
  assert.deepStrictEqual(r.files, [], 'full mode carries no per-file list');
});

test('CR-1: a genuinely-empty diff (success, 0 files) -> skip, NOT full', () => {
  const git = makeGit({ diffs: { [`${A}..${B}`]: [] } });
  const r = decideLintScope({ stdinText: `refs/heads/main ${B} refs/heads/main ${A}`, git, mainRef: 'main' });
  assert.strictEqual(r.mode, 'skip');
  assert.strictEqual(r.errors.length, 0);
});

test('CR-1: a new-branch merge-base that ERRORS -> full (the no-merge-base floor)', () => {
  const git = makeGit({ errors: new Set([`mb:${B}:main`]) });
  const r = decideLintScope({ stdinText: `refs/heads/feat ${B} refs/heads/feat ${ZERO40}`, git, mainRef: 'main' });
  assert.strictEqual(r.mode, 'full');
});

test('H-A: a multi-ref push binds each file to its OWN ref sha (no scramble)', () => {
  const git = makeGit({
    diffs: {
      [`${A}..${B}`]: ['fromB.js'],
      [`${A}..${C}`]: ['fromC.js'],
    },
  });
  const stdin = [
    `refs/heads/one ${B} refs/heads/one ${A}`,
    `refs/heads/two ${C} refs/heads/two ${A}`,
  ].join('\n');
  const r = decideLintScope({ stdinText: stdin, git, mainRef: 'main' });
  assert.strictEqual(r.mode, 'scoped');
  const byPath = Object.fromEntries(r.files.map((f) => [f.path, f.sha]));
  assert.strictEqual(byPath['fromB.js'], B, 'fromB.js must carry ref-two? no -- its OWN ref sha B');
  assert.strictEqual(byPath['fromC.js'], C, 'fromC.js must carry its OWN ref sha C');
});

test('H-A: the SAME path in two refs keeps BOTH (path,sha) bindings distinct', () => {
  const git = makeGit({
    diffs: {
      [`${A}..${B}`]: ['shared.js'],
      [`${A}..${C}`]: ['shared.js'],
    },
  });
  const stdin = [
    `refs/heads/one ${B} refs/heads/one ${A}`,
    `refs/heads/two ${C} refs/heads/two ${A}`,
  ].join('\n');
  const r = decideLintScope({ stdinText: stdin, git, mainRef: 'main' });
  const shas = r.files.filter((f) => f.path === 'shared.js').map((f) => f.sha).sort();
  assert.deepStrictEqual(shas, [B, C].sort(), 'both ref shas retained -- binding not scrambled to one');
});

test('decideLintScope: one good range + one erroring range -> full (any error wins)', () => {
  const git = makeGit({
    diffs: { [`${A}..${B}`]: ['ok.js'] },
    errors: new Set([`${A}..${C}`]),
  });
  const stdin = [
    `refs/heads/one ${B} refs/heads/one ${A}`,
    `refs/heads/two ${C} refs/heads/two ${A}`,
  ].join('\n');
  const r = decideLintScope({ stdinText: stdin, git, mainRef: 'main' });
  assert.strictEqual(r.mode, 'full');
});

test('decideLintScope: deletes and tags only -> skip mode (nothing to lint)', () => {
  const stdin = [
    `refs/heads/gone ${ZERO40} refs/heads/gone ${A}`,
    `refs/tags/v2 ${B} refs/tags/v2 ${ZERO40}`,
  ].join('\n');
  const r = decideLintScope({ stdinText: stdin, git: makeGit(), mainRef: 'main' });
  assert.strictEqual(r.mode, 'skip');
  assert.strictEqual(r.skipped.length, 2);
});

test('decideLintScope: a malformed ref-line -> full (fail-toward-running, cannot scope)', () => {
  const r = decideLintScope({ stdinText: `refs/heads/x ${A} garbage`, git: makeGit(), mainRef: 'main' });
  assert.strictEqual(r.mode, 'full');
  assert.ok(r.errors.some((e) => /malformed/i.test(e)));
});

test('decideLintScope: blank stdin (no refs) -> skip', () => {
  const r = decideLintScope({ stdinText: '\n  \n', git: makeGit(), mainRef: 'main' });
  assert.strictEqual(r.mode, 'skip');
});

// ---- planLint --------------------------------------------------------------

test('planLint: .js -> eslint; .md -> markdownlint + yaml; others ignored (M-A residual)', () => {
  const plan = planLint([
    { path: 'a.js', sha: A }, { path: 'b.md', sha: A },
    { path: 'c.sh', sha: A }, { path: 'd.json', sha: A }, { path: 'e.ts', sha: A },
  ]);
  assert.deepStrictEqual(plan.eslint, ['a.js']);
  assert.deepStrictEqual(plan.markdownlint, ['b.md']);
  assert.deepStrictEqual(plan.yaml, ['b.md']);
});

test('planLint: dedups repeated paths within a tool group', () => {
  const plan = planLint([{ path: 'a.js', sha: A }, { path: 'a.js', sha: B }]);
  assert.deepStrictEqual(plan.eslint, ['a.js']);
});

test('planLint: an empty file set -> empty groups', () => {
  const plan = planLint([]);
  assert.deepStrictEqual(plan, { eslint: [], markdownlint: [], yaml: [] });
});

// ---- filterExisting: the pure-delete false-block fix (hacker MEDIUM) --------

test('filterExisting: drops a changed path that no longer exists in the working tree', () => {
  const files = [{ path: 'kept.js', sha: A }, { path: 'deleted.js', sha: A }];
  const existsFn = (p) => p.endsWith('kept.js'); // deleted.js absent
  const kept = filterExisting(files, '/repo', existsFn);
  assert.deepStrictEqual(kept, [{ path: 'kept.js', sha: A }]);
});

test('filterExisting: a pure-delete commit (all paths gone) -> empty (no false-block)', () => {
  const files = [{ path: 'gone-a.js', sha: A }, { path: 'gone-b.md', sha: A }];
  const kept = filterExisting(files, '/repo', () => false);
  assert.deepStrictEqual(kept, []);
});

test('filterExisting: joins path against the repo root when probing existence', () => {
  const seen = [];
  filterExisting([{ path: 'sub/x.js', sha: A }], '/repo', (p) => { seen.push(p); return true; });
  assert.strictEqual(seen[0], path.join('/repo', 'sub/x.js'));
});

process.stdout.write(`\nlint-gate-prepush: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
