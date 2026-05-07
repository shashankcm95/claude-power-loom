# Install

Two install paths produce identical `~/.claude/` state.

- [Legacy installer reference](legacy-installer.md) — `./install.sh` for environments without `/plugin` support

## Plugin marketplace path

The recommended path for Claude Code users:

```bash
/plugin marketplace add shashankcm95/claude-power-loom
/plugin install power-loom
```

Plugin manifest layout: both `plugin.json` and `marketplace.json` live in [`.claude-plugin/`](../../.claude-plugin/).

> Up: [docs/](..)
