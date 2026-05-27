---
adr_id: 0013
title: "Ship endorsements as a derived view, not a first-class primitive"
tier: technical
status: proposed
created: 2026-05-27
author: 04-architect.theo (HETS-routed C0 decision spawn)
superseded_by: null
files_affected:
  - packages/lab/_lib/endorsement-view.js
  - packages/specs/rfcs/v6-substrate-synthesis.md
invariants_introduced:
  - "INV-16-EndorsementViewDeterministic — pure function; byte-equal output for fixed inputs modulo derived_at"
  - "INV-17-EvidenceLinkRequired — every derived endorsement carries ≥1 evidence_ref to a kernel-emitted record"
  - "INV-18-NoSelfEndorsement — endorser_persona_id != endorsed_persona_id enforced at query-time"
related_adrs:
  - 0014
related_kb:
  - architecture/crosscut/single-responsibility
  - architecture/crosscut/dependency-rule
  - architecture/discipline/trade-off-articulation
---

## Context

The v5.4 → v3.3 substrate roadmap had `E14 Endorsement primitive` scheduled for v3.3 with 4-5 invariants and 5 launch-blocker security controls (anti-gaming, external-evidence requirement, acyclic chain enforcement, idempotency, restraint-type discipline). HETS pair-review at the C0 architect decision (2026-05-27) surfaced that the primitive option fails the §0a pillar-grounding test and structurally amplifies the Trust-Vulnerability Paradox documented in B3 field-survey debt (arxiv 2510.18563).

Forces at play:

- **Pillar grounding**: §0a requires that every new primitive maps to a Vision Pillar directly. Endorsement-as-primitive serves principle-tier values (DRY-of-evidence, audit completeness) but not pillar-tier (no determinism / Byzantine / audit / contract property is implementable ONLY with the primitive). K12 v5.1 precedent (downgrade from mandatory to convention + advisory) applies.
- **Data already captured**: v5.4 K2 envelope + R13 advisory-findings + A6 reputation snapshot + K3 lineage already contain every field a primitive would have stored (endorser/endorsed identity, evidence refs, grade derivable from `commit_outcome` + R13 severity, policy_version, timestamps).
- **Security cost asymmetry**: the 5 launch-blockers exist BECAUSE the primitive creates a writable record class. Removing the primitive removes the attack surface entirely — no anti-gaming because there's nothing to game, no external-evidence-required because the inputs are already kernel-emitted, no acyclic-chain because the projection has no chains.

This decision is being made NOW because v6 is the first post-Phase-0 amendment and the v3.3 budget envelope is being finalized. Deferring would either ship v3.3 with the primitive (paying the security cost) or skip endorsements entirely (losing the orchestrator signal that endorsement provides).

## Decision

Endorsements ship as a **derived view** computed from K2 spawn-records + R13 advisory-findings + A6 reputation snapshot + K3 lineage. The view is a pure function in Lab-layer code at `packages/lab/_lib/endorsement-view.js`, sibling of the E4 reputation aggregator.

Six load-bearing reasons (priority order):

1. **§0a pillar-grounding test fails for the primitive option** — principle-tier, not pillar-tier; K12 v5.1 precedent applies.
2. **Data already captured** — K2 envelope + R13 findings + A6 snapshot + K3 lineage contain every field needed; a primitive duplicates.
3. **SRP violation in the primitive option** — two writers for evidence-about-persona-N-performed-task-T (existing K2/R13/A6 + new endorsement-record).
4. **DIP cleaner in the derived-view** — E4 reputation depends on kernel record abstractions directly (Lab → Kernel); primitive creates horizontal Lab-layer coupling.
5. **Security cost asymmetry (load-bearing)** — the 5 launch-blockers exist BECAUSE the primitive creates the attack surface; removing the primitive removes the surface.
6. **Only unique primitive-enabler is endorser-side reputation** — which IS the Trust-Vulnerability Paradox amplifier B3 explicitly forbids. Negative disambiguator.

Implementation specification:

- Core query: `deriveEndorsements({ k2Records, r13Findings, a6Snapshot, k3Lineage, filter })` returns a list of `{endorser, endorsed, skill_scope, grade, evidence_refs, policy_version, derived_at}` records.
- Grade rubric: `promoted + no findings → strong; promoted + low-severity → adequate; promoted + higher-severity → weak; not-promoted → inadequate`.
- Cache discipline: pure function output MAY be cached at `manifests.derived_views_cache` per §5a.9, keyed by `sha256(k2_records_sha + r13_findings_sha + a6_snapshot_sha + k3_lineage_sha)`. Readers MUST re-verify the input-hash before consuming the cached projection; the cache is perf optimization only, never trusted blindly.

