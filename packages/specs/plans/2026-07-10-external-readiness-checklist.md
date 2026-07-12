# External-Readiness Checklist — the gate before ingesting a stranger repo

**Purpose (drift-guard):** the items that MUST be resolved before Power Loom ingests an EXTERNAL (stranger)
repo, solves it, and pushes a PR - with the substrate validated END-TO-END across three layers. This is the
canonical tracker for the **external-readiness checkpoint** (`docs/phases/phase-external-readiness.md`); it
is the living companion to that phase doc.

**Relationship to the beta-readiness checklist** (`2026-06-23-beta-readiness-checklist.md`): that doc tracks
the DELIVERY MECHANISM (broker deploy `#404`, actor-uid `#412`, modify-diff `#405`, the launch gate `#406`).
This doc EXTENDS it with the LEARNING SUBSTRATE - the memory architecture, the plugin learning-wire, the
minted lessons + persona metadata, and the e2e test tier. **Both must be satisfied**: the delivery blockers
gate the CROSSING (operator/deploy); the learning tracks below gate calling the substrate VALIDATED.

**Rule:** no stranger-repo ingest until the learning tracks (A-C) close **and** the beta-readiness delivery
blockers close **and** the USER's `#273` sign-off lands. Per OQ-NS-6, only the external merge HARDENS - the
checkpoint proves the mechanism internally; it does not (and cannot) harden anything.

## Where we stand (firsthand-probed 2026-07-10)

