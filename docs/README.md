# Power Loom — Documentation

Start at the [main README](../README.md) for the overview and install. This index organizes the deep-dive docs.

## Substrate (the current vision)

- [**Architecture**](ARCHITECTURE.md) — the substrate model: the three layers (kernel/runtime/lab), the Ten Axioms, the transaction loop, every kernel primitive with its live/dormant/advisory status, and the threat model for the human-gated delta path.
- [**Roadmap**](ROADMAP.md) — how the substrate got here (Phase 0 → v3.11 ✓, each phase with its 3-lens phase-close sign-off, plus the post-v3.11 readiness arc — Phase ③.0 / ③.1 dry-run, Router-V2, ghost-heartbeat, Docker containment) and where it goes next (the **Phase ③.2 live external-PR beta** — the first world-anchored live merges). Appended each phase.
- [**Activation ledger**](ACTIVATION-LEDGER.md) — the honest inventory: every built-but-dark / flag-gated capability, its consumer, and its activation fate (incl. the denial-source taxonomy the breaker draws from).
- [**Delta-promote walkthrough**](delta-promote-walkthrough.md) — the human-gated promote workflow end to end, with the runnable hermetic demo (`node examples/delta-promote-demo.js`).

The authoritative design record is [`packages/specs/`](../packages/specs/): the v6 synthesis RFC, the ADRs (0001–0017), and the per-phase plans (living per-wave docs).

## Hooks

The deterministic enforcement layer — pure logic, no LLM interpretation. Scripts live under `packages/kernel/hooks/{pre,post,lifecycle}/` + `packages/kernel/validators/`, registered via `packages/kernel/hooks.json`. The PR-egress chokepoint (`packages/kernel/egress/`) is the sole `emitPR` path for the live-beta arc (post-v3.11 work, unreleased) — `armedEmit` currently throws by design, so no live emission exists yet.

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
