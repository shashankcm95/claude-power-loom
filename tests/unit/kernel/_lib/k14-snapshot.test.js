#!/usr/bin/env node

// tests/unit/kernel/_lib/k14-snapshot.test.js
//
// K14 leaf: snapshot + content-hash (v3.0-alpha, PR-4a). TDD Phase 1 — RED until
// packages/kernel/_lib/k14-snapshot.js exists.
//
// CONTRACT (ADR-0011 §K14-split, ADR-0010 §Key-mechanics):
//   snapshotTree(root) -> { <relpath>: { sha256, size, mtimeMs, kind } }
//     * every visited path goes through K7 checkWithinRoot (CWE-22) — a symlink
//       resolving OUTSIDE root is recorded kind:'symlink-escape' with sha256:null
//       (NOT hashed in-scope; that read is delegated to the symlink-guard leaf).
//     * three snapshot sub-strategies, all transport 'snapshot': small-file
//       content-hash, mtime+content-hash, large-file (>1MB) hash-only.
//   diffSnapshots(pre, post) -> [{ path, sha256_pre, sha256_post, changed }]
//     * the pure compare used by the orchestrator to find changed files.
//
// DAG: this leaf MUST NOT import the orchestrator k14-write-scope (no back-edge).
//
// House test pattern: imperative assert + hand-rolled runner + exit code; tmp dir.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let snap;
try { snap = require('../../../../packages/kernel/_lib/k14-snapshot'); }
catch (_e) { snap = null; }

// theo-HIGH-1 Option A: snapshotTree no longer imports its sibling symlink-guard;
// the classifier is INJECTED. The orchestrator passes classifyPath in production;
// the test imports it directly to exercise the same real K7-delegating classify.
let classify;
try { ({ classifyPath: classify } = require('../../../../packages/kernel/_lib/k14-symlink-guard')); }
catch (_e) { classify = null; }

const LIB_DIR = path.join(__dirname, '..', '..', '..', '..', 'packages', 'kernel', '_lib');
const ONE_MB = 1024 * 1024;

let passed = 0;
let failed = 0;
function test(name, fn) {
  const base = path.join(os.tmpdir(), 'k14-snap-' + Math.random().toString(36).slice(2));
  fs.mkdirSync(base, { recursive: true });
  try { fn(base); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
  finally { try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* best-effort */ } }
}

// ── presence (RED until impl) ────────────────────────────────────────────────

test('module exports snapshotTree + diffSnapshots', () => {
  assert.ok(snap, 'packages/kernel/_lib/k14-snapshot.js must exist (absent → RED)');
  assert.strictEqual(typeof snap.snapshotTree, 'function');
  assert.strictEqual(typeof snap.diffSnapshots, 'function');
  assert.strictEqual(typeof classify, 'function', 'symlink-guard classifyPath available for injection');
});

// ── fail-closed: a missing classifier yields an empty snapshot (no un-vetted hash)

test('fail-closed: snapshotTree with NO classifier returns empty (never hashes un-vetted bytes in-scope)', (base) => {
  assert.ok(snap, 'impl absent');
  const root = path.join(base, 'wt'); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'a.txt'), 'hello');
  // No classifier → the CWE-22 gate is absent → fail closed to empty, NOT a hash.
  assert.deepStrictEqual(snap.snapshotTree(root), {}, 'absent classifier → empty snapshot (belt-and-suspenders)');
  assert.deepStrictEqual(snap.snapshotTree(root, null), {}, 'null classifier → empty snapshot');
});

// ── content-hash strategy (small file) ───────────────────────────────────────

test('content-hash: snapshotTree records a sha256 + size for an in-scope small file', (base) => {
  assert.ok(snap, 'impl absent');
  const root = path.join(base, 'wt'); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'a.txt'), 'hello');
  const tree = snap.snapshotTree(root, classify);
  const entry = tree['a.txt'] || Object.values(tree).find((e) => e && e.size === 5);
  assert.ok(entry, 'small file must be in the snapshot');
  assert.match(entry.sha256, /^[a-f0-9]{64}$/, 'sha256 is 64-hex');
  assert.strictEqual(entry.size, 5);
});

// ── mtime+content-hash strategy ──────────────────────────────────────────────

test('mtime+content-hash: snapshot carries mtimeMs alongside the content hash', (base) => {
  assert.ok(snap, 'impl absent');
  const root = path.join(base, 'wt'); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'b.txt'), 'v0');
  const tree = snap.snapshotTree(root, classify);
  const entry = tree['b.txt'] || Object.values(tree)[0];
  assert.ok(entry && typeof entry.mtimeMs === 'number', 'mtimeMs recorded for the mtime fast-path');
});

// ── large-file hash-only strategy (>1MB) ─────────────────────────────────────

test('large-file: a >1MB file is hashed (hash-only strategy), size recorded', (base) => {
  assert.ok(snap, 'impl absent');
  const root = path.join(base, 'wt'); fs.mkdirSync(root);
  const big = path.join(root, 'big.bin');
  fs.writeFileSync(big, Buffer.alloc(ONE_MB + 100, 7));
  const tree = snap.snapshotTree(root, classify);
  const entry = tree['big.bin'] || Object.values(tree).find((e) => e && e.size > ONE_MB);
  assert.ok(entry, 'large file present in snapshot');
  assert.match(entry.sha256, /^[a-f0-9]{64}$/, 'large file still produces a content hash');
  assert.ok(entry.size > ONE_MB, 'size reflects the >1MB file');
});

