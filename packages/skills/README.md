# @power-loom/skills

User-facing skill layer. Cross-cuts Runtime + Kernel via the plugin shell — not a v4 layer per se.

Per-skill-batch semver. The plugin manifest at `.claude-plugin/manifest.json` references the paths here.

## What lives here

- `library/` — 20+ skills (`typescript/`, `react/`, `next-js/`, `node-backend-development/`, `swift-development/`, etc.)
- `commands/` — 13 slash commands (`/build-plan`, `/verify-plan`, `/deploy-checklist`, etc.)
- `rules/` — 8 plugin-shipped guardrail .md files (installed to `~/.claude/rules/toolkit/`; structurally guardrails, not skills or specs)
