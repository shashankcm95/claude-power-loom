---
pattern: route-decision
status: active+enforced
intent: Deterministic gate that decides whether a task warrants HETS routing vs root-direct response, scored on 7 weighted dimensions with two thresholds and a borderline band.
related: [tech-stack-analyzer, trust-tiered-verification, prompt-distillation]
---

## Summary

Pure-function CLI scores a task on 7 weighted dimensions (stakes, novelty, compound, audit, scope, convergence-value, user-facing) plus an infra-implicit lift and counter-signal penalty. Two thresholds: route ≥0.60, root ≤0.30, borderline between. Defaults to root for trivial work and route for compound architecture-stakes work; borderline cases surface to the user. Sums to ~1.0 at the cap; deterministic, <100ms, theory-driven (refit at n≥20 verdicts).

## Intent

The toolkit had no first-class gate between "user types a task" and "spawn a HETS team" before H.7.3 — root made that call ad-hoc. The dataset of two motivating events: the URL-shortener pair-run cost ~93K tokens for a one-shot user task whose root-direct alternative would have shipped at ~3K (`swarm/run-state/orch-user-task-url-shortener-20260507-062607/`); the BACKLOG-cleanup got architect+code-reviewer for a 9-line doc surgery (`swarm/H.5.7-findings.md:14-16`). At ~30× cost ratio for ~3× failure-mode coverage, the under-/over-routing tax was large enough to deserve a deterministic gate.

The asymmetric cost-quality table (mirrors `missing-capability-signal.md:22-27`):

| Routing | Token cost | Quality on right call | Quality on wrong call |
|---------|-----------|------------------------|------------------------|
| Root direct, task warrants routing | low (~3K) | 1× failure-mode coverage | misses HIGH issues (e.g., URL-shortener PII + Mermaid drift) |
| Root direct, task is genuinely root-fit | low (~3K) | full coverage | none — correct call |
| HETS routing, task warrants routing | high (~30-100K) | 3× failure-mode coverage | none — correct call |
| **HETS routing, task is genuinely root-fit** | **high (~30-100K)** | **0 marginal coverage** | **30× cost waste** (BACKLOG-cleanup case) |

The route-decision gate exists to minimize the bottom-row case while preserving the third-row case.

## Components

The 7-dimension scoring table consumed by `scripts/agent-team/route-decide.js`:

| Dimension | Weight | Trigger | Example keywords |
|-----------|--------|---------|------------------|
| Stakes | 0.25 | High-stakes context | production, scalable, secure, auth, payments, encryption, oauth, kubernetes, k8s, terraform, helm (24 keywords) |
| Domain novelty | 0.15 | Unfamiliar territory | novel, prototype, experiment, unfamiliar, new framework, ... |
| Compound-strong | 0.15 | Compound design with non-double-counted keyword | schema, migration, protocol, consensus, state-machine, pipeline |
| Compound-weak | 0.075 (suppressed if Stakes fires) | Generic design language alone | architecture, design, framework, system |
| Audit binary | 0.20 (binary) | Audit/compliance task | audit, compliance, certification, regulatory |
| Scope size | 0.075 | Multi-file / multi-component | multi-file, manifest, service, endpoints, apis, ... |
| Convergence value | 0.15 | Non-obvious tradeoffs | tradeoff, options, compare, eviction policy, consistency model, pagination, search, URL shortener |
| User-facing / UX | 0.10 | UX or doc-heavy work | user-facing, walkthrough, tutorial, component, UI, UX, accessibility |
| Infra-implicit-stakes | +0.30 (lift) | Infra prompt | k8s, kubernetes, terraform, helm, docker-compose, ansible, infrastructure, deployment, manifest |
| Counter-signals | -0.25 (single penalty) | Trivial / small | typo, prune, cleanup, delete entries, stale, quick, hello world |
| Short-prompt penalty | -0.10 | <5 words | (no keywords; word-count gate) |

Thresholds: ≥0.60 → route, ≤0.30 → root, between → borderline. Confidence = distance from nearest threshold normalized to [0, 1] over a 0.30 band.

