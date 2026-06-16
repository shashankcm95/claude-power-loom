#!/usr/bin/env node

// @loom-layer: lab
//
// v3.11 W1 — the lesson DERIVATION leg. PURE: the impure real leg (claude -p contrast)
// is INJECTED (the deriveFn seam), so this module is CI-testable with mocks; the real
// leg lives in _spike/lesson-capture-rerun.js (out of the unit glob). Structurally
// lab-only — no enforced path, never a kernel primitive (ADR-0012 makes per-spawn
// injection impossible anyway).
//
// The leg is a TEACHING leg (like leg C): it MAY see the sealed accepted_diff to
// contrast it against the candidate. But its OUTPUT lesson_body is LEAK-GUARDED — a body
// that shares a long run with the sealed diff means the leg quoted the answer key, so the
// WHOLE leg output is suspect and we fail-closed (do NOT trust its classification either).
// The closed-enum classification is validated against the FROZEN floor; an off-floor leg
// output is a malfunction -> harness_fallback (never mint an INVALID-keyed garbage lesson).
//
// v3.11 W3 — the trap seam: contrastInput MAY carry an OPTIONAL `failed_patch` (a FAILED
// attempt's wrong-diff). It makes the gotcha legible (`contrast(wrong-diff, accepted-fix)`)
// and is FORWARDED to the leg verbatim. It is UNSEALED (a wrong attempt is not the answer
// key), so it is NOT added to the leak-guard needle — the OUTPUT body is still scanned ONLY
// against `accepted_diff` (a body echoing a run that happens to live in BOTH the failed patch
// and the accepted diff is still caught, since the guard scans body-vs-accepted regardless of
// which input inspired it). The caller (lesson-capture) length-bounds `failed_patch` (the new
// untrusted input surface) before it reaches here.

'use strict';

const { TRIGGER_CLASS, GOTCHA_CLASS, CORRECTIVE_CLASS, lessonClusterKey, lessonLeaks, LESSON_BODY_MAX } = require('./lesson-signature');

// LESSON_BODY_MAX (imported) is the SHARED mint+read bound: a derived lesson is 1-2 sentences; an
// oversize body is abnormal (a malfunctioning or adversarial leg). Cap it BEFORE the O(body x accepted)
// lessonLeaks scan (VALIDATE-hacker M1: bound the model-controlled needle so a giant body can not DoS
// the leak check). recall-graph's classifyLessonLayer enforces the SAME bound on the read path (M-c).

function harnessFallback(reason) {
  return { ok: false, outcome_source: 'harness_fallback', fallback_reason: reason, lesson: null };
}

// contrastInput: { problem_statement_digest, candidate_patch, accepted_diff, failed_patch? }.
// (`failed_patch` optional — the W3 trap seam; forwarded to the leg, not leak-guarded; see above.)
// deriveFn: injected; may be sync or async; may throw. Returns the validated result:
//   { ok:true, outcome_source:'model', lesson:{trigger_class,gotcha_class,corrective_class,lesson_body,lesson_signature} }
//   | { ok:false, outcome_source:'harness_fallback', fallback_reason, lesson:null }
async function deriveLesson(contrastInput, deriveFn) {
  const accepted = contrastInput && contrastInput.accepted_diff;
  let raw;
  try { raw = deriveFn ? await deriveFn(contrastInput) : null; }
  catch { return harnessFallback('derive-threw'); }
  if (!raw || typeof raw !== 'object') return harnessFallback('derive-empty');

  const { trigger_class, gotcha_class, corrective_class } = raw;
  if (!TRIGGER_CLASS.includes(trigger_class) || !GOTCHA_CLASS.includes(gotcha_class) || !CORRECTIVE_CLASS.includes(corrective_class)) {
    return harnessFallback('off-floor-enum');
  }

  const lesson_body = raw.lesson_body == null ? '' : String(raw.lesson_body);
  if (lesson_body.length > LESSON_BODY_MAX) return harnessFallback('lesson-body-oversize'); // bound the leak scan (M1)
  // leak-guard BEFORE trusting the key (the closed-enum key is exempt; the prose is the leak vector).
  if (lessonLeaks(lesson_body, accepted)) return harnessFallback('lesson-leak');

  return {
    ok: true,
    outcome_source: 'model',
    lesson: {
      trigger_class, gotcha_class, corrective_class, lesson_body,
      lesson_signature: lessonClusterKey({ trigger_class, gotcha_class, corrective_class }),
    },
  };
}

module.exports = { deriveLesson };
