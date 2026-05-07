# H.7.5 — Route-decision context-awareness + forcing-instruction fallback (PASS)

> Seventh phase via corrected autonomous-platform pattern. Closes the H.7.4 false-negative replay where bare task scored 0/root because routing signal lived in the prior turn. **Single-architect-only verdict run** — implementation completed by root manually after kira spawn was withdrawn; orchestration pattern flexibly accommodates this.

## Cycle headline

- **Architect-only verdict**: 04-architect.mira (MEDIUM-TRUST tier — full-verification per H.7.1 policy, NOT spot-check; user-task contamination from URL-shortener test had dropped mira from approaching-high-trust to medium-trust per CS-13)
- **PASS**: 12 findings, 47 file citations, ~70K tokens; full antiPattern checks ran clean (A1 `noTextSimilarityToPriorRun` resolved `no_prior_run`; A2 `noPaddingPhrases` pass; A3 `acknowledgesFallback` pass)
- **CRITICAL C-1 caught by mira (load-bearing math correction)**: the user's H.7.5 plan said `CONTEXT_WEIGHT_MULT = 0.5` would fix the false-negative. Mira ran the math empirically: bare 0 + (0.225 × 0.5) = **0.113 < 0.30 root threshold** — still root. Even at `mult = 1.0` the case lands at 0.225 — still below `ROOT_THRESHOLD`. **Required explicit borderline-promotion rule**.
- **CRITICAL C-2 caught by mira**: user's Layer C trigger over-specified (`score_total <= 0.05 AND confidence <= 0.4 AND !args.context`). Mira narrowed to `low_signal === true AND !args.context AND !forced AND wordCount >= SHORT_PROMPT_WORD_THRESHOLD` — `low_signal` is the actual ground-truth signal; the other predicates are derived from it.
- **Implementation by root**: 6 manual edits to `scripts/agent-team/route-decide.js` (+192/-12 LoC) after kira spawn withdrawn. Acceptance tests + 6-task regression sweep ran clean.
- **Self-test (load-bearing replay)**: H.7.4 false-negative — bare task → root/score=0/uncertain:true; with context → **borderline/score=0.112/borderline_promotion_applied:true** (THE FIX)

## Motivation

The H.7.4 task description ("Empirical refit of weighted_trust_score weights from accumulated verdict data") scored 0 in `route-decide.js`. Root cause discovered in real time: the previous assistant turn said `"Walk the 70 pattern entries + quality_factors_history; fit weighted_trust_score weights from data; compare against H.7.2 theory-driven priors. ~1-2 hr via orchestration."` — explicit routing recommendation in source. The gate received a bare 6-word string and produced score=0, recommendation=root.

