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
    // Guard against unbounded loop; filesystem depth is small in practice.
    for (let i = 0; i < 4096; i++) {
      const parent = path.dirname(dir);
      if (parent === dir) break; // reached filesystem root
      try {
        const real = fs.realpathSync(dir);
        return tail.length ? path.join(real, ...tail.slice().reverse()) : real;
      } catch {
        tail.push(path.basename(dir));
        dir = parent;
      }
    }
    return resolved; // nothing along the chain existed; best-effort.
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
 * The CWE-22 admission gate for K9/K14 write-scope. Combines the syntactic
 * screen with the resolved within-root check.
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
    return {
      ok: false,
      reason: path.isAbsolute(candidatePath) ? 'absolute-outside-root' : 'escapes-root',
    };
  }
  return { ok: true, reason: null };
}

module.exports = { canonicalize, hasTraversalMarkers, isWithinRoot, checkWithinRoot };
