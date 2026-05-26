# Prompt Enrichment — Always Active (best-effort)

## Sub-Agent Awareness

When delegating to sub-agents, always use the enriched prompt — not the raw input. Sub-agents lack conversation context.

<important if "task involves user-prompt-vagueness handling">

## When vague (workflow steps)

1. Check the library `prompt-patterns` stack at `~/.claude/library/sections/toolkit/stacks/prompt-patterns/` (legacy `~/.claude/prompt-patterns.json` is a symlink post-migration) for recognized patterns
2. If pattern found with 5+ approvals: auto-apply, show one-line summary, proceed
3. If pattern found with fewer approvals: show enriched prompt, ask "Look right?"
4. If no pattern: activate the prompt-enrichment skill for the full 4-part build

If the deterministic UserPromptSubmit hook (`prompt-enrich-trigger.js`) injects a forcing instruction, you must follow it.

</important>

For substrate-internal architecture (vagueness detection criteria + skip-pattern catalog + hook wiring), see `swarm/architecture-substrate/prompt-enrichment-architecture.md`. Per ADR-0005 slopfiles authoring discipline, the substrate-meta description was migrated out of always-on rules to reduce session context tax.
