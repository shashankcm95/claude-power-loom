'use strict';

// packages/kernel/_lib/k14-snapshot.js
//
// K14 — filesystem snapshot + content-hash leaf (v3.0-alpha, PR-4a). One of the
// three mandatory-split K14 leaves (ADR-0011 §K14-split). SRP role = capture a
// content-addressed snapshot of a tree + a pure compare to find changed files.
//
//   DAG: orchestration → {snapshot, tail-window, symlink-guard}. This leaf MUST
//   NOT import the orchestrator k14-write-scope (no back-edge).
//
// CWE-22: the walker passes EVERY visited path through K7 checkWithinRoot. The
// classification + fail-closed in-scope read is owned by the symlink-guard leaf,
// but this leaf does NOT import its sibling (theo-HIGH-1, Option A — preserve the
// pure star DAG that mirrors the K9 split: orchestration -> {leaves}; no leaf
// imports another leaf). Instead the orchestrator INJECTS the classifier as the
// `classify` argument to snapshotTree. A symlink inside the worktree resolving
// OUTSIDE the root is recorded kind:'symlink-escape' with sha256:null — its
// target bytes are NEVER hashed in-scope (ADR-0010 §mechanics). Three snapshot
// sub-strategies (small-file content-hash, mtime+content-hash, large-file >1MB
// hash-only) all live behind one snapshot transport — the strategy is a
// within-snapshot hashing detail, not a separate transport (see
// tests/fixtures/k14/violations/fixtures.json).

const fs = require('fs');
const path = require('path');

// Bound the walk: a pathological symlink cycle or an enormous tree must not
// blow the stack or hang the hook. The kernel worktree is small; this ceiling is
// belt-and-suspenders (CWE-400 — uncontrolled resource consumption).
const MAX_ENTRIES = 100000;

/**
 * Snapshot a tree into a content-addressed map keyed by POSIX-style relative
 * path. Every entry carries { sha256, size, mtimeMs, kind }. An escaping symlink
 * is recorded kind:'symlink-escape' (sha256:null) — flagged, never hashed.
 *
 * The per-file classifier is INJECTED (theo-HIGH-1, Option A) so this leaf does
 * not import its sibling symlink-guard — preserving the pure star DAG. The
 * orchestrator passes the K7-delegating classifyPath. A falsy/non-function
 * classifier fails CLOSED: an unclassifiable tree returns empty rather than
 * hashing un-vetted bytes in-scope (CWE-22 belt-and-suspenders).
 *
 * @param {string} root  the declared worktree root to snapshot
 * @param {function} classify  (absPath, root) -> { escaped, sha256, ... } (K7 gate)
 * @returns {Object<string, {sha256: string|null, size: number, mtimeMs: number, kind: string}>}
 */
function snapshotTree(root, classify) {
  const out = {};
  if (typeof root !== 'string' || root.length === 0) return out;
  if (typeof classify !== 'function') return out; // fail-closed: no classifier → no in-scope hashing
  let rootStat;
  try {
    rootStat = fs.statSync(root);
  } catch {
    return out; // missing root → empty snapshot (a clean baseline)
  }
  if (!rootStat.isDirectory()) return out;

  // Iterative BFS over a queue of absolute dirs (no recursion → no stack blowup
  // on a deep tree). `relTo` carries the relative prefix for keying.
  const queue = [{ abs: root, rel: '' }];
  let visited = 0;
  while (queue.length > 0 && visited < MAX_ENTRIES) {
    const { abs, rel } = queue.shift();
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue; // unreadable dir → skip (fail-soft on the walk; security is per-file)
    }
    for (const dirent of entries) {
      if (visited >= MAX_ENTRIES) break;
      visited += 1;
      const childAbs = path.join(abs, dirent.name);
      const childRel = rel ? `${rel}/${dirent.name}` : dirent.name;
      // Classify EVERY visited path through the injected K7-delegating classifier.
      // An escaping symlink (leaf or ancestor) is recorded as symlink-escape and
      // is never descended into nor hashed in-scope.
      const cls = classify(childAbs, root);
      if (cls.escaped) {
        out[childRel] = { sha256: null, size: 0, mtimeMs: 0, kind: 'symlink-escape' };
        continue; // do NOT descend through an escaping link (TOCTOU fail-closed)
      }
      // In-scope. A real directory is enqueued for descent; a file is hashed.
      let lst;
      try {
        lst = fs.lstatSync(childAbs);
      } catch {
        out[childRel] = { sha256: null, size: 0, mtimeMs: 0, kind: 'unresolvable' };
        continue;
      }
      if (lst.isDirectory()) {
        queue.push({ abs: childAbs, rel: childRel });
        continue;
      }
      out[childRel] = {
        sha256: cls.sha256,
        size: lst.size,
        mtimeMs: lst.mtimeMs,
        kind: 'file',
      };
    }
  }
  return out;
}

/**
 * Pure compare of two snapshots. Returns one record per path that DIFFERS
 * (changed content, or appeared/vanished). An unchanged file is omitted from
 * the changed set (callers filter on `.changed`). Does not mutate its inputs.
 *
 * theo-LOW (deliberately-ahead-of-consumer, NOT load-bearing in 4a): this whole-
 * tree comparator is the natural other half of snapshotTree and ships dormant
 * alongside it. v3.0-alpha's orchestrator detection is SINGLE-target
 * (classifyTarget on ctx.targetPath) and does NOT route through diffSnapshots —
 * the whole-tree diff is reserved for the 4b multi-write / recovery-sweep path.
 * A reader should not infer the 4a detection path is snapshot-diff-driven; it is
 * not (the pre-snapshot only fingerprints a single out-of-scope target's pre-hash).
 *
 * @param {Object} pre   snapshot before
 * @param {Object} post  snapshot after
 * @returns {Array<{path: string, sha256_pre: string|null, sha256_post: string|null, changed: boolean}>}
 */
function diffSnapshots(pre, post) {
  const preMap = pre && typeof pre === 'object' ? pre : {};
  const postMap = post && typeof post === 'object' ? post : {};
  const paths = new Set([...Object.keys(preMap), ...Object.keys(postMap)]);
  const result = [];
  for (const p of paths) {
    const a = preMap[p];
    const b = postMap[p];
    const shaPre = a ? (a.sha256 === undefined ? null : a.sha256) : null;
    const shaPost = b ? (b.sha256 === undefined ? null : b.sha256) : null;
    // A change is: present on exactly one side, OR differing content hashes, OR
    // a kind transition (e.g. file → symlink-escape) which is security-relevant
    // even when both hashes are null.
    const kindPre = a ? a.kind : null;
    const kindPost = b ? b.kind : null;
    const changed = (!a !== !b) || shaPre !== shaPost || kindPre !== kindPost;
    result.push({
      path: p,
      sha256_pre: shaPre,
      sha256_post: shaPost,
      changed,
      kind_pre: kindPre,
      kind_post: kindPost,
    });
  }
  return result;
}

module.exports = {
  snapshotTree,
  diffSnapshots,
  MAX_ENTRIES,
};
