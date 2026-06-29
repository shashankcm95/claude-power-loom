#!/usr/bin/env node

// @loom-layer: lab
//
// Autonomous-SDE ladder item-3-live, PR-1 - the ORACLE-FREE live-lesson deriver. A LIVE solve (a real
// public GitHub issue solved in the contained actor) has NO sealed accepted_diff, so lesson-derive.js's
// CONTRAST rail (candidate-vs-accepted) is structurally unavailable and its lessonLeaks guard is a no-op.
// deriveLiveLesson instead maps the gradeLiveIssueSemantic SHADOW verdict's friction block +
// semantic_supported onto the EXISTING frozen lesson taxonomy (trigger/gotcha/corrective) via an INJECTED
// claude -p leg, and validates the leg output against the frozen floor exactly as deriveLesson does
// (off-floor enum -> null; never an INVALID-keyed garbage lesson). The result is a lesson HYPOTHESIS,
// weight-INERT, captured into the live_pending lane (live-pending-store.js) pending a merge-confirmation
// (PR-2). The verb is CAPTURE, never learn: behavioral is UNAVAILABLE and the node gates no weight.
//
// PURE: the impure real leg (a claude -p map) is INJECTED (the deriveFn seam), so this module is
// CI-testable with mocks; no net/exec/fs here. Structurally lab-only - never a kernel primitive.
//
// THE ATTACKER-TEXT SURFACE (VERIFY hacker H2 + M2): the deriveFn input is built from UNTRUSTED issue
// text (the model solve + the friction block). The friction `_diagnostic.{human_message,expected,observed}`
// are UNBOUNDED attacker-influenceable free-text - an LLM-injection + cost-DoS surface. We HARD-CAP each
// (FRICTION_INPUT_MAX, a module const) BEFORE the leg, mirroring live-grade.js's digest() of the problem
// statement. The deriveFn input carries ONLY the problem-statement DIGEST + the bounded friction + the
// candidate_patch_sha - NEVER the raw clone path, the API key, or any lab-state path. The OUTPUT axes are
// the frozen closed enum (off-floor -> null; never an echoed attacker span).
//
// NAMED RESIDUAL (the vacuous-leak-guard): with no accepted_diff, lessonLeaks is a no-op for a live lesson
// - the live deriver has ONE FEWER leak rail than the backtest deriver. `lesson_body` is MODEL PROSE from
// untrusted text (the closed-enum applies to the AXES only, NOT the body). Mitigation: scrubLabSecrets
// (coarse) + LESSON_BODY_MAX. Residual: a leg quoting the (already-public) problem statement verbatim is
// not caught. NAMED, not closed - the authenticated minter (item 5) is the eventual hard close.

'use strict';

const { TRIGGER_CLASS, GOTCHA_CLASS, CORRECTIVE_CLASS, lessonClusterKey, LESSON_BODY_MAX } = require('./lesson-signature');
const { validateResolutionFriction } = require('./trajectory-friction');
const { scrubLabSecrets } = require('../_lib/scrub-lab-secrets');

// The hard cap (per free-text field) on the friction _diagnostic strings forwarded to the leg. A real
// diagnostic is a short sentence; an over-cap value is attacker free-text (injection / cost-DoS). NON-
// OVERRIDABLE: a module const, never an opts knob, so a caller can never dial it off (security.md: a
// pinned guard is a hard constant, not a caller-overridable default).
const FRICTION_INPUT_MAX = 512;

/**
 * Is this SHADOW verdict eligible to mint a live_pending lesson hypothesis?
 * TRI-STATE STRICT (fail-closed): true IFF semantic_supported === true AND the friction block re-validates.
 * A `false` (NOT-plausible) or `null` (a refused/thrown judge) semantic_supported BOTH drop. The friction
 * re-validation is DEFENSIVE-REDUNDANT (live-grade already validated it via validateResolutionFriction);
 * the LOAD-BEARING half is the semantic_supported === true gate (architect fold #5).
 * @param {*} verdict the gradeLiveIssueSemantic SHADOW verdict
 * @returns {boolean}
 */
