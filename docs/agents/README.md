# Agents — Specialist Layer

5 generic engineering personas + 16 HETS personas (5 auditors + 8 builders + 3 codebase-investigators) + 2 templates (challenger + engineering-task) = 18 persona contracts; all with persistent named identities.

- [Agents overview](overview.md)

## Source

- Generic agents: [`agents/*.md`](../../agents/) — architect, code-reviewer, planner, optimizer, security-auditor
- HETS personas: [`swarm/personas/*.md`](../../swarm/personas/) — 16 personas (5 auditors + 8 builders + 3 codebase-investigators)
- HETS contracts: [`swarm/personas-contracts/*.contract.json`](../../swarm/personas-contracts/) — 18 contracts (16 personas + challenger + engineering-task templates); output verification per persona
- Identity registry: `~/.claude/agent-identities.json` (gitignored runtime state)

> Up: [docs/](..)
