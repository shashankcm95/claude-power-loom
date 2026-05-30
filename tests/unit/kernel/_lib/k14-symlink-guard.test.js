#!/usr/bin/env node

// tests/unit/kernel/_lib/k14-symlink-guard.test.js
//
// K14 leaf: symlink / TOCTOU guard (v3.0-alpha, PR-4a). TDD Phase 1 — RED until
// packages/kernel/_lib/k14-symlink-guard.js exists.
//
// THE LOAD-BEARING SECURITY CONTRACT (ADR-0011 §K14-split, ADR-0010 §mechanics):
//   classifyPath(candidatePath, worktreeRoot) -> { kind, sha256, escaped }
//     * delegates to K7 checkWithinRoot — a symlink INSIDE the worktree that
//       resolves OUTSIDE the root is kind:'symlink-escape', escaped:true, and is
//       NEVER hashed in-scope (sha256:null). This is the exact place a TOCTOU /
//       symlinked-ancestor escape sneaks bytes from outside the scope into an
//       in-scope hash; the guard fails CLOSED.
//     * an in-scope regular file is kind:'in-scope'.
//     * a resolution error (broken symlink, permission) fails closed →
//       kind:'unresolvable', escaped:true, sha256:null (treated as out-of-scope,
//       never trusted as in-scope).
//
// CWE-22 / TOCTOU: every classification routes through K7 path-canonicalize
//   (checkWithinRoot) — the single canonicalization source of truth in the kernel.
//
// DAG: this leaf MUST NOT import the orchestrator k14-write-scope (no back-edge).

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let guard;
try { guard = require('../../../../packages/kernel/_lib/k14-symlink-guard'); }
catch (_e) { guard = null; }

const LIB_DIR = path.join(__dirname, '..', '..', '..', '..', 'packages', 'kernel', '_lib');

let passed = 0;
let failed = 0;
function test(name, fn) {
  const base = path.join(os.tmpdir(), 'k14-sym-' + Math.random().toString(36).slice(2));
  fs.mkdirSync(base, { recursive: true });
  try { fn(base); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
  finally { try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* best-effort */ } }
}

function mkRootAndOutside(base) {
  const root = path.join(base, 'wt');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  return { root, outside };
}

// ── presence (RED until impl) ────────────────────────────────────────────────

test('module exports classifyPath', () => {
  assert.ok(guard, 'packages/kernel/_lib/k14-symlink-guard.js must exist (absent → RED)');
  assert.strictEqual(typeof guard.classifyPath, 'function');
});

// ── the load-bearing case: symlink inside worktree → outside root ────────────

test('SECURITY: a leaf symlink inside root pointing OUTSIDE is symlink-escape, NEVER hashed in-scope', (base) => {
  assert.ok(guard, 'impl absent');
  const { root, outside } = mkRootAndOutside(base);
  const target = path.join(outside, 'secret.txt');
  fs.writeFileSync(target, 'OUT-OF-SCOPE-BYTES');
  const link = path.join(root, 'leaf-link');
  fs.symlinkSync(target, link);

  const r = guard.classifyPath(link, root);
  assert.strictEqual(r.kind, 'symlink-escape', 'escaping symlink flagged');
  assert.strictEqual(r.escaped, true);
  assert.strictEqual(r.sha256, null, 'the escaping target is NEVER hashed in-scope (fail-closed)');
});

test('SECURITY: a symlinked ANCESTOR dir escaping root flags the file beneath it as symlink-escape', (base) => {
  assert.ok(guard, 'impl absent');
  const { root, outside } = mkRootAndOutside(base);
  const realDir = path.join(outside, 'real');
  fs.mkdirSync(realDir, { recursive: true });
  fs.writeFileSync(path.join(realDir, 'payload.txt'), 'OUTSIDE');
  fs.symlinkSync(realDir, path.join(root, 'link-dir')); // ancestor symlink escapes

  const candidate = path.join(root, 'link-dir', 'payload.txt');
  const r = guard.classifyPath(candidate, root);
  assert.strictEqual(r.kind, 'symlink-escape', 'symlinked ancestor escape is caught (checkWithinRoot escapes-root)');
  assert.strictEqual(r.sha256, null, 'never hashed in-scope');
});

test('SECURITY: a symlink to a real system dir (/etc, neutral) is escape, not followed into a hash', (base) => {
  assert.ok(guard, 'impl absent');
  const { root } = mkRootAndOutside(base);
  // /etc exists on macOS + Linux + WSL; neutral non-secret system dir.
  fs.symlinkSync('/etc', path.join(root, 'etc-link'));
  const r = guard.classifyPath(path.join(root, 'etc-link', 'hostname'), root);
  assert.strictEqual(r.kind, 'symlink-escape');
  assert.strictEqual(r.sha256, null);
});

// ── reason surfacing (theo-HIGH-3 / blair-PRINCIPLE-1): leaf owns full taxonomy

test('TAXONOMY: an escaping leaf symlink carries reason=escapes-root (surfaced, not discarded)', (base) => {
  assert.ok(guard, 'impl absent');
  const { root, outside } = mkRootAndOutside(base);
  const target = path.join(outside, 'sec.txt');
  fs.writeFileSync(target, 'OUT');
  fs.symlinkSync(target, path.join(root, 'esc'));
  const r = guard.classifyPath(path.join(root, 'esc'), root);
  assert.strictEqual(r.kind, 'symlink-escape');
  assert.strictEqual(r.reason, 'escapes-root',
    'the K7 reason is surfaced so the orchestrator dispatches on kind without a 2nd checkWithinRoot');
});

