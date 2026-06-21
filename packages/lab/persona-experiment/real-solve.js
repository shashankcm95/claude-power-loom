#!/usr/bin/env node

// @loom-layer: lab
//
// 3.1-W4b -- the REAL `claude -p` solve+grade driver: the injectable async `solveFn` the arm-loop
// seam expects, backed by a real actor over a corpus issue and a HARNESS-computed behavioral verdict.
//
// SEAM CONTRACT (unchanged): arm-loop calls `solveFn({ arm, prompt, task })` and AWAITS it (W4b made
// the seam async). makeRealSolve closes over the per-issue corpus `record` + the attested sandbox
// `backend` and returns that async solveFn. The factory mirrors the kernel `resolveParentFn` seam
// (dependency-inversion): arm-loop stays network-pure + CI-clean; the real driver plugs in here.
//
// CI-GREEN DISCIPLINE (FLAG-1 + architect CONFIRMED-GOOD): this module is required ONLY by the W4c
// driver + the local spike (both OUTSIDE tests/unit/**) -- arm-loop NEVER statically requires it, so
// `child_process` is never pulled into the CI-globbed arm-loop.test.js. AND the heavy deps
// (trajectory-friction-run + the git/clone work) are LAZY-required INSIDE the closure, so a
// `claudeBin=null` unit test short-circuits the whole driver BEFORE any child_process import. The
// unit suite (real-solve.test.js) injects claudeBin=null + a deterministic MockBackend and proves
// EVERY fail-closed path yields a NOT-PASS verdict, with no real subprocess spawned.
//
// HARNESS GRADE, NEVER SELF-ASSERT (the load-bearing invariant): the verdict is computed by the
// harness over the SEALED fail_to_pass/pass_to_pass via makeBehavioralFn (the proven spike path:
// prepareClone -> applyPatch(candidate) -> test-tree rehash -> applyPatch(test) -> runTests ->
// classifyRun -> parseTestStatus -> evaluateOutcome). It is NEVER parsed from the actor's stdout.
// The actor's only contribution is the git-diff of its clone (the candidate patch).
//
// PRECONDITION (hacker C1/H1, STATED not footnoted): the harness grade proves test-run INTEGRITY,
// not proof-of-fix, and is trustworthy ONLY for a NON-adversarial subject. A candidate that writes a
// non-colliding conftest.py/sitecustomize.py monkeypatch, or a later __LOOM_TEST_RESULT__ sentinel,
// can forge a BEHAVIORAL_PASS with no real fix. Acceptable in W4b ONLY because: ③.1 is SHADOW, trust
// ZERO (OQ-NS-6), the python-backend subject is non-adversarial, and the grade GATES NOTHING. The
// makeBehavioralFn `test_tree_mutated` signal is surfaced (report-only). RFC-R3 (apply test_patch
// first / snapshot-restore the test tree / diff-scope the candidate to non-test paths) + a
// first-wins/nonce sentinel are the NAMED BLOCKERS before this driver grades an adversarial/live
// candidate. SSRF (hacker H2): assertSafeRepo admits any https host + the clone is unsandboxed; W4b
// is safe ONLY because the committed corpus is github.com-only -- a host allowlist is a HARD
// precondition for any non-committed/live corpus (W4c must not inherit silently).
//
// K12: imports ONLY node core at module load + sibling lab modules LAZILY inside the closure. NO
// packages/runtime, NO packages/kernel/hooks.

'use strict';

// No node-core at module load: the clone/diff/cleanup now lives behind the SHARED hardened lifecycle
// (_clone-lifecycle), lazy-required INSIDE the closure (the CI-green gate) — so a claudeBin=null unit
// test still reaches NO child_process import.

// The three HARNESS verdicts the real driver yields (a closed set, mirrored in arm-loop's VERDICT_SET
// so observedVerdict honors them verbatim). UNAVAILABLE is the fail-closed grade -- "the grade could
// not be computed" -- and is NEVER mapped from a contained-but-failing run (that is FAIL); a false
// UNAVAILABLE-as-FAIL would pollute the A/B/C discrimination as badly as a false PASS.
const VERDICT = Object.freeze({
  PASS: 'BEHAVIORAL_PASS',
  FAIL: 'BEHAVIORAL_FAIL',
  UNAVAILABLE: 'BEHAVIORAL_UNAVAILABLE',
});

// The default actor model (claude -p has no temperature/seed flag -- only --model pins, so a real run
// is a single non-deterministic sample; OQ-NS-6: the spike is an existence-proof, not a measurement).
const DEFAULT_MODEL = 'claude-sonnet-4-6';

// The actor's clone is UNSANDBOXED on the host (it only produces a patch -- the stranger's CODE runs
// later, contained, in the grading sandbox). So the actor must NOT run arbitrary shell: DROP Bash
// from the default toolset (mirrors the real-e2e spike). It may Read/Grep/Glob/Edit/Write only.
const ACTOR_TOOLS = Object.freeze(['Read', 'Grep', 'Glob', 'Edit', 'Write']);

