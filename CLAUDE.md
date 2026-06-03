# CLAUDE.md — Power Loom (signpost, not memory)

This repo deliberately has **no monolithic CLAUDE.md**: operating instructions are
decomposed into predicate-gated rule files (ADR-0005), and evolving project state lives
in auto-curated memory. This file is a **router** — it points at where things live and
holds no state, so it can't go stale. (If you came here looking for "the memory file",
it's the MEMORY.md row below.)

## Where to look

| For… | Look at | Notes |
|---|---|---|
| current state — "where are we" | `~/.claude/projects/<project-hash>/memory/MEMORY.md` | auto-memory; the `## Current status — START HERE` block is the cold-read entry point; the pre-compact hook re-curates it each session |
| always-on operating discipline | `~/.claude/rules/toolkit/**/*.md` | injected every session. **Edit the SOURCE `packages/skills/rules/core/*.md`, NOT the installed copy** (install clobbers it) → sync with `bash install.sh --rules` |
| canonical design record | `packages/specs/{adrs,rfcs,plans}/` + `docs/{ARCHITECTURE,ROADMAP}.md` | ADRs/RFC = immutable/canonical; docs = live status |
| the actual guarantees | `packages/kernel/hooks/` | the enforced layer — everything else (rules/skills/agents) is best-effort instruction-following |

## Toolkit conventions (detail lives in the rules + MEMORY above)

- **Merges are the USER's gate** — never auto-merge; branch, PR, let the user merge. Never cache-hotfix the plugin (fix source; ship on `claude plugin update`).
- **Pre-push gate**: `bash install.sh --hooks --test` (→ all green) **and** the full kernel + runtime suites green.
- **Substrate work** follows the per-wave workflow: plan → architect VERIFY → TDD build → multi-lens VALIDATE → PR.
- **Before spawning a team**: `node packages/kernel/algorithms/route-decide.js --task "…"`.
