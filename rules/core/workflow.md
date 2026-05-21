# Development Workflow

Per ADR-0005 slopfiles authoring discipline, sections below are wrapped in `<important if "task involves X">` predicates — apply each section only when its predicate matches the current task.

<important if "task involves git commits, PRs, or branch operations">

## Git Conventions

- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
- Branch naming: `feat/short-description`, `fix/short-description`
- PRs should be reviewable in one sitting (< 400 lines changed when possible)
- Never force-push to shared branches without explicit confirmation

</important>

<important if "task involves running or writing tests">

## Testing Expectations

- Test new code paths — untested code is unfinished code
- 80%+ coverage for critical paths (auth, payments, data mutations)
- Integration tests for data flows crossing boundaries (API → DB → response)
- Run the full test suite before marking work complete

</important>

<important if "task involves code review">

## Code Review Standards

- No self-merge on shared repositories
- Review checklist: security → correctness → performance → readability
- Only flag issues you are > 80% confident about
- Consolidate similar findings (not 5 separate "missing error handling" notes)

</important>

<important if "task involves deploying or release">

## Deploy

Before deploying, follow the deploy-checklist skill for the full pre-deployment verification workflow.

</important>

<important if "task involves multi-file changes (≥2 distinct files)">

## Plan-Before-Edit Discipline (H.7.9 + GAP-B 2026-05-20 + GAP-G 2026-05-21 — mechanism-flexible + hook-enforced in headless)

Multi-file work must produce a **plan artifact** BEFORE the first Edit/Write/MultiEdit call. The mechanism is mode-dependent — the discipline is "plan before editing", not "use a specific tool":

- **Interactive sessions**: prefer the `EnterPlanMode` tool. It triggers the user-approval dialog and is the canonical signal.
- **Headless `claude -p` sessions**: the `EnterPlanMode` tool is **deterministically denied** by the v2.5.1 `redirect-plan-mode-in-headless.js` hook (PreToolUse:EnterPlanMode). The approval dialog after ExitPlanMode hangs in headless mode (no user to approve), causing the session to terminate with `stop_reason=end_turn` before any Edits execute — discovered as GAP-G in the v2.5.0 bench scenario 04 (11 turns + architect spawn + plan-file written but target file unchanged). The hook redirects to:
  - A `TodoWrite` invocation with ≥2 todos covering the phases of the planned work, OR
  - A plan-file at `.claude/plans/<slug>.md` matching `swarm/plan-template.md` schema, OR
  - Direct execution (for single-file or trivial tasks where the route-decide gate returns `root`)

**Rules of thumb**:
- Any task touching ≥2 distinct files → produce a plan artifact first (interactive: tool call; headless: file or TodoWrite)
- Single-file changes, doc-only edits, trivial fixes → skip plan artifact
- When in doubt: produce the artifact (cheap insurance, expensive to skip)

**Why the rule decouples intent from mechanism**: the prior rule said "enter plan mode" (a specific tool call). Bench audit 2026-05-20 surfaced that in headless mode Claude consistently satisfied the INTENT (spawned architect+code-reviewer; used TodoWrite for phase tracking) but skipped the literal `EnterPlanMode` tool because its approval dialog has no use under `-p`. The new rule honors the discipline while acknowledging the platform reality.

### `/plan` vs `/build-plan` decision tree (H.7.9)

- `/plan` — single-architect planner agent delegate; trivial-to-medium scope; thin 13-line command body
- `/build-plan` — HETS-aware variant; runs `route-decide.js` as Step 0; recommends architect spawn when `convergence_value ≥ 0.10` (post-context-mult); writes plans matching `swarm/plan-template.md` schema. Use for multi-file substantive work with non-obvious tradeoffs.
- Both coexist (additive, not replacement). Step 0's `root` recommendation in `/build-plan` redirects cleanly to `/plan`.

### Drift-note convention (H.7.9)

- During plan-mode work, capture observations of soft-norm drift in a `## Drift Notes` section of the plan file. Examples: "almost skipped plan mode for this one because it 'felt' single-file but turned out to touch 4 files"; "route-decide returned `root` but task is genuinely architectural — dictionary-expansion candidate".
- Drift notes feed the auto-loop's session-end review (`rules/core/self-improvement.md`).
- Per the H.7.9 meta-discipline directive: conversations and tasks are the primary plugin testing framework; pattern-emergence observations promote to substrate refinement.

