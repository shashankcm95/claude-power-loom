# Prompt Enrichment — Structured Prompt Builder

Transform vague user prompts into structured, actionable prompts that reduce miscommunication and produce better outcomes. Uses a 4-part framework with technique selection.

## When This Activates

Called by the `prompt-enrich-trigger.js` UserPromptSubmit hook, which injects a `[PROMPT-ENRICHMENT-GATE]` instruction into Claude's context whenever a user prompt is classified as vague.

## Step 0: Look up existing patterns FIRST

Before building a new enrichment, check if a similar pattern is already stored. Run:

```bash
node ~/.claude/scripts/prompt-pattern-store.js lookup --raw "<raw user prompt>"
```

This returns JSON. Behavior depends on `bestMatch` and `bestMatchTier`:
- `bestMatch.score >= 0.8` AND `bestMatchTier == "Independent"` (5+ approvals) → silently apply the stored enrichment, show only a one-line summary like *"Using your established pattern for {category} (5+ approvals)."* Skip steps 1–4.
- `bestMatch.score >= 0.8` AND `bestMatchTier == "Trusted"` (3–4 approvals) → show one-line summary, auto-proceed unless user objects.
- `bestMatch.score >= 0.8` AND `bestMatchTier == "Familiar"` (1–2 approvals) → show stored enrichment, ask "Look right?"
- No match (or score < 0.8) → continue to Step 0.5 (and Step 1) to build a new enrichment with conversation context.

## Step 0.5: Read prior conversation context (H.7.5)

Before classifying or building, sample the **last 1-3 turns** of the conversation. The motivating event: H.7.4's task description ("Empirical refit of weighted_trust_score weights from accumulated verdict data") scored 0 in `route-decide.js` because the routing signal lived in the **prior assistant turn**, not the bare user prompt. Vague follow-ups frequently strip the signal that disambiguates the request.

