# Part A — SHADOW live-loop scheduler (build plan)

Status: PLAN (A-W1 MERGED #481; A-W2 DETAILED 2026-07-01 from probed reality; A-W3 firmed-sketch).
Scope source: `packages/specs/research/2026-07-01-item8-arming-wave-scope.md` (3-lens-verified, go/no-go = build
Part A, hold Part B). USER authorized "Build Part A now" 2026-07-01.

## Routing Decision

```json
{ "recommendation": "route", "reason": "route-decide emitted [ROUTE-DECISION-UNCERTAIN] (stakes-lexicon miss); escalated by judgment — security/trust-class arming code, multi-file, non-obvious design questions" }
```

## Goal

Turn the manual `observe-merge` + `_spike` dogfood into a persistent, fully-SHADOW live-loop driver, and fold
in the two zero-live-cost hardenings the scope panel surfaced. **Crosses nothing live**: emit stays gated, the
arm flags stay off, every minted edge stays unsigned/shadow. Sub-waves, each its own PR (USER-merged):

- **A-W1 — hardenings** (this plan's focus): arm preflight + verify-at-mint + the stale-comment fix.
- **A-W2 — scheduler core**: a driver that runs `pullLiveCorpus -> runLiveDraftLoop` on a persistent path,
  emit-OFF, driving the loop (never calling `emitPR` directly — architect constraint).
- **A-W3 — launchd/plist wiring + go-live doc**: mirror the ghost-heartbeat scheduler; the persistence layer.

## SHADOW-safety invariants (hold across ALL sub-waves — the acceptance floor)

1. No default-on arm flag; every arm flag STRICT default-off (a typo fails CLOSED/dark).
2. The scheduler DRIVES `runLiveDraftLoop`; it never calls `emitPR` directly (emit-off lives at the loop's
   hardcoded `{}` opts, `live-draft-run.js:323`). A non-vacuous test asserts the driver threads no custody path.
3. No `/etc/loom` write; no custody-key provisioning; no deploy action. Claude never runs an
   `--attested-cross-uid` path.
4. Un-armed behaviour stays byte-identical to pre-A (proven by test, not asserted).

## A-W1 — the three changes

### Change 1 — verify-at-mint (producer-side refusal)

**Problem** (scope residual 5): the auto-mint arm `mainObserveMerge` (`world-anchor/cli.js:345-359`) passes
`edgeSigner` but no `verifyKeyPem`, so `mintFromMergeOutcome` takes the un-authenticated shadow path
(`world-anchor-mint.js:394-421` emits `world-anchor-mint-unauthenticated`) even when the consumer is armed. The
mint's verify boundary already EXISTS and is hardened (ENGAGE-on-presence, fail-closed-on-present-but-invalid);
it is simply not threaded.

**Fix**: thread the arming-gated BROKER verify key into the mint arm. `mintFromMergeOutcome` verifies
`record.broker_sig` (`world-anchor-mint.js:408`), so the key is the broker key (`/etc/loom/verify.pem`), resolved
ONLY when armed. Un-armed -> `null` -> `authEngaged` false (`world-anchor-mint.js:394-396` treats `null` as not
engaged) -> the unauthenticated-skip path, **byte-identical to today**.

**Single-source the custody paths (kills duplication)**: the pinned paths + arming-gated resolution live today
only in `world-anchored-recall-cli.js:30-31,60-69`. Extract them to a shared `_lib` helper so the mint arm and
the recall CLI share ONE definition:

- NEW `packages/lab/_lib/custody-arming.js` — owns `EDGE_VERIFY_KEY_PATH`, `BROKER_VERIFY_KEY_PATH`, and (both
  coherence-gated; `signingArmed` INJECTED by the caller per Q2-A so lab/_lib never imports back into world-anchor/):
  - `resolveArmedCustodyKeys({ signingArmed })` -> `{}` un-armed/incoherent, else `{selfUid, edgeVerifyKey, brokerVerifyKey}`.
  - `resolveArmedBrokerVerifyKey({ signingArmed })` -> `null` un-armed/incoherent, else the broker key (for the mint arm).
- `world-anchored-recall-cli.js resolveArmingOpts()` -> `resolveArmedCustodyKeys({ signingArmed: isEdgeUidSepArmed() })`
  (behaviour-preserved; re-exports the paths for its existing skip-guard).
- `world-anchor/cli.js mainObserveMerge` -> `verifyKeyPem: opts.verifyKeyPem !== undefined ? opts.verifyKeyPem : resolveArmedBrokerVerifyKey({ signingArmed: isEdgeUidSepArmed() })`.

### Change 2 — the both-or-neither arm preflight

**Problem** (architect finding #2): admission (`LOOM_WORLD_ANCHOR_ARM`, B5) and signing
(`LOOM_EDGE_REQUIRE_UID_SEP`, B1) are independently settable; the two-flag AND lives only in a comment
(`world-anchor-arming.js:21-24`). Currently benign (either XOR state is inert), but a real misconfig seam.

**Proposed design** (OPEN — architect VERIFY to confirm symmetric-vs-asymmetric + fail-closed-vs-emit):

- NEW export `isEdgeUidSepArmed()` in `edge-signer-resolve.js` = `normalizeBool(process.env.LOOM_EDGE_REQUIRE_UID_SEP)`
  (the strict arm-flag parse already computed at `:39`; expose it as a predicate — sole-reader stays in-module).
- NEW `armingCoherence(signingArmed)` in `world-anchor-arming.js` — PURE, takes `signingArmed` as a PARAM
  (dependency injection, so arming.js stays the sole reader of only its own flag). Reads `isWorldAnchorArmed()`;
  returns `{ admissionArmed, coherent, reason }`.
- `resolveArmedCustodyKeys()` (the admission-arming point) consults it: **admission arms only when BOTH cohere**
  (fail-closed dark on B5-set-but-B1-unset); emit an observable `world-anchor-arm-incoherent` on ANY XOR.
- Signing (B1-only) stays a legitimate staged state (signed edges minted, inert) — emit-informational, do NOT
  break it. **This is the asymmetric proposal; VERIFY decides.**

### Change 3 — correct the stale-optimistic comment

`admit-world-anchor-node.js:33` reads present-tense "the edge signer IS deployed+attested, uid 612" — contradicts
B-block-2 (no box confirmed deployed). Reword to the honest conditional ("the close depends on a DEPLOYED
cross-uid signing key ... uid 612 is the intended custody holder"), so it cannot read as a go-live green light.

## Runtime Probes (claims verified 2026-07-01, file:line)

- `Probe: world-anchor/cli.js:357` -> mint arm passes `edgeSigner` but NO `verifyKeyPem` (verify-at-mint absent). CONFIRMED.
- `Probe: world-anchor-mint.js:394-396` -> `authEngaged = hasOwnProperty && !== undefined && !== null`; `null` -> not engaged -> skip path. CONFIRMED byte-identical un-armed.
- `Probe: world-anchored-recall-cli.js:30-31,60-69` -> pinned paths + `resolveArmingOpts` live only here today. CONFIRMED single-source-extractable.
- `Probe: world-anchor-arming.js:38-40` + `edge-signer-resolve.js:39` -> both arm flags STRICT `normalizeBool`, default-off. CONFIRMED.
- `Probe: causal-edge -> world-anchor dep` -> `world-anchored-recall.js` already imports `admitWorldAnchorNode` (world-anchor/), so importing `isEdgeUidSepArmed` from edge-signer-resolve is a legal existing direction. CONFIRMED.
- `Probe: admit-world-anchor-node.js:33` -> stale present-tense "IS deployed+attested". CONFIRMED (honesty-auditor MEDIUM).

## HETS Spawn Plan

- **VERIFY (pre-build, this plan)**: 1 architect lens on the A-W1 DESIGN — settle (a) the coherence location +
  symmetric-vs-asymmetric + fail-closed-vs-emit question, (b) the custody-arming extraction shape (does it
  collide with the in-flight `task_d722450d` kernel `read-trust-anchor` extract? — orthogonal: that unifies the
  low-level fd reader; this owns the arming-gate + pinned paths), (c) whether verify-at-mint's broker-key source
  is right. Read-only (architect). Security-class, so the design gate is warranted before code.
- **BUILD**: root-built (TDD) — the changes are small + I hold the full context; no delegated builder.
- **VALIDATE (post-build)**: the Rule-2 3-lens tier (kernel/security/trust diff class) — `code-reviewer`
  (correctness) + `hacker` (adversarial: can verify-at-mint or the preflight be bypassed; does un-armed stay
  inert) + `honesty-auditor` (claim-vs-evidence). Read-only personas. Plus CodeRabbit pre-PR (secret-free tree).

## TDD approach (per the test-first discipline)

1. Write the A-W1 tests FIRST describing new behaviour: (a) un-armed -> `resolveArmedBrokerVerifyKey()===null` +
   mint arm still emits `world-anchor-mint-unauthenticated` (byte-identical); (b) armed+valid broker key ->
   `authEngaged` (subprocess/env harness); (c) `armingCoherence`: both-set->armed+coherent, neither->dark+coherent,
   B5-only->dark+incoherent+emit, B1-only->(per VERIFY decision)+emit; (d) the extraction: `resolveArmingOpts`
   behaviour-unchanged after delegating.
2. Run against current impl -> expect the new-behaviour tests RED.
3. Implement minimum to green.
4. Non-vacuity: each guard test injects the violation and watches it fire RED before the fix (security.md
   non-vacuous-guard).

## Pre-push gate

`bash install.sh --hooks --test` (eslint/yaml/markdownlint -> 118/0) + full kernel suite green + the new lab
suites green + `node scripts/generate-signpost.js --check` (NEW `.js` file: `custody-arming.js`) + the doc-path
gate (this plan cites only real paths).

## Pre-Approval Verification (A-W1 design, architect, 2026-07-01)

**Verdict: DESIGN-READY** — asymmetric coherence confirmed correct, broker key confirmed correct for
verify-at-mint, extraction confirmed NOT colliding with `task_d722450d` (different layers: it extracts the
low-level fd reader `resolveCustodyVerifyKey` internals; A-W1 owns the arming-policy that CALLS it — a stable
public-export seam across either merge order), SHADOW-safety holds (verify-at-mint with `verifyKeyPem:null` is
byte-identical). Fold these before/during build:

- **Q2-A (MEDIUM — layering, fixed in design):** `custody-arming.js` (lab/_lib) must NOT import from
  `lab/world-anchor/` (would create a `_lib ⇄ world-anchor` cycle). Keep it a LEAF: `resolveArmedCustodyKeys`
  and `resolveArmedBrokerVerifyKey` take `{ signingArmed }` as an INJECTED param. The CALLERS read
  `isEdgeUidSepArmed()` and inject it — the recall CLI (`world-anchored-recall-cli.js`, causal-edge, already
  imports world-anchor/) and the mint arm (`world-anchor/cli.js`, same dir as edge-signer-resolve). Both
  resolvers gate on `armingCoherence(signingArmed).admissionArmed` so an incoherent B5-only box stays dark.
  Run `kernel/_lib/layer-boundary-lint.js` post-build to confirm no cycle.
- **Q5-A (MEDIUM — single-truth):** both resolvers share one `isWorldAnchorArmed()` + `armingCoherence` read;
  add a test asserting `resolveArmedBrokerVerifyKey({signingArmed})===null` IFF
  `resolveArmedCustodyKeys({signingArmed})==={}` (both dark or both live, never split).
- **Q1-A (MEDIUM — rationale wording):** B1-only stays legitimate because *sign-then-admit is the intended
  staging ORDER* (structural), NOT because "its edges are inert" (time-bound — a B1-armed box's accumulated
  signed edges become admittable the moment item 8 flips `LIVE_SOURCES`). The informational emit is the
  operator's audit trail of how long the box signed before admission armed.
- **Q4-A (LOW):** the un-armed test asserts the FULL record shape (`edge_signed:false`, no
  `broker-sig-invalid`/`auth-verify-error`), not just the `world-anchor-mint-unauthenticated` emit — proving the
  `null -> else-branch` path end-to-end (non-vacuous).
- **Q5-B (LOW):** the coherence emit token is DISTINCT (`world-anchor-arm-incoherent`) from the two existing
  misconfig tokens (`edge-signer-misconfigured`, `world-anchor-arm-misconfigured`); one-line comment documents
  the three-way distinction (parse-typo vs two-flags-disagree).
- **Q5-C (LOW):** the incoherent B5-only branch EMITS `world-anchor-arm-incoherent` BEFORE returning dark
  (never a silent degrade); a non-vacuous test asserts the emit fires on that specific branch.

Full verdict: `tasks` transcript (architect aef4e05, 7 findings, 0 CRITICAL/HIGH). VALIDATE keeps the Rule-2
3-lens tier with the `hacker` re-probe of the BUILT diff (Rule 2a — the un-armed byte-identity claim is exactly
the class that needs a live re-probe, not just a green unit suite).

## VALIDATE result (A-W1 built diff, 3-lens Rule-2 tier, 2026-07-01)

**All three lenses: SHIP. 0 CRITICAL / 0 HIGH.** Run on this DEPLOYED box (real `/etc/loom` keys present), so
the armed-path assertions are non-vacuous.

- **code-reviewer (correctness) — SHIP.** Truth table right; extraction behaviour-preserving (no stale/dropped
  imports); `verifyKeyPem:null` byte-identical un-armed + demonstrably engages armed; `cause`-not-`reason` emit
  key dodges the `alert.js` clobber; no fd leak. 2 LOW (naming/cosmetic).
- **hacker (adversarial, live re-probe) — SHIP, 0 bypasses / 15 attack classes.** SHADOW byte-identity,
  both-or-neither, verify-at-mint fail-closed (`''`/whitespace/truncated/wrong key all -> broker-sig-invalid),
  no armed-weight->egress, #273 co-forge bounded (hostile `lesson_body` flattened by `sanitizeLine`) all
  CONFIRMED. 3 MED (all documentation/symmetry nits, proven inert).
- **honesty-auditor (claim-vs-evidence) — Grade A, MINOR-OVERCLAIMS.** All 6 Pre-Approval folds verified
  present; the stale-comment fix is genuinely honest now. 1 MED (a coverage seam).

### Folds applied post-VALIDATE

1. **honesty M1 (coverage seam) -> CLOSED.** Added a CONTINUOUS armed-both-flags observe-merge test
   (`cli.test.js`) that drives the REAL `/etc/loom` broker-key resolution through the production mint-arm wire
   into `authEngaged` and fail-closes on the mismatched seeded sig (`broker-sig-invalid`) on a deployed box;
   CI-guarded to the keyless-skip path. Proves the continuous armed path, not just the two disjoint halves.
2. **hacker M1 (D1/D2 coherence asymmetry) -> DOCUMENTED.** `weight-source-gate.js` header now records that the
   both-or-neither coherence is a D2 invariant; D1 arms on `isWorldAnchorArmed()` alone but is a belt with
   nothing to grip (B5-only -> `mock` -> weight 0, proven inert by the hacker). Adding coherence to D1 would need
   a second module-load flag read (the split-brain this wave avoids).
3. **code-reviewer LOW (`coherent` field) -> CLARIFIED.** `armingCoherence` JSDoc now warns `coherent:false` is
   not a health signal (B1-only is coherent:false yet legitimate); gate REFUSE on `!admissionArmed`, EMIT on
   `!coherent`.

Not folded (intended behaviour, named for the record): hacker M2 (root-owned custody key trusted — root is the
trust root), hacker M3 (typo+signing double-emits two distinct correct signals). honesty-auditor's deferred
"add an armed continuous test at item 8" is superseded by fold #1 (done now).

### Gates (post-fold)

Lab 127/127, install.sh --hooks --test 129/0 (eslint/yaml/markdownlint + all drift-gates), layer-boundary-lint
0 findings (no `_lib <-> world-anchor` cycle), signpost clean, kernel suite green.

## A-W2 — the scheduler core (DETAILED — grounded in probed reality 2026-07-01)

### What A-W2 builds, and (load-bearing) what it does NOT

The autonomous chain has FOUR stages but only TWO are reachable under emit-OFF:
`pullLiveCorpus -> runLiveDraftLoop` (the DRAFT half) is drivable now; `observe-merge -> world-anchor-mint`
(the WORLD-ANCHOR half) is inherently gated on a real EMITTED + MERGED PR, which cannot exist while emit is
OFF. So A-W2's scheduler drives ONLY the draft half. `captureLiveLesson` still mints per record into the
weight-inert `live_pending` lane INSIDE `runLiveDraftLoop` (`live-draft-run.js:310-312`) — that IS the
"mint-unsigned-shadow" of the scope; A-W2 adds no new mint and never touches the world-anchor lane.

### Placement — `packages/lab/live-loop/` (the dependency rule settles the open Q)

The runner imports lab's `pullLiveCorpus` (`lab/issue-corpus/live-puller.js`) + `runLiveDraftLoop`
(`lab/persona-experiment/live-draft-run.js`). **Kernel must not import lab** (dependency rule), so the runner
CANNOT live in `kernel/spawn-state/` beside the heartbeat — it lives in `packages/lab/live-loop/`. The
heartbeat is in kernel/spawn-state because it drives KERNEL concerns (transcript audit); the live-loop drives
LAB pieces. The A-W3 launchd wiring borrows the kernel plist-builder PATTERN via a THIN LAB MIRROR (the kernel
`buildLaunchdPlist` hardcodes `GHOST_HEARTBEAT_EMIT=1`, so not a verbatim reuse — see A-W3); lab -> kernel is
the legal direction for any kernel helper it does import.

### The runner — mirror the ghost-heartbeat SRP triad, adapted for emit-OFF

NEW `packages/lab/live-loop/live-loop-run.js` (mirror `ghost-heartbeat-run.js`):

- **Emit-OFF is STRUCTURAL at the loop, not the scheduler's to get wrong.** `runLiveDraftLoop` hardcodes
  `emitFn(data, {})` (`live-draft-run.js:323`); the empty `opts` engages `emitPR`'s three fail-closed defaults
  (dry-run + no-token + killswitch-ON: `emit-pr.js:318-359`), so `emitRes.emitted === false`. The runner passes
  NO `deps.emitFn` override and threads NO egress custody opts (they are not even in `runLiveDraftLoop`'s
  signature). The loop's existing `UNEXPECTED-EMISSION` assertion (`live-draft-run.js:330-332`) is the backstop.
  The runner NEVER calls `emitPR` directly (SHADOW-safety invariant 2).
- **Two-tier off-switch (mirror the heartbeat):** an env opt-out AND a home-readable touch-file killswitch
  (`~/.claude/checkpoints/live-loop.disabled`, presence-only `lstat` NO-FOLLOW). The env var is INERT under
  launchd's minimal env (agent-2's heartbeat lesson: `ghost-heartbeat-run.js:49-54`), so the FILE is the
  working off-switch.
- **Always `process.exit(0)`** — advisory-runner posture (a scheduler must never see a failure).
- **Run-in-progress LOCK (NEW vs the heartbeat) — BUILT reality.** The heartbeat has no cross-run mutex (it
  relies on 4h interval > per-run budget). The live-loop pulls a corpus + runs N Docker+LLM solves = minutes
  each, so a run CAN exceed its interval. The runner calls `acquireLock`/`releaseLock` DIRECTLY
  (`kernel/_lib/lock.js`, imported as `../../kernel/_lib/lock`) on `~/.claude/checkpoints/live-loop.lock` — NOT
  `withLockSoft` (which is SYNC-only: it would release before the async critical section resolves).
  `maxWaitMs=100`, NOT near-zero: `acquireLock` loops `while (Date.now()-start < maxWaitMs)`, so `0`/`1` is FLAKY
  (a single clock tick before the first check yields ZERO attempts — empirically 100% zero-iteration at 0ms,
  rare at 1ms, 0% at 100ms); 100ms reliably attempts once and still skips ~30x faster than the 3000ms default. A
  held lock -> `{ok:false, reason:'locked'}` (skip; no overlap). The acquire is GUARDED (VALIDATE HIGH): a throw
  from `acquireLock`'s unguarded `fs.mkdirSync` -> `{ok:false, reason:'lock-acquire-threw:*}`, never a promise
  reject (the never-throws contract, load-bearing for the A-W3 programmatic caller). Stale-lock self-heals:
  `acquireLock` reclaims a dead-PID holder (`lock.js:166-167`). The lock-skip is tested by injecting
  `acquireFn:()=>false` (asserts `reason:'locked'` + pull-never-called) + a throwing-acquire test; the real
  `acquireLock`/`releaseLock` are exercised by the non-injecting happy-path tests (a same-process real-contention
  test is impossible — `acquireLock` reclaims a same-PID lock as a self-orphan).
- **Run-state:** atomic `writeAtomic` (`kernel/_lib/atomic-write.js`) to `~/.claude/checkpoints/live-loop-run.json`
  `{version, pulled, drafted, lastRunAt}`, **wrapped fail-open** (log to stderr, continue — mirror
  `ghost-heartbeat-run.js:291-295`) so a run-state write failure cannot escape the always-exit-0 contract.
  Cross-fire idempotency is NOT required for A-W2 (draft-only has no external side-effect; a re-solved issue just
  re-drafts + re-captures a live_pending lesson) — a NAMED residual.
- **Budget:** reuse `runLiveDraftLoop`'s `capUsd`/`estimatedUsd` so one fire is bounded (fatal over-cap is
  already handled inside the loop, `live-draft-run.js:398-399`).
- **NO `/etc/loom` touch, NO custody-key read, NO deploy action** (SHADOW-safety invariant 3); Claude never
  runs an `--attested-cross-uid` path.

### The emit-OFF non-vacuous test (SHADOW-safety invariant 2 — the load-bearing gate)

Prove emit-OFF against the REAL `emitPR` (Rule-2a-corollary: a stub `emitFn` would not dogfood the real
chokepoint — the gap is where the bug hides).

**REACHABILITY — the vacuity trap (code-reviewer HIGH, VERIFY 2026-07-01).** `runLiveDraftLoop` runs
`preflightEnv` at `live-draft-run.js:393` BEFORE the per-record loop, defaulting `resolveKeyFn`/`attestFn` to the
REAL `resolveActorApiKey`/`attestActorContainment`. On CI (no `~/.config/loom/anthropic-api-key`) that returns
`{ok:false, reason:'actor-key-absent'}` -> EARLY RETURN at `:395` -> the loop + the `emitFn` call at `:323`
NEVER run -> a naive test asserts on an emitPR spy that was never called (VACUOUS-green for the WRONG reason). So
the deps set MUST also stub the two preflight seams.

**Deps (reach `emitFn` without Docker/LLM/401):**
`deps = { resolveKeyFn: () => 'fake-key', attestFn: async () => ({attested:true}), solveFn: async () =>
({ok:true, candidate:'<fixture diff>', costUsd:0}), semanticFn, frictionFn, emitFn: spyWrappedRealEmitPR }`.
(The deriver leg self-disarms: `judgesInjected=true` -> `lessonLegFn=null`, no separate mock needed.)

**Assert:** (1) `outcome.stage === 'draft'` — the LOUD guard that the loop actually RAN (a future preflight-shape
change that short-circuits fails RED, not vacuously green); (2) the spy `emitPR` was called with `opts`
deep-equal `{}` (no custody path); (3) `emitRes.emitted === false` (real emitPR fail-closed under empty opts);
(4) the runner constructs no `custodyDispositionPath`/`custodyTokenPath` AND passes no live `deps.emitFn`
override — BOTH the opts half AND the `:358` `deps.emitFn || emitPR` seam pinned (hacker + architect).

**NON-VACUOUS proof-it-can-fail (control arm — SHIPPED form).** The built control arm (test 5) injects a fake
`emitFn` returning `{emitted:true}` and asserts the loop's `UNEXPECTED-EMISSION` backstop
(`live-draft-run.js:330-332`) fires — `outcomes[0].reason === 'UNEXPECTED-EMISSION'`, `ok:false`, `drafted:0` —
whereas the emit-OFF arm (real emitPR, `emitted:false`) yields `drafted:1`. The DIFFERENCE proves the harness
distinguishes emit-ON from emit-OFF with ZERO network AND ZERO kernel-gate coupling — a cleaner mechanism than
the originally-planned spy-`armedEmitFn` + synthetic-disposition approach (which would have coupled the A-W2 test
to emit-pr internals). The vacuity-trap test (omit `resolveKeyFn`/`attestFn` -> preflight early-return -> emit
NEVER reached) is the separate guard that the full deps set is necessary.

### 401 headless-auth — NOT an A-W2 blocker (probe-confirmed)

A-W2's unit/integration tests mock the solve leg + `pullLiveCorpus`'s `ghRunner`, so they need no live headless
auth. A real fire without 401 fails-soft per record (`runLiveDraftLoop`'s per-record try/catch,
`live-draft-run.js:403-420`) and the runner wraps the pull in its own fail-soft try -> exit 0 — an unauth box is
inert, not crashing (`pullLiveCorpus` has no top-level auth catch, so a 401/403 from the UNCAUGHT top-level
SEARCH call `ghJson(...)` at `live-puller.js:223` throws OUT of it — the per-item enrichment 401s at `:236`/`:240`
are instead CAUGHT as drops by the per-item catch `:230-252`; code-reviewer citation fold). So the runner's own
fail-soft try around the pull call is LOAD-BEARING, not defensive redundancy. The single real end-to-end dogfood
(real `gh` + real `claude -p`) is a NAMED residual gated on the 401 fix + a token, deferred to A-W3 / Part B —
never faked.

### Acceptance bar for A-W2 "done"

A green INTEGRATION test of `runLiveLoop -> runLiveDraftLoop (stubbed preflight + solve + judge legs, REAL
emitPR) -> emitted:false`, driven through an INJECTED whole-puller mock (`deps.pullFn`; the REAL `pullLiveCorpus`
is covered independently in `live-puller.test.js`), with the bounded `limit <= 100` asserted separately. The
lesson-capture nuance (code-reviewer + architect): with judges injected `judgesInjected=true` ->
`lessonLegFn=null` -> `deriveLiveLesson` returns null -> `lesson_reason:'off-floor'`, `lesson_captured:false`
(`live-draft-run.js:388-390`). So the test asserts the lesson path is REACHED (`lesson_reason`) OR injects a
`lessonDeriveFn` yielding a lesson — it never expects `lesson_captured:true` on the mocked-judge path. PLUS the
emit-OFF non-vacuous test, PLUS the lock + touch-file killswitch + always-exit-0 unit tests, PLUS un-armed
byte-identity — including a structural test/lint that the runner's import set EXCLUDES `world-anchor/`,
`custody-arming.js`, `mintFromMergeOutcome` (the world-anchor lane stays untouched; hacker fold). The single real
dogfood is a named residual (needs 401), NOT an A-W2 gate.

## A-W2 Runtime Probes (claims verified 2026-07-01, file:line)

- `Probe: live-draft-run.js:358` -> `const emitFn = deps.emitFn || emitPR` — the DEFAULT emitFn IS the kernel `emitPR`. CONFIRMED.
- `Probe: live-draft-run.js:323` -> `emitFn(data, {})` — empty opts hardcoded per record (the emit-OFF seam is at the LOOP, not the caller). CONFIRMED.
- `Probe: emit-pr.js:318-359` -> `opts={}` -> killswitch-ON + no-token + dry-run disposition -> the `:471` emit gate is false on all three axes -> `{emitted:false}`. CONFIRMED emit-OFF structural.
- `Probe: live-draft-run.js:330-332` -> `UNEXPECTED-EMISSION` assertion backstops a `emitted!==false`. CONFIRMED.
- `Probe: live-puller.js:212-255` -> `pullLiveCorpus` has ZERO production callers + no top-level auth catch (401 throws out). CONFIRMED (a scheduler must wrap the pull fail-soft).
- `Probe: live-draft-run.js:310-312` -> `captureLiveLesson` mints into the weight-inert `live_pending` lane INSIDE the loop (the "mint-unsigned-shadow"). CONFIRMED.
- `Probe: grep for a pull->draft->observe->mint chain` -> NONE; `_spike/live-draft-dogfood.js` (hand-built 1 record, mocked judges, asserts emitted=NOTHING) is the closest existing driver; observe/mint is human-gated via `world-anchor/cli.js observe-merge` on a MERGED PR URL. CONFIRMED (the observe/mint half is inherently Part B).
- `Probe: lab -> kernel import direction` -> `live-draft-run.js:18`, `merge-observer.js:46`, `world-anchor-mint.js:122-124` all import kernel INWARD (legal); kernel importing lab would be ILLEGAL -> runner belongs in lab/. CONFIRMED.
- `Probe: ghost-heartbeat-run.js:225-228` -> emit-gate `GHOST_HEARTBEAT_EMIT!=='1'` default-off + touch-file killswitch (env inert under launchd). CONFIRMED (the mirror pattern).
- `Probe: ghost-heartbeat runner has no cross-run mutex` (`runHeartbeat` relies on 4h > per-run budget) -> the live-loop needs its OWN lock (runs can exceed interval). CONFIRMED (design addition).

## A-W3 — launchd wiring (firmed sketch, from the heartbeat precedent)

- **Use a THIN LAB MIRROR of the plist builder — NOT a verbatim `buildLaunchdPlist` reuse (hacker MEDIUM).** The
  heartbeat's builder HARDCODES `<key>GHOST_HEARTBEAT_EMIT</key><string>1</string>` into EVERY plist
  (`ghost-heartbeat-schedule.js:171-174`) — it is not parameterized, so it CANNOT omit the emit block. That var
  is inert for the live-loop (the runner reads no `GHOST_HEARTBEAT_EMIT`), but shipping a plist that names the
  wrong emit-env contract is a latent misconfig hazard. The lab mirror emits NO emit-env block. DISTINCT label
  `com.powerloom.live-loop` (a SECOND task, independently killswitch-able — resolves the "second task vs flag"
  open Q toward a second task). Absolute `nodeBin = process.execPath` + absolute `runnerPath` (minimal-PATH bake,
  `ghost-heartbeat-schedule.js:317`); `RunAtLoad false`, `ProcessType Background`; `StartInterval` >= the per-run
  budget so fires do not stack (the lock is the real overlap guard). Emit-off is at the loop's `{}` regardless of
  any env — the plist env is not a safety surface.
- A `live-loop-go-live.md` runbook: preconditions (the 401 fix + a GitHub token + the operator's explicit go),
  the touch-file killswitch, install/uninstall/status. Ships DARK behind 401 (mirror the heartbeat's dark-ship).
- A thin `install.sh --schedule-liveloop / --unschedule-liveloop` dispatch (mirror `schedule_heartbeat()`,
  `install.sh:382-419`).

## Pre-Approval Verification (A-W2 design, 3-lens VERIFY, 2026-07-01)

**Verdict: BUILD-READY (folds applied above).** All three lenses (architect / code-reviewer / hacker,
read-only, source-traced against the cited file:lines) returned READY-WITH-FOLDS; the core design is confirmed
sound on every axis. One BLOCKING HIGH (a test-vacuity trap, not a design flaw) + 4 MEDIUM + LOWs — all folded
into the A-W2 detail above. No CRITICAL. Run `wf_0c3fed36-b78` (351k tok, 3 agents).

- **Confirmed at source (0 change):** emit-OFF is genuinely STRUCTURAL (the literal `{}` at
  `live-draft-run.js:323`, plus `runLiveDraftLoop`'s signature having no custody opt, the `emit-pr.js:471`
  four-AND gate, and the `UNEXPECTED-EMISSION` backstop); placement in `packages/lab/live-loop/` is the correct dependency-rule
  resolution; draft-only scope is right (observe->mint is inherently Part B); the `live_pending` mint is the
  reachable shadow-mint; the two-tier off-switch + `withLockSoft` self-heal semantics; un-armed byte-identity
  (grep of the reachable chain for `/etc/loom`/custody = 0 hits; hacker all 6 attack classes HELD).

### Folds applied above (before build)

- **[HIGH -> FOLDED] code-reviewer (the vacuity trap):** the emit-OFF test's deps MUST stub `resolveKeyFn` +
  `attestFn` (else `preflightEnv:393` early-returns `actor-key-absent` on CI, the loop never runs, and the
  emitPR spy is never called — vacuous-green). Added the full deps set + the `outcome.stage==='draft'` LOUD
  guard. (Emit-OFF test section.)
- **[MEDIUM -> FOLDED] hacker (control-arm network hazard):** the "would-emit" control arm must inject a SPY
  `armedEmitFn` and run keyless/tokenless, asserting `reason==='awaiting-approval'` (past the `{}` early-exit),
  NEVER `emitted===true` (real `ghEmit`). Rewrote the non-vacuous control arm.
- **[MEDIUM -> FOLDED] architect (lock latency):** pass a near-zero `maxWaitMs` (default 3000 blocks ~3s) + a
  concurrent-acquire `lock-timeout` unit test. (Lock bullet.)
- **[MEDIUM -> FOLDED] architect (emitFn seam):** name the `:358` `deps.emitFn || emitPR` seam; the test pins
  BOTH the opts half AND that the runner passes no live `deps.emitFn`. Keep real-emitPR (not a stub).
- **[MEDIUM -> FOLDED] hacker (A-W3 plist):** `buildLaunchdPlist` hardcodes `GHOST_HEARTBEAT_EMIT=1` -> NOT
  verbatim-reusable; use a thin lab mirror emitting no emit-env block. (A-W3 + Placement note.)
- **[LOW -> FOLDED] lesson-capture honesty:** judges-injected -> `lessonLegFn=null` -> assert `lesson_reason`
  path OR inject `lessonDeriveFn`; never expect `lesson_captured:true` on the mocked path. (Acceptance bar.)
- **[LOW -> FOLDED] 401 citation:** the throw-out site is the uncaught top-level SEARCH call `live-puller.js:223`
  (per-item 401s at `:236`/`:240` are CAUGHT); the runner's fail-soft pull-wrap is LOAD-BEARING. (401 section.)
- **[LOW -> FOLDED] run-state fail-open:** wrap `writeAtomic` fail-open (mirror `ghost-heartbeat-run.js:291-295`)
  so a write failure cannot escape always-exit-0. (Run-state bullet.)
- **[LOW -> FOLDED] structural import guard:** a test/lint asserts the runner's imports EXCLUDE `world-anchor/`,
  `custody-arming.js`, `mintFromMergeOutcome` (world-anchor lane untouched). (Acceptance bar.)
- **[LOW -> FOLDED] bounded corpus:** the acceptance test asserts `pullLiveCorpus` is called with `limit <= 100`.

VALIDATE (post-build) keeps the Rule-2 3-lens tier with the hacker RE-PROBE of the BUILT runner (Rule 2a — the
emit-OFF byte-identity + the "runner never reaches emitPR/etc-loom" claims are exactly the class that needs a
live re-probe of the built code, not just a green unit suite). Plus CodeRabbit pre-PR on a secret-free tree.

## VALIDATE result (A-W2 built diff, 3-lens Rule-2 tier, 2026-07-01)

**hacker: SHIP (0 CRIT/HIGH/MED). code-reviewer + honesty-auditor: SHIP-WITH-FOLDS.** Run on the built worktree
(`wf_33576a87-f21`). The one HIGH was fixed; all doc folds are applied above.

- **hacker (adversarial re-probe, 13 LIVE probes) — SHIP.** The SHADOW-safety property HELD on every axis:
  hostile record fields (`mode`/`token`/`custodyDispositionPath`/`__proto__`) NEVER reach emitPR's opts (spy:
  `opts=[{}]`, data = the 4 sanitized fields only); the real emitPR stays `emitted:false`/dry-run even with
  `GH_TOKEN`/`GITHUB_TOKEN`/`LOOM_BETA_KILLSWITCH=0` set; the transitive import graph (50 modules) has ZERO
  world-anchor/custody-arming/mint; the killswitch is symlink/dir/TOCTOU-robust (lstat no-follow); **byte-identity
  confirmed** — the only tracked-file changes are the SIGNPOST registration + this plan (the loop/emit/puller/lock
  files were last touched at #461, not this wave). The one transitively-reachable `/etc/loom` reference is the
  pre-existing #430 fail-closed PRESENCE check (existsSync of a deploy marker, never a content read), reachable
  only on the un-injected production path AFTER the docker-attest gate, and it makes the guard MORE restrictive.

- **code-reviewer (correctness) — SHIP-WITH-FOLDS, 1 HIGH (FIXED).** Verified the emit-OFF test genuinely reaches
  emitPR past preflightEnv (the vacuity-trap test correctly reproduces the early-return); independently reproduced
  the `maxWaitMs` flakiness (0ms=100% zero-iteration, 100ms=0% across 100k trials); confirmed the 401-inert
  claim, the empty-records/malformed-report edge cases, and zero fd leaks.
  - **[HIGH -> FIXED] never-throws gap:** `acquireFn(...)` sat OUTSIDE the try/finally, so a throw from
    `acquireLock`'s unguarded `fs.mkdirSync` (EACCES/ENOSPC) would REJECT `runLiveLoop`'s promise instead of
    resolving `{ok:false,...}` — breaking the never-throws contract for a programmatic caller (an A-W3 wrapper).
    Fixed: the acquire is now try-guarded -> `{ok:false, reason:'lock-acquire-threw:*}`; a regression test injects
    a throwing acquire and asserts it RESOLVES (without the fix the `await` would reject -> the test fails RED).

- **honesty-auditor (claim-vs-evidence) — SHIP-WITH-FOLDS, Grade A.** Core SHADOW-safety claims TRUE against
  source; the non-vacuity is genuinely pinned by test 6 (real emitPR, opts `{}`, emitted:false, stage:draft) +
  the vacuity-trap test 7. 5 LOW plan-prose-vs-built-code folds — ALL APPLIED above: the lock uses
  `acquireLock`/`releaseLock` not `withLockSoft` (+ `maxWaitMs=100` not near-zero); the lock-skip test injects
  `acquireFn:()=>false` (not a real concurrent acquire); the control arm is the fake-`emitted:true` ->
  `UNEXPECTED-EMISSION` mechanism (not spy-`armedEmitFn`); the acceptance bar drives an injected whole-puller mock
  (the real `pullLiveCorpus` is `live-puller.test.js`'s coverage); and SHADOW-safety invariant #4 for A-W2
  collapses to "the NEW runner touches no arming/custody surface" (a new file has no pre-A behaviour to be
  byte-identical to) — proven by the import-exclusion test (11) + the `{}`-deps structural test (6).

### Build-time bugs the TDD loop surfaced (non-functional, mock-suite-invisible)

- **`maxWaitMs:1` was flaky** — a single clock tick between `start` and `acquireLock`'s while-check yields ZERO
  attempts. Fixed to 100 (reliable, still 30x faster than the 3000 default).
- **the test's `withEnv` helper was sync-wrapping an async callback** — its `finally` restored the env after the
  first `await`, so a two-fire test's second fire saw `ENABLED` deleted -> `opt-out`. Fixed to `async`/`await`
  (single-call tests were immune; only the multi-fire test caught it — a Rule-2a-corollary in miniature).

### Gates (post-fold)

16/16 live-loop suite (stable), full lab + kernel suites green, eslint clean, signpost regenerated + `--check`
clean, markdownlint clean (one MD004 wrapped-`+` trap fixed).

**CodeRabbit (PR #483, after a spending-cap cooldown — SCAR #16/#18):** 1 Trivial nitpick, FOLDED — enforce the
corpus cap LOCALLY (`records.slice(0, limit)` before drafting), so a regressed/injected puller that ignores
`limit` cannot make a "bounded" fire draft an unbounded corpus (validate-at-boundary; the code-reviewer flagged
boundedness-is-emergent as LOW, CodeRabbit proposed the enforcement — the async bot COMPLEMENTS the lens tier
again). Pinned by a non-vacuous clamp test (a 10-record puller with `limit=3` -> exactly 3 drafted).

## Deferred to Part B (NOT this plan)

The live crossing: arming the flags on a deployed+attested box, the 401 headless-auth fix as a live-run
prerequisite, the deployed cross-uid broker, and the #273 same-uid trust judgment. Part B is its own scope with
per-step USER go-aheads.
