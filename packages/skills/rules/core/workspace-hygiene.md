# Workspace Hygiene — Always Active

Transient artifacts (session snapshots, plan drafts, slash-command outputs, pre-compact handoffs) accumulate over time. Without active management they degrade workspace navigability + obscure the actually-canonical artifacts.

## Convention — `lifecycle` frontmatter

New transient artifacts should declare their intended retention via frontmatter:

```yaml
---
lifecycle: ephemeral
# OR
archive-after: 2026-06-15
# OR (default; no declaration needed)
lifecycle: persistent
---
```

| Value | Meaning |
|---|---|
| `ephemeral` | OK to archive once mtime > 14 days |
| `archive-after: <YYYY-MM-DD>` | OK to archive after that date |
| `persistent` (or absent) | Keep indefinitely |

**Examples**:
- Pre-compact handoff snapshots → `lifecycle: ephemeral`
- TDD-treatment phase checkpoint snapshots → `lifecycle: ephemeral`
- Honesty-audit volumes → `lifecycle: persistent` (or omit; default)
- Active plan files → omit (persistent until phase completes)
- ADRs → omit (canonical historical record)

## Discipline at session-end / pre-compact

When wrapping a substantial session OR preparing for compaction:

1. Run `node scripts/scan-stale-artifacts.js` (or `--json` for machine-readable output)
2. Review the candidate list
3. Archive or delete stale files (`mv` to `_archive/` subdir for reversibility; `rm` later when comfortable)
4. The scanner emits debt level: **CLEAN** (0), **LOW** (1-10), **MEDIUM** (11-20), **HIGH** (>20)
5. **At HIGH or MEDIUM**: do not start substantial new work without addressing; the accumulation degrades context navigability

## Default-archive locations

Per convention:

| Stack | Active dir | Archive dir |
|---|---|---|
| library session-snapshots | `~/.claude/library/sections/toolkit/stacks/session-snapshots/volumes/` | `volumes/_archive/` |
| library honesty-audit | `~/.claude/library/sections/toolkit/stacks/honesty-audit/volumes/` | (kept; rarely archived) |
| repo plans | `packages/specs/plans/` | `packages/specs/plans/_archive/` (use `git mv`) |
| ~/.claude/plans (slash-command outputs) | `~/.claude/plans/` | `~/.claude/plans/_archive/` |

## What NOT to archive

- `mempalace-fallback.md` (canonical library volume; legacy path symlinks to it)
- `README.md` files at stack/dir roots
- Any file the scanner flags as `keep-always` (see `SCAN_TARGETS` in scanner source)
- Honesty-audit volumes (append-only empirical record)
- Drift-taxonomy + ghost-protocol artifacts

## Tied to Ghost Protocol Component E

See `library/sections/toolkit/stacks/ghost-protocol/volumes/drift-taxonomy.md` for the workspace-hygiene watchdog. The scanner bumps `drift:workspace-hygiene-debt` when stale-count ≥ 10. At 3+ convergence, the auto-loop surfaces a session-start reminder.

## When this rule does NOT apply

- Repositories that bring their own retention policy (e.g., `bench/runs/` has its own archive cadence)
- One-off scratch files explicitly marked `lifecycle: ephemeral` AND younger than 14 days (still ephemeral; not yet stale)
- Files under active modification (mtime within the last 24 hours)
