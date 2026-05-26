# /verify-plan — Pre-approval verification (H.7.23)

User-facing entry point for the [verify-plan](../skills/verify-plan/SKILL.md) skill. Spawns architect + code-reviewer agents in parallel to catch design issues + concrete bugs in proposed code changes BEFORE the user sees the plan via ExitPlanMode.

**Codifies drift-note 40**: the parallel-spawn pre-approval verification pattern that caught 4 HIGH/CRITICAL bugs in H.7.22 + 5 substantive issues in H.7.23. Required (per `rules/core/workflow.md`) for HETS-routed phases.

## Arguments

`$ARGUMENTS` — optional path to plan file. Defaults to most-recently-modified `.md` in `~/.claude/plans/`.

Examples:

- `/verify-plan` — verifies the most recent plan file
- `/verify-plan ~/.claude/plans/flickering-crafting-star.md` — explicit path
- `/verify-plan --skip-fixes` — surface findings only, don't apply fixes inline

If no plan file is found, ask the user to specify a path or invoke from inside plan mode.

## When to invoke

- After writing a plan file in plan mode, BEFORE ExitPlanMode
- The plan must be HETS-routed (contains `## HETS Spawn Plan` with substantive content OR `Routing Decision` JSON with `"recommendation": "route"`)
- Trivial / `root`-routed plans don't need this — `validate-plan-schema.js` Tier 1 conditional won't fire on them

## Steps

The skill body at `skills/verify-plan/SKILL.md` defines the 6-step procedure. Summary:

1. Read plan file
2. Spawn architect (verification-mode brief) + code-reviewer in parallel via Agent tool
3. Aggregate findings via `scripts/agent-team/verify-plan-spawn.js`
4. Surface verdict (READY / NEEDS-REVISION / BLOCKED)
5. Apply fixes inline if NEEDS-REVISION
6. ExitPlanMode

## Why this is additive (not replacing /plan or /build-plan)

- `/plan` — single-architect planner agent delegate; no verification step
- `/build-plan` — HETS-aware plan authoring with route-decide gate
- `/verify-plan` — orthogonal: runs AFTER plan is written, BEFORE ExitPlanMode. Catches issues `/plan` and `/build-plan` introduce.

The three coexist. The intended flow is `/build-plan <task>` → write plan → `/verify-plan` → fix issues → ExitPlanMode.

## Trust model

The validator (`validate-plan-schema.js` H.7.23 Tier 1 conditional) checks for `## Pre-Approval Verification` section PRESENCE only — not whether the spawn actually ran. Per H.7.23 plan's code-reviewer FAIL #4, strict spawn-verification was rejected as brittle (timestamps drift, run-IDs editable, tampering undetectable). Trust model is forcing-function-for-procedural-discipline, same as Principle Audit (H.7.22).

## Notes

- **No subprocess LLM spawning from a Node script** — Step 2 has Claude (the orchestrator) invoke the Agent tool directly. The `verify-plan-spawn.js` helper aggregates findings post-hoc, doesn't spawn.
- **Idempotent re-run** — `verify-plan-spawn.js` replaces existing `## Pre-Approval Verification` section if present, so users can re-run after applying fixes.
- **Insertion order** — section is appended before `## Open design choices` if present, else at end of plan file.

See [skills/verify-plan/SKILL.md](../skills/verify-plan/SKILL.md) for full procedure body and [skills/agent-team/patterns/plan-mode-hets-injection.md](../skills/agent-team/patterns/plan-mode-hets-injection.md) for the underlying plan-mode-injection pattern.
