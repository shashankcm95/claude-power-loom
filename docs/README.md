# power-loom — Documentation

Deep-dive documentation organized by topic. Start at the [main README](../README.md) for the overview.

## Architecture

Substrate-level design and load-bearing decisions.

- [Substrate philosophy](architecture/substrate-philosophy.md) — Hooks before, persistence around, verification after
- [Two layers in one plugin](architecture/two-layers.md) — Substrate + HETS
- [HETS — Hierarchical Engineering Team Simulation](architecture/hets.md) — Multi-agent orchestration with persistent identity
- [Component invocation](architecture/component-invocation.md) — How hooks/agents/skills/commands wire together

## Hooks

The deterministic enforcement layer (18 hook scripts: 11 top-level + 7 validators in `hooks/scripts/validators/`; registered as 17 hook entries across 6 lifecycle events per `hooks/hooks.json`).

- [Hooks overview + per-hook deep-dives](hooks/overview.md)

## Agents

The specialist layer (5 generic engineering personas, 16 HETS personas + 2 templates = 18 persona contracts in `swarm/personas-contracts/`).

- [Agents overview](agents/overview.md)

## Skills

The workflow layer (17 skills covering domain workflows).

- [Skills overview](skills/overview.md)

## Install

- [Legacy installer reference](install/legacy-installer.md) — `./install.sh --all` for environments without `/plugin` support

## Reference

- [Stability commitment (v2.x)](reference/stability-commitment.md) — Stable / evolving / experimental classification (post-v2.0.0)
- [Project structure](reference/project-structure.md) — Repository layout walkthrough
- [Commands reference](reference/commands.md) — Slash commands shipped with the plugin
- [Rules reference](reference/rules.md) — Always-on guidance rules
- [Diagnostics](reference/diagnostics.md) — Verifying install health, debugging hooks, checking trust state
- [MemPalace integration](reference/mempalace-integration.md) — Optional cross-session semantic search

## Development

- [Extending power-loom](development/extending.md) — How to add new hooks, agents, or skills
- [Attribution](development/attribution.md) — References to community plugins that inspired this work

## Other repo-root docs

- [Main README](../README.md) — Overview, install, positioning
- [CHANGELOG.md](../CHANGELOG.md) — Version history (Keep-a-Changelog format)
- [CONTRIBUTING.md](../CONTRIBUTING.md) — Git workflow + phase-tag conventions
- [ATTRIBUTION.md](../ATTRIBUTION.md) — Full attribution + license disclosures
- [skills/agent-team/USING.md](../skills/agent-team/USING.md) — End-user walkthrough using HETS on real projects
- [skills/agent-team/BACKLOG.md](../skills/agent-team/BACKLOG.md) — Deferred work and SHIPPED phase records
