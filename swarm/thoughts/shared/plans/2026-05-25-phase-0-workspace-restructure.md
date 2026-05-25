# Phase 0 — Workspace Restructure (v2 — architect-review absorbed)

**Status**: post-architect-pair-review revision. v1 preserved at `2026-05-25-phase-0-workspace-restructure-v1.md`.
**Created**: 2026-05-25
**Origin**: sister-Claude draft → same-session critique → v1 plan → architect pressure-test (3 CRITICAL + 8 HIGH + 6 MEDIUM + 3 LOW found) → v2 absorbs findings
**Predecessor**: v4 substrate synthesis at `swarm/thoughts/shared/design/v3.3-substrate-synthesis.md`
**Successor**: Phase 2 v3.0-alpha implementation lands in restructured packages
**Phase**: phase-0-pre-substrate

## 0. Why Phase 0 — and what changed v1→v2

Per architect Round-1 of this plan:

**v1 was wrong about sequencing**: claimed Phase 0 must precede Wave -1 because "probe results don't map to actual implementation paths." Architect correctly identified that Wave -1 probes test Anthropic-native primitive behavior (does `PreToolUse(Agent).updatedInput` rewrite? does `isolation: "worktree"` allocate?) — none of these reference repo paths. Wave -1 is protocol-orthogonal to repo layout.

**v2 sequencing**: Wave -1 FIRST (cheap, ~6-9h, protocol-only) → Phase 0 SECOND (mechanical move, ~8-15h, contingent on Wave -1 PASS).

**v1 was wrong about DAG cleanliness**: declared "kernel has NO deps on other packages." Empirically false — current kernel hooks (`fact-force-gate.js`, `session-self-improve-prompt.js`, etc.) import `scripts/agent-team/_lib/{atomic-write, lock, frontmatter, toolkit-root}.js`. Under v1's map these `_lib/*` files moved to runtime, creating a kernel→runtime backward edge.

**v2 fix**: introduce `packages/kernel/_lib/` for shared utility. ~20 require statements rewrite (NOT pure `git mv` — explicit semantic edit acknowledged).

**v1 migration map was ~60% complete**: 8+ top-level dirs unmapped (`agents/`, `bench/`, `rules/`, `docs/`, `swarm/personas/`, `swarm/schemas/`, `swarm/adrs/`, `swarm/architecture-substrate/`, `swarm/kb-architecture-planning/`, root scripts, `.github/workflows/`).

**v2 migration map**: complete per §5 below.

**v1 effort was 2-3× optimistic**: 4-5h. Architect calibration anchored to Phase 1 reality projected 8-15h.

**v2 effort**: 8-15h (with caveat that DAG-violation refactor is semantic, not mechanical).

## 1. Context (unchanged from v1)

The v4 substrate synthesis established a **three-layer architecture** (Loom Kernel / Loom Runtime / Loom Evolution Lab) + a transverse Docs/KB tier. The current repository has these tiers conceptually but they're flat-organized: `hooks/`, `scripts/`, `swarm/`, `skills/`, `tests/`, plus top-level `agents/`, `bench/`, `rules/`, `docs/`. Layer boundaries are not enforced by tooling.

**Why restructure** (after Wave -1 PASS):
1. v3.0-alpha will add ~900-1,300 LoC of new kernel code in a structured layout
2. v4 K12 layer-enforcer needs a filesystem boundary
3. Architect Round-3 of v4 flagged "unenforced layer separation is cosmetic labeling"

## 2. Goals & Non-Goals

### Goals

1. Establish **5 internal package boundaries** inside the existing repo using pnpm workspaces (`kernel / runtime / lab / skills / specs`)
2. Align package names with v4 three-layer architecture (kernel/runtime/lab) + cross-cutting skills + transverse specs (renamed from `docs/` to disambiguate from top-level user-facing `/docs/`)
3. Preserve plugin distributability — single `claude-power-loom` plugin via existing `.claude-plugin/`
4. Preserve all smoke/unit test coverage (zero regression)
5. Provide filesystem boundary for v4 K12 layer-enforcer
6. Make future repo split a `git filter-repo` operation

### Non-Goals

1. Physical repo split — deferred until forcing functions appear
2. Plugin distribution model change — still one plugin, one install path
3. Renaming public APIs — internal moves only
4. **Move-don't-change discipline EXCEPT** for the documented `_lib/*` refactor (acknowledged semantic edit; ~20 require statements rewrite)
5. Multi-harness support — kernel stays Anthropic-bound for v3.x
6. CI infrastructure replacement
7. Tooling change beyond pnpm workspaces
8. v4 K12 layer-enforcer implementation (v3.0-alpha proper — Phase 0 provides the boundary; v3.0-alpha enforces)

## 3. Tier Definitions (v4-Aligned; architect-absorbed)

### `packages/kernel/` — Loom Kernel layer

**Maps to v4 §2 Layer 1**. Pure-function gates; MAJOR-bump-protected.

