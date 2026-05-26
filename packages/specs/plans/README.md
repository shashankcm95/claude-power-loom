# thoughts/shared/plans/

Implementation plans produced by the `/plan` slash command (H.8.6+). See `swarm/thoughts/README.md` for the broader RPI lifecycle.

## Filename convention

```
YYYY-MM-DD-<phase-tag>-<description>.md
```

Examples:
- `2026-05-09-H.8.7-batch-h1-h5-chaos-fixes.md`
- `2026-05-09-H.8.8-validate-kb-doc-hook.md`

## Required frontmatter

```yaml
---
date: YYYY-MM-DDThh:mm:ssTZ
planner: <persona.identity or "root">
phase_tag: H.X.Y
git_commit: <sha at plan time>
branch: <branch name>
research_artifact: <path to thoughts/shared/research/...md OR null if no research>
status: draft | approved | in-progress | complete | superseded
phases: <count of phases in this plan>
last_updated: YYYY-MM-DD
last_updated_by: <persona.identity or "root">
---
```

## Plan structure (per humanlayer canonical implement_plan.md)

Each plan has 1+ named phases. Each phase contains:
- **Description** — what this phase accomplishes
- **Files affected** — explicit list with paths
- **Success criteria** — what makes this phase "done"
- **Manual verification steps** — what humans need to test post-implementation
- **Checkboxes** — `- [ ]` for incomplete, `- [x]` for complete

The implement command updates checkboxes in-place as phases complete. This makes plans **resumable** — if a session breaks mid-implementation, the next session reads the plan, sees which phases are checked, and picks up at the first unchecked phase.

## Content discipline

- **Plans are guides, not laws** (humanlayer canonical). When implementation reveals a mismatch, STOP and report; don't silently work around the plan.
- **Each phase ends with explicit human-verification pause** — automated tests pass, then implementer notes "Phase N complete; ready for manual verification" and waits for the user before continuing to phase N+1.
- **Critique is welcome at the plan phase.** Unlike research artifacts (documentary), plans synthesize critic-persona input. The architect / code-reviewer / security-engineer all contribute critique here. If the plan emerged from `/build-plan` or pre-approval verification, the FLAGs from those reviewers belong here.

## Pre-approval verification (drift-note 40 lineage)

Per power-loom convention, plans for substantive multi-file work get **parallel pre-approval verification** before execution:
- Spawn architect + code-reviewer in parallel
- Each returns FLAG/PASS verdicts on the plan
- Apply revisions
- Then `/implement`

This was the workflow that caught H.8.4's mira+jade flags. It composes naturally with the RPI structure — pre-approval is the explicit "review the plan before implementing" gate.
