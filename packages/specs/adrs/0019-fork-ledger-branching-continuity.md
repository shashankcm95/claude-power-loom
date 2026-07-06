---
adr_id: 0019
title: "Track branching decision continuity in a fork-ledger (extends ADR-0018)"
tier: editorial
status: proposed
created: 2026-07-06
author: memory-design synthesis (branching-continuity extension, USER-raised) — human-ratified
superseded_by: null
files_affected:
  - docs/FORKS.md
  - packages/specs/adrs/0018-memory-architecture.md
invariants_introduced:
  - "Operating memory tracks TWO orthogonal continuities: the LINEAR supersession chain (ADR-0018 supersede-not-fork) AND a BRANCHING fork-ledger (docs/FORKS.md) that records not-taken-but-warranted sibling branches."
  - "Each fork records the full option set + the CHOSEN branch (with rationale) + the DEFERRED branches (each with a one-line revisit-trigger) + any REJECTED branches; a DEFERRED branch is a live leaf, a REJECTED branch is pruned and must not be revived without amending the anchor."
  - "Revisiting a deferred branch against the advanced trunk is a dated block appended to the fork (rebase-on-return); fork decisions are demoted-never-deleted — never blind-resumed and never silently dropped."
related_adrs:
  - 0018
related_kb:
  - architecture/discipline/trade-off-articulation
---

## Context

ADR-0018 fixed one memory-design failure mode: the **linear** one. The same graduate/retire lifecycle was designed
twice because no single source of truth existed and each session re-derived a fragment. Its fix — *supersede-not-fork* —
keeps one canonical decision coherent as it evolves along a **depth** axis.

There is a second, orthogonal failure mode ADR-0018 does not address: the **branching** one. A decision point often
spawns *N* parallel warranted directions. We can only go deep on one (DFS). The sibling branches then land in a flat
"still-planned / deferred" pile that:

- **loses the option set and the rationale** — six weeks later "why did we pick X over Y and Z?" is unanswerable; and
- **smears DEFERRED with REJECTED** — a *live leaf* (warranted, blocked-on-X, should be picked up when X happens) reads
  identically to a *pruned* branch (deliberately killed). BFS siblings silently die because nothing distinguishes
  "waiting for a trigger" from "don't revive this."

The user raised this directly (2026-07-06): *"is supersede-not-fork enough? ... when we go deep into one fork, what
happens to the decisions that the BFS choice warrant? ... perhaps something like git allows — branch from a point, and
once merged, get back to the next issue built on top of the existing solution."* The answer is **no, not enough** — the
depth axis and the breadth axis are orthogonal continuities and need distinct mechanisms.

The mechanism for the breadth axis **already exists** and was firsthand-verified: PACT's `docs/FORKS.md` fork-ledger
(user-requested 2026-06-22, flagged "broadly reusable", never folded into the toolkit). It already implements the
git-rebase-on-return model — dated `UPDATE` / `RE-CONFIRM` blocks re-evaluate a deferred branch against the *advanced*
trunk (e.g. a research door returned negative to the revisit-trigger reworded; Embers arrived to re-confirmed
still-deferred on a different axis), and its forks form a tree whose open DEFERRED leaves are the live BFS frontier.

**Why now:** the toolkit's frontier is currently small and fresh (the post-ADR-0018 memory sequencing, the
autonomous-SDE ladder's held rungs, the one deferred trust-ceiling fork). Seeding the ledger now — before those
siblings decay into an undifferentiated pile — is cheap; seeding it later means re-deriving the option sets.

## Decision

Adopt a **fork-ledger** (`docs/FORKS.md`) as operating memory's **branching-continuity** complement to ADR-0018's
linear supersession chain. The addition itself honors supersede-not-fork: this ADR **extends** ADR-0018 rather than
opening a fresh parallel memory-design note.

