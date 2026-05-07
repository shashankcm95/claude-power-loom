# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) starting at v1.0.0. Pre-1.0 versions are aggregations of phase tags shipped before the SemVer commitment.

For granular per-phase detail, see annotated tags `phase-H.x.y` and `swarm/H.x.y-findings.md` files.

---

## [Unreleased]

### Added

- **H.7.15** Drift-note housekeeping bundle: closes 5 of 7 pending drift-notes (mechanical + process scope; architectural pieces deferred per AskUserQuestion). NEW `skills/agent-team/patterns/validator-conventions.md` (pattern #17) codifying validator concerns-separation + self-documenting stderr message conventions (drift-notes 7 + 8). NEW "CI infrastructure changes (H.7.15)" section in `rules/core/workflow.md` codifying CI dogfood discipline (drift-note 5). `validate-plan-schema.js` extended to support `CLAUDE_PLAN_DIR` env var for custom plan paths (drift-note 12). install.sh subdir-glob audit closed clean (drift-note 13). 18/18 smoke tests (was 17/17). Bidirectional frontmatter reverse-links updated on 3 referenced patterns.
- **H.7.14** Drift-note 6 audit: extract canonical `findToolkitRoot()` helper across substrate family. NEW `scripts/agent-team/_lib/toolkit-root.js` (~88 LoC) extracted from contracts-validate.js's H.7.10 inline copy. 6 callers refactored: `contracts-validate.js`, `_lib/runState.js`, `kb-resolver.js`, `budget-tracker.js`, `pattern-runner.js`, `agent-identity.js:_readPersonaContract`. All preserve their `HETS_X_DIR` env-var override; only the second fallback (was hardcoded `~/Documents/claude-toolkit/`) now uses the shared helper. CI-environment simulation verified — scripts work correctly from `/tmp` via walk-up branch. Closes drift-note 6 (substrate-wide hardcoded-path anti-pattern). Net LoC reduction.
- **H.7.13** Agent discipline + JSDoc polish (closes H.7.7 deferral). Per-function JSDoc (@param/@returns + concise descriptions) added to 7 hook scripts: `session-end-nudge.js`, `auto-store-enrichment.js`, `fact-force-gate.js`, `prompt-enrich-trigger.js`, `pre-compact-save.js`, `error-critic.js`, `_lib/file-path-pattern.js`. Total: 59 @param/@returns lines. Agents at `agents/` already consistent (Phase 1 confirmed) — no agent work. Comments-only; zero behavior delta. **Meta-validation of H.7.11 v1.2 dict**: counter_signals (`polish`, `jsdoc`, `comment`, `formatting`) fired on H.7.13 task → root 0.037 confidence 0.875. H.7.11 expansion working as designed.
- **H.7.12** Plan-template enforcement hook (tiered-mandatory + PreToolUse:Write + nudge). NEW `hooks/scripts/validators/validate-plan-schema.js` (~250 LoC) with 3-tier enforcement (Tier 1 truly mandatory, Tier 2 conditional on new-style plan, Tier 3 aspirational stderr-only). Hook fires PreToolUse:Edit|Write on `~/.claude/plans/*.md` paths; emits `[PLAN-SCHEMA-DRIFT]` forcing instruction to stderr when Tier 1 or Tier 2 sections missing; never blocks (`decision: approve` always). Closes theo's H.7.9 Section C deferral with honest revision (PostToolUse:Write spec → PreToolUse:Write reality). Hook count: 12 → 13. Smoke tests: 13 → 17 (+4 H.7.12 tests). **Bonus install bug fix**: `install_hooks()` now copies `validators/` and `_lib/` subdirectories — pre-H.7.12 the legacy validators were unreachable via `$CLAUDE_DIR` (only `${CLAUDE_PLUGIN_ROOT}` worked).
- **H.7.11** Route-decide dictionary expansion (closes drift-notes 1 + 4). `weights_version` bumped `v1.1-context-aware-2026-05-07` → `v1.2-dict-expanded-2026-05-07`. ~50 new tokens across 5 dimensions + counter_signals. Strictly additive: no weight/threshold/dimension/suppression changes. Architect: `04-architect.ari` paired with `04-architect.theo` (`--convergence agree`). Drift-note 1 was root 0.225 → borderline 0.525; drift-note 4 was root 0.112 → route 0.675. All 6 H.7.3 calibration baselines byte-identical post-expansion (additive-only invariant). 9 new regression tests in `_h70-test.js` Section 6 (32 → 41 passing).
- **H.7.10** Mira retrospective fixes via `/build-plan` (recursive dogfood). Applies all 3 CRITICAL + 2 HIGH findings from mira's H.7.7+H.7.8 retrospective using the `/build-plan` flow shipped in H.7.9 — proves the abstraction is sound by eating own dogfood.
- **H.7.9** HETS-in-plan-mode injection. NEW `commands/build-plan.md` (dual-gate slash command modeled on `/build-team`); NEW `skills/build-plan/SKILL.md`; NEW `swarm/plan-template.md` (canonical plan template with mandatory sections — Context / Routing Decision verbatim JSON / HETS Spawn Plan / Files / Phases / Verification / Out of Scope / Drift Notes); NEW `skills/agent-team/patterns/plan-mode-hets-injection.md` (16th pattern). Converts soft-norm plan-mode + HETS-spawn discipline (`rules/core/workflow.md`) into a sharper gate without merging it with the route-decide gate. Recursive-dogfood property: theo (architect) designed the pattern using the pattern; mira (different identity, same persona family) authored the H.7.7+H.7.8 retrospective that motivated it.
- **`/plan` vs `/build-plan` decision tree** added to `rules/core/workflow.md`. Both coexist (additive). `/build-plan` Step 0's `root` recommendation redirects cleanly to `/plan`.
- **Drift-note convention** in plan files — captures soft-norm-drift observations during plan work; feeds the auto-loop's session-end review per `rules/core/self-improvement.md`.
- **H.7.7** substrate primitive additions (Critic→Refiner failure-consolidation hook + workflow-state-aware pre-compact). NEW `hooks/scripts/error-critic.js` (~210 LoC); workflow-state-aware `pre-compact-save.js` (+80 LoC); 2 new smoke tests (10 → 12).
- **H.7.8** plugin-dev tooling discipline. NEW `.markdownlint.json`, `.editorconfig`, `.github/workflows/ci.yml` (3 parallel jobs: smoke / markdown-lint / json-validate). README CI status badge.
- **install.sh test 13** — Cross-session leak detection (load-bearing property: state persistence across test boundary, NO rm-rf between tests 12 and 13).

### Fixed (H.7.10)

- **error-critic.js C-1 (TMPDIR session leak)** — Path now session-scoped: `${TMPDIR}/.claude-toolkit-failures/<SESSION_ID>/<key>.{count,log}`. SESSION_ID from `CLAUDE_SESSION_ID`/`CLAUDE_CONVERSATION_ID` env or random hex fallback. macOS-aware (was Linux-assumption broken).
- **error-critic.js C-2 (RMW race)** — Count + log RMW blocks now wrapped in `withLock` from `scripts/agent-team/_lib/lock.js`. H.3.2 canonical primitive used across kb-resolver/budget-tracker/tree-tracker.
- **session-reset.js C-1 defense-in-depth** — Cleans stale `.claude-toolkit-failures/<session-dir>/` entries > 1 day old at SessionStart.
- **pre-compact-save.js C-3 (SAVE_PROMPT integration)** — Replaced static const + suffix-append with dynamic `buildSavePrompt(activeRuns)`. Workflow-state integrates as NUMBERED 4th task INSIDE the 1-3 list, not as unnumbered H2 suffix. Error branch no longer glues suffix to error text.
- **pre-compact-save.js H-1 (path priority)** — `TOOLKIT_RUN_STATE_CANDIDATES` reordered: env vars (`CLAUDE_TOOLKIT_PATH`, `CLAUDE_PLUGIN_ROOT`) → cwd → walk-up from `__dirname` → hardcoded LAST. Closes silent no-op for non-author installs.
- **pre-compact-save.js H-2 (recency filter)** — `MAX_ACTIVE_AGE_MS = 4 hours`; runs older than 4hr filtered out before being marked "active". Verified: 29 stale → 1 active in current state.

---

## [1.0.0] — 2026-05-07 — `power-loom` (rename + evolution-loop ship)

**The H.7.x evolution-loop arc completed.** Plugin renamed from `claude-skills-consolidated` to `power-loom`. SemVer adopted. Stability commitment in README.

### Added

- **H.7.0** evolution loop + drift detection + multi-axis trust signal — `agent-identity breed` subcommand, parent-child generation propagation, diversity guard at breed-time, population cap, user-gate on first breed per persona; specialization-aware `cmdAssign`; drift triggers in `cmdRecommendVerification` (recalibration_due, task-novelty mismatch, quality-trend-down); new score-affecting axis `task_complexity_weighted_pass` (theory-driven +0.10 weight; reuses route-decide 7-dim score for bucketing); new observable axes `recency_decay_factor` (30-day half-life) and `qualityTrend` (3-spawn windowed slope). `WEIGHT_PROFILE_VERSION` bump to `"h7.0-multi-axis-v1"`. ~250 LoC code + 514 LoC tests + 210 LoC pattern doc.
- **CHANGELOG.md** — this file. Aggregates phase history into versioned releases.
- **Stability commitment** section in README — explicit stable / evolving / experimental classification.
- **Differentiation table** in README vs adjacent official marketplace plugins (`code-review`, `hookify`, `feature-dev`, `claude-md-management`, `claude-code-setup`).

### Changed

- **Plugin renamed** from `claude-skills-consolidated` to `power-loom` (`.claude-plugin/plugin.json` `name` field; `marketplace.json` references). Industrial Revolution metaphor: power-loom (Edmund Cartwright, 1784) automated coordination of weaving; this plugin does the same for multi-agent coordination on Claude Code. Skill namespace migrates from `/claude-skills-consolidated:X` to `/power-loom:X`.
- **Version** bumped from `0.5.0` to `1.0.0` (SemVer adopted; first stable release).
- **GitHub repo renamed** from `shashankcm95/claude-skills-consolidated` to `shashankcm95/claude-power-loom`. GitHub auto-redirects from old URL but URLs in the repo (homepage, install instructions, tag references) updated to the new canonical form. Phase tags + bookmarks under the old URL continue to resolve via redirect.

### Architecture commitments held

- `tierOf` byte-for-byte unchanged at `agent-identity.js:98-105` (H.4.2 audit-transparency commitment); 31/31 active identities had identical tier output pre/post H.7.0.
- All schema changes additive; legacy verdicts handled via `_backfillSchema` (renamed from `_backfillH66Schema`).
- No subprocess LLM calls (toolkit's deterministic-substrate convention preserved).

### Cycle data

mira (04-architect, medium-trust) caught 3 CRITICAL pushbacks before implementation: (C-1) multiplicative composition `composite = passRate × complexity × decay` had degenerate zeros — fix: composition stays additive within bonus; (C-2) `recency_decay` cannot be empirically fit at n=35 / 5.11d span — fix: ship as observable-only with theory-driven defaults until n≥30/span≥30; (C-3) new `task_complexity` verdict field would shift `aggregateQualityFactors` denominator silently — fix: derive at aggregate-time from existing `task_signature`. kira (13-node-backend) shipped per spec; convergence agree.

---

## [0.8.0] — 2026-05-07 — Today's session (5 phases)

### Added

- **H.7.5** route-decision context-awareness + forcing-instruction fallback. `--context` flag for `route-decide.js`; borderline-promotion rule (mira CRITICAL C-1 math fix); `[ROUTE-DECISION-UNCERTAIN]` forcing instruction. Closes the H.7.4 false-negative where bare task scored 0/root because routing signal lived in prior turn. `weights_version` bumped to `"v1.1-context-aware-2026-05-07"`.
- **H.4.3** prompt-enrich-trigger intent-aware skip. SKIP_PATTERNS extended for confirmation variants (`sure, go for it`, `let's go with X`, `ship it`, `make it so`); `[CONFIRMATION-UNCERTAIN]` forcing instruction for short ambiguous prompts. 3 new smoke tests (10 total now).

### Fixed

- **publish-polish-H.0** — 6 actionable items from prior plugin-readiness reviews: plugin.json `$schema` + explicit component paths; entities.json "Severity" anomaly; mempalace.yaml keyword dedupe; ATTRIBUTION smoke-test count (8→7→10); .gitignore tracked-file contradiction; install.sh recursive copy for `scripts/agent-team/`.
- **CS-13** IRL test environment isolation completion. `HETS_SPAWN_HISTORY_PATH` + `HETS_PATTERNS_PATH` env-var overrides on `spawn-recorder.js` + `pattern-recorder.js`. Coverage matrix now 4 of 4 (joins `HETS_IDENTITY_STORE` H.2.4 + `HETS_RUN_STATE_DIR` H.5.5).

---

## [0.7.0] — 2026-05-06 / 2026-05-07 — Trust formula evolution (H.7.x arc through H.7.4)

### Added

- **H.7.4** empirical refit of weighted trust score weights from accumulated 70 pattern entries. `file_citations_per_finding` `0.10 → 0.135` (Pearson r=0.439, moderate confidence); other 5 axes keep theory-driven priors (sparse data or weak correlation). Architect override on `tokens` axis (normative penalty vs descriptive correlation; sample-censoring confound). New `WEIGHT_PROFILE_VERSION = "h7.4-empirical-v1"`. **First production firing of H.7.1 high-trust spot-check**: A2 noTextSimilarityToPriorRun marked `skipped` for HIGH-TRUST `04-architect.ari`.
- **H.7.3** route-decision intelligence. `scripts/agent-team/route-decide.js` (CLI; pure-function 7-weighted-dimension scoring: stakes, novelty, compound, audit, scope, convergence, user-facing). Two thresholds (route ≥0.60, root ≤0.30, borderline between). New Step 0 in `commands/build-team.md` short-circuits before tech-stack-analyzer fires. New `Route-Decision for Non-Trivial Tasks` rule in `rules/core/workflow.md`. n=20 toolkit-wide builder verdict milestone hit; H.7.4 unblocked.
- **H.7.2** theory-driven weighted trust score. `computeWeightedTrustScore(stats, aggregateQF)` returns `{score, passRate, quality_bonus, components, ...}`. `score = passRate × (1 + clamped_bonus)` with cap [-0.10, +0.50]. Theory-driven weights with research citations (Dunsmore 2003, Bacchelli & Bird MSR 2013, Cohen's κ / Krippendorff's α). `tierOf` UNCHANGED.
- **H.7.1** asymmetric-challenger callsite wired into `/build-team` Step 7 (~93-line bash flow with three branches keyed off `recommend-verification.verification` field). New `cmdAssignPair` subcommand. Convergence axis: `pattern-recorder.js` extended with `--paired-with` + `--convergence agree|disagree|n/a`.
- **H.7.0-prep** hybrid quality factors + validation_sources registry. Identity records carry `quality_factors_history` array (per-verdict 5 axes: findings_per_10k, file_citations_per_finding, cap_request_actionability, kb_provenance_verified, tokens). Validation_sources registry extends `kb:hets/canonical-skill-sources` schema with optional RFC/NIST/paper citations.

---

## [0.6.0] — 2026-05-04 / 2026-05-06 — Substrate maturity cycle (H.5.1 through CS-6)

### Added

- **CS-6** end-user `skills/agent-team/USING.md` walkthrough (283 lines). 7-step product-engineer audience guide with worked example threading H.6.8 rate-limiting task. **First asymmetric architect+confused-user pair-run**. **First identity to reach HIGH-TRUST tier** (`04-architect.ari`).
- **H.5.7** engineering-task contract template (`swarm/personas-contracts/engineering-task.contract.json`). Generic shared template with engineering-fit thresholds (minFindings ≥1, hasFileCitations ≥1, no severity sections required, no audit-keywords). `commands/build-team.md` Step 7 task-type heuristic with `--task-type` override + extended audit-verb regex. Closes M-5 from H.6.9.
- **H.6.0–H.6.9** orchestration cycle: spawn-recorder for visibility; abstract-task orchestration walkthrough; Node/Express routing coherence (13-node-backend persona + contract + KB docs); skill-forge auto-warn at assign-time (`forgeNeeded` field surfaced); missing-capability-signal pattern (sub-agents diagnose; root acquires); lifecycle primitives (soft-retire + specialist-tag + L3-forward schema); canonical-source registry (24 entries: skill-name → official-docs URL); first-post-H.6.7 orchestration test (13-node-backend.kira PASS); full 5-task / 5-PASS orchestration cycle.
- **H.5.6** first builder dogfood run (12-security-engineer.mio authors auditor kb_scope; verdict PASS). First builder verdict ever recorded; populates real trust-formula data.
- **H.5.5** architectural cleanup — `hierarchical-aggregate.js` location decided; `_lib/runState.js` extracted (closes "_lib/ is a directory of one" finding).

### Fixed

- **H.5.1–H.5.4** CS-3 bundle: pattern status sync (9 patterns → active); KB exemption documentation; CS-3 CRIT bundle (5 fixes — kb_scope provenance via transcript checking; secrets validator hardening for github_pat_; README hook-count consistency; plugin install path documentation; Edit-tool secret scan field correction); self-improve-store hardening + frontmatter BOM (6 CS-3 HIGHs); remaining CS-3 HIGH cluster (filePath regex, CLAUDE_PLUGIN_ROOT verification, README clarity).

---

## [0.5.0] — 2026-05-02 — Initial Claude Code plugin packaging (H.5.0)

### Added

- Three plugin manifests at repo root per `code.claude.com/docs/en/plugins-reference` schema: `.claude-plugin/plugin.json`, `hooks/hooks.json`, `marketplace.json`.
- 11 deterministic hooks across 5 lifecycle events (SessionStart, UserPromptSubmit×2, PreToolUse×4, PreCompact, Stop×3): fact-force-gate, config-guard, console-log-check, pre-compact-save, prompt-enrich-trigger, session-reset, session-end-nudge, session-self-improve-prompt, auto-store-enrichment, validate-no-bare-secrets, validate-frontmatter-on-skills.
- HETS substrate: 13 personas (5 auditors + 8 builders), persistent identity reputation in `~/.claude/agent-identities.json`, triple-contract verification (functional + anti-pattern + structural), kb_scope enforcement with transcript provenance, content-addressed shared knowledge base.
- Auto self-improve loop with risk taxonomy (low → auto-graduate; medium → queue; high → manual `/self-improve`).
- Chaos-test meta-validation infrastructure (`/chaos-test`).
- Two install paths: plugin marketplace + legacy `install.sh`. Both produce identical `~/.claude/` state.
- Anti-AI-slop differentiation table in README comparing the plugin's enforcement footprint to typical SKILL.md-template plugins.

### Note on pre-0.5.0

The toolkit existed for 50+ phases prior to 0.5.0 (H.1 through H.4.2 + earlier). 0.5.0 is the first version with formal Claude Code plugin packaging. See annotated tags `phase-H.1` through `phase-H.4.2` for the phase-by-phase pre-packaging history; pre-0.5.0 work was direct-to-main before the CONTRIBUTING.md PR-flow conventions adopted at H.2.8.

---

## Unreleased

See [skills/agent-team/BACKLOG.md](skills/agent-team/BACKLOG.md) for deferred items. Major future directions:

- **HETS-on-git portfolio** (deferred on substrate gap — needs per-agent git credentials)
- **H.7.5+ refit** of recency_decay + qualityTrend axes (gated on n≥30/span≥30 days per identity)
- **Auto-mode breeding** (gated on observed population dynamics over ≥3 cycles)
- **Cross-version tracking** for route-decide ↔ agent-identity profile dependency

---

[1.0.0]: https://github.com/shashankcm95/claude-power-loom/releases/tag/v1.0.0
[0.8.0]: https://github.com/shashankcm95/claude-power-loom/releases/tag/phase-H.4.3
[0.7.0]: https://github.com/shashankcm95/claude-power-loom/releases/tag/phase-H.7.4
[0.6.0]: https://github.com/shashankcm95/claude-power-loom/releases/tag/phase-CS-6
[0.5.0]: https://github.com/shashankcm95/claude-power-loom/releases/tag/phase-H.5.0
