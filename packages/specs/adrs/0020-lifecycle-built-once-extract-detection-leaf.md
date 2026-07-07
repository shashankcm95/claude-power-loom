---
adr_id: 0020
title: "Correct ADR-0018: the lifecycle was built once — extract the detection leaf, not a unified lifecycle"
tier: technical
status: proposed
created: 2026-07-07
author: lifecycle-extraction recon (architect + honesty-auditor lenses, firsthand-verified) — human-ratified
superseded_by: null
files_affected:
  - packages/kernel/_lib/recurrence-lifecycle.js
  - packages/kernel/spawn-state/self-improve-store.js
  - packages/specs/adrs/0018-memory-architecture.md
invariants_introduced:
  - "The graduate/retire lifecycle is BUILT ONCE (kernel self-improve-store.js); the lab causal-edge organ is a DIFFERENT mechanism (content-addressed tally + cross-run confirmation + Wilson gate + tombstone), not a second copy — the two substrates' lifecycles stay SEPARATE, never force-fitted under one abstraction."
  - "Only the pure DETECTION organ (recurrence-tally + threshold-classify + cross-window gate) is extracted, as a pure kernel-_lib leaf (packages/kernel/_lib/recurrence-lifecycle.js), consumed by the ONE real consumer; each substrate keeps its own EXIT handler (scar -> rule; lesson -> gated recall), so ADR-0018 fork #3 is preserved."
  - "This ADR CORRECTS ADR-0018 invariant #1 (the 'extracted ONCE, never re-implemented per substrate' clause was premised on the lifecycle being built more than once, which is false at the code level). ADR-0018's other invariants — two-substrate/one-kernel structure, supersede-not-fork, store-separation, Tier-2b home — STAND unchanged."
related_adrs:
  - 0018
  - 0016
  - 0015
related_kb:
  - architecture/crosscut/single-responsibility
  - architecture/crosscut/dependency-rule
---

## Context

ADR-0018 (invariant #1) mandated: *"the graduate/retire lifecycle is extracted ONCE, never re-implemented per
substrate,"* motivated by the claim that *"the same graduate/retire lifecycle has been designed or built more than
once."* The **designed-more-than-once** half is true and load-bearing (three uncited design notes re-derived the same
idea — that is what supersede-not-fork fixes). The **built-more-than-once** half was never probed.

A 2026-07-06 read-only recon (five subsystem mappers + an architect and an honesty-auditor lens, each firsthand-verified
against the code) falsified the built-twice reading:

- The graduate/retire lifecycle is **built exactly ONCE** — `packages/kernel/spawn-state/self-improve-store.js`
  (recurrence counter -> `signalPolicy` threshold/risk gate -> `executeGraduation` -> terminal status).
- The lab causal-edge organ (`packages/lab/causal-edge/`) is a **different mechanism**, not a second copy:
  a content-addressed group-by tally (`lesson-consolidate.js`), cross-run *confirmation*, a Wilson-interval HARDEN gate,
  and an immutable tombstone (`live-disposal.js`). Grep-confirmed **zero shared code, zero cross-import** with the
  kernel lifecycle.
- `scripts/memory.js` (operating-memory scars) has **no lifecycle code at all** — scar graduation is a human
  `/self-improve` discipline. The ghost-protocol drift organ *feeds* the kernel counter; it is not a second lifecycle.

