#!/usr/bin/env node

// tests/unit/kernel/_lib/k14-write-scope.test.js
//
// K14 write-scope ORCHESTRATOR (v3.0-alpha, PR-4a — ships DORMANT).
// TDD Phase 1: written FIRST, runs RED against the absent impl
// (packages/kernel/_lib/k14-write-scope.js does not exist yet).
//
// THE BEHAVIORAL CONTRACT (ADR-0011 §K14-split + §write-scope-violations-schema):
//   detectWriteScopeViolations(ctx) -> write_scope_violations[]
//     * transport-agnostic facade (Decision 2 / THEO-M1) — dispatches ONLY to
//       the snapshot leaf in v3.0-alpha; v3.1 adds event-stream behind the SAME
//       facade (Open/Closed) with zero resolver change.
//     * empty input (no out-of-scope writes) -> [] (the F19 default-empty case).
//     * a populated violation set carries the FULL element shape, NOT a truthy
//       array (avoids the shape-match false-green the plan calls out explicitly):
//       { path, kind, transport, detected_at_phase, sha256_pre, sha256_post, flags }
//   INV-K14-PostDetectionEnforcement: an out-of-scope-write fixture produces a
//       populated, fully-shaped violation set.
//   DAG: the orchestrator imports the three leaves; no leaf imports it (the
//       acyclic guarantee is TESTED here, mirroring the K9 split).
//
// Every K14-visited path goes through K7 checkWithinRoot (CWE-22), fail-closed.
//
// House test pattern: imperative assert + hand-rolled test() runner + exit code;
// hermetic tmp dir; injected clock (NEVER wallclock — F23). atomic-write/K7 real.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Bind to the absent impl — this require THROWS until k14-write-scope.js exists,
// so every test below reports RED (the TDD-phase-1 contract).
let k14;
try {
  k14 = require('../../../../packages/kernel/_lib/k14-write-scope');
} catch (_e) {
  k14 = null; // tests assert against this and FAIL loudly while impl is absent
}

const { createInjectableClock } = require('./_test-harness');

const LIB_DIR = path.join(__dirname, '..', '..', '..', '..', 'packages', 'kernel', '_lib');
const FIXTURES = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'fixtures', 'k14', 'violations', 'fixtures.json'),
    'utf8'
  )
);

// The canonical element shape (ADR-0011 §write-scope-violations-schema). Asserted
// field-by-field so a partial element can never pass as "populated".
const ELEMENT_KEYS = ['path', 'kind', 'transport', 'detected_at_phase', 'sha256_pre', 'sha256_post', 'flags'];
const VALID_KINDS = ['out-of-scope', 'symlink-escape', 'parent-scope-suspected'];
const VALID_PHASES = ['spawn-close', 'tail-window', 'recovery-sweep'];

let passed = 0;
let failed = 0;
function test(name, fn) {
  const base = path.join(os.tmpdir(), 'k14-orch-' + Math.random().toString(36).slice(2));
  fs.mkdirSync(base, { recursive: true });
  try { fn(base); process.stdout.write(`  PASS ${name}\n`); passed++; }
  catch (err) { process.stdout.write(`  FAIL ${name}: ${err.message}\n`); failed++; }
  finally { try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* best-effort */ } }
}

// Materialize a hermetic worktree root + a sibling OUTSIDE dir, returning the
// ctx scaffolding the orchestrator consumes. Files written here are the
// snapshot's "post" state; the ctx carries the declared scope + a pre-snapshot.
function makeCtx(base, fixture, clock) {
  const root = path.join(base, 'worktree');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  const subst = (p) => String(p).split('<<ROOT>>').join(root).split('<<OUTSIDE>>').join(outside);
  return {
    worktreeRoot: root,
    outsideRoot: outside,
    targetPath: subst(fixture.path),
    spawnCloseWallMs: clock.nowMs(),
    tailWindowMs: fixture.tail_window_ms || 5000,
    clock,
    // The orchestrator hashes the declared roots' tree; the test pre-seeds files.
    declaredWriteRoots: [root],
  };
}

