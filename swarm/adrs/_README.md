# Architecture Decision Records (ADRs)

Substrate primitive (H.8.2). Durable artifacts capturing significant architectural decisions: what was decided, why, what trade-offs were accepted, and what invariants must hold.

## Why ADRs (vs prose docs)

Per `architecture/discipline/trade-off-articulation.md`: every significant architectural decision sacrifices something. ADRs make sacrifices explicit, durable, and reviewable. Six months later, when someone questions a decision, the ADR explains why — including the sacrifice that was acceptable at the time.

ADRs differ from pattern docs:

- **Pattern docs** (`kb/architecture/`) describe canonical concepts (SRP, DIP, idempotency). They're external knowledge.
- **ADRs** capture *this substrate's specific decisions* (e.g., "we use fail-open hooks because..."). They're internal evidence.

ADRs reference pattern docs (via `related_kb`); pattern docs may cite ADRs as substrate-specific examples (the `Substrate examples` sections in pattern docs).

## File structure

```text
swarm/adrs/
├── _README.md          (this file)
├── _TEMPLATE.md        (canonical format)
├── 0001-substrate-fail-open-hook-discipline.md
├── 0002-...
└── NNNN-short-title.md
```

Naming: `NNNN-imperative-short-title.md` where NNNN is zero-padded 4-digit ID, monotonically incrementing.

## Frontmatter (machine-readable fields)

```yaml
---
adr_id: 0001                        # 4-digit ID; matches filename prefix
title: "Short imperative title"
status: proposed | accepted | superseded | deprecated
created: 2026-05-08
author: 04-architect.theo           # persona/identity or human name
superseded_by: null                 # or NNNN if superseded
files_affected:                     # for drift detection (see below)
  - path/to/file.js
invariants_introduced:              # what must remain true
  - "Concise statement"
related_adrs: []
related_kb: []
---
```

## Lifecycle

1. **proposed** — ADR drafted; not yet in effect
2. **accepted** — ADR approved; implementation can/has happened
3. **superseded** — replaced by another ADR (set `superseded_by`)
4. **deprecated** — no longer applies; not replaced

Active ADRs are those with status `accepted` AND `superseded_by` is null.

## CLI (adr.js)

```bash
# Create new ADR (auto-increments ID)
node scripts/agent-team/adr.js new --title "Adopt fail-open hooks"

# List ADRs (default: all; --status filter available)
node scripts/agent-team/adr.js list
node scripts/agent-team/adr.js list --status accepted

# Read specific ADR
node scripts/agent-team/adr.js read 0001
node scripts/agent-team/adr.js read 1     # leading zeros optional

# List currently active ADRs (status=accepted, not superseded)
node scripts/agent-team/adr.js active
```

## Drift detection (validate-adr-drift.js)

The PreToolUse:Edit|Write hook reads active ADRs at every Edit/Write attempt. If the file being edited appears in any active ADR's `files_affected` list, the hook emits the `[ADR-DRIFT-CHECK]` forcing instruction (Class 1 advisory, per Convention G):

- Lists matched ADR(s) with their invariants
- Asks Claude to verify the change preserves invariants
- If invariants must change, suggests updating the ADR first

This is awareness, not enforcement. Claude reads + decides. Bypass via `SKIP_ADR_CHECK=1` env var.

The 9th forcing instruction in the family (post-H.7.27 had 8; this brings it to 9; cap rule N=15 still has headroom).

## When to write an ADR

Per Convention G's discipline (and the trade-off-articulation pattern doc):

- ✅ **Significant architectural decisions** — module boundaries, data flow, cross-team coupling, framework adoption
- ✅ **Decisions that lock in a trade-off** — irreversible-ish choices where future readers will want to know why
- ✅ **Decisions affecting multiple files** — `files_affected` is meaningful
- ✅ **Decisions introducing invariants** — properties the system must preserve

- ❌ Local-only decisions (function naming, single-file refactor) — overkill
- ❌ Trivial decisions (which library to use for date formatting) — usually no
- ❌ Tactical decisions that will be revisited soon — defer to drift-note instead

When in doubt: if you find yourself wanting to remember why something is the way it is, that's an ADR signal.

## Relationship to drift-notes

| | ADRs | Drift-notes |
|---|------|-------------|
| Purpose | Document significant decisions | Capture observed deviations / deferred work |
| Lifecycle | Long-lived (years) | Short-lived (resolved next phase) |
| Status | proposed/accepted/superseded/deprecated | open/closed |
| Scope | Architectural | Tactical |
| Drift detection | Yes (substrate hook) | No |

The two complement each other. Drift-notes catch the small things; ADRs anchor the big things.

## Phase

Shipped: H.8.2 (post-soak runtime work; v1.5.0 → v1.6.0).

Sets up:

- HETS spawn flow integration: architect persona writes ADR for routed work; subsequent spawns receive active ADRs in kb_scope (later phase)
- ADR query in `adr.js`: filter by tag, by file, by invariant (later phase if useful)
- Auto-generated index in `swarm/adrs/INDEX.md` (later phase if useful)
