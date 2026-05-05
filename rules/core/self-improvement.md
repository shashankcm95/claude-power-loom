# Self-Improvement — Always Active

## Auto-loop infrastructure (H.4.1)

The self-improvement loop runs **automatically** via 3 hook integrations — you don't need to invoke `/self-improve` to keep the system learning. The hooks deterministically capture, consolidate, and surface candidates; `/self-improve` is now reserved for explicit triage + Memory→Rule promotion (the load-bearing stuff).

| Layer | Hook | Trigger | Behavior |
|-------|------|---------|----------|
| Capture | `auto-store-enrichment.js` | Stop (every turn) | Bumps per-signal counters in `~/.claude/self-improve-counters.json` |
| Consolidation | `auto-store-enrichment.js` | Stop (every 30th turn) | Triggers `self-improve-store scan` if turns since last scan ≥30 |
| Consolidation | `pre-compact-save.js` | PreCompact | Same scan at compaction (catches both short + long sessions) |
| Approval | `session-self-improve-prompt.js` | UserPromptSubmit (first prompt of session) | Injects pending queue as a single batched reminder; idempotent within session |

**Threshold-based auto-promotion** (mirrors prompt-pattern-store's 5+-approval auto-apply):
- Signal observed ≥5 times → queued candidate (needs approval)
- Signal observed ≥10 times AND risk = `low` → auto-graduated, logged to `~/.claude/checkpoints/observations.log`
- Risk taxonomy: low (auto), medium (prompt), high (always prompt — Memory→Rule, agent-evolution)

## Gap Detection

Watch for these signals during work (observe silently, batch for session end):
- A multi-step workflow that no existing skill covers → forge candidate
- A pattern repeated from previous sessions → rule promotion candidate
- An agent or skill that feels outdated → evolve candidate
- Uncertainty about an API or library → research mode applies

**Throttle**: Do NOT interrupt mid-task with forge/promotion suggestions. The hook layer collects them silently into the auto-loop store; you'll see batched candidates at the next session start.

Exception: If a missing agent/skill would materially change the current task's outcome, mention it once — briefly — then continue working.

## Session-End Review

At the end of substantial work sessions, briefly note (one or two sentences max):
- Patterns that recurred
- Forge/evolve candidates observed
- Rules followed but not yet codified

The auto-loop already captures recurrence counts; your review is the qualitative layer on top of the deterministic layer.

## Pre-Compact Awareness

When context is getting large, proactively save key decisions and patterns to MEMORY.md. If MemPalace MCP is available, store there too. If unavailable, write to `~/.claude/checkpoints/mempalace-fallback.md`.

The PreCompact hook also triggers a self-improve consolidation scan deterministically — your work here is the LLM-only intelligent part (interpretation), not the bookkeeping.

## Forging Procedure

When forging is approved, follow the skill-forge skill for the full creation workflow.

## Reading the queue

If the SessionStart reminder shows pending candidates, you can inspect / act on them:

```bash
node ~/.claude/scripts/self-improve-store.js pending           # human-readable list
node ~/.claude/scripts/self-improve-store.js promote --id X    # execute (low-risk only)
node ~/.claude/scripts/self-improve-store.js dismiss --id X    # discard
```

For medium/high-risk promotions (skill forge, Memory→Rule, agent rewrite), invoke `/self-improve` for the full review workflow — those need explicit human reasoning, not just a CLI flag.
