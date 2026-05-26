# power-loom Plugin Verification Harness (v2.4.0)

**Scenario-aware boot test for comprehensive plugin verification.** Originally a single-shot harness in v2.3.0 (one task verifying the auto-trigger path); v2.4.0 expands to 5 scenarios + lifecycle test + interactive checklist for full coverage.

## Quick start

```bash
cd <toolkit-repo>

# Single scenario (~1-5 min)
bash bench/runner.sh                              # default: scenario 01
bash bench/runner.sh --scenario 02-security-audit
bash bench/runner.sh --list                       # see all scenarios

# Lifecycle test (~30s; static + dynamic hook coverage)
bash bench/lifecycle-test.sh

# Comprehensive run (~10-25 min; ALL scenarios + lifecycle + aggregate report)
bash bench/run-all.sh
```

## Architecture (v2.4.0)

```
bench/
├── README.md                     this file
├── COVERAGE-MAP.md               full feature-coverage matrix
├── EXPERIMENT-LOG.md             baseline-vs-TDD experiment data
├── interactive-checklist.md      manual verification for 13 slash commands
├── runner.sh                     scenario-aware runner (--scenario, --list, --bare)
├── lifecycle-test.sh             session-end + PreCompact hook coverage
├── run-all.sh                    aggregate runner — all scenarios + lifecycle + report
├── collect.js                    metrics extractor + universal checks + dispatch to validate.js
├── _snapshot.js                  ~/.claude/ state capture for pre/post diff
└── scenarios/
    ├── 01-multi-feature-export/
    │   ├── task.md               passed verbatim to claude -p
    │   ├── fixture/              working files
    │   ├── expected.json         declared PASS criteria + expected signals
    │   └── validate.js           scenario-specific check functions
    ├── 02-security-audit/        (same shape)
    ├── 03-library-substrate/
    ├── 04-hets-routed-plan/
    └── 05-error-recovery/
```

## Scenarios

| # | Name | Targets | Wallclock | Avg tokens out |
|---|---|---|---|---|
| **01** | multi-feature-export | architect + code-reviewer + KB + route-decide + plan discipline (the core auto-trigger path) | ~3-7 min | ~10-20K |
| **02** | security-audit | security-auditor agent + validate-no-bare-secrets + security KB refs | ~2-4 min | ~3-8K |
| **03** | library-substrate | library CLI verbs (stats / daybook / write / read / gc) + catalog R/W | ~1-3 min | ~2-5K |
| **04** | hets-routed-plan | plan-mode tools + validate-plan-schema + verify-plan-gate + deep KB consultation | ~5-10 min | ~15-30K |
| **05** | error-recovery | error-critic.js (PostToolUse:Bash) + diagnose-then-fix workflow | ~1-3 min | ~2-5K |

**Total run-all.sh cost estimate**: 10-25 min wallclock, ~50K-150K output tokens.

## Two layers of PASS criteria

### Universal checks (every scenario)
- `claude_exit_zero` — claude -p completes
- `subagent_spawned` — at least 1 Agent tool call
- `no_ask_user_question_errors` — `--permission-mode bypassPermissions` working
- `stop_hook_fired` — `auto-store-enrichment.js` bumped turnCounter

### Scenario-specific checks (per `scenarios/<id>/validate.js`)
Each scenario owns its check function exporting `validate(workdir, streamMetrics, hookBumps)` and returning a `{check: {pass, detail}}` object. Examples:
- Scenario 01: cli_has_export, cli_has_both_formats, cli_has_path_validation, ...
- Scenario 02: auth_has_rotate_token, auth_uses_constant_time_compare, no_secret_block_false_positive, ...
- Scenario 03: library_stats_invoked, library_volume_persisted, library_catalog_entry_present, ...
- Scenario 04: cache_has_ttl, cache_has_lru, cache_has_stats, plan_artifact_present, ...
- Scenario 05: broken_build_initial_failure, broken_build_eventually_succeeds, no_repeat_failure_forcing_instruction

## Soft signals (informational; not gating)

5 cross-cutting plugin-behavior observations, captured by `collect.js`:
- `kb_consultation` — kb: refs in transcript or sub-agent results
- `specialist_agents_spawned` — architect / code-reviewer / security-auditor
- `plan_mode_evidence` — EnterPlanMode tool OR TodoWrite ≥2 items OR .claude/plans/*.md
- `route_decide_consulted` — PreToolUse hook fired OR Bash invocation
- `research_mode_citations` — URL / file:line / "per RFC N" patterns

## Coverage summary (per `COVERAGE-MAP.md`)

| Status | % | Approach |
|---|---|---|
| ✅ Auto-verified | ~70% | Scenarios 01-05 |
| 🟡 Probabilistic | ~15% | Variance documented; some skills/agents are task-dependent |
| 🔧 Lifecycle-only | ~5% | `lifecycle-test.sh` (8/8 PASS) |
| ❌ Headless-impossible | ~10% | `interactive-checklist.md` (13 slash commands) |

**100% coverage is genuinely impossible** because Claude Code's slash commands are interactive-only by design. The interactive checklist closes the residual gap manually.

## What changed from v2.3.0

| v2.3.0 | v2.4.0 |
|---|---|
| 1 boot task | 5 scenarios |
| Hardcoded PASS criteria in collect.js | Per-scenario `validate.js` files |
| No lifecycle coverage | `lifecycle-test.sh` (8 checks) |
| No interactive coverage | `interactive-checklist.md` (15 items) |
| No aggregator | `run-all.sh` + auto-generated `report.md` |
| ~25% feature coverage | ~85% feature coverage (modulo headless-impossible) |

## Plugin observations the bench surfaced

Across the v2.3.0 + v2.4.0 development:
1. **GAP-A** — architect.md missing response-level KB output contract → fixed in v2.3.0
2. **GAP-B** — workflow.md plan rule conflated intent with mechanism → fixed in v2.3.0
3. **GAP-C** — route-decide rule unenforceable as text → PreToolUse hook in v2.3.0
4. **GAP-D** — GAP-A's fix was probabilistic → PostToolUse hook with block-and-retry in v2.3.0

The bench's primary value: it caught these compliance gaps that would have shipped to users otherwise.

## Reporting back

For the dogfooding phase (2-3 other Claude developers), share:
- Output of `bash bench/run-all.sh`
- The aggregate `bench/runs/<ts>-aggregate/report.md`
- Any unexpected behavior

Send to: plugin maintainer or open an issue at https://github.com/shashankcm95/claude-power-loom/issues
