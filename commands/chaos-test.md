# Chaos Test — Hierarchical Multi-Persona Toolkit Audit

Trigger a full hierarchical chaos test of the claude-toolkit. Spawns a 3-tier tree (Super Agent → Orchestrators → Actors), runs in parallel, aggregates with cross-run delta analysis, and produces a consolidated report.

## Arguments
$ARGUMENTS — optional. Examples:
- `(no args)` — default tri-fold (Code/Behavior/Architecture orchestrators)
- `--max-depth 2` — limit recursion (default 3; 2 means flat swarm)
- `--no-baseline` — skip cross-run delta even if prior runs exist
- `--pattern <name>` (H.2.9) — target a specific architectural pattern's validation scenarios. See "Pattern-targeted runs" below.

## Pattern-targeted runs (`--pattern <name>`)

Instead of the default broad audit, this mode runs a focused chaos test against a single pattern's failure modes. Workflow:

```bash
# 1. List available patterns + their scenario counts
node ~/Documents/claude-toolkit/scripts/agent-team/pattern-runner.js list-patterns

# 2. Inspect a pattern's testable scenarios
node ~/Documents/claude-toolkit/scripts/agent-team/pattern-runner.js summary --pattern asymmetric-challenger

# 3. Get ready-to-paste actor-prompt skeletons (one per scenario)
node ~/Documents/claude-toolkit/scripts/agent-team/pattern-runner.js prompts --pattern asymmetric-challenger
```

For each scenario in the pattern's "Validation Strategy" section:
- Spawn an actor (auditor persona — typically `01-hacker` or `04-architect` for adversarial scenarios; `03-code-reviewer` for verification scenarios)
- Pass the prompt skeleton from `prompts` subcommand as the actor's task
- Actor sets up the conditions, runs the relevant HETS infrastructure, observes, reports
- Verdict per scenario: `pattern-defense-fired | pattern-silent-failure | pattern-not-applicable`

After all scenarios complete:
- Aggregate per-pattern: how many scenarios fired the defense correctly?
- If any `pattern-silent-failure`: surface as a CRITICAL gap in the consolidated report — the pattern claims to defend against the failure mode but doesn't.
- Use `agent-identity recommend-verification` per spawned identity to apply trust-tiered verification (skip expensive checks for high-trust identities — H.2.4).

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
1. **Assign identity** (Phase H.2-bridge):
   `node ~/Documents/claude-toolkit/scripts/agent-team/agent-identity.js assign --persona {NN-name} --task chaos-{run-id}`
   → returns `{persona}.{name}` (e.g. `04-architect.mira`). Use this as the identity for all downstream steps. See [agent-identity-reputation pattern](../skills/agent-team/patterns/agent-identity-reputation.md).
2. `node ~/Documents/claude-toolkit/scripts/agent-team/tree-tracker.js spawn --run-id $RUN_ID --parent super-root --child actor-{name}-{identity-name} --task "..." --role actor`
3. Spawn the Agent with persona + contract + skills block. Skills block lists `skills.required` and `skills.recommended` from the contract by **name only** — actor invokes `Skill` tool to load on demand. See [persona-skills-mapping](../skills/agent-team/patterns/persona-skills-mapping.md) + [prompt-distillation](../skills/agent-team/patterns/prompt-distillation.md).
4. Include in actor's frontmatter: `identity: {full-identity-string}` so the verifier auto-records per-identity.
5. Tell the actor to write to `node-actor-{name}-{identity-name}.md` with proper frontmatter

**b. After all actors complete, verify contracts:**
For each actor's output file, run:
```bash
node ~/Documents/claude-toolkit/scripts/agent-team/contract-verifier.js \
  --contract ~/Documents/claude-toolkit/swarm/personas-contracts/{NN-name}.contract.json \
  --output ~/Documents/claude-toolkit/swarm/run-state/$RUN_ID/node-actor-{name}-{identity}.md \
  --previous-run ~/Documents/claude-toolkit/swarm/run-state/$PREVIOUS_RUN_ID \
  --identity {NN-name}.{identity}
```
This BOTH validates the output AND records to `~/.claude/agent-patterns.json` (per-persona) AND forwards to `~/.claude/agent-identities.json` (per-identity track record). Identity is also picked up automatically from frontmatter if absent on the CLI. **Note**: invoke from `~/Documents/claude-toolkit/scripts/agent-team/` (not `~/.claude/scripts/`) to avoid the tree-tracker `__dirname` path-resolution quirk surfaced in chaos-20260502-060039.

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