## Failure Modes

1. **Keyword evasion** — task description avoids the keyword set deliberately ("audit my code without saying 'audit'"). Counter: borderline band catches genuine cases via convergence-value + scope-size; users can `--force-route`.
2. **Implicit-stakes miss** — task is high-stakes but doesn't surface keywords (e.g., "make my login flow async"). Partial counter via infra-implicit lift; otherwise relies on user invoking `--force-route`. Future H.7.5+ phase: add domain-classifier (text classifier or LLM tier-2 fallback for borderline) but H.7.3 keeps it pure-function.
3. **Calibration drift** — keyword sets become stale as user's task vocabulary evolves. Counter: `weights_version` in output enables retrospective refit at n≥20 routing decisions per H.7.5+.
4. **Borderline overuse** — too many tasks land in borderline, defeating the gate's purpose (just push everything to user). Counter: monitor borderline-frac; if >40% of decisions are borderline, threshold band needs tightening.
5. **Pure-keyword ceiling** — tasks #2 and #5 in the calibration self-test (React component, USING.md walkthrough) hit zero or near-zero positive dimensions despite the user expecting `route`. This is a structural limitation of pure-keyword routing: subjective "I want a team on this" can't be reproduced from text features alone. `--force-route` is the user's escape hatch; future LLM-tier-2 fallback for low-confidence borderline cases is the proposed follow-up.
6. **Per-user calibration** — a heavy security-engineer might want different weights than a heavy frontend-engineer. Counter: `weights_version` ships in output; future `HETS_WEIGHT_PROFILE` env override would let per-user tuning via JSON config (deferred to H.7.4+).

## Validation Strategy

Self-test calibration: 6 historical tasks should produce specific recommendations.

| # | Task | Expected | Notes |
|---|------|----------|-------|
| 1 | "Add rate limiting to my Express API endpoints" | borderline | Stakes (rate-limit) + scope (endpoints) → 0.325 — genuinely borderline (root could implement; HETS shines if multi-tier). |
| 2 | "React search-results-with-pagination component" | root | 0.15 — known limit (R2): pure-keyword routing can't capture "complex UI state" subjectivity. `--force-route` is the user's escape. |
| 3 | "Author k8s Deployment + Service manifest" | route | Stakes (k8s) + scope (manifest, service) + infra-implicit-lift → 0.625. Infra is universally Stakes-bearing. |
| 4 | "Drop 9 stale entries from BACKLOG.md" | root | Counter-signal (stale) → 0. Trivial doc surgery. |
| 5 | "Author USING.md walkthrough" | root | 0 (with short-prompt penalty). Known limit (R2): doc-walkthrough is borderline-subjective. |
| 6 | "Design scalable URL shortener" | borderline | Stakes (scalable) + convergence (URL shortener) → 0.4. Canonical borderline case the gate exists for. |

All 6 land at expected verdicts under the v1 weights (`v1-theory-driven-2026-05-07`).

Stress tests: empty prompt → exit 2; single-keyword prompt → root; multi-keyword high-stakes prompt → route at high confidence; counter-signal + stakes prompt → counter-signal wins (BACKLOG-class).

## When to Use

- Always-on at `/build-team` Step 0 (the literal callsite — see `commands/build-team.md` Step 0)
- Soft rule for ad-hoc tasks via `rules/core/workflow.md`'s "Route-Decision for Non-Trivial Tasks" section
- Any time root is unsure whether a task warrants HETS routing — running the script is cheap (<100ms, deterministic) and the decomposition is itself a useful explanation

## When Not to Use

- User explicitly invokes `--force-route` (e.g., "I know this is borderline but I want a pair-run anyway")
- User explicitly says "just answer this in chat" or asks for a quick / single-line response
- `/chaos-test` runs (which are pre-routed by definition — chaos tests the toolkit, not user tasks)
- Continuation of in-progress orchestration (the gate was already run at task entry)

## Enforcement callsite

