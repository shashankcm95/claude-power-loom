#!/usr/bin/env node

// @loom-layer: lab
//
// 3.1-W4c -- the earned-grounding RUN driver. Two sequential phases over the corpus:
//   PHASE 1 (earnLesson): run a real `claude -p` actor AS `python-backend` over a corpus
//     issue (candidate A) -> HARNESS-grade via the full scoreAttempt 4-leg assembly (leg-derived
//     recall_eligible, the C1 test_tree_mutated->FAIL gate built in) -> inject built_by + mint the
//     lesson node (captureLessons) -> run a SECOND distinct actor (candidate B), grade it, and
//     CONFIRM the lesson via runConfirmationPass (the `(node)--confirmed-by-->(delta_B)` edge).
//   PHASE 2 (runExperimentPhase): GATED on >=1 confirmed lesson + a non-empty grounding slice; run
//     `runExperiment` (arms A/B/C) per record so arm C slices the earned lessons, then compareArms.
//
// THE COMPOSITION DISCIPLINE (architect Principle Audit): this driver COMPOSES the mapped seams --
// makeRealSolve / scoreAttempt / makeBehavioralFn / captureLessons / runConfirmationPass /
// runExperiment / createDockerBackend -- and adds NO new grading/confirmation logic, only
// orchestration. The grader is the injected Docker backend (DIP). Every verdict is HARNESS-computed,
// NEVER self-asserted by the actor or the driver.
//
// VERIFY GATES (the load-bearing pre-build folds, all implemented here):
//   F1  -- the captureLessons item threads fail_to_pass + accepted_diff, AND assertNodeRequirement
//          asserts node.fail_to_pass exact-matches the corpus requirement BEFORE the 2nd actor run.
//   H-1 -- candidate A is graded via the full scoreAttempt (the test_tree_mutated->BEHAVIORAL_FAIL
//          gate is built in); candidate B's confirming attempt is REFUSED on graded_B.test_tree_mutated.
//   H-2 -- assertCanonicalRole at MINT: built_by.role must canonicalize to itself AND be the bare
//          `python-backend` (a numbered/laundered form fails closed before any node is written).
//   F4  -- groundingNonEmpty gates Phase 2 (arm C is mechanically identical to arm B until the
//          confirmed edge exists; do not run the experiment on an inert slice).
//   L-1 -- assertGithubRepo: a per-issue github.com host allowlist before the unsandboxed actor clone.
//   M-1 -- reapOrphans in a finally at batch end (an orphaned container leak on a mid-batch SIGKILL).
//
// FAIL-CLOSED FLOOR (the honest floor): any actor/backend/grade failure -> NOT-confirmed / not-run,
// NEVER a false confirm. The honest floor is >=1 confirmed lesson; if zero, the report says
// n_confirmed:0 with NO synthesis (hand-minting an edge is the #273 forged-edge class security.md forbids).
//
// K12: imports ONLY lab siblings + node core at module load. child_process / docker-backend /
// real-solve / calibration-issue-run are LAZY-required INSIDE `main` (or the seam thunks it builds),
// so the pure helpers + seam-injected orchestration require with NO child_process load. The mock-only
// unit test injects every async seam + sabotages child_process to prove the path never spawns.

'use strict';

// Lab siblings ONLY at module load (PURE + CI-safe; none of these transitively pull child_process).
const { canonicalPersonaKey } = require('./canonical-persona-key');
const { buildGroundingSlice } = require('./grounding-slice');
const { runExperiment } = require('./arm-loop');
const { compareArms } = require('./arm-query');
const { sameRequirement } = require('../causal-edge/lesson-confirm');

// The subject persona for the whole run (bare agentType -- the canonical direction; a numbered
// `17-python-backend` form is a laundering lever the H-2 assert rejects).
const SUBJECT_PERSONA = 'python-backend';
// The literal the harness leg yields for a resolved run -- the ONLY value buildConfirmingAttempt
// stamps on a confirming attempt's behavioral_verdict (never the actor's self-claim).
const BEHAVIORAL_PASS = 'BEHAVIORAL_PASS';
// Re-roll candidate B up to this many times on a sha-collision before moving on (a trivial fix risks
// byte-identical actor diffs -> no distinct B; on cap-exhaustion we drop the lesson, never hard-fail).
const DEFAULT_MAX_REROLL_B = 3;

