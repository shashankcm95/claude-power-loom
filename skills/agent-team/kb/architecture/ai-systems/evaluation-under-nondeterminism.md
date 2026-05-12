---
kb_id: architecture/ai-systems/evaluation-under-nondeterminism
version: 1
tags:
  - ai-systems
  - evaluation
  - foundational
  - architecture
  - testing
  - non-determinism
sources_consulted:
  - "AI Engineering (Chip Huyen, 2024) ch 4 (Evaluate AI Systems) + ch 5 (Prompt Engineering) — practical eval methodology for LLM systems including reference-free + LLM-as-judge"
  - "Designing Machine Learning Systems (Chip Huyen, 2022) ch 6 (Model Development) + ch 8 (Distribution Shifts and Monitoring) — eval and drift fundamentals from pre-LLM ML systems"
  - "Karpathy, A., 'State of GPT' (Microsoft Build 2023) — eval as the bottleneck in LLM productization; the 'thousand-prompt eval set' framing"
  - "Anthropic published evals + safety research (anthropic.com/research) — published eval methodology for foundation model safety + capability evaluation"
  - "Liang, P. et al, 'Holistic Evaluation of Language Models (HELM)', arXiv:2211.09110 (2022) — taxonomy of LLM eval dimensions"
related:
  - architecture/ai-systems/rag-anchoring
  - architecture/discipline/error-handling-discipline
  - architecture/discipline/trade-off-articulation
  - architecture/crosscut/idempotency
status: active+enforced
---

## Summary

**Principle**: LLM systems are non-deterministic. Eval must account for variance, not just point-estimate correctness. Build eval sets, run statistically, track drift.
**Three eval types**: reference-based (compare to gold answer) / reference-free (judge intrinsic quality) / behavioral (test specific behaviors). Each has different cost/coverage tradeoffs.
**Failure mode**: vibes-based eval — "this seems to work in my testing." Doesn't scale; doesn't detect regression; doesn't survive model swaps.
**LLM-as-judge**: useful but limited — judges have their own biases (length, format, self-similarity). Pair with curated humans on a subset.
**Sources**: AI Engineering (Huyen) + DMLS (Huyen) + State of GPT (Karpathy) + HELM (Liang 2022) + Anthropic research.
**Substrate**: persona contracts encode behavioral eval surfaces; chaos-test runs serve as eval batches; trust-tiered verification is the substrate's reference-free pattern.

## Quick Reference

**The three eval types**:

| Type | What's measured | Cost | Coverage | Use when |
|------|----------------|------|----------|----------|
| **Reference-based** | Output vs gold answer (BLEU, exact match, structured match) | Low | Limited (gold set) | Tasks with clear correct answers |
| **Reference-free** | Output quality without gold (LLM-as-judge, rubric) | Medium | Broad | Open-ended generation, no single right answer |
| **Behavioral** | Specific properties (refusal, format, safety) | Variable | Targeted | Compliance + safety + format checks |

**Non-determinism sources**:

- Model sampling (temperature > 0; nucleus sampling)
- Prompt variations (whitespace, ordering)
- Context-dependent behavior (history effects in multi-turn)
- Model updates (version drift; provider-side changes)

**Statistical mindset**:

- Single-run measurements are noisy — report distributions, not point estimates
- Sample size matters — N=10 measurements have wide confidence intervals
- Variance reduction techniques: deterministic sampling (`temperature=0`), seed control where supported, paired evals on the same prompts across model versions

**Drift detection**:

- Track eval metrics over time + flag statistically-significant degradation
- Distinguish *eval drift* (your eval data changed) from *model drift* (the model changed) from *system drift* (your code changed)
- Pin model versions in eval runs; record version in eval output

**Apply when**: shipping any LLM-mediated product surface; pre-deploy verification of prompt changes; post-deploy regression monitoring; comparing model versions; testing system-prompt edits.

**Substrate examples**:

- Chaos test runs (`/chaos-test`) — eval batches with curated personas + adversarial fixtures
- Persona contracts — encode behavioral assertions (anti-patterns, required outputs)
- Trust-tiered verification (`agent-identity` registry tracks per-identity pass rates over time)
- Forbidden-phrase gate (substrate-level reference-free eval on documentation prose)

