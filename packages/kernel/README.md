# @power-loom/kernel

**Loom Kernel layer** — maps to v4 substrate synthesis §2 Layer 1.

Pure-function gates. MAJOR-bump-protected. Has **no dependencies** on other workspace packages — `_lib/` lives here precisely to keep that invariant true (resolved a kernel→runtime DAG violation surfaced during architect Round-1 of the Phase 0 plan).

## What lives here

- `hooks/{pre,post,lifecycle}/` — 28 hooks split by category (PreToolUse / PostToolUse / SessionStart-Stop-PreCompact-UserPromptSubmit)
- `hooks/_lib/` — kernel-internal hook utilities (`_log.js`, `file-path-pattern.js`)
- `_lib/` — shared utility consumed by both kernel hooks and runtime orchestration (`atomic-write`, `lock`, `frontmatter`, `toolkit-root`, etc.)
- `validators/` — all gate validators including `contract-verifier`
- `algorithms/` — kernel algorithm library (`route-decide.js`, future K11)
- `gc/` — process tier + spawn tier garbage collection
- `recall/` — `loom-recall.js`
- `spawn-state/` — `spawn-record.js`, `self-improve-store.js`, `prompt-pattern-store.js`
- `schema/` — marketplace + plugin-manifest JSON schemas
- `worktree/` — K1 integration helpers (v3.0-alpha)
- `enforcement/` — K12 + K13 (v3.0-alpha)
- `hooks.json` — hook registration manifest

## What does NOT live here

- Persona-specific logic → `packages/runtime/`
- Adaptive cognition → `packages/lab/`
- User-facing skills → `packages/skills/`
- Specs / RFCs / ADRs → `packages/specs/`
