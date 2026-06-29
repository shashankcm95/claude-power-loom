'use strict';

// @loom-layer: kernel
//
// OQ-3 kernel-seal arc - the SINGLE-SOURCE lesson-commitment primitive (moved kernel-ward in W2, fold F2).
// computeLessonCommitment content-addresses a captured lesson over EXACTLY {lesson_signature, lesson_body} via the
// kernel's canonicalJsonSerialize, so BOTH the lab capture side (live-draft-run.js) AND the kernel approval side
// (approval.js / approval-store.js / approve-cli.js) - plus W3's join-key seal + PR-A2's gate re-derive - all key
// off ONE digest basis. The single-source location is the kernel _lib (the security-critical hash can never drift
// between a lab copy and a kernel copy). SHADOW / production-inert until the loop is armed: nothing reads this
// digest into a weight yet.
//
// STRICT inputs by design: the undefined / empty-string / key-absent forms are three DISTINCT canonical bases
// (canonicalJsonSerialize emits the LITERAL token `undefined` for an undefined-valued key), so a silent hash of a
// bad input would corrupt the future seal. The helper THROWS unless BOTH fields are non-empty strings - it NEVER
// hashes `undefined`. The empty-string no-lesson sentinel is the CALLER's concern (captureLiveLesson returns '' on
// its fail-soft branches; the approval layer coerces a missing value to '' BEFORE this helper is ever reached),
// never produced HERE.
//
// Tiny + pure (no fs, no I/O). M1 forward-coupling: a drift in canonicalJsonSerialize's bytes changes this digest,
// so the known-vector test in tests/unit/kernel/_lib/lesson-commitment.test.js guards the seal against a silent
// byte drift.

const crypto = require('crypto');
const { canonicalJsonSerialize } = require('./canonical-json');

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length >= 1;
}

/**
 * Content-address a captured lesson over EXACTLY {lesson_signature, lesson_body}.
 * @param {{lesson_signature: string, lesson_body: string}} fields BOTH must be non-empty strings.
 * @returns {string} lowercase 64-hex sha256 over the canonical serialization of the two fields.
 * @throws {Error} if either field is missing / empty / not a string (never silently hashes undefined).
 */
function computeLessonCommitment(fields) {
  const f = fields || {};
  if (!isNonEmptyString(f.lesson_signature) || !isNonEmptyString(f.lesson_body)) {
    throw new Error('computeLessonCommitment: lesson_signature and lesson_body must be non-empty strings');
  }
  const basis = { lesson_signature: f.lesson_signature, lesson_body: f.lesson_body };
  return crypto.createHash('sha256').update(canonicalJsonSerialize(basis)).digest('hex');
}

module.exports = { computeLessonCommitment };
