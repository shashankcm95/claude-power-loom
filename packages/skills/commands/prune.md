# Prune — Remove Stale Entries

Clean up memory, rules, skills, and agents that are no longer useful.

## Steps

### 1. Audit Memory
Read project MEMORY.md files and flag:
- Entries that contradict current practices
- Entries older than 30 days with no recent reinforcement
- Duplicate or near-duplicate entries

### 2. Audit Rules
Read all files in `~/.claude/rules/toolkit/` and flag:
- Rules that duplicate other rules
- Overly-specific rules that should be demoted to memory
- Rules that conflict with each other
- Rules with no evidence of recent application

### 3. Audit Agents & Skills
List `~/.claude/agents/` and `~/.claude/skills/` and flag:
- Agents/skills that haven't been invoked recently
- Agents/skills whose scope overlaps significantly
- Agents/skills that were forged for one-off tasks

### 4. Check library volumes
Search the library at `~/.claude/library/sections/toolkit/stacks/session-snapshots/` and other narrative stacks for:
- Stored contexts with no recent access (`library stats` shows last-modified)
- Outdated domain knowledge in older session-snapshot volumes
- Duplicate or conflicting catalog entries (`library ls toolkit/<stack>`)

### 5. Present Findings
Show a categorized list:
- 🔴 **Remove**: Clearly stale, contradictory, or duplicate
- 🟡 **Demote**: Overly specific rules → memory entries
- 🟢 **Keep**: Still relevant and actively used

Wait for user confirmation before deleting anything. Permanent deletion requires explicit approval for each item.
