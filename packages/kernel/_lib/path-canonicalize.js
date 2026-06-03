// packages/kernel/_lib/path-canonicalize.js
//
// K7 — Path canonicalization + CWE-22 traversal guard (v3.0-alpha, PR 2).
//
// v6 spec anchors:
//   §6.1.1 K7 — "Path canonicalization validator — Rejects `..`, absolute,
//                symlink-escape". Reused by K9 (§6.5) + K14 (§6.5.K14) +
//                fact-force-gate.js (F14 DRY migration).
//   §6.5.K14 "Symlink + TOCTOU surface" — symlinks resolved via realpath
//             before scope check; shared `_lib/path-canonicalize.js`.
//
// Two responsibilities, deliberately separated (SRP):
//   1. canonicalize(p)        — lenient normalization (resolve + realpath,
//                               resolving symlinked ancestors even for a
//                               not-yet-existing leaf). Used by the
//                               fact-force-gate read-tracker (F14) and as the
//                               substrate for the scope checks below.
//   2. checkWithinRoot(p,root)— the load-bearing CWE-22 guard for K9/K14:
//                               rejects `..` markers, null bytes, and any path
//                               that (after symlink resolution) escapes `root`.
//
// Design note (F14): fact-force-gate's prior `normalizePath` did
// `path.resolve` + `fs.realpathSync` fallback to the resolved (UNresolved-
// symlink) path. That is a weaker canonicalize — a symlinked ancestor of a
// non-existent leaf is NOT resolved. K7's canonicalize closes that by walking
// to the deepest existing ancestor and realpathing IT, then re-appending the
// non-existent tail. The migration is therefore a strict hardening, not a
// behavior-preserving move; fact-force-gate's tracker keys become more
// canonical (symlink + target collapse to one key), which only improves the
// read-before-edit guarantee.

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Lenient canonical absolute path. Resolves symlinks via realpath; for a
 * non-existent leaf, resolves the deepest existing ANCESTOR (so a symlinked
 * parent directory is collapsed) and re-appends the non-existent tail.
 *
 * @param {string} filePath
 * @returns {string} canonical absolute path, or '' for falsy/non-string input.
 */
function canonicalize(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) return '';
  const resolved = path.resolve(filePath);
  try {
    return fs.realpathSync(resolved);
  } catch {
    // Leaf (or some descendant component) doesn't exist. Walk up to the
    // deepest existing ancestor, realpath it, then re-append the tail so any
    // symlinked ancestor is resolved (CWE-22: defeats symlinked-parent escape
    // on writes to not-yet-existing files).
    let dir = resolved;
    const tail = [];
    // The loop strictly reduces `dir` toward the filesystem root via
    // path.dirname, so it terminates at the root (`parent === dir`) in at most
    // (path-depth) steps — bounded by OS PATH_MAX (≤4096 bytes ⇒ ≤~2048
    // components). The numeric ceiling is pure belt-and-suspenders.
    let reachedRoot = false;
    for (let i = 0; i < 4096; i++) {
      const parent = path.dirname(dir);
      if (parent === dir) {
        reachedRoot = true;
        break; // reached filesystem root
      }
      try {
        const real = fs.realpathSync(dir);
        return tail.length ? path.join(real, ...tail.slice().reverse()) : real;
      } catch {
        tail.push(path.basename(dir));
        dir = parent;
      }
    }
    // reachedRoot: the whole path below root is non-existent (e.g. `/newfile`).
    // `resolved` has no symlinked ancestor to collapse, so it IS canonical —
    // safe to return.
    //
    // !reachedRoot: we hit the numeric ceiling WITHOUT reaching root. This is
    // unreachable on any real OS (a path that deep exceeds PATH_MAX), but if it
    // ever happens we could NOT guarantee symlink resolution. FAIL CLOSED ('')
    // so the security consumers (isWithinRoot/checkWithinRoot) REJECT rather
    // than trust a possibly-unresolved path. The advisory consumer
    // (fact-force-gate) reads '' as "no path" and fails soft — acceptable for a
    // PATH_MAX-exceeding input.
    return reachedRoot ? resolved : '';
  }
}

/**
 * Syntactic pre-resolution traversal screen. Catches the obvious CWE-22 /
 * CWE-158 markers BEFORE any filesystem resolution, so a hostile path is
 * rejected even if realpath would have failed or been ambiguous.
 *
 * Returns true == REJECT (markers present or input invalid).
 *
 * @param {string} rawPath
 * @returns {boolean} true if the raw path must be rejected.
 */
function hasTraversalMarkers(rawPath) {
  if (typeof rawPath !== 'string' || rawPath.length === 0) return true;
  if (rawPath.indexOf('\0') !== -1) return true; // null byte (CWE-158)
  // `..` as a discrete path segment (not merely a substring like `a..b`).
  const segments = rawPath.split(/[\\/]+/);
  if (segments.indexOf('..') !== -1) return true;
  return false;
}

