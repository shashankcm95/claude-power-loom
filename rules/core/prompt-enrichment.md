# Prompt Enrichment — Always Active

## Vagueness Detection Gate

The deterministic UserPromptSubmit hook (`prompt-enrich-trigger.js`) evaluates **every** user prompt for vagueness — regardless of conversation continuity. When flagged, the hook injects a forcing instruction that you must follow.

**A prompt is vague if it lacks specifics about**:
- **Clear task** — what specifically to do
- **Scope** — which files, components, or boundaries
- **Constraints** — what to avoid, what standards to follow
- **Expected output** — what the result should look like

**Vagueness is the only criterion.** Follow-up status, conversation context, and prior agreements do NOT bypass enrichment. If the prompt itself is unclear, enrich it.

## Skip enrichment only for:
- Slash commands (`/review`, `/plan`, etc.)
- Confirmation responses ("yes", "approve", "go ahead", "no", "cancel")
- Direct commands with clear scope ("run the tests", "commit this", "git push")
- Informational questions ("what does X do?", "where is Y defined?", "how does Z work?")
- Show/explain requests ("show me X", "explain Y")
- Prompts with explicit file paths or specific entities (`src/Button.tsx`, `MyClass`, `someFunction()`)

The hook handles these skip patterns deterministically. If the hook injects a forcing instruction, you must follow it.

## When vague:
1. Check MemPalace `prompt-patterns` room (or `~/.claude/prompt-patterns.json` fallback) for recognized patterns
2. If pattern found with 5+ approvals: auto-apply, show one-line summary, proceed
3. If pattern found with fewer approvals: show enriched prompt, ask "Look right?"
4. If no pattern: activate the prompt-enrichment skill for the full 4-part build

## Sub-Agent Awareness
When delegating to sub-agents, always use the enriched prompt — not the raw input. Sub-agents lack conversation context.
