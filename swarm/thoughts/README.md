# thoughts/

Per-project persistent memory for the Research → Plan → Implement (RPI) workflow. Adopted in H.8.6 from [humanlayer/advanced-context-engineering-for-coding-agents](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents) (Dex Horthy / HumanLayer). See `skills/agent-team/patterns/research-plan-implement.md` for the canonical doctrine and adoption rationale.

## Layout

```
thoughts/
├── shared/
│   ├── research/   # Documentary research artifacts — neutral codebase mapping
│   │              # Filename: YYYY-MM-DD-<description>.md
│   │              # Produced by /research; consumed by /plan
│   └── plans/      # Implementation plans with phases + checkboxes
│                  # Filename: YYYY-MM-DD-<phase-tag>-<description>.md
│                  # Produced by /plan; consumed by /implement
└── README.md       # This file
```

## Why `thoughts/` is tracked, not gitignored

This is per-project durable memory across sessions. Power-loom has historically tracked architectural decisions (`swarm/adrs/`), pattern catalogs (`skills/agent-team/patterns/`), and phase findings; thoughts/ is the operational layer below those — the working artifacts of how a phase was reasoned through. Tracking them:

- Gives future spawns access to prior research without re-doing the work (Anthropic's "memory across tasks and sessions" pattern)
- Preserves the chain of evidence for auditability (chaos honesty-auditor.quinn-class checks)
- Lets `kb-resolver` and `architecture-relevance-detector` extend their corpus over time as research accumulates

## Lifecycle

| Phase | Files | Created by | Consumed by |
|-------|-------|------------|-------------|
| Research | `shared/research/YYYY-MM-DD-X.md` | `/research` slash command + documentary personas (14/15/16) | `/plan` reads as input |
| Plan | `shared/plans/YYYY-MM-DD-tag-X.md` | `/plan` slash command + critic personas (architect, code-reviewer) | `/implement` reads as input |
| Implement | (in-place edits to plan checkboxes) | `/implement` slash command + builder personas | Final state when all `[x]` |

## Anti-patterns

- **Don't put critique in research files.** Research is descriptive ("here's how X works"), not prescriptive ("X should change"). The documentary persona contracts (14/15/16) explicitly forbid critique language. If the research surfaces something that needs critique, capture it as a follow-up question for the plan phase, not as a verdict in the research artifact.
- **Don't skip the plan phase to "save time."** Per ace-fca.md: *"a bad line of research → thousands of bad lines of code; a bad line of plan → hundreds of bad lines of code; a bad line of code is a bad line of code."* The plan phase is where human review has the highest leverage.
- **Don't recreate research that already exists.** Before invoking `/research` on a topic, search `shared/research/` for prior artifacts. The thoughts-locator pattern (humanlayer canonical) does this; power-loom currently relies on the user/agent doing it manually until tooling is added.

## Cap / hygiene

No automated cleanup yet. Stale artifacts can be marked with frontmatter `status: superseded` (mirrors ADR lifecycle convention). Active artifacts should remain readable; superseded artifacts can be archived to a future `shared/archive/` dir if the directory grows large.
