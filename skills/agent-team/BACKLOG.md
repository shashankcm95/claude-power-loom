# Agent Team — Backlog

Deferred work from prior phases, captured here so nothing important gets silently dropped. Each entry: scope, rationale, dependencies, rough estimate.

## Phase H.4.2 — validator hooks + trust formula transparency — SHIPPED

**Status**: shipped. Two hook-layer validators + one pattern-doc clarification, deferred from the original H.4.1 scope so H.4.1 could ship the auto self-improve loop in isolation.

What landed:
- **`hooks/scripts/validators/validate-no-bare-secrets.js`** (PreToolUse:Edit/Write)
  - Blocks writes containing secret-shaped literals
  - Patterns: Anthropic API keys, Stripe live + restricted keys, Slack tokens, GitHub PATs, AWS access key IDs, JWT-shape tokens, `*_(SECRET|KEY|TOKEN|PASSWORD)=<value>` assignments
  - Skip list: `.env.example`, `.env.template`, `tests/fixtures/`, the validator's own dir
  - Placeholder detection: `${VAR}`, `<NAME>`, `{{template}}`, repeat-char sequences, common placeholder strings
  - **Never echoes matched literals** in block reasons (log/chat hygiene)
- **`hooks/scripts/validators/validate-frontmatter-on-skills.js`** (PreToolUse:Write)
  - Blocks Write of skill / pattern .md files missing YAML frontmatter
  - Path patterns: `skills/<name>/SKILL.md`, `skills/<name>/<file>.md`, `skills/agent-team/patterns/<file>.md`
  - Skip basenames: README.md, BACKLOG.md, CHANGELOG.md
- **`patterns/agent-identity-reputation.md` Trust Formula section**
  - Documents the actual `tierOf()` from `agent-identity.js:97-104`
  - Worked examples with live identity data
  - Tier → policy mapping table
  - Known limitations: no recency decay, partial counts as miss, cliff thresholds
  - Comparison to ruflo's published `0.4·success + 0.2·uptime + 0.2·threat + 0.2·integrity`

E2E validated 8 probes (4 secrets, 4 frontmatter). Sync to `~/.claude/` parity verified. contracts-validate 0 violations.