The 7-dimension scoring at `scripts/agent-team/route-decide.js` is consumed by `commands/build-team.md` Step 0. Step 0 branches on the `recommendation` field returned by `route-decide.js --task X`, dispatching to one of three flows: `route` (continue to Step 1), `borderline` (escalate to user with score decomposition + 3-option menu), `root` (exit 0 with skip-orchestration message). The Step 0 bash flow uses fail-open default (missing script → assume `route`) to preserve pre-H.7.3 behavior on degraded installs. See `commands/build-team.md` Step 0 for the literal shell flow.

## H.7.5 — Layered context-aware routing

Phase H.7.5 closed a real-world false-negative: the H.7.4 task ("Empirical refit of weighted_trust_score weights from accumulated verdict data") scored 0 under H.7.3 because its routing signal lived in the **prior assistant turn**, not the bare task string. The fix is layered:

### Layer A — `--context` flag

`route-decide.js --task X --context Y` accepts free-form context (last 1-3 conversation turns, max 8K chars). Keyword regex runs against context too; results multiplied by `CONTEXT_WEIGHT_MULT = 0.5` (lower than task-derived; context is signal, not source-of-truth) and added to base score. Output JSON gets `context_provided` + `context_contributions` for transparency.

### Layer B — Borderline-promotion rule (the load-bearing fix)

The naïve `0.5x mult` doesn't fix the H.7.4 false-negative on its own — the math doesn't promote. mira (architect, H.7.5 design) ran the math empirically: bare task = 0.000; context standalone = 0.225; combined = 0.113 — still below 0.30 root threshold. Need an explicit promotion rule:

> **If bare task is low-signal (`score_total < 0.10`) AND `context_score_raw >= 0.10`, force `recommendation = "borderline"` regardless of additive total.**

Rationale: when the task itself has zero keyword signal but the conversation context has substantive signal, the right verdict is "uncertain — surface to user," not "default to root and pretend the context doesn't exist." Output JSON gains `borderline_promotion_applied: true` for audit.

### Layer C — `[ROUTE-DECISION-UNCERTAIN]` forcing instruction

When score_total ≤ 0.05 AND no `--context` was supplied AND not force-overridden AND wordCount ≥ 4, output JSON includes a `forcing_instruction` block telling Claude to consult prior context before defaulting to root. Mirrors `[PROMPT-ENRICHMENT-GATE]` and `[SELF-IMPROVE QUEUE]` patterns — structural reminder injected into Claude's flow; root makes the semantic call. **No subprocess LLM call** (preserves toolkit's deterministic-substrate convention).

### Layer D — Workflow rule

`rules/core/workflow.md`'s Route-Decision section gains H.7.5 conventions: always pass `--context` on conversation continuations; never silently default to root on UNCERTAIN; design prompts to embed the routing signal explicitly.

### Why this stays within toolkit patterns

The instinct of "consult an LLM for borderline cases" is correct in spirit but wrong for this toolkit. The substrate's pattern is **forcing-instruction injection into Claude's existing context, not subprocess LLM calls**. Layer C does that — it doesn't call out to an LLM; it nudges Claude (already running) to apply intent reasoning where the heuristic abstained.

## H.7.11 — Dictionary expansion (closes drift-notes 1 + 4)

`weights_version` bumped: `v1.1-context-aware-2026-05-07` → `v1.2-dict-expanded-2026-05-07`. Strictly additive within keyword sets; no weight, threshold, dimension, or suppression-rule changes. Architect: `04-architect.ari` (paired with `04-architect.theo` via `--convergence agree`).

### Empirical motivation

Same session captured two false-negatives:

- **Drift-note 1**: `route-decide.js --task "Phase H.7.9 — design + ship HETS-in-plan-mode injection bundled with mira retrospective CRITICAL fixes ..."` returned `root` (score 0.225). Genuinely architectural multi-file work; should have been at least `borderline`.
- **Drift-note 4**: `route-decide.js --task "Apply mira's H.7.7+H.7.8 retrospective CRITICAL fixes — C-1 TMPDIR session leak, C-2 RMW race ..."` returned `root` (score 0.112). Substrate fix work with high stakes + audit signal; should have been `route`.

