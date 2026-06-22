'use strict';

// ③.2.2c — gradeLiveIssueSemantic: a SHADOW verdict for a LIVE (public-only) GitHub issue.
//
// Composes ONLY the oracle-FREE legs (B = blind semantic judge, D = friction diagnostic). A live
// issue has NO sealed oracle (no test_patch / accepted_diff), so the behavioral leg is structurally
// UNAVAILABLE and the reference (oracle) leg is never invoked. The verdict carries NO
// score/grade/pass/overall/reference/recall_eligible key — it is a set of structural markers, NEVER
// a proof-of-fix and NEVER a gate (OQ-NS-6: only a maintainer merge hardens; this only narrows).
//
// semantic_supported:true means a BLIND reviewer found the patch plausible — NOT that it fixes the
// issue. behavioral:'UNAVAILABLE' is the honest absence of an oracle.

const crypto = require('crypto');
const { buildActorInput } = require('./calibration-issue');
const { buildFrictionLabelerInput, validateResolutionFriction } = require('./trajectory-friction');

// Matches the internal digest() of calibration-issue.js / trajectory-friction.js (neither exports
// it): a 16-hex sha256 prefix. Privacy-preserving reference handed to the friction labeler.
function digest(s) {
  return crypto.createHash('sha256').update(String(s == null ? '' : s)).digest('hex').slice(0, 16);
}

// Normalize a leg-B judge return to a strict tri-state boolean|null (fail-closed to null).
function readSupported(b) {
  if (!b || typeof b !== 'object' || !('supported' in b)) return null;
  if (b.supported === true) return true;
  if (b.supported === false) return false;
  return null;
}

// gradeLiveIssueSemantic({ record, candidate, semanticFn, frictionFn, processGraph })
// - record: a public-only corpus record ({id, repo, base_sha, problem_statement}).
// - candidate: the candidate patch (unified diff string).
// - semanticFn(actorInput, candidatePatch): the (tool-pinned) blind judge; fail-closed -> supported:null.
// - frictionFn(labelerInput): the (tool-pinned) friction labeler; report-only; fail-closed -> null.
// - processGraph: optional process-graph metrics for the friction leg (null degrades to metrics-only).
// Returns a FROZEN SHADOW verdict.
async function gradeLiveIssueSemantic({ record, candidate, semanticFn, frictionFn, processGraph = null } = {}) {
  if (!record || typeof record !== 'object') throw new Error('gradeLiveIssueSemantic: record required');
  if (typeof semanticFn !== 'function') throw new Error('gradeLiveIssueSemantic: semanticFn required');
  const candidatePatch = String(candidate == null ? '' : candidate);

  // Leg B — blind semantic judge. A public-only record has no criteria_only_rubric, so the public
  // projection (buildActorInput == splitRecord(record).public) IS the blind input; no rubric leak path.
  const legBInput = buildActorInput(record);
  let semanticSupported = null;
  try {
    semanticSupported = readSupported(await semanticFn(legBInput, candidatePatch));
  } catch {
    semanticSupported = null; // fail-closed: a thrown judge never launders into a positive signal
  }

  // Leg D — friction diagnostic (report-only, public-safe). Optional: absent frictionFn -> null.
  let friction = null;
  if (typeof frictionFn === 'function') {
    try {
      const labelerInput = buildFrictionLabelerInput({
        problem_statement_digest: digest(record.problem_statement),
        candidate_patch: candidatePatch,
        processGraph,
      });
      friction = validateResolutionFriction(await frictionFn(labelerInput));
    } catch {
      friction = null;
    }
  }

  return Object.freeze({
    behavioral: 'UNAVAILABLE', // no oracle for a live issue (honest absence, not a FAIL)
    semantic_supported: semanticSupported, // true | false | null — plausibility, NOT a fix proof
    friction, // a frozen friction block | null (report-only)
    oracle: 'none',
    shadow: true,
  });
}

module.exports = { gradeLiveIssueSemantic, digest, readSupported };
