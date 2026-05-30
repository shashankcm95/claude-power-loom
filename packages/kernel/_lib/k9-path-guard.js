'use strict';

// packages/kernel/_lib/k9-path-guard.js
//
// K9 — CWE-22 path guard + delta-request validation (v3.0-alpha, PR 3).
//
// One of the 3 mandatory-split K9 modules (plan line 138, jade PRINCIPLE,
// 800-LoC ceiling). SRP partition:
//   k9-path-guard.js   — INPUT VALIDATION (this file): CWE-22 write-scope +
//                        delta-SHA shape + request well-formedness.
//   k9-promote-deltas.js — ORCHESTRATION: cherry-pick transaction + abort.
//   k9-journal.js      — DURABLE AUDIT: append-only reverse-cherrypick ledger.
// DAG direction is orchestration → {path-guard, journal}. This leaf MUST NOT
// import k9-promote-deltas (no back-edge — Martin acyclic-dependencies).
//
// CWE-22: every write path is canonicalized + scoped via K7's checkWithinRoot
// (packages/kernel/_lib/path-canonicalize.js) — consumed, not re-implemented
// (F14 DRY discipline). K7 owns the only canonicalization implementation in the
// kernel; this guard is a thin, fail-closed admission layer over it.

const { checkWithinRoot } = require('./path-canonicalize');

// A git object name is 40 (sha1) or 64 (sha256) lowercase hex chars. K9 rejects
// anything else BEFORE the SHA reaches a git arg array — defense-in-depth on top
// of the execFile arg-array CWE-78 guarantee (a shell-metachar SHA can never be
// a valid object name, so this is a pure-positive allowlist, not a blocklist).
const DELTA_SHA_PATTERN = /^[a-f0-9]{40}$|^[a-f0-9]{64}$/;

/**
 * CWE-22 write-scope gate. Thin, intentional delegation to K7's checkWithinRoot
 * so K9 has exactly ONE source of truth for BOTH the symlink-resolving
 * canonicalization AND the reason taxonomy (PR 3 architect MEDIUM — K9 must not
 * re-roll the escapes-root vs absolute-outside-root discrimination K7 already
 * owns; the hand-rolled copy could diverge on a relative-path-resolving-outside
 * edge case). K9 adds only the request-level 'missing-root' token, which K7 does
 * not surface (it returns a scope token on an empty root rather than naming the
 * missing-root condition that K9's semantic-invalidity fixture pins).
 *
 * Fail-closed: a non-string candidate, an empty/non-string root, or any path
 * that (after symlink resolution) escapes the root is rejected with a concrete
 * reason token. Tokens forwarded from K7: 'traversal-markers' (`..` / null-byte /
 * non-string), 'absolute-outside-root', 'escapes-root'.
 *
 * @param {string} candidatePath  write target K9 would touch
 * @param {string} worktreeRoot   the scoped root the write must stay within
 * @returns {{ok: boolean, reason: string|null}}
 */
function checkWritePathInScope(candidatePath, worktreeRoot) {
  if (typeof worktreeRoot !== 'string' || worktreeRoot.length === 0) {
    return { ok: false, reason: 'missing-root' };
  }
  // Single source of truth: K7 owns the syntactic screen, the symlink-resolving
  // canonicalization, AND the {traversal-markers, absolute-outside-root,
  // escapes-root} reason taxonomy. Forward its verdict verbatim.
  return checkWithinRoot(candidatePath, worktreeRoot);
}

/**
 * Validate a delta SHA's shape (40- or 64-char lowercase hex). Returns a result
 * object (never throws on a bad SHA — the bad SHA is the expected case).
 *
 * @param {string} deltaSha
 * @returns {{ok: boolean, reason: string|null}}
 */
function validateDeltaSha(deltaSha) {
  if (typeof deltaSha !== 'string' || !DELTA_SHA_PATTERN.test(deltaSha)) {
    return { ok: false, reason: 'invalid-delta-sha' };
  }
  return { ok: true, reason: null };
}

/**
 * Whole-request admission: validates the worktree root is present, the delta SHA
 * is well-shaped, and the write path is in scope. The single entry K9
 * orchestration calls before it ever invokes git.
 *
 * Order is deliberate (fail-closed, cheapest-first): missing root → bad SHA →
 * out-of-scope path. The SHA check runs before the path-scope check so a hostile
 * SHA is rejected even when the path happens to be in scope (the semantic-nonhex
 * fixture carries a valid path + a shell-metachar SHA).
 *
 * @param {object} req
 * @param {string} req.candidatePath
 * @param {string} req.worktreeRoot
 * @param {string} req.deltaSha
 * @returns {{ok: boolean, reason: string|null}}
 */
function admitPromoteRequest(req) {
  if (!req || typeof req !== 'object') {
    return { ok: false, reason: 'missing-request' };
  }
  const { candidatePath, worktreeRoot, deltaSha } = req;
  if (typeof worktreeRoot !== 'string' || worktreeRoot.length === 0) {
    return { ok: false, reason: 'missing-root' };
  }
  const shaRes = validateDeltaSha(deltaSha);
  if (!shaRes.ok) {
    return shaRes;
  }
  const scopeRes = checkWritePathInScope(candidatePath, worktreeRoot);
  if (!scopeRes.ok) {
    return scopeRes;
  }
  return { ok: true, reason: null };
}

module.exports = {
  checkWritePathInScope,
  validateDeltaSha,
  admitPromoteRequest,
  DELTA_SHA_PATTERN,
};
