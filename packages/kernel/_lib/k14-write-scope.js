'use strict';

// packages/kernel/_lib/k14-write-scope.js
//
// K14 — write-scope ORCHESTRATOR (v3.0-alpha, PR-4a). Ships DORMANT: no
// production module imports it in v3.0-alpha (the post-spawn-resolver that
// consumes write_scope_violations[] lands in PR-4b). Built + unit-tested here.
//
// This is the retained orchestrator of the mandatory K14 split (ADR-0011
// §K14-split, mirroring the K9 split). DAG is strictly orchestration → {leaves}:
// it imports the three leaves; NO leaf imports it (the acyclic guarantee is
// TESTED, not asserted — each leaf test carries a no-back-edge case).
//
//   leaves:
//     k14-snapshot.js       — tree snapshot + content-hash + pure diff
//     k14-tail-window.js    — late-write attribution (F1 anchor, injected clock)
//     k14-symlink-guard.js  — CWE-22 / TOCTOU classify (delegates to K7)
//
// Transport-agnostic facade (Decision 2 / THEO-M1): the SINGLE entry point is
// detectWriteScopeViolations(ctx) → write_scope_violations[]. In v3.0-alpha it
// dispatches ONLY to the snapshot transport (pure snapshot, no event-stream).
// v3.1 adds the fsevents/inotify event-stream branch BEHIND this same facade
// (Open/Closed) with zero resolver change — YAGNI honored (no flag built now)
// while the extension seam is preserved.
//
// HONEST scope of the Open/Closed promise (theo-MEDIUM-2): the facade's OUTPUT
// (write_scope_violations[]) + NAME are transport-agnostic, and the resolver's
// READ of that array needs zero change when v3.1 lands. The INPUT `ctx` is NOT
// yet transport-agnostic: v3.0-alpha's ctx is snapshot-SHAPED (it carries
// ctx.preSnapshot from snapshotDeclaredRoots + the pre/post diffing premise). An
// fsevents/inotify transport produces an event STREAM, not a preSnapshot, so
// v3.1 will introduce a transport discriminator on ctx (a union: snapshot-ctx vs
// event-stream-ctx). The "zero resolver change" guarantee is therefore scoped to
// the resolver's consumption of the OUTPUT, not to ctx assembly. We deliberately
// do NOT build the event-stream branch now (YAGNI; kb:architecture/discipline/
// trade-off-articulation — the sacrifice is named: the input seam is narrower
// than the output seam until v3.1).
//
// Element shape (ADR-0011 §write-scope-violations-schema), produced FULLY (the
// plan calls out the shape-match false-green explicitly):
//   { path, kind, transport, detected_at_phase, sha256_pre, sha256_post, flags }

const path = require('path');
const { snapshotTree } = require('./k14-snapshot');
const { tailWindowPhase } = require('./k14-tail-window');
const { classifyPath, hashInScopeFile } = require('./k14-symlink-guard');
const { checkWithinRoot, hasTraversalMarkers } = require('./path-canonicalize');

const TRANSPORT_SNAPSHOT = 'snapshot';
const FALSE_POSITIVE_FLAG = 'K14_SUSPECTED_FALSE_POSITIVE';
const DEFAULT_TAIL_WINDOW_MS = 5000;

/**
 * Hash an arbitrary readable file path WITHOUT a scope requirement. Used to
 * fingerprint an OUT-OF-SCOPE sibling write (which by definition lives outside
 * any declared root, so the in-scope snapshot never captures it) at both the
 * pre- and post- snapshot points. Fail-soft: returns null on any read failure.
 * Reuses the symlink-guard's streaming hasher to keep one hashing implementation.
 *
 * @param {string} filePath
 * @param {object} fsmod  the fs module (injected for testability; default real)
 * @returns {string|null}
 */
function hashFileUnconditional(filePath, fsmod) {
  try {
    const st = fsmod.lstatSync(filePath);
    if (!st.isFile()) return null;
    return hashInScopeFile(filePath, st.size);
  } catch {
    return null;
  }
}

/**
 * Pre-snapshot seam. Captures the declared-roots tree snapshot PLUS a pre-hash
 * of the suspected out-of-scope target (so a sibling write outside every root —
 * which the in-scope tree walk cannot see — still has a pre-fingerprint to diff
 * against post). The caller passes the returned object back as ctx.preSnapshot.
 *
 * Pure with respect to ctx (reads the filesystem; mutates nothing on ctx).
 *
 * @param {object} ctx
 * @returns {{ trees: Object<string,object>, targetPreSha: string|null }}
 */