**H.4.2 follow-ups**:
- `validators-config.json` external-pattern file (matches config-guard's pattern) — for now patterns are inlined; revisit when a 3rd validator lands
- Trust-formula tunables (partial-credit weight, recency window, MIN_VERDICTS_FOR_TIER per-persona override) — surfaced in pattern doc but not implemented

## Phase H.4 — kb_scope enforcement — SHIPPED as H.4.0

**Status**: shipped. Closes the #1 unmoved finding from both CS-1 and CS-2 architects: `kb_scope` was loaded into spawn-time prompt blocks but never enforced at verify-time. Same shape as H.2.6's `invokesRequiredSkills` precedent — contract field → transcript scan → pass/fail.

What landed:
- New `kb_scope_consumed` functional check in `contract-verifier.js` + `extractKbReadsFromTranscript` helper
- Detects 3 KB-read invocation shapes (Bash `kb-resolver cat`, Bash `kb-resolver resolve kb:<id>`, Read of `kb/<id>.md`); hash-pinned refs strip `@hash` for matching
- Rich result: `{pass, source, declared, consumed, kbReadsObserved, missingKbScope}`
- 8 contracts opted in at `required: true`: 7 builders (06-12) F9, challenger F6
- Graceful pass semantics for no-transcript / no-scope-declared (matches `invokesRequiredSkills`)
- New pattern doc `patterns/kb-scope-enforcement.md` (status: `active`)
- 5 E2E probes pass; contracts-validate 0 violations

**H.4.x follow-ups (not yet scoped)**:
- Apply the same template to other "declared but unenforced" contract fields if any surface (challenger's `_doc` field, `fallbackAcceptable` arrays — both informational today; would they benefit from enforcement?)
- Auditor contracts (01-05) currently have no `kb_scope` declared. If they should — declare + opt them in. Architect's "single source of truth" principle suggests yes.

## Phase H.3 — CS-2 regression bundle — SHIPPED as H.3.6

**Status**: shipped. 5 fixes for the 5 regressions surfaced by the second meta-validation chaos run (chaos-20260503-154327-cs2):

1. **`_lib/lock.js` self-PID deadlock** (CS-2 hacker.ren CRIT-1 + code-reviewer.jade C-1, convergent finding) — prior code's `pid !== process.pid` skip-cleanup branch deadlocked the process against its own crashed-prior-incarnation orphan until 3s timeout. Now: same-PID lock files reclaim immediately (a fresh `withLock()` call cannot legitimately be holding its own lock); also handles garbage-PID files via NaN guard.
2. **`tree-tracker.js` whole-RMW lock back-apply** (CS-2 code-reviewer.jade BLOCK) — H.3.2 fix wrapped only the WRITE in withLock, but `cmdSpawn` + `cmdComplete` do load→modify→save independently. Same race that H.3.2's own-validation probe 3 explicitly proved fatal in budget-tracker; not back-applied to tree-tracker until now. Refactored `save()` into plain `writeTreeAtomic` + `withTreeLock` helper; both callsites wrap the whole RMW. 15s timeout matches budget-tracker.
3. **`contract-verifier.js` antiPattern unknown_check** (CS-2 architect.mira HIGH, 3-line symmetry miss) — H.3.1 fixed the FUNCTIONAL path but didn't mirror to antiPattern dispatch. Symmetric fix: `severity === 'fail'` → `antiPatternFailures++`; else → `antiPatternWarns++`.
4. **`kb-resolver.js` symlink escape** (CS-2 hacker.ren CRIT-2) — H.3.2 lexical check is symlink-blind. Added `fs.realpathSync` second-pass that canonicalizes both candidate + KB_BASE then re-checks boundary.
5. **`contracts-validate.js --list-validators` human-mode parity** (CS-2 confused-user-alex MEDIUM) — `--list-validators` now respects `--json` flag; default human-readable.

E2E validated all 5 probes + kb-resolver legit-read regression check passed. Sync to `~/.claude/scripts/agent-team/` parity verified.

**Patterns surfaced for promotion**:
- **fix-class-not-instance** — when fixing a known anti-pattern, grep sibling files for the same shape. H.3.6's existence is the proof: CS-2 caught that H.3.2 fixed the RMW race in budget-tracker but didn't back-apply to immediate-adjacent tree-tracker.
- **own-validation routinely catches the bug your fix shipped with** — H.2.1 `[a-z]{1,4}`, H.2.7 closing-brace false-positive, H.2.9 case-sensitivity, H.3.2 wrap-only-write race, H.3.6 antiPattern dispatch symmetry. Codify: every script change ships with an E2E probe that exercises the change.
- **substrate-rich, call-site-poor** (architect's persistent finding) — promote to a discipline check in the patterns library: every new substrate has at least one call-site within the same phase.

## Phase H.2 (in progress)

### H.2.2 — Builder persona expansion (07-12) — SHIPPED

**Status**: shipped this turn. All 6 personas + contracts + rosters + 11 KB stubs landed.

**Bonus integration**: `knowledge-work-plugins` marketplace skills referenced via new `marketplace:<plugin>` status value in contracts (alongside `available` + `not-yet-authored`). Marketplace skills used: `engineering:incident-response` (10-devops-sre), `engineering:deploy-checklist` (multi), `engineering:debug` (multi), `engineering:testing-strategy` (multi), `engineering:system-design` (07-java-backend), `engineering:code-review` (multi), `data:sql-queries` + `data:explore-data` + `data:validate-data` + `data:statistical-analysis` (08-ml-engineer, 11-data-engineer), `design:accessibility-review` + `design:ux-copy` (09-react-frontend), `engineering:standup` (10-devops-sre), `legal:compliance-check` (12-security-engineer).

**Follow-up tasks** (lighter weight than H.2.2 but worth tracking):
- **Audit auditor personas (01-05)** for marketplace integration opportunities — `04-architect` would benefit from `engineering:architecture` + `engineering:system-design`; `03-code-reviewer` from `engineering:code-review` + `engineering:debug` + `engineering:testing-strategy`. Estimate: ~30 min, low risk.
- **Author specialist KB stubs that match marketplace skills** — e.g., `kb:engineering/incident-response-playbook` could be a HETS-side companion to the marketplace skill, providing project-specific context. Lazy: only when a builder persona spawn produces a noticeable gap.
- **Verify marketplace skill invocation paths** — when `invokesRequiredSkills` ships in H.2.6, validate that namespaced names (`engineering:debug`) resolve correctly via the actor's `Skill` tool calls.

### H.2.3 — Asymmetric challenger spawning — SHIPPED

**Status**: shipped. `challenger.contract.json` + `noEmptyChallengeSection` functional check + `agent-identity assign-challenger` subcommand + `kb:hets/challenger-conventions` doc + asymmetric-challenger pattern status promoted to `implementing`. E2E validated with 4 probes covering assign-challenger preference rules + verifier accept (challenges present) + verifier reject (no challenges + capitulation phrase).

**Follow-up tasks** (deferred — pick up when H.2.4 / a real chaos run uses challengers):
- **`assign-challenger --exclude-personas <list>`** to exclude multiple personas at once (current implementation excludes only one). Useful when a chaos run has spawned 3 implementers and the challenger should differ from all 3.
- **Symmetric-pair spawning** for top-of-tree (super-root) per asymmetric-challenger pattern's "When Not to Use" — currently no scaffolding for symmetric pairs. Likely lands as part of H.2.4 trust-tiered logic.
- **Challenge-vs-claim binding** in the verifier: F3 only counts headings; could optionally validate that each `### CHALLENGE-N` quotes implementer text via a regex like `\*\*Implementer claim\*\*\s*\(quoted\)`. Useful for stricter enforcement once we see what real challenger outputs look like.

### H.2.4 — Trust-tiered verification depth — SHIPPED

**Status**: shipped this turn. Queryable tier API + recommend-verification policy + `--skip-checks` verifier flag + symmetric-pair convention doc + `HETS_IDENTITY_STORE` env override for testability.

**What's wired** (per `kb:hets/symmetric-pair-conventions` + agent-identity.js `VERIFICATION_POLICY` table):
- `agent-identity tier --identity X` → returns tier + passRate + totalRuns + threshold
- `agent-identity recommend-verification --identity X` → returns full policy: `{ verification, spawnChallenger, challengerCount, skipChecks, rationale }`
- `contract-verifier --skip-checks F4,A2,noTextSimilarityToPriorRun` → matches by check.id OR check.check name; records `status: 'skipped'` (not pass/fail) for audit clarity

**Follow-up tasks** (deferred to a future phase):
- **`--tier-policy` flag on chaos-test command** — opt-in per run; auto-queries `recommend-verification` for each spawned identity and applies the policy. Currently the orchestrator must call recommend-verification manually + pass `--skip-checks` accordingly. Estimate: ~50 LoC.
- **`assign-pair --count N`** as a cleaner alternative to calling `assign-challenger` twice with `--exclude-identity`. Logged in symmetric-pair-conventions as open question. Estimate: ~30 LoC.
- **Trust decay (exponential weighting of recent runs)** per pattern doc's failure mode #3 ("trust decay — old identities with stale track records over-trusted"). Estimate: ~80 LoC; needs design pass.
- **Hysteresis on tier transitions** per pattern doc's failure mode #4 ("tier flip-flop"). Estimate: ~30 LoC.

### H.2.5 — Tech-stack analyzer + skill-bootstrapping orchestrator wiring

**Status**: pattern docs shipped (`tech-stack-analyzer.md`, `skill-bootstrapping.md`), orchestrator skill not yet authored.

**Scope**: New `skills/tech-stack-analyzer/SKILL.md` orchestrator skill that:
1. Parses user task → infers required skills (using a stack→skill map at `kb:hets/stack-skill-map`)
2. Queries the catalog (`kb-resolver list`) to detect missing skills
3. Surfaces missing skills to user with options (allow internet research / proceed without / cancel)
4. On approval, chains to `/forge` → `/review` → catalog admission

**Dependencies**: H.2.2 (builder personas as the targets).

**Estimate**: ~500 LoC + ~3hr. — SHIPPED

**Status**: shipped this turn. New `skills/tech-stack-analyzer/SKILL.md` (orchestrator skill, 7-step workflow with 2 user-gates) + `kb:hets/stack-skill-map` (12 stacks across 7 domains) + `/build-team` command. Patterns `tech-stack-analyzer` + `skill-bootstrapping` status `proposed → implementing`. E2E validated 6 probes covering KB resolution, skill scaffold, command existence, and skill-name cross-validation against persona contracts + marketplace.

**Follow-up tasks** (deferred — pick up when first real `/build-team` invocation surfaces gaps):
- **`/forge` internet-research mode** — current `/forge` authors locally; the skill-bootstrapping flow assumes internet research with per-claim source tracking. Estimate: ~150 LoC + design pass.
- **Stack-skill-map auto-validation in CI** — `kb-resolver scan` could grep stack-skill-map skill names against persona contracts + marketplace, warn on broken references. Estimate: ~50 LoC.
- **`tech-stack-analyzer` skill testing harness** — current E2E only validates scaffolding (KB resolves, skill exists). A real test would mock a user task → check the analyzer's plan output. Hard to write without invoking real LLM agents; defer until we run a real `/build-team` flow and capture the trace.

### H.2.6 — `invokesRequiredSkills` verifier check — SHIPPED

**Status**: shipped this turn. New functional check + `--transcript <path>` flag + functional-dispatcher extension to support rich returns + persona-skills-mapping pattern promoted to `active`.

**Implementation**: `extractSkillsFromTranscript(transcriptPath)` parses each JSONL line, finds `tool_use` blocks with `name === 'Skill'`, collects skill names from `input.skill`. Returns Set. Check cross-checks against `contract.skills.required`, skips `skill_status === 'not-yet-authored'` entries (promise mode). Source preference: `--transcript` > `--skills` flag > graceful pass (`reason: 'no_skills_source_supplied'`).

E2E validated 5 probes covering all source paths + promise-mode skip + missing-transcript-file fail.

**Follow-up tasks**:
- **Auto-discover transcript path**: parent agent could pass `--transcript-from-agent-id <id>` and the verifier resolves to `~/.claude/projects/<project>/<agent-id>.output` automatically. Currently the orchestrator must construct the path. Estimate: ~30 LoC.
- **Recommended-skill warning** (not just required): if a recommended skill that IS available in the catalog isn't invoked, emit a warning (not a fail). Useful signal for "the actor could have done better". Estimate: ~40 LoC.
- **Skill-invocation count tracking**: extend the check to record HOW MANY times each skill was invoked, surface to identity store via `--forward-skills-with-counts` so trust accumulates per `(persona, skill, count)` tuple instead of per `(persona, skill)`. Useful for the H.2.4 trust-tiered policy refinement. Estimate: ~50 LoC.

## Phase H.2 — explicitly deferred (added to backlog per user direction)

### H.2.7 — Full pattern contracts (structural code review) — SHIPPED

**Status**: shipped this turn. Closes the long-standing DOCUMENTATION-DEBT flag where SKILL.md described "triple contract" but only 2/3 were implemented.

**What landed**:
- New functional check `noUnrolledLoops` — scans code blocks for ≥`maxRepetitions` (default 5) identical lines after stripping syntactic boilerplate (lines <3 chars filtered, e.g., `}`, `};`, `})`)
- New functional check `noExcessiveNesting` — brace-counting depth on C-family code blocks; default `maxDepth: 4` (matches CLAUDE.md fundamentals); strips string literals + line/block comments before counting
- New pattern doc `patterns/structural-code-review.md`
- SKILL.md "triple contract" section updated to describe what's actually implemented (no more oversell)
- Pattern catalog table refreshed with current statuses for H.2.3 through H.2.7

**Bug caught & fixed during own validation**: probe 2 initially failed `noUnrolledLoops` on legitimate nested code because 6 closing `}` in a row tripped the repetition counter. Added `length >= 3` filter to skip syntactic boilerplate. Re-run confirmed F2 passes for nested code while F3 correctly catches the depth violation.

**Follow-up tasks**:
- **Add structural checks to builder persona contracts (06-12)** — currently the contracts don't reference `noUnrolledLoops` or `noExcessiveNesting`. Adding them to all 7 builder contracts is ~30 LoC across 7 files. Defer until first chaos run with builders surfaces a real "wrote code wrong" finding.
- **Indentation-based nesting check** for Python — `noExcessiveNesting` is brace-only. A separate `noExcessiveIndent` check could count leading whitespace consistency. Lower priority; catches a smaller class of bugs.
- **`functionTooLong` check** — count lines between `function ... {` and matching `}` per CLAUDE.md "<50 lines" fundamental. ~50 LoC + brace-balance tracker.
- **`noHardcodedMagicValues` check** — flag numeric literals not assigned to a constant. Heuristic; high false-positive risk. ~80 LoC + tuning.

### H.2.7 (DOCUMENTATION-DEBT FLAG, archival marker) — RESOLVED

The flag is now resolved. SKILL.md's "triple contract" section accurately describes 3/3 implemented checks. Architect actor's chaos-20260502-060039 oversell finding is closed.

### H.2.8 — On-demand budget extensions — SHIPPED

**Status**: shipped this turn. `scripts/agent-team/budget-tracker.js` with 5 subcommands; per-run state in `swarm/run-state/<run-id>/budgets.json` (gitignored). Closes the architect's "budget enforcement is fictional" finding from chaos-20260502-060039 — contract budget fields (`tokens`, `extensible`, `maxExtensions`, `extensionAmount`) are now actually enforced.

**E2E validated 7 probes**: init, manual record, transcript-extract record (sums input + output + cache_creation + cache_read), extend approve, extend deny when exhausted, run-level status, per-identity status with utilization%.

**Process note**: First phase shipped using the new git workflow — branched on `feat/phase-H.2.8-budget-extensions`, PR via `gh pr create`, merged to main with tag `phase-H.2.8` at the merge commit.

**Follow-up tasks**:
- **Pre-flight allowance check before spawn**: orchestrator could call `budget-tracker status --identity X` before re-spawning a known-expensive identity to avoid mid-spawn extension churn. ~30 LoC convention update.
- **Aggregate budget across run**: cap total per-run token spend (sum of all spawns); deny extensions when run-cap is approached even if per-spawn extensions remain. Useful for cost-controlled chaos runs. ~80 LoC.
- **Auto-record from transcript at verifier time**: `contract-verifier.js` already has `--transcript`; could auto-call `budget-tracker record-from-transcript` after verification completes, removing one manual orchestrator step. ~40 LoC.

### H.2.9 — `chaos-test --pattern <name>` simulation runner — SHIPPED

**Status**: shipped this turn. `scripts/agent-team/pattern-runner.js` extracts validation scenarios from any pattern doc; `chaos-test` command updated with `--pattern <name>` workflow.

**What landed** (~210 LoC):
- 4 subcommands: `list-patterns` (status + scenario count for all 12 patterns), `extract --pattern X` (JSON output of scenarios), `summary --pattern X` (human-readable), `prompts --pattern X` (ready-to-paste actor-prompt skeletons per scenario)
- Case-insensitive header match (caught a real bug: `structural-code-review.md` uses lowercase "strategy" — initially extracted 0 scenarios; case-insensitive fix unlocked 5)
- `\Z` regex bug avoided (used `$(?![\s\S])` per the H.2-bridge fix)
- 49 total scenarios across the 12 patterns now machine-extractable
- chaos-test command's `## Pattern-targeted runs` section documents the full workflow

**E2E validated** with 5 probes: list-patterns shows all 12 with non-zero scenario counts; extract returns JSON with frontmatter + scenarios; summary is human-readable; prompts emits structured actor-prompt skeletons; not-found pattern exits 1 with clear message.

**Follow-up tasks**:
- **First real `--pattern` chaos run**: pick a pattern (e.g., asymmetric-challenger or trust-tiered-verification) and run chaos-test --pattern against it. Will likely surface issues in the prompt-skeleton design — they're heuristic. Defer until we have appetite for a full chaos-test cycle.
- **Per-scenario verdict aggregation**: pattern-runner could add a `verify --pattern X --run-id Y` subcommand that scans the run's actor outputs for verdict markers (pattern-defense-fired / pattern-silent-failure / pattern-not-applicable) and reports a per-pattern coverage score. ~80 LoC.
- **Pattern-doc lint**: companion check `--lint --pattern X` that warns when a pattern doc's `## Validation Strategy` section is missing or has fewer than N scenarios. ~30 LoC.

## Phase G + earlier — not yet fixed

### Pre-compact-save.js JSONL append non-atomicity

**Source**: chaos-20260502-060039, code-reviewer H-4.

**Scope**: Replace `fs.appendFileSync` + `fs.writeFileSync` (read-trim cycle) with a single atomic read-update-tmp-rename. Sole exception to the toolkit's tmp-rename pattern; SIGKILL during partial flush corrupts the JSONL file.

**Estimate**: ~30 LoC + ~30min.

### `noTextSimilarityToPriorRun` silently passes when no prior run

**Source**: chaos-20260502-060039, architect MEDIUM.

**Scope**: When `priorRunDir` doesn't exist, the check returns `pass: true` with reason `no_prior_run`. Should fall back to checking similarity against sibling nodes in the same run.

**Estimate**: ~50 LoC + ~30min.

### Persona ↔ contract drift validator — SHIPPED as H.3.0 (contracts-validate.js, partial closure)

**H.3.0 update**: `scripts/agent-team/contracts-validate.js` ships 7 validators covering pattern-status drift, contract skill_status validity, kb_scope ref resolution, and pattern Related bidirectionality. **Persona-text vs contract-shape drift** (the architect's original example: persona says "800-1500 words" but contract enforces 2000 chars / ~300 words) is NOT yet covered — would require parsing the persona markdown for word-count claims. Defer that specific check as a follow-up.

First production run of the H.3.0 validator surfaced 29 real drift violations:
- 4 pattern-status-readme-consistency (README still shows `proposed` for patterns whose frontmatter says `implementing`)
- 10 pattern-related asymmetric links (architect's MEDIUM finding from CS-1)
- 14 contract-skills-status-keys (auditor contracts 01-05 reference required+recommended skills but lack `skill_status` map; the map was added in H.2-bridge for builders only)
- 1 available-but-missing (12-security-engineer references `security-audit` as `available` but `skills/security-audit/SKILL.md` doesn't exist)

**Original-scope marker preserved below** — the prior persona-text-vs-contract drift check is not done; treat as a follow-up sub-task of this entry.

#### Original-scope marker

**Source**: chaos-20260502-060039, architect HIGH (#4 top-leverage change).

**Scope**: New `scripts/agent-team/contracts-validate.js` that cross-checks each persona's `.md` ↔ `.contract.json` ↔ role-template for consistency. Catches drift at lint time. Architect's example: persona says "800-1500 words" but contract enforces only 2000 chars (~300 words).

**Estimate**: ~150 LoC + ~1hr.

### Cross-run baseline migration

**Source**: chaos-20260502-060039, architect HIGH.

**Scope**: One-time migration that synthesizes minimal `tree.json` for prior chaos runs (172842, 180536, 184505) from their existing `node-*.md` files. Without this, "cross-run delta analysis" output is meaningless because the prior runs don't have tree state.

**Estimate**: ~100 LoC + ~30min.

### Hierarchical-aggregate path mismatch

**Source**: chaos-20260502-060039, architect HIGH.

**Scope**: SKILL.md says `scripts/agent-team/hierarchical-aggregate.js` but the actual script lives at `swarm/hierarchical-aggregate.js`. Either move/symlink or update SKILL.md.

**Estimate**: ~10 LoC + ~10min.

### Aggregator parsing fragility

**Source**: chaos-20260502-060039, orch-behavior synthesis.

**Scope**: Aggregator counts findings only when actors use the strict `## CRITICAL → ### ID` convention. confused-user (`### F1`) and honesty-auditor (`### 1.`) both had real findings counted as 0. Either enforce convention via stricter functional check OR make aggregator robust to common variations.

**Estimate**: ~150 LoC + ~1hr (option B; option A is even smaller).

### `unknown_check` on required functional check should fail

**Source**: H.2-bridge probe (Probe 1 of the verifier-fix end-to-end check).

**Scope**: Currently a contract listing only invented check names verdicts as `pass` because `unknown_check` doesn't increment `functionalFailures` for the `continue` path. Should fail required checks with unknown names.

**Estimate**: ~10 LoC + ~10min.

## Cross-phase / integration items (chat-scan after H.2.9)

Found by scanning the H.2.x conversation history end-to-end after all 9 sub-phases shipped. These are themes that surfaced multiple times but weren't captured as concrete tasks in any phase's follow-ups. Ordered roughly by leverage.

### CS-1 — Meta-validation chaos run on H.2.x infrastructure

**Status**: NOT YET RUN.

**Scope**: Run a full `/chaos-test` against the toolkit's H.2.1 → H.2.9 changes. Last meta-validation was `chaos-20260502-060039` (pre-bridge). We've shipped 9 sub-phases since, adding ~3000 LoC + 12 personas + 11 patterns + 18 KB docs + 5 new scripts.

**Why now**: chaos-test on the chaos test infra has a strong track record of surfacing real bugs at the seams (e.g., the prototype pollution + `.some` + `\Z` regex finds in chaos-20260502-060039). With the much larger H.2.x surface, integration bugs are likely.

**Estimate**: ~30 min run + ~1 hr review.

### CS-2 — README refresh through H.2.9

**Status**: README documents through H.2.4 only.

**Scope**: Add to README the H.2.5–H.2.9 components: `tech-stack-analyzer` skill, `/build-team` command, `pattern-runner.js`, `budget-tracker.js`, `noUnrolledLoops` + `noExcessiveNesting` checks, knowledge-work-plugins integration, the `marketplace:` skill_status value. Update Project Structure to show `commands/build-team.md`, the new scripts.

**Estimate**: ~30 min, additive (no removals).

### CS-3 — MCP server exposing HETS state

**Status**: implied by Gemini conversation (MCP for connectors); never made concrete.

**Scope**: Author a Model Context Protocol (MCP) server that exposes HETS substrate operations (`assign-identity`, `recommend-verification`, `resolve kb-ref`, `extract pattern scenarios`, `record budget usage`) as MCP tools. Lets other Claude Code instances consume HETS WITHOUT cloning the toolkit — closes the cross-project-reuse promise of content-addressed refs.

**Why this matters**: today HETS is filesystem-bound. To use it from another project, you clone the toolkit + run scripts. An MCP server would make HETS a first-class shared service.

**Estimate**: ~3-4 hrs (new MCP server scaffolding + 5-7 tool handlers + auth/permission story).

### CS-4 — `.claude-plugin/` packaging concrete

**Status**: listed in periodic-audit checks (#3) but no concrete task; came up multiple times in the Gemini conversation about distribution.

**Scope**: Promote the audit reminder to a real task. Author `.claude-plugin/plugin.json` manifest. Verify all components (agents, hooks, rules, skills, commands, swarm, scripts) install cleanly via the marketplace install path. May require restructuring some paths to match plugin layout conventions.

**Estimate**: ~2 hrs.

### CS-5 — agent-swarm vs agent-team skill consolidation

**Status**: never resolved during phase work.

**Scope**: The original toolkit had `skills/agent-swarm/` (parallel sub-agent dispatch). H.2 added `skills/agent-team/` (full HETS — hierarchical with contracts, identity, KB, etc.). They overlap conceptually. Decide:
- (a) Merge: agent-team subsumes agent-swarm; deprecate agent-swarm
- (b) Layer: agent-swarm = lightweight parallel-dispatch; agent-team = heavyweight HETS; both kept with cross-references
- (c) Rename: agent-swarm → agent-swarm-classic; agent-team → agent-team

Option (b) is probably right (lightweight tool for simple cases, heavyweight for product work) but worth a deliberate decision rather than current accidental overlap.

**Estimate**: ~30 min (decision + cross-reference doc updates; no code unless deprecating).

### CS-6 — End-user guide for builder personas

**Status**: builder personas (06-12) ship but no walkthrough exists for end-user adoption.

**Scope**: New doc at `skills/agent-team/USING.md` (or major README section) walking through:
1. Install the toolkit
2. Initialize HETS (`agent-identity init`, `kb-resolver scan`)
3. Run `/build-team your-real-task`
4. Review the analyzer's plan; redirect if needed
5. Bootstrap any missing skills via `/forge`
6. Spawn the team; review per-actor outputs
7. Verify; iterate

Target audience: developer who clones the toolkit for a real product project (not for chaos-testing the toolkit itself).

**Estimate**: ~1 hr.

### CS-7 — Pre-flight check for chaos-test substrate

**Status**: chaos-test command assumes substrate is initialized.

**Scope**: Add a step (or a `chaos-test preflight` subcommand) that verifies before spawning:
- `kb-resolver scan` runs cleanly (manifest fresh)
- `agent-identity list` succeeds (registry initialized)
- `budget-tracker init` works for the run-id (or creates fresh budget file)
- All 5 personas in scope have valid contract files
- `pattern-runner list-patterns` returns expected count

**Estimate**: ~30 min (add to chaos-test.md as Step 0 + maybe a wrapper script).

### CS-8 — Cross-script env var consistency doc

**Status**: 5 env vars distributed across HETS scripts; per-script docstring only.

**Scope**: Single doc (e.g., `kb:hets/env-vars` or section in SKILL.md) listing all HETS env vars, their defaults, which scripts honor them:
- `HETS_KB_DIR` — kb-resolver
- `HETS_RUN_STATE_DIR` — kb-resolver, budget-tracker, tree-tracker (after H.2.1 fix)
- `HETS_IDENTITY_STORE` — agent-identity
- `HETS_CONTRACTS_DIR` — budget-tracker (could be adopted by others)
- `HETS_PATTERNS_DIR` — pattern-runner

**Estimate**: ~15 min.

### CS-9 — MemPalace integration for HETS state (optional)

**Status**: HETS state lives in local JSON files; MemPalace MCP available but unused for HETS.

**Scope**: Optional adapter layer where `agent-identities.json`, `agent-patterns.json`, and the kb manifest can route through MemPalace (when configured) for cross-session semantic memory + cross-machine sync. Local-file fallback remains the default.

**Estimate**: ~2 hrs (define interface + implement adapters; keep local as fallback per existing toolkit pattern).

### CS-10 — chaos-test --pattern as actual CLI orchestration

**Status**: chaos-test command's `## Pattern-targeted runs` section is LLM instructions; no end-to-end CLI driver.

**Scope**: Wrapper script (or `pattern-runner orchestrate --pattern X --run-id Y`) that sequences: extract scenarios → spawn one actor per scenario → wait for completion → verify each → aggregate per-pattern coverage. Removes the need for the LLM to drive the workflow turn-by-turn.

**Estimate**: ~2 hrs (parallel spawn coordination is non-trivial; needs careful state-passing).

### CS-11 — CONTRIBUTING.md retrospective examples

**Status**: CONTRIBUTING.md uses hypothetical "feat/phase-H.2.8" example; that's now historical (PR #1 shipped).

**Scope**: Update CONTRIBUTING.md examples to reference real shipped PRs (PR #1 = H.2.8 = budget-tracker; PR #2 = H.2.9 = pattern-runner). Add a "Worked examples from this repo" section.

**Estimate**: ~10 min.

### CS-12 — Compliance probe refresh for H.2.x scripts

**Status**: `compliance-probe.sh` checks prompt-enrichment + fact-force-gate; doesn't know about HETS-script usage.

**Scope**: Extend probe to additionally check for HETS substrate usage in recent runs:
- Did any run call `kb-resolver snapshot` to freeze KB state?
- Did any spawn invoke `agent-identity assign` / `assign-challenger`?
- Did contract verification call `--transcript` or rely on `--skills` fallback?
- Was `budget-tracker record-from-transcript` called post-spawn?

Useful signal for "is the HETS substrate being used or just sitting there?" — same instinct as the original probe ("is enrichment happening on real prompts?").

**Estimate**: ~1 hr.

## How to use this backlog

1. When an item becomes blocking, promote it to a phase in SKILL.md
2. When working in a related area, opportunistically pick up adjacent items (the H.2.1 vertical slice picked up tree-tracker H-2 + M-2 + path resolution + the [a-z]{1,10} regex fix all at once)
3. Re-evaluate quarterly — items here may become irrelevant as the toolkit evolves

## Discipline checks (before adding a new persona / contract / KB doc / pattern)

Asked of every new addition to defend against org-chart delusion + maintenance-tax bloat:

- **Does this earn its keep, or am I adding it because the architecture allows it?** A persona that handles ≤2 distinct task types overlaps too much with an existing one — fold in.
- **Will this be invoked?** A KB doc that no spawn prompt references is dead weight; a contract field that no verifier check reads is documentation drift.
- **Is the maintenance cost real?** Speculative skill authoring (vs promise-mode + bootstrap on first use) is the trap — only author what's about to be used.
- **Does it overlap with a native primitive?** Periodic native-primitive audit (every quarter, see "Periodic external-audit checks" below).

## Periodic external-audit checks (quarterly)

Things to revisit on a slow cadence so the toolkit doesn't accumulate redundancy with native primitives or marketplace plugins:

1. **Native Anthropic / Claude Code primitives** — has anything shipped that subsumes what we built (Skills format, Plugins format, native sub-agent coordination)? If so, evaluate migration cost vs custom-feature differentiation. Don't migrate just because it's native; do migrate if our custom layer no longer adds measurable value.
2. **MCP servers for connectors** — if/when we need Slack / DB / external integrations, use MCP servers (https://modelcontextprotocol.io). Don't roll our own connectors.
3. **`.claude-plugin/` packaging** — if we want to distribute the toolkit so others can install it, repackage as a plugin bundle. Doesn't change what we built; changes how it ships.