// ── CWE-22: symlink-escape recorded kind, NOT hashed in-scope ────────────────

test('CWE-22: a symlink inside root resolving OUTSIDE is kind=symlink-escape with sha256=null (not hashed)', (base) => {
  assert.ok(snap, 'impl absent');
  const root = path.join(base, 'wt'); fs.mkdirSync(root);
  const outside = path.join(base, 'outside'); fs.mkdirSync(outside);
  const target = path.join(outside, 'target.txt');
  fs.writeFileSync(target, 'MUST-NOT-BE-HASHED-IN-SCOPE');
  fs.symlinkSync(target, path.join(root, 'escape-link'));

  const tree = snap.snapshotTree(root, classify);
  const entry = tree['escape-link'] || Object.values(tree).find((e) => e && e.kind === 'symlink-escape');
  assert.ok(entry, 'the escaping symlink must appear in the snapshot');
  assert.strictEqual(entry.kind, 'symlink-escape', 'kind flags the escape');
  assert.strictEqual(entry.sha256, null, 'escaping symlink target is NEVER hashed in-scope (fail-closed)');
});

// ── diffSnapshots: pure compare ──────────────────────────────────────────────

test('diffSnapshots: a changed in-scope file shows differing pre/post hashes', () => {
  assert.ok(snap, 'impl absent');
  const pre = { 'a.txt': { sha256: 'a'.repeat(64), size: 1, mtimeMs: 1, kind: 'file' } };
  const post = { 'a.txt': { sha256: 'b'.repeat(64), size: 2, mtimeMs: 2, kind: 'file' } };
  const diff = snap.diffSnapshots(pre, post);
  const d = diff.find((x) => x.path === 'a.txt');
  assert.ok(d, 'changed file appears in the diff');
  assert.strictEqual(d.changed, true);
  assert.strictEqual(d.sha256_pre, 'a'.repeat(64));
  assert.strictEqual(d.sha256_post, 'b'.repeat(64));
});

test('diffSnapshots: an unchanged file is NOT reported as changed', () => {
  assert.ok(snap, 'impl absent');
  const same = { 'a.txt': { sha256: 'a'.repeat(64), size: 1, mtimeMs: 1, kind: 'file' } };
  const diff = snap.diffSnapshots(same, same);
  const changedOnes = diff.filter((x) => x.changed);
  assert.strictEqual(changedOnes.length, 0, 'identical pre/post → no changed entries');
});

test('diffSnapshots: a newly-appeared file (absent pre, present post) is reported changed with null pre-hash', () => {
  assert.ok(snap, 'impl absent');
  const pre = {};
  const post = { 'new.txt': { sha256: 'c'.repeat(64), size: 3, mtimeMs: 3, kind: 'file' } };
  const diff = snap.diffSnapshots(pre, post);
  const d = diff.find((x) => x.path === 'new.txt');
  assert.ok(d && d.changed === true, 'newly created file is a change');
  assert.strictEqual(d.sha256_pre, null, 'no pre-state → null pre-hash');
  assert.strictEqual(d.sha256_post, 'c'.repeat(64));
});

// ── immutability ─────────────────────────────────────────────────────────────

test('immutability: diffSnapshots does not mutate its pre/post inputs', () => {
  assert.ok(snap, 'impl absent');
  const pre = { 'a.txt': { sha256: 'a'.repeat(64), size: 1, mtimeMs: 1, kind: 'file' } };
  const post = { 'a.txt': { sha256: 'b'.repeat(64), size: 2, mtimeMs: 2, kind: 'file' } };
  const preCopy = JSON.stringify(pre);
  const postCopy = JSON.stringify(post);
  snap.diffSnapshots(pre, post);
  assert.strictEqual(JSON.stringify(pre), preCopy, 'pre snapshot untouched');
  assert.strictEqual(JSON.stringify(post), postCopy, 'post snapshot untouched');
});

// ── DAG: pure star — no back-edge to the orchestrator AND no sibling-leaf edge ─
// theo-HIGH-1: the prior test asserted ONLY the no-back-edge-to-orchestrator
// case, leaving a leaf-to-leaf cycle blind spot (a future symlink-guard ->
// snapshot edge would close a real cycle yet pass every existing DAG test). Under
// Option A the classifier is injected, so this leaf imports NEITHER sibling.

test('DAG: k14-snapshot does NOT import k14-write-scope (no back-edge to orchestrator)', () => {
  const src = fs.readFileSync(path.join(LIB_DIR, 'k14-snapshot.js'), 'utf8');
  assert.ok(!/require\(['"]\.\/k14-write-scope['"]\)/.test(src),
    'leaf must not import the orchestrator (orchestration -> leaves only)');
});

test('DAG: k14-snapshot does NOT import its sibling leaves (pure star — no leaf-to-leaf edge)', () => {
  const src = fs.readFileSync(path.join(LIB_DIR, 'k14-snapshot.js'), 'utf8');
  assert.ok(!/require\(['"]\.\/k14-symlink-guard['"]\)/.test(src),
    'Option A: snapshot must NOT import symlink-guard (classifier is injected by the orchestrator)');
  assert.ok(!/require\(['"]\.\/k14-tail-window['"]\)/.test(src),
    'snapshot must not import the tail-window sibling');
});

process.stdout.write(`\nk14-snapshot.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
