'use strict';

// @loom-layer: lab
//
// VC-W1a — the pre-emit QUALITY verifier (SHADOW/advisory). Wraps the ContainerAdapter primitive:
// run the candidate's tests in a CONTAINED backend, map the contained result to a QUALITY verdict,
// and record it to the DEDICATED advisory sidecar. QUALITY not TRUST (OQ-NS-6): the verdict NEVER
// feeds a lab weight / world_anchored / reputation / verdict-attestation / LIVE_SOURCES — that
// disjointness is enforced structurally by trust-axis-exclusion.test.js (this module imports nothing
// from those lanes and writes only the advisory sidecar).
//
// VC-W1a scope: the verifier + the sidecar, exercised with an INJECTED backend (a MockBackend in the
// unit path). A REAL untrusted run needs the Docker backend (O-HOST), base_sha threading (O-INPUTS),
// and dependency provisioning (O-DEPS) — later waves per plans/2026-07-03-verify-container-scope.md.
// The emit-pr injected-verifier SEAM is VC-W1b. verdictOf here uses the per-nodeid `observed` map; the
// whole-suite exit-code mode is O-INPUTS/O-TESTS (deferred).

const { ContainerAdapter, RESULT_CLASS } = require('../issue-corpus/container-adapter');
const { recordVerify, assertSafeId } = require('./verify-sidecar-store');

// The QUALITY verdict from a contained run:
//   passed=true  (green)      — the suite ran and NOTHING failed (>=1 observed pass, 0 fails);
//   passed=false (red)        — a test failed;
//   passed=null  (unverified) — no contained result (SETUP_FAILURE / KILLED_FOR_DOS) OR zero observed
//                               signal. An unverified candidate is NOT "bad" — a quality gate must not
//                               block a good candidate on a flaky container (the armed fail-open-vs-
//                               closed disposition is O-DISPOSITION, VC-W2). A zero-signal run is
//                               null, NOT a vacuous green.
function verdictOf(result) {
  if (!result || result.result_class !== RESULT_CLASS.CONTAINED_RESULT) {
    return {
      passed: null,
      result_class: (result && result.result_class) || RESULT_CLASS.SETUP_FAILURE,
      reason: (result && result.reason) || 'no-contained-result',
    };
  }
  // reject an ARRAY observed (typeof [] === 'object'): Object.values(['pass']) would yield a false
  // green with no per-nodeid pass. Mirrors parseTestStatus's own `!Array.isArray` guard. Defense-in-depth
  // for a future whole-suite producer (O-INPUTS/O-TESTS) — the current adapter always returns an object.
  const observed = result.observed && typeof result.observed === 'object' && !Array.isArray(result.observed)
    ? result.observed : {};
  const statuses = Object.values(observed);
  if (statuses.some((s) => s === 'fail')) return { passed: false, result_class: result.result_class, reason: 'test-failed' };
  if (statuses.some((s) => s === 'pass')) return { passed: true, result_class: result.result_class, reason: 'all-observed-pass' };
  return { passed: null, result_class: result.result_class, reason: 'no-observed-tests' };
}

// Verify a candidate in a contained backend + record the advisory verdict. Returns a frozen result.
// Throws only on an invalid candidateId (a caller/programming error); the fail-open swallowing of a
// throw belongs to the emit-pr SEAM (VC-W1b), NOT here.
async function verifyCandidate(
  { candidateId, repo, base_sha, candidate_patch, test_patch, test_ids } = {},
  { backend, sidecarDir } = {},
) {
  assertSafeId(candidateId);   // fail-fast on a bad id BEFORE any (real) clone/run
  const adapter = new ContainerAdapter({ backend });
  const result = await adapter.run({ repo, base_sha, candidate_patch, test_patch, test_ids });
  const verdict = verdictOf(result);
  const rec = recordVerify(sidecarDir, {
    candidateId,
    base_sha: typeof base_sha === 'string' ? base_sha : '',
    result_class: verdict.result_class,
    passed: verdict.passed,
    reason: verdict.reason,
  });
  return Object.freeze({
    candidateId,
    passed: verdict.passed,
    result_class: verdict.result_class,
    reason: verdict.reason,
    record_path: rec.path,
  });
}

module.exports = { verifyCandidate, verdictOf };