**Contents**:
- All hooks (`hooks/{pre,post,lifecycle}/`)
- **All validators** including contract-verifier (NOT under personas)
- **Shared utility (`_lib/`)** — atomic-write, lock, frontmatter, toolkit-root, file-path-pattern, _log (NEW v2 — resolves DAG violation)
- GC subsystems (`gc/`)
- Recall-CLI (`recall/`)
- Spawn-record machinery (`spawn-state/`) + self-improve-store + prompt-pattern-store
- Schemas (`schema/`) — marketplace + plugin-manifest JSON schemas (NEW v2)
- Future K11 kernel algorithm library (`algorithms/`)
- Future K12 + K13 enforcement (`enforcement/`)
- `hooks.json`

**Exclusions**: no persona-specific logic; no Lab adaptive cognition; no user-facing skills; no specs.

**Versioning**: `@power-loom/kernel` strict semver.

### `packages/runtime/` — Loom Runtime layer

**Maps to v4 §2 Layer 2**. HETS + decomposition + personas.

**Contents**:
- 16 persona contracts (`contracts/*.contract.json`)
- 16 persona briefs (`personas/*.md`) — NEW v2 mapping (was missing from v1)
- Capability traits (`traits/`) — v3.1
- Persona contract schema (`schema/`)
- HETS orchestration scripts (`orchestration/`) — formerly `scripts/agent-team/` MINUS the `_lib/*` files (those moved to kernel/_lib/)
- Pattern A trampoline + decomposition discipline + spawn-verify dispatcher + test-runner adapters (NEW v3.2 deliverables)

**Exclusions**: no kernel hooks; no kernel `_lib/*`; no Lab cognition; no skills.

**Versioning**: `@power-loom/runtime` per-RFC semver.

### `packages/lab/` — Loom Evolution Lab layer

**Maps to v4 §2 Layer 3**. Adaptive cognition; experimental; PATCH-iterable.

**Contents** (all v3.3+ deliverables; Phase 0 creates the empty home):
- Negative attestation, policy-axioms, reputation, attribution, convergence, evolve, review, circuit-breaker

**Exclusions**: NO direct kernel-path writes (K12 enforces). NO direct runtime gating (advisory only).

**Filesystem-read pattern (architect HIGH absorbed)**: Lab writes to `~/.claude/library/sections/toolkit/policy-axioms/`. Kernel reads from this path via K4 recall-CLI through A6 snapshot mechanism — NOT a static import. K12 design must explicitly permit filesystem reads of `~/.claude/library/sections/toolkit/**` from kernel iff A6 snapshot interposes. This is NOT a static-analysis rule; K12 must encode it as a runtime invariant or path-pattern allowlist.

**Versioning**: `@power-loom/lab` PATCH-iterable. NEVER promoted to kernel without ADR.

### `packages/skills/` — User-facing skill layer

**Cross-cuts Runtime + Kernel via plugin shell**. Not a v4 layer per se.

**Contents**:
- All skills (`library/typescript/`, `library/react/`, etc.)
- Slash commands (`commands/`)
- Rules (`rules/`) — NEW v2 mapping (8 .md files installed to `~/.claude/rules/toolkit/`; not skills or specs structurally but plugin-shipped guardrails)

**Exclusions**: no kernel hooks; no persona contracts; no algorithm libraries.

**Versioning**: `@power-loom/skills` per skill-batch ship.

### `packages/specs/` — Specifications + research (renamed from `docs/` to disambiguate)

**v4 transverse Docs/KB tier**. Append-only reference material.

**Architect-recommended rename**: was `docs/` in v1; renamed to `specs/` to avoid collision with top-level `/docs/` (user-facing project documentation).

**Contents**:
- RFCs (`rfcs/`)
- ADRs (`adrs/`) — includes existing `swarm/adrs/*`
- Phase plans (`plans/`)
- Spike write-ups (`spikes/`)
- Architecture substrate research (`architecture-substrate/`) — NEW v2 mapping
- KB architecture planning (`kb-architecture-planning/`) — NEW v2 mapping
- Findings (`findings/`) — NEW v2 mapping for `swarm/H.*-findings.md` + `CS-*-findings.md`
- Bench scenarios + comparison (`bench/`) — NEW v2 mapping (top-level `/bench/` moves here as research artifact)
- Library section references (paths only; library itself stays at user-state location)

**Library/sections location DECIDED (B option)**: `~/.claude/library/sections/` is user-state-shaped, not repo-shaped. Stays at user-state location. Recall-CLI is config-driven.

**Exclusions**: no code; no persona contracts; no skills.

**Versioning**: not versioned; append-only.

### REPO ROOT (stays as-is)

**Architect HIGH absorbed**: `agents/*.md` likely belongs at repo-root `/agents/` if Anthropic plugin spec requires (verification needed before commit). Same logic for top-level `/docs/` (user-facing project documentation distinct from `packages/specs/`).

