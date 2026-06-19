# 51 — Slash commands + always-on rule files

**Scope**: `packages/skills/commands/` (14 slash commands) and `packages/skills/rules/` (9 rule files). This is the *instruction-following* surface of the toolkit — the layer that shapes Claude's behavior through prose (commands the user invokes explicitly; rules injected every session). It is deliberately distinct from the *enforced* layer (`packages/kernel/hooks/`): per `CLAUDE.md`, hooks are the only guaranteed substrate, and everything here is best-effort. The value of this section is mapping which prose discipline is backed by which deterministic hook, and where the prose has drifted from the code it describes.

## How this layer is wired into the system

- **Commands** ship through the plugin manifest. `.claude-plugin/plugin.json` declares `"commands": "./packages/skills/commands"`, so Claude Code auto-discovers every `*.md` here as a slash command. The slug is the filename (`build-plan.md` -> `/build-plan`); the description is the YAML frontmatter `description` if present, else inferred from the first heading. They go live on `claude plugin update`.
- **Rules** do NOT ship through the plugin manifest. They are installed by `install.sh --rules` (the `install_rules()` function, lines 93-108): `cp -r packages/skills/rules/* ~/.claude/rules/toolkit/`. The installed copies are what Claude reads each session. **Editing the installed copy is the clobber trap** the rules themselves repeatedly warn about — edit the SOURCE here and re-sync.
- **The two non-core rule trees** (`typescript/`, `web/`) carry a YAML `paths:` glob frontmatter (`**/*.ts`, `**/*.tsx`, etc.), so they are path-scoped — injected only when files matching those globs are in play. The `core/` rules are always-on (most use inline `<important if "task involves X">` predicate gating instead, per ADR-0005).

## Directory contents & nesting

```
packages/skills/
  commands/                 (14 files — slash commands, flat)
    build-plan.md  build-team.md  chaos-test.md  evolve.md  forge.md
    implement.md   phase-close.md plan.md        prune.md   research.md
    review.md      security-audit.md  self-improve.md  verify-plan.md
  rules/
    core/                   (7 files — always-on operating discipline)
      fundamentals.md  prompt-enrichment.md  research-mode.md  security.md
      self-improvement.md   workflow.md       workspace-hygiene.md
    typescript/
      style.md              (path-scoped: **/*.ts|tsx|js|jsx)
    web/
      react-nextjs.md       (path-scoped: **/*.tsx|jsx|ts|js)
```

## Commands catalog

Two shapes coexist: **thin delegates** (a handful of steps that hand off to a named agent or skill) and **fat orchestrators** (full multi-step bash-bearing procedures, often a user-facing front for a `library/<name>/SKILL.md` body).

| Command | Purpose (one line) | Delegates to | Routing / gating |
|---|---|---|---|
| `build-plan.md` | HETS-aware plan authoring for substantive multi-file work | `build-plan` skill + `planner` agent (+ optional `architect` spawn) | Step 0 `route-decide.js` gate; Step 3 architect rec when `convergence_value >= 0.10`; Step 5 `/verify-plan` if HETS-routed |
| `build-team.md` | Translate a build task into a concrete HETS spawn plan | `tech-stack-analyzer` skill; spawns persona identities | Step 0 `route-decide.js` gate (`route`/`borderline`/`root`/`uncertain`); 2 in-skill USER GATEs |
| `chaos-test.md` | 3-tier hierarchical multi-persona audit of the toolkit itself | super-agent + actor personas (`01-hacker`, `04-architect`, `03-code-reviewer`, ...) | Pre-routed (skips route-decide); `--pattern`/`--max-depth`/`--no-baseline` flags |
| `evolve.md` | Update an existing agent/skill/command from an observed run | self (mechanical edit); `/self-improve` for high-risk | Risk-tier gate FIRST: low=here, high (agent/contract rewrite)=route through `/self-improve` |
| `forge.md` | Create a NEW agent or skill when none fits | self-authoring; records library provenance | Gap-detection step (suggest `/evolve` on overlap); ships via PR |
| `implement.md` | Execute an approved plan from `packages/specs/plans/` (RPI Implement step) | self; runs in-tree | Phase-by-phase with mandatory pause-for-human-verification between phases; resumable via `[x]` checkboxes |
| `phase-close.md` | Phase-boundary verification gate (post-phase analog of `/verify-plan`) | `phase-close` skill; spawns PM (`honesty-auditor`) + Principal-SDE (`code-reviewer`) + `architect` | Fires once per v3.x phase; deterministic `validate-release-surface.js` sub-gate (3a); ghost-protocol `drift:phase-close-skipped` |
| `plan.md` | Thin single-architect phased-plan delegate | `planner` agent | None — soft nudge to `/build-plan` if planner detects >=2 files + tradeoffs |
| `prune.md` | Curate MEMORY / rules / skills / agents / library | self; `scan-stale-artifacts.js`, `library.js` | Step 0 deterministic pre-flight (byte budget + stale scan); batched confirmation gate |
| `research.md` | Document codebase as-is (RPI Research step) | `14-codebase-locator` / `15-codebase-analyzer` / `16-codebase-pattern-finder` personas | DOCUMENT-only discipline (no critique); writes to `packages/specs/research/` |
| `review.md` | Code review of current diff | `code-reviewer` agent | None — thin 6-step delegate |
| `security-audit.md` | Security audit of codebase/changes | `hacker` agent (read-only review); `security-auditor` for remediation only | `npm audit` + secret grep; read-only-reviewer discipline (per `workflow.md` Rule 3) |
| `self-improve.md` | Promote proven patterns to rules/skills/agents; prune stale | self; library + MEMORY scan | Quality-gate checklist (2+ session recurrence); user-approval gate before any change |
| `verify-plan.md` | Pre-approval verification of a plan before ExitPlanMode | `verify-plan` skill; spawns `architect` + `code-reviewer` in parallel | Only for HETS-routed plans; `verify-plan-spawn.js` aggregates; idempotent re-run |

