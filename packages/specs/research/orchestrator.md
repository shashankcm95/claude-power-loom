# Hierarchical Chaos Orchestrator

Recursive multi-tier orchestration for chaos testing. Tree of agents, each level rolls findings up to its parent. Bounded by `MAX_DEPTH` to prevent runaway recursion.

**This is a consumer of the HETS pattern** (`skills/agent-team/SKILL.md`). Read that first if you're new to the architecture.

Inspired by MiroFish's parallel-simulation pattern, extended with tree decomposition + verifiable contracts (the 1000-zeros defense) + self-learning hook.

## Operational notes

- **Sub-agents may not have Agent tool access.** When spawning fails, fall back to inline persona execution and explicitly mark the resulting node as `executed_inline: true` in its frontmatter.
- **API rate limits hit before max_depth limits in practice.** A flat fan-out of 5 actors from super-root is safer than 3 orchestrators each spawning 2 actors.
- **Every spawn must be tracked** via `node ~/.claude/scripts/agent-team/tree-tracker.js spawn ...` so the tree is auditable.
- **Every actor completion must be verified** via `node ~/.claude/scripts/agent-team/contract-verifier.js --contract X --output Y`.
- **Persona contracts are at** `~/Documents/claude-toolkit/swarm/personas-contracts/{NN-name}.contract.json`.

## Architecture

```
[depth 0]  Super Agent              ← consolidates everything, does cross-run analysis
              │
[depth 1]  Orchestrator(s)          ← coordinate sub-areas (Code/Behavior/Architecture)
              │
[depth 2]  Sub-Orchestrators        ← optional: further decompose (e.g., Code → Hooks/Skills)
              │
[depth 3]  Actors (max depth)       ← persona agents that DO the actual work
```

**MAX_DEPTH = 3.** At depth 3, only actors can be spawned. Below that, an orchestrator can choose to spawn sub-orchestrators OR actors directly.

## When you (Claude) are running as an Orchestrator

You will see a frontmatter block in your task prompt:

```yaml
---
role: orchestrator         # or super-agent or actor
depth: 1                   # current depth in the tree
parent: super-root         # parent node id
max_depth: 3               # the recursion limit
run_id: chaos-...          # run directory id
my_id: orch-code           # your unique node id
task: "Audit code quality of the toolkit"
allowed_to_decompose: true # can you spawn sub-orchestrators?
---
```

Your job:

### Step 1: Decide decomposition
- If `depth + 1 < max_depth` AND `allowed_to_decompose` AND task is complex enough:
  → spawn 2-4 **sub-orchestrators**, each with a narrower task
- Otherwise:
  → spawn 1-5 **actors** (persona agents) directly

### Step 2: Spawn children in parallel
Use the Agent tool. For each child, set frontmatter in the prompt:

```yaml
---
role: orchestrator | actor
depth: <your_depth + 1>
parent: <your_my_id>
max_depth: <inherit>
run_id: <inherit>
my_id: <generate unique id, kebab-case>
task: "<specific subtask>"
persona: <only for actors: 01-hacker | 02-confused-user | etc>
allowed_to_decompose: <true if depth+1 < max_depth>
---
```

If spawning an actor, ALSO include in the prompt:
> Read your persona definition at `~/Documents/claude-toolkit/swarm/personas/{persona}.md` and follow it. Save findings to `~/Documents/claude-toolkit/swarm/run-state/{run_id}/node-{my_id}.md` with frontmatter at the top.

### Step 3: Aggregate when children complete
After all your children return, write your own findings file:

`~/Documents/claude-toolkit/swarm/run-state/{run_id}/node-{my_id}.md`

```markdown
---
id: <my_id>
role: orchestrator
depth: <your_depth>
parent: <your_parent>
task: "<your task>"
children: ["child-id-1", "child-id-2"]
---

# Orchestrator Summary — {my_id}

## Aggregated Findings (from children)

[Brief synthesis: what cross-cutting patterns did the children surface?
Don't list every finding — that's already in the children's files. Surface
the meta-observations a tree-aware reviewer would care about.]

## CRITICAL
[Only orchestrator-level findings — patterns ACROSS children, not duplicates]

## HIGH / MEDIUM / LOW
[Same: only what the orchestrator can see that children couldn't]
```

### Step 4: Return control to parent
Your final assistant message should briefly summarize what you found and which children produced what. The parent reads this.

## When you (Claude) are running as an Actor

You're at the leaf — no further decomposition. Read your persona file and execute. See `swarm/personas/`.

## When you (Claude) are running as Super Agent (depth 0)

See `swarm/super-agent.md` — you do cross-run analysis, before/after deltas, and consolidated reporting.

## Recursion limit

**Hard rule**: never spawn an Agent at depth ≥ `max_depth`. The aggregator (`hierarchical-aggregate.js`) traverses the tree and would warn if a node exists beyond max_depth.

For a typical chaos test, MAX_DEPTH = 3 means:
- 1 super agent
- 1-4 orchestrators
- Each orchestrator spawns 1-5 sub-orchestrators OR actors
- If sub-orchestrators, each spawns 1-5 actors

That bounds the tree at roughly: 1 + 4 + 16 + 80 = 101 nodes max. In practice, most runs stay at 1 + 3 + 0 + ~5 = ~9 nodes.

## Default decomposition for chaos-test runs

If you're spawned as a depth-1 orchestrator with no specific decomposition guidance, use this default tri-fold:

| Orchestrator | Task | Likely children (actors) |
|--------------|------|-------------------------|
| `orch-code` | Code-quality audit | `01-hacker`, `03-code-reviewer` |
| `orch-behavior` | LLM behavior + UX | `02-confused-user`, `05-honesty-auditor` |
| `orch-architecture` | System design | `04-architect` |

Each orchestrator can flatten further (no sub-orchestrators) and just spawn its 1-2 actors.