// --------------------------------------------------------------------------
// PURE helpers (unit-tested directly; no async, no FS, no child_process).
// --------------------------------------------------------------------------

// L-1 -- the SSRF allowlist for the unsandboxed actor clone. W4d A1 folded this into the SHARED
// clone-lifecycle guard `assertSafeRepo`, which now enforces the SAME contract: https-only, a
// host-allowlist (defaulting to github.com), and the raw-string parser-differential guard
// (`@`/backslash/whitespace/control rejected BEFORE the WHATWG parse normalizes a `\@` differential
// away). This is now a THIN DELEGATE that pins the github.com allowlist explicitly (a caller-injected
// `hostAllowlist` OVERRIDES the env, so the per-issue actor clone stays github.com-only even if the
// grader's LOOM_CLONE_HOST_ALLOWLIST is ever widened) and disallows a host-local path. The thrown
// messages come FROM assertSafeRepo (generic + value-redacted); the 6 assertGithubRepo tests match
// those substrings. `assertSafeRepo` is lazy-required (K12: it pulls child_process at module load).
function assertGithubRepo(repo) {
  const { assertSafeRepo } = require('../issue-corpus/_clone-lifecycle');
  return assertSafeRepo(repo, { allowLocal: false, hostAllowlist: ['github.com'] });
}

// H-2 -- the mint-time provenance assert. built_by.role is UNAUTHENTICATED (a faceless actor LABELED
// python-backend, never a persona that provably ran); this guards the laundering lever -- the role must
// canonicalize to ITSELF (the bare form, so a numbered `17-python-backend` is rejected, not folded) AND
// equal the subject persona. Throws (fail-closed) so no node is ever written under a laundered label.
function assertCanonicalRole(role, knownPersonas) {
  const canon = canonicalPersonaKey(role, knownPersonas == null ? {} : { knownPersonas });
  if (canon == null) throw new Error(`assertCanonicalRole: role does not canonicalize to a known persona: ${JSON.stringify(role)}`);
  if (canon !== role) throw new Error(`assertCanonicalRole: role must be the canonical bare form (got ${JSON.stringify(role)}, canonical ${JSON.stringify(canon)})`);
  if (canon !== SUBJECT_PERSONA) throw new Error(`assertCanonicalRole: role must be ${SUBJECT_PERSONA}, got ${JSON.stringify(role)}`);
  return canon;
}

// Build the VERIFIED confirming-attempt the confirm gate (lesson-confirm.js confirmsLesson) expects,
// or null (refuse). REFUSE unless gradedB EXPLICITLY proves a clean tree (H-1 for B -- a test-tree-mutating
// candidate could forge a PASS) AND gradedB.issue_tests === 'PASS'. behavioral_verdict is the FIXED
// literal BEHAVIORAL_PASS ONLY when issue_tests==='PASS' (a HARNESS-derived verdict, never an actor claim).
function buildConfirmingAttempt(record, candidateB, gradedB) {
  if (!gradedB || typeof gradedB !== 'object') return null;
  // require EXPLICIT `false` (CodeRabbit #357): a missing/undefined/0/'' test_tree_mutated is NOT
  // evidence of a clean tree -- schema drift or a dropped field must fail closed on a confirmation gate.
  if (gradedB.test_tree_mutated !== false) return null;         // H-1 for B
  if (gradedB.issue_tests !== 'PASS') return null;              // only a genuinely-resolved B confirms
  if (typeof candidateB !== 'string' || candidateB.length === 0) return null;
  return {
    issue_id: record.id,
    fail_to_pass: record.fail_to_pass,                          // CORPUS-declared (rode from record, not caller-chosen)
    candidate_patch: candidateB,
    behavioral_verdict: BEHAVIORAL_PASS,                        // the literal, only on a real PASS
  };
}

// The distinctness precondition for a confirming delta: candidate B, candidate A, and the accepted
// (ground-truth) diff ref must be pairwise-distinct, none empty. A non-distinct B is no evidence (the
// confirm gate also rejects self-confirmation / ground-truth-as-confirmation, but this is the cheap
// pre-check before spending the confirm pass).
function isDistinctCandidate(shaB, shaA, acceptedDiffRef) {
  const vals = [shaB, shaA, acceptedDiffRef];
  if (vals.some((v) => typeof v !== 'string' || v.length === 0)) return false;
  return shaB !== shaA && shaB !== acceptedDiffRef && shaA !== acceptedDiffRef;
}

