# Power Loom — Fork Ledger

> A running record of decision **forks**: at each fork, the full option set, the chosen branch (with
> rationale), and the **deferred-with-a-home** branches carrying enough detail to pick up cold. Purpose:
> a future session can revisit a not-taken branch without re-deriving it.
>
> **The two continuities (why this exists alongside ADR-0018).** ADR-0018's *supersede-not-fork* handles
> the **DEPTH / linear** axis — a single canonical decision evolves, and each change supersedes the prior
> ADR rather than opening a parallel note. This ledger handles the orthogonal **BREADTH / branching** axis —
> a decision point spawns *N* warranted directions, we go deep on one (DFS), and the sibling branches must
> **survive the deep-dive** and be picked up later, **rebased onto the advanced trunk** (the git
> branch to merge to return-to-fork-point model). Rationale in [ADR-0019](../packages/specs/adrs/0019-fork-ledger-branching-continuity.md);
> the linear anchor it extends is [ADR-0018](../packages/specs/adrs/0018-memory-architecture.md).
>
> **DEFERRED vs REJECTED — the distinction the flat "deferred" pile loses.** A **DEFERRED** branch is a
> *live leaf*: warranted, blocked-on-X, carrying a one-line **revisit-trigger**. A **REJECTED** branch is
> *pruned*: do not revive without amending the anchor (ADR / north-star). A flat "still-planned" list smears
> the two, so BFS siblings silently die.
>
> **Distinct from** `MEMORY.md` (the linear `## Current status` router — where the trunk *is* right now),
> `_SESSION-RESUME.md` (ephemeral per-session continuity), and `docs/ROADMAP.md` (durable phase status).
> This ledger keeps the FULL option set + the why, so "we chose X over Y, Z" stays legible.
>
> **Convention:** each fork has a stable id (`FORK-NN`), a date, a PARENT fork (if it branches off one), the
> options, the **CHOSEN** branch, the **DEFERRED** branches (each with a one-line revisit trigger), and any
> **REJECTED** branch. Re-evaluating a deferred branch against the advanced trunk = a dated `▶ UPDATE` /
> `▶ RE-CONFIRM` block appended to the fork (demote-never-delete for decisions — never blind-resume; never
> silent-delete). **Newest fork on top.**

---

## FORK-3 (2026-07-06) — autonomous-SDE world-contact ladder: which open rung next?

PARENT: the autonomous-SDE lifecycle gap-map (`packages/specs/research/2026-06-25-autonomous-sde-lifecycle-gap.md`).
The 6-rung INTERNAL ladder + 3 world-contact rungs are mechanism-complete and SHADOW; Gap-7 intake (`#513`/`#514`)
and Gap-9 disposal (`#514`, tombstone-only) shipped. The open rungs are warranted but blocked or unscheduled — none
is being actively built while the memory-restructure trunk (FORK-2) is deep.

- **CHOSEN → hold the ladder** while the memory work (FORK-2) is the active trunk. No rung is mid-build; the
  ladder stays SHADOW + weight-inert (`LIVE_SOURCES = Object.freeze([])`).
- **DEFERRED → item-8 Part-B (the auth edge-minter that closes the `#273` integrity-not-provenance residual).**
  Part A is mechanism-complete; Part B is **HELD** deliberately (inertness = the observe-first dam).
  **Revisit when:** the deployed + attested cross-uid broker arms (Phase-3.2 F-W4), i.e. the moment a weight
  actually *gates* an action rather than staying advisory.
- **DEFERRED → Gap-8 review-loop.** Today only the merge boolean flows back; the richer review-outcome signal
  (what a human/reviewer actually said) does not. **Revisit when:** a world-anchored review surface exists to
  populate the loop AND a concrete consumer would measure something real from it.
- **DEFERRED → Gap-9 background expiry** (disposal is tombstone-only today; no background reaper).
  **Revisit when:** the tombstone lane accumulates enough dead nodes that manual disposal is insufficient, OR
  the `#273` co-forge residual on the auth-tombstone lane needs closing before the mint gates.