function isLiveLessonEligible(verdict) {
  if (!verdict || typeof verdict !== 'object') return false;
  if (verdict.semantic_supported !== true) return false;            // strict tri-state: false/null both drop
  return validateResolutionFriction(verdict.friction) != null;      // defensive re-validation (load-bearing half above)
}

// Bound a single free-text field to FRICTION_INPUT_MAX, returning a NEW string. null/undefined pass
// through as null (so an absent diagnostic field stays absent, never coerced to '').
function boundText(v) {
  if (v == null) return null;
  const s = String(v);
  return s.length > FRICTION_INPUT_MAX ? s.slice(0, FRICTION_INPUT_MAX) : s;
}

// Build the PUBLIC-SAFE, BOUNDED leg input: the problem-statement DIGEST + the candidate_patch_sha + the
// frozen friction AXES + the BOUNDED _diagnostic free-text + semantic_supported. NEVER the raw problem
// statement, the raw candidate bytes, the clone path, the API key, or any lab-state path. A fresh object
// (immutability) - never a mutation of the caller's verdict.
function buildLegInput({ verdict, candidate_patch_sha, problem_statement_digest }) {
  const f = verdict.friction || {};
  const d = f._diagnostic || {};
  return {
    problem_statement_digest: problem_statement_digest == null ? null : String(problem_statement_digest),
    candidate_patch_sha: candidate_patch_sha == null ? null : String(candidate_patch_sha),
    semantic_supported: verdict.semantic_supported === true,
    friction: {
      friction_class: f.friction_class,                             // the frozen closed-enum axes (the leg maps these)
      friction_phase: f.friction_phase,
      detection_leg: f.detection_leg,
      _diagnostic: {                                                // BOUNDED attacker free-text (injection + cost-DoS bound)
        human_message: boundText(d.human_message),
        expected: boundText(d.expected),
        observed: boundText(d.observed),
      },
    },
  };
}

/**
 * Derive a live_pending lesson HYPOTHESIS from a SHADOW verdict via an INJECTED leg.
 * @param {{verdict, candidate_patch_sha, problem_statement_digest}} input
 * @param {(legInput:object)=>(object|Promise<object>)} deriveFn the injected claude -p map (sync|async; may throw)
 * @returns {Promise<{trigger_class,gotcha_class,corrective_class,lesson_signature,lesson_body}|null>}
 *   null on: no leg, a thrown leg, an empty/non-object leg output, an off-floor axis, or an over-bound body.
 */
async function deriveLiveLesson(input, deriveFn) {
  const { verdict } = input || {};
  if (!verdict || typeof verdict !== 'object') return null;
  if (typeof deriveFn !== 'function') return null;                  // no leg, no lesson

  const legInput = buildLegInput(input);
  let raw;
  try { raw = await deriveFn(legInput); }
  catch { return null; }                                            // a thrown leg -> null (caller maps it to derive-threw)
  if (!raw || typeof raw !== 'object') return null;                 // empty / non-object leg output

  const { trigger_class, gotcha_class, corrective_class } = raw;
  // Validate the OUTPUT AXES against the FROZEN floor exactly as deriveLesson does - an off-floor leg
  // output is a malfunction, never a mint (the taxonomy-freeze invariant; an INVALID-keyed garbage lesson
  // would orphan on read).
  if (!TRIGGER_CLASS.includes(trigger_class) || !GOTCHA_CLASS.includes(gotcha_class) || !CORRECTIVE_CLASS.includes(corrective_class)) {
    return null;
  }

  // lesson_body is MODEL PROSE from untrusted text (the closed-enum applies to the AXES only). Bound it
  // BEFORE the scrub (an over-bound body is a malfunctioning/adversarial leg), then scrub coarsely (the
  // named vacuous-leak-guard residual: scrub + bound are the only rails for a live lesson body).
  const body = raw.lesson_body == null ? '' : String(raw.lesson_body);
  if (body.length > LESSON_BODY_MAX) return null;                   // over-bound -> reject (no truncated mint)
  const lesson_body = scrubLabSecrets(body);

  return {
    trigger_class, gotcha_class, corrective_class, lesson_body,
    lesson_signature: lessonClusterKey({ trigger_class, gotcha_class, corrective_class }),
  };
}

module.exports = { isLiveLessonEligible, deriveLiveLesson, FRICTION_INPUT_MAX };
