---
pattern: convergence-as-signal
status: observed
intent: Different personas independently surfacing the same finding = high-confidence signal.
related: [asymmetric-challenger, hets, structural-code-review, plan-mode-hets-injection]
---

## Summary

When two or more **different** personas surface the same finding without coordination, treat as high-confidence (no challenger needed; promote in synthesis priority). Same persona finding the same thing twice = no signal (shared blind spot). Observed in chaos-20260502-060039: hacker CRIT-3 + code-reviewer H-1 independently flagged the `.some` bug at `contract-verifier.js:91`.

## Intent

The strongest signal a multi-persona team produces is *independent convergence*. A bug that two unrelated personas catch by separate reasoning paths is almost certainly real. This pattern formalizes that observation so the synthesis tier can weight it explicitly.

## Components

- **Cross-persona deduplication** — at orchestrator-tier synthesis time, compare findings across actors of *different* personas. Match criteria: same file path + line number within ±5 lines OR Jaccard similarity ≥0.6 on finding bodies.
- **Convergence multiplier** — convergent findings get severity bumped by one tier in the consolidated report. CRITICAL stays CRITICAL but moves to top of list; HIGH becomes "HIGH (convergent)" and is flagged in the executive summary.
- **Same-persona suppression** — if the same persona surfaces the "same" finding twice (e.g., two architect-class identities), suppress the second occurrence. Two architects agreeing is one architect's blind spot squared.

## Failure Modes

1. **False convergence** — two personas surface superficially-similar findings that are actually different bugs. Counter: require shared file:line, not just shared keywords.
2. **Coordinated convergence** — if personas read each other's drafts (e.g., hacker reads code-reviewer's earlier output), convergence is no longer independent. Counter: spawn personas in parallel only; never expose one actor's output to another at the same tier.
3. **Convergence drought** — different personas have such different lenses they never converge, even on real bugs. Counter: this is information — review whether persona definitions are too narrow.

## Validation Strategy

Stress-test scenarios:
- Plant the same bug in two locations, one obvious and one subtle. Measure: which converges, which only one persona catches.
- Spawn two identities of the same persona on the same task. Measure same-persona "convergence" rate as baseline noise floor.
- Compare convergence rates across persona pairs (hacker+architect vs hacker+code-reviewer vs hacker+honesty-auditor). Identify which pairs are most informative for which surface.

## When to Use

- Any chaos run with ≥3 different-persona actors on overlapping surface
- Synthesis-tier processing (orchestrator and super-root)

## When Not to Use

- Single-persona runs (no cross-signal possible)
- Fully-disjoint persona surfaces (architects review docs, hackers review code — convergence is impossible by construction)

## Related Patterns

- [Asymmetric Challenger](asymmetric-challenger.md) — deliberate version of this pattern; convergence is the emergent version
- [HETS](../SKILL.md) — the multi-persona substrate
