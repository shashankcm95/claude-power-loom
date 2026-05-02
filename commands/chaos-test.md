# Chaos Test — Hierarchical Multi-Persona Toolkit Audit

Trigger a full hierarchical chaos test of the claude-toolkit. Spawns a 3-tier tree (Super Agent → Orchestrators → Actors), runs in parallel, aggregates with cross-run delta analysis, and produces a consolidated report.

## Arguments
$ARGUMENTS — optional. Examples:
- `(no args)` — default tri-fold (Code/Behavior/Architecture orchestrators)
- `--max-depth 2` — limit recursion (default 3; 2 means flat swarm)
- `--no-baseline` — skip cross-run delta even if prior runs exist

## Steps

### 1. Initialize run
```bash
RUN_ID="chaos-$(date +%Y%m%d-%H%M%S)"
mkdir -p ~/Documents/claude-toolkit/swarm/run-state/$RUN_ID
echo "Run ID: $RUN_ID"
```

### 2. Activate Super Agent (HETS pattern)
Read `~/Documents/claude-toolkit/swarm/super-agent.md` and `~/Documents/claude-toolkit/skills/agent-team/SKILL.md`. Follow the HETS workflow:

**a. Spawn actors flat (recommended for chaos test):**
Spawn all 5 actors in parallel directly from super-agent (avoids the rate-limit cliff of 3-orch-spawn-actors fan-out we hit in chaos-20260501-184505).

For each actor:
1. `node ~/.claude/scripts/agent-team/tree-tracker.js spawn --run-id $RUN_ID --parent super-root --child actor-{name} --task "..." --role actor`
2. Spawn the Agent with the persona file + the contract file referenced in the prompt
3. Tell the actor to write to `node-actor-{name}.md` with proper frontmatter

**b. After all actors complete, verify contracts:**
For each actor's output file, run:
```bash
node ~/.claude/scripts/agent-team/contract-verifier.js \
  --contract ~/Documents/claude-toolkit/swarm/personas-contracts/{NN-name}.contract.json \
  --output ~/Documents/claude-toolkit/swarm/run-state/$RUN_ID/node-actor-{name}.md \
  --previous-run ~/Documents/claude-toolkit/swarm/run-state/$PREVIOUS_RUN_ID
```
This BOTH validates the output AND records the pattern to `~/.claude/agent-patterns.json` (self-learning hook).

For any `verdict: "fail"`: re-spawn the actor once with a tighter prompt highlighting the failed checks.

**c. Synthesize orchestrator tier (super agent does this inline):**
You ARE the super agent — synthesize the orchestrator-tier views (orch-code, orch-behavior, orch-architecture) yourself based on the verified actor outputs. Write three `node-orch-{area}.md` files with proper frontmatter.

**d. Run aggregator + compliance probe:**
- `node ~/Documents/claude-toolkit/swarm/hierarchical-aggregate.js $RUN_ID --previous chaos-...`
- `bash ~/.claude/scripts/compliance-probe.sh --last-24h`

**e. Write super-root consolidated report.**

### 3. Show user the consolidated report
After super agent completes, display:
- Path to `~/Documents/claude-toolkit/swarm/run-state/$RUN_ID/hierarchical-report.md`
- The executive summary from `node-super-root.md`
- Top recommendation for next fix phase

**Do not start fixing anything** — the chaos test is the audit. A separate `/forge` or manual approval kicks off the fix phase.

## Why a hierarchical chaos test?

Flat swarms (5 actors → 1 aggregator) miss cross-cutting patterns. The hierarchy lets:
- Each **orchestrator** see patterns within its area
- The **super agent** see patterns across areas
- **Recursion** allows complex test areas to decompose further (with `max_depth` limit)

Inspired by MiroFish's multi-platform simulation but adapted to a tree-of-teams pattern.
