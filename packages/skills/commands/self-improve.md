# Self-Improvement Review Cycle

Run a full review of captured patterns and promote proven ones to permanent rules or skills.

## Steps

### 1. Scan Memory
Read the project's `MEMORY.md` (if it exists) and identify:
- Patterns that appear 2+ times across sessions
- Stale entries that no longer apply to current practices
- Entries that have led to successful outcomes

### 2. Scan Rules
Read all files in `~/.claude/rules/toolkit/` (the installed LIVE state — read here, edit at the source `packages/skills/rules/`) and check:
- Are any rules outdated or contradicted by recent practice?
- Are there gaps — patterns we consistently follow but haven't codified?
- Do any rules duplicate each other?

### 3. Scan library session-snapshots + decisions
Search the library for cross-session patterns:
- `library ls toolkit/session-snapshots` — recurring patterns across stored sessions
- `library ls toolkit/decisions` — forged agents/skills and their success/failure records
- Conventions that emerged organically across multiple narrative volumes

### 4. Recommend Promotions
For each proven pattern, recommend one of (all promotions edit the **SOURCE** tree, never the installed `~/.claude/` copy — install clobbers it; ship via branch → PR → user merge → `install.sh` / `claude plugin update`):
- **Memory → Rule**: Move from MEMORY.md to the source rules tree `packages/skills/rules/{category}/`
- **Pattern → Skill**: Convert recurring workflow to `packages/skills/library/{name}/SKILL.md`
- **Pattern → Agent**: Create specialized agent at the repo root `agents/{name}.md`

### 5. Recommend Pruning
Flag for removal:
- Stale memory entries
- Duplicate rules
- Unused skills/agents (not invoked in 2+ weeks)
- Overly-specific rules (demote back to memory)

### Quality Gates
Before promoting anything, verify:
- [ ] Pattern appeared in 2+ separate sessions
- [ ] Led to successful outcomes when followed
- [ ] General enough to apply beyond one specific project
- [ ] Does not conflict with existing rules

Present all recommendations and wait for user approval before making changes.