function snapshotDeclaredRoots(ctx) {
  const fsmod = (ctx && ctx.fs) || require('fs');
  const roots = Array.isArray(ctx && ctx.declaredWriteRoots) ? ctx.declaredWriteRoots : [];
  const trees = {};
  for (const r of roots) {
    // Inject the K7-delegating classifier (theo-HIGH-1 Option A — snapshot does
    // not import its sibling; the orchestrator composes).
    trees[r] = snapshotTree(r, classifyPath);
  }
  // A target that lives outside the declared roots won't be in `trees`; capture
  // its pre-hash directly so the out-of-scope diff has a non-null pre side.
  let targetPreSha = null;
  if (
    ctx && typeof ctx.targetPath === 'string' && ctx.targetPath.length > 0 &&
    // CWE-22 defense-in-depth (eli-MEDIUM-1): a `..`/null-byte target must NEVER
    // reach hashFileUnconditional — OS normalization of '..' could otherwise
    // fingerprint a file outside every root. Gate at the entry, uniformly with
    // classifyTarget, rather than relying on a downstream reason discrimination.
    !hasTraversalMarkers(ctx.targetPath)
  ) {
    const inAnyRoot = roots.some((r) => checkWithinRoot(ctx.targetPath, r).ok);
    if (!inAnyRoot) {
      targetPreSha = hashFileUnconditional(ctx.targetPath, fsmod);
    }
  }
  return { trees, targetPreSha };
}

/**
 * Build a fully-shaped violation element. Always returns a NEW object carrying
 * every required key (no partial elements — the shape-match false-green guard).
 */
function makeViolation({ relPath, kind, phase, shaPre, shaPost, flags }) {
  return {
    path: relPath,
    kind,
    transport: TRANSPORT_SNAPSHOT,
    detected_at_phase: phase,
    sha256_pre: shaPre === undefined ? null : shaPre,
    sha256_post: shaPost === undefined ? null : shaPost,
    flags: Array.isArray(flags) ? flags.slice() : [],
  };
}

/**
 * The detection phase for the suspected write. Anchored on spawn_close_wall_ms
 * via the tail-window leaf (F1). When no write timestamp is supplied the write
 * is taken as observed at spawn close (writeAtMs defaults to spawnCloseWallMs,
 * which tailWindowPhase classifies 'spawn-close' since writeAtMs <= close).
 *
 * blair-PRINCIPLE-2 (KISS / dead-code): the prior `if (phase === null)` fallback
 * re-called isWithinTailWindow to recover a 'spawn-close' arm — but tailWindowPhase
 * returns null IFF isWithinTailWindow is false (k14-tail-window.js: `if
 * (!isWithinTailWindow(o)) return null`), so that arm was unreachable. The phase
 * IS tailWindowPhase's result directly: 'spawn-close' (at/before close),
 * 'tail-window' (late but within window), or null (past window / non-finite →
 * not attributed).
 */
function phaseFor(ctx) {
  const tailWindowMs = Number.isFinite(ctx && ctx.tailWindowMs) ? ctx.tailWindowMs : DEFAULT_TAIL_WINDOW_MS;
  const spawnCloseWallMs = ctx && ctx.spawnCloseWallMs;
  const writeAtMs = ctx && Number.isFinite(ctx.writeAtMs) ? ctx.writeAtMs : spawnCloseWallMs;
  return tailWindowPhase({ writeAtMs, spawnCloseWallMs, tailWindowMs });
}

/**
 * Is the suspected target a parent-environment write the caller marked as not
 * reachable from the spawn worktree (IDE formatter / file watcher)? Such a
 * change is reported parent-scope-suspected + carries the false-positive flag
 * (F7) so the resolver can down-weight it.
 */
function isParentScopeSuspected(ctx) {
  const marked = Array.isArray(ctx && ctx.unreachableFromSpawnRoot) ? ctx.unreachableFromSpawnRoot : [];
  return marked.indexOf(ctx.targetPath) !== -1;
}

/**
 * Classify the single suspected target into a violation (or null when in-scope +
 * clean). Snapshot transport, v3.0-alpha. Reads pre-hash from ctx.preSnapshot.
 */
