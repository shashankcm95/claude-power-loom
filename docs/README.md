# Power Loom — Documentation

Start at the [main README](../README.md) for the overview and install. This index organizes the deep-dive docs.

## Substrate (the current vision)

- [**Architecture**](ARCHITECTURE.md) — the substrate model: the three layers (kernel/runtime/lab), the Ten Axioms, the transaction loop, and every kernel primitive K1–K14 with its live/dormant/advisory status.
- [**Roadmap**](ROADMAP.md) — how the substrate got here (Phase 0 ✓ → Phase 1-alpha ✓ → v3.1 ✓) and where it goes next (v3.2+). Appended each phase.

The authoritative design record is [`packages/specs/`](../packages/specs/): the v6 synthesis RFC, the ADRs (0008–0012), and the per-phase plans.

## Hooks

The deterministic enforcement layer — pure logic, no LLM interpretation. Scripts live under `packages/kernel/hooks/{pre,post,lifecycle}/` + `packages/kernel/validators/`, registered via `packages/kernel/hooks.json`.

- [Hooks overview + per-hook deep-dives](hooks/overview.md)

## Agents

The specialist layer (generic engineering personas + the HETS runtime personas; persona contracts under `packages/runtime/`).

- [Agents overview](agents/overview.md)

## Skills

The workflow layer (domain workflows under `packages/skills/`).

- [Skills overview](skills/overview.md)

## Install

- [Install overview](install/) — plugin marketplace (canonical) + legacy installer
- [Legacy installer reference](install/legacy-installer.md) — `./install.sh --all` for environments without `/plugin` support

## Reference

- [Stability commitment](reference/stability-commitment.md) — Stable / evolving / experimental classification
- [Project structure](reference/project-structure.md) — repository layout walkthrough
- [Commands reference](reference/commands.md) — slash commands shipped with the plugin
- [Rules reference](reference/rules.md) — always-on guidance rules
- [Diagnostics](reference/diagnostics.md) — verifying install health, debugging hooks, checking trust state
- [Library memory organizer](library.md) — Section/Stack/Catalog/Volume memory substrate
- [Library vs MemPalace](concepts/library-vs-mempalace.md) — design-deltas + attribution for the library

## Development

- [Extending Power Loom](development/extending.md) — how to add a hook, agent, or skill
- [Attribution](development/attribution.md) — community plugins that inspired this work

## Repo-root docs

- [Main README](../README.md) — overview, install, positioning
- [CHANGELOG.md](../CHANGELOG.md) — version history
- [CONTRIBUTING.md](../CONTRIBUTING.md) — git workflow + conventions
- [ATTRIBUTION.md](../ATTRIBUTION.md) — full attribution + license disclosures
