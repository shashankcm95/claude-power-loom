#!/usr/bin/env node

// @loom-layer: lab
//
// Wave 1, autonomous-SDE ingress. The world-anchor LESSON builder: a taxonomy-compatible lesson
// for a world-anchored confirmation. It REUSES the FROZEN taxonomy from causal-edge/lesson-signature
// (lessonClusterKey + the three closed enums + LESSON_BODY_MAX)  -  NEVER re-literals them, so a
// world-anchor lesson and a recall-graph lesson share one append-only floor (lesson-taxonomy-freeze.md).
//
// For the MVP the lesson is ORCHESTRATOR-AUTHORED (not auto-derived from a live captureLessons leg  -
// that is ladder item 3, deferred). buildWorldAnchorLesson validates each class against the frozen
// member set, HARD-REJECTS (never truncates) a lesson_body over LESSON_BODY_MAX, and runs
// scrubLabSecrets over the body as COARSE defense-in-depth (the PRIMARY control being not echoing a
// secret at authorship  -  enforceable now, the backfill is orchestrator-authored).

'use strict';

const {
  lessonClusterKey, TRIGGER_CLASS, GOTCHA_CLASS, CORRECTIVE_CLASS, LESSON_BODY_MAX,
} = require('../causal-edge/lesson-signature');
const { scrubLabSecrets } = require('../_lib/scrub-lab-secrets');

/**
 * Build a taxonomy-compatible world-anchor lesson. Returns {lesson_signature, lesson_body}.
 * Throws on an off-floor enum or an over-bound body (HARD reject, never silent truncation).
 * @param {{trigger_class: string, gotcha_class: string, corrective_class: string, lesson_body: string}} block
 * @returns {{lesson_signature: string, lesson_body: string}}
 */
function buildWorldAnchorLesson(block) {
  const b = block || {};
  if (!TRIGGER_CLASS.includes(b.trigger_class)
      || !GOTCHA_CLASS.includes(b.gotcha_class)
      || !CORRECTIVE_CLASS.includes(b.corrective_class)) {
    throw new Error(`world-anchor lesson: enum off-floor / invalid: ${JSON.stringify({ trigger_class: b.trigger_class, gotcha_class: b.gotcha_class, corrective_class: b.corrective_class })}`);
  }
  if (typeof b.lesson_body !== 'string' || b.lesson_body.length === 0) {
    throw new Error('world-anchor lesson: lesson_body must be a non-empty string');
  }
  // HARD reject over the shared bound (a forged giant body cannot DoS a downstream verify-on-read;
  // symmetric with the recall-graph mint bound). Reject BEFORE the scrub so we never spend the scan
  // on an over-bound body.
  if (b.lesson_body.length > LESSON_BODY_MAX) {
    throw new Error(`world-anchor lesson: lesson_body exceeds LESSON_BODY_MAX (${b.lesson_body.length} > ${LESSON_BODY_MAX})`);
  }
  const lesson_body = scrubLabSecrets(b.lesson_body);                // coarse defense-in-depth; returns a NEW string
  return {
    lesson_signature: lessonClusterKey({
      trigger_class: b.trigger_class,
      gotcha_class: b.gotcha_class,
      corrective_class: b.corrective_class,
    }),
    lesson_body,
  };
}

// The #2137 lesson (the spec-kitty PR the ingress wave confirms). Maps to FROZEN members; the
// natural-language specifics live in lesson_body (bounded by LESSON_BODY_MAX). Orchestrator-authored.
const LESSON_2137 = Object.freeze({
  trigger_class: 'boundary-contract',
  gotcha_class: 'unguarded-edge-case',
  corrective_class: 'handle-edge-explicitly',
  lesson_body: 'A host shell script invoking bare `python` breaks on python3-only hosts '
    + '(Ubuntu/Debian, no python symlink); resolve the interpreter preferring python (honors '
    + 'venv/pyenv) then python3, erroring if neither is on PATH.',
});

module.exports = { buildWorldAnchorLesson, LESSON_2137 };
