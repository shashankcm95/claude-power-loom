# Forge — Dynamic Agent or Skill Creation

Create a new specialized agent or skill on the fly when existing ones don't cover the current task.

## Arguments
$ARGUMENTS — description of the agent/skill to create (e.g., "stripe payment integration specialist" or "graphql schema designer")

## Steps

### 1. Gap Detection
Check what already exists in the SOURCE tree (the canonical roster — the installed `~/.claude/` copies are build artifacts):
- `ls ${CLAUDE_PLUGIN_ROOT}/agents/` — existing agents
- `ls ${CLAUDE_PLUGIN_ROOT}/packages/skills/library/` — existing skills
- Determine if any existing agent/skill already covers this domain
- If overlap exists, suggest extending rather than creating new (use `/evolve`)

### 2. Design
Based on the description, determine:
- **Name**: Short, kebab-case (e.g., `stripe-integrator`)
- **Type**: Agent (autonomous, has tools) or Skill (workflow guide)
- **Scope**: Clear boundaries — what it handles and what it doesn't
- **Model tier**: `sonnet` for mechanical/repetitive, `opus` for reasoning-heavy
- **Tools**: Minimum set needed (principle of least privilege)

### 3. Create (SOURCE only — never the installed copy)

**For agents** — write the source: `${CLAUDE_PLUGIN_ROOT}/agents/{name}.md`

**For skills** — write the source: `${CLAUDE_PLUGIN_ROOT}/packages/skills/library/{name}/SKILL.md`

Do NOT also write the installed `~/.claude/agents/` / `~/.claude/skills/` copy. That is the dual-write hotfix trap (#275 removed the same step from `/evolve`): the installed copy is a build artifact that `install.sh` / `claude plugin update` clobbers, and a hand-written one silently drifts from source. The forged file goes live through the normal ship path (Step 5).

### 4. Record provenance in library
Write a forge-provenance volume to the library so future sessions can reconstruct the why:
- What task triggered creation
- Domain conventions discovered
- Initial design decisions and rationale

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/library.js write toolkit/decisions/forge-<name>-<YYYY-MM-DD> \
  --form narrative --topic forge,<persona-or-skill-name> --entities <related-entities>
```

### 5. Confirm + ship
Report what was created, where it lives, and how to invoke it. Then ship it: branch → PR → user merge → live on `claude plugin update` (plugin surfaces) / `bash install.sh` (installed copies). The forge is not done at file-write — it is done when the source ships.