Two empirical observations of the same gap class within one session is sufficient evidence for refit per H.7.4 precedent.

### Per-dimension additions

| Dimension | Tokens added | Closes |
|-----------|--------------|--------|
| `stakes` (0.25) | `critical`, `severity`, `race-condition`, `race condition`, `deadlock`, `leak`, `memory leak`, `session leak`, `breach`, `vulnerability`, `cve`, `exploit` | drift-note 4 |
| `compound_strong` (0.15) | `race`, `concurrency`, `concurrent`, `locking`, `mutex`, `lock`, `RMW`, `read-modify-write`, `distributed`, `replication`, `transaction`, `atomic`, `idempotent`, `idempotency` | drift-note 4 |
| `compound_weak` (0.075, suppressed by stakes) | `architectural`, `refactor`, `refactoring`, `restructure` | proactive |
| `audit_binary` (0.20) | `retrospective`, `postmortem`, `post-mortem`, `root-cause`, `root cause`, `findings`, `review pass`, `audit pass` | drift-notes 1, 4 |
| `scope_size` (0.075) | `across-files`, `hooks`, `scripts`, `callsites`, `callsite` | drift-note 4 |
| `counter_signals` (-0.25) | `polish`, `polishing`, `jsdoc`, `docstring`, `frontmatter`, `comment`, `comments`, `formatting`, `lint`, `linting`, `prettier`, `rename`, `renaming`, `whitespace` | proactive |

Three dimensions (`domain_novelty`, `convergence_value`, `user_facing_or_ux`) received **no additions** — drift-notes were familiar substrate work, not novelty / convergence-needing-evaluation / UX.

### Verified projections

- Drift-note 1: was `root` 0.225 → post-expansion `borderline` 0.525
- Drift-note 4: was `root` 0.112 → post-expansion `route` 0.675
- All 6 H.7.3 calibration baselines unchanged (additive-only invariant verified)
- Counter-signal probes (`Add JSDoc to scoreTask function`, `Polish frontmatter on pattern docs`) stay `root` 0
- Suppression check (`refactor auth module`) — `compound_weak` correctly suppressed (`suppressed_by_stakes: true`)

### Tradeoffs (ari's honest read)

- **Token cost**: ~1.8× substrate-phase token spend expected (drift-note class tasks now route at higher rate). Justified — these are exactly the cases where HETS earns its 30× cost ratio.
- **Doesn't fix the deeper issue**: keyword heuristic ceiling remains. A phrase-level model or LLM tier-2 fallback would close more gaps; this is purely a dictionary fix. H.7.5's `[ROUTE-DECISION-UNCERTAIN]` forcing instruction is the substrate-correct shape for the deeper case.
- **`refactor` ambiguity**: accepted because compound_weak suppression by stakes mitigates over-routing. Drop on FP regression observation.
- **Bare `leak` FP risk**: accepted because compound forms (`session leak`, `memory leak`) listed first bias toward high-precision. Drop bare on FP regression.

### Decline list (drift-notes flagged but ari rejected)

- `bundled`, `bundle` — too ambiguous (webpack vs orchestration)
- `meta-discipline` — too domain-specific to this toolkit
- bare `fix`, `fixes` — too generic (every bug fix would over-route)

## Related Patterns

- [Tech-Stack Analyzer](tech-stack-analyzer.md) — what fires AFTER the route gate when the recommendation is `route`. The route gate prevents tech-stack-analyzer from running on tasks that don't warrant HETS routing.
- [Trust-Tiered Verification](trust-tiered-verification.md) — same architectural shape: pure-function pre-flight gate that scales depth (or routing) by signal. Both ship substrate + callsite in the same phase.
- [Prompt Distillation](prompt-distillation.md) — the route-decision pattern is itself prompt distillation applied to "should we run the full orchestration?" — turns a high-cost decision into a low-cost score.
