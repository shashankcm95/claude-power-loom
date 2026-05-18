# Evolve — Update Agent or Skill with New Learnings

Update an existing agent or skill based on accumulated experience and feedback.

## Arguments
$ARGUMENTS — name of the agent or skill to evolve (e.g., "planner" or "fullstack-dev")

## Steps

### 1. Load Current State
Read the current agent/skill file:
- Check `~/.claude/agents/{name}.md` for agents
- Check `~/.claude/skills/{name}/SKILL.md` for skills
- If not found, suggest using `/forge` instead

### 2. Gather Learnings
Collect what's changed since last update:
- Check library volumes for stored session outcomes involving this agent/skill (`library ls toolkit/session-snapshots` + grep relevant entries)
- Check MEMORY.md for relevant pattern entries
- Ask user for specific feedback or improvements

### 3. Apply Updates
Modify the agent/skill file:
- Add new domain knowledge or conventions
- Refine workflow steps based on what worked/failed
- Update tool permissions if scope changed
- Adjust model tier if reasoning requirements changed
- Add failure patterns to avoid section

### 4. Sync
Update both locations:
- `~/Documents/claude-toolkit/` (repo source)
- `~/.claude/` (active installation)

### 5. Record Evolution
Write an evolution-record volume to the library:
- What changed and why
- Timestamp of evolution
- Link to triggering session/task

```bash
node ~/Documents/claude-toolkit/scripts/library.js write toolkit/decisions/evolve-<name>-<YYYY-MM-DD> \
  --form narrative --topic evolve,<agent-or-skill-name> --entities <related-entities>
```

Report the diff of changes made.
