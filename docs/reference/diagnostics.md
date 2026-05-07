# Diagnostics

> Returns to README: [../../README.md](../../README.md)


To check what's actually working in your installation:

```bash
bash ~/Documents/claude-toolkit/scripts/claude-toolkit-status.sh
```

This shows:
- Which components are installed and where
- Which hooks are configured in `settings.json`
- Whether MemPalace MCP is configured and the CLI is installed
- Recent hook activity from `~/.claude/logs/` (proves hooks fired in real sessions)
- Whether local fallback files exist (`prompt-patterns.json`, `checkpoints/`)
- Live smoke checks confirming scripts work standalone

If "Recent hook activity" shows no logs after you've used Claude Code with the toolkit installed, **Claude Code isn't loading your `settings.json`** — that's the real problem to debug, not the hook scripts themselves.

---