Three problems compound:
1. **Context blindness** — `route-decide.js` operates on isolated string; ignores conversation context where intent often lives
2. **Keyword ceiling** — surface-feature classification has fundamental limits; semantic intent should be source-of-truth for ambiguous cases
3. **Substrate-rich, call-site-poor** (the architect's recurring pattern) — prompt-enricher exists but route-decide doesn't use it

User constraint that reshaped the plan: **bound context to last 1-3 turns** ("we don't need the whole context, the last one or maybe even the last 2-3 responses should provide us with enough context"). Cheap, sufficient signal, avoids pathological large-context cases.

## What landed

### Layer A — `--context` flag

`scripts/agent-team/route-decide.js`:
- New CLI flag: `--context "<recent context text>"` (free-form; max 8K chars)
- Context gets keyword-regexed against same 7 dimensions as task
- Contributions multiplied by `CONTEXT_WEIGHT_MULT = 0.5` (lower than task-derived; context is signal, not source-of-truth)
- Output JSON gains: `context_provided: bool`, `context_score: number`, `context_contributions: {...}`, `context_truncated: bool`

### Layer B — Skill-side conversation-context enrichment

`skills/prompt-enrichment/SKILL.md` Step 0.5:
- Read the transcript at `~/.claude/projects/<project-id>/<session-id>.jsonl`
- Extract last 2 user messages + last 2 assistant responses (max 4 turns)
- Cap at ~2K chars per turn; ~8K total
- Pass to route-decide as `--context`
- Skip when first turn / unambiguous prompt / pattern-lookup match

The skill runs chat-side (Claude has Read tool, navigates transcript directly). No hook payload changes needed.

### Layer C — Borderline-promotion rule (the load-bearing math fix)

**Mira's CRITICAL C-1**: the naïve `0.5x mult` doesn't fix the false-negative on its own. The math:

| Step | Value |
|------|-------|
| Bare task score | 0.000 |
| Context standalone score | 0.225 (scope_size 0.075 + convergence_value 0.150) |
| Context contribution (0.5x mult) | 0.113 |
| Combined additive | 0.113 |
| Root threshold | 0.30 |
| **Verdict under naïve mult** | **Still root** ✗ |

Required explicit rule:

> If bare task is low-signal (`score_total < 0.10`) AND `context_score_raw >= 0.10`, force `recommendation = "borderline"` regardless of additive total.

Constants:
- `BORDERLINE_PROMOTION_THRESHOLD = 0.10`

Output JSON gains `borderline_promotion_applied: true` for audit trail.

Rationale: when the task itself has zero keyword signal but the conversation context has substantive signal, the right verdict is "uncertain — surface to user," not "default to root and pretend the context doesn't exist."

### Layer D — `[ROUTE-DECISION-UNCERTAIN]` forcing instruction

Triggers when:
- `score_total ≤ 0.05` (essentially no keyword signal)
- AND no `--context` was supplied
- AND not force-overridden
- AND `wordCount ≥ 4` (avoid firing on confirmations like "yes")

Then output JSON includes a `forcing_instruction` block:

```
ROUTE-DECISION-UNCERTAIN: keyword heuristic produced near-zero score on this task.
Before defaulting to root, consider:
- What does the prior 1-2 turns suggest about this task's complexity?
- Is the prompt vague but contextually substantive?
- Should this be re-invoked with --context?
Decision: defer to root judgment with explicit override (--force-route or --force-root).
```

Mirrors `[PROMPT-ENRICHMENT-GATE]` and `[SELF-IMPROVE QUEUE]` patterns — structural reminder injected into Claude's flow; root makes the semantic call.

### Layer D' — Workflow rule

`rules/core/workflow.md` Route-Decision section gains 3 new bullets:
- Always pass `--context "<last assistant excerpt>"` on conversation continuations (max ~2K chars; bounded to last 1-3 turns)
- If output emits `[ROUTE-DECISION-UNCERTAIN]`, do NOT silently default to root — re-invoke with context, or surface to user for explicit `--force-route` / `--force-root`
- Prompt-design tip: embed routing signal explicitly in task strings (don't rely on the forcing-instruction fallback)

### `commands/build-team.md` Step 0

Now reads `PRIOR_TURN_EXCERPT` env var; passes `--context` when set; handles UNCERTAIN before case dispatch (re-invoke or surface to user, never silently default to root).

### Pattern doc

`skills/agent-team/patterns/route-decision.md` gains "H.7.5 — Layered context-aware routing" section documenting Layer A-D + mira's borderline-promotion math + the "why this stays within toolkit patterns" framing.

### `weights_version` bump

`v1-theory-driven-2026-05-07` → `v1.1-context-aware-2026-05-07`.

## Why this stays within toolkit patterns

**Critical exploration finding** (reshaped the plan): the toolkit's design pattern is **forcing-instruction injection into Claude's existing context, NOT subprocess LLM calls**. There is no existing primitive for "node script consults LLM directly" — and adding one violates the toolkit's substrate convention.

The instinct of "consult an LLM for borderline cases" is correct in spirit but wrong shape for this toolkit. Layer C (forcing instruction) does the pattern faithfully — it doesn't call out to an LLM; it nudges Claude (already running) to apply intent reasoning where the heuristic abstained.

This preserves the toolkit's deterministic-substrate-first design.

## Self-test (load-bearing — the H.7.4 false-negative replay)

```bash
# Probe 1 — bare task without context (regression preserved + uncertain emitted)
$ node scripts/agent-team/route-decide.js --task "Empirical refit of weighted_trust_score weights from accumulated verdict data"
# recommendation: "root", score_total: 0, uncertain: true

# Probe 2 — same task WITH context (THE FIX)
$ node scripts/agent-team/route-decide.js --task "Empirical refit of weighted_trust_score weights from accumulated verdict data" \
    --context "Walk the 70 pattern entries + quality_factors_history; fit weighted_trust_score weights from data; compare against H.7.2 theory-driven priors. ~1-2 hr via orchestration."
# recommendation: "borderline", score_total: 0.112, borderline_promotion_applied: true
# context_contributions: {scope_size: 0.0375, convergence_value: 0.075}
```

## 6-task H.7.3 regression sweep

All 6 calibration tasks land at expected H.7.3 baselines under v1.1 weights:

| # | Task | Baseline | H.7.5 result | Match |
|---|------|----------|--------------|-------|
| 1 | Express rate-limit | borderline 0.325 | borderline 0.325 | ✓ |
| 2 | React component | root 0.15 | root 0.15 | ✓ |
| 3 | k8s manifest | route 0.625 | route 0.625 | ✓ |
| 4 | BACKLOG cleanup | root 0 | root 0 | ✓ |
| 5 | USING.md walkthrough | root 0 (penalty) | root 0 | ✓ |
| 6 | URL shortener | borderline 0.40 | borderline 0.40 | ✓ |

No regressions on bare-task scoring. The `uncertain` flag now fires on tasks 4+5 (score≤0.05; wordCount≥4) — not a regression but a new H.7.5 forcing-instruction emission. Tasks 1-3+6 score above the uncertain threshold so behavior is unchanged.

## Cycle data (architect-only verdict run)

```
04-architect.mira: passRate=0.667 → 0.727, tier=medium-trust (unchanged)
                   verdict: PASS (12 findings, 47 file citations, ~70K tokens)
                   A1/A2/A3 all pass (full verification per medium-trust policy — no skips)
                   profile=h7.4-empirical-v1
Toolkit verdicts: 22 → 23 (+1 single, architect-only)
```

This phase recorded a single architect-only verdict rather than a 2-paired-verdict (architect + builder) run. The orchestration pattern flexibly accommodates this — when the user prefers root-direct implementation over a kira spawn, the architect's design pass is still recorded as a substantive verdict; the implementation just doesn't generate a paired second verdict.

This is honest about what happened: mira did substantive design work that surfaced a CRITICAL math bug; root applied the implementation following mira's specifications. Recording mira alone with `--paired-with` empty captures the actual relational shape (architect-design + root-impl, not architect-design + builder-impl).

**Trust-tier note**: mira ran at MEDIUM-TRUST in this phase — full-verification ran (no spot-check skip). The H.7.4 first-firing of HIGH-TRUST spot-check policy was for the `04-architect.ari` identity (separate from mira within the same persona). Mira's tier was depressed from approaching-high-trust to medium-trust by the URL-shortener user-task fail (per CS-13 separation work; pre-separation contamination retained for audit).

## Pattern generalization (seventh phase)

| Phase | Shape | Pair |
|-------|-------|------|
| H.7.1 | callsite-wiring | architect + 13-node-backend |
| H.7.2 | substrate-extension | architect + 13-node-backend |
| H.5.7 | contract-template | architect + 13-node-backend |
| CS-6 | doc work | architect + confused-user |
| H.7.3 | intelligence-layer | architect + 13-node-backend |
| H.7.4 | data-driven refit | architect + 13-node-backend (high-trust spot-check) |
| **H.7.5** | **context-aware refinement** | **architect-only (root-impl)** |

Seven distinct phase shapes. Pattern continues to generalize.

## Closes

- **H.7.3's R2 known-limit** for context-bearing follow-ups (subjective intent that pure-keyword routing can't capture is now caught by Layer C if the prior turn carries the signal)
- **H.7.4 follow-up #1** (context-blind heuristic on conversation continuations)
- **The substrate-rich, call-site-poor architect finding** for route-decide specifically (Layer B wires prompt-enrichment to route-decide; Layer D wires the workflow rule)

## What this DOESN'T claim to fix

The keyword heuristic still has a ceiling. Layer C only fires on near-zero scores. Mid-range borderline cases that should clearly route still depend on accurate keyword tagging. The intent-layer-as-fallback is honest about scope: it catches the "no signal at all" case (where Layer C escalates) but doesn't replace the heuristic for cases where keywords fire incorrectly.

Future H.7.6+ could:
- Auto-extract context from transcript by `route-decide.js` itself (hook-territory work; defer)
- Per-user `HETS_WEIGHT_PROFILE` env override for context-multiplier tuning
- Heavier semantic-similarity comparison against historical task signatures
- Layer C escalation on any borderline result (not just near-zero)

## H.7.5 follow-ups (deferred to H.7.6+)

- **Auto-extract context** by route-decide.js itself — would require knowing transcript paths (hook-territory)
- **Per-user weight profiles** — `HETS_WEIGHT_PROFILE` env override for context-multiplier tuning
- **Semantic-similarity** against historical task signatures — optimization, not load-bearing
- **Layer C broader escalation** — fire on any borderline result, not just near-zero
- All H.7.4 deferreds unchanged (bootstrap CIs, class-imbalance, near-constant detection)

## Closure

Phase H.7.5 closes the H.7.4 false-negative architecturally. The route-decide gate is now context-aware where appropriate, deterministic-first where possible, and has a forcing-instruction escape hatch where keyword classification fundamentally can't reach.

This was the **first phase shipped via single-architect verdict** (rather than architect+builder pair). The pattern is honest about what happened — mira designed; root implemented manually. Future phases may pair-run; future phases may architect-only-run; the orchestration substrate accommodates both.
