---
name: plan-mode-hets-injection
status: active
phase: H.7.9
related:
  - route-decision
  - asymmetric-challenger
  - convergence-as-signal
---

# Plan-Mode HETS Injection

## Why this pattern exists

Phases H.7.5 through H.7.8 demonstrated a recurring drift: when plan-mode discipline (`rules/core/workflow.md` "Plan Mode for Multi-File Changes") was a soft norm, root-direct skipped it for multi-file substantive work. Mira's H.7.7+H.7.8 retrospective then surfaced 3 CRITICAL + 2 HIGH bugs that those skipped gates would likely have caught.

The discipline existed in workflow.md:30 as one bullet:

> "Any task touching ≥2 distinct files → enter plan mode first"

Soft norms drift. This pattern converts the soft norm into a sharper gate by embedding it in:
- A dedicated slash command (`/build-plan`)
- A canonical plan template (`swarm/plan-template.md`)
- A reusable skill (`skills/build-plan/SKILL.md`)
- An updated workflow rule with explicit decision tree

The discipline becomes self-enforcing at invocation time — the user types `/build-plan`, route-decide runs deterministically, architect-spawn is recommended when `convergence_value` is high enough, and the plan template structure surfaces drift observations.

## When this pattern fires

1. **Direct invocation**: User types `/build-plan some task`
2. **Implicit trigger**: Plan mode is entered for a task with ≥2 files AND `convergence_value ≥ 0.10` (post-context-mult floor; same as H.7.5 borderline-promotion threshold)
3. **Drift detection**: Mid-task, architect or asymmetric-challenger notes "this should have started with `/build-plan`"

## How it works (the three layers)

### Layer 1 — Slash command gate

`/build-plan` Step 0 invokes `route-decide.js` deterministically. Decision matrix:

- `route` → continue silently (HETS-aware planning warranted)
- `borderline` → surface decomposition; let user pick
- `root` → recommend `/plan` instead (escape: `--force-plan`)
- `[ROUTE-DECISION-UNCERTAIN]` → re-invoke with `--context` or surface

### Layer 2 — Architect-spawn recommendation

`/build-plan` Step 3 reads `convergence_value.contribution` from route-decide JSON. If ≥ 0.10:

> Recommend `04-architect.<roster-pick>` (or specific persona if user names one) for Phase 2 design, with paired asymmetric challenger from `03-code-reviewer.*` family.

This is **recommendation**, not auto-spawn. The user gate at Step 5 is always preserved.

### Layer 3 — Canonical plan template

The plan that gets written to `~/.claude/plans/<name>.md` conforms to `swarm/plan-template.md`'s mandatory sections (Context / Routing Decision / HETS Spawn Plan / Files / Phases / Verification / Out of Scope / Drift Notes). The Routing Decision section preserves verbatim route-decide JSON — replay-ability for future audits.

## The recursive-dogfood property

This pattern's design itself uses the pattern. The architect (theo, persona `04-architect`) producing the H.7.9 design works under the very flow being designed. Mira (different identity, same persona family) authored the retrospective that motivated this pattern. Convergence between theo and mira will be recorded via `pattern-recorder.js --paired-with 04-architect.mira --convergence partial-disagree` (theo agrees with mira's bug findings; partial-disagrees with phase-bundling — see H.7.9 plan).

**Eating own dogfood is the test of whether the abstraction is sound.** If the pattern is unusable for its own design, it's unusable for downstream tasks.

H.7.10 is the immediate dogfood demonstration: applying mira's 5 fixes via `/build-plan`. If the flow works for an "external" user (the implementer applying fixes specified by an architect), it works.

## Failure modes to avoid

| Failure mode | Mitigation |
|---|---|
| Auto-spawn HETS without user gate | Step 5 user gate ALWAYS preserved; Step 3 is recommendation only |
| Use `/build-plan` for trivial scope | Step 0's `root` recommendation redirects cleanly to `/plan`; user-friction warning surfaced |
| Treat plan template as enforced schema without enforcement | Soft template in H.7.9; PostToolUse-on-Write enforcement hook deferred to H.7.12. Manual review at ExitPlanMode for now. |
| Architect bias bake-in | Default to recommending asymmetric challenger from different persona family; convergence recorded for trend detection |
| Plan-mode fatigue from extra gates | Step 0 silent on `route` recommendation (no user prompt); only `borderline`/`root` surface to user |
| Drift-notes section ignored | Auto-loop's session-end review surfaces drift-note candidates as self-improve queue items |

## Relationship to other patterns

- **`route-decision`** — provides the deterministic substrate Step 0 invokes
- **`asymmetric-challenger`** — Step 3's paired-architect recommendation builds on this
- **`convergence-as-signal`** — `convergence_value` axis (weight 0.15 in route-decide v1.1) is what makes architect-pair earn its cost
- **`agent-identity-reputation`** — round-robin persona assignment + tier transparency feed Step 3's recommendation

## Invariants preserved

- **No subprocess LLM** — pure-deterministic route-decide
- **No auto-spawn HETS** — user gate always present
- **Additive to /plan** — `/plan` stays as thin planner-agent delegate; both coexist
- **Route-decide weights byte-frozen** — pattern doesn't perturb `weights_version v1.1-context-aware-2026-05-07`
- **Escape hatches** — `--skip-hets` and `--force-plan` for explicit override

## Open questions / future evolution

1. **Plan-schema enforcement** — H.7.12 PostToolUse-on-Write hook would convert template from soft norm to hard requirement. Unclear if needed; user feedback on H.7.10's recursive-dogfood will inform.
2. **Plan-correlation in spawn-recorder** — pattern history is append-only; no field for "which plan section triggered this spawn?" Future schema addition could enable plan→outcome correlation analysis.
3. **Auto-suggestion in `/plan`** — when planner detects "this should have used `/build-plan`", emit nudge in plan output. Soft. Deferred until H.7.10 dogfood data exists.

## References

- [skills/build-plan/SKILL.md](../../build-plan/SKILL.md) — the skill operationalizing this pattern
- [commands/build-plan.md](../../../commands/build-plan.md) — the slash command
- [swarm/plan-template.md](../../../swarm/plan-template.md) — canonical plan structure
- [scripts/agent-team/route-decide.js](../../../scripts/agent-team/route-decide.js) — deterministic gate
- [rules/core/workflow.md](../../../rules/core/workflow.md) — workflow discipline
- [agents/planner.md](../../../agents/planner.md) — base planner agent that `/build-plan` wraps

## Phase

Shipped: H.7.9