</important>

<important if "task involves substantive rewrite of substrate code (≥80 LoC) AND existing tests describe behavior that will change">

## TDD-Treatment Discipline (v2.6.1 codification — ADVISORY, not always-on)

For substantive substrate rewrites where existing tests describe behavior that will be invalidated by the rewrite, apply test-first discipline:

1. **Rewrite the test file first** describing the NEW desired behavior. Do not touch impl yet.
2. **Run tests against current impl** — expect failures. The failing-test set IS your behavioral spec.
3. **Architect pair-run** with the failing-test set as the design contract.
4. **Impl minimum code** to make all tests pass. No scope creep beyond the test set.
5. **Code-reviewer pair-run** for resource/edge-case coverage (the bugs tests typically miss: fd leaks, edge boundaries, concurrency, fragility).

**Load-bearing benefit** (per v2.6.0 EXPERIMENT-LOG.md verdict): **spec clarity** — failing tests = exact behavioral contract upfront, anchoring both architect and reviewer to a single source of truth. NOT rework-loop reduction (data: TDD-treatment and baseline both hit 1 rework loop on the same gap class; both depended on code-reviewer pair-run for non-functional bug catches).

**Skip this discipline when**:
- Pure mechanical changes (rename, refactor) with no behavior change
- Exploratory work where the right behavior is itself unclear (TDD requires a known-good spec)
- Single-file utility scripts with no existing test contract
- Hotfix or trivial patch (<80 LoC, single edge case)

**Origin**: v2.6.0 GAP-F signal redesign was the first explicit TDD-treatment data point in a discipline experiment deferred ~10 days. Full Phase 1-5 metrics in `bench/EXPERIMENT-LOG.md`. Decision-criteria verdict was inconclusive on rework reduction but clear on spec-clarity benefit — hence advisory not always-on.

</important>

<important if "task involves substrate-meta work (routing scorer, hook authoring, validator authoring, dictionary expansion, forcing-instruction class taxonomy)">

## Hook layer placement (H.7.19)

When adding a new validator hook to `hooks/hooks.json`, default to **PostToolUse** unless the hook MUST block to prevent silent-failure or security violation.

**Decision tree** (matches `skills/agent-team/patterns/validator-conventions.md` Convention D):