- **DEFERRED → persona-depth / instinct** (`0/18` `agents/*.md` carry a depth/instinct layer;
  `packages/specs/research/2026-06-02-archetype-persona-skillvector-model.md`). **Revisit when:** a spawn's
  output quality is empirically bottlenecked on persona shallowness rather than on the shared discipline files.

## FORK-2 (2026-07-06) — post-ADR-0018 memory sequencing: what to build after the linear anchor?

PARENT: FORK-1 (both are children of the 2026-07-06 memory-design synthesis / ADR-0018). With the linear anchor
merged, several warranted next-steps exist and only one can be the active DFS trunk.

- **CHOSEN → this branching fork-ledger** (`docs/FORKS.md` + ADR-0019). Rationale: it is the meta-structure that
  keeps the sibling branches below *alive* with triggers instead of letting them decay into the flat
  "still-planned" pile; cheap (two docs, no code); and it makes the deferrals below honest rather than lossy.
- **DEFERRED → one-time lifecycle extraction (port, don't reinvent).** Extract the graduate/retire lifecycle as a
  shared library both memory substrates consume (the exact reinvention ADR-0018 diagnosed). **Revisit when:** this
  ledger merges — it is the immediate next build.
- **DEFERRED → Phase 2: scars block-cache + weight-aware scored hot-set.** Wire `importance` into `hotSet`
  (it is orphaned in `check` today — recency to refs only), fix the duplicate `24.`, split-by-origin. The
  scored hot-set = `recency-decay x importance x log(refs)` with invariant-class PINNED (GDSF / Generative-Agents
  importance-protector family). **Revisit when:** the lifecycle extraction lands (Phase 2 consumes the shared lib).
- **DEFERRED → portability and bootstrap (Q2 / Q3).** A `_SESSION-RESUME.template.md`, a gitignore for the personal
  copy, computed/relative paths, and a `memory init` that scaffolds the structure (including a `FORKS.md`) in any repo.
  **Revisit when:** the structure is proven on the toolkit repo, then generalize to PACT + Embers.

## FORK-1 (2026-07-06) — the lesson-exit trust-ceiling (ADR-0018's deferred fork #3)

PARENT: ADR-0018 (the two-substrate / one-pattern-kernel decision). The shared kernel's lifecycle terminates in
an *exit state*; the two substrates exit differently, and whether that split is deliberate is genuinely open.

- **CHOSEN (provisional) → keep the two exits SEPARATE.** A scar graduates to a **hard, always-on RULE**
  (`rules/core/*.md`); a lab causal-edge lesson exits to a **soft, weighted, provenance-gated RECALL**. Default
  while unproven: the two are treated as deliberately different trust ceilings (trusted human-authored lane vs
  machine-minted SHADOW lane).
- **DEFERRED → unify the exits: a high-confidence lab lesson ALSO graduates to a hard RULE.** **Revisit when:**
  a causal-edge lesson demonstrably recurs at high confidence AND a human ratifies promoting a machine-minted
  lesson to always-on. **Needs a USER decision** — this is the one deferred branch gated on human judgment, not a
  code event.

---

## REJECTED branches (do not revive without amending ADR-0018 or the north-star)

Recorded so they are not re-proposed as if new:

- **Merge the two memory substrates into one store** (ADR-0018 Alternative A). Forces the trusted human-authored
  lane to carry the machine lane's integrity-not-provenance sealing; the gap-map's *"do not conflate"* (`:214`)
  was a deliberate decision. Only the *lifecycle mechanism* is shared, never the stores.
- **The library as the one memory system** (ADR-0018 Alternative C). `MEMORY.md` + its scar/topic files are
  HARNESS-loaded at session start — that is their purpose as the hot tier; moving them into the toolkit-operated
  library tree breaks the harness load path.
- **Lossy index-compression to hit a byte budget** (the named anti-pattern in the demotion design). Demote by
  score to a colder tier with a `[[link]]` pointer; never paraphrase-to-fit — the dropped clause's importance
  surfaces later.
- **Cross-model / vendor-exfil review** (`#205`, NOT planned). Sends substrate deltas to a third-party vendor; a
  pre-egress scrubber + governance opt-in would be the path if ever revisited.
