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
| A1 | `recall-inject-boundary.js` (cross-uid subprocess boundary) + updated disjointness dam + fail-closed tests | L2 | BLOCKER | to be issued | ▶ blueprint Wave 1 (fork RESOLVED) |
| A2 | persona-context pins on the lesson + persona INTO the signed basis (gap8-a0b) + `recall_graph_root` | L2/L3 | BLOCKER | to be issued | ▶ blueprint Waves 2-3 (name the mint edit sites) |
| A3 | toolkit->Embers export seam (`bank --node --meta --key`) + byte-parity handshake | L3 | BLOCKER | to be issued | ▶ blueprint Wave 4 (byte-parity = OPEN cross-repo confirm) |
| B1 | memory-architecture coherence CONFIRM (ADR chain + both suites + separation) | L1 | MAJOR | to be issued | ▶ mostly a regression assertion (L1 BUILT) |
| B2 | fix the 4 canonical memory ADRs' `status: proposed` -> `accepted` | L1 | MINOR | to be issued | ▶ docs-consistency (3b) |
| C1 | establish `tests/integration/` as a real tier + a CI job | all | BLOCKER | to be issued | ▶ the structural e2e gap |
| C2 | promote `_spike/real-e2e-actor-dogfood.js` into a gated internal end-to-end dogfood (real `claude -p` + `gh`, SHADOW-dry) | all | BLOCKER | to be issued | ▶ the "validated end-to-end" bar |

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