test('TAXONOMY: a lexical sibling OUTSIDE every root is kind=out-of-scope, reason=absolute-outside-root, NEVER hashed', (base) => {
  assert.ok(guard, 'impl absent');
  const { root, outside } = mkRootAndOutside(base);
  const sibling = path.join(outside, 'ghost.txt');
  fs.writeFileSync(sibling, 'SIBLING-BYTES');
  const r = guard.classifyPath(sibling, root);
  assert.strictEqual(r.kind, 'out-of-scope', 'a lexical sibling is out-of-scope, distinct from symlink-escape');
  assert.strictEqual(r.reason, 'absolute-outside-root');
  assert.strictEqual(r.escaped, true);
  assert.strictEqual(r.sha256, null, 'out-of-scope is not hashed in-scope by the leaf');
});

test('TAXONOMY: an in-scope file carries reason=null', (base) => {
  assert.ok(guard, 'impl absent');
  const { root } = mkRootAndOutside(base);
  const f = path.join(root, 'ok.txt');
  fs.writeFileSync(f, 'in');
  const r = guard.classifyPath(f, root);
  assert.strictEqual(r.kind, 'in-scope');
  assert.strictEqual(r.reason, null, 'an in-scope classification carries no escape reason');
});

// ── in-scope regular file is NOT flagged ─────────────────────────────────────

test('an in-scope regular file is kind=in-scope (and MAY be hashed)', (base) => {
  assert.ok(guard, 'impl absent');
  const { root } = mkRootAndOutside(base);
  const f = path.join(root, 'legit.txt');
  fs.writeFileSync(f, 'in-scope');
  const r = guard.classifyPath(f, root);
  assert.strictEqual(r.kind, 'in-scope', 'a normal in-scope file is not an escape');
  assert.strictEqual(r.escaped, false);
});

test('an in-scope symlink whose target is ALSO in-scope is NOT an escape', (base) => {
  assert.ok(guard, 'impl absent');
  const { root } = mkRootAndOutside(base);
  const realInScope = path.join(root, 'real-in.txt');
  fs.writeFileSync(realInScope, 'in');
  fs.symlinkSync(realInScope, path.join(root, 'in-link'));
  const r = guard.classifyPath(path.join(root, 'in-link'), root);
  assert.strictEqual(r.escaped, false, 'symlink that stays within root is not an escape');
  assert.notStrictEqual(r.kind, 'symlink-escape');
});

// ── fail-closed on resolution error ──────────────────────────────────────────

test('fail-closed: a broken symlink (dangling target) is unresolvable+escaped, sha256 null (never trusted in-scope)', (base) => {
  assert.ok(guard, 'impl absent');
  const { root } = mkRootAndOutside(base);
  fs.symlinkSync(path.join(root, 'does-not-exist'), path.join(root, 'dangling'));
  const r = guard.classifyPath(path.join(root, 'dangling'), root);
  assert.ok(r.kind === 'unresolvable' || r.kind === 'symlink-escape',
    'a dangling symlink must NOT be classified in-scope');
  assert.strictEqual(r.sha256, null, 'unresolvable path is never hashed as in-scope (fail-closed)');
  assert.strictEqual(r.escaped, true);
});

test('fail-closed: a traversal-marker candidate (..) is rejected as escaped, not hashed', (base) => {
  assert.ok(guard, 'impl absent');
  const { root } = mkRootAndOutside(base);
  const r = guard.classifyPath(path.join(root, '..', 'escapee.txt'), root);
  assert.strictEqual(r.escaped, true, 'a .. traversal candidate is an escape');
  assert.strictEqual(r.sha256, null);
});

// ── CWE-22 source-of-truth: routes through K7 ────────────────────────────────

test('CWE-22: the guard consumes K7 path-canonicalize (single canonicalization source of truth)', () => {
  const src = fs.readFileSync(path.join(LIB_DIR, 'k14-symlink-guard.js'), 'utf8');
  assert.ok(/require\(['"]\.\/path-canonicalize['"]\)/.test(src),
    'symlink-guard must delegate to K7 checkWithinRoot, not re-roll canonicalization');
});

// ── DAG: pure star — no back-edge to orchestrator AND no sibling-leaf edge ─────
// theo-HIGH-1: assert the leaf-to-leaf direction too, closing the cycle blind
// spot (symlink-guard is the stable security sink — it must import no sibling).

test('DAG: k14-symlink-guard does NOT import k14-write-scope (no back-edge to orchestrator)', () => {
  const src = fs.readFileSync(path.join(LIB_DIR, 'k14-symlink-guard.js'), 'utf8');
  assert.ok(!/require\(['"]\.\/k14-write-scope['"]\)/.test(src),
    'leaf must not import the orchestrator (orchestration -> leaves only)');
});

test('DAG: k14-symlink-guard does NOT import its sibling leaves (no leaf-to-leaf edge)', () => {
  const src = fs.readFileSync(path.join(LIB_DIR, 'k14-symlink-guard.js'), 'utf8');
  assert.ok(!/require\(['"]\.\/k14-snapshot['"]\)/.test(src),
    'symlink-guard (stable sink) must NOT import snapshot — would close a real cycle under Option A');
  assert.ok(!/require\(['"]\.\/k14-tail-window['"]\)/.test(src),
    'symlink-guard must not import the tail-window sibling');
});

process.stdout.write(`\nk14-symlink-guard.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