/**
 * True iff `candidatePath`, after symlink resolution, is `rootPath` itself or
 * lives strictly under it. Prefix comparison uses a path-separator boundary so
 * `/tmp/root` does NOT match `/tmp/root-evil`.
 *
 * @param {string} candidatePath
 * @param {string} rootPath
 * @returns {boolean}
 */
function isWithinRoot(candidatePath, rootPath) {
  const root = canonicalize(rootPath);
  const cand = canonicalize(candidatePath);
  if (!root || !cand) return false;
  if (cand === root) return true;
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  return cand.startsWith(rootWithSep);
}

/**
 * True iff `candidatePath` is LEXICALLY inside `rootPath` (shares the root prefix
 * at a separator boundary) BEFORE any symlink resolution. Distinguishes the
 * out-of-scope reason: a path that is lexically inside root but resolves outside
 * (via a symlinked ancestor / leaf) is a SYMLINK escape ('escapes-root'); a path
 * that is lexically outside root never entered the namespace
 * ('absolute-outside-root'). Pure string comparison — no filesystem access.
 *
 * @param {string} candidatePath
 * @param {string} rootPath
 * @returns {boolean}
 */
function isLexicallyWithin(candidatePath, rootPath) {
  if (typeof candidatePath !== 'string' || typeof rootPath !== 'string') return false;
  const candAbs = path.resolve(candidatePath);
  const rootAbs = path.resolve(rootPath);
  if (candAbs === rootAbs) return true;
  const rootWithSep = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep;
  return candAbs.startsWith(rootWithSep);
}

/**
 * The CWE-22 admission gate for K9/K14 write-scope. Combines the syntactic
 * screen with the resolved within-root check. K7 is the SINGLE source of truth
 * for both the canonicalization AND the out-of-scope reason taxonomy (PR 3
 * architect MEDIUM — consumers delegate rather than re-roll the discrimination).
 *
 * Reason tokens: 'traversal-markers' (`..` / null-byte / non-string),
 * 'escapes-root' (lexically inside root but symlink-resolves outside), or
 * 'absolute-outside-root' (lexically outside the root namespace).
 *
 * @param {string} candidatePath
 * @param {string} rootPath
 * @returns {{ok: boolean, reason: string|null}}
 */
function checkWithinRoot(candidatePath, rootPath) {
  if (hasTraversalMarkers(candidatePath)) {
    return { ok: false, reason: 'traversal-markers' };
  }
  if (!isWithinRoot(candidatePath, rootPath)) {
    // Discriminate by LEXICAL position, not path.isAbsolute: a symlink-escape
    // path is absolute AND lexically inside root, so isAbsolute alone would
    // mislabel it 'absolute-outside-root'. Lexically-inside-but-resolves-outside
    // is the symlink-escape signature → 'escapes-root'.
    return {
      ok: false,
      reason: isLexicallyWithin(candidatePath, rootPath) ? 'escapes-root' : 'absolute-outside-root',
    };
  }
  return { ok: true, reason: null };
}

/**
 * True iff `seg` is a safe SINGLE path segment: a non-empty string with no path
 * separators, no `.`/`..` traversal, and no NUL byte. The canonical RAW-TOKEN guard
 * for an UNTRUSTED path component (runId, leaf-id, …) that will be `path.join`'d
 * into a shared base.
 *
 * MUST run BEFORE the join: `path.join` runs `path.normalize`, which COLLAPSES `..`
 * away, so a downstream `checkWithinRoot(path.join(base, seg), base)` is BLINDED to
 * an in-base traversal — `'a/../b'` → `base/b` (still within base) passes, landing in
 * a sibling; `'x/..'` → `base` writes at the root. `hasTraversalMarkers` only catches
 * a LITERAL `..` in the raw string, which the join has already removed. So
 * `checkWithinRoot` is a useful SECOND layer (absolute/symlink escape) but NEVER the
 * primary gate for a joined path; this raw-segment check is the FIRST.
 *
 * @param {string} seg
 * @returns {boolean}
 */
function isSafePathSegment(seg) {
  if (typeof seg !== 'string' || seg.length === 0) return false;
  if (seg.indexOf('\0') !== -1) return false;                                 // NUL byte (CWE-158)
  if (seg.indexOf('/') !== -1 || seg.indexOf(path.sep) !== -1) return false;  // no separators
  // `.`/`..` as a discrete segment (the `/`-bearing traversal forms are already
  // rejected above; the split is belt-and-suspenders for a bare `..`).
  if (seg === '.' || seg === '..' || seg.split(/[\\/]+/).indexOf('..') !== -1) return false;
  return true;
}

module.exports = {
  canonicalize, hasTraversalMarkers, isWithinRoot, isLexicallyWithin, checkWithinRoot,
  isSafePathSegment,
};