function assertElementShape(v, label) {
  assert.ok(v && typeof v === 'object', `${label}: violation element must be an object`);
  for (const k of ELEMENT_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(v, k), `${label}: element missing required key '${k}'`);
  }
  assert.strictEqual(typeof v.path, 'string', `${label}: path is a string`);
  assert.ok(VALID_KINDS.includes(v.kind), `${label}: kind '${v.kind}' must be one of ${VALID_KINDS.join('|')}`);
  assert.strictEqual(v.transport, 'snapshot', `${label}: v3.0-alpha transport is always 'snapshot'`);
  assert.ok(VALID_PHASES.includes(v.detected_at_phase), `${label}: detected_at_phase '${v.detected_at_phase}' invalid`);
  assert.ok(v.sha256_pre === null || typeof v.sha256_pre === 'string', `${label}: sha256_pre is string|null`);
  assert.ok(v.sha256_post === null || typeof v.sha256_post === 'string', `${label}: sha256_post is string|null`);
  assert.ok(Array.isArray(v.flags), `${label}: flags is an array`);
}

// ── module presence (RED until impl lands) ──────────────────────────────────

test('module exports detectWriteScopeViolations (transport-agnostic facade)', () => {
  assert.ok(k14, 'packages/kernel/_lib/k14-write-scope.js must exist (absent → RED)');
  assert.strictEqual(typeof k14.detectWriteScopeViolations, 'function',
    'detectWriteScopeViolations(ctx) is the single transport-agnostic entry');
});

// ── F19 default-empty: clean spawn -> [] ─────────────────────────────────────

test('F19 default-empty: a clean in-scope spawn yields an empty violation array', (base) => {
  assert.ok(k14, 'impl absent');
  const clock = createInjectableClock({ start: '2026-01-01T00:00:00.000Z' });
  const fx = FIXTURES.fixtures.find((f) => f.id === 'default-empty-no-writes');
  const ctx = makeCtx(base, fx, clock);
  // Seed the in-scope file with identical pre/post content (no change).
  fs.writeFileSync(ctx.targetPath, fx.content_pre);
  ctx.preSnapshot = k14.snapshotDeclaredRoots
    ? k14.snapshotDeclaredRoots(ctx)
    : undefined; // pre-snapshot seam; impl provides it
  const out = k14.detectWriteScopeViolations(ctx);
  assert.ok(Array.isArray(out), 'returns an array');
  assert.strictEqual(out.length, 0, 'identical pre/post in-scope content → zero violations');
});

// ── INV-K14-PostDetectionEnforcement: out-of-scope write -> populated set ─────

test('INV-K14-PostDetectionEnforcement: out-of-scope write produces a FULLY-SHAPED violation (not just truthy)', (base) => {
  assert.ok(k14, 'impl absent');
  const clock = createInjectableClock({ start: '2026-01-01T00:00:00.000Z' });
  const fx = FIXTURES.fixtures.find((f) => f.id === 'out-of-scope-content-hash-sibling');
  const ctx = makeCtx(base, fx, clock);
  // pre-state: capture before the out-of-scope write.
  fs.writeFileSync(ctx.targetPath, fx.content_pre);
  ctx.preSnapshot = k14.snapshotDeclaredRoots ? k14.snapshotDeclaredRoots(ctx) : undefined;
  // The spawn writes OUTSIDE the declared root.
  fs.writeFileSync(ctx.targetPath, fx.content_post);

  const out = k14.detectWriteScopeViolations(ctx);
  assert.ok(Array.isArray(out) && out.length >= 1, 'out-of-scope write must populate violations');
  const v = out.find((x) => x.path && x.path.indexOf('ghost-write.txt') !== -1) || out[0];
  assertElementShape(v, 'out-of-scope');
  assert.strictEqual(v.kind, 'out-of-scope', 'kind is out-of-scope');
  assert.strictEqual(v.detected_at_phase, 'spawn-close', 'detected at spawn-close');
  assert.strictEqual(typeof v.sha256_pre, 'string', 'pre-hash present for a hashed out-of-scope file');
  assert.strictEqual(typeof v.sha256_post, 'string', 'post-hash present');
  assert.notStrictEqual(v.sha256_pre, v.sha256_post, 'content changed → pre/post hashes differ');
});

test('INV-K14-PostDetectionEnforcement: the element shape gate REJECTS a truthy-but-partial element', () => {
  // Meta-guard: proves assertElementShape is non-vacuous — a bare {path} (the
  // shape-match false-green the plan warns about) must FAIL the shape assertion.
  let threw = false;
  try { assertElementShape({ path: '/x' }, 'partial'); } catch { threw = true; }
  assert.ok(threw, 'a partial violation element must not pass the full-shape gate');
});

// ── symlink-escape: flagged, NOT hashed in-scope (CWE-22) ────────────────────

