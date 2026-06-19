# 53 — Skills library: individual `SKILL.md` skills

**Scope:** `packages/skills/library/` — the on-demand skill roster the Claude Code
`Skill` tool loads. Each top-level directory is one skill with a single `SKILL.md`
body. **Excludes** the `agent-team/` subtree (85 files: HETS toolkit, `kb/`, `patterns/`),
which is cataloged separately.

## Role

The library is the toolkit's **best-effort instruction layer** — skills are loaded
into Claude's context on demand (by name match against their `description`/`when_to_use`,
or explicitly via a slash command or the `Skill` tool) and shape behavior for a task.
Nothing here is enforced; the only enforced layer is `packages/kernel/hooks/`. The
roster splits cleanly into two families:

- **Process / orchestration skills** (11) — encode multi-step toolkit workflows
  (planning, verification, self-improvement, team spawn). Several are the implementation
  body behind a same-named slash command in `packages/skills/commands/`.
- **Tech-stack specialist skills** (9) — domain reference cards loaded on demand by a
  HETS persona spawn (e.g. `react` for `09-react-frontend`). These carry a richer
  frontmatter (`skill`/`status`/`domain`/`canonical_source`/`forged_via`/`related_kb`)
  produced by the H.6.7 canonical-source forge cycle.

## Directory contents & nesting

Each entry is a directory with exactly one `SKILL.md` (no nested dirs except the
excluded `agent-team/`). The library root has **no** `README.md` and no manifest —
discovery is via the harness scanning each `SKILL.md` frontmatter.

| Skill dir | Family | Lines | Frontmatter shape | Backing command |
|---|---|---|---|---|
| `agent-swarm` | process | 91 | `name`+`description` | (none — `/build-team` is the HETS path) |
| `build-plan` | process | 132 | extended (`trigger_keywords`/`when_to_use`/`phase`) | `/build-plan` |
| `deploy-checklist` | process | 40 | `name`+`description` | (none) |
| `phase-close` | process | 159 | `name`+`description` | `/phase-close` |
| `verify-plan` | process | 148 | `name`+`description` | `/verify-plan` |
| `tech-stack-analyzer` | process | 175 | `name`+`description` | (none — orchestrator entry) |
| `prompt-enrichment` | process | 169 | `name`+`description` | (none — hook-triggered) |
| `research-mode` | process | 58 | `name`+`description` | (none — rule-triggered) |
| `self-improve` | process | 127 | `name`+`description` | `/self-improve` |
| `skill-forge` | process | 113 | `name`+`description` | `/forge` |
| `fullstack-dev` | process | 52 | `name`+`description` | (none) |
| `airflow` | tech-stack | 122 | forge-extended | (none) |
| `kubernetes` | tech-stack | 121 | forge-extended | (none) |
| `next-js` | tech-stack | 310 | forge-extended (+`evolved`) | (none) |
| `node-backend-development` | tech-stack | 102 | forge-extended | (none) |
| `penetration-testing` | tech-stack | 132 | forge-extended | (none) |
| `postgres-engineering` | tech-stack | 162 | forge-extended | (none) |
| `react` | tech-stack | 106 | forge-extended | (none) |
| `swift-development` | tech-stack | 92 | `name`+`description` | (none) |
| `typescript` | tech-stack | 285 | forge-extended | (none) |

20 skills in scope (the 21st library entry, `agent-team`, is excluded).

## Per-file catalog — process / orchestration skills

### `agent-swarm/SKILL.md`

- **Trigger:** "Multi-agent workflow for large features that span many files and concern
  areas." Lightweight parallel `Agent`-tool fan-out with ad-hoc role assignment.
- **Workflow:** Step 0 route-decide gate → decompose into non-overlapping units → assign
  by LENS (planner/architect/code-reviewer/hacker/optimizer) → parallel spawn (worktree
  isolation when dirs overlap) → synthesize → cross-cutting review → hand off (USER merges).
