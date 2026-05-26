# Phase 0 — Workspace Restructure (v3 Implementation Entry Point)

**Status**: locked plan — pair-review by power-loom:architect completed; findings absorbed.
**Created**: 2026-05-25
**Origin**: post-Wave-C deep-architecture synthesis (session `4187a617`); sister-Claude draft + same-session critique + reconciliation with v4 substrate synthesis
**Predecessor**: v4 substrate synthesis at `swarm/thoughts/shared/design/v3.3-substrate-synthesis.md`
**Successor**: Phase 2 Wave -1 entry probe (per v4 §6.0a); then v3.0-alpha implementation lands in the restructured packages from first commit
**Phase**: phase-0-pre-substrate (precedes Phase 2; Phase 1 is the spike that's already shipped)

## 0. Why Phase 0 (not Phase 2 Wave 0)

This work is structurally distinct from substrate implementation:
- Substrate work adds CODE (kernel primitives, validators, hooks)
- Restructure work moves EXISTING CODE without semantic change
- Mixing them in the same Wave makes blast-radius harder to reason about
- Phase 0 = "establish the home for Phase 2 code"

Naming as Phase 0 makes the precedence explicit: this lands BEFORE Wave -1 entry probes. Wave -1 then probes against the new structure (so probe results reference the actual implementation paths v3.0-alpha will use).

## 1. Context

The v4 substrate synthesis established a **three-layer architecture** (Loom Kernel / Loom Runtime / Loom Evolution Lab) + a transverse Docs/KB tier. The current repository has these tiers conceptually but they're flat-organized: `hooks/`, `scripts/`, `swarm/`, `skills/`, `tests/`. Layer boundaries are not enforced by tooling.

**Why restructure now** (Phase 0, before substrate primitives land):
1. v3.0-alpha will add ~900-1,300 LoC of new kernel code; landing it in a structured layout is cheap, restructuring after is expensive
2. v4 K12 layer-enforcer (mandatory in v3.0-alpha) needs a filesystem boundary to enforce; without packages, K12 has nothing structural to validate against
3. Wave -1 probes will reference implementation paths; probing against pre-restructure paths produces invalid evidence
4. Architect Round-3 explicitly flagged that "unenforced layer separation is cosmetic labeling" — packages give the missing physical boundary

## 2. Goals & Non-Goals

### Goals

1. Establish 4 internal package boundaries inside the existing repo using pnpm workspaces (`kernel / runtime / lab / docs`)
2. **Align package names with v4 three-layer architecture** (not the sister-draft's `kernel/personas/skills/docs` shape — that mis-categorized validators to personas and missed the Lab layer)
3. Set up `pnpm` workspaces with independent versioning per package
4. Preserve plugin distributability — `claude-power-loom` ships as ONE plugin via existing `.claude-plugin/`
5. Preserve all existing smoke/unit test coverage (zero regression)
6. Provide the filesystem boundary that v4 K12 layer-enforcer will validate
7. Make future repo split a `git filter-repo` operation rather than a multi-month refactor

### Non-Goals (explicit)

1. Physical repo split — deferred until forcing functions appear (see §10)
2. Plugin distribution model change — still one plugin, one install path
3. Renaming public APIs — internal moves only
4. Refactoring internal logic — **move-don't-change discipline**
5. Multi-harness support — kernel stays Anthropic-bound for v3.x
6. Replacing CI infrastructure
7. Tooling change beyond pnpm workspaces
8. v4 K12 layer-enforcer implementation (that's v3.0-alpha proper — Phase 0 provides the boundary; v3.0-alpha enforces it)

## 3. Tier Definitions (v4-Aligned)

### `packages/kernel/` — Loom Kernel layer

**Maps to**: v4 §2 Layer 1 (Loom Kernel; pure-function gates only; MAJOR-bump-protected).

**Scope**: deterministic, pure-function code that operates as the trusted substrate.

**Contents**:
- All hooks (PreToolUse, PostToolUse, Stop, PreCompact, SessionStart, UserPromptSubmit)
- **All validators** including contract-verifier (FIX #2 from critique: validators are kernel code, NOT persona code)
- GC subsystems (Process tier + Spawn tier per RFC v3.2)
- Recall-CLI deterministic ranker (`loom-recall.js`)
- Spawn-record machinery + envelope schema
- Future K11 kernel algorithm library (`scripts/kernel/algorithms/`)
- Future K12 layer-boundary enforcer (CI + frontmatter + override budget)
- Future K13 serial-only spawn enforcer (lock file + orphan recovery)
- Shared utility libraries (`_lib/`, `_log.js`)

**Exclusions**: no persona-specific logic; no LLM-as-judge code; no user-facing skills; no documentation.

**Versioning**: `@power-loom/kernel` strict semver; MAJOR signals substrate-fundament changes.

### `packages/runtime/` — Loom Runtime layer

**Maps to**: v4 §2 Layer 2 (Loom Runtime; HETS + decomposition disciplines; advisory verification allowed).

**Scope**: operational layer where personas + decomposition disciplines + HETS orchestration live.

**Contents**:
- 16 persona contracts (`contracts/*.contract.json`)
- Capability traits as JSON mixins (`traits/`) — NEW v3.1
- Persona contract schema (`schema/contract.schema.json`)
- HETS orchestration scripts (`scripts/agent-team/`)
- Pattern A trampoline implementation (NEW v3.2)
- Decomposition discipline routing (NEW v3.2)
- Spawn-verify dispatcher (NEW v3.2)
- Test-runner adapters (jest/vitest/pytest; NEW v3.2)
- HETS reputation infrastructure (`agent-identity.js`, `route-decide.js`)

**Exclusions**: no kernel hooks (those live in `kernel/`); no Lab adaptive cognition; no skill implementations.

**Versioning**: `@power-loom/runtime` versions per-RFC. Schema-additive = MINOR; field removals = MAJOR.

### `packages/lab/` — Loom Evolution Lab layer (NEW — sister draft missed this)

**Maps to**: v4 §2 Layer 3 (Loom Evolution Lab; experimental adaptive cognition; advisory only; explicitly isolated from kernel).

**Scope**: adaptive cognition that iterates within PATCH versions; outputs feed reputation asynchronously.

**Contents** (all v3.3+ deliverables; Phase 0 just creates the empty home):
- Negative attestation extraction (`extraction/`)
- Policy-axiom store integration (`policy-axioms/`)
- Reputation extension (`reputation/`)
- Attribution graph (`attribution/`; v3.4)
- Convergence metrics CLI (`convergence/`; v3.4)
- Evolve/forge triggers (`evolve/`; v3.4)
- Cross-persona test review (`review/`; v3.4)
- Circuit-breaker on denials (`circuit-breaker/`; v3.4)

**Exclusions**: NO direct kernel-path writes (K12 enforces); NO direct Runtime gating (advisory only).

**Versioning**: `@power-loom/lab` may iterate within PATCH versions. NEVER promoted to kernel without explicit ADR + full pair-review.

### `packages/skills/` — User-facing skill layer (cross-cuts Runtime, ships via plugin)

**Note**: GPT critique correctly identified skills as user-facing. v4 doesn't have a "skills" layer per se — skills cross-cut Runtime + Kernel surfaces via the plugin shell. Treating them as their own package preserves the high-churn isolation while not violating v4's three-layer model.

**Scope**: user-facing capability layer; high-churn; ships in plugin manifest.

**Contents**:
- All skills (`library/typescript/`, `library/react/`, etc.)
- Slash commands (`commands/`)
- Plugin manifest references

**Exclusions**: no kernel hooks; no persona contracts; no algorithm libraries.

**Versioning**: `@power-loom/skills` versions on each skill batch ship.

### `packages/docs/` — Specifications + research (transverse layer)

**Maps to**: v4 transverse Docs/KB tier (not a layer in the three-layer architecture; reference material).

**Scope**: append-only specifications, decision records, research artifacts, session snapshots.

**Contents**:
- RFCs (`rfcs/`)
- ADRs (`adrs/`)
- Phase plans (`plans/`)
- Spike write-ups (`spikes/`)
- Library sections — references to `~/.claude/library/sections/` but library itself stays at user-state location (FIX #5 from critique — DECIDED, not flagged as open)

**Exclusions**: no code; no persona contracts; no skill implementations.

**Versioning**: not versioned; append-only.

### Total: 5 packages (kernel, runtime, lab, skills, docs)

**Reconciliation with v4 three-layer architecture**:
- Kernel package = Layer 1 (Loom Kernel)
- Runtime package = Layer 2 (Loom Runtime)
- Lab package = Layer 3 (Loom Evolution Lab)
- Skills package = cross-cutting user surface (not a v4 layer; ships via plugin shell)
- Docs package = transverse reference material (not a v4 layer)

This is the **v4-aligned categorization** (FIX #1 from critique). Skills sits orthogonally because user-facing surfaces are categorically different from substrate layers; the plugin manifest stitches them together at distribution time.

## 4. Target Directory Structure

```
claude-power-loom/ (repo root; pnpm workspace root)
├── packages/
│   ├── kernel/                          # @power-loom/kernel
│   │   ├── hooks/
│   │   │   ├── pre/                     # PreToolUse hooks
│   │   │   ├── post/                    # PostToolUse hooks
│   │   │   ├── lifecycle/               # SessionStart, Stop, PreCompact, etc.
│   │   │   └── _lib/                    # shared lib (_log.js, file-path-pattern.js, etc.)
│   │   ├── validators/                  # all gate validators (FIX #2: moved here from sister draft's personas)
│   │   ├── algorithms/                  # NEW v3.2: topological_sort, subset_check, etc.
│   │   ├── gc/                          # Process tier + Spawn tier
│   │   ├── recall/                      # loom-recall.js (port from spike)
│   │   ├── spawn-state/                 # spawn-record.js + envelope schema + self-improve-store.js
│   │   ├── worktree/                    # NEW v3.0-alpha
│   │   ├── enforcement/                 # NEW v3.0-alpha: K12 layer-enforcer + K13 serial-enforcer
│   │   ├── hooks.json                   # consumes ${CLAUDE_PLUGIN_ROOT}/packages/kernel/hooks/...
│   │   ├── package.json
│   │   └── README.md
│   ├── runtime/                         # @power-loom/runtime
│   │   ├── contracts/                   # 16 persona .contract.json files
│   │   ├── traits/                      # NEW v3.1: atomic capability traits
│   │   ├── schema/
│   │   ├── orchestration/               # HETS scripts (was scripts/agent-team/)
│   │   ├── decomposition/               # NEW v3.2: Pattern A trampoline, discipline routing
│   │   ├── verify/                      # NEW v3.2: spawn-verify dispatcher
│   │   ├── test-runners/                # NEW v3.2: jest/vitest/pytest adapters
│   │   ├── package.json
│   │   └── README.md
│   ├── lab/                             # @power-loom/lab (NEW — fixes sister-draft omission)
│   │   ├── attestation/                 # NEW v3.3
│   │   ├── policy-axioms/               # NEW v3.3
│   │   ├── reputation/                  # NEW v3.3 (extends existing agent-identity.js patterns)
│   │   ├── attribution/                 # NEW v3.4
│   │   ├── convergence/                 # NEW v3.4
│   │   ├── evolve/                      # NEW v3.4
│   │   ├── review/                      # NEW v3.4
│   │   ├── circuit-breaker/             # NEW v3.4
│   │   ├── package.json                 # empty initially (Phase 0 creates the home; v3.3+ fills it)
│   │   └── README.md
│   ├── skills/                          # @power-loom/skills
│   │   ├── library/                     # 30+ skills (typescript, react, postgres, agent-team, etc.)
│   │   ├── commands/                    # slash commands
│   │   ├── package.json
│   │   └── README.md
│   └── docs/                            # @power-loom/docs
│       ├── rfcs/
│       ├── adrs/
│       ├── plans/
│       ├── spikes/
│       └── package.json
├── tests/                               # cross-cutting smoke + integration
├── scripts/                             # repo-level tooling (release, workspace-link)
├── .claude-plugin/
│   ├── manifest.json                    # references packages/skills/library/* + packages/runtime/contracts/*
│   └── README.md
├── pnpm-workspace.yaml                  # NEW: declares packages/*
├── package.json                         # repo root (workspace orchestration)
├── .gitignore
├── README.md
├── CHANGELOG.md
└── CLAUDE.md
```

## 5. Migration Map

| Current path | Target path |
|---|---|
| `hooks/scripts/*.js` | `packages/kernel/hooks/{pre,post,lifecycle}/*.js` |
| `hooks/scripts/validators/*.js` | `packages/kernel/validators/*.js` |
| `hooks/scripts/_log.js` | `packages/kernel/hooks/_lib/_log.js` |
| `hooks/scripts/_lib/*.js` | `packages/kernel/hooks/_lib/*.js` |
| `hooks/hooks.json` | `packages/kernel/hooks.json` |
| `scripts/loom-recall.js` | `packages/kernel/recall/loom-recall.js` |
| `scripts/self-improve-store.js` | `packages/kernel/spawn-state/self-improve-store.js` |
| `scripts/prompt-pattern-store.js` | `packages/kernel/spawn-state/prompt-pattern-store.js` |
| `scripts/agent-team/route-decide.js` | `packages/kernel/algorithms/route-decide.js` |
| `scripts/agent-team/agent-identity.js` | `packages/runtime/orchestration/agent-identity.js` |
| `scripts/agent-team/*` (other) | `packages/runtime/orchestration/*` |
| `swarm/personas-contracts/*.contract.json` | `packages/runtime/contracts/*.contract.json` |
| `swarm/personas-contracts/contract.schema.json` | `packages/runtime/schema/contract.schema.json` |
| `skills/*/` | `packages/skills/library/*/` |
| `commands/*.md` | `packages/skills/commands/*.md` |
| `swarm/thoughts/shared/design/*.md` | `packages/docs/rfcs/*.md` |
| `swarm/thoughts/shared/plans/*.md` | `packages/docs/plans/*.md` |
| `swarm/thoughts/shared/adrs/*.md` | `packages/docs/adrs/*.md` |
| `swarm/thoughts/shared/spikes/*.md` | `packages/docs/spikes/*.md` |
| `~/.claude/library/sections/*` | **STAYS at `~/.claude/library/sections/`** (FIX #5: B option DECIDED — user-state-shaped, recall-CLI is config-driven) |

### Special cases

- **`hooks.json` consolidation**: lives at `packages/kernel/hooks.json` post-restructure; uses `${CLAUDE_PLUGIN_ROOT}/packages/kernel/hooks/...` paths
- **`.claude-plugin/manifest.json` paths**: largest single risk — verify with fresh Claude Code session that plugin loads cleanly
- **Backward compat for existing installs**: ADR-0009 should document the upgrade path; users on prior plugin version should see clean install-over behavior

## 6. Sequencing (Phase 0 BEFORE Wave -1)

Per FIX #3 from critique:

```
Phase 0 — Workspace Restructure (THIS PLAN; ~4-5h)
   ↓ [single commit; clean baseline]
Phase 2 Wave -1 — Entry-Gate Probe (~6-9h)
   ↓ [empirical evidence on disk; probes reference new packages/ paths]
Phase 2 v3.0-alpha — PURE KERNEL TRANSACTION LOOP (~20-28h)
   ↓
v3.1 → v3.2 → v3.3 → v3.4
```

**Why Phase 0 precedes Wave -1**:
- Wave -1 probes (P-Inject, P-Worktree, P-Settings, etc.) reference hook paths
- If Wave -1 runs against old paths and Phase 0 restructures after, probe results don't map to actual implementation paths
- Restructuring first means all subsequent work (Wave -1 + v3.0-alpha) commits to the new layout from the start

**Why Phase 0 is NOT inside v3.0-alpha** (FIX #4 from critique):
- Restructure is a mechanical move with zero semantic change
- v3.0-alpha is substrate-implementation with new semantics (K12 + K13 + K9 security discipline + worktree integration)
- Mixing them in the same Wave makes blast-radius reasoning impossible
- Phase 0 has its own pair-review checkpoint (this document); v3.0-alpha has its own pair-review checkpoints

## 7. Migration Sequence (Step-by-Step)

### Step 0 — Branch + safety net (15 min)
```bash
git checkout main
git pull --ff-only
git checkout -b feat/phase-0-workspace-restructure
git tag pre-workspace-restructure-2026-05-XX
git push origin pre-workspace-restructure-2026-05-XX
```
Verification: HEAD on main; tag reachable on origin.

### Step 1 — Workspace tooling scaffold (30 min)
- Create `packages/{kernel,runtime,lab,skills,docs}` subdirectories
- Write `pnpm-workspace.yaml`
- Write root `package.json` + per-package `package.json`
- Run `pnpm install`
- Verification: `pnpm list -r` shows 5 packages

### Step 2 — Move kernel (60 min, largest move)
**Order matters**:
1. `_lib/` and `_log.js` first (dependency root)
2. Then `validators/`
3. Then per-event hooks (`pre/`, `post/`, `lifecycle/`)
4. Then `loom-recall.js` / `self-improve-store.js` / `prompt-pattern-store.js`
5. Then `route-decide.js`
6. Update `packages/kernel/hooks.json` paths
7. Verify each sub-step by smoke-importing the moved file

### Step 3 — Move runtime (30 min)
- `git mv` all 16 persona contracts → `packages/runtime/contracts/`
- Move schema → `packages/runtime/schema/`
- Move HETS scripts (`agent-team/`) → `packages/runtime/orchestration/`
- Update kernel hook paths that reference contracts
- Verification: `contract-verifier.js` (from kernel) passes all 16 contracts

### Step 4 — Create Lab home (10 min)
- Create `packages/lab/` directory + `package.json` + `README.md` only
- Phase 0 creates the empty home; v3.3+ fills it with actual code
- Verification: `pnpm list` shows `@power-loom/lab` at 0.0.0

### Step 5 — Move skills (30 min)
- `git mv skills/* packages/skills/library/`
- Move commands → `packages/skills/commands/`
- Update `.claude-plugin/manifest.json`
- Verification: plugin discovers skills

### Step 6 — Move docs (20 min)
- Move RFCs, plans, ADRs, spikes
- Verification: internal markdown links resolve

### Step 7 — Update plugin manifest + hooks.json (20 min)
**Single most important consolidation**:
- Update `.claude-plugin/manifest.json` paths to reference `packages/skills/library/*` + `packages/runtime/contracts/*`
- Update `packages/kernel/hooks.json` paths to use `${CLAUDE_PLUGIN_ROOT}/packages/kernel/hooks/...`
- Verification: fresh Claude Code session loads plugin cleanly; all hooks fire

### Step 8 — Smoke + unit tests (30 min)
```bash
pnpm -r test
bash tests/smoke-ht.sh
```
Expected: 108/108 unit + 116/116 smoke (baseline parity per Phase 1 spike).

### Step 9 — Commit + ADR-0009 (15 min)
- Single commit referencing this plan
- ADR-0009 documents rationale + this plan as appendix

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

### Per-package (kernel example)
```json
{
  "name": "@power-loom/kernel",
  "version": "3.3.0-alpha.0",
  "main": "./index.js",
  "type": "commonjs",
  "scripts": { "test": "vitest run" }
}
```

## 10. Versioning Strategy

| Package | Initial version | Rationale |
|---|---|---|
| `@power-loom/kernel` | `3.3.0-alpha.0` | Aligns with v3.x substrate work |
| `@power-loom/runtime` | `3.3.0-alpha.0` | Matches kernel for Phase 2 |
| `@power-loom/lab` | `0.0.0-empty` | Empty home; v3.3 fills it |
| `@power-loom/skills` | `1.0.0` | Skills mature; reset to clean semver |
| `@power-loom/docs` | unversioned | Append-only |

**Inter-package deps**:
- kernel has NO deps on other packages
- runtime depends on kernel (validators, hooks)
- lab depends on kernel (recall-CLI, spawn-record) + runtime (orchestration)
- skills depends on runtime (persona contracts) — NOT on kernel directly
- docs has no deps

Use `workspace:*` protocol for inter-package deps.

**Plugin version** (`.claude-plugin/manifest.json`): independent. Plugin version is user-facing; internal packages can churn without bumping plugin.

## 11. Effort Budget (Honest)

Per FIX #4 from critique — own the Phase 0 budget separately from v3.0-alpha:

| Step | Estimate |
|---|---|
| 0 — Branch + tag | 15 min |
| 1 — Workspace scaffold | 30 min |
| 2 — Move kernel | 60 min |
| 3 — Move runtime | 30 min |
| 4 — Create Lab home | 10 min |
| 5 — Move skills | 30 min |
| 6 — Move docs | 20 min |
| 7 — Update plugin manifest | 20 min |
| 8 — Smoke + unit tests | 30 min |
| 9 — Commit + ADR-0009 | 15 min |
| Buffer (test failures, path-fix iteration) | 60-90 min |
| **TOTAL Phase 0** | **~4-5h** |

**LoC moved**: ~10,000-15,000 lines across ~150-200 files. Pure `git mv`; no semantic changes.

**Honest impact on overall v3 effort estimate**:
- v4 §6.7 baseline: ~141-209h through v3.4
- Phase 0 adds: +4-5h
- **Revised total: ~145-214h through v3.4**

## 12. CI & Smoke Test Updates

- **GitHub Actions**: `paths-ignore` updated; `pnpm -r test` replaces `npm test`; cache key includes `pnpm-lock.yaml`
- **`tests/smoke-ht.sh`**: ~20-30 path updates (mechanical)
- **Per-package unit tests**: each package gets its own `vitest.config.js`; cross-cutting integration tests stay in repo-root `tests/integration/`

## 13. Rollback Path

```bash
# If not yet committed:
git reset --hard pre-workspace-restructure-2026-05-XX
git clean -fd

# If committed but not pushed:
git revert <restructure-commit-sha>

# If pushed:
gh pr revert <restructure-pr-number>
```

Pre-restructure tag pushed to origin = off-machine recovery.

## 14. Forcing Functions for Future Repo Split

Until ONE of these is true, stay monorepo:
1. Standalone kernel distribution (`@power-loom/kernel` on npm for non-power-loom users)
2. Multi-harness support (Codex / Aider / Gemini CLI)
3. Multi-maintainer arrives
4. Skills marketplace forms with independent distribution
5. Licensing diverges per layer
6. Release cadence pain becomes real (kernel held back by skill issues for >2 releases)
7. **NEW**: kernel needs to ship a security-patch release without coordinating with skills (the "we need to fix CWE-22 in K9 NOW" scenario)
8. Repo size >500MB

## 15. Acceptance Criteria

- [ ] `pnpm install` resolves cleanly at root
- [ ] `pnpm list -r` shows all 5 packages (kernel, runtime, lab, skills, docs)
- [ ] `pnpm -r test` matches pre-restructure unit count (108/108)
- [ ] `bash tests/smoke-ht.sh` matches pre-restructure smoke count (116/116)
- [ ] Fresh Claude Code session loads plugin without warnings
- [ ] All hooks fire on no-op action
- [ ] All 16 personas pass `contract-verifier.js`
- [ ] `loom-recall.js` returns real results on 10 fixture queries (Phase 1 Wave C baseline)
- [ ] `.claude-plugin/manifest.json` validates
- [ ] No broken internal markdown links
- [ ] **Existing-install upgrade path tested** (NEW per critique: verify users on prior plugin version see clean install-over)
- [ ] ADR-0009 documents restructure
- [ ] Pre-restructure tag pushed to origin
- [ ] Commit message references this plan + ADR-0009
- [ ] PR opened against `main`; architect pair-review before merge

## 16. What Lands Next (Wave -1 then v3.0-alpha)

After Phase 0 ships:

**Phase 2 Wave -1 — Entry-Gate Probe** (per v4 §6.0a):
- Probe scripts written in `packages/docs/spikes/v3-entry-probes/`
- Test against actual `packages/kernel/` paths
- 7 probes + OQ-11 decision

**Phase 2 v3.0-alpha — Pure Kernel Transaction Loop**:
- `packages/kernel/worktree/` — K1 integration helpers
- `packages/kernel/spawn-state/` extensions — parent_state_id chain
- `packages/kernel/enforcement/` — K12 layer-boundary enforcer + K13 serial-only enforcer
- `packages/kernel/hooks/post/promote-deltas.js` — K9 with reverse-cherrypick journal
- `packages/kernel/validators/{capability-spec.js,path-rewriting.js}` — K6/K7 (note: K6 advisory in v3.0-alpha; binding in v3.1)
- ADR-0008 (MAJOR bump rationale)

## 17. Open Questions (none blocking; for pair-review)

1. Plugin install-over upgrade discipline — what does the deprecation message look like for users on prior plugin version?
2. CommonJS vs ESM — keep CJS for the move; ESM migration is separate concern.
3. TypeScript adoption — stay JS for the move; TS migration is its own decision.
4. Cross-package import discipline lint rule — Phase 3 candidate (v3.2 K11 algorithm library makes this concrete).
5. CLAUDE.md location — stays at repo root.

## 18. References

- v4 substrate synthesis: `swarm/thoughts/shared/design/v3.3-substrate-synthesis.md` (post-restructure: `packages/docs/rfcs/v3.3-substrate-synthesis.md`)
- v3.2 RFC LOCKED: `swarm/thoughts/shared/design/causal-recall-graph-rfc.md` (post-restructure: `packages/docs/rfcs/2026-05-23-causal-recall-graph-rfc.md`)
- v3.0 multi-phase execution plan: `swarm/thoughts/shared/plans/2026-05-24-v3.0-multiphase-hets-execution-plan.md` (post-restructure: `packages/docs/plans/...`)
- ADR-0009 (to be written): workspace restructure rationale
- Sister-Claude draft + same-session critique: session `4187a617` transcript
- Architect Round-3 finding on layer-boundary enforcement: session `4187a617`, Round-3 architect output