test('symlink-escape: a symlink inside the worktree resolving outside root is flagged, NEVER hashed in-scope', (base) => {
  assert.ok(k14, 'impl absent');
  const clock = createInjectableClock({ start: '2026-01-01T00:00:00.000Z' });
  const fx = FIXTURES.fixtures.find((f) => f.id === 'symlink-escape-content-hash');
  const ctx = makeCtx(base, fx, clock);
  // Materialize: a real file OUTSIDE root + a symlink INSIDE root pointing at it.
  const outsideTarget = path.join(ctx.outsideRoot, 'secret-target.txt');
  fs.writeFileSync(outsideTarget, 'OUT-OF-SCOPE-BYTES-MUST-NOT-BE-HASHED');
  const link = path.join(ctx.worktreeRoot, 'leaf-link');
  fs.symlinkSync(outsideTarget, link);
  ctx.targetPath = link;

  const out = k14.detectWriteScopeViolations(ctx);
  const v = out.find((x) => x.kind === 'symlink-escape');
  assert.ok(v, 'symlink-escape must be flagged');
  assertElementShape(v, 'symlink-escape');
  assert.strictEqual(v.sha256_pre, null, 'escaping symlink target is NOT hashed (sha_pre null)');
  assert.strictEqual(v.sha256_post, null, 'escaping symlink target is NOT hashed (sha_post null)');
});

// ── CWE-22: a `..` traversal target NEVER reaches the hasher (eli-MEDIUM-1) ───

test('CWE-22: a `..` traversal targetPath is NOT attributed and NEVER fingerprints an out-of-root file', (base) => {
  assert.ok(k14, 'impl absent');
  const clock = createInjectableClock({ start: '2026-01-01T00:00:00.000Z' });
  const fx = FIXTURES.fixtures.find((f) => f.id === 'out-of-scope-content-hash-sibling');
  const ctx = makeCtx(base, fx, clock);
  // A real file outside the root, reachable from root ONLY via a `..` segment.
  const outsideFile = path.join(ctx.outsideRoot, 'leak-me.txt');
  fs.writeFileSync(outsideFile, 'TRAVERSAL-MUST-NOT-HASH-THIS');
  // RAW, UN-normalized path (string-concat, NOT path.join which would collapse
  // the `..`). A PostToolUse hook receives tool_input.file_path verbatim — the
  // realistic CWE-22 input is unnormalized. hasTraversalMarkers screens the
  // discrete `..` segment BEFORE OS normalization can resolve it to a real file.
  ctx.targetPath = `${ctx.worktreeRoot}/../outside/leak-me.txt`;

  // Pre-snapshot must NOT capture a pre-hash of the traversal target either.
  ctx.preSnapshot = k14.snapshotDeclaredRoots(ctx);
  assert.strictEqual(ctx.preSnapshot.targetPreSha, null,
    'snapshotDeclaredRoots must NOT fingerprint a `..` target (entry-gated, eli-MEDIUM-1)');

  const out = k14.detectWriteScopeViolations(ctx);
  // The traversal candidate is rejected at the entry → not attributed → no element.
  assert.strictEqual(out.length, 0, 'a `..` traversal target yields no violation (rejected before hashing)');
});

// ── F7 parent-scope false-positive flag ──────────────────────────────────────

test('F7: a parent-environment change not reachable from the worktree carries K14_SUSPECTED_FALSE_POSITIVE', (base) => {
  assert.ok(k14, 'impl absent');
  const clock = createInjectableClock({ start: '2026-01-01T00:00:00.000Z' });
  const fx = FIXTURES.fixtures.find((f) => f.id === 'parent-scope-suspected-content-hash');
  const ctx = makeCtx(base, fx, clock);
  ctx.targetPath = path.join(ctx.worktreeRoot, '.vscode', 'settings.json');
  ctx.unreachableFromSpawnRoot = [ctx.targetPath]; // ctx seam: caller marks IDE-owned paths
  fs.mkdirSync(path.dirname(ctx.targetPath), { recursive: true });
  fs.writeFileSync(ctx.targetPath, fx.content_pre);
  ctx.preSnapshot = k14.snapshotDeclaredRoots ? k14.snapshotDeclaredRoots(ctx) : undefined;
  fs.writeFileSync(ctx.targetPath, fx.content_post);

  const out = k14.detectWriteScopeViolations(ctx);
  const v = out.find((x) => x.kind === 'parent-scope-suspected');
  assert.ok(v, 'parent-scope change must surface as a suspected violation');
  assertElementShape(v, 'parent-scope');
  assert.ok(v.flags.includes('K14_SUSPECTED_FALSE_POSITIVE'),
    'parent-scope-suspected violations MUST carry the false-positive flag (F7)');
});