**Top-level items staying at repo root**:
- `/agents/*.md` (18 files — Task-tool spawn entry points; Anthropic-resolved)
- `/docs/*.md` (~25 files — user-facing project documentation)
- `/tests/` (cross-cutting; per-package tests live in `packages/*/`)
- `/scripts/` (repo-level tooling: `claude-toolkit-status.sh`, `compliance-probe.sh`, `generate-persona-agents.js`, `library-migrate.js`, `library.js`, `refresh-skill-status.js`)
- `/.claude-plugin/` (plugin manifest)
- `/.github/workflows/` (CI)
- `install.sh`, `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `ATTRIBUTION.md`, `LICENSE`, `CLAUDE.md`
- `package.json`, `pnpm-workspace.yaml`, `.gitignore`

### Total: 5 packages + organized repo root

## 4. Target Directory Structure (complete)

```
claude-power-loom/ (repo root; pnpm workspace root)
├── packages/
│   ├── kernel/                          # @power-loom/kernel
│   │   ├── hooks/
│   │   │   ├── pre/                     # 5 PreToolUse hooks
│   │   │   ├── post/                    # PostToolUse hooks
│   │   │   ├── lifecycle/               # SessionStart, Stop, PreCompact, UserPromptSubmit
│   │   │   └── _lib/                    # _log.js, file-path-pattern.js
│   │   ├── _lib/                        # SHARED UTILITY (NEW v2): atomic-write, lock, frontmatter, toolkit-root
│   │   ├── validators/                  # all gate validators (config-guard, secrets, yaml-frontmatter, schema, etc.)
│   │   ├── algorithms/                  # NEW v3.2: topological_sort, subset_check, etc.
│   │   ├── gc/                          # Process tier + Spawn tier
│   │   ├── recall/                      # loom-recall.js (port from spike)
│   │   ├── spawn-state/                 # spawn-record.js + envelope schema + self-improve-store.js + prompt-pattern-store.js
│   │   ├── schema/                      # marketplace.schema.json + plugin-manifest.schema.json
│   │   ├── worktree/                    # NEW v3.0-alpha
│   │   ├── enforcement/                 # NEW v3.0-alpha: K12 + K13
│   │   ├── hooks.json
│   │   ├── package.json
│   │   └── README.md
│   ├── runtime/                         # @power-loom/runtime
│   │   ├── contracts/                   # 16 .contract.json
│   │   ├── personas/                    # 16 .md persona briefs (NEW v2 mapping)
│   │   ├── traits/                      # v3.1
│   │   ├── schema/                      # contract.schema.json
│   │   ├── orchestration/               # was scripts/agent-team/ MINUS _lib/* (those went to kernel/_lib/)
│   │   ├── decomposition/               # v3.2
│   │   ├── verify/                      # v3.2
│   │   ├── test-runners/                # v3.2
│   │   ├── package.json
│   │   └── README.md
│   ├── lab/                             # @power-loom/lab (v3.3+ fills it)
│   │   ├── (empty subdirs for v3.3/v3.4 deliverables)
│   │   ├── package.json
│   │   └── README.md
│   ├── skills/                          # @power-loom/skills
│   │   ├── library/                     # 30+ skills
│   │   ├── commands/                    # slash commands
│   │   ├── rules/                       # 8 guardrail .md files (NEW v2 mapping)
│   │   ├── package.json
│   │   └── README.md
│   └── specs/                           # @power-loom/specs (RENAMED from v1's docs/)
│       ├── rfcs/
│       ├── adrs/                        # includes existing swarm/adrs/*
│       ├── plans/
│       ├── spikes/
│       ├── architecture-substrate/      # NEW v2 mapping
│       ├── kb-architecture-planning/    # NEW v2 mapping
│       ├── findings/                    # NEW v2: swarm/H.*-findings.md + CS-*-findings.md
│       ├── bench/                       # NEW v2: top-level /bench/ moves here as research artifact
│       └── package.json
├── agents/                              # STAYS at repo root (Anthropic Task-tool resolution)
├── docs/                                # STAYS at repo root (user-facing project documentation)
├── tests/                               # STAYS at repo root (cross-cutting)
├── scripts/                             # STAYS at repo root (repo-level tooling)
├── .claude-plugin/
│   ├── manifest.json                    # references packages/skills/library/* + packages/runtime/contracts/*
│   └── README.md
├── .github/workflows/                   # STAYS at repo root
├── pnpm-workspace.yaml                  # NEW
├── package.json                         # repo root (workspace orchestration)
├── install.sh                           # STAYS at repo root
├── README.md, CHANGELOG.md, etc.       # STAYS at repo root
└── CLAUDE.md                            # STAYS at repo root
```

## 5. Migration Map (COMPLETE — architect CRITICAL absorbed)

### Hooks → packages/kernel/

| Current path | Target path |
|---|---|
| `hooks/scripts/_log.js` | `packages/kernel/hooks/_lib/_log.js` |
| `hooks/scripts/_lib/file-path-pattern.js` | `packages/kernel/hooks/_lib/file-path-pattern.js` |
| `hooks/scripts/validators/*.js` | `packages/kernel/validators/*.js` |
| `hooks/scripts/auto-store-enrichment.js` | `packages/kernel/hooks/lifecycle/auto-store-enrichment.js` |
| `hooks/scripts/config-guard.js` | `packages/kernel/hooks/pre/config-guard.js` |
| `hooks/scripts/contract-reminder-on-agent-spawn.js` | `packages/kernel/hooks/pre/contract-reminder-on-agent-spawn.js` |
| `hooks/scripts/context-size-warn-stop.js` | `packages/kernel/hooks/lifecycle/context-size-warn-stop.js` |
| `hooks/scripts/error-critic.js` | `packages/kernel/hooks/post/error-critic.js` |
| `hooks/scripts/fact-force-gate.js` | `packages/kernel/hooks/pre/fact-force-gate.js` |
| `hooks/scripts/kb-citation-gate.js` | `packages/kernel/hooks/post/kb-citation-gate.js` |
| `hooks/scripts/pre-compact-save.js` | `packages/kernel/hooks/lifecycle/pre-compact-save.js` |
| `hooks/scripts/prompt-enrich-trigger.js` | `packages/kernel/hooks/lifecycle/prompt-enrich-trigger.js` |
| `hooks/scripts/redirect-plan-mode-in-headless.js` | `packages/kernel/hooks/pre/redirect-plan-mode-in-headless.js` |
| `hooks/scripts/route-decide-on-agent-spawn.js` | `packages/kernel/hooks/pre/route-decide-on-agent-spawn.js` |
| `hooks/scripts/session-end-nudge.js` | `packages/kernel/hooks/lifecycle/session-end-nudge.js` |
| `hooks/scripts/session-reset.js` | `packages/kernel/hooks/lifecycle/session-reset.js` |
| `hooks/scripts/session-self-improve-prompt.js` | `packages/kernel/hooks/lifecycle/session-self-improve-prompt.js` |
| `hooks/scripts/spawn-record.js` | `packages/kernel/spawn-state/spawn-record.js` |
| `hooks/scripts/validate-config-redirect.js` | `packages/kernel/validators/validate-config-redirect.js` |
| `hooks/scripts/validators/verify-plan-gate.js` | `packages/kernel/hooks/pre/verify-plan-gate.js` (per architect MEDIUM — it's a PreToolUse hook, not a structural validator) |
| `hooks/hooks.json` | `packages/kernel/hooks.json` |
| `hooks/config-guard-patterns.json` | `packages/kernel/config-guard-patterns.json` |
| `hooks/settings-reference.json` | `packages/kernel/settings-reference.json` |

### Scripts → packages/kernel/ + packages/runtime/

| Current path | Target path |
|---|---|
| `scripts/loom-recall.js` | `packages/kernel/recall/loom-recall.js` |
| `scripts/self-improve-store.js` | `packages/kernel/spawn-state/self-improve-store.js` |
| `scripts/prompt-pattern-store.js` | `packages/kernel/spawn-state/prompt-pattern-store.js` |
| `scripts/agent-team/_lib/atomic-write.js` | **`packages/kernel/_lib/atomic-write.js` (DAG resolution; NEW v2)** |
| `scripts/agent-team/_lib/lock.js` | **`packages/kernel/_lib/lock.js`** |
| `scripts/agent-team/_lib/frontmatter.js` | **`packages/kernel/_lib/frontmatter.js`** |
| `scripts/agent-team/_lib/toolkit-root.js` | **`packages/kernel/_lib/toolkit-root.js`** |
| `scripts/agent-team/route-decide.js` | `packages/kernel/algorithms/route-decide.js` |
| `scripts/agent-team/agent-identity.js` | `packages/runtime/orchestration/agent-identity.js` |
| `scripts/agent-team/spawn-recorder.js` | `packages/runtime/orchestration/spawn-recorder.js` (NOTE: distinct from `kernel/spawn-state/spawn-record.js` — architect MEDIUM flagged this) |
| `scripts/agent-team/*` (all other) | `packages/runtime/orchestration/*` |
| `scripts/claude-toolkit-status.sh` | **STAYS at `/scripts/claude-toolkit-status.sh`** (repo-level tooling) |
| `scripts/compliance-probe.sh` | **STAYS at `/scripts/compliance-probe.sh`** |
| `scripts/generate-persona-agents.js` | **STAYS at `/scripts/generate-persona-agents.js`** (load-bearing build step — generates `agents/*.md` from `swarm/personas/*.md` post-restructure path) |
| `scripts/library-migrate.js` | **STAYS at `/scripts/library-migrate.js`** |
| `scripts/library.js` | **STAYS at `/scripts/library.js`** |
| `scripts/refresh-skill-status.js` | **STAYS at `/scripts/refresh-skill-status.js`** |

### Swarm → packages/runtime/ + packages/specs/

| Current path | Target path |
|---|---|
| `swarm/personas-contracts/*.contract.json` (16) | `packages/runtime/contracts/*.contract.json` |
| `swarm/personas-contracts/contract.schema.json` | `packages/runtime/schema/contract.schema.json` |
| `swarm/personas-contracts/_state-interface-spec.md` | `packages/runtime/schema/_state-interface-spec.md` |
| `swarm/personas/*.md` (16 — NEW v2 mapping) | `packages/runtime/personas/*.md` |
| `swarm/schemas/marketplace.schema.json` | `packages/kernel/schema/marketplace.schema.json` (NEW v2 — kernel validates plugin manifest) |
| `swarm/schemas/plugin-manifest.schema.json` | `packages/kernel/schema/plugin-manifest.schema.json` |
| `swarm/adrs/*.md` | `packages/specs/adrs/*.md` |
| `swarm/thoughts/shared/design/*.md` | `packages/specs/rfcs/*.md` |
| `swarm/thoughts/shared/plans/*.md` | `packages/specs/plans/*.md` |
| `swarm/thoughts/shared/spikes/*.md` | `packages/specs/spikes/*.md` |
| `swarm/architecture-substrate/*` | `packages/specs/architecture-substrate/*` |
| `swarm/kb-architecture-planning/*` | `packages/specs/kb-architecture-planning/*` |
| `swarm/H.*-findings.md` + `CS-*-findings.md` | `packages/specs/findings/*.md` |
| `swarm/SKILL.md`, `orchestrator.md`, `super-agent.md`, `measurement-methodology.md` | `packages/specs/research/*.md` |
| `swarm/test-fixtures/` | `packages/specs/test-fixtures/` (research artifacts) |
| `swarm/aggregate.js`, `hierarchical-aggregate.js` | `packages/runtime/orchestration/aggregate/*.js` |

### Skills + Commands → packages/skills/

| Current path | Target path |
|---|---|
| `skills/*/` (30+) | `packages/skills/library/*/` |
| `commands/*.md` | `packages/skills/commands/*.md` |
| `rules/*.md` (8 — NEW v2 mapping) | `packages/skills/rules/*.md` |

### Bench → packages/specs/

| Current path | Target path |
|---|---|
| `bench/*` (scenarios, run-all.sh, control-runs/, EXPERIMENT-LOG.md, COVERAGE-MAP.md) | `packages/specs/bench/*` (research artifacts — architect MEDIUM absorbed) |

### Stays at repo root (architect HIGH absorbed)

| Path | Reason |
|---|---|
| `agents/*.md` (18 files) | Anthropic Task-tool resolution — `subagent_type` → persona brief (likely requires repo-root location per plugin spec; verify pre-merge) |
| `docs/*.md` (~25 files) | User-facing project documentation (renaming `packages/docs/`→`packages/specs/` disambiguates) |
| `tests/` | Cross-cutting test suite (per-package tests live in `packages/*/`) |
| `scripts/{claude-toolkit-status,compliance-probe,generate-persona-agents,library-migrate,library,refresh-skill-status}.{sh,js}` | Repo-level tooling |
| `.claude-plugin/{manifest,plugin}.json` + `README.md` | Plugin manifest |
| `.github/workflows/*` | CI |
| `install.sh`, `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `ATTRIBUTION.md`, `LICENSE`, `CLAUDE.md` | Repo metadata |
| `package.json`, `pnpm-workspace.yaml`, `.gitignore` | Workspace tooling |

### User state — stays at `~/.claude/`

| Path | Reason |
|---|---|
| `~/.claude/library/sections/*` | User-state-shaped (FIX #5 DECIDED); recall-CLI config-driven |

## 6. Sequencing (CORRECTED v2 — Wave -1 FIRST)

```
Phase 1 (current; done) — Spike Wave A/B/C shipped; Wave D pending
   ↓
Wave D close-out (~30-60 min operator time) — Phase 1 PASS
   ↓
Phase 2 Wave -1 — Entry-Gate Probe (~6-9h; per v4 §6.0a)
   ↓ [empirical PASS on Anthropic-native primitives]
PHASE 0 — Workspace Restructure (THIS PLAN; ~8-15h)
   ↓ [single commit; clean baseline; v4 §6.1 paths now reference packages/]
Phase 2 v3.0-alpha — PURE KERNEL TRANSACTION LOOP (~20-28h)
   ↓
v3.1 → v3.2 → v3.3 → v3.4
```

**Why Phase 0 AFTER Wave -1** (architect HIGH absorbed):
- Wave -1 probes are protocol-level (does Anthropic primitive X work?) — they don't reference repo paths
- Running Wave -1 first is cheaper, lower blast radius
- Wave -1 result may change Phase 0 package shape (e.g., if K8 capability injection fails, `packages/kernel/enforcement/` becomes smaller for v3.0-alpha)
- v1's "Phase 0 first" rationale was factually wrong

**Why Phase 0 is its own phase (not v3.0-alpha Wave 0)**:
- Substrate work adds CODE; restructure moves EXISTING CODE
- Mixing them makes blast-radius reasoning impossible
- Phase 0 has its own pair-review checkpoint
- v3.0-alpha builds on Phase 0's clean baseline

## 7. Migration Sequence (Step-by-Step; architect-revised)

### Step 0 — Branch + safety net (15 min)
```bash
git checkout main
git pull --ff-only
git checkout -b feat/phase-0-workspace-restructure
DATE=$(date +%Y-%m-%d)
git tag pre-workspace-restructure-${DATE}
git push origin pre-workspace-restructure-${DATE}
```
Architect LOW absorbed: `${DATE}` parameterized; not committed with `XX` placeholder.

### Step 1 — Workspace tooling scaffold (30 min)
- Create `packages/{kernel,runtime,lab,skills,specs}` subdirectories + empty subdirs per §4 structure
- Write `pnpm-workspace.yaml`
- Write root `package.json` + per-package `package.json` (5 files)
- Run `pnpm install`
- Verification: `pnpm list -r` shows 5 packages

### Step 2 — Move kernel shared utility FIRST (resolves DAG; 30 min)
**Critical step v2 added per architect CRITICAL-2**:
- `git mv scripts/agent-team/_lib/* packages/kernel/_lib/`
- Update ~20 require statements across kernel hooks: `require('../../scripts/agent-team/_lib/X')` → `require('../_lib/X')` (or appropriate relative path from new hook locations)
- Update require statements in scripts/agent-team/* files that consume `_lib/*` (these will move to runtime/orchestration/ in Step 4; for now ensure they still resolve to `packages/kernel/_lib/`)
- This is the ONLY semantic edit in Phase 0; everything else is `git mv`
- Verification: `node -e "require('./packages/kernel/_lib/atomic-write.js')"` resolves

### Step 3 — Move kernel hooks (60 min)
- `git mv` per §5 migration map: hooks split into `pre/post/lifecycle/` subdirs
- Hook categorization (architect MEDIUM absorbed): per-file in §5 map (NOT "do something reasonable")
- Move kernel-internal `_log.js` + `file-path-pattern.js` to `packages/kernel/hooks/_lib/`
- Move all validators to `packages/kernel/validators/`
- Note: `verify-plan-gate.js` lives under `hooks/pre/` (semantic), NOT `validators/` (architect MEDIUM)
- Verification: each moved file smoke-imports cleanly

### Step 4 — Move kernel recall + spawn-state + schemas (20 min)
- `git mv scripts/loom-recall.js packages/kernel/recall/`
- `git mv scripts/self-improve-store.js packages/kernel/spawn-state/`
- `git mv scripts/prompt-pattern-store.js packages/kernel/spawn-state/`
- `git mv scripts/agent-team/route-decide.js packages/kernel/algorithms/`
- `git mv swarm/schemas/* packages/kernel/schema/`
- Verification: kernel package self-contained (no imports outside kernel)

### Step 5 — Update kernel hooks.json (10 min)
- Update all paths in `packages/kernel/hooks.json` to use `${CLAUDE_PLUGIN_ROOT}/packages/kernel/hooks/...`
- This is the **single edit** (not two — architect MEDIUM absorbed); Step 8 verifies, doesn't re-edit
- Verification: `jq . packages/kernel/hooks.json` validates

### Step 6 — Move runtime (30 min)
- `git mv swarm/personas-contracts/*.contract.json packages/runtime/contracts/`
- `git mv swarm/personas-contracts/contract.schema.json packages/runtime/schema/`
- `git mv swarm/personas-contracts/_state-interface-spec.md packages/runtime/schema/`
- `git mv swarm/personas/*.md packages/runtime/personas/` (NEW v2 mapping)
- `git mv scripts/agent-team/*` (excluding _lib already moved + route-decide already moved) → `packages/runtime/orchestration/`
- `git mv swarm/aggregate.js swarm/hierarchical-aggregate.js packages/runtime/orchestration/aggregate/`
- Update `packages/runtime/orchestration/*` require statements pointing to `packages/kernel/_lib/`
- Verification: `node packages/kernel/validators/contract-verifier.js` passes all 16 contracts at new paths

### Step 7 — Create Lab home (10 min)
- Create `packages/lab/` with empty subdirs per §3
- Write `package.json` (version `0.0.0-empty`) + `README.md`
- Verification: `pnpm list` shows `@power-loom/lab`

### Step 8 — Move skills + rules + commands (30 min)
- `git mv skills/* packages/skills/library/`
- `git mv commands/* packages/skills/commands/`
- `git mv rules/* packages/skills/rules/` (NEW v2 mapping)
- Update `.claude-plugin/manifest.json` paths to `packages/skills/library/*`
- Update `install.sh` paths if `rules/` install target changes
- Verification: plugin discovers skills at new paths

### Step 9 — Move specs (30 min, expanded scope v2)
- `git mv swarm/thoughts/shared/design/* packages/specs/rfcs/`
- `git mv swarm/thoughts/shared/plans/* packages/specs/plans/`
- `git mv swarm/thoughts/shared/spikes/* packages/specs/spikes/`
- `git mv swarm/adrs/* packages/specs/adrs/`
- `git mv swarm/architecture-substrate packages/specs/architecture-substrate`
- `git mv swarm/kb-architecture-planning packages/specs/kb-architecture-planning`
- `git mv swarm/H.*-findings.md swarm/CS-*-findings.md packages/specs/findings/`
- `git mv swarm/{SKILL,orchestrator,super-agent,measurement-methodology}.md packages/specs/research/`
- `git mv swarm/test-fixtures packages/specs/test-fixtures`
- `git mv bench/* packages/specs/bench/`
- Verification: internal markdown links resolve

### Step 10 — Verify plugin manifest + hooks.json + smoke tests (45 min, expanded v2)
- Fresh Claude Code session loads plugin without warnings
- All 23 hooks fire on no-op action
- `pnpm -r test` → 108/108 unit
- `bash tests/smoke-ht.sh` → 116/116 smoke
- `node packages/kernel/validators/contract-verifier.js` → 16/16 contracts pass
- `node packages/kernel/recall/loom-recall.js "test query"` → returns results
- Update ~114 hard-coded test paths (architect MEDIUM corrected: not 20-30)

### Step 11 — Plugin upgrade-over probe (NEW v2; ~30 min — architect HIGH absorbed)
- Install `power-loom@current` (from main) to fresh CLAUDE_HOME
- `/plugin update` to point at restructured branch
- Verify: hooks fire AND skills resolve AND personas spawn AND `agents/*.md` Task-tool resolution still works
- This catches the silent skill-resolution-failure scenario that's distinct from "fresh install"

### Step 12 — Commit + ADR-0009 (30 min)
- Single commit referencing this plan + ADR-0009
- ADR-0009 documents:
  - Rationale (v4 K12 layer-enforcer needs filesystem boundary)
  - The `_lib/*` DAG resolution decision
  - Library/sections stays at user-state location decision
  - `docs/` → `specs/` rename rationale
  - `agents/` stays at repo root rationale

## 8. Plugin Manifest Updates

**Current** (approximate):
```json
{
  "name": "claude-power-loom",
  "skills": ["./skills/typescript", ...],
  "hooks": "./hooks/hooks.json",
  "commands": "./commands"
}
```

**Post-restructure**:
```json
{
  "name": "claude-power-loom",
  "skills": ["./packages/skills/library/typescript", ...],
  "hooks": "./packages/kernel/hooks.json",
  "commands": "./packages/skills/commands"
}
```

## 9. Workspace Tooling

### `pnpm-workspace.yaml`
```yaml
packages:
  - 'packages/*'
```

### Root `package.json`
```json
{
  "name": "claude-power-loom-root",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "test": "pnpm -r test && bash tests/smoke-ht.sh",
    "test:unit": "pnpm -r test",
    "test:smoke": "bash tests/smoke-ht.sh"
  }
}
```

### Per-package: see v1 §9; same pattern.

## 10. Versioning Strategy (architect LOW absorbed)

| Package | Initial version | Rationale |
|---|---|---|
| `@power-loom/kernel` | `0.1.0-alpha.0` | Pre-1.0 internal package; avoids confusion with plugin v2.9.x |
| `@power-loom/runtime` | `0.1.0-alpha.0` | Same |
| `@power-loom/lab` | `0.0.0-empty` | Empty home; v3.3 fills it |
| `@power-loom/skills` | `1.0.0` | Skills mature; clean semver |
| `@power-loom/specs` | unversioned | Append-only |

**Architect LOW absorbed**: starting kernel at `3.3.0-alpha.0` while plugin is `2.9.x` confused version vectors. v2 uses `0.1.0-alpha.0` for internal packages (these are NEW packages structurally; they don't inherit substrate-version). Substrate version (v3.x) is tracked in RFC + plugin manifest, not in internal package versions.

**Plugin version**: independent at `.claude-plugin/plugin.json`. v3.0.0-alpha when v3.0-alpha ships.

**Inter-package deps**:
- kernel has NO deps on other packages (resolved by `_lib/*` move to kernel)
- runtime depends on kernel via `workspace:*`
- lab depends on kernel + runtime
- skills depends on runtime (persona contracts)
- specs has no deps

## 11. Effort Budget (HONEST — architect HIGH absorbed; ~2-3× v1)

| Step | Estimate |
|---|---|
| 0 — Branch + tag | 15 min |
| 1 — Workspace scaffold | 30 min |
| 2 — Move kernel `_lib/` + require refactor | 30 min |
| 3 — Move kernel hooks | 60 min |
| 4 — Move kernel recall + spawn-state + schemas | 20 min |
| 5 — Update hooks.json | 10 min |
| 6 — Move runtime | 30 min |
| 7 — Create Lab home | 10 min |
| 8 — Move skills + rules + commands | 30 min |
| 9 — Move specs (expanded scope) | 30 min |
| 10 — Smoke + unit + path-fix iteration | 45 min |
| 11 — Plugin upgrade-over probe (NEW v2) | 30 min |
| 12 — Commit + ADR-0009 | 30 min |
| Buffer (test failures, discovery, path-fix recursion) | 90-180 min |
| **TOTAL Phase 0 honest** | **~8-13h (with safe upper bound 15h)** |

**LoC moved**: ~10,000-15,000 lines across ~150-200 files.
**Semantic edits (NOT pure `git mv`)**: ~20 require statements in kernel hooks + ~10 in runtime orchestration.
**Path references updated**: ~114 in tests + ~72 in `agents/*.md` + paths in `install.sh`, `.github/workflows/`, `CLAUDE.md`, ~25 cross-links in `/docs/`.

**Honest impact on v3 total**: v4 §6.7 baseline `~141-209h` through v3.4 + Phase 0 `~8-15h` = **~149-224h through v3.4**.

## 12. CI & Smoke Test Updates

- **GitHub Actions** (`.github/workflows/ci.yml`): `paths-ignore` updated; `pnpm -r test` replaces `npm test`; cache key includes `pnpm-lock.yaml`
- **`tests/smoke-ht.sh`**: ~114 path updates (architect MEDIUM corrected: not 20-30)
- **Per-package unit tests**: each package gets its own `vitest.config.js`
- **Cross-cutting integration tests**: stay in repo-root `tests/integration/`

## 13. Rollback Path

```bash
# If not committed:
git reset --hard pre-workspace-restructure-${DATE}
git clean -fd

# If committed but not pushed:
git revert <restructure-commit-sha>

# If pushed:
gh pr revert <restructure-pr-number>
```

Pre-restructure tag pushed to origin = off-machine recovery.

**Realistic failure modes & detection**:
- Mid-move test failures → discovered at Step 10 (45min budget + 90-180min buffer)
- Plugin manifest path breakage → discovered at Step 11 upgrade-over probe
- Hook chain ordering change → discovered at Step 10 (all 23 hooks must fire)
- Plugin discovers wrong files → discovered at Step 11 upgrade-over probe

## 14. Forcing Functions for Future Repo Split

(Unchanged from v1; reproduced for reference.)
1. Standalone kernel distribution (npm)
2. Multi-harness support (Codex / Aider / Gemini CLI)
3. Multi-maintainer arrives
4. Skills marketplace forms
5. Licensing diverges
6. Release cadence pain
7. Kernel security-patch independence ("we need to fix CWE-22 in K9 NOW")
8. Repo size >500MB

## 15. Acceptance Criteria (architect HIGH absorbed; v2 expanded)

- [ ] `pnpm install` resolves cleanly at root
- [ ] `pnpm list -r` shows all 5 packages (kernel, runtime, lab, skills, specs)
- [ ] `pnpm -r test` matches pre-restructure unit count (108/108)
- [ ] `bash tests/smoke-ht.sh` matches pre-restructure smoke count (116/116)
- [ ] Fresh Claude Code session loads plugin without warnings
- [ ] **All 23 hooks fire on no-op action** (architect MEDIUM expanded — was vague "all hooks")
- [ ] All 16 personas pass `packages/kernel/validators/contract-verifier.js`
- [ ] `loom-recall.js` returns results on 10 fixture queries (Phase 1 Wave C baseline)
- [ ] `.claude-plugin/manifest.json` validates against `packages/kernel/schema/plugin-manifest.schema.json`
- [ ] **`agents/*.md` Task-tool resolution still works** (NEW v2; architect HIGH absorbed — silent breakage risk)
- [ ] **Plugin upgrade-over probe passes** (NEW v2 — Step 11 mechanism)
- [ ] No broken internal markdown links across `packages/specs/`
- [ ] **DAG check**: no imports from `packages/kernel/**` reference `packages/runtime/**` or `packages/lab/**` (architect CRITICAL absorbed — verify pre-merge with grep)
- [ ] ADR-0009 documents restructure + `_lib/` DAG resolution + library decision + rename rationale
- [ ] Pre-restructure tag pushed to origin
- [ ] Commit message references this plan + ADR-0009
- [ ] PR opened against `main`; architect pair-review before merge

## 16. What Lands Next (after Phase 0)

**Phase 2 v3.0-alpha** (per v4 §6.1):
- `packages/kernel/worktree/` — K1 integration helpers
- `packages/kernel/spawn-state/` extensions — `parent_state_id` chain
- `packages/kernel/enforcement/k12-layer-boundary.js` — CI import-graph + frontmatter + override budget
- `packages/kernel/enforcement/k13-serial-only-spawn.js` — lock + PID-staleness + orphan recovery
- `packages/kernel/hooks/post/promote-deltas.js` — K9 with reverse-cherrypick journal
- `packages/kernel/validators/{capability-spec,path-rewriting}.js` — K7/K6 (K6 advisory in v3.0-alpha; binding in v3.1)
- ADR-0008 (MAJOR bump rationale)

## 17. Open Questions (v2 — for pair-review approval)

1. `agents/*.md` final location: repo-root `/agents/` (current) vs `packages/runtime/agents/`. Verification needed against Anthropic plugin spec before commit. v2 default: stays at repo root.
2. CommonJS vs ESM — keep CJS for Phase 0; ESM migration separate.
3. TypeScript adoption — stay JS for Phase 0.
4. Cross-package import discipline lint rule — Phase 3 candidate (after K11 ships).
5. K12 design must explicitly permit kernel filesystem reads of `~/.claude/library/sections/toolkit/**` via A6 snapshot — flag for v3.0-alpha K12 implementation.

## 18. References

- v4 substrate synthesis (post-restructure path: `packages/specs/rfcs/v3.3-substrate-synthesis.md`)
- v3.2 RFC LOCKED
- v3.0 multi-phase execution plan
- ADR-0009 (to be written; rationale)
- Sister-Claude draft + same-session critique: session `4187a617`
- Architect Round-1 of this plan: session `4187a617` (3 CRITICAL + 8 HIGH + 6 MEDIUM + 3 LOW; verdict NEEDS-MAJOR-REVISION); v2 absorbs all findings
- Architect Round-3 of v4 substrate synthesis (layer-enforcement requirement → K12 → Phase 0 filesystem boundary justification)
