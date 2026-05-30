'use strict';

// packages/kernel/_lib/k14-symlink-guard.js
//
// K14 — symlink / TOCTOU guard (v3.0-alpha, PR-4a). One of the three mandatory-
// split K14 leaves (ADR-0011 §K14-split). SRP role = the load-bearing SECURITY
// boundary: classify a candidate path as in-scope vs symlink-escape vs
// unresolvable, NEVER trusting an escaping/unresolvable target as in-scope.
//
//   DAG: orchestration → {snapshot, tail-window, symlink-guard}. This leaf MUST
//   NOT import the orchestrator k14-write-scope (no back-edge — Martin
//   acyclic-dependencies / morning-after-syndrome guard).
//
// CWE-22 / TOCTOU: every classification routes through K7 checkWithinRoot
// (packages/kernel/_lib/path-canonicalize.js) — the SINGLE canonicalization
// source of truth in the kernel (F14 DRY). A symlink inside the worktree that
// resolves OUTSIDE the root (leaf symlink OR symlinked ancestor) is the exact
// place a TOCTOU / symlinked-ancestor escape sneaks out-of-scope bytes into an
// in-scope hash; this guard fails CLOSED — escaped/unresolvable paths get
// sha256:null and are never read into the in-scope content hash.

const fs = require('fs');
const crypto = require('crypto');
const { checkWithinRoot } = require('./path-canonicalize');

// >1MB files use a streaming hash to avoid loading the whole buffer into memory
// on the event loop (node-runtime-basics: never JSON.parse / read a large buffer
// synchronously into one allocation when a chunked path exists). Small files use
// a single readFileSync — cheaper, and the kernel snapshot is bounded.
const LARGE_FILE_BYTES = 1024 * 1024;

/**
 * Content-hash any readable regular-file path. Fails closed: any read error
 * (race, permission, vanished file) returns null rather than throwing, so a
 * classification never trusts a half-resolved read.
 *
 * NOTE on the name: `resolvedPath` is an aspirational convention, NOT a runtime
 * precondition — this function performs no scope/realpath verification of its
 * own (it merely open()s the path, which follows symlinks). Callers MUST gate
 * on scope + regular-file-ness BEFORE calling (classifyPath does the K7 scope
 * gate; hashFileUnconditional in the orchestrator gates on lstat isFile()).
 * blair-LOW: the doc previously implied the function verifies realpath — it does
 * not; the precondition is the caller's obligation.
 *
 * @param {string} resolvedPath  a readable regular-file path (caller-verified)
 * @param {number} size          stat size (selects the hashing strategy)
 * @returns {string|null} 64-hex sha256, or null on any read failure
 */
function hashInScopeFile(resolvedPath, size) {
  try {
    const hash = crypto.createHash('sha256');
    if (typeof size === 'number' && size > LARGE_FILE_BYTES) {
      // Large-file hash-only strategy: chunked read keeps a >1MB file off a
      // single 1MB+ allocation. fd is always closed (no leaked descriptor).
      const fd = fs.openSync(resolvedPath, 'r');
      try {
        const buf = Buffer.allocUnsafe(64 * 1024);
        let bytesRead = fs.readSync(fd, buf, 0, buf.length, null);
        while (bytesRead > 0) {
          hash.update(buf.subarray(0, bytesRead));
          bytesRead = fs.readSync(fd, buf, 0, buf.length, null);
        }
      } finally {
        fs.closeSync(fd);
      }
    } else {
      hash.update(fs.readFileSync(resolvedPath));
    }
    return hash.digest('hex');
  } catch {
    return null;
  }
}

/**
 * Classify a candidate path relative to the worktree root.
 *
 * Delegates the escape decision to K7 checkWithinRoot, which owns the syntactic
 * `..`/null-byte screen, the symlink-resolving canonicalization, AND the reason
 * taxonomy ('traversal-markers' | 'escapes-root' | 'absolute-outside-root').
 *
 * THE LEAF OWNS THE FULL CLASSIFICATION (theo-HIGH-3 / blair-PRINCIPLE-1 /
 * eli-LOW): the return SURFACES K7's `reason` token AND splits the two distinct
 * out-of-namespace cases into separate kinds, so the orchestrator dispatches on
 * `kind` alone and NEVER re-calls checkWithinRoot to re-derive the reason. This
 * closes the information-hiding leak (the escape-reason decision lived in two
 * modules) AND removes the double realpath walk + its TOCTOU window on the
 * reason re-check (kb:architecture/crosscut/information-hiding — count the
 * modules that change if the reason taxonomy evolves: now exactly one).
 *
 * Outcomes (fail-closed — never trust an ambiguous result as in-scope):
 *   - kind:'symlink-escape'  escaped:true  reason:'escapes-root'|'traversal-markers'
 *       sha256:null — lexically inside root but resolves outside (symlinked leaf
 *       OR ancestor), OR a `..`/null-byte traversal candidate. NEVER hashed.
 *   - kind:'out-of-scope'    escaped:true  reason:'absolute-outside-root'
 *       sha256:null — lexically + absolutely outside every root (a sibling that
 *       never entered the namespace). NEVER hashed in-scope by this leaf.
 *   - kind:'unresolvable'    escaped:true  reason:'unresolvable'  sha256:null —
 *       broken/dangling symlink or stat failure: treated as out-of-scope.
 *   - kind:'in-scope'        escaped:false reason:null  sha256:<hex|null> — a real
 *       in-scope file; the content hash is attached when readable.
 *
 * @param {string} candidatePath
 * @param {string} worktreeRoot
 * @returns {{ kind: 'in-scope'|'symlink-escape'|'out-of-scope'|'unresolvable', sha256: string|null, escaped: boolean, reason: string|null }}
 */
function classifyPath(candidatePath, worktreeRoot) {
  const scope = checkWithinRoot(candidatePath, worktreeRoot);
  if (!scope.ok) {
    // K7 already discriminated WHY the path is out of namespace; surface its
    // reason and split the kind so the orchestrator never re-derives it:
    //   'escapes-root' / 'traversal-markers' → symlink-escape (inside-resolves-out
    //       or a `..`/null-byte marker), NEVER hashed.
    //   'absolute-outside-root'              → out-of-scope (a lexical sibling).
    // Both are escaped:true and never trusted in-scope.
    const kind = scope.reason === 'absolute-outside-root' ? 'out-of-scope' : 'symlink-escape';
    return { kind, sha256: null, escaped: true, reason: scope.reason };
  }
  // In-scope per K7. Resolve + stat to (a) reject a dangling symlink that K7's
  // lenient canonicalize tolerates (non-existent leaf), and (b) pick the hashing
  // strategy. Any stat/realpath error fails closed to 'unresolvable'.
  let resolved;
  let st;
  try {
    resolved = fs.realpathSync(candidatePath);
    st = fs.lstatSync(resolved);
  } catch {
    return { kind: 'unresolvable', sha256: null, escaped: true, reason: 'unresolvable' };
  }
  if (st.isDirectory()) {
    // A directory is in-scope structure, not a hashable leaf.
    return { kind: 'in-scope', sha256: null, escaped: false, reason: null };
  }
  return { kind: 'in-scope', sha256: hashInScopeFile(resolved, st.size), escaped: false, reason: null };
}

module.exports = {
  classifyPath,
  hashInScopeFile,
  LARGE_FILE_BYTES,
};
