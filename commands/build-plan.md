# /build-plan — HETS-aware plan authoring (H.7.9)

User-facing entry point for the [build-plan](../skills/build-plan/SKILL.md) skill. Wraps the [planner](../agents/planner.md) agent with a deterministic route-decide gate (Step 0) plus an architect-spawn recommendation (Step 3) when the task scores high on `convergence_value`. Designed to convert the soft-norm plan-mode discipline (`rules/core/workflow.md`) into a sharper gate without merging it with the route-decide gate (different concerns: file-count vs HETS-cost-justification).

**Relationship to `/plan`** — additive, not replacement. `/plan` stays as the thin planner-agent delegate for trivial-to-medium scope. `/build-plan` is for substantive multi-file architectural work where convergence value is high enough that an architect's design pass earns its token cost. Step 0's `root` recommendation redirects cleanly to `/plan`.

## Arguments

`$ARGUMENTS` — the task description in natural language.

Examples:
- `/build-plan Refactor the auth flow to use JWT instead of session cookies`
- `/build-plan Apply mira's H.7.7+H.7.8 retrospective fixes`
- `/build-plan Add multi-tenant support across the API + UI + DB layers`
- `/build-plan --force-plan Build a CRUD endpoint` (skips Step 0 gate)
- `/build-plan --skip-hets Refactor the routing module` (skips Step 3 architect recommendation)

If `$ARGUMENTS` is empty, ask one clarifying question (intent + scope) and stop.

## Steps

### 0. Route-decision gate (H.7.3 + H.7.5 context-aware)

Before invoking the planner agent or recommending architect spawn, check whether this task warrants HETS-aware planning at all. Trivial scopes are better served by `/plan` directly (~3K tokens via planner agent) instead of `/build-plan` overhead.

If `$ARGUMENTS` contains the literal flag `--force-plan`, skip Step 0 entirely and proceed to Step 1.

**H.7.5 — context-aware**: when invoking on a conversation continuation, ALWAYS pass `--context "<last assistant excerpt>"`. Bare task strips the routing signal that lived in the prior recommendation.

```bash
ROUTE_DECIDE_SCRIPT="$HOME/Documents/claude-toolkit/scripts/agent-team/route-decide.js"
PRIOR_TURN_EXCERPT="${PRIOR_TURN_EXCERPT:-}"

if [ ! -f "$ROUTE_DECIDE_SCRIPT" ]; then
  echo "WARNING: route-decide.js not present; defaulting to /plan delegate (fail-open)"
  ROUTE_DECISION="root"
else
  if [ -n "$PRIOR_TURN_EXCERPT" ]; then
    ROUTE_OUTPUT=$(node "$ROUTE_DECIDE_SCRIPT" --task "$TASK_DESCRIPTION" --context "$PRIOR_TURN_EXCERPT")
  else
    ROUTE_OUTPUT=$(node "$ROUTE_DECIDE_SCRIPT" --task "$TASK_DESCRIPTION")
  fi
  ROUTE_DECISION=$(echo "$ROUTE_OUTPUT" | jq -r '.recommendation')
  ROUTE_SCORE=$(echo "$ROUTE_OUTPUT" | jq -r '.score_total')
  ROUTE_REASONING=$(echo "$ROUTE_OUTPUT" | jq -r '.reasoning')
  ROUTE_UNCERTAIN=$(echo "$ROUTE_OUTPUT" | jq -r '.uncertain // false')
  CONVERGENCE_VALUE=$(echo "$ROUTE_OUTPUT" | jq -r '.scores_by_dim.convergence_value.contribution // 0')
fi

# H.7.5 — UNCERTAIN forcing instruction handling
if [ "$ROUTE_UNCERTAIN" = "true" ]; then
  echo ""
  echo "Route-decision: UNCERTAIN (score=$ROUTE_SCORE; no context provided)"
  echo "Reasoning: $ROUTE_REASONING"
  echo ""
  echo "Before defaulting, consider re-invoking with PRIOR_TURN_EXCERPT, or use --force-plan."
  exit 0
fi

case "$ROUTE_DECISION" in
  route)
    # Continue to Step 1. Silent on this path — mirrors /build-team UX.
    echo "Route-decision: route (score=$ROUTE_SCORE) — proceeding with HETS-aware planning"
    ;;

  borderline)
    echo ""
    echo "Route-decision: BORDERLINE (score=$ROUTE_SCORE)"
    echo "Reasoning: $ROUTE_REASONING"
    echo ""
    echo "This task is in the borderline band. Pick one:"
    echo "  [1] Continue with /build-plan (HETS-aware; architect recommendation if convergence_value ≥ 0.10)"
    echo "  [2] Fall back to /plan (planner agent only; lighter)"
    echo "  [3] Cancel"
    exit 0
    ;;

  root)
    echo ""
    echo "Route-decision: ROOT (score=$ROUTE_SCORE) — recommend /plan instead"
    echo "Reasoning: $ROUTE_REASONING"
    echo ""
    echo "/build-plan would over-shoot for this scope. Re-invoke as /plan, or"
    echo "use /build-plan --force-plan if you disagree (e.g., hidden complexity)."
    exit 0
    ;;
esac
```

