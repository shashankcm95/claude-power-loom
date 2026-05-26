---
pattern: tech-stack-analyzer
status: active
intent: Parse user task → infer stack → identify required skills → produce a plan the user can redirect.
related: [skill-bootstrapping, persona-skills-mapping, shared-knowledge-base, missing-capability-signal, route-decision]
---

## Summary

At orchestrator entry, read the user's task description. If user specified the stack (*"build a Next.js + Tailwind site"*), use it. Otherwise propose one with rationale (*"for a marketing site, suggest Next.js + Tailwind because static-export friendly, low ops overhead, good a11y story"*). Output: structured `{stack, requiredSkills, missingSkills, suggestedPersonas}`. Always pauses for user redirect before spawning the team.

## Intent

The gap between *"build me a website"* and *"spawn the right team"* is the analyzer's job. Without it, the orchestrator either picks a default stack the user didn't want, or asks 20 clarifying questions. With it: one structured plan, one user-redirect cycle, then execution.

## Components

- **Task parser**: extract intent (build / refactor / debug / audit), domain (web / mobile / data / infra), constraints (deadline / scale / compliance) from the user's prose
- **Stack inferencer**: if user-specified, use directly; otherwise propose from a small heuristic table (*"marketing site → Next.js + Tailwind"*, *"realtime dashboard → React + WebSockets + Redis"*, *"ML training pipeline → PyTorch + WandB + DVC"*)
- **Skill mapper**: stack → required skill names. Stored as `kb:hets/stack-skill-map.md` so it's queryable + editable.
- **Catalog cross-check**: query `kb-resolver list --tag <stack>`; mark each required skill as `available` or `missing`
- **Persona selector**: pick personas whose `skills.required` overlaps the required skills (e.g., `06-ios-developer` if iOS work is needed)
- **Output**: structured plan with stack, skills, personas, and explicit "missing — need to bootstrap?" markers
- **User redirect gate**: NEVER spawn the team until user confirms the plan

## Failure Modes

1. **Wrong stack inference** — user wants Vue, analyzer suggests React. Cascades into wrong skill picks. Counter: ALWAYS show the proposed stack with rationale before mapping skills; user redirect at this step alone catches most issues.
2. **Over-specification** — analyzer demands user clarify every minor detail. Counter: heuristic defaults for non-load-bearing choices (CSS framework, package manager); user can override but doesn't have to.
3. **Persona over-staffing** — analyzer picks 7 personas for a 2-developer task. Counter: cap based on task complexity score; cap is configurable.
4. **Stale stack-skill map** — `kb:hets/stack-skill-map.md` references skills no longer in the catalog. Counter: `kb-resolver scan` validates references; broken links flagged.

## Validation Strategy

Stress-test scenarios:
- Plant a deliberately-vague task (*"build the thing"*); verify analyzer asks specific clarifying questions, not generic ones
- Plant a task with explicit stack (*"build a Spring Boot service"*); verify analyzer doesn't second-guess
- Task references a stack with 3 missing skills; verify ALL 3 surface in one bootstrap prompt (not sequential)
- User redirects from Next.js to Remix at the plan-review gate; verify the entire skill list re-derives from the new stack
- Task is in a domain with no persona match; verify graceful "no specialist available — proceed with generic actor or cancel?" prompt

## When to Use

- All orchestrator entry points where the task isn't pre-specified (chaos-test runs are pre-specified; "build me X" is not)
- Periodic catalog audits: "given the tasks we've handled in the last quarter, what skills do we keep needing but don't have?"

## When Not to Use

- Highly templated workflows where stack + skills are fixed (chaos-test, release-pipeline runs)
- Tasks where the user explicitly says *"don't analyze, just spawn the standard team"*

## Related Patterns

- [Skill Bootstrapping](skill-bootstrapping.md) — what runs when missing skills are detected
- [Persona-Skills Mapping](persona-skills-mapping.md) — the data the persona-selector reads
- [Shared Knowledge Base](shared-knowledge-base.md) — where the stack-skill-map lives