- **Load-bearing note:** Explicitly positions itself as the **non-HETS** sibling of
  `/build-team` ("lightweight fan-out … no persistent identities"); enforces the read-only-
  reviewer-persona rule (never wire Write-capable `security-auditor` into a review unit).
  Consumed directly by an orchestrator; no command wraps it.

### `build-plan/SKILL.md`

- **Trigger:** "HETS-aware planning for multi-file substantive work." Richest frontmatter
  in the roster (`trigger_keywords`, `when_to_use`, `when_NOT_to_use`, `phase: H.7.9`).
- **Workflow:** route-decide gate (Step 0/1) → recon Explore agents → architect-spawn
  recommendation when `convergence_value.contribution >= 0.10` → write plan to
  `.claude/plans/<name>.md` per `packages/specs/research/plan-template.md` → drift-note
  capture → USER gate (with `/verify-plan` pre-approval for HETS-routed plans).
- **Load-bearing note:** Canonical operationalization of the Plan-Before-Edit discipline.
  Cites `BORDERLINE_PROMOTION_THRESHOLD = 0.10` and `weights_version
  v1.3-dict-expanded-2026-06-12` — **both verified accurate** against
  `packages/kernel/algorithms/route-decide.js`. Wrapped by the `/build-plan` command, which
  delegates to it.

### `deploy-checklist/SKILL.md`

- **Trigger:** "Verification workflow before shipping to production." Pure checklist.
- **Workflow:** five gated checklist groups — Code Quality, Data & Infrastructure,
  Performance, User-Facing, Operations.
- **Note:** The shortest skill (40 lines) and the **most generic** — Next.js/npm-flavored
  (`npx next build`, `next/image`) and not tied to any toolkit primitive. Description
  promises "explicit user approval before destructive actions" but the body is a flat
  checklist with no approval-gate mechanic — mild description/body drift.

### `phase-close/SKILL.md`

- **Trigger:** "Phase-level verification gate run at a v3.x phase boundary (the post-phase
  analog of `verify-plan`)." Fires once per phase, not per PR.
- **Workflow:** establish phase scope + exit criteria → spawn 3 read-only lenses in
  parallel (PM=`honesty-auditor`, Principal-SDE=`code-reviewer`, Architect=`architect`) →
  aggregate (CLOSEABLE iff all three) → **deterministic release-surface gate (3a)** via
  `scripts/validate-release-surface.js` → write sign-off to `docs/ROADMAP.md` + a
  `toolkit/phase-close` library volume → feed ghost-protocol effectiveness loop → surface.
- **Load-bearing note:** The most careful skill about its own honesty — explicitly
  separates the **deterministic** release-surface `--check` (enforced on every push, drift-gate
  Test 124) from the **advisory** phase-equality check (runs only if the agent runs the skill).
  Wrapped by `/phase-close`. Cites `~/.claude/packages/kernel/spawn-state/self-improve-store.js`.

### `verify-plan/SKILL.md`

- **Trigger:** "Pre-approval verification for plan-mode plans before `ExitPlanMode`."
- **Workflow:** read plan → spawn architect + code-reviewer in parallel with structured
  PASS/FLAG/FAIL briefs (9 architect checks incl. Runtime-Claim probes; 8 code-reviewer
  checks) → aggregate via `verify-plan-spawn.js` (which **only aggregates, never spawns** —
  confirmed in the script header) → surface verdict → apply fixes inline → `ExitPlanMode`.
- **Load-bearing note:** Codifies drift-note 40; the appended `## Pre-Approval Verification`
  section is required by `validate-plan-schema.js` Tier 1 for HETS-routed plans. Trust model
  is honest: section *presence* is the forcing function, not a tamper-proof audit. Wrapped by
  `/verify-plan`. **Only skill that cites both `${CLAUDE_PLUGIN_ROOT}` and `$HOME/.claude`
  paths** — the most portable citation style in the roster.

### `tech-stack-analyzer/SKILL.md`