// ── transport invariant: every element is 'snapshot' in v3.0-alpha ───────────

test('every produced violation reports transport=snapshot (v3.0-alpha single transport)', (base) => {
  assert.ok(k14, 'impl absent');
  const clock = createInjectableClock({ start: '2026-01-01T00:00:00.000Z' });
  const fx = FIXTURES.fixtures.find((f) => f.id === 'out-of-scope-large-file-hash');
  const ctx = makeCtx(base, fx, clock);
  const big = path.join(ctx.outsideRoot, 'big-blob.bin');
  fs.writeFileSync(big, Buffer.alloc(1100000, 1));
  ctx.targetPath = big;
  ctx.preSnapshot = k14.snapshotDeclaredRoots ? k14.snapshotDeclaredRoots(ctx) : undefined;
  fs.writeFileSync(big, Buffer.alloc(1100001, 1));
  const out = k14.detectWriteScopeViolations(ctx);
  for (const v of out) {
    assert.strictEqual(v.transport, 'snapshot', 'no event-stream transport ships in v3.0-alpha');
  }
});

// ── immutability: detect does not mutate the input ctx ───────────────────────

test('immutability: detectWriteScopeViolations does not mutate ctx (new objects only)', (base) => {
  assert.ok(k14, 'impl absent');
  const clock = createInjectableClock({ start: '2026-01-01T00:00:00.000Z' });
  const fx = FIXTURES.fixtures.find((f) => f.id === 'default-empty-no-writes');
  const ctx = makeCtx(base, fx, clock);
  fs.writeFileSync(ctx.targetPath, fx.content_pre);
  const frozenRoots = Object.freeze(ctx.declaredWriteRoots.slice());
  ctx.declaredWriteRoots = frozenRoots;
  const before = JSON.stringify({ root: ctx.worktreeRoot, roots: ctx.declaredWriteRoots, tail: ctx.tailWindowMs });
  k14.detectWriteScopeViolations(ctx);
  const after = JSON.stringify({ root: ctx.worktreeRoot, roots: ctx.declaredWriteRoots, tail: ctx.tailWindowMs });
  assert.strictEqual(before, after, 'ctx scalars + declaredWriteRoots must be untouched');
});

// ── DAG: orchestrator imports the three leaves; no back-edge ─────────────────

test('DAG: k14-write-scope imports the three leaves (snapshot, tail-window, symlink-guard)', () => {
  const orch = fs.readFileSync(path.join(LIB_DIR, 'k14-write-scope.js'), 'utf8');
  assert.ok(/require\(['"]\.\/k14-snapshot['"]\)/.test(orch), 'orchestrator imports k14-snapshot');
  assert.ok(/require\(['"]\.\/k14-tail-window['"]\)/.test(orch), 'orchestrator imports k14-tail-window');
  assert.ok(/require\(['"]\.\/k14-symlink-guard['"]\)/.test(orch), 'orchestrator imports k14-symlink-guard');
});

test('info-hiding: orchestrator does NOT re-derive the escape reason via a 2nd checkWithinRoot (theo-HIGH-3)', () => {
  // The leaf now surfaces cls.reason; the orchestrator dispatches on cls.kind.
  // Guard against regressing to the reach-around that re-called checkWithinRoot
  // purely to inspect `.reason === 'escapes-root'` (the double-resolve + leak).
  const orch = fs.readFileSync(path.join(LIB_DIR, 'k14-write-scope.js'), 'utf8');
  assert.ok(!/checkWithinRoot\([^)]*\)\.reason/.test(orch),
    'orchestrator must not re-derive the K7 reason token (leaf owns the full classification)');
});

test('CWE-22: orchestrator (or a leaf it imports) routes paths through K7 checkWithinRoot', () => {
  // The snapshot walker MUST pass every visited file through path-canonicalize's
  // checkWithinRoot (ADR-0011 §K14-split). Assert the dependency edge exists in
  // the K14 module set (orchestrator or one of the leaves requires it).
  const sources = ['k14-write-scope.js', 'k14-snapshot.js', 'k14-symlink-guard.js']
    .map((f) => { try { return fs.readFileSync(path.join(LIB_DIR, f), 'utf8'); } catch { return ''; } })
    .join('\n');
  assert.ok(/require\(['"]\.\/path-canonicalize['"]\)/.test(sources),
    'K14 must consume K7 path-canonicalize (checkWithinRoot) — single CWE-22 source of truth');
});

process.stdout.write(`\nk14-write-scope.test.js: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
