# thoughts/shared/research/

Documentary research artifacts produced by the `/research` slash command (H.8.6+). See `swarm/thoughts/README.md` for the broader RPI lifecycle.

## Filename convention

```
YYYY-MM-DD-<description>.md
```

Optional ticket prefix when relevant: `YYYY-MM-DD-PHASE-X.Y-<description>.md` (e.g., `2026-05-09-H.8.7-extractsections-fence-blindness-mapping.md`).

## Required frontmatter

```yaml
---
date: YYYY-MM-DDThh:mm:ssTZ
researcher: <persona.identity or "root">
git_commit: <sha at research time>
branch: <branch name>
repository: power-loom
topic: "<question being researched>"
tags: [research, codebase, ...component-names]
status: complete | in-progress | superseded
last_updated: YYYY-MM-DD
last_updated_by: <persona.identity or "root">
---
```

## Content discipline (per documentary persona contract)

- **Describe what exists** — file paths, function purposes, data flow, component interactions
- **Cite file:line for every claim**
- **Do NOT critique** — no "should be", "anti-pattern", "needs refactoring" language
- If research surfaces something that warrants critique, capture it as a **follow-up question for the plan phase**, not as a verdict in the research artifact

If the research uncovered something the documentary persona contracts (14/15/16) reject as "critique territory", note it under a `## Follow-up questions for plan phase` heading at the bottom of the research doc — it becomes input to the next phase, not contamination of this one.