## Intent

Traditional software has deterministic outputs given identical inputs. LLM systems don't: sampling temperature, context-dependent behavior, and provider-side model updates all introduce variance. Eval methodology designed for deterministic systems doesn't transfer.

Three forces make LLM eval distinctive:

1. **Non-determinism**: the same prompt twice may produce different outputs. Point-estimate "did it pass?" tells you almost nothing.
2. **Open-endedness**: many tasks don't have a single right answer (summarization, explanation, generation). Reference-based eval has limited applicability.
3. **Drift**: models change, prompts evolve, data shifts. An eval that was clean last month may not be clean today.

The intent of eval-under-nondeterminism is to treat eval as a *measurement* problem (with statistics + variance + drift) rather than a *testing* problem (with pass/fail + single runs). Without this shift, LLM systems get shipped on vibes — "it worked when I tried it" — and degrade silently when conditions change.

## The three eval types

### Reference-based eval

Compare output against a gold reference. Examples:

- Exact-match: did the output equal the expected string?
- Structured-match: did the JSON output have the right schema + key fields?
- BLEU / ROUGE: surface-similarity metrics for text generation
- Functional equality: did the generated code produce the same result as the gold solution?

**Strengths**: cheap to run; clearly scored; easy to track over time.

**Weaknesses**: requires a gold set; many tasks have multiple valid outputs; metrics like BLEU correlate weakly with quality for free-form generation.

**Best for**: tasks with constrained output spaces (classification, structured extraction, code generation with test cases, factual lookup).

### Reference-free eval

Judge output quality without a gold reference. Examples:

- Human evaluation against a rubric
- LLM-as-judge with explicit criteria
- Heuristic checks (length, format, presence of keywords)
- Pairwise comparison (output A vs output B; which is better?)

**Strengths**: works for open-ended tasks; can be more nuanced than surface-similarity metrics.

**Weaknesses**: subjective; judges have biases; LLM-as-judge has consistency issues + may favor outputs similar to its own style.

**Best for**: summarization, explanation, dialog generation, code review, anything where multiple valid outputs exist.

### Behavioral eval

Test specific properties — does the system exhibit (or avoid) a behavior?

- Refusal eval: does the system refuse prohibited queries?
- Format eval: does the system follow the required format?
- Safety eval: does the system avoid harmful outputs across adversarial prompts?
- Robustness eval: does the system behave consistently across phrasing variants?

**Strengths**: precise; surfaces specific failure modes; doesn't depend on overall quality scoring.

**Weaknesses**: only covers what you think to test for; doesn't catch unknown failure modes.

**Best for**: production gating + safety verification + regression prevention on specific properties.

## Non-determinism as a first-class concern

### Sources of variance

LLM systems are non-deterministic by default:

- **Sampling temperature**: `temperature > 0` introduces explicit stochasticity
- **Nucleus / top-p sampling**: even with `temperature=0`, top-p > 1 introduces token-level randomness in some implementations
- **Provider-side updates**: model versions can change without notice in hosted APIs
- **Hardware / kernel differences**: at high precision, GPU non-determinism can produce different outputs for identical inputs
- **Context-dependent behavior**: multi-turn systems accumulate context that shifts behavior

### Implications for eval

A single-run pass/fail measurement is insufficient. Three strategies:

**Variance reduction**:

- Set `temperature=0` for eval runs where supported (deterministic-ish; not always fully deterministic)
- Pin model versions explicitly (e.g., `claude-opus-4-5-20250929` not `claude-opus-4-5`)
- Hold prompt + context + tooling state constant
- Document the eval environment (provider, model, sampling parameters)

**Statistical reporting**:

- Run N samples per eval prompt (N=10-100 depending on cost)
- Report mean + standard deviation + confidence interval
- For pass/fail: use Wilson score interval (small-sample binomial confidence)
- Don't compare two systems' point estimates without considering variance

**Distribution-aware comparison**:

- When comparing two prompts / two models: use paired runs (same eval prompts; same N samples each)
- Report effect size (Cohen's d) + significance level (e.g., bootstrap p-value)
- Beware of multiple-comparison problems when running many evals

### The "thousand-prompt eval set" framing

Per Karpathy (State of GPT): productizing LLM systems requires building a thousand-prompt eval set specific to your application. The generic benchmarks (MMLU, HumanEval, etc.) tell you about general model capability; they don't tell you about *your* product.

The thousand-prompt set is the load-bearing infrastructure: it's the regression suite + the comparison harness + the drift detector + the system-prompt iteration substrate.

Construct it:

- Curated examples covering your common cases
- Edge cases discovered in production
- Adversarial cases (prompt injection, malformed input, scope violations)
- Cases that previously failed (regression set)

Build it incrementally; treat additions as code changes (reviewed, version-controlled).

## LLM-as-judge

LLM-as-judge is the dominant reference-free eval approach: ask another LLM to score the system's output against a rubric.

### When it works

- Subjective dimensions (clarity, helpfulness, tone)
- Pairwise comparison (A vs B; which is better?)
- Rubric-driven scoring with clear criteria
- Bulk eval where human review is prohibitive

### Known failure modes

Per Huyen (AI Engineering ch 4) + cumulative research:

- **Length bias**: judges often prefer longer responses (assumes "more = more thorough")
- **Format bias**: judges prefer well-structured responses, even if content is weaker
- **Self-similarity**: judges score outputs from their own family higher
- **Position bias**: in pairwise comparison, judges often prefer the first-presented option
- **Consistency**: same input twice may get different scores

### Mitigations

- **Rubric specificity**: ambiguous rubrics produce inconsistent scores; specific criteria produce stable ones
- **Pairwise + swap**: do A-vs-B + B-vs-A; if results differ, position bias is present
- **Judge ensemble**: use multiple judges; majority vote
- **Human-anchored subset**: human-rate ~10% of the eval set; compare LLM-judge scores to human scores; flag when divergence grows
- **Calibration**: include known-good + known-bad outputs in the eval; judge should rank them correctly

### Don't trust LLM-as-judge for safety eval

Safety eval — does the system refuse what it should refuse? — is too consequential for LLM-as-judge alone. Use deterministic classifiers (regex / keyword + structured policy match) + human review on the safety-relevant subset. LLM judges are useful for *capability + quality* eval; less useful for *safety* eval where false negatives are load-bearing.

## Drift detection

### Three drift sources

- **Model drift**: provider updated the model; behavior shifted
- **System drift**: your prompts, system prompt, or surrounding code changed
- **Eval drift**: your eval set composition shifted (added examples, removed examples)

Each requires different remediation.

### Detection mechanics

- Run the eval set on a regular cadence (per-deploy, weekly, etc.)
- Track metrics over time; flag statistically-significant changes
- When a regression appears: bisect across the three drift sources

  - Did the model version change? (model drift)
  - Did any system prompt / code path change? (system drift)
  - Did the eval set change? (eval drift)

### Watch for silent model drift

The most insidious failure: a hosted model is updated silently; your previous eval results are no longer comparable. Mitigations:

- Pin model versions in production + eval
- Include a "canary" subset of stable prompts in your eval; expect their pass rates to stay stable; flag if they shift
- Document which models version-pinning is supported on

## Apply when

- **Shipping any LLM-mediated product**: eval set is the load-bearing infrastructure; build it before scaling
- **Iterating on prompts**: every prompt change should be evaluated against the eval set; vibes-based iteration produces silent regressions
- **Comparing models**: paired runs on the same prompts; report variance + effect size
- **Post-deploy monitoring**: eval cadence + drift alerting; bisect across the three drift sources when regressions surface
- **Eval-driven development**: treat eval as part of the test suite; gate deploys on eval pass rates

## When NOT to use this principle (or apply with caveat)

**Don't apply when**:

- **Deterministic systems** — legacy code paths, non-LLM components, pure-function pipelines have stable output for fixed input. Traditional unit/integration tests cover correctness; nondet-aware eval adds sampling cost without signal gain.
- **One-shot demos or prototypes** — the sampling cost of N-trial eval (typically N≥10) exceeds value when the artifact is throwaway. Acceptance criterion = "looks reasonable on the demo path."
- **Tasks with hard ground truth and no LLM in the loop** — if you can compute correctness deterministically (math result, parsed JSON validity), use exact-match assertion. LLM-as-judge adds nondeterminism + cost without resolving an underdetermined criterion.

**Apply with caveat when**:

- **Mixed LLM + deterministic pipelines** — eval the LLM stage with nondet awareness (N-trial + judge), eval downstream deterministic stages with traditional assertions. Don't blanket-apply LLM-as-judge where it's unneeded.
- **High-sample-cost domains (long-context, expensive model)** — reduce N but increase trial diversity (vary temperature, prompt phrasing, seed) to maintain coverage without linear cost growth.

**Cross-reference**: `error-handling-discipline` treats eval as the contract that drives substrate response. The eval defines what "correct" means; error-handling defines what happens when the substrate observes incorrectness. They're paired surfaces, not interchangeable.

## Substrate applications

### Chaos test runs as eval batches

`/chaos-test` orchestrates a 3-tier agent run with curated personas + adversarial fixtures. Each run is effectively an eval batch:

- Curated task surface (the test fixtures + persona contracts define what's tested)
- Multi-actor coverage (personas trigger different failure modes)
- Aggregation + delta analysis (cross-run comparison flags regressions)

Run state is preserved at `swarm/run-state/chaos-*/`; metric trends across runs are visible.

### Persona contracts as behavioral eval surfaces

Each persona contract declares:

- `tools.allowed` — what the persona may use
- `anti_patterns` — what the persona must NOT do
- `output_requirements` — what shape the output must take

The contract-verifier runs after each spawn and emits `verdict: pass | partial | fail`. This is substrate-internal behavioral eval — every actor invocation contributes to per-persona + per-identity pass-rate tracking.

### Trust-tiered verification (`agent-identity` registry)

Per-identity pass rates accumulate over time. Identities at high trust tiers (`master`, `journeyman`) skip expensive verification on routine tasks (per H.2.4); low-trust identities get full verification. This is reference-free eval at the substrate layer: identity reputation is the rolling-window evaluation metric.

### Forbidden-phrase gate as substrate-level reference-free eval

The substrate's forbidden-phrase grep gate (HT.2.1 measurement-methodology + HT.1.7 ADR-0005 slopfiles authoring discipline) is a deterministic reference-free eval on documentation prose: certain prescriptive phrasings (`Never X`, `Always Y`) signal pseudo-prescriptive authoring patterns; gate flags them at edit time.

It's a behavioral eval — does the doc avoid the forbidden phrasings? — and it's deterministic (regex), not LLM-judged. Trades precision for reliability.

## Tensions

### Eval cost vs eval coverage

Comprehensive eval is expensive; sparse eval misses regressions. The pragmatic balance:

- Full eval on major releases (~1000 prompts; high cost; comprehensive)
- Smoke eval on every PR (~10-50 prompts; low cost; catches obvious regressions)
- Targeted eval on specific changes (e.g., system-prompt edit → re-run the affected eval slice)

### Static eval vs production reality

Eval sets are curated + static; production is messy + dynamic. Eval can pass while production fails on unanticipated cases. Mitigations:

- Production logging that captures inputs + outputs (with appropriate privacy)
- Periodic eval-set augmentation from production patterns
- Alerting on production metrics that proxy for quality (refusal rate, format compliance, downstream user actions)

### Quality eval vs safety eval

Quality and safety are different goals with different methodology. Don't conflate:

- Quality: how good is the output (helpful, accurate, well-formed)?
- Safety: does the output avoid prohibited content?

A high-quality output can be unsafe; a safe output can be low-quality. Each gets its own eval set + methodology.

## History

Authored: kb authoring batch H.9.3 (post-HT.1.12 deferred-author-intent followup). Closes the `## Related KB docs (planned)` forward-reference from `rag-anchoring.md` for evaluation-under-nondeterminism. Pairs with rag-anchoring (RAG eval is a specific application of the broader eval methodology) and refusal-patterns (refusal rate is an eval target).

## Phase

Authored: H.9.3 KB authoring batch — sibling format-discipline trajectory under H.9.x. Fourth of 5 unauthored planned KBs (per HT.1.12-followup BACKLOG entry). AI-systems pairing: evaluation-under-nondeterminism × rag-anchoring closes the eval-discipline forward-reference; complements agent-design's mention of eval as the workflow-vs-agent reliability gap.