// A hard cap on the candidate diff before it is handed to the grader (hacker M3): an oversize diff
// is a fail-clean UNAVAILABLE, never a memory balloon into applyPatch. 2 MiB is far above any real
// single-issue fix.
const MAX_PATCH_BYTES = 2 * 1024 * 1024;

// A non-PASS result object. PURE; a fresh object every call (immutability). `reason` is a fixed,
// bounded literal (never subject content) so it is safe to carry alongside the verdict.
function unavailable(reason) { return { verdict: VERDICT.UNAVAILABLE, reason: String(reason || 'unavailable') }; }

// Map the harness behavioral result -> the closed verdict (architect HIGH-1, the three-way mapping):
//   issue_tests === 'PASS' (resolved over a CONTAINED_RESULT) -> BEHAVIORAL_PASS
//   issue_tests === 'FAIL' (contained-but-not-resolved)       -> BEHAVIORAL_FAIL
//   anything else ('FALLBACK'/refused/unavailable/missing)    -> BEHAVIORAL_UNAVAILABLE
// PASS is reachable ONLY from a genuine resolved run; an unrecognized shape fails closed to UNAVAILABLE.
function mapBehavioral(graded) {
  if (!graded || typeof graded !== 'object') return unavailable('grade-missing');
  if (graded.issue_tests === 'PASS') {
    // ③.2.1a close #1 — the test-tree-mutation gate. PREVIOUSLY this surfaced test_tree_mutated
    // report-only and returned PASS regardless (the live-path asymmetry vs scoreAttempt). Now a
    // tree-mutated PASS is FAIL, at PARITY with scoreAttempt via the SHARED isTreeMutated rule (its
    // single home is calibration-issue.js — a PURE, child_process-free sibling). LAZY-required at the
    // point of use to honor the K12 module-load discipline (no sibling-lab import at load; cached+cheap).
    const { isTreeMutated } = require('../causal-edge/calibration-issue');
    // fail-closed: a tree-mutated (or non-explicit-false) PASS can never be a clean BEHAVIORAL_PASS.
    if (isTreeMutated(graded)) return { verdict: VERDICT.FAIL, test_tree_mutated: true };
    return { verdict: VERDICT.PASS, test_tree_mutated: false };
  }
  if (graded.issue_tests === 'FAIL') {
    return { verdict: VERDICT.FAIL, test_tree_mutated: graded.test_tree_mutated === true };
  }
  return unavailable(`grade-not-contained:${typeof graded.issue_tests === 'string' ? graded.issue_tests : 'unknown'}`);
}

/**
 * Build the REAL solveFn for one corpus issue. The returned function is the async seam arm-loop
 * awaits; it OWNS the full actor-clone lifecycle (mkdtemp -> clone -> checkout -> actor -> diff ->
 * grade -> cleanup) and returns a HARNESS-computed verdict object { verdict, ... } -- never the
 * actor's self-asserted claim.
 *
 * @param {object}   opts
 * @param {object}   opts.record     the SEALED corpus issue (repo, base_sha, problem_statement,
 *                                    test_patch, fail_to_pass, pass_to_pass). The problem rides ONLY
 *                                    here (via buildActorPrompt) -- kept blind + graded.
 * @param {object}   opts.backend    a containment-ATTESTED sandbox backend (createSandboxExecBackend +
 *                                    makePytestResolver, attested ONCE per session, passed in).
 * @param {string|null} opts.claudeBin  the resolved `claude` binary. `null` short-circuits the WHOLE
 *                                    driver to UNAVAILABLE BEFORE any child_process import (the unit
 *                                    fail-closed proof + the M1 hacker target).
 * @param {string}   [opts.model]    the pinned actor model (DEFAULT_MODEL).
 * @param {number}   [opts.timeout]  the actor wall-clock (ms); threaded to runActorTrajectory.
 * @param {(record:object,extraContext:string)=>any} [opts.behavioralFnFactory]  test-only seam to
 *                                    inject a deterministic grader without the real causal-edge import.
 * @returns {(o:{arm,prompt,task})=>Promise<object>} the async solveFn for the arm-loop seam.
 */
function makeRealSolve({ record, backend, claudeBin, model = DEFAULT_MODEL, timeout, behavioralFnFactory } = {}) {
  if (!record || typeof record !== 'object') throw new Error('makeRealSolve: a corpus record is required');
  if (!record.repo || !record.base_sha) throw new Error('makeRealSolve: record.repo and record.base_sha are required');

  // The seam passes { arm, prompt, task }; this driver consumes only `prompt` (the composed
  // persona-framing delta -> the actor's extraContext). `arm`/`task` are part of the seam contract
  // but unused here -- the problem rides in `record` (the §2b contract), not in `task`.
  return async function solveFn({ prompt } = {}) {
    // FAIL-CLOSED GATE 0 (the M1 short-circuit): no actor binary -> UNAVAILABLE BEFORE any heavy
    // require. claudeBin must be EXPLICITLY provided (null = disabled); we never resolve it here, so a
    // claudeBin=null unit test reaches NO child_process import (the lazy require lives in runActorSolve).
    if (!claudeBin) return unavailable('actor-unavailable');
    // GATE 0b: no attested backend -> no grading is possible -> UNAVAILABLE (never a silent PASS).
    if (!backend || !backend.containmentAttested) return unavailable('no-attested-backend');
    return runActorSolve({ record, claudeBin, backend, prompt, model, timeout, behavioralFnFactory });
  };
}