- **Trigger:** Orchestrator entry point for "build me X" tasks — translates a task into a
  spawn plan (stack + skills + personas + missing-skill bootstrap prompts).
- **Workflow:** parse intent/domain → look up `kb:hets/stack-skill-map` via `kb-resolver.js`
  → build plan → cross-check skill availability → **USER GATE 1** (present plan) → **USER
  GATE 2** (skill bootstrapping via `/forge`+`/review`) → spawn team with trust-tiered
  verification.
- **Load-bearing note:** Implements the `tech-stack-analyzer` + `skill-bootstrapping`
  patterns (in the excluded `agent-team/patterns/`). Two mandatory user gates are the trust
  boundary against heuristic stack-inference. Many KB cross-links into `agent-team/` (all
  resolve). Cites `~/Documents/claude-toolkit/...` paths (portability concern — see Findings).

### `prompt-enrichment/SKILL.md`

- **Trigger:** Activated by the `prompt-enrich-trigger.js` UserPromptSubmit hook injecting a
  `[PROMPT-ENRICHMENT-GATE]`. Transforms vague prompts into a 4-part structure.
- **Workflow:** Step 0 pattern lookup (`prompt-pattern-store.js lookup`) → Step 0.5 read
  last 1-3 turns (H.7.5) → classify+select technique → build 4-part prompt → size check →
  present with `[ENRICHED-PROMPT-START]…[ENRICHED-PROMPT-END]` markers → **automatic** store
  via the `auto-store-enrichment.js` Stop hook → execute. Confidence tiers gate how much is
  shown (Learning→Familiar→Trusted→Independent at 5+ approvals).
- **Load-bearing note:** The marker convention is the storage trigger — emitting the markers
  IS the persistence path. Calls `~/.claude/packages/kernel/spawn-state/prompt-pattern-store.js`.
  The body calls `~/.claude/prompt-patterns.json` "the canonical local store … source of
  truth"; the store source comments that post-v2.1.0 this path is a **symlink to the library
  prompt-patterns stack** — both true but the skill's "source of truth" framing understates
  the library migration (minor).

### `research-mode/SKILL.md`

- **Trigger:** "Anti-hallucination protocol for tasks where accuracy matters." Opt-in per task.
- **Workflow:** epistemic-honesty + source-attribution + evidence-first constraints → source
  cascade (local files → WebSearch → WebFetch → explicit uncertainty; budget 5 search / 3
  fetch) → verification checklist → explicit exit.
- **Note:** Mirrors the always-on `rules/core/research-mode.md`; this skill is the deeper
  workflow the rule defers to. No backing command (rule-triggered).

### `self-improve/SKILL.md`

- **Trigger:** "Continuously evolve the toolkit by promoting proven patterns from session
  memory to permanent rules, and forging skills from recurring workflows."
- **Workflow:** Work → Capture → Consolidate → Approve → Promote → Enforce. Documents the
  H.4.1-era auto-loop and its **retirements** (frequency-capture arm RETIRED 2026-05-30;
  `session-self-improve-prompt.js` exists on disk but is NOT registered in `hooks.json`).
- **Load-bearing note:** The authoritative description of the self-improve store CLI
  (`self-improve-store.js stats|pending|scan|promote|dismiss|reset`) and the risk taxonomy
  (low auto-graduate / medium+high prompt). **Structural defect:** the `## The Loop` section
  numbers its phases `1. Capture → 2. Consolidate → 3. Approve → 4. Review → 3. Promote → 4.
  Prune` — two duplicate `### 3.`/`### 4.` headings (Promote/Prune re-use 3/4 after Review is
  also numbered 4). Wrapped by `/self-improve`, but the command **re-implements** the steps
  inline rather than delegating (see Findings).

### `skill-forge/SKILL.md`

- **Trigger:** "Create specialized agents and skills on the fly when existing ones don't fit."
- **Workflow:** gap detection (check SOURCE tree) → design (agent vs skill) → **2a canonical-
  source lookup** (`kb-resolver.js cat hets/canonical-skill-sources` + `validation_sources`) →
  create SOURCE file only → document creation context → ship via branch→PR→merge→install.
