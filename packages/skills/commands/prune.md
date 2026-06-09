# Prune — Curate Memory, Rules, Skills, Agents, Library

Reclaim budget and remove decay across MEMORY, rules, skills, agents, and the library. For MEMORY the primary operation is **compression** — move historical detail to the pointer the entry already cites — not deletion.

## When to run

`/prune` is the **manual, deeper** pass; it does NOT replace the automation that already runs:

- the **PreCompact hook** auto-re-curates `MEMORY.md` each compaction (the routine pass);
- **`scan-stale-artifacts.js`** + the workspace-hygiene rule flag stale plan/snapshot files on their own (>=14-day) cadence.

Reach for `/prune` when `MEMORY.md` is **over its hard limit** (its tail stops loading on a cold read) or you want an explicit cross-surface audit. If nothing is over budget and the scanner is CLEAN, say so and stop — do not invent work.

## Step 0 — Pre-flight (deterministic; run FIRST so the audit is evidence-driven, not guessed)

```bash
# MEMORY budget — the usual trigger. Hard limit ~24.4 KB (24986 B); over it, the tail truncates.
wc -c ~/.claude/projects/<project-hash>/memory/MEMORY.md
# Stale transient artifacts (plans, snapshots) + the debt level.
node ~/Documents/claude-toolkit/scripts/scan-stale-artifacts.js
# Library volume sizes + last-modified per stack.
node ~/Documents/claude-toolkit/scripts/library.js stats
```

Carry the numbers into the audit: file-size-vs-limit sets the **target bytes to reclaim**; the scanner output is the stale-file list; `library stats` last-modified is the ONLY access signal available — there is **no per-entry invocation log**, so do not flag "unused" as if one exists.

## Step 1 — Audit MEMORY (the usual acute target)

Read the whole `MEMORY.md` and flag, grounded in Step 0:

- **Stale** — entries contradicting current practice, or about work now shipped/merged (verify via `gh`/git, not memory).
- **Redundant** — duplicates, or a line that merely points at another (current) block.
- **Compressible** — RELEASED/HISTORICAL phase blocks whose blow-by-blow already lives in a close-volume / wave-plan / snapshot the entry links to. Keep the load-bearing *nugget*; move the prose to the pointer.

MEMORY + library volumes live under `~/.claude/` and are **edited in place** (no repo source — they are correctly local).

## Step 2 — Audit Rules

Audit the installed `~/.claude/rules/toolkit/` for the live state, but **edit the SOURCE** at `packages/skills/rules/**` (the installed copy is a `cp` that `install.sh` clobbers). Flag rules that duplicate each other, conflict, or are over-specific (demote -> memory). The core predicate-block count has a ceiling (T76 = 14) — prefer bundling over new blocks.

## Step 3 — Audit Agents & Skills

List the source `packages/agents/` + `packages/skills/`. Flag overlapping scope or one-off forges. Without an invocation log, "unused" is a judgment from catalog/snapshots, not a metric — label it as such. **Edit the source**, never the installed/cached copy.

## Step 4 — Audit Library volumes

From Step 0's `library stats` + `library ls toolkit/<stack>`: superseded session-snapshots (phase RELEASED) are archive candidates, but honor the workspace-hygiene **>=14-day** rule first. Move to the stack's `_archive/` (reversible) — do not delete.

## Step 5 — Present (categorized, with byte-impact)

- 🔴 **Remove** — stale / redundant / duplicate.
- 🟠 **Compress** — historical detail -> its existing pointer (the main MEMORY operation; show the nugget kept).
- 🟡 **Demote** — over-specific rule -> memory entry.
- 🟢 **Keep** — load-bearing / current.

Show estimated bytes per item and the projected total (e.g. `MEMORY 26.6 KB -> ~23.9 KB`). **One batched confirmation** is enough for a compression run; per-item approval is required only for irreversible deletes of distinct artifacts. Wait for the go.

## Step 6 — Execute + verify (the success metric)

Apply the approved edits, then **report the outcome — do not assume it**:

- `wc -c ~/.claude/projects/<project-hash>/memory/MEMORY.md` after (the SAME absolute path as Step 0, so the pre/post numbers are comparable) -> bytes reclaimed + **under/over the limit** (re-run a trim if still over).
- Confirm load-bearing nuggets survived: grep the specific tokens, but loosen the pattern first — markdown bold/backticks (`**E11**`, `` `checkWithinRoot` ``) cause grep false-negatives that look like losses.
- For rules / skills / agents the change is a repo edit -> branch -> PR -> user merge -> ships on `claude plugin update` / `install.sh`. Never hotfix the installed or plugin-cache copy.
