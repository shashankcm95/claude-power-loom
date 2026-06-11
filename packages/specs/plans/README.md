# packages/specs/plans/

Implementation + per-wave phase plans. **Living documents** — updated in place across a
phase's lifecycle, NOT immutable. (Contrast `../adrs/` and `../rfcs/`, which ARE canonical:
superseded via a new doc, never rewritten.) The root `CLAUDE.md` indexes this distinction
and `.coderabbit.yaml` encodes it for review, because conflating the two recurs as a
false-positive "you edited an immutable path" finding.

## Living, not immutable

A plan is **updated in place** as work proceeds — editing it after creation is the
workflow, not a violation. It accretes sections as each wave/phase completes:

- `## Runtime Probes` — firsthand current-state grounding (claims verified against the live
  repo, not prose/memory) BEFORE the build.
- `## Pre-Approval Verification` — the `/verify-plan` architect + code-reviewer FLAGs, folded
  before building.
- `## VALIDATE result` — the post-build multi-lens (code-reviewer / hacker / honesty) findings
  and the folds applied.
- `## Phase-close sign-off` — the `/phase-close` record at a phase boundary.

Do NOT move a plan's wave record into `docs/{ARCHITECTURE,ROADMAP}.md` — those carry *live
project status*; the plan is the canonical home for its own lifecycle.

## Where plans come from

- `/plan` — single-architect planner delegate; trivial-to-medium scope.
- `/build-plan` — HETS-aware; runs `route-decide.js` first and recommends an architect spawn
  when `convergence_value >= 0.10`; writes plans conforming to the canonical template.

Canonical schema + section reference: [`../research/plan-template.md`](../research/plan-template.md).
Schema conformance is advisory — the plan-schema validator hook emits `[PLAN-SCHEMA-DRIFT]`
when a Tier-1 (`## Context` + one of `## Files To Modify` / `## Phases` + `## Verification
Probes`) or Tier-2 (`## Routing Decision` + `## HETS Spawn Plan`, for `/build-plan` output)
section is missing.

## Filename convention

```text
YYYY-MM-DD-<phase-or-slug>.md
```

Examples: `2026-06-10-v3.7-delta-promote.md`, `2026-06-10-combined-roadmap.md`.

## Frontmatter (current convention)

```yaml
---
title: "v3.7 — the absorb/reject ledger + delta-promote activation"
plan_id: v3.7-delta-promote
created: YYYY-MM-DD
status: DRAFT | RE-SCOPED | IN-PROGRESS | COMPLETE | SUPERSEDED
scope: <one-line scope>
related:
  - packages/specs/plans/<charter>.md      # cross-linked plans / RFCs / ADRs
lifecycle: persistent                       # or ephemeral / archive-after: YYYY-MM-DD (workspace-hygiene)
---
```

## Content discipline

- **Plans are guides, not laws.** When the build reveals a mismatch with the plan, STOP and
  report — do not silently work around it. A plan's prose about an existing module's contract
  is a *premise to re-probe* against the live source, not a fact.
- **Critique belongs at the plan phase.** `/verify-plan` spawns architect + code-reviewer (plus
  adversarial / honesty lenses for kernel / security / data-mutation work) before approval;
  their FLAGs land in `## Pre-Approval Verification`.
- **Archive on phase close.** A completed-phase plan moves to `_archive/` per the
  workspace-hygiene convention once it goes stale.
