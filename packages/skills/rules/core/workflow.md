# Development Workflow

Per ADR-0005 slopfiles authoring discipline, sections below are wrapped in `<important if "task involves X">` predicates — apply each section only when its predicate matches the current task.

<important if "task involves git commits, PRs, or branch operations">

## Git Conventions

- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
- Branch naming: `feat/short-description`, `fix/short-description`
- PRs should be reviewable in one sitting (< 400 lines changed when possible)
- Never force-push to shared branches without explicit confirmation
- To read a file at another ref, use `git show <ref>:file` — **never `git stash` in a worktree** (a stash in a `claude -p`-wrapped worktree can corrupt the shared object store; `git fetch --refetch` is the recovery).
- For parallel / per-wave work use `git worktree add <dir> origin/main` — **never `git checkout -b` in a shared main checkout** (a concurrent session may share that tree; staged files can be swept into the wrong commit).
- Base a new PR branch on **fresh `origin/main`, never off a stale feature branch** (a `git reset --soft origin/main` off a stale base stages spurious deletions of files other PRs already merged).

</important>

<important if "task involves running or writing tests">

## Testing Expectations

- Test new code paths — untested code is unfinished code
- 80%+ coverage for critical paths (auth, payments, data mutations)
- Integration tests for data flows crossing boundaries (API → DB → response)
- Run the full test suite before marking work complete
- **Immutability of read paths** (2026-06-08): for a store/layer that returns objects parsed from disk/JSON, test the immutability of the **read-back / dedup / update** return paths — not just the freshly-constructed record. A shallow `Object.freeze` of a parsed row leaves its nested arrays/objects mutable; this leak bit twice (a Lab store's `listProposals` / `listEdges` returning unfrozen rows after the construct-path was already frozen).

</important>

<important if "task involves code review">

## Code Review Standards

- No self-merge on shared repositories
- Review checklist: security → correctness → performance → readability
- Only flag issues you are > 80% confident about
- Consolidate similar findings (not 5 separate "missing error handling" notes)

### Async review-bot gate — don't trust the status-check (2026-06-08)

When a PR is reviewed by an **async bot** (e.g. CodeRabbit), a green or "skipped" status-check is **NOT** the signal that review finished — the bot posts findings minutes later, on a different surface than the status-check reflects (the check can read `pass | Review skipped` while real findings exist). Before reporting a PR clean:

1. **Fetch the bot's ACTUAL review surface** — inline review comments + review bodies + the walkthrough — not the status-check state, and not the issue-timeline alone (the actionable inline findings live on the pull-request comments surface, not the issue timeline).
2. **POLL until the bot's review actually posts** — a green CI run is not the signal; the bot re-reviews after each push, and a later review can add new findings.
3. **Premise-probe each finding firsthand before folding** — some are false positives; verify the claim against the code before changing anything.

Reporting "0 actionable" on a green check alone has twice let real findings (including a Major bug) reach merge unreviewed. The project-specific fetch commands (the exact `gh api .../pulls/N/comments` + `/reviews` calls) live in the project's memory, not in this global rule.

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
  - A plan-file at `.claude/plans/<slug>.md` matching `packages/specs/research/plan-template.md` schema, OR
  - Direct execution (for single-file or trivial tasks where the route-decide gate returns `root`)

**Rules of thumb**:
- Any task touching ≥2 distinct files → produce a plan artifact first (interactive: tool call; headless: file or TodoWrite)
- Single-file changes, doc-only edits, trivial fixes → skip plan artifact
- When in doubt: produce the artifact (cheap insurance, expensive to skip)

**Why the rule decouples intent from mechanism**: the prior rule said "enter plan mode" (a specific tool call). Bench audit 2026-05-20 surfaced that in headless mode Claude consistently satisfied the INTENT (spawned architect+code-reviewer; used TodoWrite for phase tracking) but skipped the literal `EnterPlanMode` tool because its approval dialog has no use under `-p`. The new rule honors the discipline while acknowledging the platform reality.

### `/plan` vs `/build-plan` decision tree (H.7.9)

- `/plan` — single-architect planner agent delegate; trivial-to-medium scope; thin 13-line command body
- `/build-plan` — HETS-aware variant; runs `route-decide.js` as Step 0; recommends architect spawn when `convergence_value ≥ 0.10` (post-context-mult); writes plans matching `packages/specs/research/plan-template.md` schema. Use for multi-file substantive work with non-obvious tradeoffs.
- Both coexist (additive, not replacement). Step 0's `root` recommendation in `/build-plan` redirects cleanly to `/plan`.

### Drift-note convention (H.7.9)

- During plan-mode work, capture observations of soft-norm drift in a `## Drift Notes` section of the plan file. Examples: "almost skipped plan mode for this one because it 'felt' single-file but turned out to touch 4 files"; "route-decide returned `root` but task is genuinely architectural — dictionary-expansion candidate".
- Drift notes feed the auto-loop's session-end review (`rules/core/self-improvement.md`).
- Per the H.7.9 meta-discipline directive: conversations and tasks are the primary plugin testing framework; pattern-emergence observations promote to substrate refinement.

### TDD-Treatment Discipline (v2.6.1 codification — ADVISORY sub-rule)

When the multi-file change is ALSO a **substantive substrate rewrite (≥80 LoC) where existing tests describe behavior that will change**, apply test-first discipline in addition to the plan artifact:

1. **Rewrite the test file first** describing the NEW desired behavior. Do not touch impl yet.
2. **Run tests against current impl** — expect failures. The failing-test set IS your behavioral spec.
3. **Architect pair-run** with the failing-test set as the design contract.
4. **Impl minimum code** to make all tests pass. No scope creep beyond the test set.
5. **Code-reviewer pair-run** for resource/edge-case coverage (fd leaks, edge boundaries, concurrency, fragility — the bugs tests typically miss).

**Load-bearing benefit** (per v2.6.0 EXPERIMENT-LOG.md verdict): **spec clarity** — failing tests = exact behavioral contract upfront, anchoring both architect and reviewer to a single source of truth. NOT rework-loop reduction (data: TDD-treatment and baseline both hit 1 rework loop on the same gap class; both depended on code-reviewer pair-run for non-functional bug catches).

**Skip TDD-treatment** even when in plan-mode if: pure mechanical changes (rename, refactor) with no behavior change; exploratory work where the right behavior is itself unclear; single-file utility scripts with no existing test contract; hotfixes <80 LoC.

**Origin**: v2.6.0 GAP-F signal redesign was the first explicit TDD-treatment data point in a discipline experiment deferred ~10 days. Full Phase 1-5 metrics in `bench/EXPERIMENT-LOG.md`. Bundled into Plan-Before-Edit (vs a parallel predicate block) per T76 anti-over-conditionalization ceiling — TDD-treatment is a SUB-rule of Plan-Before-Edit, not a parallel discipline.

### Runtime-Claim Probe Discipline (v3.0-alpha codification — ADVISORY sub-rule)

When a plan contains a **claim about current substrate state** — "file X exists", "hook Y fires on Z", "the spawn carries `tools[]`", "CI gate W is present", "directory is empty" — the plan MUST cite a **probe** (one-line grep, runtime invocation, test output, or file `ls`) that verifies the claim against the actual repo/runtime BEFORE impl acts on it.

**Form**: inline `Probe: <command> → <observed result>` next to the claim, or a dedicated `## Runtime Probes` section listing each (claim, probe, result) tuple.

**Why**: plan prose absorbs premises from recon, prior PRs, or architect/reviewer reasoning. Premises decay (repo state moves) and abstract reasoning skips empirical verification. The failure mode is: a reviewer blesses a runtime claim abstractly → impl discovers it is wrong → mid-flight design change OR a substrate-bricking near-miss. **Multi-reviewer blessing is NOT runtime verification.**

**Harness-capability extension (ADR-0012 codification — 2026-06-03)**: the probe requirement extends from "claims about *substrate* state" to "claims about *harness* behavior" — "a PreToolUse hook's `updatedInput` mutates the Agent spawn", "`WorktreeCreate` can be passively observed", "the close payload carries a `parent_tool_use_id`", "`cp -r dir/*` drops nested subdirs". These are the most dangerous claim-class: **building enforcement on an assumed harness mechanism that does not exist bricks the substrate** (a past control, `pre-spawn-tool-mask`, shipped INERT because a PreToolUse hook's `updatedInput` is inert on Agent/Task spawns — see ADR-0012 at `packages/specs/adrs/0012-*.md`). The probe is a throwaway `claude -p` spike, a `/tmp` git experiment, or a one-line harness invocation that exercises the actual mechanism — **and you must test the PATH that exercises it**, not an adjacent path (the "probe-the-path" discipline). **Multi-reviewer blessing verifies internal logic against the CODE, never the harness** — an architect+reviewer board can bless a design whose load-bearing premise is a harness capability that was never empirically confirmed.

**Status-decay sibling**: a present-tense status / calibration / causal claim in any LIVING doc (ROADMAP / RFC / MEMORY / plan / code-comment) decays like a stale line-number — re-probe it against the repo before trusting or citing it, and refresh via a dated accretion rather than trusting the frozen word (a doc froze "X is unbuilt" → the thing shipped hours later → the status word was never refreshed; a "sums to 1.00" comment that was actually 1.15).

**Skip the probe** for: FUTURE-state claims ("PR 3 will introduce K9"); claims already backed by a same-session probe logged in the plan; pure-design claims with no runtime referent ("the simplest factoring is X").

**Gate**: `/verify-plan` architect spawn (Check #9) FLAGs un-probed runtime claims; NEEDS-REVISION if any FAIL.

**Origin**: `drift:plan-honesty` converged at 3 → graduated 2026-05-30 (PR-1 verify-plan R1/R2 plan-vs-repo-state mismatches + PR-2 F2, the `tools[]` blessed-resolution-vs-runtime contradiction that would have bricked the spawn substrate as a literal block; resolved as audit-not-block). The same-day self-improve audit surfaced two more instances — the 2026-05-26 postmortem's un-probed "disabled 2 of 3 hooks" claim (the live manifest still wired all three) and an option-description's "retire the Stop hook" (the hook is dual-purpose: it also does prompt-pattern capture). Full lineage in `library/sections/toolkit/stacks/ghost-protocol/volumes/drift-taxonomy.md`. Bundled into Plan-Before-Edit per T76 — a SUB-rule, not a parallel discipline.

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

This discipline is enforced by **CI markdownlint `MD037`** (`no-space-in-emphasis`), which runs `markdownlint-cli2` over `**/*.md` (`.github/workflows/ci.yml`) and fires on exactly this cluster pattern. A dedicated `validate-markdown-emphasis.js` PostToolUse hook originally flagged it at edit-time (H.7.18, emitting `[MARKDOWN-EMPHASIS-DRIFT]`), but it was **retired at H.7.27** once an empirical check confirmed `MD037` catches the same pattern — the lint pipeline absorbs the detection at PR time, so the hook was redundant (YAGNI). The discipline is forward-looking: wrap the tokens as you write; CI catches a miss.

## Markdown list-marker discipline (MD004 — the wrapped `+`/`-` trap)

A wrapped prose line whose continuation BEGINS with a bare list marker (`+`, `-`, or a digit-dot `N.`) plus a space is parsed by markdownlint as a list item. When such a stray marker appears in a doc that otherwise uses one bullet style, `MD004` (`ul-style`, "consistent") takes the FIRST marker as canonical and fails CI on every other bullet (`Expected: plus; Actual: dash`, or the reverse). The trap is invisible while authoring: it only bites when a sentence like "confirm the direction + that X" wraps so `+ that X` lands at the start of the next line.

Avoid it: when a `+`/`-`/digit-dot token would fall at the start of a wrapped line, reword (`+` to "and"/"plus"; `-` to "minus"/"to"), keep the token mid-line, or wrap it in backticks (a code span never parses as a marker).

Enforced by **CI markdownlint `MD004`** (same `markdownlint-cli2` over `**/*.md` pipeline as `MD037`). Forward-looking, exactly like the emphasis discipline above: write the prose so no wrapped line opens with a bare list marker; CI catches a miss. Recurred 3x in v3.x plan/ROADMAP authoring (the W1/W2a/W3a dry-run plans) before codification.

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

- Before invoking `/build-team` or spawning sub-agents for a user task, run `node ~/Documents/claude-toolkit/packages/kernel/algorithms/route-decide.js --task "<task>"` to get a routing recommendation
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

### Persona-selection discipline (2026-06-03)

The named archetypes below — `architect`, `code-reviewer`, `hacker`, `honesty-auditor`, `security-auditor`, `node-backend`, … — are **`agentType` values the Agent tool accepts** (one definition per file under `agents/<name>.md`; "persona", "archetype", and "agentType" all mean the same thing here). Each one's Write/Edit capability is declared in its `agents/<name>.md` frontmatter `tools:` — **check there**, don't rely on a memorized list.

**Rule 1 — prefer a named archetype over `general-purpose` for any substantive substrate spawn.** Route by the LENS the task needs, *not* the tech domain (don't pick `react-frontend` just because the file is React). The constrained lens catches failure modes a generic pass misses, and `agentType` + schema is StructuredOutput-reliable where `general-purpose` + schema occasionally isn't. Lens-by-task-shape: correctness/quality → `code-reviewer`; design/trade-offs → `architect`; adversarial-security → `hacker`; claim-vs-evidence → `honesty-auditor`; build → `node-backend` (or the domain builder).

**Rule 2 — review/verify of kernel / security / auth / data-mutation diffs MUST fan out the full 3-lens tier in parallel:** `code-reviewer` (correctness) + `hacker` (adversarial-security) + `honesty-auditor` (claim-vs-evidence). This is REQUIRED only for that high-stakes class — for lower-stakes review, **one** archetype lens is enough (don't over-spawn). (Validated across 5 substrate arcs; see MEMORY topics `multi-reviewer-discipline` / `hets-persona-lens-over-domain`.)

**Rule 2a — for that class, the `hacker` lens re-probes the BUILT code at VALIDATE, not just the plan at VERIFY.** The adversarial pass BUILDS LIVE PROBES (throwaway `node` / `claude -p` scripts that exercise the actual modules), against the *built* diff at the post-build VALIDATE — **a clean TDD suite is NOT proof of safety.** The pre-build VERIFY hacker reasons about the *design*; the VALIDATE hacker attacks the *implementation*, and the two catch different bugs. (v3.6 W2a #270: a post-TDD **CRITICAL** — a superset poison-key decoy beating a subset `.includes` post-condition — *and* a **HIGH** — an IDOR gate matching a `kernel:` persona shape no live record carries [the real one is `kernel-loom-integrator`] — surfaced ONLY on the hacker's re-probe of the BUILT code, *after* the build's own 28-test suite passed. A *different* CRITICAL had already been caught at pre-build VERIFY — the re-probe is additive, not redundant.)

**Rule 2a-corollary — a green mock/unit suite is a HYPOTHESIS about the path it MOCKS, never proof the REAL path works; a live dogfood on the real path (network / LLM / sandbox / FS / a stranger's repo) gates any "it works" claim** (generalizes Rule 2a's "a clean TDD suite is NOT proof" from the security lens to plain correctness). The mock-vs-real gap is exactly where the bugs hide — recurred 3× in v3.9: (1) W2 a full-suite gap only the dogfood caught; (2) W3 an F4 basename half-fix — 37 unit tests GREEN, the bug surfaced ONLY on the Rule-2a re-probe of the BUILT code against the REAL `claude -p` capture; (3) the v3.9.x real-E2E run — the sandbox denies every temp dir so pytest dies without a `TMPDIR` redirect, AND the leg-B/C judges swallowed every fenced verdict for lack of a `JSON.parse` fence-strip (a mock judge returns clean JSON, so no unit test could see either). And **premise-probe your OWN mitigation, not just the design** — a fix is itself an unprobed claim until its real path runs (W3 shipped a `cloneRoot` fix that had no producer anywhere).

**Rule 3 — review/verify passes use read-only personas, never Write-capable ones.** `architect` / `code-reviewer` / `honesty-auditor` / `hacker` are read-only (per their `tools:`); wiring a Write-capable persona (`security-auditor` / `node-backend`, which have `Write`/`Edit` in `tools:`) into a *review* pass invites scope leak — the reviewer "fixes" mid-review, conflating audit with mutation. If a review surfaces a change, the orchestrator applies it; the reviewer only reports. (2 clean lifecycles.)

**Rule 4 — record the VALIDATE board's verdicts when (and only when) the build was DELEGATED (v3.8a W4 — the advisory loop's producer step).** After the VALIDATE board on a **delegated, delta-bearing build** (the spawn close carried `agentId` in `tool_response` — observe-not-allocate, OQ-21), batch-record the board's verdicts ONCE per board: `node <repo>/packages/lab/verdict-attestation/cli.js record-review --subject-persona <builder persona> --agent-id <agentId> --review "<verifier-identity>|<kind>|<verdict>" [--review ...]`. It AUTO-enriches (agentId → kernel txid) — no separate `enrich` call. Run `node <repo>/packages/lab/reputation/cli.js materialize` ONCE at wave-close (or before consulting the snapshot), never per record. **The verifier convention (load-bearing — the store validates format, not roster)**: `verifier-identity` = the HETS roster shape `NN-persona.<roster-name>` (e.g. `03-code-reviewer.nova`); `kind` = the LENS — `structural` / `adversarial-security` / `claim-vs-evidence`. **`--subject-persona` = the Agent-tool `agentType` string verbatim** (e.g. `node-backend`) — the spawn's actual selector, what persona-selection reasons about; the legacy v3.4-W6 rows used the HETS-numbered form (`13-node-backend`) and group separately (a known, named seam — do not re-record to "fix" it; the dogfooded first Rule-4 execution surfaced it). **Root-built diffs record NOTHING** — only a delegated builder spawn is a legal subject (the v3.4 W6 canon: the subject is the delta-bearing BUILDER, never the verifier; recording the orchestrator's own build would forge the subject link). **Record into the Lab verdict-attestation store ONLY** (the evidence-linked, §0a.3.1-clean track); the runtime `agent-identities`/pattern-recorder counter is a SEPARATE track — Rule 4 deliberately does NOT dual-write. The HOW + the consumer convention (reputation snapshot + breaker check before delegated spawns) live in `skills/agent-team/patterns/agent-identity-reputation.md` — this rule is the producer-side WHEN.

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

## Phase-close verification gate (2026-06-03 — USER-proposed; the post-phase analog of /verify-plan)

At a **v3.x phase boundary** (a phase declared complete, or a plugin-version bump), run **`/phase-close <phase>`** BEFORE declaring done. It spawns three independent full-context, in-substrate lenses in parallel — **PM** (`honesty-auditor` — exit-criteria delivery + claim-vs-evidence), **Principal-SDE** (`code-reviewer` at phase altitude — cross-PR integration seams + accumulated debt, NOT a per-diff re-review), **Architect** (phase design soundness + forward-contract readiness for the next phase's consumer) — to review the **INTEGRATED phase against its exit criteria**, and writes a `## Phase-close sign-off` record (ROADMAP + a `toolkit/phase-close` library volume).

**Why it's distinct from the per-wave VALIDATE + `/verify-plan`**: those verify a single plan/diff; only the phase gate is positioned to catch **cross-PR drift** (a contract that drifted between PRs), **accumulated debt** (merged-but-dark, deferred pile-up), and **phase-claim honesty** (complete vs exit-criteria-actually-met). Precedent: the v3.1 phase-close sign-off (PM + principal architect, both CLOSEABLE — `docs/ROADMAP.md`). It fires ONCE per phase (coarse) → cheap relative to its catch.

**Ghost-protocol tie-in (advisory monitor, NOT hook-enforcement)**: the gate feeds `improvement-effectiveness:phase-close` when it catches fresh cross-PR drift; a phase boundary crossed WITHOUT a record bumps `drift:phase-close-skipped` (at session-end / pre-compact), surfaced for `/self-improve` triage at convergence (`drift:` convergence is MANUAL per the ghost taxonomy — tracked visibility, not a hard block). Hard enforcement (a kernel hook on the version bump) is a future escalation.

**When it does NOT apply**: a single PR / sub-wave (the per-wave VALIDATE covers that — do NOT re-litigate per-PR diffs at the phase gate).

See `commands/phase-close.md` + `skills/library/phase-close/SKILL.md`.

</important>