// requirementFor: (issue_id) -> fail_to_pass | null, over the SEALED corpus records (the W0 source of
// truth the confirm gate keys on). A missing id -> null (fail-closed; that node never confirms).
function requirementForFactory(records) {
  const byId = new Map();
  for (const r of (Array.isArray(records) ? records : [])) {
    if (r && r.id != null) byId.set(r.id, r.fail_to_pass);
  }
  return function requirementFor(issue_id) {
    return byId.has(issue_id) ? byId.get(issue_id) : null;
  };
}

// F1 cheap guard (BEFORE the 2nd actor run): the minted node MUST carry a non-empty fail_to_pass set
// EXACT-matching the corpus requirement for its issue -- else every confirmation silently fails the
// confirm gate's :79/:80 exact-set checks and we'd waste a second actor run. Reuses sameRequirement
// (the lab exact-set primitive: both non-empty string sets, order/multiplicity-insensitive). Throws
// on a mismatch/subset/superset so the driver fails loud at the cheap point, not silently at confirm.
function assertNodeRequirement(node, requirementFor) {
  const issueId = node && node.worked_example_ref && node.worked_example_ref.issue_id;
  const required = typeof requirementFor === 'function' ? requirementFor(issueId) : null;
  if (!sameRequirement(node && node.fail_to_pass, required)) {
    throw new Error(`assertNodeRequirement: node.fail_to_pass must exact-match the corpus requirement for ${JSON.stringify(issueId)}`);
  }
  return true;
}

// --------------------------------------------------------------------------
// PHASE 1 -- earnLesson: one corpus issue -> at most one CONFIRMED python-backend lesson.
//
// Every async seam is INJECTED (mirroring real-solve's behavioralFnFactory) so the unit test drives
// this with mocks + a sabotaged child_process and NEVER spawns. `runActor(record)` -> {candidate, sha}
// (or {ok:false}); `scoreFn(record, candidate)` -> the scoreAttempt result; `behavioralFn(record,
// candidate)` -> a makeBehavioralFn-shaped grade {issue_tests, test_tree_mutated, ...}; `captureFn`
// -> the minted node (in main: a captureLessons wrapper returning minted[0]); `confirmFn` ->
// runConfirmationPass's result {n_confirmed, ...}.
// --------------------------------------------------------------------------

