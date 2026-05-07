# Architecture

Substrate-level design and load-bearing decisions.

- [Substrate philosophy](substrate-philosophy.md) — Hooks before, persistence around, verification after
- [Two layers in one plugin](two-layers.md) — Substrate + HETS
- [HETS — Hierarchical Engineering Team Simulation](hets.md) — Multi-agent orchestration with persistent identity
- [Component invocation](component-invocation.md) — How hooks/agents/skills/commands wire together

## Source-of-truth pattern docs

For pattern docs (load-bearing architecture decisions), see [`skills/agent-team/patterns/`](../../skills/agent-team/patterns/) — 13 documented patterns including:
- `agent-identity-reputation.md` — trust formula transparency
- `trust-tiered-verification.md` — verification depth by tier
- `asymmetric-challenger.md` — pair-run conventions
- `route-decision.md` — 7-dim scoring + context-awareness
- `kb-scope-enforcement.md` — transcript-provenance verification
- (and more)

> Up: [docs/](..)
