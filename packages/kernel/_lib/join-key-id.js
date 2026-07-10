'use strict';

// @loom-layer: kernel
//
// The SINGLE-SOURCE join-key content-address primitive (moved kernel-ward for PR-B B2, mirroring the
// lesson-commitment.js / world-anchor-edge-id.js single-source extractions). deriveJoinKeyId content-
// addresses a kernel egress join-key over EXACTLY {repo, issueRef, pr_number, approval_hash,
// lesson_commitment} via the kernel's canonicalJsonSerialize, so BOTH the join-key store (writer/reader)
// AND a lab-side RE-DERIVER (the PR-B commitment-gated admission tag, admit-world-anchor-node.js) key off
// ONE digest basis. The single-source location is the kernel _lib so the security-critical content-address
// can NEVER drift between a store copy and a re-derive copy.
//
// WHY HERE, NOT IN THE STORE: the join-key STORE carries a require-allowlist dam (join-key-shadow.test.js -
// ONLY emit-pr.js writes + merge-observer.js reads may require the store). A re-deriver that needs only the
// pure id must NOT require the store (it would trip the dam AND falsely read as a store consumer). Importing
// THIS pure primitive keeps the store's "exactly one reader" invariant intact - the re-deriver touches no
// store I/O.
//
// SHADOW / trust-inert: a pure hash; nothing here reads a weight or gates an action.
//
// COERCION CAVEAT (VALIDATE hacker NIT): every basis element is String()-coerced, so in ISOLATION
// deriveJoinKeyId({pr_number:77}) === deriveJoinKeyId({pr_number:'77'}) - a jkid collision surface. This is
// UNREACHABLE through the real stores (world-anchor-store validateAttestation + merge-outcome-store /
// join-key-store validateRecord all require issueRef/pr_number to be a positive SAFE INTEGER, so a
// string-typed int-field never persists; readAnchor returns numbers, and every consumer derives from those).
// A FUTURE consumer that feeds a RAW (non-store) record into this primitive must int-type its numeric fields
// FIRST, or it reintroduces the coercion path. The coercion itself stays (it is the pre-extraction store
// behavior, byte-for-byte - changing it would drift the seal).
//
// Tiny + PURE (no fs, no I/O). M1 forward-coupling: a byte drift in canonicalJsonSerialize changes this
// digest, so the join-key-store round-trip + full-arc tests (which assert a specific join_key_id) guard the seal.

const crypto = require('crypto');
const { canonicalJsonSerialize } = require('./canonical-json');

/** 64-hex sha256 of a string. */
function sha256hex(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

/**
 * deriveJoinKeyId(rec) -> 64-hex sha256 over the IDENTITY basis {repo, issueRef, pr_number, approval_hash,
 * lesson_commitment}. pr_url / built_by / emitted_at + the broker-sig bundle (approvedAt / nonce / key_id /
 * broker_sig) are NOT in the basis (RECORDED-not-sealed). NOTE: repo + issueRef are ALREADY inside
 * approval_hash (computeEmissionHash over {repo, issueRef, diff}); the minimal identity is {pr_number,
 * approval_hash, lesson_commitment}. Kept belt-and-suspenders to mirror world-anchor-store's {repo, issueRef,
 * diff_hash} basis shape; the redundancy is harmless (a re-emit yields the same id).
 *
 * OQ-3 W3 (RFC §5.4) — `lesson_commitment` is the 5th hashed element, SEALED: '' (no-lesson) and a 64-hex
 * commitment are distinct bases. The `== null ? ''` coercion mirrors the other positional elements - it pins a
 * missing value to the '' sentinel. (Post-#550 an undefined ARRAY element canonicalizes to `null`, matching
 * native; the coercion keeps a missing value an explicit '' rather than a positional `null`.)
 * @param {{repo, issueRef, pr_number, approval_hash, lesson_commitment}} rec
 * @returns {string} 64-hex join_key id
 */
function deriveJoinKeyId(rec) {
  const r = rec || {};
  return sha256hex(canonicalJsonSerialize([
    r.repo == null ? '' : String(r.repo),
    r.issueRef == null ? '' : String(r.issueRef),
    r.pr_number == null ? '' : String(r.pr_number),
    r.approval_hash == null ? '' : String(r.approval_hash),
    r.lesson_commitment == null ? '' : String(r.lesson_commitment),
  ]));
}

module.exports = { deriveJoinKeyId };
