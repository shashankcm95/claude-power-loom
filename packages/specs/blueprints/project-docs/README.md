# Project-docs blueprint

A reusable convention for building a project **phase by phase without drifting from its intent**. Hand this
directory (or its path) to any repo session — it is self-contained and works **with or without the toolkit
installed**. With the toolkit, `/scaffold-project-docs` generates it into a target repo; without, copy the
four templates by hand.

## What it establishes — three layers + one loop

| Layer | Lands at | Role | Mutability |
|---|---|---|---|
| **Anchor** | `<repo>/docs/PRD.md` | What the project is, why, its principles, and the phase order. | Stable; corrected only by a dated accretion when reality diverges. |
| **Implementation** | `<repo>/docs/phases/phase-N-*.md` | The task list for one phase — a living checklist, worked and closed. | Living; checked off, closed with a reconciliation. |
| **Decisions** | `<repo>/docs/ADRs/NNNN-*.md` | Why X was chosen over Y, per wave. | Immutable; a new ADR supersedes. |

The PRD says **what + why + order**; a phase doc says the **steps** for one phase and tracks them; an ADR
records the **decisions** made while doing them.

## The templates

- `PRD.template.md` — the anchor.
- `phases-README.template.md` — the phases hub: the loop, the status table, the phase-doc template.
- `phase.template.md` — one phase's task list.
- `ADR.template.md` — one decision record.

All use `{{DOUBLE_BRACE}}` placeholders. The scaffold (or you, by hand) fills them and strips the
`<!-- guidance -->` comments.

## The loop (the anti-drift mechanism)

1. **Scope** — a phase doc's *Objective* + *Scope* are lifted from the PRD's roadmap. If the PRD is silent or
   ambiguous, fix the PRD **first** — it is the anchor.
2. **Work** — check off the task list (Build -> Test -> Validate). The checkboxes + the `Status` header are
   the visibility.
3. **Close + reconcile** — before a phase is `Complete`, fill its *Reconciliation with the PRD* section: does
   the implemented list match the PRD's intent? Record drift; **if reality diverged, update the PRD** (dated
   accretion). Record or fold an ADR.
4. **Re-evaluate + scope next** — compare the implemented list against the PRD's next phase, scope the next
   phase doc, adjust the roadmap if the sequence changed.

**The guarantee:** a phase cannot close without a reconciliation diff, so divergence is surfaced and corrected
at each boundary — never carried forward unseen.

## How to apply it

- **With the toolkit:** run `/scaffold-project-docs` in the target repo (see
  `packages/skills/commands/scaffold-project-docs.md`).
- **By hand:** copy the four templates into `<repo>/docs/` — `PRD.template.md` -> `docs/PRD.md`,
  `phases-README.template.md` -> `docs/phases/README.md`, `phase.template.md` -> `docs/phases/phase-1-<slug>.md`,
  `ADR.template.md` -> `docs/ADRs/0001-<slug>.md`. Fill the `{{placeholders}}`, delete the guidance comments.

## Reference implementation

The `embers` project (a separate repo) is the first project built on this convention end to end: see its
`docs/PRD.md`, `docs/phases/`, and `docs/ADRs/`. This blueprint is the genericized distillation of that.
