# Part A — SHADOW live-loop scheduler (build plan)

Status: PLAN (A-W1 detailed; A-W2/A-W3 sketched — derive each from probed reality when reached).
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

## A-W2 / A-W3 — sketch (flesh out from probed reality when reached)

- **A-W2**: a driver module (home TBD at VERIFY — `kernel/spawn-state/` per the ghost-heartbeat precedent, or
  `lab/`). Interface: `pullLiveCorpus -> runLiveDraftLoop` with emit-OFF (drive the loop, hardcoded `{}`). Its
  unit/integration tests need NO live headless; a real dogfood waits on the 401 fix (a named residual, not faked).
- **A-W3**: launchd/plist generator mirroring `ghost-heartbeat-schedule.js` + a `live-loop-go-live.md` doc; a
  SECOND launchd task or a flag on the heartbeat; preconditions incl. the 401 fix + a GitHub token.

## Deferred to Part B (NOT this plan)

The live crossing: arming the flags on a deployed+attested box, the 401 headless-auth fix as a live-run
prerequisite, the deployed cross-uid broker, and the #273 same-uid trust judgment. Part B is its own scope with
per-step USER go-aheads.
