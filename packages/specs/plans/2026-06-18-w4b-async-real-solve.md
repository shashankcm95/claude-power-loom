# ③.1-W4b — Async seam + the real `claude -p` solve+grade driver

- **Date**: 2026-06-18
- **Phase**: ③.1 dry-run (SHADOW, DRAFT-only, trust ZERO — OQ-NS-6)
- **Status**: PLAN — VERIFIED (architect NEEDS-REVISION + hacker SAFE-TO-BUILD-in-shadow → all folded → CLOSEABLE). Umbrella: `2026-06-18-w4-real-run-earned-grounding.md`
- **Depends on**: W4a (#353, the `python-backend` subject — MERGED `43fd29d`)

## Goal

Make the persona-experiment's injected `solveFn` seam REAL: convert the seam to async and
build `real-solve.js` — a driver that runs a real `claude -p` actor over a corpus issue,
grades the produced diff in the sandbox, and returns a HARNESS-computed behavioral verdict
(never the subject's self-asserted claim). CI stays green via injected mocks; a local
real-engine spike proves the real path. The full earned-lesson generation + the 3-arm run is
W4c — W4b delivers the machinery + proves it on one issue.

## Runtime Probes (firsthand, 2026-06-18 — host state this plan rests on)

| Claim | Probe | Result |
|---|---|---|
| The `claude` binary is resolvable (real driver can run) | `command -v claude` / `~/.local/bin/claude` | `~/.local/bin/claude` v2.1.177 |
| Platform is Darwin + `sandbox-exec` present (the ③.1 default backend attests) | `uname -s` / `command -v sandbox-exec` | Darwin; `/usr/bin/sandbox-exec` present |
| The corpus issue carries the SEALED grader fields | `node -e` keys of one staged issue | `id, repo, base_sha, problem_statement, accepted_diff, test_patch, fail_to_pass, pass_to_pass, resolved_at, provenance, contamination_tier, source_pr` |
| The sync guard + the test asserting it (TDD target) | `grep synchronous` | guard `arm-loop.js:134`; test `arm-loop.test.js:252` (`/synchronous/`) |
| Composition deps exist with expected exports | `grep module.exports` | `runActorTrajectory` (factory-shaped) `trajectory-friction-run.js:73`; `makePytestResolver` `pytest-runner.js:87`; `container-adapter.js` exports `run`/`evaluateOutcome`/`selectAttestedBackend` |

DECAYING state (re-probe at the real-engine spike): the claude binary version + the live
sandbox-exec attestation (`backend.attest()`), which spins a real container/profile.

## Load-bearing precondition (hacker C1 + H1 — STATE IT, don't footnote it)

The harness grade proves **test-run INTEGRITY, not proof-of-fix**, and is trustworthy **ONLY for
a non-adversarial subject**. The hacker confirmed two live forgeries of a HARNESS-computed
`BEHAVIORAL_PASS` that need NO self-asserted verdict: (C1) a candidate that writes a NON-colliding
`conftest.py`/`sitecustomize.py` monkeypatching the SUT flips every sealed test green with no real
fix — both patches apply, `evaluateOutcome.resolved===true`; (H1) `parseTestStatus` is LAST-wins
(`container-adapter.js:146-154`), so a candidate's later `__LOOM_TEST_RESULT__` stdout line
overrides the real verdict. Both are bounded by the W4b envelope — SHADOW, trust ZERO, the
`python-backend` subject is non-adversarial, and the grade GATES NOTHING (OQ-NS-6). **RFC-R3
(apply test_patch first / snapshot-restore the test tree / diff-scope the candidate to non-test
paths) + a first-wins-or-nonce sentinel are the NAMED BLOCKERS before this driver ever grades an
adversarial or live candidate.** This is the same integrity≠provenance distinction `security.md`
codifies: a clean test run proves the tests ran, never that the producer played fair. Deferring
the hardening is correct here ONLY because nothing gates; the record must not over-claim.

SSRF deferral (hacker H2 — binding): `assertSafeRepo` admits ANY `https?://` host (cloud-metadata,
localhost, internal, userinfo), and the clone runs UNSANDBOXED on the host. W4b is safe ONLY
because the committed corpus is `github.com`-only (probed). The GitHub-host allowlist (reject
non-`github.com`, IP-literal hosts, userinfo, plain http) is a HARD precondition for any
non-committed/live corpus — **W4c MUST NOT inherit this silently** (already a MEMORY ③.1 carry).

## Design

### 1) arm-loop async conversion (TDD-treatment — the FULL async-contract conversion)

The architect (CRITICAL-1) showed the conversion is far bigger than "rewrite line 252": the test
harness `test()` (`arm-loop.test.js:41-44`) calls `fn()` SYNCHRONOUSLY and never awaits, so the
moment `runExperiment` is async EVERY call site fires-and-forgets → a green-but-racing suite (the
mock-green trap this phase exists to avoid). Order (test-first):

1. **Convert the async CONTRACT everywhere `runExperiment`/`runArm` are reached** (this IS the
   test-first step): the `arm-loop.test.js` harness → `async function test(...) { await fn() }`,
   every test callback that calls `runExperiment`/`runArm` → `async () => { await ... }`. Add the
   NEW async-contract test (replacing the `:250-253` `/synchronous/` assertion) covering THREE
   paths: (a) async resolve → verdict via `observedVerdict`, `dur_ms` measured; (b) async REJECT →
   `grade:'error'`, run continues, emit isolated, `dur_ms>=0`; (c) sync throw → `grade:'error'`
   (regression guard). Red against the current sync impl.
2. **Convert the impl**: `runSolveSeam` (`:118`), `runArm` (`:84`), `runExperiment` (`:181`) →
   `async`; DELETE the thenable tripwire (`:133-135`). The `Date.now()` brackets (`:119,:136`) now
   wrap the `await` → real wall-time. PRESERVE the double catch-isolation under `await` (the
   try/catch now catches a rejected promise too) + the `emitFn` guard in BOTH `runArm`/`runExperiment`.
3. **Convert the two unmentioned async callers** (architect CRITICAL-1 — the "arm-query untouched"
   claim was FALSE for its TEST): `arm-query.test.js:67` seeds `FULL` via a top-level SYNC
   `runExperiment` → must `await` the seed before any summarize test reads the timeline (state the
   await-the-seed ORDERING invariant); `_spike/dogfood-run.js:61` → `await` in an async IIFE. The
   `arm-query.js` MODULE is genuinely untouched.
4. **cli** (LOW-1): `cmdRun` → `async`, `await runExperiment(...)`. The default stub
   (`cli.js:41`) stays SYNC — `await` of a non-thenable is the value, so no change needed.

### 2) `real-solve.js` (NEW lab sibling — the injectable real driver)

A FACTORY (closes over the per-issue corpus record + the attested backend; the arm-loop seam
signature `solveFn({arm,prompt,task})` is unchanged):

```text
makeRealSolve({ record, backend, claudeBin, model? }) -> async solveFn({ arm, prompt, task })
```

`solveFn` OWNS the full actor-clone lifecycle (architect CRITICAL-2 — `runActorTrajectory`
returns `{ok,events,stdout,cwd}`, NOT a diff; the diff is `git diff` of the clone AFTER editing):

1. `mkdtemp` an actor dir; `git clone --quiet record.repo`; `git checkout --quiet record.base_sha`.
2. `runActorTrajectory({ record, extraContext: <the arm prompt>, claudeBin, cwd:<dir>,
   allowedTools: ['Read','Grep','Glob','Edit','Write'] })` — **DROP `Bash`** (the clone is
   un-sandboxed; the actor must not run arbitrary shell on the host — mirrors the spike).
3. **Gate on `cap.ok` FIRST** (architect CONFIRMED-GOOD): `runActorTrajectory` is already
   fail-closed (`actor-unavailable`/`timeout`/`output-too-large`/`actor-nonzero-exit` → `ok:false`).
   `!cap.ok` → return `{verdict:'BEHAVIORAL_UNAVAILABLE'}` BEFORE any `git diff` (a failed run may
   have left partial edits → a junk patch).
4. `candidate = git(['diff'], <dir>)` — THIS is the patch. Enforce a SIZE CAP before grading
   (hacker M3 — fail clean if it exceeds `MAX_PATCH_BYTES` rather than ballooning memory).
5. **Grade via `makeBehavioralFn(backend)`** (architect MED-1 — the proven spike path; it wraps
   `prepareClone → applyPatch(candidate) → applyPatch(test) → runTests → classifyRun →
   parseTestStatus → evaluateOutcome` AND surfaces the C1 `test_tree_mutated` tamper signal that
   bare `ContainerAdapter.run` drops). Map: `issue_tests==='PASS'` → `BEHAVIORAL_PASS`;
   `'FAIL'` → `BEHAVIORAL_FAIL`; `'FALLBACK'`/refused/unavailable → `BEHAVIORAL_UNAVAILABLE`.
6. `finally { rmSync(<dir>) }`.

- **BACKEND CONSTRUCTION** (architect MED-1, concrete wiring bug): build the backend as
  `createSandboxExecBackend({ resolveTestCommand: makePytestResolver() })` then `await
  backend.attest()` — do NOT use `selectAttestedBackend` (it calls `discoverBackends` with NO
  `resolveTestCommand`, so the real run would use the W1 default wrapper a real repo lacks).
  Select+cache ONE such backend per session (passed into the factory).
- **HARNESS grade, never self-assert**: the verdict is computed from the SEALED
  `fail_to_pass`/`pass_to_pass`, NOT parsed from actor stdout. `observedVerdict` (`arm-loop.js:148`)
  gates the slot to `VERDICT_SET`; refused results have NO `observed` field → check `refused`/`ok`
  BEFORE reading any observed field (hacker M1).

### 2a) Verdict taxonomy decision (architect HIGH-1) — extend `VERDICT_SET`

"Grade unavailable" must NEVER map to `BEHAVIORAL_FAIL` (a false-FAIL pollutes the A/B/C
discrimination signal as badly as a false-PASS). DECISION: extend the closed `VERDICT_SET`
(`arm-loop.js:47`) with a distinct `'BEHAVIORAL_UNAVAILABLE'` member (additive/Open-Closed; a fixed
literal emitted ONLY by trusted harness code → still satisfies the W3b hacker MED that the slot is
never subject-steerable). `BEHAVIORAL_PASS` is reachable ONLY from `evaluateOutcome(...).resolved
=== true` over a `CONTAINED_RESULT`; everything contained-but-not-resolved → `BEHAVIORAL_FAIL`;
everything not-contained / actor-failed → `BEHAVIORAL_UNAVAILABLE`. `arm-query`'s `grade_verdicts`
bag auto-buckets the new token (confirm it does NOT count toward `pass_grade_count` — it does not;
only `BEHAVIORAL_PASS` increments it).

### 2b) The `task`-is-problem-free contract (architect HIGH-2 — LOCK in W4b)

`composeArm` embeds `task` into the prompt AND `buildActorPrompt(record, extraContext)` embeds
`record.problem_statement` → double-embedding the problem. CONTRACT (locked here; W4c supplies the
data honoring it): the PROBLEM rides ONLY in `record` (via `buildActorPrompt`, kept blind +
graded); `task` is a fixed, PROBLEM-FREE instruction stub (e.g. "Resolve the issue described
above."), IDENTICAL across arms; `extraContext` = the composed arm prompt (now pure persona-framing
delta — `[archetype?]+[slice?]+[generic instruction]`, no problem). This keeps the arms
identical-except-the-persona-delta (the controlled variable) with no problem duplication. The spike
(§4) exercises exactly this mapping, so the contract cannot wait for W4c.

### 3) CI-green discipline (FLAG-1)

- `arm-loop.js` MUST NOT statically `require('./real-solve')` — that pulls `child_process` into
  the CI-globbed `arm-loop.test.js`. `solveFn` is injected at the call site; `real-solve.js` is
  required only by the W4c driver + the local spike (both outside `tests/unit/**`).
- `real-solve.js` LAZY-requires `trajectory-friction-run` + the git/clone work INSIDE the `solveFn`
  closure (architect CONFIRMED-GOOD), so a `claudeBin=null` unit test short-circuits BEFORE any
  `child_process` import. Unit tests inject `claudeBin=null` + a `MockBackend` (deterministic
  `runTests` raw) → assert the harness-grade mapping + EVERY fail-closed path yields NOT-PASS,
  WITHOUT a real subprocess. These live in `tests/unit/lab/persona-experiment/`.

### 4) Local real-engine spike (Rule-2a-corollary — dogfood the real path)

A `_spike/` script (outside CI) that runs `makeRealSolve` on ONE staged corpus issue with the real
`claude -p` + the attested sandbox-exec backend (`createSandboxExecBackend` + `makePytestResolver`),
and prints the harness verdict + timing. A green mock suite is a HYPOTHESIS; the spike proves the
real path actually clones, runs the actor, grades in the sandbox, returns a verdict. Re-probe the
claude binary + `backend.attest()` here (decaying state).

## Security surface → 3-lens VALIDATE (Rule 2 + Rule 2a)

W4b spawns a real subprocess (`claude -p`) AND executes an attacker-influenced repo's tests as
arbitrary code in the sandbox → security-sensitive. VALIDATE fans out the full 3-lens tier on the
BUILT diff. Hacker live-probe targets (Rule 2a, against the built `real-solve.js`): **M1** — a
`MockBackend` returning each refuse/unavailable shape + `claudeBin=null` → assert NO path yields
`BEHAVIORAL_PASS` (and `cap.ok===false` is keyed, not "did we get a diff"); **C1** — a real
non-colliding `conftest.py` poison candidate → confirm W4b detects-or-documents (the
`test_tree_mutated` signal) rather than silently passing; **H1** — a real multi-sentinel stdout;
**M3** — an oversize candidate-diff → the size cap fires before `applyPatch`. `code-reviewer`:
async-conversion correctness + the fail-closed three-way mapping. `honesty-auditor`: the grade is
test-run INTEGRITY (not proof-of-fix), the spike proves the REAL path (not a mock), and the
precondition/deferrals are stated, not over-claimed. **M2** (grounding-slice → `extraContext`
prompt-injection) is ACCEPTABLE-DEFERRED: the W3a fence-as-DATA + control-strip CONTROL still
applies (confirm `real-solve` passes the slice through `composeArm` verbatim, no raw re-concat); the
`#273`-EDGE provenance residual is documented + gates nothing.

## HETS Spawn Plan

- **VERIFY (pre-build)**: 1 `architect` (read-only) pressure-tests the async conversion + the
  `real-solve` factory design — esp. the arm-prompt → `extraContext` mapping (avoid
  double-embedding `record.problem_statement`), the fail-closed completeness, and the K12/CI-green
  boundary. (The security-deep adversarial pass is at VALIDATE on the built code, per Rule 2a.)
- **BUILD**: delegated `node-backend` (Write-capable builder), TDD (test-first per §1).
- **VALIDATE (post-build)**: the 3-lens tier above on the built diff; fold; full gate; PR.
  Record the delegated-build board verdict per workflow Rule 4.

## Principle Audit (SOLID/DRY/KISS/YAGNI)

- **DIP/SRP**: `real-solve` is an injected seam (factory) mirroring the kernel `resolveParentFn`;
  arm-loop stays network-pure + CI-clean (Open/Closed — a new sibling, not an edit to the seam
  contract). **DRY**: reuses `runActorTrajectory`/`ContainerAdapter`/`makePytestResolver` verbatim.
- **KISS/YAGNI**: W4b ships the driver + proves it on ONE issue; the full corpus run + earned
  lessons are W4c. No speculative multi-backend logic (sandbox-exec default; Docker is the same
  seam via env). **Immutability**: the driver returns new result objects; no parsed-row mutation.

## Drift Notes

- The arm-prompt → `extraContext` mapping is the one non-mechanical design call — surfaced to the
  architect VERIFY rather than assumed.
- `claude -p` has no temperature/seed flag (only `--model` pins) → real runs are single
  non-deterministic samples (OQ-NS-6: narrows, never hardens; the spike is existence-proof, not a
  measurement).

## Pre-Approval Verification

2-lens VERIFY (read-only), 2026-06-18 — **architect** `adc8c0c7259b5ebf6` (NEEDS-REVISION) +
**hacker** `ad5003cd2ab32db34` (SAFE-TO-BUILD in SHADOW, 2 MUST-FIX). All folded → CLOSEABLE.

| Finding | Lens | Sev | Disposition |
|---|---|---|---|
| Async conversion breaks the SYNC test harness + 2 unmentioned callers (`arm-query.test.js:67`, `_spike/dogfood-run.js:61`) | architect | CRITICAL-1 | FOLDED — §1 now converts the full async contract + both callers + the await-the-seed ordering invariant |
| Candidate diff is `git diff` of the clone, NOT `runActorTrajectory`'s return; clone lifecycle unowned | architect | CRITICAL-2 | FOLDED — §2 step 1-6 owns mkdtemp/clone/checkout/diff/cleanup; drops `Bash` from the actor |
| "Grade unavailable" has no home in `VERDICT_SET`; must never be `BEHAVIORAL_FAIL` | architect | HIGH-1 | FOLDED — §2a extends `VERDICT_SET` with `BEHAVIORAL_UNAVAILABLE`; three-way mapping |
| arm-prompt double-embeds the problem; `task` must be problem-free | architect | HIGH-2 | FOLDED — §2b locks the `task`-is-problem-free contract |
| `selectAttestedBackend` lacks the pytest resolver (wiring bug); use `makeBehavioralFn` | architect | MED-1 | FOLDED — §2 builds `createSandboxExecBackend({resolveTestCommand:makePytestResolver()})` + `makeBehavioralFn` |
| TDD test must prove 3 paths (resolve/reject/sync-throw) + `dur_ms` on error | architect | MED-2 | FOLDED — §1 step 1 enumerates all three |
| cli `cmdRun`→async; default stub stays sync | architect | LOW-1 | FOLDED — §1 step 4 |
| conftest-poison forges a HARNESS `BEHAVIORAL_PASS` (integrity≠proof-of-fix) | hacker | C1 | FOLDED — stated as a load-bearing PRECONDITION; RFC-R3 named blocker; acceptable in SHADOW (gates nothing) |
| `__LOOM_TEST_RESULT__` last-wins sentinel forgery | hacker | H1 | FOLDED — named alongside C1; first-wins/nonce is the deferred hardening (tolerable in SHADOW) |
| SSRF: `assertSafeRepo` admits any https; clone is unsandboxed | hacker | H2 | FOLDED — binding deferral (committed corpus is github.com-only; allowlist is a hard precondition for W4c/live) |
| Fail-closed completeness (no path → false PASS) | hacker | M1 | FOLDED — §2 gates on `cap.ok`/`refused` first; the #1 VALIDATE live-probe target |
| grounding-slice → extraContext injection; output-DoS | hacker | M2/M3 | FOLDED — M2 W3a control holds + #273-EDGE documented (deferred); M3 diff size cap added |

**CONFIRMED-GOOD (architect + hacker)**: the harness-grade-never-self-assert invariant holds
(`observedVerdict` `VERDICT_SET` backstop); K12/CI-green factory-injection is sufficient
(+ lazy-require inside the closure); `runActorTrajectory` is already fail-closed; the W3a
fence-as-DATA control still applies on the W4b path. SAFE-TO-BUILD in SHADOW.

## VALIDATE result (post-build, 2026-06-18)

3-lens VALIDATE on the built diff: **code-reviewer** `a7aa222b823bd3d30` (SHIP-with-warning),
**hacker** `a93fe044c665521ef` (Rule-2a, 0 PASS-forgery — fail-closed + never-self-assert HOLD),
**honesty-auditor** `a2b591c158ec8f4d0` (grade A, 5/5 claims SUPPORTED). All fold-worthy findings
folded; gates re-green.

| Finding | Lens | Sev | Disposition |
|---|---|---|---|
| `git diff` drops NEW files → a new-file fix grades 0-byte / false FAIL | hacker | H-1 | FIXED — `git add -A && git diff --cached` |
| size-cap branch unreachable (`execFileSync` default 1MiB < 2MiB cap → ENOBUFS) | hacker | M-1 | FIXED — `maxBuffer: MAX_PATCH_BYTES + slack` |
| actor clone validates `record.repo` with NO guard (weaker than the grader) | hacker | M-2 | FIXED — `assertSafeRepo` on the actor path |
| `makeRealSolve` closure exceeds the 50-line ceiling | code-reviewer | HIGH | FIXED — extracted `runActorSolve` (17 / 46 lines) |
| misleading async-rejection comment (`runExperiment`) | code-reviewer | LOW | FIXED |
| test-header lists "oversize diff" as directly-tested (only transitive) | honesty | LOW-1 | FIXED — scoped honestly |
| C1 conftest-poison / H1 last-wins sentinel / H2 SSRF allowlist | hacker | C1/H1/H2 | DEFERRED (documented; named blockers for adversarial/live; gates nothing in SHADOW) |

**Real-engine spike (Rule-2a-corollary — the orchestrator ran it, twice: pre- + post-fold)**: the
real path runs END-TO-END on a real corpus issue (faker, ~112s) — real `claude -p` actor → attested
sandbox-exec → HARNESS verdict computed over the SEALED tests (never the actor's stdout). Returned
`BEHAVIORAL_UNAVAILABLE / grade-not-contained:FALLBACK` — a valid fail-closed outcome of one
nondeterministic sample (OQ-NS-6: an existence-proof, NOT a measurement). **The machinery works.**

**W4c CRITICAL carry (new, from the spike)**: the `FALLBACK` is the grader failing to resolve
PASS/FAIL because the corpus repo's Python deps cannot install under the network-denied sandbox.
W4c MUST solve corpus dependency provisioning (pre-built venv / base image / vendored deps) or every
real grade is `UNAVAILABLE` — the experiment would produce no PASS/FAIL discrimination. This is the
gating W4c blocker, surfaced ONLY by the real-engine dogfood (the mock suite cannot see it).

Gates after folds: persona-experiment suite **100/0**; eslint clean; `contracts-validate` 0;
`install.sh --hooks --test` **125/0**.

## CodeRabbit + review-feedback gate (post-PR #354)

Two review folds on `record.base_sha` reproducibility (both probed firsthand before folding):

1. **base_sha pin (CodeRabbit Major, `2771025`)** — the factory only truthiness-checked `base_sha`,
   so the actor clone could `checkout` a mutable ref. Folded via the project's OWN `assertSafeSha`
   (the same validator the grader's `prepareClone` applies to the same field) + `--detach`, kept in
   `runActorSolve` (lazy) to preserve the `claudeBin=null` no-child_process boundary. CodeRabbit
   accepted ("Good call reusing `assertSafeSha`").
2. **Full-40 SHA tighten (review feedback)** — `assertSafeSha` permitted `7-40` hex; tightened the
   SHARED validator to exactly `[0-9a-f]{40}` (full immutable commit). Blast-radius probed: all 18
   corpus base_shas are 40-char; the only `assertSafeSha` test asserts `'abc'`→reject + 40→accept
   (both hold); the `'deadbeef'` causal-edge fixture never reaches it. Hardens BOTH the actor path
   and the grader's `prepareClone` (which also checks out `base_sha`). Suites: issue-corpus 4/4,
   causal-edge 22/22, persona-experiment 7/7, eslint clean.

NOTE (local-only): `install.sh --hooks --test` Test 80 (markdownlint over `**/*.md`) reports a local
FAIL caused SOLELY by the **untracked, generated-today `docs/system-report/`** dir (99 pre-existing
md errors) — NOT this wave's diff. T80 scope MINUS `docs/system-report` → 0 errors; 0 tracked
`system-report` files; the untracked dir is absent on a clean CI checkout, so CI T80 passes. The
W4b substrate is gate-clean.
