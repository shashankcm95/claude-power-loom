# /build-team — Spawn a HETS team for a build task

User-facing entry point for the [tech-stack-analyzer](../skills/tech-stack-analyzer/SKILL.md) skill. Translates a high-level task description into a concrete spawn plan with user redirect gates before execution.

## Arguments

`$ARGUMENTS` — the task description in natural language.

Examples:
- `/build-team Build me a marketing site with a blog`
- `/build-team Add an iOS companion app to my existing web product`
- `/build-team Refactor the Spring Boot service to use structured concurrency`
- `/build-team Audit the auth flow before we ship the new payments feature`

If `$ARGUMENTS` is empty, ask one clarifying question (intent + domain) and stop.

## Steps

### 0. Route-decision gate (H.7.3 + H.7.5 context-aware)

Before invoking tech-stack-analyzer (which is itself ~3K tokens for the analysis pass + spawns the team's identities), check whether this task warrants HETS routing at all. Many user prompts are better answered by root directly — over-routing burns ~30× tokens for ~3× failure-mode coverage on tasks that don't have ambiguous tradeoffs.

If `$ARGUMENTS` contains the literal flag `--force-route`, skip Step 0 entirely and proceed to Step 1.

**H.7.5 — context-aware**: when invoking on a conversation continuation (the user is mid-thread, e.g., approving a recommendation from the prior turn), ALWAYS pass `--context "<last assistant excerpt>"`. The bare task often strips the routing signal that lived in the prior recommendation — context restores it. Bound to last 1-3 turns; cap at ~8K chars. The chat agent reading this command extracts the prior assistant excerpt itself (it's in Claude's context window already; no transcript Read needed at this layer).

```bash
# H.7.3 + H.7.5 — Route-decision gate. Pure-function score on 7 weighted dimensions
# plus optional --context for conversation-continuation routing signal.
# Defaults to "route" (fail-open) if the script is missing.

ROUTE_DECIDE_SCRIPT="$HOME/Documents/claude-toolkit/scripts/agent-team/route-decide.js"

# H.7.5 — context excerpt from prior assistant turn (root extracts before invoking).
# Empty string when there's no prior turn (first-turn invocation) or when the
# task itself carries the full routing signal.
PRIOR_TURN_EXCERPT="${PRIOR_TURN_EXCERPT:-}"

if [ ! -f "$ROUTE_DECIDE_SCRIPT" ]; then
  echo "WARNING: route-decide.js not present at $ROUTE_DECIDE_SCRIPT; defaulting to route (fail-open to pre-H.7.3 behavior)"
  ROUTE_DECISION="route"
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
fi

# H.7.5 — handle ROUTE-DECISION-UNCERTAIN forcing instruction BEFORE the case dispatch.
# Triggered when score≤0.05 AND no --context was supplied AND wordCount≥4.
# Don't silently default to root — re-invoke with context, or surface to user.
if [ "$ROUTE_UNCERTAIN" = "true" ]; then
  echo ""
  echo "Route-decision: UNCERTAIN (score=$ROUTE_SCORE; no context provided; bare prompt has near-zero keyword signal)"
  echo "Reasoning: $ROUTE_REASONING"
  echo ""
  echo "The keyword heuristic abstained on this task. Before defaulting to root, consider:"
  echo "  - Does the prior assistant turn mention a concrete plan/recommendation?"
  echo "  - Is this prompt a follow-up that strips routing context (e.g., 'go on', 'do that')?"
  echo "  - Re-invoke with PRIOR_TURN_EXCERPT set to the last assistant excerpt"
  echo "  - Or use --force-route / --force-root for explicit override"
  exit 0  # model waits for user disambiguation, not literal shell exit
fi

case "$ROUTE_DECISION" in
  route)
    # Continue to Step 1 (tech-stack-analyzer). No user gate here — the existing
    # Step 5 USER GATE 1 is where the team plan gets reviewed.
    echo "Route-decision: route (score=$ROUTE_SCORE) — proceeding to tech-stack-analyzer"
    ;;

  borderline)
    # Surface decomposition to user; let them pick. The borderline band is exactly
    # the cost-benefit-ambiguous case — root has no information advantage here.
    echo ""
    echo "Route-decision: BORDERLINE (score=$ROUTE_SCORE)"
    echo "Reasoning: $ROUTE_REASONING"
    echo ""
    echo "This task is in the borderline band — HETS routing is cost-justified about"
    echo "half the time. Pick one:"
    echo "  [1] Route through HETS (full team spawn, ~30K-100K tokens)"
    echo "  [2] Hand back to root (~3K tokens, no convergence signal)"
    echo "  [3] Cancel"
    # Implementer note: shell-driven prompts in /build-team are model-followed,
    # not literally interactive. The chat agent reading this command emits the
    # decomposition + the three-option menu and waits for the user's reply.
    exit 0  # actual flow is the model waiting for user reply, not a literal shell exit
    ;;

  root)
    # Hand back to root with skip-orchestration message. No team spawn.
    echo ""
    echo "Route-decision: ROOT (score=$ROUTE_SCORE)"
    echo "Reasoning: $ROUTE_REASONING"
    echo ""
    echo "This task does not benefit from HETS routing. Root will handle it directly."
    echo "If you disagree (e.g., the task has hidden complexity not captured by keywords),"
    echo "re-invoke /build-team with --force-route or describe the constraints more explicitly."
    exit 0
    ;;
esac
```

The chat agent (Claude reading `/build-team`) follows this flow on every invocation. The route-decision is a pre-flight check that runs BEFORE Step 1 (tech-stack-analyzer). If `--force-route` is passed by the user as an explicit override, skip this Step 0 entirely and proceed to Step 1. If the gate emits `UNCERTAIN` (H.7.5 forcing instruction fired), do NOT silently default to root — re-invoke with prior-turn context or surface to user for explicit disambiguation.

### 1. Pre-flight check
Verify the HETS substrate is ready:

```bash
node ~/Documents/claude-toolkit/scripts/agent-team/kb-resolver.js cat hets/stack-skill-map | head -3
node ~/Documents/claude-toolkit/scripts/agent-team/kb-resolver.js scan
node ~/Documents/claude-toolkit/scripts/agent-team/agent-identity.js list | head -3
```

If any of these fail, surface the issue and STOP. Don't try to build a team on broken substrate.

### 2. Invoke the tech-stack-analyzer skill
Follow the 7-step workflow in `skills/tech-stack-analyzer/SKILL.md`:
- Step 1: Parse user intent (extract `intent` + `domain` + `constraints`)
- Step 2: Look up matching stack from `kb:hets/stack-skill-map`
- Step 3: Build the plan (stack + skills + personas + team-size estimate)
- Step 4: Cross-check skill availability (mark each as available / marketplace / missing)
- Step 5: **USER GATE 1** — present plan, wait for approve / adjust / cancel
- Step 6: **USER GATE 2** (if missing skills) — bootstrap-via-forge approval
- Step 7: Spawn each identity with tier-appropriate verification

  For each identity in the planned team:

  ```bash
  # 1. Get verification recommendation
  REC=$(node ~/Documents/claude-toolkit/scripts/agent-team/agent-identity.js \
    recommend-verification --identity "$IDENTITY")
  VERIFICATION=$(echo "$REC" | jq -r '.verification')
  CHALLENGER_COUNT=$(echo "$REC" | jq -r '.challengerCount')
  TIER=$(echo "$REC" | jq -r '.tier')

  # 2. Spawn implementer (always, regardless of tier)
  spawn_implementer "$IDENTITY" "$TASK"   # follows kb:hets/spawn-conventions

  # H.5.7 — task-type heuristic for contract selection.
  # Honors --task-type explicit override if root provides ($TASK_TYPE_OVERRIDE);
  # otherwise heuristic-by-verbs. Audit-precedence by design: mixed-mode tasks
  # ("audit and fix the OAuth flow") default to audit unless override forces
  # engineering. Engineering is the fallback default — its 1+1 thresholds make it
  # permissive, so a misclassified-as-engineering audit task still passes (no
  # regression). A misclassified-as-audit engineering task fails the audit
  # contract on minFindings/citations padding — which IS the H.5.7 problem this
  # heuristic exists to solve.
  TASK_TYPE_OVERRIDE=""  # Root sets to "audit" or "engineering" if explicit; else heuristic fires.

  if [ -n "$TASK_TYPE_OVERRIDE" ]; then
    TASK_TYPE="$TASK_TYPE_OVERRIDE"
  elif echo "$TASK_DESCRIPTION" | grep -iE "audit|review|assess|analyze|investigate|check|verify|inspect|examine|find vulnerabilities" > /dev/null; then
    TASK_TYPE="audit"
  else
    TASK_TYPE="engineering"  # fallback default — permissive contract has no regression risk
  fi

  if [ "$TASK_TYPE" = "audit" ]; then
    IMPL_CONTRACT="swarm/personas-contracts/${PERSONA}.contract.json"  # use persona's audit-shaped contract
  else
    IMPL_CONTRACT="swarm/personas-contracts/engineering-task.contract.json"  # H.5.7 generic engineering contract
  fi

  echo "H.5.7 selected: TASK_TYPE=$TASK_TYPE, CONTRACT=$IMPL_CONTRACT"

  # 3. Branch on verification policy.
  #    SKIP_CHECKS is read ONLY in the high-trust branch (H-2 of the H.7.1 design):
  #    medium/low must run full verification.
  case "$VERIFICATION" in
    spot-check-only)
      # high-trust — verify with skipped expensive checks (only branch that
      # consumes recommend-verification.skipChecks; do NOT forward this flag
      # in the medium/low branches).
      SKIP_CHECKS=$(echo "$REC" | jq -r '.skipChecks | join(",")')
      node ~/Documents/claude-toolkit/scripts/agent-team/contract-verifier.js \
        --contract "$IMPL_CONTRACT" \
        --output "$IMPL_OUTPUT" \
        --identity "$IDENTITY" \
        --skip-checks "$SKIP_CHECKS"
      ;;

    asymmetric-challenger)
      # medium-trust — verify implementer first (full checks; SKIP_CHECKS empty)
      node ~/Documents/claude-toolkit/scripts/agent-team/contract-verifier.js \
        --contract "$IMPL_CONTRACT" --output "$IMPL_OUTPUT" --identity "$IDENTITY"

      # then spawn 1 challenger (different persona preferred)
      CHALLENGER=$(node ~/Documents/claude-toolkit/scripts/agent-team/agent-identity.js \
        assign-challenger \
          --exclude-persona "${IDENTITY%%.*}" \
          --exclude-identity "$IDENTITY" \
          --task "challenge-${IDENTITY}" | jq -r '.challenger.identity')
      spawn_challenger "$CHALLENGER" "$IMPL_OUTPUT"   # follows kb:hets/challenger-conventions

      # record paired result with convergence signal
      node ~/Documents/claude-toolkit/scripts/agent-team/pattern-recorder.js record \
        --task-signature "${IDENTITY%%.*}:actor-${IDENTITY%%.*}" \
        --persona "${IDENTITY%%.*}" \
        --identity "$IDENTITY" \
        --verdict "$VERDICT" \
        --paired-with "$CHALLENGER" \
        --convergence "$CONVERGENCE"   # agree|disagree|n/a from challenger output analysis
      ;;

    symmetric-pair)
      # low-trust or unproven — full verification + 2 challengers
      node ~/Documents/claude-toolkit/scripts/agent-team/contract-verifier.js \
        --contract "$IMPL_CONTRACT" --output "$IMPL_OUTPUT" --identity "$IDENTITY"

      # use the new assign-pair subcommand (cleaner than two assign-challenger calls)
      PAIR=$(node ~/Documents/claude-toolkit/scripts/agent-team/agent-identity.js \
        assign-pair \
          --persona "${IDENTITY%%.*}" \
          --count "$CHALLENGER_COUNT" \
          --task "challenge-${IDENTITY}")
      CH1=$(echo "$PAIR" | jq -r '.pair[0]')
      CH2=$(echo "$PAIR" | jq -r '.pair[1]')

      spawn_challenger "$CH1" "$IMPL_OUTPUT"
      spawn_challenger "$CH2" "$IMPL_OUTPUT"

      # record paired with convergence (compare CH1+CH2 outputs)
      node ~/Documents/claude-toolkit/scripts/agent-team/pattern-recorder.js record \
        --task-signature "${IDENTITY%%.*}:actor-${IDENTITY%%.*}" \
        --persona "${IDENTITY%%.*}" \
        --identity "$IDENTITY" \
        --verdict "$VERDICT" \
        --paired-with "${CH1},${CH2}" \
        --convergence "$CONVERGENCE"
      ;;
  esac
  ```

  After all identities have completed Step 7's branch, surface the `convergence_agree_pct` aggregate via:

  ```bash
  node ~/Documents/claude-toolkit/scripts/agent-team/agent-identity.js stats --identity "$IDENTITY" | jq '.aggregate_quality_factors'
  ```

  The chat agent (Claude reading `/build-team`) follows this flow per identity. The `spawn_implementer` and `spawn_challenger` placeholders are conventions documented in `kb:hets/spawn-conventions` and `kb:hets/challenger-conventions`.

### 3. Show user the consolidated artifact

After all spawned actors complete + verification + (per policy) challenger pairs:
- Each persona's `node-actor-{persona}-{identity}.md` in `swarm/run-state/<run-id>/`
- Optional: super-agent synthesis at `node-super-root.md` if team-size ≥3

### 4. Handle capability requests from sub-agents (H.6.5)

After every spawned actor completes, scan its return value for a `request:` block in the `## Notes` section. Sub-agents follow the **missing-capability-signal** convention (see `patterns/missing-capability-signal.md`): they do NOT write substrate files themselves; they emit structured requests for root (you, the orchestrator) to act on.

For each request, surface to the user with the concrete file list, then act per the user's decision:

| Request type | Root acquires by | User-gate question |
|--------------|---------------------|----------------------|
| `forge-skill` | Invoke `/forge` skill (existing flow) | "Author skill X via /forge?" |
| `forge-persona` | Direct authoring via Edit/Write — 4 files (persona.md, contract.json, 2 KB docs) + 3 config edits (DEFAULT_ROSTERS in agent-identity.js, live `agent-identities.json`, stack-skill-map) | "Author new persona X with these 4 files + 3 config edits?" |
| `author-kb-doc` | Direct Write of the KB doc + `kb-resolver scan` to register | "Author KB doc kb:X/Y at path Z?" |
| `extend-stack-map` | Edit `kb:hets/stack-skill-map` to add the new stack entry | "Extend stack-skill-map with entry for stack X?" |

Skip a request if the user rejects, but record the rejection in the run notes. **Never silently ignore a request** — that's how capability gaps perpetuate across runs.

### 5. Don't auto-commit

Same convention as `/chaos-test`: this command produces *artifacts* the user can review and act on. It does NOT auto-commit code, push branches, or merge PRs. Spawned personas may write code (e.g., 09-react-frontend implementing a component) but the user explicitly reviews + commits.

Capability requests acquired in step 4 ARE allowed to land as committed file additions on a feature branch (substrate extensions persist; not auto-committed but the user is expected to commit them once the run finishes since they're tracked as toolkit growth).

## What this command is NOT

- Not for one-off questions ("how do I write a regex for X?") — use plain Claude
- Not for chaos-testing the toolkit itself — use `/chaos-test`
- Not a substitute for explicit project planning when stakes are high — use `/plan` first if you want a written plan before spawning the team
- Not a substitute for direct root response on trivial / single-file / non-architectural tasks — Step 0's route-decision gate handles this case automatically; the gate's output may recommend root-direct, in which case the user should accept the gate's recommendation rather than forcing a team spawn (use `--force-route` only when the user knows the task has hidden complexity not captured by keywords)

## Why a separate command vs always-on heuristic

Same rationale as the prompt-enrichment gate: explicit user invocation makes the trust boundary clear. The user knows they're spawning a team (cost, latency, multiple personas). The skill's two user-gates inside the workflow handle the "did I pick the right stack" question.

## Phase status

`/build-team` is the H.2.5 entry point. As of H.2.5, the skill scaffold + KB + pattern are implemented. The actual `/forge` integration for skill-bootstrapping uses the existing `/forge` command — which authors locally but does NOT yet do internet research. Internet-research gating is documented in [patterns/skill-bootstrapping.md](../skills/agent-team/patterns/skill-bootstrapping.md) and remains a follow-up. For now, missing skills surface to the user; if the user picks "proceed without specialization", the spawn proceeds with promise-mode references intact.
