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

**H.4.1 era — since narrowed (2026-05-30)**: capture + consolidation originally ran automatically at multiple breakpoints. The **frequency-capture arm was RETIRED** (path/command frequency proved a poor proxy for promotable patterns); what remains automatic is prompt-pattern capture, the pre-compact consolidation scan, and auto-memory/snapshots. `/self-improve` is the primary triage + promotion surface.

### 1. Capture (Automatic, multi-trigger)
- **Stop hook** (every assistant turn): `auto-store-enrichment.js` captures `[ENRICHED-PROMPT-START]` markers into the prompt-pattern store. (Its per-signal frequency counters were RETIRED 2026-05-30 — see the retirement note in the script; candidates now come from session-end review + snapshots.)
- **Auto-memory** records patterns in `MEMORY.md` during sessions (existing).
- **Library session-snapshots** capture verbatim session content via pre-compact hooks (v2.1.0+; see `docs/library.md`).
- **Forged agents/skills** accumulate personality over time (existing).

### 2. Consolidate (Automatic at compaction)
- **PreCompact hook**: `pre-compact-save.js` triggers a best-effort `self-improve-store.js scan` at compaction — the natural "session in retrospect" moment. (The former every-30th-turn Stop-hook scan was retired with frequency capture.)
- **Thresholds** (applied by the store when scanned):
  - Signal observed ≥5 times → queued as candidate for approval
  - Signal observed ≥10 times AND risk = `low` → **auto-graduated** (logged to `~/.claude/checkpoints/observations.log`, no user action needed)
- **Risk taxonomy**:
  - `low` (auto-graduate): observation-log, memory-consolidation
  - `medium` (always prompt): skill-candidate (forge a new skill)
  - `high` (always prompt): rule-candidate (Memory → Rule), agent-evolution

### 3. Approve (Explicit, queue-driven)
- The session-start reminder hook (`session-self-improve-prompt.js`) exists on disk but is **NOT registered** in `hooks.json` (retired with frequency capture) — pending candidates do NOT surface automatically. Inspect the queue explicitly via `/self-improve` or the CLI.
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
Read ~/.claude/rules/toolkit/   (the installed LIVE state — read here, edit at the source)
Are any rules outdated?
Are there gaps — patterns we follow but haven't codified?
```

### 3. Promote
When a pattern is proven (recurring, successful, stable), edit the **SOURCE** tree, never the installed `~/.claude/` copy (install clobbers it; an installed-copy edit is an unreviewed hotfix):

**Memory → Rule**: Move from `MEMORY.md` to the source rules tree `packages/skills/rules/{category}/`
- The pattern becomes permanent guidance, not a memory entry
- Frees memory capacity for new observations
- Ships to the installed `~/.claude/rules/toolkit/{category}/` via `bash install.sh --rules` after the PR merges

**Pattern → Skill**: Convert a recurring multi-step workflow into a skill
- Write the source at `packages/skills/library/{name}/SKILL.md`; it goes live via branch → PR → user merge → `claude plugin update` / `install.sh`
- Optionally write a forge-provenance volume to `toolkit/decisions/` in the library for cross-session searchability

**Pattern → Agent**: When a domain needs persistent expertise
- Use the Skill Forge to create a specialized agent at the repo root `agents/{name}.md` (the source of truth; the installed `~/.claude/agents/` copy is a build artifact)
- Embed accumulated personality directly in the agent's `.md` file (library volumes provide cross-session context)

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