function classifyTarget(ctx, fsmod) {
  if (typeof ctx.targetPath !== 'string' || ctx.targetPath.length === 0) return null;
  const root = ctx.worktreeRoot;

  // CWE-22 defense-in-depth (eli-MEDIUM-1): reject a `..`/null-byte target at the
  // ENTRY, before any classification or hashing. classifyPath would map it to
  // symlink-escape (escaped), but gating here keeps the traversal-marker case
  // from ever reaching hashFileUnconditional via OS normalization, uniformly with
  // snapshotDeclaredRoots. A traversal candidate is NOT attributed to this spawn.
  if (hasTraversalMarkers(ctx.targetPath)) return null;

  const phase = phaseFor(ctx);
  if (phase === null) return null; // past the tail window → not attributed to this spawn

  // The leaf owns the FULL classification (theo-HIGH-3 / blair-PRINCIPLE-1 /
  // eli-LOW): dispatch on cls.kind alone — NO second checkWithinRoot to re-derive
  // the escape reason (one realpath walk, one change-site if the taxonomy grows).
  const cls = classifyPath(ctx.targetPath, root);
  const relForOutside = path.basename(ctx.targetPath);

  // (1) symlink-escape: lexically inside root, resolves outside. NEVER hashed.
  if (cls.kind === 'symlink-escape') {
    return makeViolation({
      relPath: relForOutside, kind: 'symlink-escape', phase, shaPre: null, shaPost: null, flags: [],
    });
  }

  // (2) in-scope target: either a parent-scope-suspected change, or a clean
  // in-scope write (no violation).
  if (cls.kind === 'in-scope') {
    if (isParentScopeSuspected(ctx)) {
      const rel = path.relative(root, ctx.targetPath) || relForOutside;
      const preSha = (ctx.preSnapshot && treeShaFor(ctx.preSnapshot, root, rel));
      return makeViolation({
        relPath: rel,
        kind: 'parent-scope-suspected',
        phase,
        shaPre: preSha || null,
        shaPost: hashFileUnconditional(ctx.targetPath, fsmod),
        flags: [FALSE_POSITIVE_FLAG],
      });
    }
    return null; // clean in-scope write — not a violation
  }

  // (3) out-of-scope sibling (cls.kind 'out-of-scope') OR an unresolvable target:
  // lexically + absolutely outside every root. Hash a real out-of-scope file
  // (pre from the snapshot seam, post live); an unresolvable target hashes to
  // null on both sides (hashFileUnconditional fail-soft) but is still recorded.
  const preSha = (ctx.preSnapshot && ctx.preSnapshot.targetPreSha) || null;
  return makeViolation({
    relPath: relForOutside,
    kind: 'out-of-scope',
    phase,
    shaPre: preSha,
    shaPost: hashFileUnconditional(ctx.targetPath, fsmod),
    flags: [],
  });
}

/**
 * Look up the pre-hash of an in-scope relative path from a preSnapshot's tree
 * for the given root. Returns null when absent.
 */
function treeShaFor(preSnapshot, root, rel) {
  if (!preSnapshot || !preSnapshot.trees) return null;
  const tree = preSnapshot.trees[root];
  if (!tree) return null;
  const posixRel = rel.split(path.sep).join('/');
  const entry = tree[posixRel];
  return entry ? entry.sha256 : null;
}

/**
 * Transport-agnostic detection facade. Returns write_scope_violations[] — an
 * array of fully-shaped violation elements (default [] for a clean spawn). Does
 * not mutate ctx. v3.0-alpha dispatches to the snapshot transport only.
 *
 * @param {object} ctx
 * @param {string} ctx.worktreeRoot       the spawn's declared root
 * @param {string[]} [ctx.declaredWriteRoots]  roots to snapshot (defaults to [worktreeRoot])
 * @param {string} [ctx.targetPath]       the suspected write (v3.0-alpha primary signal)
 * @param {object} [ctx.preSnapshot]      from snapshotDeclaredRoots(ctx) at spawn open
 * @param {number} [ctx.spawnCloseWallMs] F1 anchor (PostToolUse entry wall-ms)
 * @param {number} [ctx.writeAtMs]        observed write ms (defaults to spawnCloseWallMs)
 * @param {number} [ctx.tailWindowMs]     default 5000
 * @param {string[]} [ctx.unreachableFromSpawnRoot] caller-marked IDE-owned paths (F7)
 * @returns {Array<object>} write_scope_violations[]
 */
function detectWriteScopeViolations(ctx) {
  if (!ctx || typeof ctx !== 'object') return [];
  const fsmod = ctx.fs || require('fs');
  const violations = [];
  const v = classifyTarget(ctx, fsmod);
  if (v) violations.push(v);
  return violations;
}

module.exports = {
  detectWriteScopeViolations,
  snapshotDeclaredRoots,
  // exported for unit-level reuse / inspection (no production importer in v3.0-alpha)
  makeViolation,
  hashFileUnconditional,
  TRANSPORT_SNAPSHOT,
  FALSE_POSITIVE_FLAG,
};
