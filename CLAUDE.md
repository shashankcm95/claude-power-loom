# CLAUDE.md — Power Loom (signpost, not memory)

This repo deliberately has **no monolithic CLAUDE.md**: operating instructions are
decomposed into predicate-gated rule files (ADR-0005), and evolving project state lives
in auto-curated memory. This file is a **router/index** — it maps where things live and
their *treatment* (location-stable facts only, never state), so it can't go stale. The
detail for any directory lives in that directory's own `README.md`; this is the index over
them. (Looking for "the memory file"? It's the MEMORY.md row below.)

## State + discipline (how to operate the repo)

| For… | Look at | Notes |
|---|---|---|
| current state — "where are we" | `~/.claude/projects/<project-hash>/memory/MEMORY.md` | auto-memory; the `## Current status — START HERE` block is the cold-read entry point; the pre-compact hook re-curates it each session |
| always-on operating discipline | `~/.claude/rules/toolkit/**/*.md` | injected every session. **Edit the SOURCE `packages/skills/rules/core/*.md`, NOT the installed copy** (install clobbers it) → sync with `bash install.sh --rules` |
| the enforced guarantees | `packages/kernel/hooks/` | the ONLY enforced layer — everything else (rules / skills / agents) is best-effort instruction-following |

## The code substrate (where to edit)

| Tier | Look at | What |
|---|---|---|
| kernel (enforced) | `packages/kernel/` | hooks + primitives: `hooks/`, `algorithms/` (route-decide), `spawn-state/` (integrator, stage-candidate), `_lib/` (record-store, transaction-record), `validators/`, `enforcement/` |
| runtime (orchestration) | `packages/runtime/` | HETS: `orchestration/`, `personas/` (19 bodies), `contracts/` (21), `decomposition/`, `verify/` — best-effort |
| lab (Evolution Lab) | `packages/lab/` | the v3.x advisory/shadow experiment substrate: `attribution/`, `reputation/`, `circuit-breaker/`, `manage-proposal/`, `verdict-attestation/`, … |
| rules + commands + skills SOURCE | `packages/skills/` | `rules/core/*.md` (the always-on discipline source — see above), `commands/*.md` (15 slash commands), `library/**/SKILL.md` (21 skills) |
| Agent-tool persona defs | `agents/*.md` (19) | the personas the Agent tool spawns (architect, code-reviewer, hacker, …). The 3-layer split `agents/*.md` → `runtime/personas/NN` → `contracts/*.contract.json` is **INTENTIONAL — don't "dedup" it** |
| tests | `tests/unit/{kernel,runtime,lab,hooks,agents}/` | the unit suites; the full kernel suite + `install.sh --hooks --test` are the pre-push gate |

## Canonical records

| Type | Look at | Treatment |
|---|---|---|
| ADRs / RFCs | `packages/specs/{adrs,rfcs}/` | **immutable / canonical** — supersede via a NEW doc, never rewrite an accepted one |
| living per-wave plans | `packages/specs/plans/**` | **NOT immutable** — in-place updates ARE the workflow (a plan accretes `## Runtime Probes` / `## Pre-Approval Verification` / `## VALIDATE result` / `## Phase-close sign-off` as each wave completes). Don't treat a plan edit as an immutability violation or push it to `docs/`. (Mirrors `.coderabbit.yaml`; detail in `packages/specs/plans/README.md`.) |
| live project status | `docs/{ARCHITECTURE,ROADMAP}.md` | human-facing live status |
| orchestration run-state | `swarm/run-state/<run-id>/` | live + resumable HETS run state |

## Toolkit conventions (detail lives in the rules + MEMORY above)

- **Merges are the USER's gate** — never auto-merge; branch, PR, let the user merge. Never cache-hotfix the plugin (fix source; ship on `claude plugin update`).
- **Pre-push gate**: `bash install.sh --hooks --test` (→ all green) **and** the full kernel + runtime suites green.
- **Substrate work** follows the per-wave workflow: plan → architect VERIFY → TDD build → multi-lens VALIDATE → PR.
- **Before spawning a team**: `node packages/kernel/algorithms/route-decide.js --task "…"`.