- **PreToolUse** when: silent-failure prevention (skill won't load, stale-state edit), security gate (secrets, protected configs), or recovery is hard/expensive
- **PostToolUse** when: advisory linting, schema reminders, style suggestions — anything where the user can iterate

**Common deviation to avoid**: H.7.12 chose PreToolUse for `validate-plan-schema.js` because the toolkit had zero PostToolUse:Write entries at the time. This was a conservative misreading — "no examples in our toolkit" ≠ "not supported by Claude Code." H.7.17 corrected the deviation after `claude-code-guide` consultation confirmed PostToolUse:Write works.

**Lesson**: when uncertain about Claude Code hook semantics, consult the official docs (or `claude-code-guide` agent — drift-note 24) rather than inferring from absence in our codebase.

## Schema-level questions (H.7.23)

When a question concerns Claude Code's plugin manifest, settings.json schema, marketplace.json schema, or any other Claude Code configuration schema, **route through `general-purpose` subagent + `WebFetch` on `code.claude.com/docs`** rather than `claude-code-guide`.

**Why** — H.7.22's three install-failure hotfixes (H.7.22.1/2/3) all happened because the `claude-code-guide` subagent gave wrong/conflicting advice on plugin manifest schema. The first round it confirmed `"./"` for marketplace source (correct). The second round it suggested `"agents": "agents"` (wrong — schema requires `^\./.*` regex; the right answer is to omit the field entirely since auto-discovery handles the default location).

The general-purpose agent + `WebFetch` against canonical docs (`https://code.claude.com/docs/en/plugins-reference.md`, `https://www.schemastore.org/claude-code-plugin-manifest.json`) + cross-reference with working anthropic plugins (`anthropics/claude-plugins-official` like `code-review`, `feature-dev`) is the source-of-truth path for schema questions.

**`claude-code-guide` is fine for** — Claude Code behavior questions (hook semantics, slash command precedence, MCP server discovery, etc.). Just not schemas.

**Drift-note 43 codified** — schema source-of-truth.

</important>

<important if "task involves markdown authoring">

## Markdown emphasis discipline (H.7.18)

When writing markdown (`.md` files), wrap underscore-bearing tokens in backticks. The markdown emphasis parser sees `_token_` as italic emphasis. When unbackticked tokens like `HETS_TOOLKIT_DIR`, `_h70-test`, `_lib/`, `RUN_STATE_BASE`, or `_readPersonaContract` appear in the same paragraph as another underscore (with whitespace between), markdownlint MD037 ("no-space-in-emphasis") triggers and CI fails.

Token shapes that need backticks:

- **Env-var-style** (multi-underscore uppercase): `HETS_TOOLKIT_DIR`, `CLAUDE_PLUGIN_ROOT`, `RUN_STATE_BASE`, `WEIGHTS_VERSION`, `MODULE_NOT_FOUND`
- **Underscore-prefixed identifier**: `_h70-test`, `_lib/file-path-pattern`, `_readPersonaContract`, `_log.js`
- **Snake-lower** in dense paragraphs: `weights_version`, `route_decision` (only when paired)

Examples:

```markdown
❌ HETS_TOOLKIT_DIR || path.join(process.env.HOME, ...)
✓  `HETS_TOOLKIT_DIR` || `path.join(process.env.HOME, ...)`

❌ tests passed: 41/41 _h70-test; 0 contract violations
✓  tests passed: 41/41 `_h70-test`; 0 contract violations
```

The H.7.18 `validate-markdown-emphasis.js` PostToolUse hook detects this pattern and emits `[MARKDOWN-EMPHASIS-DRIFT]` for awareness. The hook is forward-looking; it doesn't auto-fix existing markdown.

</important>

<important if "task involves CI workflow or install.sh changes">

## CI infrastructure changes (H.7.15)

- When adding CI workflows, install scripts, or other infrastructure that runs only at merge time / install time / CI time, **validate against a clean / non-author environment before merging**. The H.7.8 CI bug (PR #79 H.7.9 surfaced it: `bash install.sh --test` tested already-installed hooks at `$CLAUDE_DIR/hooks/scripts/`, which doesn't exist on a fresh CI checkout) and the `install_hooks` subdir-glob bug (H.7.12 surfaced it: `validators/` and `_lib/` subdirectories were never being copied) BOTH shipped because the original phases never ran the new infrastructure against a fresh environment.
- **Dogfood discipline**: try the new workflow as if you were a new contributor / fresh CI runner / minimal-install user. Specifically: (1) run install.sh on a path that doesn't already have ~/.claude populated, OR (2) push the change to a feature branch and let CI run against a clean checkout BEFORE merging to main.
- For subdir-related changes: explicitly verify subdirectories are copied (`ls $CLAUDE_DIR/<dir>/<subdir>/` should show files), not just the top-level glob.
- Pattern audit: when extending an install step or CI workflow, scan the related code for similar single-level-glob assumptions (`for f in dir/*.js` vs `cp -r dir/`).

</important>

<important if "task involves invoking /build-team or sub-agent orchestration">

## Route-Decision for Non-Trivial Tasks

- Before invoking `/build-team` or spawning sub-agents for a user task, run `node ~/Documents/claude-toolkit/scripts/agent-team/route-decide.js --task "<task>"` to get a routing recommendation
- Recommendation `route` → spawn the team / use HETS orchestration
- Recommendation `root` → answer directly; do not spawn sub-agents (over-routing wastes ~30× tokens for ~3× failure-mode coverage on trivial tasks)
- Recommendation `borderline` → surface the score decomposition to the user and let them pick; do not silently default
- Skip the gate when: task is invoked via `/chaos-test` (pre-routed), task is purely informational ("explain X"), task is a confirmation of a previously-discussed action ("yes, ship it"), task includes `--force-route` flag
- When in doubt: the gate is cheap (<100ms, deterministic). Run it. The decomposition alone is useful for explaining the routing decision to the user.
- **H.7.5 — When invoking on a conversation continuation**: ALWAYS pass `--context "<last assistant response excerpt>"` (max ~2K chars; bounded to last 1-3 turns). The bare task often strips the routing signal that lived in the prior recommendation; context restores it. Borderline-promotion rule fires when context has signal but bare task doesn't.
- **H.7.5 — If output emits `[ROUTE-DECISION-UNCERTAIN]`**: do NOT silently default to root. Either re-invoke with `--context "<prior turn>"`, or surface to user for explicit `--force-route` / `--force-root` choice. The forcing instruction means the heuristic abstained, not that root was the answer.
- **H.7.5 — Prompt design tip**: when crafting the gate's task string, embed the routing signal explicitly (e.g., "implement weighted-formula refit per H.7.4 plan via orchestration" beats bare "empirical refit"). Surface keywords help the deterministic layer; don't rely on the forcing-instruction fallback for cases where you already know the answer.
- **H.7.16 — When output emits `[ROUTE-META-UNCERTAIN]`**: the task references substrate-meta tokens (`route-decide`, `weights_version`, `dict expansion`, `keyword set`, `forcing instruction`, etc.). The score may be biased low by the **substrate-meta routing catch-22** — when the proposed change modifies the routing scorer itself, the score above was computed using the CURRENT dictionary, which may not yet contain the tokens the proposed change would add. Apply judgment: if task is genuinely architect-shaped, escalate via `--force-route` or architect spawn (per `route-decide.js:11-13` load-bearing comment); if mechanical implementation of an already-decided design, current recommendation likely correct. The forcing instruction is advisory and does NOT alter the score or recommendation — score-additive guarantee preserved.
- **H.7.16 — Co-firing**: `[ROUTE-META-UNCERTAIN]` can fire alongside `[ROUTE-DECISION-UNCERTAIN]` (zero signals AND substrate-meta detected) and alongside any recommendation tier. The two are independent; both can appear in the same JSON output.

</important>

<important if "task involves Hardening Track or HETS-routed phase">

## Pre-approval verification (H.7.23)

**For HETS-routed phases**, run `/verify-plan` before `ExitPlanMode`. The verification spawns architect + code-reviewer agents in parallel against the plan file, catches concrete bugs and plan-honesty issues, and appends a `## Pre-Approval Verification` section to the plan with structured findings.

**Codifies drift-note 40**: pattern that caught 4 HIGH/CRITICAL bugs in H.7.22, 5 substantive issues in H.7.23, and 8 issues (1 FAIL + 7 FLAGs) in H.7.24. In all three cases, the verification was estimated at ~10-15 minutes and prevented hotfix rounds. The pattern continues to pay for itself within the same phase.

**Principle codification scope (H.7.22 + H.7.24)**: foundational principles (SOLID/DRY/KISS/YAGNI) referenced from Layer 1 are codified across `agents/architect.md` (Layer 1+2 reference), `agents/planner.md`, `agents/code-reviewer.md`, `agents/optimizer.md`, `agents/security-auditor.md` (Layer 1 only). Persona contracts `04-architect.contract.json` (F6), `03-code-reviewer.contract.json` (F7), `12-security-engineer.contract.json` (F10) require explicit Principle Audit / Principle keyword presence in spawned actor output. Future agents that are design-shaped should follow architect's Layer 1+2 pattern (per drift-note 53 — captured H.7.24).

**When the rule applies** — plan contains `## HETS Spawn Plan` (with substantive content, NOT "N/A") OR `Routing Decision` JSON has `"recommendation": "route"`. The plan-schema validator enforces this gate at PostToolUse — `[PLAN-SCHEMA-DRIFT]` fires if the section is missing.

**When it doesn't apply** — `root`-routed plans, hotfixes shipped without plan mode, doc-only edits. The validator's `requiresPrincipleAudit()` gate matches the same condition for both Principle Audit and Pre-Approval Verification.

**Trust model** — section presence is taken as evidence of work having been done; strict spawn-verification was rejected as brittle (timestamps drift, run-IDs editable, tampering undetectable). The validator forces procedural discipline, not tamper-proof audit.

See `commands/verify-plan.md` for the slash command, `skills/verify-plan/SKILL.md` for the procedure.

</important>
