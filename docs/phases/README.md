# Implementation phases — how we build without drifting

This directory is how Power Loom gets built, phase by phase, while staying true to the [PRD](../PRD.md). It
exists so "where are we / what's next" is always answerable at the task grain, and so drift from the product
intent is caught at every phase boundary instead of accumulating silently.

> **Bridge (overlay adoption).** Power Loom already has a mature per-wave task-doc store:
> [`packages/specs/plans/`](../../packages/specs/plans/) (170+ wave docs, each carrying its Runtime Probes +
> VERIFY / Pre-Approval Verification + VALIDATE folds), a live status board [`docs/ROADMAP.md`](../ROADMAP.md),
> and a decision store [`packages/specs/adrs/`](../../packages/specs/adrs/). This hub is the
> **status-at-a-glance overlay + the anti-drift loop** laid over them — it does **not** move the plans. The
> existing `plans/<date>-*.md` files *are* the historical phase task-lists. Going forward, a **new** phase may
> use [`phase.template.md`](phase.template.md) here and still land its detailed wave notes under `plans/`.

## The three layers

| Layer | File(s) | Role | Mutability |
|---|---|---|---|
| **Anchor** | [`docs/PRD.md`](../PRD.md) (defers to the [north star](../../packages/specs/rfcs/2026-06-11-north-star-autonomous-sde-trust.md)) | What the project is, why, the principles, the phase order. | Stable; corrected only by a **dated accretion** when reality diverges. |
| **Implementation** | `docs/phases/phase-N-*.md` (+ the existing [`plans/`](../../packages/specs/plans/) + live [`ROADMAP.md`](../ROADMAP.md)) | The task list for one phase — a living checklist. | Living; checked off, closed with a reconciliation. |
| **Decisions** | [`docs/ADRs/`](../ADRs/) (bridging [`packages/specs/adrs/`](../../packages/specs/adrs/)) | Why we chose X over Y, per wave. | Immutable; a new ADR supersedes. |

> **Session grain — the finer companion to the phase grain.** Below the phase grain sits the SESSION grain
> (what happened in a working session, per workstream). It lives in the operating-memory ROUTER (`MEMORY.md`)
> plus the in-repo resume anchor [`_SESSION-RESUME.md`](../../_SESSION-RESUME.md), which point UP to this phase
> board (they defer PHASE status to [`ROADMAP.md`](../ROADMAP.md), never inline it) and forward to the
> per-session library snapshots. The link is bidirectional: session-close consolidation accumulates the
> evidence that phase-close reconciles against the anchor here — one anti-drift loop at two grains (see
> [`2026-07-05-memory-restructure-design.md`](../../packages/specs/research/2026-07-05-memory-restructure-design.md)
> §3.6).

## The loop (how we don't drift)

1. **Scope** — a phase doc's *Objective* + *Scope* are lifted from [`docs/PRD.md`](../PRD.md) §6. If the PRD (or
   the north star) is silent or ambiguous about the phase, fix the anchor **first** — it is the anchor, not the
   phase doc.
2. **Work** — check off the task list (Build → Test → Validate). For a kernel / security / auth / data-mutation
   diff, Validate is the 3-lens tier (correctness + adversarial-security + claim-vs-evidence). The checkboxes +
   the `Status` header are the visibility; git history is the audit trail.
3. **Close + reconcile** — before a phase is `Complete`, run [`/phase-close`](../../packages/skills/commands/phase-close.md)
   (PM + Principal-SDE + Architect over the *integrated* phase vs its exit criteria) and fill the phase doc's
   *Reconciliation with the PRD* section. **If reality diverged, update the anchor** (a dated accretion in the
   PRD, or an amendment to the north star). Record or fold an ADR.
4. **Re-evaluate + scope next** — compare the implemented list against the PRD's *next* phase, scope the next
   phase doc, and adjust the roadmap if this phase changed the sequence.

**The anti-drift guarantee:** every phase re-grounds in the anchor, and a phase cannot close without a
reconciliation diff — so divergence is surfaced and corrected at each boundary, never carried forward unseen.
This mirrors the codified `/verify-plan` (pre-approval) and `/phase-close` (post-phase) gates.

## Status at a glance

Power Loom's shipped phases are the v3.x spine (the PRD §6 roadmap). Each phase's detailed task-lists +
VERIFY/VALIDATE folds live in the linked `plans/` docs; its decisions live in `packages/specs/adrs/` or the plan
bodies; the running board is [`docs/ROADMAP.md`](../ROADMAP.md).

| Phase | Status | Task docs | Decision record |
|---|---|---|---|
| v3.1 (Phase 2 kernel) | ✅ Released (SHADOW; K1–K14 live exc. dormant/retired) | `plans/` v3.1 range | `packages/specs/adrs/` |
| v3.4–v3.9 | ✅ Phase-closed (per-phase `vX-close` records) | `plans/` v3.4–v3.9 | ADRs 0012/0015 + plan bodies |
| v3.10 (WHO-built provenance) · v3.11 (EXPERIENCE) | ✅ Phase-closed | `plans/` v3.10–v3.11 | plan bodies |
| **③.2 LIVE-BETA** (fork→cross-repo-PR, all SHADOW) | ⧗ In progress | `plans/2026-07-*` (fork-emit F-W1..W4, verify-container VC-W*) | [north star](../../packages/specs/rfcs/2026-06-11-north-star-autonomous-sde-trust.md) + `docs/ROADMAP.md` |

> Prefer "run `node scripts/…` for the live count" over a refrozen integer — a frozen count decays like a stale
> line-number. The authoritative live status is [`docs/ROADMAP.md`](../ROADMAP.md) + the project MEMORY.

## Adding a phase

Copy [`phase.template.md`](phase.template.md) → `phase-N-<slug>.md`, lift the Objective + Scope from the PRD, and
work the loop above. Detailed wave notes still go under [`plans/`](../../packages/specs/plans/) (matching the
`plan-template.md` schema); this hub tracks the phase-grain status and the reconciliation.
