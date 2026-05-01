# Chaos Swarm Orchestrator

Multi-persona pressure-test of the claude-toolkit. Inspired by MiroFish's parallel-simulation pattern: spawn agents with distinct personalities, let them run independently against the toolkit, aggregate findings into a unified report.

## When to use

- Validating the toolkit before a release
- After a major change to verify no regressions
- Periodically (monthly?) to catch drift between docs and reality
- After a real production incident, to widen the test net

## Workflow

### Step 1: Initialize a run

```bash
RUN_ID="chaos-$(date +%Y%m%d-%H%M%S)"
mkdir -p ~/Documents/claude-toolkit/swarm/run-state/$RUN_ID
echo "Run ID: $RUN_ID"
```

### Step 2: Load personas

```bash
ls ~/Documents/claude-toolkit/swarm/personas/
# Should show: 01-hacker.md  02-confused-user.md  03-code-reviewer.md  04-architect.md  05-honesty-auditor.md
```

### Step 3: Spawn parallel agents

Use the Agent tool to spawn ALL 5 personas in a single message (parallel execution). Each agent:
- Reads its persona file from `~/Documents/claude-toolkit/swarm/personas/{file}.md` for instructions
- Executes its tests
- Saves findings to `~/Documents/claude-toolkit/swarm/run-state/{RUN_ID}/{NN-name}-findings.md`

**Critical**: Tell each agent its `RUN_ID` so they save to the correct directory.

Persona-to-agent mapping:
| Persona | Agent type | Why |
|---------|-----------|-----|
| 01-hacker | general-purpose | Needs Bash to run real attacks |
| 02-confused-user | general-purpose | Needs Bash for prompt iteration |
| 03-code-reviewer | code-reviewer | Specialist agent matches the role |
| 04-architect | architect | Specialist agent matches the role |
| 05-honesty-auditor | general-purpose | Needs Bash for jq/grep transcript work |

### Step 4: Aggregate

After all 5 agents complete:

```bash
node ~/Documents/claude-toolkit/swarm/aggregate.js $RUN_ID
```

This produces: `~/Documents/claude-toolkit/swarm/run-state/{RUN_ID}/aggregated-report.md`

### Step 5: Review with user

Present the aggregated report. **Do not start fixing without explicit approval.** The chaos test is data; the fix plan is a separate decision.

### Step 6: Build fix plan

Based on aggregated findings:
1. Group by component (hooks, rules, skills, etc.)
2. Order by severity (Critical → High → Medium → Low)
3. Identify dependencies (some fixes unblock others)
4. Estimate effort
5. Present plan with explicit ask: "Approve which items to fix?"

### Step 7: Implement (only after approval)

Fix in order: Critical → High → Medium → Low. Run smoke tests after each batch. Commit per logical group.

## Anti-patterns

- ❌ Don't spawn agents sequentially — defeats the point of parallel testing
- ❌ Don't aggregate findings yourself — the aggregator script is deterministic
- ❌ Don't fix anything before user approves the plan
- ❌ Don't skip a persona because "it might overlap" — each has a distinct angle

## Why personas (not just task descriptions)?

Each persona has:
- **Identity** — gives the LLM a coherent voice and POV
- **Mindset** — biases the agent toward finding specific failure types
- **Focus area** — narrow scope reduces wasted effort
- **Test method** — concrete instructions, not abstract goals
- **Output format** — standardized so aggregation works

This is the MiroFish pattern: agents with distinct personalities investigating in parallel, results converging into a coherent collective output.
