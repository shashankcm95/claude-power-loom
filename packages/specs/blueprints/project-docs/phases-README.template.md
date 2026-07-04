# Implementation phases — how we build without drifting

This directory is how {{PROJECT}} gets built, phase by phase, while staying true to the PRD. It exists so
"where are we / what's next" is always answerable at the task grain, and so drift from the product intent is
caught at every phase boundary instead of accumulating silently.

## The three layers

| Layer | File(s) | Role | Mutability |
|---|---|---|---|
| **Anchor** | `docs/PRD.md` | What the project is, why, the principles, the phase order. | Stable; corrected only by a **dated accretion** when reality diverges. |
| **Implementation** | `docs/phases/phase-N-*.md` | The task list for one phase — a living checklist. | Living; checked off, closed with a reconciliation. |
| **Decisions** | `docs/ADRs/` | Why we chose X over Y, per wave. | Immutable; a new ADR supersedes. |

## The loop (how we don't drift)

1. **Scope** — a phase doc's *Objective* + *Scope* are lifted from `docs/PRD.md`. If the PRD is silent or
   ambiguous about the phase, fix the PRD **first** — it is the anchor, not the phase doc.
2. **Work** — check off the task list (Build -> Test -> Validate). The checkboxes + the `Status` header are
   the visibility; git history is the audit trail.
3. **Close + reconcile** — before a phase is `Complete`, fill its *Reconciliation with the PRD* section: does
   the implemented list match the PRD's intent? Record any drift. **If reality diverged from the PRD, update
   the PRD** (a dated accretion) so the anchor stays true. Record or fold an ADR for the decisions.
4. **Re-evaluate + scope next** — compare the implemented list against the PRD's *next* phase, scope the next
   phase doc, and adjust the PRD roadmap if this phase changed the sequence.

**The anti-drift guarantee:** every phase re-grounds in the PRD, and a phase cannot close without a
reconciliation diff — so divergence is surfaced and corrected at each boundary, never carried forward unseen.

## Status at a glance

<!-- One row per phase. Keep this current — it is the single "where are we" view. -->

| Phase | Status | Task doc | Decision record |
|---|---|---|---|
| P0 — {{title}} | {{○ Future / ▶ Planned / ⧗ In progress / ✅ Complete}} | {{phase-N-slug.md}} | {{ADR-NNNN}} |

## The phase-doc template

Each `phase-N-*.md` carries: a **header** (`Status`, `Realizes` the PRD phase, `Depends on`, `Mode`); an
**Objective** (lifted from the PRD); a **Scope** (IN / OUT); grouped **Tasks** (`Build` / `Test` / `Validate`
/ `Operator-external — tracked, not us`) as `- [ ]` checkboxes; a **Definition of done**; a **Reconciliation
with the PRD** (filled at close); and **Open questions**. See `phase.template.md`.

## Conventions

- **Security-sensitive phases run a multi-lens review** before close (correctness + adversarial + claim-vs-
  evidence), findings folded.
- **Track what you don't execute.** External/operator tasks (deploys, key arming, third-party applications)
  are listed here **for visibility but executed by the operator**, not the build session — flag them so.
- **Mark proposed vs committed.** A phase doc graduates a *proposed* PRD phase into a *concrete* plan when
  it is started; until then the PRD roadmap carries it as proposed.