Mechanics (mirroring PACT's mature instance):

- **Fork entries** — each fork has a stable `FORK-NN` id, a date, a PARENT fork (if it branches off one), the full
  option set, the **CHOSEN** branch with rationale, the **DEFERRED** branches (each carrying a one-line
  **revisit-trigger**), and any **REJECTED** branches. Newest fork on top.
- **DEFERRED vs REJECTED** is a first-class distinction. DEFERRED = a live leaf with a trigger. REJECTED = pruned;
  do not revive without amending the anchor (the relevant ADR or north-star).
- **Grep-auditable revisit-triggers** — every trigger carries at least one **searchable token** (an issue/PR ref
  `#NNN`, a phase tag `Phase-3.2 F-W4`, a gap/item id `Gap-8`, or `USER-decision`), so a plain `grep` — or a future
  `memory fork audit` — can flag a trigger whose event has fired but whose branch was never re-evaluated, *before*
  any CLI exists. Prefer the most specific, stable token (an issue number over a prose phrase).
- **Rebase-on-return** — re-evaluating a deferred branch against the advanced trunk is a dated `UPDATE` / `RE-CONFIRM`
  block appended to the fork, never a blind resume and never a silent delete. This is demote-never-delete (ADR-0018's
  kernel discipline) applied to *decisions* rather than to memory blocks.
- **Two axes, composed** — `MEMORY.md`'s `## Current status` router points at where the trunk *is* (linear); the
  fork-ledger holds the surviving siblings (branching). A future memory change consults both.

The ledger is **seeded** with the live frontier: the post-ADR-0018 memory sequencing (lifecycle extraction, Phase 2,
portability), the autonomous-SDE ladder's held rungs (item-8 Part-B, Gap-8, Gap-9, persona-depth), and the one deferred
trust-ceiling fork (rule vs gated-recall, gated on a USER decision) — plus the standing REJECTED set (merge-the-stores,
library-as-one-memory, lossy index-compression, vendor-exfil review).

## Consequences

**Positive:**

- BFS siblings survive the DFS deep-dive with an explicit revisit-trigger instead of decaying into a flat pile.
- The DEFERRED (live) vs REJECTED (pruned) distinction is legible, so a pruned branch is not re-proposed as new and a
  live branch is not forgotten.
- Decisions get the git branch to merge to return-to-fork-point model: pick up the next warranted direction *rebased
  onto* the advanced trunk, not from the stale fork point.
- The two continuities compose cleanly and are each single-sourced (linear = the ADR chain; branching = `docs/FORKS.md`).

**Negative:**

- Another hand-maintained doc with **no enforced detector** today — the same honest caveat as ADR-0018. PACT's
  841-line `_SESSION-RESUME.md` is standing proof that an unenforced curation discipline erodes; the ledger relies on
  author discipline + the pre-compact review, not on a gate.
- **Revisit-triggers can go stale** — a trigger may reference an event that has already fired without the branch being
  re-evaluated. Mitigated (not enforced) by two conventions: the dated `RE-CONFIRM` block, and the searchable-token
  requirement that makes a fired-but-unaddressed trigger `grep`-auditable even before a `memory fork` CLI is built.

**Open questions:**

- When does a `memory fork add / resolve / revisit` CLI (structured verbs over the ledger) earn its keep? YAGNI today —
  the manual ledger is the KISS choice until it demonstrably fails.
- Should the ledger be generalized to every repo (PACT / plugin / Embers) via the deferred `memory init` bootstrap
  (Q2)? Deferred behind proving the structure on the toolkit repo first.

## Alternatives Considered

### Alternative A: keep the flat "still-planned / deferred" pile

The status quo (a bulleted deferred list in `MEMORY.md`). Rejected: it loses the option set and rationale, and smears
DEFERRED with REJECTED — exactly the failure this ADR names. It is the branching-axis analog of the pre-ADR-0018 drift.

### Alternative B: a fresh parallel design note for the branching axis

Write a new standalone "branching continuity" research note. Rejected: it would itself violate supersede-not-fork by
opening a parallel memory-design thread. Extending ADR-0018 (this ADR) is the discipline-consistent move.

### Alternative C: do nothing

Rely on `MEMORY.md` prose + memory to carry deferred siblings. Rejected: this is the status quo that already lost the
option sets for the current frontier; the drift ADR-0018 fixed on the linear axis simply recurs on the branching axis.

## Status notes

- 2026-07-06 — proposed (memory-design synthesis + USER-raised branching axis; human-ratified).

## Related work

- ADR-0018 (the linear supersede-not-fork anchor this ADR extends).
- PACT's `docs/FORKS.md` — the mature reference instance (dated `UPDATE` / `RE-CONFIRM` rebase-on-return; the
  DEFERRED-vs-REJECTED distinction).
- `packages/specs/research/2026-06-25-autonomous-sde-lifecycle-gap.md` — the source of FORK-3's deferred rungs.
- Synthesis snapshot: `~/.claude/library/.../session-snapshots/volumes/2026-07-06-memory-design-synthesis.md` (the
  `## Fork-ledger` section).