So "extract the lifecycle ONCE to deduplicate" cannot deduplicate code that does not exist in duplicate, and a shared
abstraction over the two dissimilar mechanisms would be **false-DRY** (violating ADR-0018's own "keep the substrates
separate" invariant). ADR-0016's YAGNI gate ("extract on the *second real consumer*, not in anticipation") is **not
met**: there is one full consumer plus one different-mechanism organ. ADR-0018 even contains the tell — `:126` calls the
extraction *"currently-unbuilt work,"* which contradicts *"built more than once."*

This is the **runtime-claim-probe discipline catching a present-tense substrate claim ADR-0018 shipped unprobed** — the
same class the discipline exists to prevent, applied to ADR authoring.

## Decision

**Correct ADR-0018 invariant #1, and ship only the honest, narrow extraction.**

1. **Correct the invariant.** The lifecycle is built ONCE; the two substrates' lifecycles are **different mechanisms and
   stay separate**. Share identity/scoring PRIMITIVES only where a genuine second consumer exists (ADR-0016), never a
   unified graduate/retire lifecycle over the two mechanisms.
2. **Extract the pure DETECTION organ** — recurrence-tally + threshold-classify + cross-window gate — as a pure leaf
   `packages/kernel/_lib/recurrence-lifecycle.js` (`STAGE`, `hasConverged`, `isGraduateEligible`, `classifyRecurrence`).
   No I/O, no clock, no mutation. It **names the organ once** so a future fourth reinvention is visible (the ADR-0018
   anti-drift goal), even though it has a single consumer today.
3. **Wire the ONE real consumer** — the kernel `self-improve-store.js` `_runScan` delegates its detection predicates to
   the leaf (removing the graduate-eligible predicate that was duplicated verbatim at two sites). The store keeps its
   queue mutation + `executeGraduation` (observations.log) **EXIT**. The leaf never names a terminal state, so
   **fork #3 (rule vs gated-recall) is preserved** — each substrate owns its exit.
4. **Leave the lab untouched** — a documented forward seam, not a wired dependency. `LIVE_SOURCES = Object.freeze([])`
   weight-inertness is preserved by non-action; the PR touches zero `packages/lab/` files.
5. **ADR-0018's other invariants STAND** — the two-substrate/one-kernel structure, supersede-not-fork, store-separation,
   and the Tier-2b home are unchanged. This ADR does **not** wholesale-supersede ADR-0018; it corrects invariant #1.

Per supersede-not-fork, this correction is itself a new dated ADR that names ADR-0018, not a fresh parallel design note.

## Consequences

**Positive:**

- The kernel gains a tested pure leaf; the abstract detection organ is single-sourced, so a fourth re-derivation is
  visible at review.
- The record no longer authorizes a false-DRY dedup of two dissimilar mechanisms; the "built twice" overclaim is
  corrected against firsthand evidence.
- The lab SHADOW substrate is untouched — the safest posture for a weight-inert experiment.
- Behavior is preserved on every input the store's own writer produces (the existing 997-line contract + the leaf
  tests both pass); the leaf is strictly *fail-closed-safer* on a malformed externally-injected `count` (a missing /
  non-numeric count defers to below-threshold rather than surfacing a spurious candidate) — never more permissive.
  Verified by a VALIDATE board (code-reviewer + a hacker 90k-combo differential fuzz + honesty-auditor; all GREENLIGHT).

**Negative:**

- A single-consumer extraction whose second consumer is a **documented forward seam**, not a wired dependency — honestly
  marginal against ADR-0016's second-consumer YAGNI gate. Justified by the anti-drift value of naming the organ once
  (USER-chosen over the docs-only alternative).
- Two physical lifecycle mechanisms remain; a future author must still avoid conflating them (the leaf's header comment
  and this ADR are the guard).

**Open questions:**

- If/when the lab recurrence-tally wants the shared cross-window gate, does it adopt the leaf, or does the confirmation
  mechanism stay wholly separate? Deferred until a real need appears (the `FORKS.md` FORK-3 frontier).

## Alternatives Considered

### Alternative A: literal dedup of two implementations (ADR-0018 as written)

Rejected: firsthand grep shows zero shared lifecycle code and zero cross-import; there is nothing to deduplicate. A
shared interface wide enough to admit both mechanisms would constrain neither — the "a shared abstraction that fits
neither" failure.

### Alternative B: extract the full graduate + exit lifecycle

Rejected: collapses ADR-0018 fork #3's deliberate trust-ceiling split (scar -> hard rule vs lesson -> gated recall) and
forces the trusted human-authored lane to carry the machine lane's confirmation/Wilson/tombstone machinery.

### Alternative C: docs-only correction, build no leaf

The honesty-auditor's preferred shape (ADR-0016 YAGNI is not literally met at one consumer). Rejected by USER choice:
naming the detection organ once has real anti-drift value (it is the exact miss ADR-0018 diagnosed), and the leaf is a
pure, tested, single-tier cleanup with zero lab risk.

## Status notes

- 2026-07-07 — proposed (lifecycle-extraction recon + human ratification).

## Related work

- ADR-0018 (memory architecture) — invariant #1 corrected here; its other invariants stand. `superseded_by` stays null.
- ADR-0016 (extract-pure-leaf-for-cross-layer-reuse) — the second-consumer YAGNI gate this reshape honors (and honestly
  flags as marginal at one consumer).
- ADR-0015 (failure-signature-schema-freeze) — the frozen identity precedent.
- Synthesis snapshot: `~/.claude/library/.../session-snapshots/volumes/2026-07-06-memory-design-synthesis.md`.
- `docs/FORKS.md` FORK-2 (the lifecycle-extraction branch, resolved here via rebase-on-return).
