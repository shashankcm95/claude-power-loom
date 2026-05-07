# Legacy Installer Reference

> Returns to README: [../../README.md](../../README.md)


> **Note**: the canonical install path is the plugin marketplace command at the top of this README. The section below is for users who want manual control or are operating in environments without `/plugin marketplace add` support. The two paths produce equivalent installs.

```bash
# Clone the repo
git clone https://github.com/shashankcm95/claude-power-loom.git ~/Documents/claude-toolkit
cd ~/Documents/claude-toolkit

# Preview what would change
./install.sh --diff --all

# Install everything with backup and smoke tests
./install.sh --backup --all --test

# Or install selectively
./install.sh --agents --rules --hooks
```

### Installer Flags

| Flag | Effect |
|------|--------|
| `--all` | Install agents, rules, hooks, commands, skills |
| `--agents` / `--rules` / `--hooks` / `--commands` / `--skills` | Install selectively |
| `--diff` | Dry run: show what would change without installing |
| `--backup` | Snapshot existing `~/.claude/` to `~/.claude/backups/backup-{timestamp}/` |
| `--test` | Run 7-point smoke test suite after install (verifies hooks fire correctly) |

### Hook Configuration (legacy path only)

If you used `install.sh`, hook scripts copy automatically but the configuration must be merged into `~/.claude/settings.json` manually. Reference template at `hooks/settings-reference.json` — replace `HOME_DIR` with your home directory path.

**If you used the plugin install path** (`/plugin marketplace add ...`), you can skip this step entirely — `hooks/hooks.json` ships with the plugin and is auto-loaded by Claude Code's plugin loader using `${CLAUDE_PLUGIN_ROOT}` substitution. No manual `settings.json` editing required.

### MemPalace Setup (Optional)

```bash
pip3 install mempalace
mempalace init --yes
```

Add to `~/.claude/.mcp.json`:
```json
{
  "mcpServers": {
    "mempalace": {
      "command": "mempalace",
      "args": ["mcp"],
      "env": {}
    }
  }
}
```

Restart Claude Code to connect the MCP server.

---