**Bound the sample** (per the user's H.7.5 directive — "we don't need the whole context, the last one or maybe 2-3 responses"):

- Read the transcript at `~/.claude/projects/<project-id>/<session-id>.jsonl` (paths inferable from `cwd`)
- Extract the **last 2 user messages + last 2 assistant responses** (max 4 turns total)
- Cap at ~2K chars per turn; ~8K chars total. Strip tool-call blocks if present (keep assistant prose).

**Why bounded**: full-conversation reads burn context for diminishing returns. The signal that disambiguates a vague follow-up is almost always in the immediately-preceding turn (a recommendation, a plan, a decision). Three turns covers one full back-and-forth + a follow-up — sufficient for ~95% of cases.

**Use the context for**:
1. **Routing**: when calling `route-decide.js`, ALWAYS pass `--context "<last assistant excerpt>"` so the gate's keyword heuristic also scans the prior recommendation. Per H.7.5, context contributions are weighted at 0.5x of task contributions, and a borderline-promotion rule fires when bare-task is low-signal but context has ≥0.10 raw score.
2. **Disambiguation**: if the bare prompt is vague but the prior turn made a concrete recommendation (e.g., "next phase is X via orchestration"), enrich with that recommendation as INPUT/CONTEXT in Step 2.
3. **Continuation detection**: if the user says "go on" / "continue" / "yes do that", the entire enrichment is the prior turn's recommendation. Skip Steps 1-4 and execute the recommendation directly.

**Skip Step 0.5 when**:
- This is the first turn of a new session (no prior context exists)
- The prompt is itself unambiguous (specific files, specific verbs, clear scope)
- The pattern lookup in Step 0 already returned a high-confidence match

## Step 1: Classify and Select Techniques

Analyze the raw prompt and select the appropriate prompting techniques:

| User Intent | Technique | Why |
|-------------|-----------|-----|
| Reasoning-heavy task (debug, architect, optimize) | **Chain of Thought** | Forces step-by-step reasoning, reduces errors |
| Format-sensitive output (API design, schema, config) | **Few-Shot** | Examples anchor the expected shape |
| Task with known failure modes | **Negative Prompting** | "Do NOT do X" prevents repeat mistakes |
| Task needing project context | **RAG** | Pull from MemPalace, MEMORY.md, or local files |
| Simple unfamiliar task | **Zero-Shot** | Clear instructions suffice without examples |

Multiple techniques can combine. Chain-of-thought + negative prompting is common for debugging.

## Step 2: Build the 4-Part Prompt

Structure the enriched prompt with these sections:

### Instructions
- What specifically to do (verb + object + qualifier)
- How to approach it (technique-specific framing)
- What constraints apply
- What NOT to do (negative prompting, drawn from past corrections if available)

### Context
- Relevant project background (from MEMORY.md, MemPalace, or conversation)
- Related files and their purposes (quick Glob/Grep to identify)
- Architectural patterns in use
- Previous decisions that affect this task

### Input Data
- Specific files, components, or code sections involved
- Error messages, logs, or symptoms if debugging
- Requirements or specifications if building
- Reference implementations or examples if available

### Output Indicator
- Expected deliverable type (code, plan, review, explanation, config)
- Format constraints (language, framework patterns, file structure)
- Quality criteria (tests required? docs? backward compatible?)
- Scope boundaries (which files to touch, which to leave alone)

## Step 3: Size Check and Summary

If the enriched prompt exceeds ~500 words:
- Show a **summary view** (one sentence per section, ~4 lines total)
- Indicate: "Full enriched prompt is [N] words. Showing summary. Say 'show full' to see everything."

If under 500 words, show the full enriched prompt.

## Step 4: Present for Review

Show the enriched prompt to the user using the **deterministic markup** below (the `auto-store-enrichment.js` Stop hook parses these markers to auto-store the pattern — don't skip the markers):

```
📋 Enriched Prompt:

[ENRICHED-PROMPT-START]
RAW: <original user prompt verbatim>
CATEGORY: <refactor|bugfix|feature|review|docs|other>
TECHNIQUES: <comma-separated, e.g. chain-of-thought,rag>
INSTRUCTIONS: <what to do, how, constraints>
CONTEXT: <relevant background pulled from project>
INPUT: <specific files/data involved>
OUTPUT: <expected deliverable and format>
[ENRICHED-PROMPT-END]

Approve, modify, or say "just do it" to skip enrichment.
```

**Important**: the START/END markers MUST be on their own lines. The auto-store hook parses by line — embedded markers in a sentence won't trigger storage.

### User Responses
- **Approve** (yes, looks good, go ahead): Execute the enriched prompt. The Stop hook auto-stores it.
- **Modify** (change X to Y, also include Z): Apply changes. Show updated version with markers. Re-present.
- **Skip** ("just do it", "skip"): Execute raw prompt as-is. The Stop hook detects no markers and doesn't store.

## Step 5: Storage (automatic — no action required from Claude)

When you produce the `[ENRICHED-PROMPT-START]...[ENRICHED-PROMPT-END]` markup in your response, the **`auto-store-enrichment.js` Stop hook** automatically:
1. Detects the marker pair in your output
2. Parses the structured fields (RAW, CATEGORY, TECHNIQUES, INSTRUCTIONS, etc.)
3. Calls `node ~/.claude/scripts/prompt-pattern-store.js store ...` with the parsed values
4. Writes to `~/.claude/prompt-patterns.json` (the canonical local store)

This means: **showing the enriched prompt with proper markup IS the storage trigger.** You don't need to call the CLI manually.

The CLI handles approval-count incrementing: similar prompts (≥0.6 Jaccard similarity) merge into one entry; the count bumps automatically across sessions.

**Optional**: if MemPalace MCP is available, you can also call `mcp__mempalace__store_memory` for cross-machine semantic search — but the local JSON is the source of truth.

## Step 6: Execute

Run the enriched prompt through the normal Claude workflow:
- If the task maps to an existing agent (planner, code-reviewer, etc.), delegate with the enriched prompt
- If it's direct work, proceed with the structured context
- The enriched prompt becomes the working context — not the raw input

## Confidence Tiers

The system gains independence through approval accumulation:

| Tier | Approval Count | Behavior |
|------|---------------|----------|
| **Learning** | 0 | Full enrichment shown, must approve |
| **Familiar** | 1–2 | Enrichment shown with "Looks right?" confirmation |
| **Trusted** | 3–4 | One-line summary shown, auto-proceeds after 3s |
| **Independent** | 5+ | Silent enrichment, no confirmation needed |

User can always override: "show me the prompt" forces full display regardless of tier.

## Example

**Raw prompt**: "fix the login"

**Enriched prompt**:
- **Instructions**: Debug and fix the login authentication flow. Use chain-of-thought reasoning to trace the failure path. Do NOT modify the OAuth provider configuration or change the session storage mechanism.
- **Context**: Project uses Auth.js v5 with GitHub OAuth. Auth config is at `src/lib/auth.ts`. Session management uses JWT strategy. Recent MEMORY.md notes mention a redirect loop issue after OAuth callback.
- **Input**: `src/lib/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/middleware.ts`, browser console errors if available.
- **Output**: Fixed authentication code with explanation of root cause. Include test for the fix. Preserve backward compatibility with existing sessions.
