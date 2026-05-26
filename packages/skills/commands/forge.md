# Forge — Dynamic Agent or Skill Creation

Create a new specialized agent or skill on the fly when existing ones don't cover the current task.

## Arguments
$ARGUMENTS — description of the agent/skill to create (e.g., "stripe payment integration specialist" or "graphql schema designer")

## Steps

### 1. Gap Detection
Check what already exists:
- `ls ~/.claude/agents/` — existing agents
- `ls ~/.claude/skills/` — existing skills
- Determine if any existing agent/skill already covers this domain
- If overlap exists, suggest extending rather than creating new

### 2. Design
Based on the description, determine:
- **Name**: Short, kebab-case (e.g., `stripe-integrator`)
- **Type**: Agent (autonomous, has tools) or Skill (workflow guide)
- **Scope**: Clear boundaries — what it handles and what it doesn't
- **Model tier**: `sonnet` for mechanical/repetitive, `opus` for reasoning-heavy
- **Tools**: Minimum set needed (principle of least privilege)

### 3. Create

**For agents** — write to both locations:
- `~/Documents/claude-toolkit/agents/{name}.md`
- `~/.claude/agents/{name}.md`

**For skills** — write to both locations:
- `~/Documents/claude-toolkit/skills/{name}/SKILL.md`
- `~/.claude/skills/{name}/SKILL.md`

### 4. Record provenance in library
Write a forge-provenance volume to the library so future sessions can reconstruct the why:
- What task triggered creation
- Domain conventions discovered
- Initial design decisions and rationale

```bash
node ~/Documents/claude-toolkit/scripts/library.js write toolkit/decisions/forge-<name>-<YYYY-MM-DD> \
  --form narrative --topic forge,<persona-or-skill-name> --entities <related-entities>
```

### 5. Confirm
Report what was created, where it lives, and how to invoke it.
