# Skills — Workflow Layer Overview

> Returns to README: [../../README.md](../../README.md)

Skills are markdown procedures Claude matches to tasks contextually. They contain step-by-step workflows that complement the rules. The table below shows highlight skills; see `skills/` directory for the full list of 17 skills shipped at v2.0.0.

| Skill | What it does |
|-------|-------------|
| `fullstack-dev` | Server-first development workflow: data layer → API layer → UI layer → tests |
| `deploy-checklist` | Pre-deployment verification: tests, migrations, env vars, bundle size, rollback plan, monitoring |
| `agent-swarm` | Multi-agent orchestration: identifying parallelizable work, dispatching to specialists, merging results |
| `research-mode` | Anti-hallucination workflow: source cascade (local files → WebSearch → WebFetch), citation format `[Source: path:line]`, max 5 searches/3 fetches per question |
| `self-improve` | Memory-to-rules promotion pipeline: scan MEMORY.md → identify recurring patterns → promote to rules/skills/agents → prune stale entries |
| `skill-forge` | Dynamic agent/skill creation at runtime: gap detection → name + scope + model + tools → create file in repo + ~/.claude/ → store in MemPalace |
| `prompt-enrichment` | 4-part structured prompt builder triggered by the vagueness hook. Confidence tiers: **Learning** (0 approvals, full review), **Familiar** (1-2, light confirmation), **Trusted** (3-4, summary auto-proceed), **Independent** (5+, silent enrichment) |
| `agent-team` (Phase H.x) | **Hierarchical Engineering Team Simulation**. Multi-tier coordinated agents (super → orchestrator → actor) with verifiable contracts, identity model, content-addressed KB, asymmetric+symmetric pairing, trust-tiered verification. See dedicated section below. |
| `swift-development` (H.2.1) | First specialist skill authored as a worked example for the HETS builder family. Swift idioms, ARC, structured concurrency, project structure. Triggers when a HETS persona requires it. |

---