The chat agent reading `/build-plan` follows this flow on every invocation. If `--force-plan` is passed, skip Step 0 entirely.

### 1. Enter plan mode (if not already)

If the orchestrator is not already in plan mode AND scope ≥ 2 files (heuristic: count file paths or "and" conjunctions in `$ARGUMENTS`), invoke EnterPlanMode. This honors `rules/core/workflow.md` "Plan Mode for Multi-File Changes" deterministically rather than as soft norm.

### 2. Phase 1 — Reconnaissance

Following the plan-mode workflow Phase 1 convention: launch up to 3 Explore agents in parallel to understand the codebase before designing. The planner agent's "Codebase Reconnaissance" step (`agents/planner.md`) is the model — read first, plan second; never plan blind.

Specifically: identify files-to-touch, existing patterns to reuse, and load-bearing primitives that the plan should not redesign.

### 3. HETS architect-spawn recommendation (the H.7.9 gate)

Compute `convergence_value` from the route-decide JSON output (see Step 0). If `convergence_value ≥ 0.10` (post-context-mult floor; same as the H.7.5 borderline-promotion threshold per `route-decide.js`), emit a recommendation that the user spawn an architect persona for Phase 2 design.

```bash
if [ "$(echo "$CONVERGENCE_VALUE >= 0.10" | bc -l)" = "1" ] && [ -z "$SKIP_HETS" ]; then
  echo ""
  echo "HETS architect-spawn recommendation (H.7.9 gate)"
  echo "  convergence_value contribution: $CONVERGENCE_VALUE"
  echo "  Rationale: this task has non-obvious tradeoffs that benefit from"
  echo "  paired architectural review (asymmetric-challenger pattern)."
  echo ""
  echo "Recommended spawn: 04-architect.<round-robin> + paired challenger 03-code-reviewer.<round-robin>"
  echo "  See: scripts/agent-team/agent-identity.js assign --persona 04-architect --task plan-<RUN_ID>"
  echo ""
  echo "This is a recommendation, NOT auto-spawn. User decides at Step 5 gate."
fi
```

If `--skip-hets` is in `$ARGUMENTS`, short-circuit Step 3 even when `convergence_value` is high (escape hatch for tasks where user knows HETS is overkill).

### 4. Phase 2 — Design + write plan to canonical template

If user accepts the architect recommendation at Step 5, spawn `04-architect.<name>` per the 5-step convention in `kb/hets/spawn-conventions.md`. The architect produces a design that lands in `swarm/run-state/<RUN_ID>/node-actor-04-architect-<NAME>.md`.

If the user declines (or convergence_value < 0.10), proceed with the planner agent directly per Phase 2 of plan-mode workflow.

The output plan file at `~/.claude/plans/<name>.md` MUST conform to `swarm/plan-template.md` schema:

- **Context** (why this change)
- **Routing Decision** (verbatim route-decide JSON)
- **HETS Spawn Plan** (personas + paired-with for convergence; or "N/A" if no architect spawn)
- **Files To Modify** (table with risk classification)
- **Phases** (per-phase steps + verification probes)
- **Verification Probes** (aggregate)
- **Out of Scope (Deferred)**
- **Drift Notes** (per H.7.9 meta-directive)

### 5. User gate (USER GATE 1)

Present plan + recommendations. User picks:
- **Approve** → exit plan mode + execute
- **Adjust** → iterate the plan inline
- **Cancel** → discard plan; no changes
- **Skip-HETS** → proceed without architect spawn (overrides Step 3 recommendation)

Preserves user authority; defaults nothing.

## Notes

- **No subprocess LLM** — Step 0 + Step 3 use deterministic `route-decide.js`; no model calls
- **No auto-spawn HETS** — recommendation only; user gate at Step 5 always preserved
- **Additive to `/plan`** — both coexist; `/plan` for trivial; `/build-plan` for substantive
- **Drift-notes section** — captures soft-norm-drift observations during plan work (per user H.7.9 directive treating conversations as testing framework)

See [skills/build-plan/SKILL.md](../skills/build-plan/SKILL.md) for the skill body and [skills/agent-team/patterns/plan-mode-hets-injection.md](../skills/agent-team/patterns/plan-mode-hets-injection.md) for the underlying pattern.
