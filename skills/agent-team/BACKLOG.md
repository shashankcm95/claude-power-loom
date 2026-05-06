# Agent Team — Backlog

Deferred work from prior phases, captured here so nothing important gets silently dropped. Each entry: scope, rationale, dependencies, rough estimate.

## Phase H.6.4 — persona/contract coherence for non-JVM backends (NEW from H.6.1)

**Status**: not yet started. Surfaced as GAPs 4-7 in H.6.1 orchestration walkthrough.

**The finding**: 07-java-backend persona has triple incoherence for any non-JVM backend task — required skill is `spring-boot` (JVM-specific, not-yet-authored), kb_scope is JVM-only (`backend-dev/spring-boot-essentials + jvm-runtime-basics`), and the persona name itself ("07-java-backend") implies language family. Stack-skill-map docs say "07-java-backend persona is the closest match for general backend work" but the contract layer contradicts that claim.

**Two design options**:

1. **New persona** — `13-node-backend` with skills `[express, nest-js]` and Node-specific kb_scope. Symmetric solution; no breaking changes. Requires authoring new persona file + contract + roster + KB docs.
2. **Rename + restructure** — `07-java-backend` → `07-backend` with stack-conditional `skill_status` + `kb_scope` (e.g., resolved at spawn time based on task's tech-stack-analyzer output). Cleaner long-term but requires verifier changes to handle conditional contracts.

**Estimate**: 1-2 hr for option 1 (new persona); 3-4 hr for option 2 (verifier conditional dispatch). Option 1 is the safer first step.

## Phase H.6.3 — auto-trigger skill-forge from `agent-identity assign` (NEW from H.6.1)

**Status**: not yet started. Confirmed gap from H.5.6 mio dogfood; re-confirmed in H.6.1.

**The finding**: when a persona contract has `skills.required` entries with `skill_status: "not-yet-authored"`, the orchestrator should pause + invoke skill-forge before spawning. Today this is purely manual — the `assign` subcommand returns the identity without checking skill availability. Result: in H.5.6 mio used a workaround (the skill happened to exist); in H.6.1 the skill mismatch was so deep that no forge would have helped (tech mismatch, not skill absence).

**Scope**:
- Modify `agent-identity.js cmdAssign` to read the persona contract + report any `not-yet-authored` skills as a JSON warning
- Optional: a `--require-forged` flag that exits non-zero if any required skill is missing
- Document the forge → assign → spawn flow as a 3-step orchestrator pattern

**Estimate**: ~50 LoC, ~45 min.

## Phase H.6.2 — extend stack-skill-map with Node/Express + Go + Rust (NEW from H.6.1)

**Status**: not yet started. Surfaced as GAP-1 in H.6.1.

**The finding**: stack-skill-map covers 12 stacks; the prominent missing entries are Node/Express, Go, Rust, PHP, Ruby. Tasks against any of these fall to the architect-scoping default fallback OR (worse) silently get routed to the closest-fit persona whose contract doesn't actually match.

**Scope**:
- Add `Backend — Node-Express` entry: `required: [express]`, `recommended: [engineering:debug, jest, postgres-engineering]`, `personas: [13-node-backend]` (depends on H.6.4) OR `[07-java-backend]` (placeholder until H.6.4)
- Add `Backend — Go service`, `Backend — Rust service` similar shapes
- Update the analyzer skill description to match

**Estimate**: ~20 LoC doc fix + 30 min. Low-risk.

## Phase H.6.1 — first abstract-task orchestration walkthrough — SHIPPED

**Status**: shipped. Validated the spawn-recorder + the manual orchestration walkthrough discipline. Surfaced 4 follow-up phases (H.6.2, H.6.3, H.6.4) plus confirmed H.5.7 priority. See `swarm/H.6.1-orchestration-test-findings.md` for the full report.

## Phase H.6.0 — spawn-recorder for orchestration-test visibility — SHIPPED

**Status**: shipped. Foundational tooling for H.6.x orchestration tests. New `scripts/agent-team/spawn-recorder.js` captures per-spawn audit data (persona, identity, skills resolved, kb_scope read/declared, verdict, tokens, wallclock, gaps surfaced) into `~/.claude/spawn-history.jsonl`.

The `gaps` aggregator is the load-bearing subcommand — surfaces recurring orchestration gaps across multi-run test batches (e.g., "skill-forge not auto-triggered" recurring across multiple tasks).

**H.6.x follow-ups**:
- **H.6.1** — first abstract-task orchestration test ("Add rate limiting to my Express API") — captures what gets invoked vs what we expected
- **H.6.2** — batch 4 more orchestration tests across diverse domains (security, devops, data, frontend)
- **H.6.3** — analyze recurring gaps; decide which to fix as code (e.g., auto-trigger forge), which to fix as docs (e.g., disambiguate task → persona routing rules)

## Phase H.5.7 — builder contract shape (NEW from H.5.6 dogfood)

**Status**: not yet started. Surfaced as H-1 by `12-security-engineer.mio` during the H.5.6 dogfood run.

**The finding**: the 12-security-engineer contract (and presumably the other 6 builder contracts 06-11 by symmetry) is shaped for audit-report output: `minFindings ≥ 2`, `hasFileCitations ≥ 4`, `hasSeveritySections [CRITICAL, HIGH, MEDIUM, LOW]`, `containsKeywords ["threat"]`, audit-domain `kb_scope`. This works for chaos-test runs where builders simulate adversarial audits. It does NOT work for builders running real engineering tasks: mio had to (a) re-frame contract-editing decisions as numbered findings, (b) pad citations across edited files to hit the threshold, (c) read KB docs that weren't load-bearing for the engineering task, (d) invent severity sections that mostly say "None this run".

**Two design options for H.5.7**:

1. **Separate contract template** — author `builder-engineering-task.contract.json` template with engineering-shaped checks (e.g., `producesValidJSON`, `passesContractsValidate`, `noUnscopedFileEdits`, `decisionsDocumented`). Each builder-on-engineering spawn picks the engineering template instead of its persona contract.
2. **Conditional checks** — extend persona contracts with `task_type` field (`audit` | `engineering`) and have contract-verifier dispatch different functional checks per type. More complex but keeps personas single-source.

**Estimate**: 1 hr for option 1 (~80 LoC across new template + verifier dispatch). 2 hrs for option 2 (verifier dispatch + per-persona task-type-aware checks).

**Why not block on this for H.5.6**: mio's PASS verdict is genuine (she did the engineering work + the report). The finding is real future work; not a regression in the current substrate.

## Phase H.5.6 — first builder dogfood — SHIPPED

**Status**: shipped. Closes CS-3 architect-theo's last architectural HIGH (builders 06-12 at unproven tier with no real verdicts).

What landed:
- `12-security-engineer.mio` spawned on the auditor-kb_scope-authoring task (real engineering work, not a fixture)
- 5 auditor contracts (01-05) now have `kb_scope.default` + opt into `kb_scope_consumed` check
- contract-verifier verdict: **PASS** across all 9 functional + 5 antiPattern checks
- mio's identity record updated: passRate=1.0, verdicts.pass=1, skillInvocations.security-audit=1
- **First-ever builder verdict recorded** — real trust-formula data populated
- mio surfaced a genuine architectural H-1 finding (contract shape mismatch) — promoted to H.5.7 backlog item

H.4.0's enforcement template now applies symmetrically: producers (builders 06-12) AND consumers (auditors 01-05) all opt into `kb_scope_consumed`.

## Phase H.5.5 — architectural cleanup — SHIPPED

**Status**: shipped. Closes 2 of theo's 3 architectural HIGHs from CS-3:

1. **`hierarchical-aggregate.js` location DECIDED** — 5 consecutive chaos runs flagged "either move or document." H.5.5 commits to the decision: stays at `swarm/` because it's chaos-test runtime tooling (operates over `swarm/run-state/` artifacts; only invoked by chaos-test workflows), not HETS substrate (which is what `scripts/agent-team/` houses — substrate consumed by spawned actors + verifier callsites). SKILL.md:122 reframed from "persistent BACKLOG item to relocate" to explicit decision rationale.

2. **`_lib/` directory of one resolved** — created `scripts/agent-team/_lib/runState.js` consolidating `RUN_STATE_BASE` constant + `runStateDir(runId)` helper that was previously duplicated in tree-tracker.js, budget-tracker.js, and kb-resolver.js. `_lib/` now has 2 modules (lock.js + runState.js) — coherent abstraction, not premature directory naming. E2E validated all 3 consumers + env override.

**The 3rd architectural HIGH (builder dogfood) deferred to H.5.6** since it requires a real engineering task + spawn cycle + verdict capture — not refactor work.

## Phase H.5.4 — remaining CS-3 HIGH cluster — SHIPPED

**Status**: shipped. Closes the last 4 of the actionable CS-3 HIGH findings (architectural HIGHs from theo deferred to H.5.5/H.5.6 since they need different scope decisions).

What landed:
- New `hooks/scripts/_lib/file-path-pattern.js` (shared filePath extractor); de-duped + extended for Windows + quoted-paths-with-spaces (blair H-4)
- `${CLAUDE_PLUGIN_ROOT}` verification in `session-reset.js` (kai H-4)
- README: explicit marketplace.json layout note (rafael HIGH-1)
- README: removed "legacy" / "deprecated" framings around install.sh (rafael HIGH-2)

E2E validated 5 probes. contracts-validate: 0 violations.

**Architectural HIGHs from theo (deferred — need scope decisions, not pure fixes)**:
- `hierarchical-aggregate.js` location drift (5 chaos runs unmoved) — decide: relocate or document. Either way ~10 min.
- Builders 06-12 unproven tier — H.5.6 (or rename to H.5.5) dogfood run; pick a real task, run `/build-team`, populate trust-formula data.
- `_lib/` directory of one — extract `_lib/runState.js` from the 4 scripts that resolve `swarm/run-state/` paths; ~30 min refactor.

**Remaining CS-3 MEDIUM/LOW** (not addressed in this phase; deferred to next chaos cycle to see if they re-surface):
- `inferKindFromSignal` default-allow (kai M-1)
- Frontmatter validator: no YAML parse (blair M-2 / kai M-2)
- parseFrontmatter strip-quotes permissive (kai M-3)
- `newCandidateId` 24-bit collision risk (kai L-1) — partially closed by H.5.3 tmp-suffix fix
- scanContent regex stateful-ness brittle (kai L-2)

## Phase H.5.3 — self-improve-store hardening + frontmatter BOM — SHIPPED

**Status**: shipped. Closes 6 CS-3 HIGH findings clustered around `scripts/self-improve-store.js` robustness + 1 frontmatter validator cross-platform issue.

What landed:
- `writeAtomic` tmp-suffix: pid + hrtime + 6-byte crypto nonce (was just pid; collided under concurrent same-PID writers)
- Lock-fallback now emits stderr warning on first occurrence (was silently no-op)
- `loadCounters` + `loadPending` quarantine corrupt files to `<path>.corrupt-<ISO>` before returning defaults (was silently zeroing history on parse failure)
- `executeGraduation` wraps observations.log appends in `withLock` + caps line length at 256 bytes (safely under Darwin's 512-byte PIPE_BUF)
- `hasFrontmatter` strips UTF-8 BOM (`﻿`) before frontmatter check (was false-blocking valid skills written from BOM-injecting editors)

E2E validated 5 probes. ~/.claude/ sync verified. contracts-validate: 0 violations.

**Remaining HIGHs from CS-3 (deferred to H.5.4):**
- `auto-store-enrichment.js` filePath regex: Windows + spaces + regex metacharacters (blair H-4)
- `${CLAUDE_PLUGIN_ROOT}` placeholder unverified at runtime (kai H-4)
- README marketplace.json location framing (rafael HIGH-1)
- README install.sh deprecation status (rafael HIGH-2)
- `extractKbReadsFromTranscript` path-traversal regex normalization (kai H-3) — partially addressed in H.5.2
- `hierarchical-aggregate.js` location drift (theo HIGH; 5 chaos runs unmoved)
- Builders 06-12 unproven tier (theo HIGH; H.5.4 dogfood territory)
- `_lib/` directory of one (theo HIGH; refactor)

## Phase H.5.2 — CS-3 CRIT bundle — SHIPPED

**Status**: shipped. All 5 CRITICAL findings from the CS-3 chaos-test (chaos-20260505-095622-cs3) auditor swarm closed in one PR.

What landed:
- **`kb_scope_consumed` provenance hardening** (`contract-verifier.js:109-180`) — text-pattern check became real provenance check via tool_use ↔ tool_result pairing + shell-evasion rejection + result-content validation. Closes hacker.kai CRIT-1 ("verifier was upgraded from no-enforcement to string-pattern-enforcement that any actor controlling its own transcript can pass").
- **Secrets validator hardening** (`hooks/scripts/validators/validate-no-bare-secrets.js`):
  - Added `github_pat_<82chars>` regex (modern fine-grained PAT, missing since shipping)
  - Fail-CLOSED on parse error (was fail-open — wrong for a security gate)
  - Tightened SKIP_PATH_PATTERNS (validator dir was self-permissive)
  - Fixed Edit field reference (`replace_all_string` doesn't exist; was effectively only scanning `new_string`)
  - Added multi-edit fallback + NotebookEdit pessimistic scan
- **README hook count consistency** — 5 sections updated from inconsistent `11`/`(6)`/`6 hook scripts` to canonical `11`. Section preamble explains breakdown by lifecycle event.
- **README single-canonical Install** — second `## Install` heading renamed to `## Legacy installer reference`; plugin-route note added that `hooks/hooks.json` auto-loads via `${CLAUDE_PLUGIN_ROOT}` (no manual `settings.json` merge needed).

E2E validated 9 probes (4 secrets, 2 kb_scope provenance, 3 Edit shape). contracts-validate: 0 violations across all 7 validators.

**H.5.x follow-ups still in BACKLOG**:
- **H.5.3** — pattern→enforcement bridge (12 of 13 patterns at 0 contract refs; persistent finding for 3 consecutive runs)
- **H.5.4** — builder dogfood run (architect.theo recommends elevating above H.5.3)
- **`hierarchical-aggregate.js` relocation** — 5 consecutive chaos runs unmoved; either relocate or document why `swarm/` is correct
- **`_lib/` second extraction** — directory of one (just `lock.js`); CS-2 recommended `_lib/runState.js` consolidation
- **Pre-spawn budget-tracker check** — substrate exists, call-site missing
- **Auditor contracts (01-05) lack `kb_scope`** — uniformly applies H.4.0 enforcement to consumers, not just producers

## Phase H.5.1 — pattern status sync + KB exemption doc — SHIPPED

**Status**: shipped. Closes 2 of CS-3 Track 1's findings:

1. **Pattern status drift** — 9 pattern docs were stuck at `status: implementing` despite their underlying code shipping phases ago. Promoted to `active` across all 3 sources of truth (frontmatter, `patterns/README.md` index, `SKILL.md` table). Pattern table also fills in the previously-missing `kb-scope-enforcement` row (13th pattern, shipped H.4.0). Final distribution: 12 active, 1 observed, 0 implementing.
2. **"Orphan" KB framing was wrong** — CS-3 Track 1 flagged 3 KB docs as missing from contract `kb_scope.default`. Investigation showed they're consumed by skills/commands/manifests, just not by per-persona contracts. Documented as intentional exemption in `patterns/kb-scope-enforcement.md` under a new "Toolkit-meta KB docs are intentionally exempt" section. The `kb_scope_consumed` check's principle is now explicit: domain-knowledge enforcement only, not toolkit-shared doc enforcement.

contracts-validate: 0 violations across all 7 validators after sync.

**H.5.1 follow-ups (deferred)**:

- **CS-3 Track 2 — full auditor swarm**: 5 personas in parallel for qualitative bug-hunt findings on top of the coverage audit. ~5-10 min wallclock, ~50-80K tokens. Defer until H.5.2/H.5.3 land so auditors don't waste effort on already-known findings.
- **H.5.3 — pattern → enforcement bridge**: 12 of 13 patterns have 0 contract refs. For each unenforced pattern: ship a verifier check (like H.4.0 did for `kb_scope`), promote if naturally enforced via existing mechanisms, or demote if aspirational. Big phase; needs explicit per-pattern triage.
- **H.5.4 — builder dogfood run**: builders 06-12 are at `unproven` tier with no real verdicts. Spawn 1-2 on a real task to validate the substrate works end-to-end. Generates real trust-formula data.

## Phase H.5.0 — official Claude Code plugin packaging — SHIPPED

**Status**: shipped. Toolkit is now installable as an official Claude Code plugin via `/plugin marketplace add shashankcm95/claude-skills-consolidated`. Three new manifests at repo root (`.claude-plugin/plugin.json`, `hooks/hooks.json`, `marketplace.json`) match the `code.claude.com/docs/en/plugins-reference` schema. Anti-AI-slop differentiation table in README explicitly compares this plugin's enforcement footprint (11 hooks, multi-agent HETS, triple-contract verifier, threshold-based auto self-improve, chaos-test meta-validation, 13 patterns) against typical SKILL.md-template plugins.

**H.5.x follow-ups (not yet scoped)**:
- **H.5.1 — official marketplace submission**: submit via `https://platform.claude.com/plugins/submit` once we've stress-tested the plugin install path with at least one external user. Anthropic review process (safety + quality gate); not publicly documented.
- **Multi-plugin marketplace split**: today the marketplace.json lists one plugin. If specific components grow independent uptake (HETS standalone, prompt-enrichment standalone, validators standalone), revisit splitting into separate plugin entries within the same marketplace.
- **Deprecate `install.sh`?**: keep as fallback for now; reassess after H.5.1 if plugin-path adoption reaches 80%+ of installs.

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
