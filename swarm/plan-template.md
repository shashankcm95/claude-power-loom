# Plan Template (canonical, H.7.9)

This is the canonical plan template that `/build-plan` produces. Plans written manually or by the planner agent should also conform to this schema for replay-ability and drift-detection. Self-documenting: every section includes a placeholder example showing what "good" looks like.

**Status**: soft norm in H.7.9. PostToolUse-on-Write enforcement hook deferred to H.7.12. Until then, schema conformance is reviewed manually at ExitPlanMode.

**Why this template exists**: phases H.7.5/7.6/7.7/7.8 demonstrated drift in plan-mode discipline. Plans without standardized sections were missing routing decisions, HETS rationale, drift observations — the very signals that would surface architectural risk. This template makes the discipline self-documenting.

---

## Mandatory sections

### Context

2-3 sentence summary of the "why now": the problem or need this change addresses, what prompted it, the intended outcome.

> Example: *Phase H.7.7+H.7.8 shipped substrate primitives + plugin-dev tooling but missed 3 CRITICAL + 2 HIGH bugs caught by mira's retrospective. The bugs are load-bearing on substrate quality (race conditions, session leaks, save-prompt integration). This phase ships fixes via the new `/build-plan` flow as recursive dogfood.*

### Routing Decision

Verbatim `route-decide.js` JSON output. NOT paraphrased or rewritten — the JSON enables future audit replay.

> Example:
> ```json
> {
>   "task": "Apply mira's H.7.7+H.7.8 retrospective fixes",
>   "recommendation": "route",
>   "confidence": 0.72,
>   "score_total": 0.68,
>   "scores_by_dim": {
>     "stakes": { "raw": 1, "weight": 0.25, "contribution": 0.25 },
>     "audit_binary": { "raw": 1, "weight": 0.20, "contribution": 0.20 },
>     "convergence_value": { "raw": 1, "weight": 0.15, "contribution": 0.15 },
>     "scope_size": { "raw": 1, "weight": 0.075, "contribution": 0.075 }
>   },
>   "reasoning": "Score 0.68 → route: stakes (CRITICAL), audit_binary (retrospective), convergence_value (substantive tradeoffs), scope_size (multi-file).",
>   "weights_version": "v1.1-context-aware-2026-05-07"
> }
> ```

### HETS Spawn Plan

Required if `convergence_value ≥ 0.10` (post-context-mult). Otherwise: explicit "N/A — single-perspective sufficient".

> Example:
> | Persona | Identity | Role | Paired-with | Why |
> |---|---|---|---|---|
> | 04-architect | theo | design | (asymmetric: 03-code-reviewer.nova) | non-obvious tradeoffs in TMPDIR scoping vs session-reset coupling |
> | 03-code-reviewer | nova | post-implementation review | architect.theo | asymmetric-challenger pattern; verifies fixes don't regress |

### Files To Modify

Risk-classified table. Flag load-bearing files explicitly.

> Example:
> | Path | Action | Risk | Notes |
> |---|---|---|---|
> | `hooks/scripts/error-critic.js` | modify | medium | C-1 + C-2 fixes; touches RMW + TMPDIR scoping |
> | `hooks/scripts/pre-compact-save.js` | modify | medium | C-3 + H-1 + H-2 fixes; touches user-facing prompt |
> | `install.sh` | modify | low | Test 13 addition |

### Phases

Per-phase steps with explicit verification probes.

> Example:
> #### Phase 1: Foundation (Files: 4 NEW, Risk: Low)
> 1. **Create `commands/build-plan.md`** (~150 LoC)
>    - Action: Write dual-gate slash command modeled on `/build-team`
>    - Verification probe: `ls commands/build-plan.md` returns 0
>    - Risk: Low (additive)
> 2. **Create `skills/build-plan/SKILL.md`** (~120 LoC)
>    - Action: Frontmatter + 6 numbered steps + cross-skill linking
>    - Verification probe: Frontmatter validator passes; cross-links resolve
>    - Risk: Low (additive)

### Verification Probes

Aggregate of all phase probes plus end-to-end checks.

> Example:
> | Probe | Pass criterion |
> |---|---|
> | 1 | `bash install.sh --test` → 13/13 passing |
> | 2 | `node scripts/agent-team/contracts-validate.js` → 0 violations |
> | 3 | route-decide regression: `--task "build a CRUD endpoint with auth"` → recommendation = route |
> | 4 | Plan file matches this template's mandatory sections |

### Out of Scope (Deferred)

Honest scope discipline — what we explicitly chose NOT to do, with rationale.

> Example:
> - Plan-template enforcement hook (deferred to H.7.12)
> - Auto-spawn HETS (preserves user gate)
> - route-decide dictionary expansion (deferred to H.7.13)

### Drift Notes

Pattern-emergence observations captured during plan work. Per user H.7.9 meta-directive: "our conversations and tasks are the biggest testing frameworks for the plugin. So, wherever we can we need to use the framework. If at times you find yourself drifting [...] make a note and we can see if some pattern emerges."

> Example:
> - **Drift-note 1**: route-decide.js v1.1 dictionary missed `retrospective`/`CRITICAL`/`audit` signal tokens — heuristic returned `root` confidence=0.25 when human/architect would say `route`. H.7.13 candidate.
> - **Drift-note 2**: Theo recommended splitting H.7.9 from H.7.10 — split honored. Future: phases mixing foundation + recursive-dogfood default to split.
> - **Drift-note 3 (captured at ExitPlanMode)**: User caught BACKLOG-listed H.7.10 (agent-discipline pass) being inadvertently shadowed by this plan's H.7.10 (mira fixes). Pattern: when proposing a phase number, scan existing BACKLOG for prior-deferred-into-that-slot items first.

---

## Optional sections (recommend, don't require)

### Why this is the right shape

Why this phase shape vs alternatives. Useful for retrospective audits.

### What this DOESN'T claim to fix

Honest limitations — what stays broken even after this ships.

### Estimated cost

Wallclock + token estimates; risk-of-overrun called out explicitly.

### References / reuse (not modifying)

Files read for context but NOT modified. Helps reviewers understand the blast radius.

---

## Schema validation (manual until H.7.12)

Until the PostToolUse-on-Write hook lands in H.7.12, schema conformance is checked at ExitPlanMode. Reviewer scans for:

- ✓ Context section present + 2-3 sentences (not paragraph-length)
- ✓ Routing Decision section contains verbatim JSON (NOT paraphrase)
- ✓ HETS Spawn Plan present (table or "N/A" with rationale)
- ✓ Files To Modify table has risk column populated
- ✓ Phases include verification probes per phase
- ✓ Drift Notes section present (may be empty for trivial phases)

If any are missing, plan is iterated before approval.

## Cross-references

- [`commands/build-plan.md`](../commands/build-plan.md) — the slash command that produces plans matching this template
- [`skills/build-plan/SKILL.md`](../skills/build-plan/SKILL.md) — the skill body
- [`skills/agent-team/patterns/plan-mode-hets-injection.md`](../skills/agent-team/patterns/plan-mode-hets-injection.md) — the underlying pattern
- [`agents/planner.md`](../agents/planner.md) — original plan template (lines 57-93); this template is an explicit superset
- [`rules/core/workflow.md`](../rules/core/workflow.md) — soft-norm rules this template makes self-documenting

## Phase

Shipped: H.7.9