async function earnLesson({
  record, runActor, scoreFn, behavioralFn, captureFn, confirmFn,
  knownPersonas, rosterName = 'rhea', maxRerollB = DEFAULT_MAX_REROLL_B, confirmModel,
} = {}) {
  if (!record || typeof record !== 'object') throw new Error('earnLesson: a corpus record is required');
  assertGithubRepo(record.repo);                                // L-1: github.com-only before any clone
  const requirementFor = requirementForFactory([record]);
  let nActorRuns = 0;

  // 1) candidate A -- the real actor (injected seam). A failure -> not-confirmed, fail-closed.
  const a = await runActor(record);
  nActorRuns += 1;
  if (!a || a.ok === false || typeof a.candidate !== 'string' || a.candidate.length === 0) {
    return { confirmed: false, node_id: null, n_actor_runs: nActorRuns, reason: 'actor-A-unavailable' };
  }

  // 2) grade A via the FULL scoreAttempt (leg-derived recall_eligible; the test_tree_mutated->FAIL
  //    gate is built into the verdict -- H-1 for A). Never trust the actor's self-claim.
  const attempt = await scoreFn(record, a.candidate);
  if (!attempt || attempt.recall_eligible !== true) {
    return { confirmed: false, node_id: null, n_actor_runs: nActorRuns, reason: 'A-not-recall-eligible' };
  }

  // 3) inject built_by on a FRESH attempt object (immutability -- never mutate scoreFn's return), then
  //    H-2 assert the role canonicalizes to the bare python-backend BEFORE the mint.
  const builtBy = { role: SUBJECT_PERSONA, roster_name: rosterName, actor_kind: 'claude_p' };
  assertCanonicalRole(builtBy.role, knownPersonas);
  const attemptWithTag = { ...attempt, built_by: builtBy };

  // 4) mint the lesson node (captureFn threads fail_to_pass + accepted_diff -- F1), then assert the
  //    node carries the corpus requirement BEFORE spending the second actor run (F1 cheap guard).
  const node = await captureFn({
    attempt: attemptWithTag,
    candidate_patch: a.candidate,
    accepted_diff: record.accepted_diff,
    fail_to_pass: record.fail_to_pass,
  });
  if (!node || typeof node.node_id !== 'string') {
    return { confirmed: false, node_id: null, n_actor_runs: nActorRuns, reason: 'lesson-not-minted' };
  }
  assertNodeRequirement(node, requirementFor);

  // 5) confirm: a SECOND distinct passing actor diff (candidate B). INDEPENDENCE SOURCE = a DIFFERENT
  //    MODEL (confirmModel): a same-model re-roll is byte-IDENTICAL on a canonical fix (measured: two
  //    same-model clean passes collided on the SAME sha), so it can never clear the confirm gate's
  //    distinctness check (lesson-confirm.js:84). A different model genuinely diverges AND is stronger
  //    confirmation evidence (a CROSS-MODEL independent solve also passes the SEALED tests). Re-roll on a
  //    sha collision; on cap-exhaustion return not-confirmed (the floor MOVES on, never hard-fails -- F3).
  for (let i = 0; i < maxRerollB; i += 1) {
    const b = await runActor(record, { model: confirmModel });
    nActorRuns += 1;
    if (!b || b.ok === false || typeof b.candidate !== 'string' || b.candidate.length === 0) continue;
    const gradedB = await behavioralFn(record, b.candidate);
    const ca = buildConfirmingAttempt(record, b.candidate, gradedB);   // null on tree-mutated / non-PASS (H-1)
    if (!ca) continue;
    if (!isDistinctCandidate(b.sha, a.sha, node.accepted_diff_ref)) continue;  // need a distinct delta
    const r = await confirmFn([node], [ca]);
    if (r && r.n_confirmed >= 1) {
      return { confirmed: true, node_id: node.node_id, n_actor_runs: nActorRuns, reason: 'confirmed' };
    }
  }
  return { confirmed: false, node_id: node.node_id, n_actor_runs: nActorRuns, reason: 'no-distinct-passing-B' };
}

// --------------------------------------------------------------------------
// PHASE 2 -- runExperimentPhase: arms A/B/C per record so arm C slices the earned lessons.
// makeSolveFn is INJECTED (main wires makeRealSolve per issue); the unit test injects a stub so no
// real `claude -p` runs. Each record gets a FRESH solveFn (one per issue -- the CLI --solve seam
// cannot take the per-issue makeRealSolve factory; this programmatic driver is the W4c path).
// --------------------------------------------------------------------------

async function runExperimentPhase({ records, makeSolveFn, persona = SUBJECT_PERSONA, task } = {}) {
  if (typeof makeSolveFn !== 'function') throw new Error('runExperimentPhase: a makeSolveFn factory is required');
  if (typeof task !== 'string' || task.length === 0) throw new Error('runExperimentPhase: a non-empty task is required');
  const list = Array.isArray(records) ? records : [];
  const out = [];
  // SEQUENTIAL await (not Promise.all): a real claude -p actor + a Docker grade are heavy; run in
  // order rather than racing concurrent clones/containers (matches runExperiment's own arm sequencing).
  for (let index = 0; index < list.length; index += 1) {
    const record = list[index];
    // include the loop index (CodeRabbit #357): two records that sanitize to the same id in the same
    // millisecond would otherwise share a run_id and cross-contaminate the trace store + compareArms.
    const safeId = String(record.id).replace(/[^a-zA-Z0-9_-]/g, '-');
    const run_id = `w4c-${index}-${safeId}-${Date.now()}`;
    const solveFn = makeSolveFn(record);
    await runExperiment({ run_id, persona, task, solveFn });
    out.push({ run_id, compare: compareArms(run_id) });
  }
  return out;
}

// F4 -- the Phase-2 gate: the grounding slice for the persona must be NON-EMPTY. Arm C is mechanically
// identical to arm B until a confirmed edge exists, so an empty slice means Phase 2 would measure
// nothing. buildGroundingSlice reads the live stores (verify-on-read) and returns '' for an
// empty-experience / unknown persona; a non-empty block is the green light.
function groundingNonEmpty(persona, knownPersonas) {
  const slice = buildGroundingSlice(persona, knownPersonas == null ? {} : { knownPersonas });
  return typeof slice === 'string' && slice.length > 0;
}

