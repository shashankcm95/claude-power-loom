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

Substrate-primitive bash invocations for Steps 0, 1.5, and 2 are wrapped by [`scripts/agent-team/build-team-helpers.sh`](../scripts/agent-team/build-team-helpers.sh) (HT.1.5 ship; third ADR-0002 application — markdown narrative + helper-script invocations post-split shape). Run `bash $HOME/Documents/claude-toolkit/scripts/agent-team/build-team-helpers.sh --help` for the 5-subcommand surface. Chat-agent actions (`spawn_implementer`, `spawn_challenger`) remain inline as Agent-tool placeholders per `kb:hets/spawn-conventions` and `kb:hets/challenger-conventions`.

## Steps

### 0. Route-decision gate (H.7.3 + H.7.5 context-aware)

Before invoking tech-stack-analyzer (which is itself ~3K tokens for the analysis pass + spawns the team's identities), check whether this task warrants HETS routing at all. Many user prompts are better answered by root directly — over-routing burns ~30× tokens for ~3× failure-mode coverage on tasks that don't have ambiguous tradeoffs.

If `$ARGUMENTS` contains the literal flag `--force-route`, skip Step 0 entirely and proceed to Step 1.

**H.7.5 — context-aware**: when invoking on a conversation continuation (the user is mid-thread, e.g., approving a recommendation from the prior turn), ALWAYS pass the prior assistant excerpt as the second arg. The bare task often strips the routing signal that lived in the prior recommendation — context restores it. Bound to last 1-3 turns; cap at ~8K chars. The chat agent reading this command extracts the prior assistant excerpt itself (it's in Claude's context window already; no transcript Read needed at this layer).

```bash
# H.7.3 + H.7.5 — Route-decision gate via build-team-helpers.sh wrapper.
# Helper handles fail-open (ROUTE_DECIDE_SCRIPT missing → defaults to route).
# PRIOR_TURN_EXCERPT empty on first-turn invocation; chat agent populates from
# Claude's context window for conversation-continuation routing signal.
PRIOR_TURN_EXCERPT="${PRIOR_TURN_EXCERPT:-}"
ROUTE_OUTPUT=$(bash $HOME/Documents/claude-toolkit/scripts/agent-team/build-team-helpers.sh \
  route-decide-gate "$TASK_DESCRIPTION" "$PRIOR_TURN_EXCERPT")
ROUTE_DECISION=$(echo "$ROUTE_OUTPUT" | jq -r '.recommendation')
ROUTE_SCORE=$(echo "$ROUTE_OUTPUT" | jq -r '.score_total')
ROUTE_REASONING=$(echo "$ROUTE_OUTPUT" | jq -r '.reasoning')
ROUTE_UNCERTAIN=$(echo "$ROUTE_OUTPUT" | jq -r '.uncertain // false')
```

Then dispatch on `$ROUTE_DECISION` (chat-agent followed; emit user-facing messages and wait for reply where applicable):

- **`route`** — proceed to Step 1 (tech-stack-analyzer). No user gate here; the existing Step 5 USER GATE 1 is where the team plan gets reviewed.
- **`borderline`** — surface the score + reasoning to the user with a 3-option menu (route / root / cancel) and wait for reply. The borderline band is the cost-benefit-ambiguous case — root has no information advantage here.
- **`root`** — hand back to root with skip-orchestration message; no team spawn. If user disagrees, they re-invoke with `--force-route` or describe constraints more explicitly.
- **`uncertain` (H.7.5 forcing instruction)** — fired when score≤0.05 AND no `--context` was supplied AND wordCount≥4. Do NOT silently default to root. Either re-invoke with `PRIOR_TURN_EXCERPT` set, or surface to user for explicit `--force-route` / `--force-root` disambiguation.

### 1. Pre-flight check
Verify the HETS substrate is ready:

```bash
node ~/Documents/claude-toolkit/scripts/agent-team/kb-resolver.js cat hets/stack-skill-map | head -3
node ~/Documents/claude-toolkit/scripts/agent-team/kb-resolver.js scan
node ~/Documents/claude-toolkit/scripts/agent-team/agent-identity.js list | head -3
```

If any of these fail, surface the issue and STOP. Don't try to build a team on broken substrate.

### 1.5. Pre-spawn context auto-extension (H.8.5 — wires H.8.3)

Before invoking tech-stack-analyzer (Step 2), build the team-wide spawn-context block via the helper's `build-spawn-context` subcommand. This composes the H.8.x trilogy primitives (architecture-relevance-detector + adr.js touched-by + kb-resolver tier-aware loading) into a structured context block that ALL spawned identities receive as a prefix to their individual persona/task instructions. Substrate-curated kb anchoring + drift-aware ADR injection becomes automatic per spawn.

```bash
# Optional --files arg if user provides specific paths in $ARGUMENTS;
# otherwise just task-shaped detection (no ADR matching this run).
SPAWN_CONTEXT=$(bash $HOME/Documents/claude-toolkit/scripts/agent-team/build-team-helpers.sh \
  build-spawn-context "$TASK_DESCRIPTION" "${TARGET_FILES:-}")

if [ -n "$SPAWN_CONTEXT" ]; then
  echo "Spawn context auto-extension: $(echo "$SPAWN_CONTEXT" | wc -l) lines of substrate-curated KB+ADR anchoring will prefix each spawn"
fi
```

`$SPAWN_CONTEXT` is then forwarded into Step 7's `spawn_implementer` and `spawn_challenger` calls as a prefix prepended to each identity's persona/task block. The chat agent (Claude reading `/build-team`) handles this prepending when emitting each spawn invocation: each identity's prompt becomes `<SPAWN_CONTEXT>\n\n<persona block>\n\n<task block>` rather than `<persona block>\n\n<task block>`.

If `$SPAWN_CONTEXT` is empty (helper errored, or no signals matched, or no ADRs touch the files), spawns proceed without the prefix — substrate degrades gracefully per fail-open discipline. Empty context is a valid output.

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
  HELPER="$HOME/Documents/claude-toolkit/scripts/agent-team/build-team-helpers.sh"

  # 1. Get verification recommendation (kept inline — pure pass-through)
  REC=$(node ~/Documents/claude-toolkit/scripts/agent-team/agent-identity.js \
    recommend-verification --identity "$IDENTITY")
  VERIFICATION=$(echo "$REC" | jq -r '.verification')
  CHALLENGER_COUNT=$(echo "$REC" | jq -r '.challengerCount')

  # 2. Spawn implementer (always, regardless of tier) — chat-agent action; not bash.
  # H.8.5: $SPAWN_CONTEXT (Step 1.5) is prepended to the spawn prompt so each
  # implementer gets substrate-curated KB anchoring + active-ADR awareness before
  # its persona/task block. Follows kb:hets/spawn-conventions extended for the prefix.
  spawn_implementer "$IDENTITY" "$TASK" "$SPAWN_CONTEXT"

  # 3. Branch on verification policy. The verify-with-contract-selection helper
  # applies H.5.7 task-type heuristic + contract selection internally; tier-aware
  # skip-checks logic also internal. TASK_TYPE_OVERRIDE optional ("audit" /
  # "engineering" / empty for heuristic).
  PERSONA="${IDENTITY%%.*}"
  TASK_TYPE_OVERRIDE=""

  case "$VERIFICATION" in
    spot-check-only)
      # high-trust — verifier consumes recommend-verification.skipChecks (only
      # this branch reads SKIP_CHECKS; H.7.1 H-2 forbids it in medium/low).
      SKIP_CHECKS=$(echo "$REC" | jq -r '.skipChecks | join(",")')
      bash "$HELPER" verify-with-contract-selection \
        "$IMPL_OUTPUT" "$IDENTITY" "$VERIFICATION" "$SKIP_CHECKS" \
        "$TASK_DESCRIPTION" "$TASK_TYPE_OVERRIDE" "$PERSONA"
      ;;

    asymmetric-challenger)
      # medium-trust — verifier full checks; spawn 1 challenger; record paired
      bash "$HELPER" verify-with-contract-selection \
        "$IMPL_OUTPUT" "$IDENTITY" "$VERIFICATION" "" \
        "$TASK_DESCRIPTION" "$TASK_TYPE_OVERRIDE" "$PERSONA"

      CHALLENGER=$(bash "$HELPER" assign-challenger-pair \
        "$PERSONA" "$IDENTITY" "1" "challenge-${IDENTITY}" \
        | jq -r '.challenger.identity')
      spawn_challenger "$CHALLENGER" "$IMPL_OUTPUT"   # follows kb:hets/challenger-conventions

      bash "$HELPER" record-verdict \
        "$IDENTITY" "$VERDICT" "$CHALLENGER" "$CONVERGENCE"
      ;;

    symmetric-pair)
      # low-trust or unproven — verifier full checks; spawn 2 challengers; record paired
      bash "$HELPER" verify-with-contract-selection \
        "$IMPL_OUTPUT" "$IDENTITY" "$VERIFICATION" "" \
        "$TASK_DESCRIPTION" "$TASK_TYPE_OVERRIDE" "$PERSONA"

      PAIR=$(bash "$HELPER" assign-challenger-pair \
        "$PERSONA" "$IDENTITY" "$CHALLENGER_COUNT" "challenge-${IDENTITY}")
      CH1=$(echo "$PAIR" | jq -r '.pair[0]')
      CH2=$(echo "$PAIR" | jq -r '.pair[1]')

      spawn_challenger "$CH1" "$IMPL_OUTPUT"
      spawn_challenger "$CH2" "$IMPL_OUTPUT"

      bash "$HELPER" record-verdict \
        "$IDENTITY" "$VERDICT" "${CH1},${CH2}" "$CONVERGENCE"
      ;;
  esac
  ```

  After all identities have completed Step 7's branch, surface the `convergence_agree_pct` aggregate via:

  ```bash
  node ~/Documents/claude-toolkit/scripts/agent-team/agent-identity.js stats --identity "$IDENTITY" | jq '.aggregate_quality_factors'
  ```

  The chat agent (Claude reading `/build-team`) follows this flow per identity. The `spawn_implementer` and `spawn_challenger` placeholders are conventions documented in `kb:hets/spawn-conventions` and `kb:hets/challenger-conventions`; they are Agent-tool invocations, NOT bash, and the helper script intentionally does not wrap them.

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

`/build-team` is the H.2.5 entry point. As of HT.1.5, the substrate-primitive bash blocks are extracted to [`scripts/agent-team/build-team-helpers.sh`](../scripts/agent-team/build-team-helpers.sh) (third ADR-0002 application; markdown narrative + helper-script post-split shape). The skill scaffold + KB + pattern remain implemented per H.2.5. The actual `/forge` integration for skill-bootstrapping uses the existing `/forge` command — which authors locally but does NOT yet do internet research. Internet-research gating is documented in [patterns/skill-bootstrapping.md](../skills/agent-team/patterns/skill-bootstrapping.md) and remains a follow-up. For now, missing skills surface to the user; if the user picks "proceed without specialization", the spawn proceeds with promise-mode references intact.