### Load-bearing command notes

- **`build-plan.md`** (159 lines) — the canonical example of the route-decide-gated planner. Its Step 0 bash block runs `packages/kernel/algorithms/route-decide.js` (path verified present) and dispatches on `recommendation`. It is the H.7.9 sharpening of the soft plan-mode norm in `workflow.md`. Its output plan must conform to `packages/specs/research/plan-template.md` (verified present). Consumed by `/verify-plan` (Step 5) and the `validate-plan-schema.js` PostToolUse hook.
- **`build-team.md`** (207 lines) — the fattest command. Substrate-primitive bash is extracted to `packages/runtime/orchestration/build-team-helpers.sh` (verified present, the third ADR-0002 application). It documents the H.6.5 missing-capability-signal protocol (sub-agents emit `request:` blocks; root acquires). The `spawn_implementer`/`spawn_challenger` placeholders are Agent-tool conventions, NOT bash — intentionally unwrapped.
- **`phase-close.md`** — the ONLY command with YAML frontmatter (`name:` + `description:`). Its deterministic sub-gate `scripts/validate-release-surface.js` (verified present) catches the stale-version-surface class. Honest about being advisory, not hook-enforced.
- **`implement.md`** + **`research.md`** — the RPI (Research -> Plan -> Implement) trio adopted in H.8.6 from humanlayer/ace-fca. Both cite `packages/skills/library/agent-team/patterns/research-plan-implement.md` (verified present). `research.md`'s defining discipline is DOCUMENT-only (no critique), to keep downstream plan context clean.
- **`evolve.md` + `forge.md`** — paired lifecycle commands (evolve = update existing, forge = create new). Both encode the edit-SOURCE-not-installed-copy rule (#219/#275) and ship-via-PR gate. `forge.md` Step 3 explicitly removed the dual-write-installed-copy step that `/evolve` shed in #275.

## Rules catalog

### `core/` (always-on; injected every session via `~/.claude/rules/toolkit/core/`)

| Rule file | Discipline encoded | Enforcement |
|---|---|---|
| `fundamentals.md` | Immutability, KISS/DRY/YAGNI, SOLID, file org, error handling, input validation, naming, **ASCII-only in source** | Advisory; ASCII rule backed by CI `eslint no-irregular-whitespace`; Pre-Completion Checklist predicate-gated |
| `workflow.md` | The mega-rule: git conventions, testing, code review (incl. async-bot gate), Plan-Before-Edit, TDD-treatment, Runtime-Claim Probe, hook-layer placement, persona-selection (Rules 1-4), pre-approval + phase-close gates | Mix: Plan-Before-Edit headless path enforced by `redirect-plan-mode-in-headless.js` (PreToolUse:EnterPlanMode); pre-approval by `verify-plan-gate.js` (PreToolUse:ExitPlanMode) + `validate-plan-schema.js` (PostToolUse); rest advisory |
| `security.md` | Pre-commit checklist; exact-set-not-subset authz; verify-content-on-read; integrity != provenance; secret management; security response protocol | Secrets backed by `validate-no-bare-secrets.js` (PreToolUse:Edit\|Write); the authz/provenance lessons are advisory |
| `self-improvement.md` | Gap detection (silent, batched); session-end review; pre-compact awareness; forging procedure | Pre-compact backed by `pre-compact-save.js` (PreCompact); session-end by `session-end-nudge.js` (Stop); capture-loop is advisory (auto-counter RETIRED 2026-05-30) |
| `prompt-enrichment.md` | Sub-agent prompt enrichment; vague-prompt 4-step workflow | `prompt-enrich-trigger.js` (UserPromptSubmit) injects the forcing instruction |
| `workspace-hygiene.md` | `lifecycle` frontmatter convention; session-end stale-artifact scan; archive locations | `scan-stale-artifacts.js` (manual/advisory; not hooked); ghost-protocol `drift:workspace-hygiene-debt` monitor |
| `research-mode.md` | Anti-hallucination constraints (cite sources, "I don't have a verified source", Read-before-claim) | Advisory only; `fact-force-gate.js` (PreToolUse:Read\|Edit\|Write) is the nearest adjacent enforcement |

### Path-scoped rule trees

| Rule file | Scope (`paths:` frontmatter) | Discipline |
|---|---|---|
| `typescript/style.md` | `**/*.ts`, `**/*.tsx`, `**/*.js`, `**/*.jsx` | Type discipline, avoid `any`, React props, immutability, error handling, Zod validation, no `console.log` |
| `web/react-nextjs.md` | `**/*.tsx`, `**/*.jsx`, `**/*.ts`, `**/*.js` | Server vs Client Components, hooks discipline, lists/keys, prop drilling, data fetching, `next/image`, API routes |

### Rule -> hook enforcement map (the load-bearing part)

The `packages/kernel/hooks.json` manifest (24 registered hook entries) was inspected directly. The rules that CLAIM hook enforcement and the hooks that back them:

- `workflow.md` Plan-Before-Edit (headless) -> `pre/redirect-plan-mode-in-headless.js` (PreToolUse:EnterPlanMode) — **present, matches**.
- `workflow.md` pre-approval verification -> `pre/verify-plan-gate.js` (PreToolUse:ExitPlanMode) + `validators/validate-plan-schema.js` (PostToolUse:Edit\|Write) — **present, matches**. The H.7.19 self-correction in `workflow.md` (validate-plan-schema moved PreToolUse -> PostToolUse) is **consistent with the live manifest** (it is registered at PostToolUse). No drift.
- `prompt-enrichment.md` -> `lifecycle/prompt-enrich-trigger.js` (UserPromptSubmit) — **present, matches**.
- `security.md` secrets -> `validators/validate-no-bare-secrets.js` (PreToolUse:Edit\|Write) — **present, matches**.
- `workflow.md` route-decision -> `pre/route-decide-on-agent-spawn.js` (PreToolUse:Agent\|Task) — **present, matches**.
- `self-improvement.md` pre-compact -> `lifecycle/pre-compact-save.js` (PreCompact); session-end -> `lifecycle/session-end-nudge.js` (Stop) — **present, matches**.
- `workspace-hygiene.md` -> `scripts/scan-stale-artifacts.js` is a **manual/advisory** script, NOT a registered hook. The rule is honest about this ("Run `node scripts/scan-stale-artifacts.js`" at session-end). No false enforcement claim.

The `workflow.md` H.7.19 section also references the now-removed `pre-spawn-tool-mask` hook indirectly via ADR-0012; the manifest retains an explicit tombstone `_comment` confirming the removal (matches MEMORY + ADR-0012). No drift.

## Cross-reference verification

All inbound/outbound path citations from in-scope files were resolved against the repo:

- `build-plan.md` link `../../../agents/planner.md` resolves to `agents/planner.md` (verified present). `../library/build-plan/SKILL.md` resolves to `packages/skills/library/build-plan/SKILL.md` (present). Delegated agents (`planner`, `code-reviewer`, `hacker`, `security-auditor`, `architect`, `honesty-auditor`, `node-backend`) all present under `agents/`.
- SKILL bodies cited by commands (`build-plan`, `tech-stack-analyzer`, `phase-close`, `verify-plan`, `agent-team`) all present.
- Rule cross-refs: `packages/specs/architecture-substrate/{auto-loop-infrastructure,prompt-enrichment-architecture}.md`, `plan-template.md`, `system-design-principles.md`, `validator-conventions.md`, `research-plan-implement.md`, `scan-stale-artifacts.js`, `validate-release-surface.js`, `verify-plan-spawn.js`, `build-team-helpers.sh` — **all present**.
- `compliance-probe.sh` (cited by `chaos-test.md` as `~/.claude/scripts/compliance-probe.sh`) lives at repo `scripts/compliance-probe.sh` and IS installed to `~/.claude/scripts/` by `install.sh` step 7 (lines 244-248). The reference is valid for the installed runtime, NOT for in-repo invocation.

## Findings

| Severity | Level | Type | Location | Description |
|---|---|---|---|---|
| MEDIUM | component | smell | `packages/skills/commands/{prune,research,chaos-test,build-team,evolve,build-plan,forge}.md` | 7 of 14 commands hard-code the author-specific absolute path `~/Documents/claude-toolkit/...` (or `$HOME/Documents/claude-toolkit`). When the plugin is installed on another machine the command body ships verbatim but the path is wrong; the portable anchor is `${CLAUDE_PLUGIN_ROOT}` (used throughout `hooks.json`) or `~/.claude/scripts/` for installed CLIs. This is the single biggest portability gap in the command set. |
| MEDIUM | file | smell | `packages/skills/commands/*.md` (13 of 14) | Inconsistent command metadata: only `phase-close.md` carries YAML frontmatter (`name:`/`description:`). The other 13 rely on filename-slug + first-heading inference. Works today, but the description shown in the command palette is then the raw H1 (e.g. `# /build-plan — HETS-aware plan authoring (H.7.9)`), which leaks internal phase tags. Consolidation opportunity: add frontmatter `description` to all commands for a clean palette. |
| MEDIUM | component | smell | `packages/skills/commands/chaos-test.md` | Staleness: this command still narrates v2.8.x-era empirical motivation (the `chaos-20260501` / `chaos-20260502` run IDs, the v2.8.2 PDF->Tutorial shakedown, hook-log temporal-blindness) and cites legacy artifacts `~/.claude/agent-patterns.json` / `~/.claude/agent-identities.json`. The substrate has since moved to the Lab verdict-attestation + reputation track (v3.4+). The run-discipline is still valid but the worked examples and per-persona counter paths are pre-v3 and read as drift against the current `packages/lab/` reputation substrate. |
| LOW | substrate | smell | `packages/skills/commands/` vs available-skills list | Naming collision between commands and library skills: `/build-plan`, `/verify-plan`, `/phase-close`, `/self-improve` exist BOTH as a command (`commands/X.md`) and as a `library/X/SKILL.md` skill (the command is the thin user-facing front; the skill is the body). This 1:1 command->skill pairing is intentional and documented, but the duplicate surface names can confuse a cold reader about which artifact is authoritative. Worth a one-line "command = front, SKILL = body" note in a README. |
| LOW | component | smell | `packages/skills/rules/core/workflow.md` | Single-file overload: `workflow.md` is 261 lines and bundles ~10 distinct disciplines (git, testing, review, plan-before-edit, TDD, runtime-probe, hook-placement, schema-questions, markdown, CI, persona-selection, pre-approval, phase-close) under predicate blocks. It is at/near the T76 14-predicate-block ceiling the rule itself cites. Future additions have nowhere clean to land without bundling-into-existing — a noted structural pressure, not yet a defect. |
| LOW | file | smell | `packages/skills/rules/typescript/style.md`, `packages/skills/rules/web/react-nextjs.md` | Near-duplicate scope between the two path-scoped rules: identical `paths:` globs (both match `**/*.ts`, `**/*.tsx`, `**/*.js`, `**/*.jsx`) and overlapping content (immutability, Zod validation at boundaries, API-route auth/rate-limiting, error handling appear in BOTH). For a TS+React file both inject, producing redundant guidance. Consolidation candidate: factor the shared API/validation/immutability guidance to one file and keep React-specific (Server/Client Components, hooks) separate. |
| LOW | substrate | optimization | `packages/skills/rules/core/research-mode.md` | The always-on `research-mode.md` (15 lines) and the on-demand `research-mode` skill it points to overlap heavily; the rule is essentially a 7-bullet teaser for the skill. Defensible (always-on reminder vs deep workflow), but candidate for compression now that the same anti-hallucination constraints also live in the `honesty-auditor` persona contract. |
| INFO | substrate | smell | `packages/skills/rules/` install path | Rules are NOT in the plugin manifest (`plugin.json` declares only `commands` + `skills` + `hooks`); they install via the separate `install.sh --rules` to `~/.claude/rules/toolkit/`. This two-track install (plugin-update for commands/skills/hooks; `install.sh --rules` for rules) is correct and documented in MEMORY, but means a `claude plugin update` alone never refreshes rules — a real operational footgun for anyone who forgets the `--rules` sync. Documented, low-risk, flagged for completeness. |
| INFO | function | smell | `packages/skills/commands/security-audit.md` line 3 / `review.md` | `security-audit.md` delegates the review to the read-only `hacker` agent and explicitly reserves the Write-capable `security-auditor` for remediation only — correctly implementing `workflow.md` Rule 3 (read-only personas for review). No contradiction; noted as a positive consistency check between a command and the rule it implements. |
