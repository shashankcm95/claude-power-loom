---
adr_id: 0022
title: "External-readiness = exactly these gates; the live round-trip stays arming-gated"
tier: technical
status: accepted
created: 2026-07-12
author: "phase-close 3.2-XR sign-off (3-lens honesty-auditor + code-reviewer + architect)"
superseded_by: null
files_affected:
  - docs/phases/phase-external-readiness.md
  - packages/specs/plans/2026-07-10-external-readiness-checklist.md
  - docs/ROADMAP.md
  - packages/lab/causal-edge/weight-source-gate.js
  - packages/lab/persona-experiment/recall-inject-boundary.js
  - packages/lab/world-anchor/live-recall-store.js
  - packages/lab/world-anchor/export-bank-pair.js
invariants_introduced:
  - "The external-readiness checkpoint (③.2-XR) is DECLARED CLOSED by exactly this gate-set and no more: L1 memory-architecture coherence (the ADR-0018 chain + both substrate suites + the disjointness dam + no-auto-promotion); L2 the cross-uid recall-inject boundary built + fail-closed-to-empty + the disjointness dam updated + the persona-context pins sealed on `live_pending`; L3 the toolkit->Embers export seam built + byte-parity PROVEN; e2e a real integration CI tier + a gated real-`claude -p` dogfood harness. Persona INTO the `world_anchored` signed basis (gap8-a0b) and a captured green real-actor run are NOT in the gate-set (they are named residuals)."
  - "\"Validated end-to-end\" for this checkpoint means the MECHANISM is proven INTERNALLY with recall INERT -- NOT that recall is live, a weight hardens, or a stranger repo was ingested. Per OQ-NS-6, the checkpoint HARDENS NOTHING; only an external maintainer merge hardens trust. The checkpoint passing does not arm anything."
  - "The SHADOW guarantee is STRUCTURAL and grep/test-verifiable, not a promise: `weight-source-gate.js` keeps `LIVE_SOURCES = Object.freeze(isWorldAnchorArmed() ? [WORLD_ANCHOR_SOURCE] : [])` (frozen-empty on every un-armed box, with NO caller-overridable live-source injection seam); the recall boundary returns '' at the STRICT `LOOM_RECALL_INJECT` flag gate by default and fail-closed-to-empty on every reason-bearing reject; the `world_anchored` / `live_pending` stores are exact-set closed and content-address-verify on read. Any change that lets a NON-operator, same-uid action cross into live recall-influence or a live weight breaks this ADR."
  - "The live crossing (recall influencing a solve, a weight hardening, a stranger-repo ingest) is OPERATOR-ARMED and out of every build session's scope. The operator preconditions O1-O6 (cross-uid broker deploy #404, actor-uid-separation #412, the item-5 authenticated minter, F-W4 fork arming, the USER #273 sign-off, the first external PR #406) gate the CROSSING, not this checkpoint. Claude NEVER touches /etc/loom, sets an arming flag, or runs --attested-cross-uid (task_d722450d)."
related_adrs:
  - 0012
  - 0017
  - 0018
related_kb:
  - architecture/discipline/trade-off-articulation
  - architecture/ai-systems/evaluation-under-nondeterminism
---

## Context

The north-star ladder (`memory/2026-06-11-north-star-autonomous-sde-trust.md`) makes the apex an
EXTERNAL-maintainer merge of a Power-Loom-authored PR, and OQ-NS-6 is load-bearing: **a backtest or an
engineered signal NARROWS trust; only a world-anchored merge HARDENS it.** Before Power Loom may ingest a
stranger repo, solve it, and push a PR, the whole learning substrate must be validated END-TO-END across three
layers (memory, the plugin learning-wire, the minted persona-tied lessons). That validation is the
external-readiness checkpoint (`docs/phases/phase-external-readiness.md`, ③.2-XR).

