# MemPalace Integration (Optional)

> Returns to README: [../../README.md](../../README.md)

### MemPalace Integration (Optional)

MemPalace is a local MCP server that provides persistent semantic memory across sessions. When available, the toolkit uses it for:
- **Pre-compact storage**: Session learnings, decisions, conventions stored before context compression
- **Prompt patterns**: The `prompt-patterns` room stores raw→enriched prompt mappings with approval counts for the prompt-enrichment confidence-tier system
- **Forged agent personality**: Agents created via `/forge` accumulate experience across sessions
- **Self-improvement candidates**: Recurring patterns surface here for promotion to rules

When MemPalace is **not** installed, all components fall back to local files:
- Pre-compact → `~/.claude/checkpoints/last-compact.json` + `mempalace-fallback.md`
- Prompt patterns → `~/.claude/prompt-patterns.json`
- Forged agents → just live in `~/.claude/agents/` as usual

---