- **Layer 1 (memory architecture) is BUILT + phase-closed.** ADR-0018/19/20/21 merged (#517-531);
  `recurrence-lifecycle.js` green; both substrate suites present; separation enforced (the
  `drafter-recall-disjointness` dam green + no-auto-promotion). Needs a coherence CONFIRM, not a build.
- **Layer 2 (plugin learning-wire) is BLUEPRINT-only.** The recall->solve wire is MISSING (grep=0); the
  fork was RESOLVED to the cross-uid boundary module; it is SHADOW-safe to build, live round-trip
  arming-gated.
- **Layer 3 (minted lessons + persona) is PARTIAL.** The `live_pending` mint exists; persona is only an
  unauthenticated `built_by` LABEL (the signed basis carries no persona); the 4 pins + the Embers export
  seam are MISSING.
- **The e2e tier is MISSING.** 355 unit tests, 0 integration/e2e; the only real-boundary exercise is a
  manual `_spike/` out of CI - exactly the "named residual" phase-close permits and this checkpoint promotes.

## The gate (must close before a stranger-repo ingest)

| # | Track / item | Layer | Severity | Issue | Status |
|---|---|---|---|---|---|
| A1 | `recall-inject-boundary.js` (cross-uid subprocess boundary) + updated disjointness dam + fail-closed tests | L2 | BLOCKER | [#566](https://github.com/shashankcm95/claude-power-loom/pull/566) | ✅ DONE (blueprint Wave 1, SHADOW half) |
| A2 | persona-context pins on the `live_pending` node + `recall_graph_root` | L2/L3 | BLOCKER | [#568](https://github.com/shashankcm95/claude-power-loom/pull/568) | ✅ DONE (blueprint Wave 2; 4 pins sealed into the `live_pending` basis, SHADOW). **gap8-a0b (persona INTO the `world_anchored` SIGNED basis) → DEFERRED** per the single-user ratification (§ Decision): the node stays frozen/meta-only; gap8-a0b is required only at multi-party |
| A3 | toolkit->Embers export seam (`bank --node --meta --key`) + byte-parity handshake | L3 | BLOCKER | [#570](https://github.com/shashankcm95/claude-power-loom/pull/570) | ✅ DONE (v1: `export-bank-pair` emits the frozen 7-key node VERBATIM + the exact 3-key Embers meta `{minter, prUrl, repoSlug}`; byte-parity PROVEN (a vendored Embers golden vector re-derived byte-for-byte in the unit tier + an independent CI re-derivation in the integration tier); SHADOW/weight-0. The v2 advisory pins DEFERRED — no pin-consumer, single-user ratified) |
| B1 | memory-architecture coherence CONFIRM (ADR chain + both suites + separation) | L1 | MAJOR | [#565](https://github.com/shashankcm95/claude-power-loom/pull/565) | ✅ DONE |
| B2 | fix the 4 canonical memory ADRs' `status: proposed` -> `accepted` | L1 | MINOR | [#565](https://github.com/shashankcm95/claude-power-loom/pull/565) | ✅ DONE |
| C1 | establish `tests/integration/` as a real tier + a CI job | all | BLOCKER | [#571](https://github.com/shashankcm95/claude-power-loom/pull/571) | ✅ DONE (the `integration-tests` CI job runs `tests/integration/*.integration.js` w/ the vacuous-pass guard; first member = the A3 export-seam e2e via a REAL CLI subprocess + an INDEPENDENT Embers-side seal re-derivation; `*.e2e.js` reserved for C2's gated e2e) |
| C2 | promote `_spike/real-e2e-actor-dogfood.js` into a gated internal end-to-end dogfood (real `claude -p` + `gh`, SHADOW-dry) | all | BLOCKER | [#573](https://github.com/shashankcm95/claude-power-loom/pull/573) | ✅ DONE (`tests/e2e/real-e2e-actor-dogfood.e2e.js`: RUN_E2E gate + exit-2 clean skip + a unit-tested `decideGate` w/ the containment skip-vs-FAIL split; SHADOW-dry preserved, 0700 tmpdir fixed. A real run FIRED: harness ran end-to-end + the host-claude-guard fail-closed the actor [`deployed-unconfigured` — this box's `/etc/loom` marker; never bypassed]. **RESIDUALS: the actor-solve needs operator cross-uid arming; the real-`gh` PR-observation half is absent = named**) |

## Decision — single-user commons posture (RATIFIED 2026-07-11)

The USER RATIFIED the **single-user LEDGER** posture (from an architect-synthesized decision brief this
session): Embers stays single-user / operator-vouched / meta-only as the correct steady state for the current
ladder. This is **ORTHOGONAL to the trust ladder** — single-vs-multi-party is the commons's *party-count*
(how many independent minter roots bank into one Embers), a horizontal ADOPTION axis, NOT the vertical trust
axis. Rung-1 → apex is single-minter at every rung; the "external" in Rung-2 is the forge/merge being
anchored elsewhere, NOT a second minter inside Embers. **Single-user is sufficient for Rung-1 AND Rung-2**
(the Embers board: "at single-user Rung-1 the entire v2 bump delivers zero trust or behavioral value").

**DEFERS a named bundle** (behind the in-band signed `arming_class:"pre-arm"` discriminator → zero migration
debt; deferral is a two-way door):

- **gap8-a0b** — binding persona into the `world_anchored` node's SIGNED basis at mint. The Embers `ember/v2`
  contract froze the node (`embers/docs/ember-v2-contract.md` §2: pins are META-ONLY, the node is UNCHANGED
  for v2); gap8-a0b is required only for a multi-party commons (single-user: the operator vouches).
- The **v2 predicate build** + the toolkit v2 advisory-pin export — no pin-consumer exists (the Trust Explorer
  UI is deferred; YAGNI).
- The **`persona_id` opaque-id split**, the **witness-network arming** (Embers' P6 CLIENT half is
  shipped-dormant, ADRs 0009-0011; the operator network/witness half is deferred), the **`inherited`** mode.

**UNBLOCKS:** A3 closes on **v1** — the frozen 7-key node + `meta.minter` + the byte-parity handshake — with
NO cross-repo v2 coordination.

**Flip conditions (BOTH must hold to build multi-party):** (a) a concrete SECOND independent `human_root`
wanting to bank/consume in the SAME commons (real adoption — NOT the operator's own multi-uid broker, which is
one `human_root`), AND (b) a shipping pin-consumer (the Trust Explorer UI or a cross-receiver confirmation
loop). Until both fire, single-user is the steady state, not a stopgap — Embers' PRD frames multi-party as a
demand-side product bet, not a ladder rung.

## Operator preconditions for the CROSSING (TRACKED, not this checkpoint's build - Claude never runs these)

These gate the stranger-repo INGEST, not the checkpoint. They reuse the existing beta-readiness issues -
NOT re-numbered here (drift-guard):

| # | Item | Issue | Status |
|---|---|---|---|
| O1 | cross-uid `loom-broker` deploy (root-owned node) | [#404](https://github.com/shashankcm95/claude-power-loom/issues/404) | open (operator) |
| O2 | actor-uid-separation (makes `#404` sufficient vs a rogue actor) | [#412](https://github.com/shashankcm95/claude-power-loom/issues/412) | open (operator) |
| O3 | item-5 authenticated cross-uid edge-minter DEPLOY (the `#273` close) | (Part-B R2) | held-for-arming |
| O4 | F-W4 fork emit arming (classic `public_repo` PAT + object-sharing probe) | `2026-07-02-fork-emit-fw4-arming-scope.md` | held-for-arming |
| O5 | the USER `#273` trust sign-off | (Part-B R3) | pending USER |
| O6 | the first real EXTERNAL PR (the launch gate) | [#406](https://github.com/shashankcm95/claude-power-loom/issues/406) | blocked on O1-O5 + tracks A-C |

## Explicitly NOT gating (so they don't re-surface as drift)

- **A maintainer MERGE** is the only OQ-NS-6 HARDENER - an external, unschedulable outcome, not a task. The
  deliverable is the validated substrate + the armed machinery + the USER-pushed PR; the merge is the signal.
- **The LIVE recall round-trip** (recall actually influencing a solve; a weight hardening) is arming-gated
  by design - the checkpoint validates the mechanism internally with recall INERT. Not a checkpoint task.
- **The Trust Explorer UI** (Embers' side) + the revise/re-push loop (Gap-8) + Rung-2 fork scaling - later.

## Sequence

1. **Track B** (memory CONFIRM + the ADR-status fix) - cheapest, mostly a regression assertion; unblocks the L1 exit criterion.
2. **Track A** (the learning wire: boundary module -> pins -> export) - the layer-2/3 build, SHADOW-safe, per the blueprint waves.
3. **Track C** (the e2e tier + the promoted dogfood) - depends on A landing enough to exercise the loop.
4. **The 3-lens `/phase-close`** on the integrated three-layer substrate -> the checkpoint PASSES.
5. **Then** the operator preconditions O1-O6 (the crossing) - operator/USER, never Claude.

## Phase

Created 2026-07-10. The living checklist for `docs/phases/phase-external-readiness.md`; supersedes-by-scope
the delivery-only framing (it folds the beta-readiness delivery blockers in as the O-series crossing gates).
