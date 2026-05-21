# Bench Coverage Map — Complete Plugin Verification

This document is the **contract for what "complete" coverage means**. Every plugin feature is listed with its current bench status, headless feasibility, and the scenario(s) that cover it.

Generated 2026-05-20 for v2.4.0 bench expansion (was v0.1 single-scenario boot test).

## Coverage status legend

- ✅ **Auto-verified** — exercised by ≥1 scenario; bench reports PASS/FAIL deterministically
- 🟡 **Probabilistic** — exercised but depends on model stochasticity (re-run may differ)
- 🔧 **Lifecycle-only** — requires multi-session / compaction triggers; covered by `bench/lifecycle-test.sh`
- ❌ **Headless-impossible** — interactive-only per Claude Code; covered by manual checklist `bench/interactive-checklist.md`
- ⬜ **Not yet covered** — gap; needs new scenario

---

## Rules (always-on context)

All rules load into context as part of the plugin manifest. Their presence is verified indirectly by the cache-read token count (~800K-1M tokens per session = full rule+skill+KB substrate loaded).

| Rule | Verification |
|---|---|
| `rules/core/prompt-enrichment.md` | ✅ via cache-read + UserPromptSubmit hook |
| `rules/core/research-mode.md` | ✅ via `research_mode_citations` soft signal |
| `rules/core/self-improvement.md` | ✅ via Stop hook (turnCounter delta) |
| `rules/core/fundamentals.md` | ✅ via cache-read (passive) |
| `rules/core/security.md` | ✅ via Scenario 02 (security-heavy task) |
| `rules/core/workflow.md` | ✅ via GAP-C route-decide hook + plan_mode_evidence signal |

---

## Hooks (5 events)

### SessionStart
| Hook | Coverage |
|---|---|
| `session-reset.js` | ✅ Auto-verified (fires once per session; log file exists) |

### UserPromptSubmit
| Hook | Coverage |
|---|---|
| `prompt-enrich-trigger.js` | 🟡 Probabilistic (task vagueness varies) |
| `session-self-improve-prompt.js` | 🔧 Lifecycle-only (fires only when pending queue is non-empty) |

### PreToolUse
| Hook | Matcher | Coverage |
|---|---|---|
| `verify-plan-gate.js` | ExitPlanMode | ⬜ Needs Scenario 04 (HETS-routed plan) |
| `route-decide-on-agent-spawn.js` | Agent\|Task | ✅ via GAP-C — verified every Agent spawn |
| `fact-force-gate.js` | Read\|Edit\|Write | ✅ via Scenario 01 (file edits succeed = passed) |
| `config-guard.js` | Edit\|Write | ⬜ Not exercised — boot task doesn't edit settings files |
| `validators/validate-yaml-frontmatter.js` | Edit\|Write | 🟡 Fires opportunistically on .md edits with frontmatter |
| `validators/validate-frontmatter-on-skills.js` | Edit\|Write | ⬜ Not exercised — no skill edits |
| `validators/validate-no-bare-secrets.js` | Edit\|Write | ⬜ Needs Scenario 02 (security task with fake secret pattern) |
| `validators/validate-kb-doc.js` | Edit\|Write | ⬜ Not exercised — no KB doc edits |
| `validators/console-log-check.js` | Edit\|Write | ⬜ Not exercised — no console.log in fixture changes |

### PostToolUse
| Hook | Matcher | Coverage |
|---|---|---|
| `error-critic.js` | Bash | ⬜ Needs Scenario 05 (failing Bash triggers escalation) |
| `kb-citation-gate.js` | Agent\|Task | ✅ via GAP-D — block-and-retry verified end-to-end |
| `validators/validate-plan-schema.js` | Edit\|Write | ⬜ Needs Scenario 04 (plan file with required sections) |

### Stop
| Hook | Coverage |
|---|---|
| `auto-store-enrichment.js` | ✅ turnCounter delta verified every run |
| `session-end-nudge.js` | 🔧 Lifecycle-only |

### PreCompact
| Hook | Coverage |
|---|---|
| `pre-compact-save.js` | 🔧 Lifecycle-only — covered by `bench/lifecycle-test.sh` |

---

## Agents (5 in `agents/*.md`)

| Agent | Coverage | Where |
|---|---|---|
| `architect` | ✅ via Scenario 01 (substantive multi-feature task) |
| `code-reviewer` | ✅ via Scenario 01 (post-write review) |
| `security-auditor` | ⬜ Needs Scenario 02 (security-heavy task with explicit nudge) |
| `planner` | 🟡 Probabilistic via Scenario 04 (HETS-routed task may trigger) |
| `optimizer` | 🟡 Probabilistic — no scenario reliably triggers; document as advisory-only |

---

## Skills (17 in `skills/`)

Domain-specific; most don't load unless task keywords trigger them. Verified by tool presence in the init event (cache-creation cost).

| Skill | Always-loaded? | Coverage |
|---|---|---|
| `agent-team` | YES (HETS substrate) | ✅ cache-read |
| `agent-swarm` | YES | ✅ cache-read |
| `build-plan` | YES | ✅ cache-read |
| `prompt-enrichment` | YES | ✅ cache-read |
| `research-mode` | YES | ✅ cache-read |
| `self-improve` | YES | ✅ cache-read |
| `skill-forge` | YES | ✅ cache-read |
| `verify-plan` | YES | ✅ cache-read |
| `tech-stack-analyzer` | on-demand | 🟡 Not auto-triggered by fixture; document |
| `fullstack-dev` | on-demand | 🟡 Not auto-triggered by fixture |
| `deploy-checklist` | on-demand | 🟡 Not auto-triggered by fixture |
| `node-backend-development` | on-demand | 🟡 May trigger on Scenario 01 (Node CLI) |
| `swift-development` | on-demand | ❌ Not triggerable from Node fixture |
| `react` | on-demand | ❌ Not triggerable from CLI fixture |
| `kubernetes` | on-demand | ❌ Not triggerable from local fixture |
| `airflow` | on-demand | ❌ Not triggerable |
| `penetration-testing` | on-demand | 🟡 May trigger on Scenario 02 |

