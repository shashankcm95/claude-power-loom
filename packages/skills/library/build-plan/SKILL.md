---
name: build-plan
description: HETS-aware planning for multi-file substantive work. Wraps the planner agent with route-decide gating (Step 0) and architect-spawn recommendation (Step 3) when convergence_value ≥ 0.10. Invoke via /build-plan or implicitly when plan mode is entered for substantive multi-file work. Additive to /plan — does not replace it.
trigger_keywords:
  - plan
  - design
  - architect
  - multi-file
  - refactor
  - feature
  - phased
  - architectural
when_to_use:
  - Multi-file features (≥2 files modified or created)
  - Architectural decisions with non-obvious tradeoffs
  - Refactors crossing module boundaries
  - Tasks where route-decide returns route or borderline
  - Substantive work where convergence_value is high (architect-pair earns cost)
when_NOT_to_use:
  - Single-file changes (use /plan)
  - Doc-only edits
  - Trivial bugfixes with known shape
  - Confirmation responses ("yes ship it")
  - Tasks already in execution (post plan-mode)
phase: H.7.9
---

# build-plan — HETS-aware plan authoring

## Why this skill exists

Phases H.7.5/7.6/7.7/7.8 demonstrated a recurring drift: root-direct skipped plan-mode + route-decide gate + HETS architect spawn for multi-file substantive work, even when those gates would have caught real defects. Mira's H.7.7+H.7.8 retrospective surfaced 3 CRITICAL + 2 HIGH bugs traceable to this drift. The discipline existed in `rules/core/workflow.md:28-44` as a soft norm, but soft norms drift.

This skill converts the soft norm into a sharper gate by:
1. Running `route-decide.js` deterministically before any planning happens (Step 0)
2. Recommending architect spawn when `convergence_value ≥ 0.10` (Step 3)
3. Producing plans that conform to `swarm/plan-template.md` schema (Step 4)
4. Preserving user authority at the final gate (Step 5)

## Steps

### 1. Route-decide gate

Invoke `node ~/Documents/claude-toolkit/scripts/agent-team/route-decide.js --task "$TASK"` (with `--context` on continuations).

Decision matrix:
- `route` → continue silently (HETS-aware planning warranted)
- `borderline` → surface decomposition to user; let them pick `/build-plan` vs `/plan` vs cancel
- `root` → recommend `/plan` instead; do not proceed (escape: `--force-plan`)
- `[ROUTE-DECISION-UNCERTAIN]` → re-invoke with `--context` or surface for explicit user choice

### 2. Phase 1 — Reconnaissance (Explore agents)

Per plan-mode workflow Phase 1: launch up to 3 Explore agents in parallel. Each gets a specific search focus. Read first, plan second; the planner agent's `agents/planner.md` is explicit on this — never plan blind.

Identify:
- Files-to-touch with risk classification
- Existing patterns/primitives to reuse (don't redesign load-bearing code)
- Cross-cutting concerns spanning multiple modules

### 3. HETS architect-spawn recommendation

Read `convergence_value.contribution` from route-decide JSON. If ≥ 0.10 AND `--skip-hets` not set:

> Recommend Phase 2 architect spawn (`04-architect.<roster-pick>`) with paired asymmetric challenger from `03-code-reviewer.*` family for design review.

Spawn convention (from `kb/hets/spawn-conventions.md`):
1. `agent-identity.js assign --persona 04-architect --task plan-<RUN_ID>` → returns `{name, tier}`
2. `tree-tracker.js spawn --node 04-architect-<name> --parent <parent>`
3. Invoke architect with persona contract via Skill tool
4. Architect writes to `swarm/run-state/<RUN_ID>/node-actor-04-architect-<name>.md`
5. `contract-verifier.js --identity 04-architect.<name>` → records to `~/.claude/agent-patterns.json`
6. Pair via `pattern-recorder.js --paired-with <reviewer.name> --convergence <agree|disagree|n/a>`

Recommendation is **NOT** auto-spawn. User decides at Step 5.

### 4. Phase 2 — Design + write plan

If user accepts architect recommendation: spawn architect; integrate their design.
If user declines (or low convergence_value): proceed with planner agent directly.

Either way, write plan to `~/.claude/plans/<name>.md` conforming to `swarm/plan-template.md`:

| Section | Content |
|---------|---------|
| Context | 2-3 sentence "why now" |
| Routing Decision | Verbatim route-decide JSON (replay-able) |
| HETS Spawn Plan | Persona table OR "N/A — single-perspective sufficient" |
| Files To Modify | Risk-classified table |
| Phases | Numbered steps + per-phase verification |
| Verification Probes | Aggregate end-to-end |
| Out of Scope | Honest deferrals |
| Drift Notes | Pattern-emergence observations during work |

### 5. Drift-note capture

During plan work, capture observations of soft-norm drift in the `Drift Notes` section:
- "Almost skipped plan mode for X because it 'felt' single-file but turned out to touch N"
- "route-decide returned 'root' but task is genuinely architectural — dictionary expansion candidate"
- "Architect's verdict diverged from initial design — convergence=disagree recordable"

Drift notes feed the auto-loop's session-end review per `rules/core/self-improvement.md`.

### 6. User gate (USER GATE 1)

Present plan + recommendations. User picks:
- **Approve** → ExitPlanMode + execute
- **Adjust** → iterate inline
- **Cancel** → discard
- **Skip-HETS** → proceed without architect spawn (overrides Step 3)

## Cross-skill linking

- [agent-team/SKILL.md](../agent-team/SKILL.md) — HETS spawn conventions when accepting architect recommendation
- [agent-team/patterns/route-decision.md](../agent-team/patterns/route-decision.md) — route-decide gate semantics
- [agent-team/patterns/plan-mode-hets-injection.md](../agent-team/patterns/plan-mode-hets-injection.md) — the underlying pattern this skill operationalizes
- [agent-team/patterns/asymmetric-challenger.md](../agent-team/patterns/asymmetric-challenger.md) — paired-architect convergence

## Invariants preserved (never break these)

- **No subprocess LLM** — pure-deterministic route-decide; no model calls
- **No auto-spawn HETS** — Step 5 user gate is always present
- **Additive to /plan** — never replace; both coexist
- **Route-decide weights byte-frozen** — H.7.9 doesn't perturb `weights_version v1.1-context-aware-2026-05-07`
- **Escape hatches available** — `--skip-hets` and `--force-plan` for explicit user override

## Phase

Shipped: H.7.9
Pattern: [plan-mode-hets-injection.md](../agent-team/patterns/plan-mode-hets-injection.md)
