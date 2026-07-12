# Phase ③.2-XR — External-readiness checkpoint

**Status:** ✅ CLOSEABLE (phase-closed 2026-07-12). The 3-lens `/phase-close` (PM=honesty-auditor + Principal-SDE=code-reviewer + Architect) returned all-CLOSEABLE against integrated `main` @ `14b0d95`; sign-off in `docs/ROADMAP.md` + the `toolkit/phase-close/external-readiness-close` library volume. Defined 2026-07-10 (the first `docs/phases/` doc). Mode SHADOW: this certifies the mechanism INTERNALLY across three layers with recall INERT; per OQ-NS-6 it hardens nothing (only an external merge does).
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
- Probe (2026-07-12): `tests/integration/` is now a CI-run tier (C1 #571, the `integration-tests` job) + the real-boundary e2e is promoted to the gated `tests/e2e/real-e2e-actor-dogfood.e2e.js` (C2). [Originally: 0 integration/e2e, the only exercise was `_spike/real-e2e-actor-dogfood.js`, out of CI.]
- Probe: the 4 canonical memory ADRs still read `status: proposed` despite being merged (a 3b docs-consistency fix).

## Tasks

### Build

- [x] Track A: `recall-inject-boundary.js` (cross-uid subprocess boundary) + the updated disjointness dam + tests (fail-closed-to-empty). [blueprint Wave 1, the RESOLVED fork] -- #566
- [x] Track A: the persona-context pins on the `live_pending` node (`persona_def_ref` / `context_commons_ref` / `runtime` / `recall_graph_root`, sealed into the v2 body via a discriminated exact-set). [blueprint Wave 2] -- #568. NOTE: carry-forward INTO the `world_anchored` SIGNED basis (gap8-a0b) is RATIFIED-DEFERRED to a multi-party commons (#569); the node stays the frozen 7-key basis, persona is a self-asserted meta-only export label (integrity != provenance, #273).
- [x] Track A: the toolkit->Embers export seam (`export-bank-pair`: the frozen 7-key node VERBATIM + the exact 3-key `meta.minter`) + the byte-parity handshake (a vendored Embers golden vector re-derived byte-for-byte). [blueprint Wave 4] -- #570. (`--key` custody banking is operator-side, not this SHADOW half.)
- [x] Track B: a memory-architecture coherence assertion (ADR chain + both suites + the disjointness dam + no-auto-promotion) + fix the 4 ADRs' `status: proposed` -> `accepted`. -- #565
- [x] Track C: establish `tests/integration/` as a real tier + a CI job (C1 #571); promote the spike into a gated internal dogfood harness at `tests/e2e/real-e2e-actor-dogfood.e2e.js` (C2).

### Test

- [x] Real-component integration tests for the cross-layer flows: the mint->export seam (`world-anchor-export-seam.integration.js`, real CLI subprocess + an independent Embers-parity seal re-derivation, #571) + the recall-boundary->real-recall-CLI wire (`recall-inject-boundary.integration.js`, real subprocess + the fail-closed-observable path, added at close). The A1 cross-uid + non-empty recall path is inherent-SHADOW (the operator `spawnArgsFn` does not exist pre-deploy) = a NAMED residual.
- [x] The internal end-to-end dogfood harness on the real path: the harness runs END-TO-END + `decideGate` is unit-proven (8/8); a real run FIRED and the host-claude-guard fail-CLOSED the actor on this deployed box (`deployed-unconfigured`, never bypassed). SHADOW-dry (0 nodes, 0700 store). PARTIAL-by-design: the actor-solve + the real-`gh` half are NAMED operator-armed residuals, NOT a captured green run (#573).

### Validate

- [x] 3-lens tier on the learning-wire diffs (kernel/security-adjacent): `code-reviewer` (correctness) + `hacker` (re-probe the BUILT boundary module + the injection channel + the cross-uid gate) + `honesty-auditor` (claim-vs-evidence); findings folded before close. Per-wave VERIFY+VALIDATE on each PR; the phase-level 3-lens `/phase-close` re-ran against integrated `main` (all three CLOSEABLE).

### Operator / external - TRACKED here, executed by the operator (not the build session)

- [ ] `#404` cross-uid broker deploy · `#412` actor-uid-separation · the item-5 authenticated-minter deploy · F-W4 fork arming · the USER `#273` sign-off · `#406` (the first external PR). Claude NEVER touches `/etc/loom`, an arming flag, or `--attested-cross-uid` (task_d722450d).

## Definition of done (exit criteria)

**Per-layer (the checkpoint's reason to exist):**

- [x] **L1 memory:** architecture coherent (the ADR-0020-corrected invariant, not 0018's superseded prose); both substrate suites green; separation ENFORCED (the disjointness dam green + no-auto-promotion); the 4-ADR `status` docs fix landed. [#565]
- [x] **L2 plugin wire:** the boundary module built + the dam updated + fail-closed-to-empty [#566]; the persona pins built (sealed on `live_pending`, the refs are HEX64 hashes) [#568]. The live round-trip is a NAMED arming-gated residual (NOT required to pass) -- held INERT.
- [x] **L3 minted lessons:** the 4 persona-context pins sealed on `live_pending` (A2/#568); the Embers export seam built + byte-parity PROVEN (a vendored Embers golden vector re-derived byte-for-byte + an independent CI re-derivation) [A3/#570]. Persona is a SELF-ASSERTED, meta-only export label at receiver-weight 0 (integrity != provenance, #273); binding persona INTO the `world_anchored` SIGNED basis (gap8-a0b) is RATIFIED-DEFERRED to a multi-party commons (#569) -- NOT claimed done.
- [x] **e2e:** a real integration test tier + CI job exists (C1 #571). The internal end-to-end dogfood harness is built + its gate is unit-proven (C2 #573); a real run is operator-gated / SHADOW / N=1, and the actor-solve + the real-`gh` half are NAMED residuals (NOT a captured green run).

**Standard gates (template):**

- [x] Build + Test complete; `bash install.sh --hooks --test` + the kernel suite green; linters + signpost + release-surface clean. (release-surface `--check` clean at v3.11 -- a SHADOW lab arc, correctly unbumped; signpost up to date.)
- [x] Validate run and findings folded (3-lens for the learning-wire class) -- per-wave on each PR + the phase-level `/phase-close`.
- [x] `/verify-plan` run before approval (per-wave, HETS-routed); `/phase-close` run at the boundary (this sign-off).
- [x] ADR recorded: `packages/specs/adrs/0022-external-readiness-gates-arming-gated.md` locks "external-readiness = exactly these gates; the live round-trip stays arming-gated".
- [x] Committed + PR'd; the merge is the USER's gate (never auto-merge). [the close PR]
- [x] Reconciliation with the PRD done (below); the crossing (operator arming + `#406`) scoped as the next step.
- [x] The operator preconditions are ENUMERATED + owned (checklist O1-O6) -- they gate the crossing, NOT this checkpoint.

## Reconciliation with the PRD (filled at close)

- **Implemented vs PRD intent:** YES -- the built three-layer validation matches the §6 accretion (the learning-wire rung + this checkpoint). L1 memory coherent (the ADR-0018 chain); L2 the cross-uid recall boundary + persona-context pins (SHADOW, fail-closed-to-empty); L3 the persona-tied lesson metadata + the toolkit->Embers export seam (byte-parity proven); + the e2e tier (an integration CI job + the gated real-`claude -p` dogfood).
- **Drift / deviations:** ONE ratified deviation -- persona binding INTO the `world_anchored` SIGNED basis (gap8-a0b) was DEFERRED to a multi-party commons (#569, the single-user ratification), behind the in-band `arming_class:"pre-arm"` discriminator (zero migration debt, a two-way door). A3 closes on v1 (the frozen node + `meta.minter` + byte-parity), with NO cross-repo v2 coordination. Persona stays a self-asserted, weight-0 label (integrity != provenance, #273) until an authenticated minter arms.
- **PRD updates made:** none required; this phase realizes the existing §6 accretion. The single-user commons posture is recorded in the checklist's `## Decision` section (RATIFIED 2026-07-11) + ADR-0022.
- **Next-phase readiness:** the crossing (operator arming O1-O6 + `#406`) is READY-WITH-PRECONDITIONS, all named in the checklist. Design debt handed forward (the architect lens): (1) persona-into-`world_anchored`-basis is a BREAKING store-schema migration -- plan it as a discriminated v2 (the `live_pending` v2 is the proven template), not an additive pin; (2) consolidate the diffuse 4-axis arming lattice into one all-or-none `resolveArmedContext` preflight before O6; (3) the two-sided cross-repo byte-parity needs a shared golden-vector owned on BOTH sides; (4) the persona dual-lane (the `live_pending` pin vs the export-time `minter` labels) must be reconciled by the authenticated minter. None gate THIS close (all are arming-crossing concerns).

## Open questions (resolved at close)

- Blueprint-board carries: KB-body inlining stays v1 honest-thin (inline-then-pin DEFERRED, YAGNI -- no
  pin-consumer); the `LOOM_PERSONA_MATERIALIZE` default stays OFF (no behavioral flip this phase);
  attested-pin honesty is self-reported until a kernel signer arms (integrity != provenance, #273, tracked to
  the item-5 minter); the Embers byte-parity handshake shape is SETTLED -- the frozen 7-key node emitted
  VERBATIM + a vendored golden vector re-derived byte-for-byte (A3/#570).
- Sub-phase vs own number: RESOLVED -- a ③.2 internal gate (③.2-XR), NOT a new phase number. The crossing
  (O1-O6 + #406) is the next step under ③.2, not a ③.3.
- ADR lock: RESOLVED -- RECORDED as `packages/specs/adrs/0022-external-readiness-gates-arming-gated.md`. The
  durable trade-off ("validated end-to-end" = the mechanism proven INTERNALLY with recall INERT, NOT that
  recall is live; the live round-trip + hardening stay arming-gated, OQ-NS-6) is locked there.