// The actor-clone lifecycle, extracted for SRP (code-reviewer HIGH): clone @ base_sha -> run the
// actor -> stage+diff the candidate -> HARNESS-grade -> always clean up. Reached ONLY after
// makeRealSolve's fail-closed gates pass, so the lazy requires never load child_process on the
// claudeBin=null unit path.
async function runActorSolve({ record, claudeBin, backend, prompt, model, timeout, behavioralFnFactory }) {
  // LAZY-require the heavy deps INSIDE the closure (FLAG-1) -- only reached on a real run.
  const { runActorTrajectory } = require('../causal-edge/trajectory-friction-run');
  // ③.2.0-A: the SHARED hardened lifecycle owns clone+checkout (assertSafeRepo/Sha + GIT_HARDEN +
  // https-only + the clone-DoS byte cap) and the SAFE candidate capture (the C1 .git/config restore).
  const { prepareClone, captureActorDiff, safeDiscard } = require('../issue-corpus/_clone-lifecycle');
  // grader is injectable (test seam); default = the proven makeBehavioralFn (sealed-field grade + the
  // C1 test-tree-rehash that bare ContainerAdapter.run drops).
  const makeGrader = behavioralFnFactory
    || (() => require('../causal-edge/calibration-issue-run').makeBehavioralFn(backend));

  let actorDir = null;
  try {
    // clone @ base_sha for the actor to edit (unsandboxed -- it only produces a patch; the stranger's
    // CODE runs later, contained, in the grader sandbox). prepareClone validates repo+base_sha (no
    // weaker than before), bounds the clone bytes, and snapshots the PRISTINE .git/config for the C1 close.
    const { workDir, configSnapshot } = await prepareClone({ repo: record.repo, base_sha: record.base_sha });
    actorDir = workDir;
    // run the actor. §2b: the PROBLEM rides in `record` (buildActorPrompt, blind+graded); `prompt` is
    // the persona-framing DELTA -> extraContext VERBATIM (W3a fence-as-DATA applied). Bash DROPPED.
    const cap = runActorTrajectory({ record, extraContext: prompt, claudeBin, model, cwd: actorDir, allowedTools: ACTOR_TOOLS, ...(timeout ? { timeout } : {}) });
    // GATE 1 (M1): gate on cap.ok FIRST -- a failed run may have left partial edits. The KEY is cap.ok,
    // NOT "did we get a diff".
    if (!cap || cap.ok !== true) return unavailable(`actor-failed:${(cap && cap.reason) || 'unknown'}`);
    // ③.2.0-A1: restore pristine .git/config (an actor-poisoned filter driver cannot exec), then stage
    // (captures NEW Write-tool files -- hacker H-1) + diff through the hardened git. The shared default
    // maxBuffer (>1MiB) lets a legal large diff reach the size cap instead of ENOBUFS (A5).
    const candidate = captureActorDiff({ workDir: actorDir, configSnapshot });
    if (Buffer.byteLength(candidate, 'utf8') > MAX_PATCH_BYTES) return unavailable('candidate-too-large');
    // ③.2.1a close #2 (front-line diff-scope) — reject a candidate that touches a test-infra path
    // (tests/, conftest, collection config, .gitattributes) OR an unparseable hunk BEFORE grading. Uses
    // the SHARED computeTamper rule (single home in calibration-issue.js), so the grade path and the
    // scorer can never disagree on the path rule. The grader's test-tree rehash is the backstop; this is
    // the front line (a poisoned candidate never even reaches the sandbox).
    const { computeTamper } = require('../causal-edge/calibration-issue');
    if (computeTamper(candidate).forceFail) return unavailable('candidate-touches-test-infra');
    // HARNESS grade over the SEALED fields (never actor stdout). makeBehavioralFn is fail-closed
    // (FALLBACK on refuse/throw); mapBehavioral -> the three-way verdict (now tree-mutation-gated).
    const graded = await makeGrader()(record, candidate);
    return mapBehavioral(graded);
  } catch (err) {
    // any host/clone/git fault is a fail-clean UNAVAILABLE (never a thrown rejection, never a PASS).
    return unavailable(`driver-threw:${err && err.code ? err.code : 'error'}`);
  } finally {
    if (actorDir) { try { safeDiscard(actorDir); } catch { /* best-effort */ } }
  }
}

module.exports = { makeRealSolve, mapBehavioral, VERDICT, ACTOR_TOOLS, MAX_PATCH_BYTES };
