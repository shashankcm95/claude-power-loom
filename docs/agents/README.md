# Agents — Specialist Layer

19 Agent-tool persona definitions (`agents/*.md`), 17 HETS persona bodies, and 19 persona contracts; all with persistent named identities. The 3-layer split (`agents/*.md` → `packages/runtime/personas/NN-*.md` → `packages/runtime/contracts/*.contract.json`) is intentional — the `agents/` file is the spawn-by-name definition, the persona body is the identity brief, and the contract declares skills / kb-scope / verification checks.

- [Agents overview](overview.md)

## Source

- Agent-tool personas: [`agents/*.md`](../../agents/) — 19 definitions (architect, code-reviewer, hacker, honesty-auditor, security-auditor, optimizer, planner, and the domain builders / codebase-investigators)
- HETS persona bodies: [`packages/runtime/personas/*.md`](../../packages/runtime/personas/) — 17 numbered persona briefs (`NN-*.md`)
- HETS contracts: [`packages/runtime/contracts/*.contract.json`](../../packages/runtime/contracts/) — 19 contracts (skills + kb-scope + per-persona output verification)
- Identity registry: `~/.claude/agent-identities.json` (gitignored runtime state)

> Up: [docs/](..)
