# ③.1-W4c — Generate genuinely-earned lessons + run the 3-arm experiment (the ③.1-closing run)

- **Date**: 2026-06-18
- **Phase**: ③.1 dry-run (SHADOW, DRAFT-only, trust ZERO — OQ-NS-6)
- **Status**: COMPLETE — built, 3-lens VALIDATE (honesty-auditor Grade A), real run (`n_confirmed=1`, recall discrimination +1), PR [#357](https://github.com/shashankcm95/claude-power-loom/pull/357)
- **Branch**: `feat/w4c-earned-grounding-run` (isolated worktree `../loom-w4c`; another session is fixing bugs on `main`)
- **Closes**: ③.1 → produces the routing corpus + the earned-vs-declared discrimination measurement for Router-v2

## Goal

Make the 3-arm persona experiment run for REAL end-to-end: (1) run a real `claude -p` actor
AS `python-backend` over a corpus subset to produce genuinely-earned, persona-attributed,
harness-CONFIRMED lessons; (2) run `runExperiment` (arms A/B/C, real async solveFn) so arm C
slices those earned lessons; (3) measure the arm-C-vs-A discrimination. Everything is SHADOW —
the lessons land in the BACKTEST store (the OQ-7 firewall HARD-rejects any non-`backtest`
provenance), the apparatus NARROWS, and only a world-anchored EXTERNAL-PR merge hardens trust.

## Runtime Probes (firsthand, 2026-06-18 — claims this plan rests on)

| Claim | Probe | Result |
|---|---|---|
| **The Docker backend grades the corpus (the W4c gating blocker)** | built `loom-sandbox:latest`; graded each family's `accepted_diff` via `makeBehavioralFn(createDockerBackend({}))` | **ALL 7 families PASS, `outcome_source:model`, 1–7s each** (more-itertools, parse, networkx, faker, markdown, tabulate, pygments). The pytest-only image suffices for the WHOLE corpus — **no Dockerfile dep-extension needed.** The MEMORY blocker ("deps won't install") was FALSE for this corpus (it conflated the sandbox-exec run-time network-deny with build-time). |
| Docker is running + image buildable | `docker info`; `docker build -t loom-sandbox:latest - < .../Dockerfile` | running; image built (pytest layer CACHED from a prior build) |
| The real actor binary is present | `command -v claude` | `/Users/.../.local/bin/claude` |
| The corpus is 18 sealed staged issues | `ls .../staged/*.json \| grep -v verdict` | 18 (networkx×7, more-itertools×3, parse×3, faker×2, markdown×2, tabulate×1, pygments×1) |
| `built_by` shape passes `validatePersonaTag` | analyzer read `recall-graph.js:60-80` + `registry.js:107` | `{role:'python-backend', roster_name:'rhea'\|'devi'\|'tomas', actor_kind:'claude_p'}` PASSES all three field checks; `rhea/devi/tomas` is the exact `17-python-backend` roster |
| `scoreAttempt` never sets `built_by` | analyzer read `calibration-issue.js:260-265` | confirmed — caller must inject (CRITICAL-2) |
| Confirmation rejects a non-distinct delta | analyzer read `lesson-confirm.js:75,79,80,84,85` | `:75` requires `behavioral_verdict==='BEHAVIORAL_PASS'`; `:79/:80` both fail_to_pass sets exact-match `requirementFor`; `:84` delta≠node's own patch; `:85` delta≠accepted_diff_ref — needs a SECOND distinct passing actor diff |
| Lessons write to the BACKTEST store only | analyzer read `recall-graph-store.js:76` | `writeNode` HARD-rejects `provenance!=='backtest'` (OQ-7 firewall) — W4c is a diagnostic backtest run by construction |
| The CLI `--solve` seam can't take `makeRealSolve` directly | analyzer read `cli.js:47-74` + `real-solve.js:114` | CLI `--solve` wants a module exporting `solveFn`; `makeRealSolve` is a per-issue `{record,backend,claudeBin}` factory → **W4c needs a programmatic driver** (one fresh `solveFn` per issue), not the CLI |
| Arm B prose loads `agents/<persona>.md` | analyzer read `arm-compose.js:52-56` | `persona='python-backend'` (bare) loads `agents/python-backend.md` (W4a #353 shipped it); a numbered form fails `BARE_SHAPE` |

State claims that DECAY (re-probe at build): `LOOM_LAB_STATE_DIR` live rows; the claude bin +
Docker attest on the build host; per-issue actor PASS (nondeterministic — the honest floor).

## The composed chains (from the 4 understand-fan-out contract maps)

**Lessons-generation** (`agentId a2a7f2215abbc9be2`): per issue → real actor (candidate A) →
Docker grade (BEHAVIORAL_PASS) → build attempt with `built_by` injected → `captureLessons`
(`lesson-capture.js:45`; gate→derive→sidecar→`buildWorkedExampleNode`→`writeNode` to
`recall-graph-backtest/<node_id>.json`, `provenance:'backtest'`).

**Confirmation** (`agentId a674bc5fe469dbfe5`): a SECOND distinct actor (candidate B, PASS) →
`confirmingAttempt = {issue_id, fail_to_pass, candidate_patch:B, behavioral_verdict:'BEHAVIORAL_PASS'}`
→ `runConfirmationPass([node],[confirmingAttempt],{edgeDir,sidecarDir,requirementFor})` mints the
`(node)--confirmed-by-->(delta_B)` edge ONLY if B passes the `:75/:79/:80/:84/:85` gates.
`requirementFor = (id)=>staged[id].fail_to_pass`.

**Experiment-run** (`agentId ac8d2e5a23f343a07`): `runExperiment({run_id,persona:'python-backend',task,solveFn})`
drives arms A/B/C SEQUENTIALLY; arm C's `buildGroundingSlice` selects PREDICTOR-lane (confirmed-by)
nodes filtered by `built_by.role`==canonical(`python-backend`), recency-ordered, byte-capped.
`compareArms(run_id)` reads the persisted F7 timeline → `delta.recall_count_C_minus_A` (+
`graph_write_accrual_C_minus_A`). Pass-rate discrimination is NOT in `delta` — roll it up
manually from `byArm.{A,C}.grade_verdicts.BEHAVIORAL_PASS`.

**Real-actor + Docker** (`agentId a47bc0b2c82c22f68`): `reapOrphans({dockerBin})` at batch start →
`const backend = createDockerBackend({})` (NO `resolveTestCommand` — Docker pins the image's
python3; `makePytestResolver` is host-only) → `await backend.attest()` (async; fail-closed on
`!attested`) → `makeRealSolve({record, backend, claudeBin, model, timeout})` (omit
`behavioralFnFactory` — the default grades through your Docker `backend`). `createDockerBackend`
is in `issue-corpus/docker-backend.js`, NOT `container-adapter.js`.

## Approach — two sequential phases + one driver module

A single committed driver `packages/lab/persona-experiment/earned-grounding-run.js` (lab-sibling,
K12-clean, lazy-requires `child_process`/`real-solve` so no test transitively spawns) exporting
pure helpers + an async `main`, plus a mock-only test. The slow/nondeterministic RUN is executed
locally; its DATA (confirmed lessons, trace timelines, the discrimination numbers) lands in
`LOOM_LAB_STATE_DIR` and is reported in `## VALIDATE result` + MEMORY — NOT committed.

### Phase 1 — earn ≥1 confirmed `python-backend` lesson

1. `reapOrphans` (batch start) → build+attest ONE Docker backend (cache for the session). Build-time
   PROBES first (fail-closed, before any actor spend): `canonicalPersonaKey('python-backend')`
   returns `'python-backend'` (not null — F5); `claudeBin` non-null; backend attests.
2. Pick a DIVERSITY-FRIENDLY lesson subset (F3 — NOT one-line fixes: a trivial fix risks two
   byte-identical actor diffs → no distinct B. Prefer issues whose fix has ≥2 plausible shapes).
   Per issue, run the real actor for **candidate A** (the clone→actor→`git add -A`→`diff --cached`
   path that `real-solve.js` already hardened — captures NEW files; per-issue host allowlist
   `record.repo`∈{github.com} before clone — L-1).
3. **Grade A via the FULL `scoreAttempt(record, A, 0, legs, {tier, cloneRoot, trajectory})`** (the
   4-leg assembly from `real-e2e-actor-dogfood.js`), NOT bare `makeBehavioralFn`. This DERIVES
   `recall_eligible` from behavioral∧semantic∧clean-tier∧`outcome_source:model` AND carries the
   `test_tree_mutated→BEHAVIORAL_FAIL` gate (`calibration-issue.js:145`) by construction — closing
   **H-1** (no forged-PASS via a test-tree-mutating candidate) and **F2/Q1** (genuine, leg-derived
   eligibility — NOT driver-asserted) via the established DRY path.
4. If `attempt_A.recall_eligible`: construct a NEW attempt object `{...attempt_A, built_by}` with
   `built_by:{role:'python-backend', roster_name:'rhea', actor_kind:'claude_p'}`; **ASSERT
   `canonicalPersonaKey(built_by.role)==='python-backend'` at mint, fail-closed (H-2)**; derive the
   lesson (`{trigger_class,gotcha_class,corrective_class,lesson_body}` on the D1-frozen taxonomy);
   `captureLessons` with the item carrying **`fail_to_pass: staged[id].fail_to_pass` AND
   `accepted_diff: staged[id].accepted_diff`** (F1 — else the node lacks `fail_to_pass`/
   `accepted_diff_ref` and every confirmation silently fails). ASSERT
   `node.fail_to_pass` non-null AND `sameRequirement(node.fail_to_pass, requirementFor(id))`
   BEFORE spending the second actor run (F1 cheap guard).
5. Run the actor again for **candidate B**; grade B via `makeBehavioralFn(backend)` and **REFUSE if
   `graded_B.test_tree_mutated` (H-1 for B)**. If `B` is `BEHAVIORAL_PASS` AND
   sha(B)≠sha(A)≠accepted_diff_ref: `runConfirmationPass([node],[confirmingAttempt],{edgeDir,
   sidecarDir,requirementFor})` → the confirmed edge. Re-roll B up to ~3× on a sha collision; on
   cap-exhaustion MOVE to the next issue (don't hard-fail the floor — F3). Budget ~6–8 actor runs
   for ≥1 confirmation. `reapOrphans` again in a `finally` at batch END (M-1).
6. **Honest floor = ≥1 confirmed lesson.** If ZERO confirm, REPORT `n_confirmed=0` and STOP —
   NEVER hand-mint an edge (that is the #273 forged-edge class `security.md` forbids).

### Phase 2 — run the 3-arm experiment + measure (GATED on Phase 1)

7. **GATE (F4)**: do NOT run Phase 2 until Phase 1 reports `n_confirmed≥1` AND a smoke-check that
   `buildGroundingSlice('python-backend')` returns a NON-EMPTY block against the live
   `LOOM_LAB_STATE_DIR` — arm C is mechanically identical to arm B until the confirmed edge exists.
8. For each issue in the experiment subset: fresh `makeRealSolve` `solveFn` → `runExperiment` → 15
   trace records (arms A/B/C sequential).
9. `compareArms` per run; aggregate the headline `recall_count_C_minus_A` + a MANUAL pass-rate
   rollup over `byArm.{A,C}.grade_verdicts.BEHAVIORAL_PASS` (not in `delta`). Trace-signals PRIMARY
   (the W3/W4 metric choice); pass-rate SECONDARY + reported as UNDERPOWERED at this N (diagnostic,
   not a trust score).

## Honest residuals (state them; claim no more)

- **The confirmed edge is UNSIGNED → integrity, NOT provenance** (the #273 third face): a co-forge
  could mint a byte-identical edge via the exported `deriveEdgeId`. Tolerable here ONLY because the
  edge gates a PROMPT SLICE (arm C grounding), not an action/weight (OQ-NS-6). Signed/kernel-writer
  edges are v-next. Do not claim authenticated authorship.
- **`built_by.role` is UNAUTHENTICATED provenance** (`recall-graph.js:54-58`): a faceless actor
  LABELED `python-backend`, not a persona that provably ran. Never a trust input.
- **The W1 node's `recall_eligible` is LEG-DERIVED, not driver-asserted** (VERIFY resolution of
  Q1/F2 toward rigor — the USER's "truest earned-vs-declared test"): it comes from the full
  `scoreAttempt` (behavioral∧semantic∧clean-tier), with the `test_tree_mutated→FAIL` gate
  (H-1 closed). The node's `graded_by` stays UNATTRIBUTED (the grader is the harness, not a
  persona — we attribute the BUILDER via `built_by`, not the grader); that is honest and expected.
- **`test_tree_mutated` is now GATED, not merely surfaced** (H-1 fold): candidate A's verdict comes
  from `scoreAttempt` (which forces FAIL on a mutated tree); candidate B is refused on
  `graded_B.test_tree_mutated`. A genuine fix that legitimately adds a test file is refused (the
  SAFE direction — we'd rather drop a lesson than mint one on a possibly-gamed PASS).
- **`writeEdge` is publicly callable** (M-3 precision): `runConfirmationPass` is the only *gated*
  producer, but anyone with `LOOM_LAB_STATE_DIR` write access can co-forge a byte-valid unsigned
  edge via the exported `deriveEdgeId`+`writeCandidate`+`writeEdge` — `confirmedNodeIds` (the slice
  lane) accepts it; `authenticatedEdgeIds` (the signed lane) would not. Tolerable ONLY because the
  slice gates a PROMPT, not an action/weight. Carry: `LOOM_LAB_STATE_DIR` `0700`; the slice flips to
  `authenticatedEdgeIds` the moment it ever feeds trust (v-next signed-edge lane).
- **`lesson_body` fence-token residual** (L-2, LOW): the grounding slice control-strips, byte-caps,
  and fences lessons as "not instructions", but a body containing the literal `>>>EARNED_INSTINCTS`
  would close the fence early. Bounded (closed-taxonomy prose, control-stripped); optional escape.
- **Pass-rate discrimination is UNDERPOWERED** at a small subset N — the recall/accrual deltas are
  mechanically demonstrable; a pass-rate LIFT claim needs far more issues. Report the number, not a
  causal claim. ENGINEERED-corpus ⇒ NARROWS-not-hardens (OQ-NS-6).

## Routing Decision

```json
{ "recommendation": "root", "score_total": 0.05, "override": "route",
  "weights_version": "v1.3-dict-expanded-2026-06-12" }
```

The scorer mis-scored this `root` (the `experiment` token double-counts as both
`domain_novelty` +0.15 and a counter-signal −0.25), netting genuinely-architect-shaped work
(a security-sensitive real-subprocess + Docker + store-write run-driver, async composition across
the mapped chains, an honest-floor experiment) to a false `root`. Per `route-decide.js`'s
escalate-by-judgment comment, OVERRIDE to route. Logged as a Router-v2 corpus point
(`drift:dictionary-gap`, conv→4).

## HETS Spawn Plan

- **VERIFY (pre-build, this plan)**: **2-lens** — `architect` (read-only; decomposition +
  yield-vs-rigor + the driver factoring) **and** `hacker` (read-only; the real-subprocess +
  store-write + edge-mint surface, the confirmation gate's bypass-ability). This wave spawns a real
  `claude -p` actor and WRITES to the recall-graph/edge stores → it qualifies for adversarial
  pre-build review (unlike the additive W4a forge).
- **BUILD**: delegated `node-backend` (Write-capable) TDD-builds `earned-grounding-run.js` + its
  mock-only test (the spawn tripwire pattern from `real-solve.test.js`). The RUN itself is executed
  by the orchestrator (it's compute, not a code artifact).
- **VALIDATE (post-build)**: full **3-lens** tier on the diff — `code-reviewer` (correctness) +
  `hacker` (re-probe the BUILT driver: edge-mint forgeability, the actor sandbox, fail-closed
  grades — Rule 2a) + `honesty-auditor` (the run's claims vs the actual trace/edge artifacts:
  n_confirmed, the discrimination numbers, the residuals). Record the delegated-build verdict per
  Rule 4 (BARE `python-backend` subject, MED-1 ordering-safe).

## Principle Audit (SOLID/DRY/KISS/YAGNI)

- **SRP/DIP**: the driver COMPOSES the mapped seams (real-solve, captureLessons, runConfirmationPass,
  runExperiment) — it adds no new grading/confirmation logic, only orchestration. The grader is the
  injected Docker backend (DIP).
- **DRY**: reuses `makeRealSolve`/`makeBehavioralFn`/`captureLessons`/`runConfirmationPass`/
  `runExperiment`/`createDockerBackend` VERBATIM — zero re-implementation.
- **KISS/YAGNI**: one driver module + a mock test; no CLI surface growth (the programmatic driver
  is sufficient for the run — closing the CLI `--solve` seam gap is deferred to Router-v2 if needed).
- **Immutability**: `built_by` is added by constructing a NEW attempt object (`{...attempt, built_by}`),
  never mutating `scoreAttempt`'s return; all stores verify-on-read.

## Drift Notes

- `drift:dictionary-gap` (conv→4): the `experiment` double-count mis-scored this `root`. Router-v2 corpus point.
- **Rule-2a win to codify**: the Docker-grade probe OVERTURNED a recorded MEMORY blocker ("corpus
  deps won't install") in <2 min by grading the accepted_diff per family. A recorded blocker is a
  PREMISE to re-probe, not a fact — same class as the plan-honesty discipline.

## Pre-Approval Verification

**2-lens VERIFY** (read-only, 2026-06-18). **Architect** (`agentId aee35984395ef8218`) →
NEEDS-REVISION→REVISED. **Hacker** (`agentId a3e9a4a11ed1038ea`) → PROCEED-WITH-CONDITIONS
(0 CRITICAL — every finding bounded by the SHADOW posture + OQ-7 firewall + slice-gates-nothing).
All findings folded above:

| Finding | Sev | Lens | Disposition |
|---|---|---|---|
| `captureLessons` item must thread `fail_to_pass`+`accepted_diff` or EVERY confirm silently fails `:79/:84/:85` | HIGH | arch F1 | FOLDED — Phase-1 step 4 threads both + a pre-2nd-actor `sameRequirement` assert |
| W4c grade path drops the C1 `test_tree_mutated→FAIL` gate (`scoreAttempt:145`) → a test-mutating candidate forges PASS | HIGH | hack H-1 | FOLDED — A graded via full `scoreAttempt` (gate built-in); B refused on `test_tree_mutated` |
| Genuineness: `recall_eligible` should be leg-derived, not driver-asserted (the USER's truest test) | HIGH | arch F2/Q1 | FOLDED — resolved toward rigor via full `scoreAttempt` (behavioral∧semantic); same fix as H-1 |
| `built_by.role` unauthenticated → assert canonicalizes to `python-backend` at MINT (numbered-vs-bare laundering) | HIGH | hack H-2 | FOLDED — Phase-1 step 4 mint-time `canonicalPersonaKey` assert, fail-closed |
| Phase 2 is inert until the confirmed edge exists (arm C==B) | MED | arch F4 | FOLDED — Phase-2 GATE on `n_confirmed≥1` + a non-empty-slice smoke-check |
| Pick diversity-friendly issues; re-roll B cap ~3, move on; budget 6–8 runs | MED | arch F3 | FOLDED — Phase-1 step 2/5 |
| `canonicalPersonaKey('python-backend')` must resolve non-null (cross-module premise) | MED | arch F5 | FOLDED — build-time probe (step 1) |
| Orphan-container leak on SIGKILL mid-batch | MED | hack M-1 | FOLDED — `reapOrphans` in a `finally` at batch end too |
| Confirm gate is exact-set + fail-closed + verdict-unforgeable; byte-distinctness residual | MED | hack M-2 | NO CHANGE — gate correct; H-1 + distinct-actor (not perturbation) are the joint preconditions |
| Unsigned edge co-forgeable via exported `deriveEdgeId`/`writeEdge` (gated≠monopoly producer) | MED | hack M-3 | FOLDED — residual precision added; `0700` + signed-lane carry |
| SSRF: `assertSafeRepo` admits any https host on the unsandboxed actor clone | LOW | hack L-1 | FOLDED — per-issue github.com host allowlist before clone |
| `graded_by={null,null}` + `test_tree_mutated` residuals missing | LOW | arch F6 | FOLDED — residuals updated (graded_by UNATTRIBUTED; tree-mutated now GATED) |
| `lesson_body` fence-token (`>>>EARNED_INSTINCTS`) early-close | LOW | hack L-2 | FOLDED — residual noted (bounded; optional escape) |
| One reviewable wave (<400 LoC committed); do NOT split | LOW | arch F7 | ADOPTED — one module, two phases, one PR |

**Disposition**: REVISED — proceed to BUILD. The decomposition, driver factoring (one module,
two phases), single-wave scope, honest-floor posture, and the confirmation gate are sound and
grounded against the cited code; the two HIGH grade-integrity folds (F1 + H-1/F2) and the two
mint-time asserts (H-2 + F5 probe) are the load-bearing pre-build changes, all now in the Approach.

## VALIDATE result

**Build**: delegated `node-backend` TDD → `packages/lab/persona-experiment/earned-grounding-run.js`
(pure helpers + seam-injected `earnLesson`/`runExperimentPhase` + a lazy-required `main`) +
`tests/unit/lab/persona-experiment/earned-grounding-run.test.js` (27 mock-only tests, spawn-tripwire).

**Pre-VALIDATE wireability probe (Rule-2a-corollary — caught what the mock suite could not)**: a
`main`-with-empty-subset smoke + a signature probe against the real modules caught a COMPOSITION
bug — `main` passed the `deriveLesson` WRAPPER as `captureLessons`'s `deriveFn`, but `captureLessons`
calls `deriveLesson(contrastInput, deriveFn)` internally → the inner leg would be null → off-floor
fallback → ZERO lessons minted, silently. Fixed: `main` now uses `makeLessonDeriver({bin})` (the
canonical inner contrast leg from `_spike/lesson-capture-rerun.js`). The 25 mock tests were green
THROUGH this bug (they injected a stub `captureFn`) — the real-path probe is what caught it.

**2-lens VALIDATE** (read-only, on the BUILT+fixed diff):

| Finding | Sev | Lens | Disposition |
|---|---|---|---|
| Store-dir mismatch: custom `opts.recallGraphDir/edgeDir` → Phase-1 writes diverge from the F4 gate + arm C (which read the default store, no dir param) → Phase 2 silently skipped | HIGH | reviewer | FOLDED — dropped the custom-dir plumbing; ALL stores use the `LOOM_LAB_STATE_DIR` default (run isolation via the env), so Phase-1 writes + F4 + arm C are one consistent store |
| SSRF parser-differential: `https://github.com\@evil.com/x` → `new URL` host=github.com but git/libcurl resolves evil; the RAW string reaches `git clone` | HIGH | hacker (live probe) | FOLDED — `assertGithubRepo` now rejects `@`/`\`/whitespace/control BEFORE the WHATWG parse + a regression test |
| `isEligibleForPopulation` re-check could diverge from `recall_eligible` | HIGH(75%) | reviewer | PROBED-CLEAR — `CLEAN_FOR_RETRIEVAL={clean-pending-probe,clean}` includes the corpus tier; `recall_eligible∧reference∧clean-tier` all set together by `scoreAttempt` → no divergence |
| `test_tree_mutated===true` misses a truthy `1`/`'true'` decoy | LOW | hacker | FOLDED — truthy-refuse + a regression test |
| `runActor` duplicates `real-solve.js:runActorSolve` (seam mismatch justifies it) | MED | reviewer | FOLDED — keep-in-sync pointer comment |
| `main` ~122 lines, 3 concerns | PRINCIPLE | reviewer | CARRIED — acceptable wiring entry (the logic lives in the helpers); a `buildDeps` extraction is a no-behavior follow-up |
| 6 of 6 pre-build gates (F1/H-1/H-2/F4/L-1/M-1) HOLD under live re-probe | — | hacker | CONFIRMED — incl. the `.trim()`-laundering defeat + no-half-minted-node-on-throw |

Post-fold: **27/27 tests, eslint clean.** The unsigned-edge / `built_by`-unauthenticated residuals
were re-probed and confirmed ACCURATELY stated (not over/under-claimed).

**RUN result** (the Rule-2a-corollary live dogfood — real `claude -p` + Docker grade):

- **Probe 1 (1 issue, `more-itertools__seekable-getitem`)**: the chain works END-TO-END — a genuine
  `python-backend` lesson node was MINTED (real actor candidate A → Docker `PASS` over the SEALED
  tests → `scoreAttempt` `recall_eligible` via behavioral∧semantic → a real `claude -p` contrast leg
  derived a valid taxonomy lesson). **Proves the `deriveFn` fix + the whole mint path.** But
  `n_confirmed=0`: candidate B never produced a DISTINCT passing diff (0 edges).
- **Diversity diagnostic (4 actor runs, 1 issue)**: the cause is a LOW-DIVERSITY actor — the two
  clean passing runs were BYTE-IDENTICAL (same sha `feec…`), and the other two MUTATED the test tree
  (correctly H-1-FALLBACK'd). So a same-model re-roll can NEVER clear the confirm gate's distinctness
  check on a canonical fix. **This is a real finding about the confirm mechanism.**
- **Design adaptation (committed)**: candidate B's INDEPENDENCE SOURCE = a DIFFERENT MODEL
  (`confirmModel`, default `claude-opus-4-8`) vs candidate A's (sonnet). A cross-model independent
  solve that also passes the SEALED tests is genuine — arguably STRONGER — confirmation evidence (the
  lesson is not model-specific). The lesson ATTRIBUTION stays `python-backend` (candidate A); the
  confirmation is cross-model verification, not attribution. Unit-tested (the B-call threads
  `confirmModel`; A uses the default).
- **Earn batch (5 issues, cross-model lever)**: **`n_confirmed=1` — the honest floor is MET.**
  2 nodes minted, 1 confirmed-by edge. Per-issue: `gray-partial-product-iterator-repeat` **CONFIRMED**
  (A@sonnet minted → B@opus distinct+passing on the 2nd re-roll → edge); `parse__microsecond-precision-loss`
  minted A but `no-distinct-passing-B`; `seekable-getitem` / `windowed-invalid-n` / `parse__grouping-char`
  all `A-not-recall-eligible` (the actor's A-pass is NONDETERMINISTIC — seekable+windowed minted in
  earlier probes but failed A here). **The cross-model lever PROVED OUT** (the confirming B@opus diverged
  from A@sonnet where same-model re-rolls were byte-identical).
- **The confirmed lesson** (genuine, persona-attributed): `built_by={role:python-backend,
  roster_name:rhea, actor_kind:claude_p}`; body = *"When repeating a sequence of iterables, materialize
  each iterable first and then repeat the resulting collection — not the raw inputs — so repeated
  iterations see independent, fully-realized copies rather than shared exhausted state."* The grounding
  slice (576 B) is non-empty + correctly fenced as DATA-not-instructions.
- **Findings (Router-v2-relevant)**: (1) the confirm gate's distinct-diff requirement is HARD with a
  low-diversity deterministic actor → a cross-model independence source is the lever; (2) actor
  A-eligibility (behavioral∧semantic) is nondeterministic per-issue → the honest floor + a multi-issue
  batch are how you reach ≥1 confirmed; (3) every gate fired correctly on real data (H-1 FALLBACK'd
  test-mutating candidates; H-2 attributed correctly; F1 exact-set held).
- **3-arm discrimination measurement** (real async solveFn, 3 experiment issues, arm C slices the
  1 confirmed lesson): **`recall_count_C_minus_A = +1` and `accrual_C_minus_A = +1`, CONSISTENT across
  all 3 issues; `recall_count_B_minus_A = 0` across all 3.** The earned python-backend lesson reaches
  arm C's prompt — and ONLY arm C's (A bare, B styled) — in every run; `unattributed=0` (no phantom
  buckets). Per-issue arm verdicts: seekable (A/B/C all UNAVAILABLE), microsecond (A/B/C all PASS),
  windowed (A PASS, B/C UNAVAILABLE).
- **Honest reading**: the recall/accrual discrimination proves the grounding PLUMBING — the confirmed,
  persona-attributed earned lesson is surfaced to arm C and to no other arm (the apparatus the whole
  ③.1 arc built). It is NOT a claim that the lesson IMPROVES solving — that is the pass-rate, which
  shows NO lift at N=3 (the single iterator-repetition lesson is topically unmatched to the 3 test
  issues, and the actor's PASS is nondeterministic). Trace-signals-PRIMARY (the W3/W4 metric choice) is
  satisfied; pass-rate (secondary) is UNDERPOWERED + reported as such. **Sharper still (honesty-audit
  Finding B): arm C produced a BYTE-IDENTICAL `outputs_digest` to arm A on EVERY issue** — the grounded
  prompt did not change the actor's output at all on these 3 topically-unmatched issues, so the lesson
  was demonstrably INERT here (not merely low-N). ENGINEERED-corpus ⇒ NARROWS-not-hardens (OQ-NS-6) —
  the dry-run apparatus works; only a world-anchored merge hardens trust.
- **③.1 OUTCOME**: the full earned-grounding apparatus PLUMBING is PROVEN end-to-end on real `claude -p`
  and Docker (genuine lesson mint → cross-model confirm → persona-sliced 3-arm experiment → clean recall
  discrimination) — **apparatus/plumbing proven; lesson EFFICACY NOT measured** (N=3, a single
  topically-unmatched lesson, nondeterministic actor; honesty-audit Finding D). This IS the routing
  corpus seed + the earned-vs-declared apparatus the queued Router-v2 wave consumes; an efficacy
  measurement needs a topically-matched, larger corpus (a future wave). NARROWS-not-hardens (OQ-NS-6).

**3-lens VALIDATE complete**: code-reviewer + hacker (on the BUILT diff) + honesty-auditor (on the RUN
claims vs artifacts, `agentId ac4a2008004be6070`) → **CLAIMS-HONEST, Grade A** (6/6 disciplines; every
load-bearing claim artifact-backed + gate-verified; the two Finding-B/D refinements folded above).