**Domain-skill triggering**: not all skills are testable in a single fixture environment. Document this as a known limit; the always-loaded skills (8 of 17) are verified.

---

## Slash commands (13 in `commands/`)

Per Claude Code docs, slash commands are INTERACTIVE-ONLY in `-p` mode. None are testable in headless bench. All documented in `bench/interactive-checklist.md`.

| Command | Coverage |
|---|---|
| `/build-plan` | ❌ Headless-impossible |
| `/build-team` | ❌ Headless-impossible |
| `/chaos-test` | ❌ Headless-impossible |
| `/evolve` | ❌ Headless-impossible |
| `/forge` | ❌ Headless-impossible |
| `/implement` | ❌ Headless-impossible (but Claude does this autonomously) |
| `/plan` | ❌ Headless-impossible (but Claude enters plan-discipline autonomously via TodoWrite) |
| `/prune` | ❌ Headless-impossible |
| `/research` | ❌ Headless-impossible |
| `/review` | ❌ Headless-impossible (but code-reviewer agent fires autonomously) |
| `/security-audit` | ❌ Headless-impossible (but security-auditor agent may fire on signal) |
| `/self-improve` | ❌ Headless-impossible |
| `/verify-plan` | ❌ Headless-impossible (but auto-fires for HETS-routed plans) |

---

## CLI substrate (`scripts/`)

| Script | Coverage |
|---|---|
| `agent-team/route-decide.js` | ✅ via GAP-C hook |
| `agent-team/agent-identity.js` | ⬜ Needs Scenario 04 (HETS spawn assigns identity) |
| `agent-team/contract-verifier.js` | ⬜ Needs Scenario 04 (HETS verification) |
| `agent-team/pattern-recorder.js` | ⬜ Needs Scenario 04 |
| `agent-team/kb-resolver.js` | 🟡 Opportunistic (if architect uses Bash to consult KB) |
| `library.js` (init/write/read/ls/stats/gc/daybook) | ⬜ Needs Scenario 03 (library-substrate task) |
| `library-migrate.js` | 🔧 Lifecycle-only (migration is one-shot) |
| `prompt-pattern-store.js` | ✅ via prompt-enrich hook indirectly |
| `self-improve-store.js` | 🔧 Lifecycle-only (queue + scan) |

---

## KB substrate (~37 docs in `skills/agent-team/kb/`)

KB consultation is verified by GAP-A + GAP-D (kb_consultation soft signal). Specific docs cited vary per task. **Not feasible to verify every single doc** — that would require triggering many varied tasks.

| Coverage | Approach |
|---|---|
| ≥1 kb: ref in architect response | ✅ via GAP-D enforcement |
| ≥3 unique kb: docs across all scenarios | ⬜ Track in run-all-scenarios aggregator |
| Specific kb docs (security/, architecture/discipline/, etc.) | 🟡 Scenarios 01-04 will cite multiple categories |

---

## Lifecycle events

| Event | Coverage |
|---|---|
| Session start | ✅ session-reset.js fires |
| Mid-session tool use | ✅ all PreToolUse + PostToolUse hooks |
| Session end | 🔧 `bench/lifecycle-test.sh` simulates |
| Pre-compaction | 🔧 `bench/lifecycle-test.sh` triggers |
| Session resume (--continue) | 🔧 `bench/lifecycle-test.sh` validates |

---

## Scenario design plan

To close the ⬜ gaps:

| Scenario | Targets | Priority |
|---|---|---|
| `01-multi-feature-export` (existing) | architect, code-reviewer, KB, route-decide, plan, fact-force-gate | HIGH (already shipped) |
| `02-security-audit` | security-auditor agent, validate-no-bare-secrets, security.md rule | HIGH |
| `03-library-substrate` | library CLI verbs, library hooks, library catalog | HIGH |
| `04-hets-routed-plan` | verify-plan-gate, validate-plan-schema, planner, contract-verifier, agent-identity | HIGH |
| `05-error-recovery` | error-critic.js, fail-and-retry pattern | MEDIUM |
| `06-settings-edit` | config-guard.js | LOW (settings edits are rare in normal flow) |
| `07-kb-doc-edit` | validate-kb-doc.js | LOW |

**Phase 1 (v2.4.0)**: scenarios 01-05 + lifecycle-test + interactive checklist
**Phase 2 (later)**: scenarios 06-07 if observability gaps surface in practice

---

## Aggregate verification target

After v2.4.0:
- **Auto-verified (✅)**: ~70% of plugin features
- **Probabilistic (🟡)**: ~15% (variance documented; multi-run aggregation in scenario aggregator)
- **Lifecycle-only (🔧)**: ~5% (covered by lifecycle-test)
- **Headless-impossible (❌)**: ~10% (documented in interactive checklist)

**This is what "complete plugin verification" means within Claude Code's headless constraints.** True 100% would require an interactive driver (separate scope).
