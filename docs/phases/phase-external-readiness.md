# Phase ③.2-XR — External-readiness checkpoint

**Status:** ▶ Planned (defined 2026-07-10; the first `docs/phases/` doc — the overlay's first real use).
**Realizes:** PRD §6 (the autonomous-SDE rungs + the 2026-07-10 accretion: the learning-wire rung + this checkpoint).
**Depends on:** the ③.2 delivery mechanism (SHADOW-complete, `docs/ROADMAP.md:724`); the reconciled pipeline anchor (`research/2026-07-10-external-sde-pipeline-anchor.md`); the plugin learning-wire blueprint (`research/2026-07-10-plugin-learning-wire-blueprint.md`, board-reviewed, the recall-wiring fork RESOLVED to the cross-uid boundary module).
**Mode:** SHADOW. The internal-validation gate is entirely SHADOW/weight-inert; the LIVE crossing (recall influencing a solve, a weight hardening, a stranger-repo ingest) is operator-armed and OUT of this phase.

## Objective

When this checkpoint closes, the whole learning substrate is validated END-TO-END internally across three
layers - the memory architecture, the plugin substrate (the learning wire + persona-context), and the
minted lessons (persona-tied metadata) - so the only thing between us and ingesting a stranger repo is
operator/USER arming. It is the ③.2 internal gate BEFORE the first external PR (#406). Per OQ-NS-6, nothing
here HARDENS trust; only the external merge does.

## Scope

**IN (buildable this phase, SHADOW-safe, Claude):**

- **Track A - the learning wire** (the blueprint's SHADOW-safe waves): the cross-uid boundary module
  `recall-inject-boundary.js` + the updated `drafter-recall-disjointness` dam; the persona-context pins
  (`persona_def_ref` / `context_commons_ref` / `recall_graph_root` / `runtime`); the toolkit->Embers export
  seam.
- **Track B - the memory-architecture confirmation:** assert the ADR-0018 chain coherent (the ADR-0020-
  corrected invariant), both substrate suites green, and separation enforced; plus the ADR-status docs fix.
- **Track C - the e2e tier:** promote the named-residual real-boundary e2e from a manual `_spike/` into a
  real integration test tier + CI job; an internal end-to-end dogfood (a KNOWN issue -> solve -> mint a
  lesson carrying persona metadata -> export -> recall into the next solve), real `claude -p` + real `gh`,
  SHADOW-dry emit.
- **Track D - this checkpoint:** this phase doc + the living checklist + the 3-lens `/phase-close` sign-off.

**OUT (operator / USER / later phase):**

- The LIVE hardening round-trip - recall actually influencing a solve, a weight hardening - is arming-gated
  (the boundary invokes recall as a cross-uid subprocess that only closes at operator deploy; OQ-NS-6 says
  the first external merge hardens with recall INERT). NAMED, not built here.
- Operator arming: the cross-uid signer deploy (`#404`), actor-uid-separation (`#412`), the item-5
  authenticated minter, F-W4 fork arming, the USER `#273` sign-off, `#406` (the first external PR). TRACKED
  in the living checklist; executed by the operator, never the build session.
- The Trust Explorer UI (Embers' side; this phase only produces the data it would render).
- The revise/re-push loop (Gap-8) + the F-W4 fork path (Rung-2 scaling), per the anchor.

## Runtime probes (verify the premises before building)

Grounded in the 2026-07-10 recon (`_SESSION` workflow `w4g72rwx9` + `w32qxsn3n`):

- Probe: `grep recall|grounding live-draft-run.js live-solve-one.js` -> `0` (the learning wire is MISSING - the crux).
- Probe: `grep -rniE '\bembers\b' packages --include=*.js` -> `0` (the toolkit->Embers export seam is absent).
- Probe: `grep persona world-anchor/live-recall-store.js` -> `0` (the `world_anchored` node's signed basis carries NO persona; persona today is only an unauthenticated `built_by` label).
- Probe: `weight-source-gate.js:55` -> `LIVE_SOURCES = Object.freeze(isWorldAnchorArmed() ? [WORLD_ANCHOR_SOURCE] : [])` (the SHADOW dam is a two-gate AND: arming flag AND absent custody keys, NOT a hard `[]`).
- Probe: `drafter-recall-disjointness.test.js` -> GREEN + forbids `world-anchor/` in `live-draft-run.js`'s import closure (the dam the boundary module must satisfy).
- Probe: memory architecture BUILT - ADR-0018/19/20/21 merged (#517-531); `kernel/_lib/recurrence-lifecycle.js` green (19/0); operating-memory (`scripts/memory.js` 33/0) + lab lesson stores present.
- Probe: `find tests -name '*.test.js' -path '*integration*'` -> `0` runnable tests (355 unit, 0 integration/e2e; the only real-boundary exercise is `_spike/real-e2e-actor-dogfood.js`, out of CI).
- Probe: the 4 canonical memory ADRs still read `status: proposed` despite being merged (a 3b docs-consistency fix).

## Tasks

### Build

- [ ] Track A: `recall-inject-boundary.js` (cross-uid subprocess boundary) + the updated disjointness dam + tests (fail-closed-to-empty). [blueprint Wave 1, the RESOLVED fork]
- [ ] Track A: the persona-context pins on the `live_pending` node + carry-forward to `world_anchored` (name the edit sites: `collectCapturedCandidates` + the `mintWorldAnchoredNode` call); persona INTO the signed basis (gap8-a0b); `recall_graph_root`. [blueprint Waves 2-3]
- [ ] Track A: the toolkit->Embers export seam (`bank --node --meta --key`, `--key` = operator/cross-uid custody) + the byte-parity handshake with the Embers session. [blueprint Wave 4]
- [ ] Track B: a memory-architecture coherence assertion (ADR chain + both suites + the disjointness dam + no-auto-promotion) + fix the 4 ADRs' `status: proposed` -> `accepted`.
- [ ] Track C: establish `tests/integration/` as a real tier + a CI job; promote `_spike/real-e2e-actor-dogfood.js` into a gated internal dogfood harness.

### Test

- [ ] Real-component integration tests for each cross-layer flow (a green mock suite is a HYPOTHESIS - prefer the real store + the real `claude -p`/`gh` path over a mocked seam).
- [ ] The internal end-to-end dogfood green on the real path (known issue -> solve -> mint-with-persona-metadata -> export -> recall), SHADOW-dry.

### Validate

- [ ] 3-lens tier on the learning-wire diffs (kernel/security-adjacent): `code-reviewer` (correctness) + `hacker` (re-probe the BUILT boundary module + the injection channel + the cross-uid gate) + `honesty-auditor` (claim-vs-evidence); findings folded before close.

### Operator / external - TRACKED here, executed by the operator (not the build session)

- [ ] `#404` cross-uid broker deploy · `#412` actor-uid-separation · the item-5 authenticated-minter deploy · F-W4 fork arming · the USER `#273` sign-off · `#406` (the first external PR). Claude NEVER touches `/etc/loom`, an arming flag, or `--attested-cross-uid` (task_d722450d).

## Definition of done (exit criteria)

**Per-layer (the checkpoint's reason to exist):**

- [ ] **L1 memory:** architecture coherent (the ADR-0020-corrected invariant, not 0018's superseded prose); both substrate suites green; separation ENFORCED (the disjointness dam green + no-auto-promotion); the 4-ADR `status` docs fix landed.
- [ ] **L2 plugin wire:** the boundary module built + the dam updated + fail-closed-to-empty; the persona pins built; the materializer returns hashes. The live round-trip is a NAMED arming-gated residual (NOT required to pass).
- [ ] **L3 minted lessons:** the 4 pins on the lesson; persona bound INTO the signed basis (gap8-a0b - today it is only an unauthenticated label); the Embers export seam built + byte-parity CONFIRMED (the cross-substrate handshake, a Wave-4 precondition).
- [ ] **e2e:** a real integration test tier + CI job exists; the internal end-to-end dogfood runs green on the real path.

**Standard gates (template):**

- [ ] Build + Test complete; `bash install.sh --hooks --test` + the kernel suite green; linters + signpost + release-surface clean.
- [ ] Validate run and findings folded (3-lens for the learning-wire class).
- [ ] `/verify-plan` run before approval (this is HETS-routed multi-file work); `/phase-close` run at the boundary.
- [ ] ADR recorded if the checkpoint locks a trade-off (candidate: "external-readiness = exactly these gates; the live round-trip stays arming-gated").
- [ ] Committed + PR'd; the merge is the USER's gate (never auto-merge).
- [ ] Reconciliation with the PRD done (below); the crossing (operator arming + `#406`) scoped as the next step.
- [ ] The operator preconditions are ENUMERATED + owned (they gate the crossing, NOT this checkpoint - the checkpoint passing does not arm anything).

## Reconciliation with the PRD (filled at close)

- **Implemented vs PRD intent:** <!-- does the built three-layer validation match the §6 accretion? -->
- **Drift / deviations:** <!-- any + how resolved -->
- **PRD updates made:** <!-- dated-accretion links -->
- **Next-phase readiness:** <!-- the crossing: operator arming + #406 -->

## Open questions (resolve during the phase / escalate)

- Carried from the blueprint's review board: KB-body inlining (v1 honest-thin vs inline-then-pin); the
  `LOOM_PERSONA_MATERIALIZE` default flip (a named behavioral change); the attested-pin honesty
  (self-reported until a kernel signer arms); the Embers byte-parity handshake shape.
- Is this a sub-phase of ③.2 (as authored) or its own phase number? Authored as a ③.2 internal gate; escalate
  if the crossing warrants a ③.3.
- Should the checkpoint's "external-readiness = these gates" be locked in an ADR (the one meaningful
  trade-off is: the live round-trip stays arming-gated, so "validated end-to-end" means the mechanism is
  proven internally, not that recall is live).
