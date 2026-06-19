---
name: skill-forge
description: Create specialized agents and skills on the fly when existing ones don't fit the task. Scaffolds the agent definition, persona contract, KB stubs, and integration wiring through a guided workflow.
---

# Skill Forge — Dynamic Agent & Skill Creation

Create specialized agents and skills on the fly when existing ones don't fit the task.

## When to Forge

- The current task requires domain-specific expertise not covered by existing agents/skills
- A pattern emerges that will recur (e.g., "we keep doing Stripe integrations")
- The user explicitly asks to create a specialized workflow
- Post-task review reveals a reusable pattern worth capturing

## Forge Process

### 1. Gap Detection
Before starting complex work, check the SOURCE tree (the canonical roster — the installed `~/.claude/` copies are build artifacts):
- `ls ~/Documents/claude-toolkit/agents/` — what agents exist?
- `ls ~/Documents/claude-toolkit/packages/skills/library/` — what skills exist?
- Does the current task fit an existing agent's description?
- If not, what specialty is missing?

### 2. Design the Agent/Skill
Determine:
- **Name**: Short, descriptive (e.g., `stripe-integrator`, `graphql-designer`)
- **Type**: Agent (has tools, model tier, acts autonomously) vs Skill (workflow guide, no tools)
- **Scope**: What does it handle? What does it NOT handle?
- **Conventions**: What standards / patterns the agent should encode (these go directly in the system prompt — Claude Code does not persist agent state across invocations)

### 2a. Canonical-source lookup (H.6.7) + validation_sources (H.7.0-prep)
Before generic internet research, consult the canonical-source registry for tech skills:

```bash
# Read the registry once at forge time
node "${CLAUDE_PLUGIN_ROOT}/packages/runtime/orchestration/kb-resolver.js" cat hets/canonical-skill-sources
```

Look up the skill name in the `### Registry` section. If a canonical source exists:
- **Use the `url` as the PRIMARY reference** — this is the project owners' authoritative documentation
- **Note the `type`** (`reference` > `book` > `getting-started` > `spec`) to scope research depth
- **Apply the `notes` field** as additional context to the forge prompt (e.g., "v18+ only", "App Router post-13.4", "Pydantic v2 integration")
- **If `validation_sources` is present (H.7.0-prep)**: ALSO consult these primary references — they encode the WHY behind the canonical doc's HOW. Cite them in the forged skill's `## Sources` section ALONGSIDE the canonical URL.

If no canonical source exists, fall back to generic internet research (existing behavior — no regression).

**The two-axis principle (H.7.0-prep)**:
- `url` answers **"How do I use this?"** — owner-maintained, current, library-API-shaped
- `validation_sources` answer **"Why does this work?"** — peer-reviewed, durable, theory-shaped

For most tech skills (react, kubernetes-config, airflow), the canonical URL alone is enough — the WHY is operational and lives in the owner docs. For security skills, algorithm-heavy skills, and architectural patterns, the WHY lives in primary research (RFCs, papers, NIST publications). `validation_sources` surfaces those.

**Example — forging penetration-testing**: registry entry has both. The skill cites OWASP WSTG (canonical: HOW to test) AND RFC 6749 + RFC 6819 + draft-ietf-oauth-security-topics (validation_sources: WHY OAuth has these threat classes). Result: a skill grounded in both engineering practice AND specification.

**Why canonical-first**: tech skills (React, Kubernetes, Spring Boot) have authoritative docs that are structurally better than generic blog posts — comprehensive, current, license-clear, and maintained by the project owners. A skill forged from `react.dev/reference` encodes the React team's idioms; one forged from "react best practices 2024" encodes whichever blog ranked highest that month.

**At task end**: if you forged a skill that SHOULD have had a canonical source OR validation_sources but the registry didn't list them, surface the gap via missing-capability-signal `request: { type: extend-canonical-sources, ... }` so root can update the registry. This is L2 of the evolution-cycle vision: better INPUTS to the substrate produce higher-quality skills, faster trust accumulation.

### 3. Create the File (SOURCE only — never the installed `~/.claude/` copy)

The installed `~/.claude/agents/` + `~/.claude/skills/` copies are build artifacts that `install.sh` / `claude plugin update` clobber — writing them directly is the unreviewed-hotfix trap (same class `/evolve` shed in #275).

**For agents** — write the source at `~/Documents/claude-toolkit/agents/{name}.md`:
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

**For skills** — write the source at `~/Documents/claude-toolkit/packages/skills/library/{name}/SKILL.md`:
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

This stays in the file — Claude reads it on every invocation. Optionally write a forge-provenance volume to `~/.claude/library/sections/toolkit/stacks/decisions/` for cross-session searchability via the library catalog, but the agent file itself is the source of truth.

**What this is NOT**: agents do NOT accumulate personality or learn across invocations. Each `Agent` tool call spawns a fresh subagent with the system prompt as written in its `.md` file. To "evolve" an agent, you must explicitly edit the `.md` file (use `/evolve {name}` for the workflow).

### 5. Ship (registration = the ship path, not the file-write)
The new agent/skill is NOT live the moment the source file is written. It ships through the normal path: branch → PR → user merge → `bash install.sh` (installed copies) / `claude plugin update` (plugin surfaces). Claude then discovers it from the installed `~/.claude/agents/` / skills surfaces next session — no further registration needed beyond the ship.

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
