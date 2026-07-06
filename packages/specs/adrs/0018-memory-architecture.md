---
adr_id: 0018
title: "Adopt the two-substrate / one-pattern-kernel memory architecture"
tier: technical
status: proposed
created: 2026-07-06
author: memory-design synthesis (architect + honesty-auditor lenses) — human-ratified
superseded_by: null
files_affected:
  - scripts/memory.js
  - _SESSION-RESUME.md
  - packages/lab/causal-edge/
  - docs/phases/README.md
  - packages/specs/research/2026-06-15-recall-graph-experience-layer.md
  - packages/specs/research/2026-06-25-tiered-memory-demotion-design.md
  - packages/specs/research/2026-07-05-memory-restructure-design.md
invariants_introduced:
  - "Memory is TWO substrates (operating-memory + lab code-lesson) on ONE shared pattern-kernel; the graduate/retire lifecycle is extracted ONCE, never re-implemented per substrate."
  - "SUPERSEDE-NOT-FORK: a memory-design change supersedes THIS ADR via a new dated ADR that names it — it does not open a fresh parallel design note; superseded design notes carry a 'folded into ADR-0018' pointer at their top."
  - "Tier-2b semantic memory (scars + topic files) lives in the project-memory dir (harness-loaded, operated by scripts/memory.js); the ~/.claude/library tree holds Tier-1 episodic snapshots + checkpoints (operated by the library CLI). Two physical stores, bridged by [[wikilink]] convention."
  - "The operating-memory scar store and the lab causal-edge lesson store stay SEPARATE (gap-map 'do not conflate'); merging the stores is rejected — only the lifecycle mechanism is shared."
related_adrs:
  - 0014
related_kb:
  - architecture/crosscut/single-responsibility
  - architecture/crosscut/information-hiding
  - architecture/crosscut/integration-boundary-contracts
---

## Context

Memory organization has been re-litigated repeatedly, and each pass landed somewhere slightly different:

- `2026-06-15-recall-graph-experience-layer.md` (+ `causal-recall-graph-rfc.md`, `v3.11-experience-layer.md`) — a
  causal recall graph / experience layer with block-addressed pointers and a signature-keyed lifecycle.
- `2026-06-25-tiered-memory-demotion-design.md` — demote-by-score (recency + importance + relevance), demote-never-delete.
- `2026-07-05-memory-restructure-design.md` — the router / episodic / semantic 3-tier, the `memory` CLI (Phase 0 `#515`),
  and the de-mash (Phase 1 `#516`).
- A **parallel, BUILT** substrate the design threads never mention: `packages/lab/causal-edge/` — machine-minted,
  content-addressed code-lesson nodes with `lessonClusterKey(trigger|gotcha|corrective)`, verify-on-read, SHADOW.

A 2026-07-06 synthesis (architect + honesty-auditor lenses, firsthand-verified against the sources) found the root cause
of the drift the user named as *"each time we create something and after a while end up somewhere else."* **The same
graduate/retire lifecycle has been designed or built more than once.** `2026-06-15` has a section literally titled
*"The de-risk: we already run this organ (port, don't invent)"* — it said the lifecycle already exists (the
ghost-protocol drift-taxonomy) and should be *ported*, not reinvented. Yet `2026-07-05` independently reinvented
block-addressing + the graduate/retire lifecycle for scars, **never referencing `2026-06-15`.** The threads did not cite
each other, so block-addressing, hot/warm/cold tiering, and recency+importance scoring were rediscovered from scratch
each time. There was no single source of truth, so every session re-derived a fragment of a design we already had.

**Why now:** Phase 1 is merged, and Phase 2 (scar block-cache) plus three fresh questions — weight-aware caching,
new-repo bootstrap, and portability — are about to add a *fourth* divergent thread unless the structure is pinned first.

## Decision

Adopt ONE canonical memory architecture: **two deliberately-separate substrates built on one shared pattern-kernel.**

### The shared pattern-kernel (defined once, consumed by both substrates)

- Hot / warm / cold tiering (MemGPT/Letta virtual-context framing).
- **Recency + importance + relevance** scoring, with **invariant-class blocks PINNED** against staleness eviction
  (Generative-Agents scoring + the importance-protector). This is where weight-aware caching lives (see Consequences).
- **Demote-never-delete**: move a block to a colder tier with a `[[link]]` pointer; never lossy-compress the index.
- **Structured-signature identity** (no embeddings): a stable anchor / class-tuple, not a vector.
- The **lifecycle**: surprise → structured signature → recurrence count → graduate (to a rule / gated recall) or retire.

### Substrate 1 — OPERATING MEMORY (human/agent-authored, harness-loaded)

Physical home: `~/.claude/projects/<hash>/memory/` + `~/.claude/library/`. Operated by `scripts/memory.js` + the library CLI.

| Tier | What | Home | Built? |
|---|---|---|---|
| T0 ROUTER | `MEMORY.md` ≤200 lines, pointer-only, defers phase-status to `docs/` | project-memory dir | yes (69 ln after Phase 1) |
| T1 EPISODIC | per-session library snapshots, wired from the router by a `workstream:` tag | `~/.claude/library` | store yes; wiring Phase 1 |
| T2a DURABLE | `docs/` (PRD/phases/ADRs) + `specs/` — single source of truth for what/why/decisions/phase-status | repo | yes |
| T2b SEMANTIC | block-addressable scars (`### SCAR-NN` + `[[file#anchor]]`) + topic files + rules; scored hot-cache; reconcile-not-append | project-memory dir | CLI yes (`#515`); block-anchoring is Phase 2 |
| CHECKPOINT | `compact-history.jsonl` machine metadata | library (symlinked) | yes |

