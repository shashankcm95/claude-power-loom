'use strict';

// @loom-layer: lab
//
// OQ-3 kernel-seal arc, W1 - the SINGLE-SOURCE lesson-commitment helper. computeLessonCommitment
// content-addresses a captured lesson over EXACTLY {lesson_signature, lesson_body} via the kernel's
// canonicalJsonSerialize, so the future seal (W2/W3/PR-A2 + the world-anchored weight gate) all key off
// ONE digest basis. SHADOW / production-inert in W1: nothing reads this digest into a weight yet.
//
// STRICT inputs by design: the undefined / empty-string / key-absent forms are three DISTINCT canonical
// bases (canonicalJsonSerialize emits the LITERAL token `undefined` for an undefined-valued key), so a
// silent hash of a bad input would corrupt the future seal. The helper THROWS unless BOTH fields are
// non-empty strings - it NEVER hashes `undefined`. The empty-string no-lesson sentinel is the CALLER's
// concern (captureLiveLesson returns '' on its fail-soft branches), never produced HERE.
//
// Tiny + pure (no fs, no I/O): lab -> kernel is LEGAL (canonical-json is the extracted, state-free
// encoding rule). M1 forward-coupling: a drift in canonicalJsonSerialize's bytes changes this digest, so
// the known-vector test in lesson-commitment.test.js guards the seal against a silent byte drift.

const crypto = require('crypto');
const { canonicalJsonSerialize } = require('../../kernel/_lib/canonical-json');

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