// --------------------------------------------------------------------------
// main -- the REAL driver (NOT run by tests). Every heavy/impure dep is LAZY-required HERE so the
// test file never transitively loads child_process. main wires the real seams: makeRealSolve (the
// actor-clone solveFn), the Docker backend (the grader), captureLessons (the mint), runConfirmationPass
// (the confirm). It prints a JSON report and NEVER hand-mints -- the floor is the real >=1 confirmed.
// --------------------------------------------------------------------------

async function main(opts = {}) {
  // LAZY requires (the K12 + no-test-spawn boundary): reached only on a real run. (③.2.0-A removed the
  // direct fs/os/path clone plumbing — clone+capture now lives behind the shared _clone-lifecycle.)
  const { createDockerBackend, reapOrphans } = require('../issue-corpus/docker-backend');
  const { makeRealSolve } = require('./real-solve');
  const { resolveClaude, makeBehavioralFn, makeBlindSemanticJudge, makeReferenceTeacher } = require('../causal-edge/calibration-issue-run');
  const { makeFrictionLabeler, runActorTrajectory } = require('../causal-edge/trajectory-friction-run');
  const { scoreAttempt } = require('../causal-edge/calibration-issue');
  const { captureLessons } = require('../causal-edge/lesson-capture');
  const { runConfirmationPass } = require('../causal-edge/lesson-confirm');
  // assertSafeRepo reached via assertGithubRepo (F3 — no direct call here). ③.2.0-A: the actor clone
  // now goes through the SHARED hardened lifecycle (prepareClone + the C1-safe captureActorDiff).
  const { assertSafeSha, prepareClone, captureActorDiff, safeDiscard } = require('../issue-corpus/_clone-lifecycle');
  // The INNER claude -p contrast leg captureLessons injects into deriveLesson (NOT deriveLesson
  // itself -- captureLessons calls deriveLesson(contrastInput, deriveFn) internally; passing the
  // wrapper would null the inner leg -> off-floor fallback -> zero lessons). makeLessonDeriver is the
  // canonical real leg (lesson-derive.js header: "the real leg lives in _spike/lesson-capture-rerun.js").
  const { makeLessonDeriver } = require('../causal-edge/_spike/lesson-capture-rerun');

  const dockerBin = opts.dockerBin || 'docker';
  const task = opts.task || 'Resolve the issue described above.';
  // Candidate B's model -- a DIFFERENT engine from candidate A's (the runActorTrajectory default,
  // sonnet) so the confirming solve genuinely diverges (a same-model re-roll is byte-identical on a
  // canonical fix and can never clear the confirm gate's distinctness check).
  const confirmModel = opts.confirmModel || 'claude-opus-4-8';
  const lessonRecords = Array.isArray(opts.lessonRecords) ? opts.lessonRecords : [];
  const experimentRecords = Array.isArray(opts.experimentRecords) ? opts.experimentRecords : lessonRecords;
  // STORE CONSISTENCY (VALIDATE-reviewer HIGH): the node/edge/sidecar stores ALL resolve to the
  // LOOM_LAB_STATE_DIR default -- NO per-call dir override. This is load-bearing: arm C's
  // buildGroundingSlice (inside runExperiment) reads ONLY the default stores and takes no dir param,
  // so a custom Phase-1 write dir would make the F4 gate + arm C read an EMPTY store (Phase 2 silently
  // skipped). Run isolation is via the LOOM_LAB_STATE_DIR env (the invoker sets it), used by every store.
  const residuals = [];
  // EVERY return emits the JSON report to stdout (CodeRabbit #357) -- the fail-closed early returns must
  // NOT exit silently. mkReport normalizes the shape; finish() is the single emit+return chokepoint.
  const mkReport = (fields) => ({ ok: false, n_confirmed: 0, lesson_nodes: [], lessons: [], experiment: [], residuals, ...fields });
  const finish = (report) => { process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); return report; };

  // Fail closed when there is NO work (CodeRabbit #357): the bare CLI path main({}) defaults BOTH record
  // sets to [] -- exit ok:false rather than silently ok:true with nothing run. (An experiment-only staging
  // run keeps experimentRecords non-empty, so it is unaffected by the both-empty guard.)
  if (lessonRecords.length === 0 && experimentRecords.length === 0) {
    return finish(mkReport({ reason: 'no-records' }));
  }

  // BUILD-TIME PROBES (fail-closed, BEFORE any actor spend) -----------------
  // F5: the persona must canonicalize non-null (a cross-module premise the slice + mint rest on).
  if (canonicalPersonaKey(SUBJECT_PERSONA) == null) {
    return finish(mkReport({ reason: 'persona-uncanonical' }));
  }
  const claudeBin = opts.claudeBin === undefined ? resolveClaude() : opts.claudeBin;
  if (!claudeBin) {
    return finish(mkReport({ reason: 'claude-bin-absent' }));
  }

  // reapOrphans at batch START (reclaim a container stranded by a prior SIGKILL'd run).
  try { reapOrphans({ dockerBin }); } catch { /* docker unavailable -> attest fails below, fail-closed */ }

  let n_confirmed = 0;
  const lesson_nodes = [];
  const lessons = [];   // per-issue earn outcome (id, confirmed, reason, n_actor_runs, node_id) -- run observability
  let experiment = [];
  try {
    const backend = createDockerBackend({ env: process.env, dockerBin });
    const attest = await backend.attest();
    if (!attest || attest.attested !== true) {
      residuals.push(`backend-not-attested:${attest && attest.reason}`);
      return finish(mkReport({ reason: 'backend-not-attested' }));
    }
    const knownPersonas = undefined; // default agents/*.md glob

    // The shared real legs (the full 4-leg scoreAttempt assembly -- leg A graded through OUR Docker
    // backend, so recall_eligible is leg-derived AND the test_tree_mutated->FAIL gate is built in).
    const legs = {
      behavioralFn: makeBehavioralFn(backend),
      semanticFn: makeBlindSemanticJudge({ bin: claudeBin }),
      referenceFn: makeReferenceTeacher({ bin: claudeBin }),
      frictionFn: makeFrictionLabeler({ bin: claudeBin }),
    };
    const behavioralFn = makeBehavioralFn(backend);   // for candidate B's grade (no semantic/reference needed to confirm)
    const deriveFn = makeLessonDeriver({ bin: claudeBin });   // the inner contrast leg captureLessons injects into deriveLesson

    // The real actor seam: clone @ base_sha (host-allowlisted) -> actor -> git add -A -> diff --cached.
    // NOTE (VALIDATE-reviewer MED, DRY): this lifecycle MIRRORS real-solve.js `runActorSolve` (the
    // git add -A discipline, assertSafeRepo/assertSafeSha, MAX_PATCH_BYTES). It is duplicated (not
    // reused) ONLY because real-solve returns an arm-loop solveFn `{arm,prompt,task}`, not a candidate;
    // keep the two in sync if the clone/diff/sha discipline changes.
    const ACTOR_TOOLS = ['Read', 'Grep', 'Glob', 'Edit', 'Write'];
    const MAX_ACTOR_PATCH_BYTES = 2 * 1024 * 1024; // VALIDATE F2: mirror real-solve.js's candidate-size REJECTION ceiling
    const runActor = async (record, { model } = {}) => {
      // assertGithubRepo pins github.com (W4d A1 DRY collapse — stricter than prepareClone's env-default
      // allowlist), so it runs FIRST; prepareClone then re-validates + hardens. (③.2.0-A: mirror of
      // real-solve.js runActorSolve — the two actor paths share ONE hardened clone/capture lifecycle.)
      assertGithubRepo(record.repo); assertSafeSha(record.base_sha);
      let actorDir = null;
      try {
        const { workDir, configSnapshot } = await prepareClone({ repo: record.repo, base_sha: record.base_sha });
        actorDir = workDir;
        // `model` undefined -> runActorTrajectory's default; candidate B passes confirmModel for cross-model divergence.
        const cap = runActorTrajectory({ record, claudeBin, model, cwd: actorDir, allowedTools: ACTOR_TOOLS, timeout: opts.timeout || 240000 });
        if (!cap || cap.ok !== true) return { ok: false, reason: `actor-failed:${cap && cap.reason}` };
        // ③.2.0-A1: pristine-config restore + hardened stage/diff (an actor-poisoned filter driver cannot
        // exec); the shared maxBuffer default reconciles the prior bare 4MiB drift (VERIFY F6/A5).
        const candidate = captureActorDiff({ workDir: actorDir, configSnapshot });
        // VALIDATE F2: mirror real-solve.js's pre-grader size REJECTION (the module's "keep the two in
        // sync" contract) — fail-clean fast-exit instead of flowing a 2-5MiB candidate through the grader.
        if (Buffer.byteLength(candidate, 'utf8') > MAX_ACTOR_PATCH_BYTES) return { ok: false, reason: 'candidate-too-large' };
        const crypto = require('crypto');
        const sha = crypto.createHash('sha256').update(candidate).digest('hex');
        return { ok: true, candidate, sha };
      } catch (err) {
        return { ok: false, reason: `actor-threw:${err && err.code ? err.code : 'error'}` };
      } finally {
        if (actorDir) { try { safeDiscard(actorDir); } catch { /* best-effort */ } }
      }
    };

    const scoreFn = (record, candidate) => scoreAttempt(record, candidate, 0, legs, { tier: record.contamination_tier || 'clean-pending-probe', trajectory: null });
    // captureFn wraps captureLessons -> the single minted node (or null). provenance MUST be 'backtest'
    // (writeNode HARD-rejects otherwise -- the OQ-7 firewall); the W4c run is a backtest by construction.
    const captureFn = async (item) => {
      const res = await captureLessons([item], deriveFn, { provenance: 'backtest' });   // default stores (LOOM_LAB_STATE_DIR)
      return res.minted.length > 0 ? res.minted[0] : null;
    };
    const requirementFor = requirementForFactory(lessonRecords);
    const confirmFn = (nodes, attempts) => runConfirmationPass(nodes, attempts, { requirementFor });   // default edge/sidecar stores

    // PHASE 1 -- earn >=1 confirmed lesson over the lesson subset.
    for (const record of lessonRecords) {
      let res;
      try { res = await earnLesson({ record, runActor, scoreFn, behavioralFn, captureFn, confirmFn, knownPersonas, confirmModel }); }
      catch (err) { residuals.push(`earn-threw:${record.id}:${err && err.message}`); lessons.push({ id: record.id, confirmed: false, reason: `threw:${err && err.message}` }); continue; }
      lessons.push({ id: record.id, confirmed: res.confirmed, reason: res.reason, n_actor_runs: res.n_actor_runs, node_id: res.node_id });
      if (res.confirmed) { n_confirmed += 1; lesson_nodes.push(res.node_id); }
    }

    // PHASE 2 -- GATED on a NON-EMPTY grounding slice (F4): arm C is mechanically identical to arm B
    // until a confirmed-by edge exists, so the experiment measures nothing on an empty slice.
    // groundingNonEmpty reads the LIVE store -> it green-lights whether the confirmed lessons were
    // earned in THIS invocation OR accumulated in a prior one (the precise check, not a this-run proxy).
    if (groundingNonEmpty(SUBJECT_PERSONA, knownPersonas)) {
      const makeSolveFn = (record) => makeRealSolve({ record, backend, claudeBin, timeout: opts.timeout });
      experiment = await runExperimentPhase({ records: experimentRecords, makeSolveFn, persona: SUBJECT_PERSONA, task });
    } else {
      residuals.push('phase2-skipped:empty-slice');
    }
  } finally {
    // M-1: ALWAYS reap at batch END (a mid-batch crash could strand a container holding its --memory).
    try { reapOrphans({ dockerBin }); } catch { /* best-effort */ }
  }

  return finish({ ok: true, n_confirmed, lesson_nodes, lessons, experiment, residuals });
}

module.exports = {
  // pure helpers
  assertGithubRepo, assertCanonicalRole, buildConfirmingAttempt, isDistinctCandidate,
  requirementForFactory, assertNodeRequirement, groundingNonEmpty,
  // async orchestration (seam-injected)
  earnLesson, runExperimentPhase, main,
  // constants (for the test's reference)
  SUBJECT_PERSONA, BEHAVIORAL_PASS, DEFAULT_MAX_REROLL_B,
};

// CLI entry: `node earned-grounding-run.js` runs main() with env-derived opts. Guarded so a `require`
// (the test) never triggers it -- the test imports the helpers + seams, never main.
if (require.main === module) {
  // process.exitCode (NOT process.exit) so buffered stdout/stderr flush before exit (CodeRabbit #357).
  main({}).then((r) => { process.exitCode = r && r.ok ? 0 : 1; }).catch((e) => { process.stderr.write(`earned-grounding-run threw: ${e && e.stack}\n`); process.exitCode = 1; });
}
