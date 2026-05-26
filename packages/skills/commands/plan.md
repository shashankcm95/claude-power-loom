# Plan

Create a phased implementation plan for a feature or refactor.

## When to use `/plan` vs `/build-plan` (H.7.9)

- Use `/plan` for trivial-to-medium scope, single-architect planning. This command is a thin delegate to the **planner** agent.
- Use [`/build-plan`](build-plan.md) for substantive multi-file architectural work where `convergence_value ≥ 0.10`. It wraps the planner with a route-decide gate (Step 0) plus an architect-spawn recommendation (Step 3), writes plans matching `swarm/plan-template.md` schema, and captures drift notes.
- Both coexist; `/build-plan` Step 0 redirects to `/plan` cleanly when route-decide returns `root`.

## Steps

1. Check `.claude/plans/` for existing plans — avoid duplicating work
2. Gather the user's feature request or refactoring goal
3. Scan the codebase for relevant files, patterns, and conventions
4. Delegate to the **planner** agent
5. Output a phased implementation plan with file paths, dependencies, risks, and testing strategy
6. Save the plan to `.claude/plans/` for future reference

If the planner detects ≥2 files modified + non-obvious tradeoffs, surface a one-line nudge: *"consider re-running with `/build-plan` for HETS-aware planning"*. Soft suggestion, not enforcement.