Exit state of a scar: a **hard, always-on RULE** (`rules/core/*.md`).

### Substrate 2 — LAB CODE-LESSON SUBSTRATE (machine-minted, lab-loaded, SHADOW)

Physical home: `packages/lab/causal-edge/` + `$LOOM_LAB_STATE_DIR`. Content-addressed causal-edge lesson nodes, keyed by
`lessonClusterKey(trigger|gotcha|corrective)`, verify-on-read, provenance-sealed (OQ-3 kernel-seal + authenticated
minter). Exit state of a lesson: a **soft, weighted, provenance-gated RECALL.** Weight-inert today
(`LIVE_SOURCES = Object.freeze([])`).

### Two resolved forks (decisions, recorded so they stop resurfacing)

1. **Keep the two substrates SEPARATE; extract the lifecycle ONCE.** The split is load-bearing along author
   (human/agent vs machine-mint), loader (harness vs lab runtime), and telos (graduate-to-rule vs provenance-gated
   recall). The gap-map already decided this: *"autonomous-SDE lesson recall. Do not conflate"*
   (`2026-06-25-autonomous-sde-lifecycle-gap.md:214`). Merging would force the trusted human-authored lane to adopt the
   integrity≠provenance machinery it does not need. **But** the graduate/retire lifecycle is the same shape built twice —
   extract it as a shared library both substrates consume, so recurrence-counting + graduate/retire is defined once.
2. **Tier-2b (scars/topic) home = the project-memory dir**, harness-loaded, operated by `scripts/memory.js` — NOT the
   library tree. The library holds Tier-1 episodic + checkpoints. Two physical stores by design, bridged by `[[wikilink]]`.

### The supersede-not-fork discipline (the recursive anti-drift fix)

The memory design ITSELF gets the demote-never-delete + single-source-of-truth treatment it prescribes for memory content:

- **Every future memory-design change supersedes THIS ADR** via a new dated ADR that names it — it does **not** open a
  fresh parallel research note. The three prior design notes each carry a one-line *"folded into ADR-0018"* pointer at
  their top, so a cold reader lands here, not on a divergent draft.
- **This ADR names both substrates + the shared kernel**, so the next author cannot build a third parallel
  implementation without first seeing the pattern already exists in two places (the exact miss that caused the
  `2026-07-05` ↔ `2026-06-15` blindness).

One-sentence anchor: **"Memory is two substrates on one pattern-kernel; the kernel is extracted once; every change
supersedes ADR-0018, never forks a new design note."**

## Consequences

**Positive:**

- The three drifting design notes reconcile into one structure; there is now a single place a memory change starts.
- The three open questions land coherently, not as bolt-ons: **weight-aware caching** is a *shared-kernel* concern
  (`recency + importance + relevance, invariant-pinned` — defined once); **new-repo bootstrap** and **portability** are
  *operating-memory* concerns (the `docs/` + RESUME structure, template/gitignore, computed paths).
- The one-time **lifecycle extraction** replaces two diverging re-implementations with one shared organ.

**Negative:**

- Two physical stores remain to maintain and keep bridged; the bridge is a `[[wikilink]]` convention, not a resolver-enforced link.
- The lifecycle extraction is real, currently-unbuilt work.
- The consolidation reflection pass + the router-line pointer-purity are **disciplines with no enforced detector today**
  — coherence is real at the design level but is NOT enforced-by-construction; re-accretion is still possible (PACT's
  841-line `_SESSION-RESUME.md` is the proof). The `≤200-line` ceiling + the pre-compact `SAVE_PROMPT` are the only
  forcing functions until a `memory check` over the episodic/scar files is promoted from deferred to built.

**Open questions:**

- **Fork #3 (deferred):** should a high-confidence causal-edge lesson also reach the *graduate-to-a-hard-RULE* terminal
  state (unifying the two exits), or are `rule` (hard, always-on) and `gated-recall` (soft, weighted) deliberately
  different trust ceilings? This is genuinely unresolved and needs a future decision.
- When a second curator or a shared operating-memory appears, the deferred `memory check over episodic/scar files`
  detector must be built (the disciplines become insufficient at that point).

## Alternatives Considered

### Alternative A: merge into one memory substrate

One store, one signature scheme, one graduate/retire engine serving both meta-scars and code-lessons. Rejected: it forces
the trusted human-authored lane to carry the machine lane's integrity≠provenance sealing, and forces the machine lane to
carry harness-loading it cannot use. The gap-map's *"do not conflate"* was a deliberate decision, not an oversight.

### Alternative B: keep drifting (no canonical ADR)

Continue with research notes per revisit. Rejected: this IS the status quo that produced the drift. Without a
single-source-of-truth that changes must supersede, the next thread reinvents a fragment again.

### Alternative C: the library as the one memory system

Move everything (scars, topic files, MEMORY.md) into the `~/.claude/library` tree. Rejected: `MEMORY.md` + its
topic/scar files are loaded by the HARNESS at session start — that is their purpose as the hot/warm tier; the library is
toolkit-operated cold storage. Moving them breaks the harness load path.

## Status notes

- 2026-07-06 — proposed (memory-design synthesis + human ratification).

## Related work

- Folded-in design notes (now carry a pointer to this ADR): `2026-06-15-recall-graph-experience-layer.md`,
  `2026-06-25-tiered-memory-demotion-design.md`, `2026-07-05-memory-restructure-design.md`.
- `2026-06-25-autonomous-sde-lifecycle-gap.md` (the *"do not conflate"* decision, `:214`).
- ADR-0014 (memory-root-pointer convention).
- Synthesis snapshot: `~/.claude/library/.../session-snapshots/volumes/2026-07-06-memory-design-synthesis.md`.
