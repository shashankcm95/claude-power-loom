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
| `--test` | Run the hook smoke-test suite after install (verifies hooks fire correctly; pair with `--hooks`, e.g. `--hooks --test`) |
| `--schedule-heartbeat` | Opt-in: schedule the ghost-heartbeat drift drain runner (launchd on macOS / cron on Linux, every 4h; default-off advisory). Pause without unscheduling via `touch ~/.claude/checkpoints/ghost-heartbeat.disabled` |
| `--unschedule-heartbeat` | Remove the scheduled ghost-heartbeat drain runner |

### Hook Configuration (legacy path only)

If you used `install.sh`, hook scripts copy automatically but the configuration must be merged into `~/.claude/settings.json` manually. Reference template at `packages/kernel/settings-reference.json` — replace `HOME_DIR` with your home directory path.

**If you used the plugin install path** (`/plugin marketplace add ...`), you can skip this step entirely — `packages/kernel/hooks.json` ships with the plugin and is auto-loaded by Claude Code's plugin loader using `${CLAUDE_PLUGIN_ROOT}` substitution. No manual `settings.json` editing required.

### Library memory organizer (v2.1.0+)

`pre-compact-save.js` requires the library substrate to be initialized.
Run once after install:

```bash
node ~/Documents/claude-toolkit/scripts/library.js init
node ~/Documents/claude-toolkit/scripts/library-migrate.js migrate  # symlinks legacy paths
```

See [docs/library.md](../library.md) for the full Section/Stack/Catalog/Volume
substrate reference.

> The pre-v2.1.0 MempPalace MCP integration was removed in v2.1.0; the in-house
> library substrate is now canonical. See [CHANGELOG.md](../../CHANGELOG.md#210--20260513--h921-in-house-library-memory-organizer-mandatory-gate-substrate-fundament)
> v2.1.0 entry + [docs/concepts/library-vs-mempalace.md](../concepts/library-vs-mempalace.md)
> for the design-delta rationale.

---