LoC / hours: 350-510 LoC / 8-12h, inside the existing v3.3 envelope.

## Consequences

**Positive consequences**:

- Removes the entire 5-launch-blocker security workstream (anti-gaming, external-evidence, acyclic-chain, idempotency, restraint type) — these no longer exist because the attack surface no longer exists.
- Preserves SRP — single writer per evidence class (K2/R13/A6).
- Preserves DIP — E4 → kernel-records direct dependency (no intermediate primitive).
- Reduces v3.3 budget from estimated 20-35h (primitive path) to honest 8-12h (derived-view path).
- The §0a.3.1 Derived-View No-Amplification Clause gains a worked example.

**Negative consequences**:

- Endorser-side reputation use case is foreclosed (the view has no chain depth, so "I trust X because Y endorsed X and Y is trusted" is non-derivable). This is INTENTIONAL — endorser-side reputation IS the Trust-Vulnerability Paradox amplifier; foreclosing it is the load-bearing security choice.
- View must be re-computed on every consumer access if cache is invalidated. Cache discipline mitigates but introduces a new failure mode (stale cache → readers must verify input-hash; if they skip the check, they consume stale projections). The §5a.7 sibling-output discipline + the DERIVED-VIEW-INVALIDATE operation_class jointly close this.
- The substrate now ships TWO kinds of evidence aggregation: the kernel-canonical record set (immutable, chain-replayable) AND derived views (mutable cache, recomputable). Readers must understand the distinction — see §0a.3.1.

**Open questions**:

- Whether endorser-side reputation re-opens at v3.5+ given containment improvements (kernel-layer network egress + container adapter). Re-evaluation trigger: documented evidence that Trust-Vulnerability Paradox is empirically containable in the substrate's deployment model. Until then, out of scope indefinitely.
- Whether `derived_views_cache` accumulates beyond a reasonable bound. v3.3 ships without cache-GC; v3.4 may need a sweep.

## Alternatives Considered

### Alternative A: Endorsement-as-first-class-primitive

A new kernel-emitted record class with explicit `endorsement` envelope, persisted chain entries, 4-5 invariants enforcing security properties (nonce-uniqueness, acyclic chain, depth-bound, external-evidence-required, restraint type). Rejected per the 6 reasons above. Primary disqualifier: the 5 launch-blockers exist BECAUSE the primitive exists; the derived-view path makes them moot.

### Alternative B: Implicit endorsement (no spec, just convention)

Don't model endorsement at all; let consumers query K2/R13/A6/K3 directly. Rejected because without a named spec, every consumer (E4 reputation aggregator, future routing heuristics, audit tooling) reinvents the projection ad-hoc. The C0 decision keeps the projection as a named spec but Lab-resident, not Kernel-resident.

### Alternative C: do nothing — defer endorsements to v3.5+

The original schedule had E14 in v3.3. Deferring would push the orchestrator-signal use case (Lab-layer "which persona is trusted for this task?") to v3.5+. Rejected because the derived-view path is cheap (8-12h, inside v3.3 envelope) and the signal has value at v3.3 when E4 reputation lands. There is no scope-reduction benefit to deferral.

## Status notes

- 2026-05-27 — proposed by 04-architect.theo via C0 HETS-routed architect spawn; APPROVED by root for v6 §6.4 drafting input.
- v3.3 LOCK target — accepted; ADR locked alongside RFC v6 LOCK.

## Related work

- C0 decision summary: `/tmp/c0-decision-summary.md` (full 6-reason analysis, grade rubric, cache discipline).
- v6 §6.4 — E14 spec (this ADR's implementation specification).
- v6 §0a.3.1 — Derived-View No-Amplification Clause (the pillar-tier normative text E14 obeys).
- v6 §6.13 — invariants 16/17/18 (the testable property contracts).
- ADR-0014 — Memory Root Pointer Convention (sibling v6 ADR; the `manifests.derived_views_cache` discipline E14's cache depends on).
- Trust-Vulnerability Paradox: arxiv 2510.18563 (B3 field-survey debt anchor).
- `packages/specs/research/v3.1-v3.2-field-survey-debt.md` §B3 (INV-A6-NonAuthorizing — composes with this ADR's INV-18).
- `kb:architecture/crosscut/single-responsibility` (SRP — load-bearing for reason #3).
- `kb:architecture/crosscut/dependency-rule` (DIP — load-bearing for reason #4).
