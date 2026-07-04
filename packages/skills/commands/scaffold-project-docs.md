# Scaffold project docs

Bootstrap the phase-doc convention into the current repo — a **PRD anchor**, per-phase **task lists**, and
**ADRs**, tied together by an anti-drift loop — so a project can be built phase-by-phase without drifting from
its intent. A thin generator over the blueprint at `packages/specs/blueprints/project-docs/` (which is the
source of truth and works with or without this toolkit).

## When to use

- Starting (or retrofitting) a project built over multiple phases where you want durable structure and
  visibility: a stable PRD anchor, per-phase checklists, and decision records that stay honest over time.
- Skip for a one-off script or a single-PR change — the ceremony is not worth it.

## What it creates (in the target repo's docs directory)

- `PRD.md` — the anchor (what / why / principles / phase order).
- `phases/README.md` — the phases hub (the loop + a status-at-a-glance table + the phase-doc template).
- `phases/phase-1-<slug>.md` — the first phase's task list.
- `ADRs/0001-<slug>.md` — the first decision record.

## Steps

1. Confirm the target repo, and that it does **not** already have a `PRD.md` — NEVER clobber an existing
   PRD / phases / ADRs. If present, offer to extend (add a phase doc, append to the roadmap) rather than
   overwrite.
2. Read the four templates from `packages/specs/blueprints/project-docs/` (`PRD.template.md`,
   `phases-README.template.md`, `phase.template.md`, `ADR.template.md`) and the blueprint `README.md`.
3. Gather the project's identity from the user and the codebase: name, a one-line tagline, the load-bearing
   principles/invariants, and the phase sequence (mark proposed vs committed). If any of these is unclear,
   **ask** — the PRD is the anchor, so it must be grounded, not guessed.
4. Write the four files into the target repo's docs directory, filling every `{{placeholder}}` and stripping
   the `<!-- guidance -->` comments. Seed the phases status table with the known phases and their status.
5. Explain the loop back to the user — scope (from the PRD) -> work the checklist -> **close + reconcile
   against the PRD** -> re-evaluate + scope the next phase — and confirm the first phase doc's task list is
   concrete and actionable.
6. Do **not** commit or merge. Follow the target repo's own convention (branch + PR, or direct-to-main for a
   solo repo) and let the user drive the commit and the merge.

The generated docs are self-contained and travel with the repo even in a session without this toolkit. Full
convention: `packages/specs/blueprints/project-docs/README.md`. Reference implementation: the `embers`
project's `docs/`.
