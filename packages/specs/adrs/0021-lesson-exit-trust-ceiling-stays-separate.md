---
adr_id: 0021
title: "Resolve ADR-0018 fork #3: the two memory substrates keep SEPARATE lesson-exit trust ceilings"
tier: technical
status: proposed
created: 2026-07-08
author: fork#3 resolution — USER-ratified (keep-separate), 2026-07-08
superseded_by: null
files_affected:
  - docs/FORKS.md
  - packages/specs/adrs/0018-memory-architecture.md
invariants_introduced:
  - "The two memory substrates keep PERMANENTLY SEPARATE lesson-exit trust ceilings: an operating-memory scar graduates to a HARD, always-on RULE (rules/core/*.md, harness-loaded every session); a lab causal-edge lesson exits ONLY to a SOFT, weighted, provenance-gated RECALL. A machine-minted lesson-artifact NEVER auto-graduates across the substrate boundary into a hard rule."
  - "The hard-rule lane stays 100% HUMAN-AUTHORED. A lab lesson may INSPIRE a rule, but only via a human authoring a NEW scar in the operating-memory substrate (the lesson [[link]]-cited as evidence); the human is always the author-of-record on the always-on lane. No cross-substrate auto-promotion machinery is built."
  - "This ADR RESOLVES ADR-0018's deferred fork #3 (== FORK-1 in docs/FORKS.md) to KEEP SEPARATE. ADR-0018 itself STANDS whole-file-immutable; this ADR names + closes its open question. A future change reopening unification must supersede THIS ADR via a new dated ADR."
related_adrs:
  - 0018
  - 0019
  - 0020
related_kb:
  - architecture/crosscut/dependency-rule
  - security-dev/threat-modeling-essentials
---

## Context

ADR-0018 established memory as **two substrates on one shared lifecycle kernel**. The substrates terminate that
lifecycle at DIFFERENT *exit states*:

| Substrate | Terminal exit | Trust ceiling |
|---|---|---|
| operating-memory (scars, topic files) | graduate to a **hard, always-on RULE** (`rules/core/*.md`, harness-loaded every session) | HARD — human-authored, always binding |
| lab code-lessons (causal-edge lessons) | exit to a **soft, weighted, provenance-gated RECALL** | SOFT — machine-minted, SHADOW, advisory |

ADR-0018 left **fork #3** open (`0018:134`): is that split *deliberate* (two permanently-different ceilings), or
should a high-confidence machine-minted lesson also be able to graduate — with human ratification — into a hard
always-on RULE, *unifying* the two exits? The provisional choice was "keep separate"; the ledger recorded it as
**FORK-1** (`docs/FORKS.md:106`) with the deferred **unify** branch's revisit-trigger: *a causal-edge lesson
demonstrably recurs at high confidence AND a human ratifies promoting a machine-minted lesson to always-on.* It was
flagged as needing a **USER-decision**, not a code event. ADR-0020 subsequently *preserved* the fork (its extraction
touched only the shared detection organ; each substrate kept its own exit handler).

**State at decision time:** the revisit-trigger has NOT fired. Every lab causal-edge lesson is still SHADOW /
advisory, gating nothing; none has recurred-at-high-confidence-AND-been-human-ratified for always-on. There is no
evidence *demanding* unification. The USER ratified **keep separate** on 2026-07-08.

## Decision

**Resolve fork #3 = KEEP SEPARATE, as final.** The two substrates have permanently different lesson-exit trust
ceilings:

- A lab causal-edge lesson's terminal state is the **soft, weighted, provenance-gated RECALL**. It can NEVER
  auto-graduate into a hard always-on rule.
- Only a **human-authored scar** reaches the hard `rules/core/*.md` lane. That lane stays **100% human-authored**.
- A lab lesson may still *become* a rule — but only via the **escape hatch**: a human authors a NEW scar in the
  operating-memory substrate, `[[link]]`-citing the lab lesson as evidence. The lesson-*artifact* never crosses the
  substrate boundary; the human is the author-of-record. No cross-substrate auto-promotion machinery is built.

The grounding is the substrate's deepest, most-recurring principle — **integrity ≠ provenance**. A machine-minted
artifact proves self-consistency, never that the legitimate producer authored it; the whole substrate (the #273
family, the arming apparatus, the north-star) refuses to derive *trust* from machine-minted recurrence alone. The
hard-rule lane is the highest-trust artifact in the system (always-on, un-ignorable); its provenance stays a human
author, not a confidence threshold over machine-minted edges.

## Consequences

**Positive:**

- The rule-lane trust model stays **clean and un-conflated** — the operating-memory substrate never has to reason
  "is this rule human-authored or machine-minted-then-ratified?" This is exactly ADR-0018's *do-not-conflate* (its
  Alternative A was rejected for forcing the trusted lane to carry the machine lane's integrity≠provenance sealing).
- **No capability is lost** — the escape hatch means a genuinely-recurring lab lesson can still reach the rule lane,
  with the human as author-of-record and the lesson cited as evidence.
- **No promotion machinery** to build or maintain; the substrate boundary stays a clean seam.
- Consistent with ADR-0020's preserved separation and the north-star's "trust hardens only through a human/world
  provenance event" stance.

**Negative:**

- A genuinely high-confidence, recurring lab lesson requires a human to **re-author** it as a scar to make it
  always-on — mild friction. Mitigated: the new scar `[[link]]`-cites the lesson, so the evidence chain is preserved
  by reference, not lost.
- The "unify" convenience is **permanently foregone** unless a future dated ADR supersedes this one. That is the
  intended cost — reopening it requires a fresh human decision + amendment, not a silent drift.

**Open questions:** none introduced. The sibling FORK-2 branches (portability + `memory init`, Q2/Q3) are
independent and unaffected.

## Alternatives Considered

### Alternative A: unify the exits (the deferred branch)

Add a cross-substrate promotion path so a high-confidence causal-edge lesson graduates — with human ratification —
into a hard always-on rule, carrying its evidence chain. **Rejected:** it adds promotion machinery to build +
maintain for a thin convenience the escape hatch already covers; it conflates the rule lane (mixed
human-authored / machine-minted-then-ratified); and its revisit-trigger never fired (no lesson has recurred at high
confidence and been ratified for always-on). Not revived without superseding this ADR.

### Alternative B: keep the fork deferred

Leave FORK-1 open and revisit when a real lesson recurs at high confidence. **Rejected:** it leaves standing
ambiguity in the canon, and the USER — the decision authority the fork is gated on — is available and chose now.
Deciding on the principle (integrity≠provenance) rather than waiting for a hypothetical is the cheaper, cleaner close.

## Status notes

USER-ratified 2026-07-08 (keep-separate). This ADR is the canonical resolution of ADR-0018 fork #3 / FORKS.md
FORK-1; the ledger entry is marked **RESOLVED** with a back-pointer here. ADR-0018 and ADR-0020 STAND unchanged.

## Related work

- [ADR-0018](0018-memory-architecture.md) — the two-substrate / one-pattern-kernel decision (the anchor; fork #3
  is its open question, now resolved here).
- [ADR-0019](0019-fork-ledger-branching-continuity.md) — the fork-ledger (breadth/branching continuity); this
  resolution closes its FORK-1 leaf.
- [ADR-0020](0020-lifecycle-built-once-extract-detection-leaf.md) — corrected ADR-0018 invariant #1 and
  *preserved* fork #3; this ADR now closes it.
- `docs/FORKS.md` — the ledger, updated with the FORK-1 RESOLVED marker.
