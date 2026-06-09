---
name: self-improve
description: Continuously evolve the toolkit by promoting proven patterns from session memory to permanent rules, and by forging new skills from recurring workflows. Triage queue for low/medium/high-risk candidates with explicit user approval gates for load-bearing promotions.
---

# Self-Improvement Loop — Memory to Rules Pipeline

Continuously evolve the toolkit by promoting proven patterns from session memory to permanent rules, and by forging new skills from recurring workflows.

## The Loop

```
Work → Capture (auto, multi-trigger) → Consolidate (auto, threshold-based) → Approve (batched, session-scoped) → Promote → Enforce
```

**H.4.1 update**: capture + consolidation + low-risk graduation now run **automatically** at multiple natural breakpoints. The user no longer has to invoke `/self-improve` to keep the loop alive — but the command still works for on-demand triage and explicit Memory→Rule promotion.

### 1. Capture (Automatic, multi-trigger)
- **Stop hook** (every assistant turn): `auto-store-enrichment.js` bumps per-signal counters in `~/.claude/self-improve-counters.json` (file paths, slash commands, skill invocations). Cheap, deterministic, no LLM.
- **Auto-memory** records patterns in `MEMORY.md` during sessions (existing).
- **Library session-snapshots** capture verbatim session content via pre-compact hooks (v2.1.0+; see `docs/library.md`).
- **Forged agents/skills** accumulate personality over time (existing).

### 2. Consolidate (Automatic, threshold-based)
- **Every 30th turn** (Stop hook): triggers `self-improve-store.js scan` if turns since last scan ≥30. Catches sessions that never compact.
- **PreCompact hook**: same scan triggers at compaction. Heavier review at the natural "session in retrospect" moment.
- **Thresholds**:
  - Signal observed ≥5 times → queued as candidate for approval
  - Signal observed ≥10 times AND risk = `low` → **auto-graduated** (logged to `~/.claude/checkpoints/observations.log`, no user action needed)
- **Risk taxonomy**:
  - `low` (auto-graduate): observation-log, memory-consolidation
  - `medium` (always prompt): skill-candidate (forge a new skill)
  - `high` (always prompt): rule-candidate (Memory → Rule), agent-evolution

### 3. Approve (Batched, session-scoped)
- **UserPromptSubmit hook** (`session-self-improve-prompt.js`): on the FIRST prompt of each session, reads `~/.claude/checkpoints/self-improve-pending.json`; if non-empty, injects ONE batched reminder listing pending candidates. Idempotent within a session.
- User approves specific IDs, dismisses some, or invokes `/self-improve` for full triage:
  ```
  node ~/.claude/packages/kernel/spawn-state/self-improve-store.js promote --id <cand-id>
  node ~/.claude/packages/kernel/spawn-state/self-improve-store.js dismiss --id <cand-id>
  ```
- Auto-graduated entries are informational (already executed); they appear in the reminder for transparency.

### 4. Review (On Demand — `/self-improve`)
The full triage workflow stays available for explicit invocation. Now reads the same pending queue plus does the broader analysis:

**Check auto-memory:**
```
Read the project's MEMORY.md
Identify patterns that appear 2+ times
Flag stale entries that no longer apply
```

**Check library session-snapshots + decisions:**
```
library ls toolkit/session-snapshots  # recurring patterns across sessions
library ls toolkit/decisions          # forged agents/skills successes/failures
grep across narrative volumes for conventions that emerged organically
```

**Check existing rules:**
```
Read ~/.claude/rules/toolkit/
Are any rules outdated?
Are there gaps — patterns we follow but haven't codified?
```

### 3. Promote
When a pattern is proven (recurring, successful, stable):

**Memory → Rule**: Move from `MEMORY.md` to `~/.claude/rules/toolkit/{category}/`
- The pattern becomes permanent guidance, not a memory entry
- Frees memory capacity for new observations

**Pattern → Skill**: Convert a recurring multi-step workflow into a skill
- Write to `~/.claude/skills/{name}/SKILL.md`
- Optionally write a forge-provenance volume to `toolkit/decisions/` in the library for cross-session searchability

**Pattern → Agent**: When a domain needs persistent expertise
- Use the Skill Forge to create a specialized agent
- Embed accumulated personality directly in the agent's `.md` file (the agent file is the source of truth; library volumes provide cross-session context)

### 4. Prune
Remove what's no longer useful:
- Stale memory entries that contradict current practices
- Rules that duplicate other rules
- Skills/agents that haven't been used in weeks
- Demote overly-specific rules back to memory

## Commands

| Command | Action |
|---------|--------|
| `/self-improve` | Full review cycle: scan memory + pending queue, identify promotions, suggest changes |
| `/forge` | Create a new agent or skill on the fly (delegates to Skill Forge) |
| `/evolve {agent}` | Update an existing agent with new learnings |
| `/prune` | Remove stale entries from memory and rules |

### Direct CLI for the auto-loop store (H.4.1)

| Command | Action |
|---------|--------|
| `node ~/.claude/packages/kernel/spawn-state/self-improve-store.js stats` | Counter + queue summary (debugging) |
| `node ~/.claude/packages/kernel/spawn-state/self-improve-store.js pending` | List pending + auto-graduated candidates |
| `node ~/.claude/packages/kernel/spawn-state/self-improve-store.js scan` | Force a consolidation pass (normally automatic) |
| `node ~/.claude/packages/kernel/spawn-state/self-improve-store.js promote --id <id>` | Execute low-risk promotion (medium/high need /self-improve) |
| `node ~/.claude/packages/kernel/spawn-state/self-improve-store.js dismiss --id <id>` | Mark a candidate dismissed |
| `node ~/.claude/packages/kernel/spawn-state/self-improve-store.js reset` | Wipe counters + queue (test fixture only) |

## Quality Gates

Before promoting anything:
- Has the pattern appeared in 2+ separate sessions?
- Did it lead to successful outcomes when followed?
- Is it general enough to apply beyond one specific project?
- Does it conflict with existing rules?

## Integration with library substrate (v2.1.0+)

The library at `~/.claude/library/` is the cross-session memory backbone:

- **Session snapshots** (`sections/toolkit/stacks/session-snapshots/`): verbatim session content captured by `pre-compact-save.js` SAVE_PROMPT
- **Decisions** (`sections/toolkit/stacks/decisions/`): forge/evolve provenance + ADR-style records
- **Catalog** (`_catalog.json` per stack): topic + entities + last-modified + content_hash for searchable index
- **CLI**: `node ~/Documents/claude-toolkit/scripts/library.js ls toolkit/<stack>` + `library read <vol>` + `library stats`

See `docs/library.md` for the full Section/Stack/Catalog/Volume reference.
