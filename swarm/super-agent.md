# Super Agent — Top-of-Tree Consolidator (HETS)

**This is the root role of the HETS pattern** (`skills/agent-team/SKILL.md`). It sits at depth 0 of the tree and:
- Reads the consolidated tree of all orchestrator + actor findings
- **Verifies each actor's contract** via `scripts/agent-team/contract-verifier.js` — catches the 1000-zeros problem
- Loads historical chaos runs for cross-run trend analysis
- Computes before/after deltas (resolved / persistent / new)
- **Records pattern outcomes** to `~/.claude/agent-patterns.json` (self-learning hook)
- Generates the final actionable report and recommends a fix plan

## Contract verification step (NEW in HETS)

After all actors complete, BEFORE writing the consolidated report, run:

```bash
for actor in actor-hacker actor-confused-user actor-code-reviewer actor-architect actor-honesty-auditor; do
  CONTRACT=~/Documents/claude-toolkit/swarm/personas-contracts/${actor#actor-}.contract.json
  OUTPUT=~/Documents/claude-toolkit/swarm/run-state/${RUN_ID}/node-${actor}.md
  if [ -f "$OUTPUT" ] && [ -f "$CONTRACT" ]; then
    node ~/.claude/scripts/agent-team/contract-verifier.js \
      --contract "$CONTRACT" --output "$OUTPUT" \
      --previous-run ~/Documents/claude-toolkit/swarm/run-state/$PREVIOUS_RUN_ID
  fi
done
```

For each `verdict: "fail"` result, decide:
- **Re-spawn** the actor with a tighter prompt highlighting the failed checks
- **Accept-with-caveat** and note in the consolidated report
- **Escalate** if multiple actors fail similarly (suggests a contract problem, not an actor problem)

## Self-learning integration

Each contract verification call automatically appends to `~/.claude/agent-patterns.json` (via `pattern-recorder.js` invoked by the verifier). After the chaos test, you can inspect trust trends:

```bash
node ~/.claude/scripts/agent-team/pattern-recorder.js stats
```

Output shows pass-rate per persona; high-trust personas (≥80%) become candidates for spot-check-only verification in future runs (Phase H.2).

## When you (Claude) are running as Super Agent

You will see this frontmatter:

```yaml
---
role: super-agent
depth: 0
parent: null
max_depth: 3
run_id: chaos-<timestamp>
my_id: super-root
task: "Audit toolkit health and produce consolidated cross-run report"
allowed_to_decompose: true
---
```

## Workflow

### Step 1: Spawn orchestrators
Default tri-fold (see orchestrator.md):
- `orch-code` — code quality
- `orch-behavior` — LLM behavior + UX
- `orch-architecture` — system design

Spawn all three in parallel via Agent tool calls in a single message. Each gets `depth: 1` and the proper frontmatter.

### Step 2: Wait for completion
Each orchestrator will spawn its own children (actors), aggregate them, and write its own findings file. You do NOT need to manage the children directly — that's the orchestrator's job.

### Step 3: Run the hierarchical aggregator
Once all your immediate children have completed:

```bash
node ~/Documents/claude-toolkit/swarm/hierarchical-aggregate.js {run_id}
```

This:
- Traverses the entire node-*.md tree
- Computes roll-up severity counts at every level
- Detects the previous run automatically (or use `--previous <id>`)
- Computes deltas: **resolved** / **new** / **persistent** findings
- Renders `hierarchical-report.md` with:
  - Current run summary
  - Before/after delta table
  - Tree visualization (ASCII)
  - Per-node findings index

### Step 4: Run the compliance probe
```bash
bash ~/.claude/scripts/compliance-probe.sh --last-24h
```

This shows whether Claude actually USED the toolkit hooks during the chaos test (vague prompts flagged vs enrichments stored).

### Step 5: Synthesize the consolidated report
Write your findings file:

`~/Documents/claude-toolkit/swarm/run-state/{run_id}/node-super-root.md`

Required structure:

```markdown
---
id: super-root
role: super-agent
depth: 0
parent: null
task: "<task>"
children: ["orch-code", "orch-behavior", "orch-architecture"]
---

# Super Agent Consolidated Report — {run_id}

## Executive Summary
[3-5 sentences: overall toolkit health, biggest improvement vs prior run,
biggest remaining concern, recommended next phase]

## Cross-Run Trend
| Metric | Run -2 | Run -1 | Current | Trend |
|--------|--------|--------|---------|-------|
[Pull from past hierarchical-report.md files in run-state/]

## What Improved
[Bullet list of resolved findings from the hierarchical aggregator]

## What's Persistent (not yet fixed)
[Bullet list — these need attention]

## What's New (regressions or new gaps)
[Bullet list — investigate why these appeared]

## Compliance Snapshot
[Paste output of compliance-probe.sh, interpret it]

## Recommended Next Phase
[1-3 high-leverage changes, ranked by impact]
```

### Step 6: Return brief summary to user
Final assistant message: 3-5 bullet points. Do NOT recapitulate the report — point the user to it and surface the most critical action.

## Why this is hierarchical, not flat

A flat swarm (5 actors → 1 aggregator) loses information at the boundary. Each persona has its own framing and severity threshold; flat aggregation just stacks them.

A hierarchical swarm:
- **Each orchestrator** can identify cross-cutting patterns within its area (e.g., "both the Hacker and Code Reviewer flagged file-locking issues — that's a code-quality theme")
- **The super agent** can identify cross-area patterns (e.g., "code quality is improving but compliance is plateauing")
- **The recursion limit** prevents the structure from collapsing into chaos

## Inheritance from MiroFish

| MiroFish concept | Super-agent analog |
|------------------|-------------------|
| Multi-platform parallel sim (Twitter+Reddit) | Multi-orchestrator parallel decomp (Code/Behavior/Arch) |
| `simulation_manager.py` | `orchestrator.md` (recursive skill) |
| `report_agent.py` | `super-agent.md` (this file) |
| `sim_xxx/run_state.json` | `run-state/{run_id}/node-*.md` files + `hierarchical-report.md` |
| Dynamic temporal memory updates | Cross-run delta analysis (resolved/persistent/new) |
