# Skill Forge — Dynamic Agent & Skill Creation

Create specialized agents and skills on the fly when existing ones don't fit the task.

## When to Forge

- The current task requires domain-specific expertise not covered by existing agents/skills
- A pattern emerges that will recur (e.g., "we keep doing Stripe integrations")
- The user explicitly asks to create a specialized workflow
- Post-task review reveals a reusable pattern worth capturing

## Forge Process

### 1. Gap Detection
Before starting complex work, check:
- `ls ~/.claude/agents/` — what agents exist?
- `ls ~/.claude/skills/` — what skills exist?
- Does the current task fit an existing agent's description?
- If not, what specialty is missing?

### 2. Design the Agent/Skill
Determine:
- **Name**: Short, descriptive (e.g., `stripe-integrator`, `graphql-designer`)
- **Type**: Agent (has tools, model tier, acts autonomously) vs Skill (workflow guide, no tools)
- **Scope**: What does it handle? What does it NOT handle?
- **Conventions**: What standards / patterns the agent should encode (these go directly in the system prompt — Claude Code does not persist agent state across invocations)

### 3. Create the File

**For agents** — write to `~/.claude/agents/{name}.md`:
```markdown
---
name: {name}
description: {one-line description — this is what the orchestrator reads}
tools: ["Read", "Grep", "Glob", "Bash"]  # scope appropriately
model: sonnet  # sonnet for mechanical, opus for reasoning
color: {color}
---

{System prompt with domain expertise, workflow, and constraints}
```

**For skills** — write to `~/.claude/skills/{name}/SKILL.md`:
```markdown
# {Skill Name}

{One-paragraph description}

## Steps
1. {Step with rationale}
2. {Step with rationale}
...
```

### 4. Document the Creation Context
After creating the agent/skill, append a brief comment block to the agent file documenting:
- What task triggered its creation
- Date and project
- Initial design decisions

This stays in the file — Claude reads it on every invocation. If MemPalace MCP is available, you may also `store_memory` with the agent name as the room for cross-session searchability, but the agent file itself is the source of truth.

**What this is NOT**: agents do NOT accumulate personality or learn across invocations. Each `Agent` tool call spawns a fresh subagent with the system prompt as written in its `.md` file. To "evolve" an agent, you must explicitly edit the `.md` file (use `/evolve {name}` for the workflow).

### 5. Register for Recall
The new agent/skill is immediately available in `~/.claude/agents/` or `~/.claude/skills/`. Claude discovers them by listing those directories — no further registration needed.

## Evolution
After each use of a forged agent/skill:
- Did it succeed? Update its instructions with learnings.
- Did it fail? Record the failure pattern and adjust.
- Has it been used 3+ times successfully? Consider promoting its key patterns to rules.

## Anti-Patterns
- Don't create agents for one-off tasks — just do the work
- Don't duplicate existing agent capabilities — extend instead
- Don't create agents without clear scope boundaries — they become god-objects
- Don't claim agents have memory or personality across runs — they don't. Edit the `.md` file when behavior should change.