- **Load-bearing note:** Hammers the edit-SOURCE-not-installed-copy rule and the "agents have
  NO memory across runs" anti-pattern. The canonical-first principle is what produced the
  forge-extended frontmatter on the tech-stack skills. Wrapped by `/forge`, but like
  `/self-improve` the command re-implements rather than delegates.

### `fullstack-dev/SKILL.md`

- **Trigger:** "Server-first development workflow for Next.js + TypeScript projects."
- **Workflow:** understand requirement → check existing patterns → data layer first
  (schema/Zod/inferred types) → server-side → client-side (Server Components default) →
  validate E2E → tests → browser verify → self-review via code-reviewer agent.
- **Note:** Generic Next.js workflow with substantial conceptual overlap with `next-js`,
  `react`, `typescript`, and `deploy-checklist` (see Findings: consolidation opportunity).

## Per-file catalog — tech-stack specialist skills

All nine are loaded on demand by a HETS persona spawn whose prompt lists the skill as
required. They share a body shape (When to use / Skip when / Core competencies / cross-link
to a `kb:<domain>/...` essentials doc in the excluded `agent-team/kb/`). One-liners:

- **`airflow/SKILL.md`** — `11-data-engineer` lens; Airflow 2.x DAG/task/operator design,
  idempotency, backfill, scheduler/executor debugging. Canonical: `airflow.apache.org/docs/`.
- **`kubernetes/SKILL.md`** — `10-devops-sre` lens; manifest fundamentals, deploy strategies,
  probes, scaling, pod-failure debugging. Canonical: `kubernetes.io/docs/home/` (pin 1.29+).
- **`next-js/SKILL.md`** — Next.js 13+ App Router; server/client boundary, route handlers,
  server actions, four-layer cache. **Carries a detailed Next 14-vs-15 version-drift table**
  (config file, async `cookies()`/`params`, `serverExternalPackages`, fetch-default caching) —
  the most operationally valuable specialist skill. `evolved` 2026-05-21.
- **`node-backend-development/SKILL.md`** — `13-node-backend` lens; async-first idioms, event
  loop awareness, module boundaries, error handling. Canonical: `nodejs.org/docs/latest/api/`.
- **`penetration-testing/SKILL.md`** — `12-security-engineer` lens; methodology (scope/recon/
  STRIDE/PoC/CVSS), OWASP Top 10. **Carries a 2026-06 note** that OWASP Top 10:2025 supersedes
  2021 — a model of dated honesty rather than silent staleness. Canonical: OWASP WSTG +
  `validation_sources` (RFC 6749/6819).
- **`postgres-engineering/SKILL.md`** — `13-node-backend` + `11-data-engineer`; indexing-by-
  access-pattern table, query diagnosis, pooling, pgvector, migrations. Canonical:
  `postgresql.org/docs/current/`.
- **`react/SKILL.md`** — `09-react-frontend` lens; hooks rules/idioms, component design, a11y.
  Canonical: `react.dev/reference/react` (v18+).
- **`swift-development/SKILL.md`** — `06-ios-developer` lens; value-type-first, optionals,
  structured concurrency, SPM, platform testing. **Only tech-stack skill with the plain
  `name`+`description` frontmatter** (no `canonical_source`/`domain`/`related_kb`) — predates
  or skipped the forge-extended schema (inconsistency, see Findings).
- **`typescript/SKILL.md`** — any-persona; strict-mode tsconfig, type-vs-interface, narrowing,
  discriminated unions, Zod/Drizzle/Next idioms. Explicitly "no `validation_sources` (style
  skill)." Canonical: TS handbook.

## Findings

