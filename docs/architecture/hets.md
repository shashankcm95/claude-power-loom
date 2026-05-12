# HETS — Hierarchical Engineering Team Simulation

> Returns to README: [../../README.md](../../README.md)

### HETS — Hierarchical Engineering Team Simulation (Phase H.x)

A separate layer for tasks too complex for a single agent. Implements the architecture documented in [skills/agent-team/SKILL.md](skills/agent-team/SKILL.md) and the 21-pattern library at [skills/agent-team/patterns/](skills/agent-team/patterns/).

**Components shipped across phases H.1 → H.9.17** (v2.0.0 SHIPPED 2026-05-12; full phase log in [skills/agent-team/SKILL.md](skills/agent-team/SKILL.md) and [skills/agent-team/BACKLOG.md](skills/agent-team/BACKLOG.md)):

| Layer | Count | Lives at |
|-------|-------|----------|
| **Personas** | 16 (5 auditor + 8 builder + 3 codebase-investigator) + 2 templates (challenger + engineering-task) = 18 contracts | `swarm/personas/`, `swarm/personas-contracts/` |
| **Patterns library** | 21 architectural patterns (HETS, asymmetric-challenger, trust-tiered-verification, convergence-as-signal, persona-skills-mapping, agent-identity-reputation, meta-validation, prompt-distillation, shared-knowledge-base, content-addressed-refs, skill-bootstrapping, tech-stack-analyzer, plan-mode-hets-injection, etc.) | `skills/agent-team/patterns/` |
| **Shared KB** | Multi-domain docs across 9 domains (architecture, hets, mobile-dev, web-dev, backend-dev, ml-dev, infra-dev, data-dev, security-dev) | `skills/agent-team/kb/` |
| **Scripts** | HETS substrate scripts (tree-tracker, contract-verifier, pattern-recorder, agent-identity, kb-resolver, route-decide, adr, etc.) | `scripts/agent-team/` |
| **Persistent state** | Per-identity reputation, per-persona pattern history, KB manifest | `~/.claude/agent-identities.json`, `~/.claude/agent-patterns.json`, `skills/agent-team/kb/manifest.json` |

**Key features:**

- **16 specialist personas in three families**:
  - **Auditor family** (chaos-test focused): `01-hacker`, `02-confused-user`, `03-code-reviewer`, `04-architect`, `05-honesty-auditor`
  - **Builder family** (product focused): `06-ios-developer`, `07-java-backend`, `08-ml-engineer`, `09-react-frontend`, `10-devops-sre`, `11-data-engineer`, `12-security-engineer`, `13-node-backend`
  - **Codebase-investigator family** (research focused): `14-codebase-locator`, `15-codebase-analyzer`, `16-codebase-pattern-finder`
- **Persistent named identities**: each persona has a roster of identities (e.g. `04-architect` → `mira`, `theo`, `ari`); each accumulates per-instance trust + skill-invocation history across runs ("I trust mira" becomes meaningful)
- **Verifiable contracts**: every output checked against functional + anti-pattern checks (`prototype-pollution-safe verifier with 11 check types`)
- **Content-addressed KB**: SHA-256 refs (`kb:web-dev/react-essentials@a3f1b2c4`) frozen-per-run via snapshots — same content always produces same hash, cross-project reuse falls out for free
- **Asymmetric challenger**: lightweight critic (`challenger.contract.json`, ~10K tokens) reads implementer's output and surfaces ≥1 substantive disagreement; ~1.3-1.5× cost vs ~2× for symmetric pair
- **Trust-tiered verification** (LATENCY-CRITICAL): high-trust identities skip expensive checks (e.g., `noTextSimilarityToPriorRun`); low-trust + unproven get symmetric pair; queryable via `agent-identity recommend-verification`
- **Marketplace integration**: contracts can reference `knowledge-work-plugins` skills (e.g., `engineering:incident-response`, `data:sql-queries`) via `marketplace:<plugin>` skill_status alongside `available` and `not-yet-authored`

**Quick reference — the 5 HETS scripts:**

| Script | Purpose | Key subcommands |
|--------|---------|-----------------|
| `tree-tracker.js` | Persists the spawn graph for a HETS run | `spawn`, `complete`, `bfs`, `dfs`, `status` |
| `contract-verifier.js` | Runs functional + anti-pattern checks; supports `--skip-checks` for tier-aware verification | (single CLI; no subcommands) |
| `pattern-recorder.js` | Appends results to `~/.claude/agent-patterns.json` (per-persona aggregate) | `record`, `stats`, `list` |
| `agent-identity.js` | Per-identity assignment + reputation + tier policy | `assign`, `assign-challenger`, `tier`, `recommend-verification`, `list`, `stats`, `record`, `init` |
| `kb-resolver.js` | Content-addressed KB resolver with snapshot semantics | `cat`, `hash`, `list`, `resolve`, `scan`, `snapshot`, `register` |

For deep architecture details, current phase status, and what's planned next: see [skills/agent-team/SKILL.md](skills/agent-team/SKILL.md). For the deferred-work catalog: [skills/agent-team/BACKLOG.md](skills/agent-team/BACKLOG.md).

---
