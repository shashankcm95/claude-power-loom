# Substrate Architecture — Auto-Loop Infrastructure (H.4.1+)

**Type**: substrate-internal architecture documentation (sibling to `swarm/path-reference-conventions.md`; lightweight institutional decision-record shape).

**Status**: active (codifies H.4.1 auto-loop substrate as deployed; HT.1.13 migrated this content out of `rules/core/self-improvement.md` per ADR-0005 slopfiles authoring discipline — this content is informational substrate-meta, not active discipline; lives here so it's available for reference without consuming always-on session context).

**Audience**: substrate maintainers + Claude Code sessions explicitly working on the auto-loop machinery (hooks, store scripts, self-improve workflow). Not auto-loaded into session context.

## Why this lives at `swarm/architecture-substrate/` not `kb/architecture/`

Per ADR-0005 invariant 2: KB (`skills/agent-team/kb/architecture/`) is for canonical software-engineering knowledge (DIP, SRP, idempotency, error-handling-discipline) — external concepts any senior architect recognizes. Substrate-meta documentation describes how THIS toolkit works internally — institutional architecture, not external knowledge. The `swarm/` namespace is the substrate-internal home; `swarm/path-reference-conventions.md` (HT.1.10) established the precedent.

## Auto-loop infrastructure overview

The self-improvement loop runs **automatically** via 3 hook integrations — `/self-improve` is reserved for explicit triage + Memory→Rule promotion (the load-bearing stuff). The hooks deterministically capture, consolidate, and surface candidates.

| Layer | Hook | Trigger | Behavior |
|-------|------|---------|----------|
| Capture | `auto-store-enrichment.js` | Stop (every turn) | Bumps per-signal counters in `~/.claude/self-improve-counters.json` |
| Consolidation | `auto-store-enrichment.js` | Stop (every 30th turn) | Triggers `self-improve-store scan` if turns since last scan ≥30 |
| Consolidation | `pre-compact-save.js` | PreCompact | Same scan at compaction (catches both short + long sessions) |
| Approval | `session-self-improve-prompt.js` | UserPromptSubmit (first prompt of session) | Injects pending queue as a single batched reminder; idempotent within session |

## Threshold-based auto-promotion

Mirrors prompt-pattern-store's 5+-approval auto-apply:

- Signal observed ≥5 times → queued candidate (needs approval)
- Signal observed ≥10 times AND risk = `low` → auto-graduated, logged to `~/.claude/checkpoints/observations.log`
- Risk taxonomy: low (auto), medium (prompt), high (always prompt — Memory→Rule, agent-evolution)

## CLI surface (queue inspection + manual action)

```bash
node ~/.claude/scripts/self-improve-store.js pending           # human-readable list
node ~/.claude/scripts/self-improve-store.js promote --id X    # execute (low-risk only)
node ~/.claude/scripts/self-improve-store.js dismiss --id X    # discard
```

For medium/high-risk promotions (skill forge, Memory→Rule, agent rewrite), invoke `/self-improve` for the full review workflow — those need explicit human reasoning, not just a CLI flag.

## Pre-Compact awareness substrate

The PreCompact hook also triggers a self-improve consolidation scan deterministically. The Claude-side intelligent work is interpretation (qualitative session-end review); the bookkeeping is deterministic (counter bumps + scan triggers).

When context is approaching limit:
- Save key decisions and patterns to MEMORY.md
- Store in MemPalace MCP (if available)
- Fallback: write to `~/.claude/checkpoints/mempalace-fallback.md`

## Forging procedure substrate

When forging is approved (medium-risk; explicit human approval), the skill-forge skill provides the full creation workflow. Auto-promotion handles low-risk Memory→Rule promotions (≥10 observations + risk: low); medium and high-risk always require explicit prompt review.

## Source phase mapping

- H.4.1 — closed self-learning loop trigger gap (auto-store + threshold + approval queue layers)
- H.5.0+ — `prompt-pattern-store` 5+ approval auto-apply mirror
- H.6+ — pattern-recorder integration with persona-tier-aware verification
- H.8.6 — RPI doctrine adoption (research → implement); separate concern but same authoring source

## Related substrate primitives

- `prompt-enrichment-architecture.md` (sibling substrate-arch doc) — vagueness detection hook architecture
- ADR-0001 — substrate hooks fail-open invariants (auto-store-enrichment.js conforms)
- ADR-0003 — institutional commitment to enforce ADR-0001 at code-review gate
- ADR-0005 — slopfiles authoring discipline (this doc's reason-for-existing)
