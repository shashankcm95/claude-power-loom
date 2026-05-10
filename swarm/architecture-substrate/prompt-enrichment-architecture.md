# Substrate Architecture — Prompt Enrichment Hook Architecture

**Type**: substrate-internal architecture documentation (sibling to `swarm/path-reference-conventions.md`; lightweight institutional decision-record shape).

**Status**: active (codifies prompt-enrichment substrate as deployed; HT.1.13 migrated this content out of `rules/core/prompt-enrichment.md` per ADR-0005 slopfiles authoring discipline — this content is informational substrate-meta, not active discipline; lives here so it's available for reference without consuming always-on session context).

**Audience**: substrate maintainers + Claude Code sessions explicitly working on the prompt-enrichment machinery (hooks, prompt-pattern-store, vagueness detection). Not auto-loaded into session context.

## Why this lives at `swarm/architecture-substrate/` not `kb/architecture/`

Per ADR-0005 invariant 2: KB (`skills/agent-team/kb/architecture/`) is for canonical software-engineering knowledge — external concepts any senior architect recognizes. Substrate-meta documentation describes how THIS toolkit works internally — institutional architecture, not external knowledge. Sibling shape with `swarm/path-reference-conventions.md` (HT.1.10) and `swarm/architecture-substrate/auto-loop-infrastructure.md` (HT.1.13).

## Vagueness Detection Gate

The deterministic UserPromptSubmit hook (`prompt-enrich-trigger.js`) evaluates **every** user prompt for vagueness — regardless of conversation continuity. When flagged, the hook injects a forcing instruction. Whether Claude follows it is best-effort instruction-following (see README §"What this toolkit is NOT"). The auto-store hook then captures the result deterministically when Claude does produce the markup — closing the loop on the deterministic side.

**A prompt is vague if it lacks specifics about**:
- **Clear task** — what specifically to do
- **Scope** — which files, components, or boundaries
- **Constraints** — what to avoid, what standards to follow
- **Expected output** — what the result should look like

**Vagueness is the only criterion.** Follow-up status, conversation context, and prior agreements do NOT bypass enrichment. If the prompt itself is unclear, enrich it.

## Skip patterns (deterministic via hook)

The hook handles these skip patterns deterministically — no enrichment fires:

- Slash commands (`/review`, `/plan`, etc.)
- Confirmation responses ("yes", "approve", "go ahead", "no", "cancel")
- Direct commands with clear scope ("run the tests", "commit this", "git push")
- Informational questions ("what does X do?", "where is Y defined?", "how does Z work?")
- Show/explain requests ("show me X", "explain Y")
- Prompts with explicit file paths or specific entities (`src/Button.tsx`, `MyClass`, `someFunction()`)

If the hook injects a forcing instruction for a non-skipped vague prompt, Claude must follow it.

## Pattern-store auto-apply substrate

When vague prompts ARE detected, Claude's enrichment workflow consults the `prompt-patterns` MemPalace room (or `~/.claude/prompt-patterns.json` fallback) for recognized patterns:

1. Pattern found with **5+ approvals**: auto-apply, show one-line summary, proceed
2. Pattern found with **fewer approvals**: show enriched prompt, ask "Look right?"
3. **No pattern**: activate the prompt-enrichment skill for the full 4-part build

The 5+-approval auto-apply mirrors the auto-loop's `≥5 → queued candidate` threshold (per `swarm/architecture-substrate/auto-loop-infrastructure.md`).

## Hook architecture wiring

| Hook | Event | Phase | File path |
|------|-------|-------|-----------|
| `prompt-enrich-trigger.js` | UserPromptSubmit | first prompt of turn | `hooks/scripts/prompt-enrich-trigger.js` |
| `auto-store-enrichment.js` | Stop | every turn (counter bump + every-30th-turn scan trigger) | `hooks/scripts/auto-store-enrichment.js` |
| `prompt-pattern-store.js` | (CLI subcommand) | invoked by Claude during enrichment workflow | `scripts/prompt-pattern-store.js` |

Per ADR-0001 fail-open invariants: all hooks fail-soft on errors (try/catch + logger + decision: approve). Vagueness detection failure does NOT block the user prompt — it just skips enrichment.

## Source phase mapping

- H.4.1 — closed self-learning loop trigger gap (substrate for auto-store-enrichment integration with prompt-pattern-store)
- H.5.0 — prompt-pattern-store stable + 5+-approval auto-apply
- H.7.x — vagueness criteria refinement based on session observations

## Related substrate primitives

- `auto-loop-infrastructure.md` (sibling substrate-arch doc) — auto-store + consolidation + approval queue layers
- ADR-0001 — substrate hooks fail-open invariants (prompt-enrich-trigger conforms)
- ADR-0003 — institutional commitment to enforce ADR-0001 at code-review gate
- ADR-0005 — slopfiles authoring discipline (this doc's reason-for-existing)