| Severity | Level | Type | Location | Description |
|---|---|---|---|---|
| MEDIUM | file | bug | `self-improve/SKILL.md` `## The Loop` | Section headings have duplicated/non-monotonic numbering: phases run `1.Capture → 2.Consolidate → 3.Approve → 4.Review` then **re-use** `### 3. Promote` and `### 4. Prune`. Two pairs of duplicate `###` numbers confuse the documented pipeline ordering. |
| MEDIUM | substrate | smell | `*/SKILL.md` (runtime-path citations) | Three inconsistent path conventions cite the same runtime substrate: developer-machine `~/Documents/claude-toolkit/...` (`agent-swarm`, `build-plan`, `tech-stack-analyzer`, `skill-forge`, `self-improve`), installed `~/.claude/packages/...` (`phase-close`, `prompt-enrichment`, `skill-forge`, `self-improve`), and portable `${CLAUDE_PLUGIN_ROOT}/...` (only `verify-plan`). The `~/Documents/...` form is non-portable for any user who didn't clone to that exact path; `verify-plan`'s dual-citation is the model to standardize on. |
| MEDIUM | component | smell | `fullstack-dev` vs `next-js`/`react`/`typescript`/`deploy-checklist` | Four-way overlap on the Next.js+TS server-first story. `fullstack-dev` is a generic 52-line workflow whose data/server/client/test steps duplicate material already in the deeper `next-js` (310) + `react` (106) + `typescript` (285) specialist skills, and its closing deploy guidance overlaps `deploy-checklist`. Consolidation candidate: make `fullstack-dev` a thin orchestration shell that defers to the three specialists. |
| LOW | file | smell | `swift-development/SKILL.md` frontmatter | Uses the plain `name`+`description` frontmatter while every other tech-stack skill carries the forge-extended schema (`skill`/`status`/`domain`/`canonical_source`/`forged_via`/`related_kb`). It cites `kb:mobile-dev/swift-essentials` in prose but declares no `related_kb`/`canonical_source` in frontmatter — inconsistent with `react`/`kubernetes`/etc. and with what `skill-forge` Step 2a expects. |
| LOW | component | smell | `/self-improve`, `/forge` commands vs their skills | `/build-plan`, `/verify-plan`, `/phase-close` commands are thin wrappers that delegate ("User-facing entry point for the [X] skill"). `/self-improve` and `/forge` instead **re-implement** the skill's steps inline, so the same workflow exists in two editable places — drift risk if one is updated and not the other. `/evolve` correctly treats command/skill/agent as three distinct SOURCE shapes. |
| LOW | file | smell | `deploy-checklist/SKILL.md` | Description promises "gated steps with explicit user approval before destructive actions," but the body is a flat un-gated checklist with no approval mechanic. Also Next.js/npm-specific (`npx next build`, `next/image`) despite a generic-sounding name — narrower than it advertises. |
| LOW | substrate | smell | library root | No `README.md` or manifest at `packages/skills/library/` — the only index over the 21 skills is each `SKILL.md` frontmatter. The excluded `agent-team/` has a `kb/manifest.json` + `patterns/README.md`; the top-level skill roster has no equivalent map, so a reader must enumerate directories to discover what exists. |
| INFO | file | smell | `prompt-enrichment/SKILL.md` | Calls `~/.claude/prompt-patterns.json` "the canonical local store … source of truth"; the store source (`prompt-pattern-store.js`) notes that post-v2.1.0 this path is a **symlink to the library prompt-patterns stack**. Both statements are true (the symlink makes the JSON path still load-bearing) but the skill's framing understates the library migration. |
| INFO | substrate | bug | (gap) all citations resolve | No broken path citations found: every cited script/spec (`route-decide.js`, `verify-plan-spawn.js`, `kb-resolver.js`, `agent-identity.js`, `plan-template.md`, `prompt-pattern-store.js`, `self-improve-store.js`, `validate-release-surface.js`, `validate-plan-schema.js`, `super-agent.md`, `library.js`, `docs/library.md`) exists. `build-plan`'s `weights_version`/`BORDERLINE_PROMOTION_THRESHOLD` claims match `route-decide.js`. Recorded as the no-doc-rot baseline. |