The checkpoint is the last INTERNAL gate before the first external PR (#406). It was built SHADOW across 8 PRs
(#565 memory-coherence + ADR-status; #566 the recall boundary; #568 the persona-context pins; #569 the
single-user commons ratification; #570 the Embers export seam; #571 the integration CI tier; #572 the shared
test-runner; #573 the gated real-`claude -p` dogfood) and closed by a 3-lens `/phase-close`.

The decision this ADR locks is the checkpoint's ONE durable trade-off, surfaced as an open question in the
phase doc and flagged by both the honesty-auditor and architect lenses at close: **what does "validated
end-to-end" actually mean here, and what is the exact gate-set that constitutes "ready"?** Without an explicit
answer, a future reader could (a) read "validated end-to-end" as "the loop runs live" (it does not), or (b)
quietly grow or shrink the gate-set, so that "external-readiness" drifts from what was actually proven.

## Decision

We lock the external-readiness checkpoint to **exactly the gate-set enumerated in `invariants_introduced`**, and
we define **"validated end-to-end" as "the mechanism is proven INTERNALLY, with recall INERT"** -- explicitly
NOT "recall is live." The live round-trip (recall influencing a solve, a weight hardening, a stranger-repo
ingest) **stays arming-gated** and is owned by the operator crossing (O1-O6 + #406), never a build session.

Concretely:

- **The gate-set is closed and named.** Adding a gate, or claiming a residual as a gate, is a change to this ADR
  (supersede it with a new dated ADR). Two things are named RESIDUALS, not gates: persona bound INTO the
  `world_anchored` signed basis (gap8-a0b, RATIFIED-DEFERRED to a multi-party commons per #569), and a captured
  green real-actor run (the C2 harness fail-closes the actor on a deployed box until operator arming).
- **The SHADOW guarantee is structural.** `LIVE_SOURCES` stays frozen-empty un-armed with no injection seam; the
  boundary is fail-closed-to-empty and byte-inert by default; the stores are exact-set closed and verify-on-read.
  These are grep/test-verifiable, so "the checkpoint hardens nothing" is a checkable property, not a claim.
- **The crossing is operator-owned.** The checkpoint passing arms nothing. O1-O6 gate the crossing; Claude never
  touches the arming surface.

## Consequences

**Positive consequences:**

- "External-readiness" has a single, auditable meaning: a fixed gate-set + "internal mechanism proven, recall
  inert." A future session cannot silently redefine it -- redefinition requires a superseding ADR.
- The honesty posture is durable: the phase doc, the checklist, the ROADMAP sign-off, and this ADR all say the
  same thing (the checkpoint NARROWS, it does not HARDEN; only an external merge hardens). The `evaluation-under-
  nondeterminism` failure mode (a mock/internal check mistaken for a real-world outcome) is closed off by
  definition.
- The operator crossing inherits a clean, named contract: every producer O1-O6 consumes exists; every deferral
  is a two-way door.

**Negative consequences (what we sacrifice):**

- "Validated end-to-end" is DELIBERATELY weaker than "the loop works live." We accept that the strongest possible
  evidence (a real external merge) is out of scope here by design -- OQ-NS-6 says only the operator crossing can
  produce it. This ADR makes the weaker claim explicit rather than letting the phrase overclaim.
- The gate-set excludes gap8-a0b and a captured green actor run. If a future consumer needs persona in the signed
  basis or a live-path green run, that is NEW work behind a superseding decision, not a silent extension here.

**Open questions / future re-evaluation triggers:**

- Persona-into-`world_anchored`-basis (gap8-a0b) is a BREAKING store-schema migration when it arms (node_id /
  content_hash rederivation); plan it as a discriminated v2 (the `live_pending` v2 is the proven template), not an
  additive pin. Re-evaluation trigger: a second independent `human_root` + a shipping pin-consumer (the #569 flip
  conditions).
- The arming surface is diffuse (4 independent axes; only 2 coherence-coupled). Consolidate into one all-or-none
  `resolveArmedContext` preflight before O6 (PACT's `arming-manifest.js` is the template). This ADR does not
  build that; it names it as a crossing precondition.
- The cross-repo byte-parity is proven one-sided (a vendored Embers golden vector + an independent CI
  re-derivation). A two-sided shared golden-vector owned on BOTH repos is the harder guarantee, deferred.
- The #273 residual (integrity != provenance) stays open until an authenticated minter arms; persona in the
  export meta is a self-asserted, receiver-weight-0 label until then. This ADR keeps that residual NAMED and
  weight-inert; it does not close it.

## Alternatives Considered

### Alternative A: decline the ADR; leave the trade-off in the phase doc only

The phase doc is a living, editable artifact; a present-tense status claim in it decays. The one durable
definitional decision ("what external-readiness IS") deserves the immutable, supersede-only ADR surface so it
cannot silently drift. Rejected in favor of recording.

### Alternative B: widen the gate-set to include gap8-a0b + a captured green actor run

That would make the checkpoint depend on operator arming (the cross-uid signer, a deployed actor uid) -- i.e. it
could not close as a pure build-session gate, contradicting the whole point of an INTERNAL checkpoint. The
single-user ratification (#569) already resolved gap8-a0b as multi-party-only. Rejected: these are correctly
residuals.

### Alternative C: do nothing

Leaving "validated end-to-end" undefined invites exactly the two failure modes above (over-reading it as "live,"
or drifting the gate-set). The status quo is not acceptable because this is the last gate before a real external
action, where an over-claim is most costly (OQ-NS-6 stakes).

## Status notes

- 2026-07-12 -- proposed + accepted at the ③.2-XR phase-close (3-lens all-CLOSEABLE); records the checkpoint's
  one durable trade-off.

## Related work

- Phase: ③.2-XR external-readiness (`docs/phases/phase-external-readiness.md`); the living checklist
  (`packages/specs/plans/2026-07-10-external-readiness-checklist.md`, incl. the `## Decision` single-user
  ratification); the ROADMAP phase-close sign-off.
- ADR-0017 (lab-grade integrity bounded-not-closed) -- the integrity != provenance residual this checkpoint
  keeps NAMED and weight-inert.
- ADR-0012 (a PreToolUse hook's `updatedInput` is inert on Agent spawns) -- why arming/enforcement is structural,
  not runtime-injected.
- ADR-0018 (the memory architecture) -- the L1 layer this checkpoint asserts coherent.
- KB: `architecture/discipline/trade-off-articulation` (name the sacrifice explicitly);
  `architecture/ai-systems/evaluation-under-nondeterminism` (a mock/internal check is not a real-world outcome).
