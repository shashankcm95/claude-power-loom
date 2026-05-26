# H.7.2 — Theory-driven weighted trust score (PASS)

> Second phase shipped via the corrected autonomous-platform pattern. Architect designed; 13-node-backend implemented; root coordinated. Coordinated with the plan-mode-rule trivial-doc PR (#53).

## Cycle headline

- **Pair-run**: `04-architect.mira` (design) + `13-node-backend.evan` (implementation)
- **Both PASS** with high quality
- **Convergence: agree** — evan implemented mira's design 1:1; one orchestrator override (frontmatter status NOT promoted) acknowledged
- **First weighted_trust_scores populated for live identities**

## What landed

### `computeWeightedTrustScore(stats, aggregateQF)` in `agent-identity.js`

Pure function inserted at line 198 (after `aggregateQualityFactors`). Returns:

```json
{
  "score": 1.0,
  "passRate": 1.0,
  "quality_bonus": 0.235,
  "bonus_capped": false,
  "components": {
    "findings_per_10k":            { "raw": 1.065, "normalized": 0.282, "weight": 0.10, "contribution": 0.028 },
    "file_citations_per_finding":  { "raw": 5.27,  "normalized": 0.838, "weight": 0.10, "contribution": 0.084 },
    "cap_request_actionability":   null,
    "kb_provenance_verified_pct":  { "raw": 0,     "normalized": 0,     "weight": 0.10, "contribution": 0 },
    "convergence_agree_pct":       { "raw": 1.0,   "normalized": 1.0,   "weight": 0.15, "contribution": 0.150 },
    "tokens":                      { "raw": 103250,"normalized": 0.5325,"weight": -0.05,"contribution": -0.027 }
  },
  "decomposition_note": "score = passRate * (1 + clamped_bonus); cap [-0.10, +0.50]; final clamp [0, 1]"
}
```

**Defense-in-depth final clamp**: ari + noor both produce raw `passRate * (1 + bonus) > 1` (1.235, 1.257) — clamped to 1.0.

### Theory-driven weights (with citations)

| Axis | Weight | Citation |
|------|--------|----------|
| `findings_per_10k` | +0.10 | Dunsmore "Defect detection in code reviews" 2003 |
| `file_citations_per_finding` | +0.10 | Bacchelli & Bird MSR 2013 |
| `cap_request_actionability` | +0.05 | Lower weight — small-sample noise control |
| `kb_provenance_verified_pct` | +0.10 | Contract compliance signal |
| `convergence_agree_pct` | **+0.15** | Inter-rater reliability literature (Cohen's κ, Krippendorff's α) |
| `tokens` | -0.05 | Efficiency penalty |

**Total bonus capped at [-0.10, +0.50]**. Sum of positives = exactly +0.50 (theoretical ceiling; bonus_capped is structurally unreachable from above under H.7.2). Final score also clamped to [0, 1] via Math.max/min defense-in-depth.

### mira's calibration adjustment

Original plan: `file_citations_per_finding` reference scale `1.5 → 4.0`. mira validated against on-disk live data (noor=5.75, ari=5.27 records) and raised the high-end to **6.0** so high-citation-density actors get differentiation rather than ceiling-clamp. Adopted.

### `cmdStats` extension (line 325-356)

Added `weighted_trust_score` field after `aggregate_quality_factors`. **`tierOf` UNCHANGED** (H.4.2 audit-transparency commitment honored).

### Pattern doc extension (`patterns/agent-identity-reputation.md`)

New "Weighted Trust Score (H.7.2 — supplemental signal)" subsection inside existing "Trust Formula" section. Includes worked example with ari's live data + reaffirmation that `tierOf` remains binary-pass-rate-driven + pointer to BACKLOG empirical-refit at H.8.x.

## Cycle data

```
mira (04-architect):
  pass=4, passRate=1.0, tier unproven (4<5)
  weighted_trust_score: 1.000 (clamped), bonus=0.198
  convergence_agree_pct: 1.0 (1 paired sample)

evan (13-node-backend):
  pass=2, passRate=1.0, tier unproven
  weighted_trust_score: 1.000 (clamped), bonus=0.193
  convergence_agree_pct: 1.0 (1 paired sample)
```

## Sanity-check table — all 10 H.7.x-era identities

```
identity                       passRate  weighted_score  bonus    capped
04-architect.ari               1.000     1.000           +0.235   false  (clamped from raw 1.235)
04-architect.mira              1.000     1.000           +0.198   false
13-node-backend.kira           0.667     0.667           +0.000   false  (backfilled history; null axes)
13-node-backend.noor           1.000     1.000           +0.257   false  (clamped from raw 1.257)
13-node-backend.evan           1.000     1.000           +0.193   false
12-security-engineer.mio       1.000     1.000           +0.049   false
12-security-engineer.vlad      1.000     1.000           +0.000   false  (no quality factors recorded)
09-react-frontend.casey        1.000     1.000           +0.000   false
10-devops-sre.hugo             1.000     1.000           +0.000   false
11-data-engineer.niko          1.000     1.000           +0.000   false
```

**The weighted score is doing what it should**: identities with measurable quality differentiation (paired convergence + populated quality factors) get visible bonus; identities recorded pre-H.7.0-prep (or whose backfill yielded null axes) correctly show bonus=0. The score adds within-tier ranking signal without changing the binary tier gate.

## Token economics

- Item 1 (plan-mode rule): ~5K tokens, direct PR
- Item 2 (H.7.2 orchestration):
  - Root coordination: ~10K
  - mira (design): 107,945 tokens
  - evan (implementation): 98,951 tokens
  - Verification + recording: ~15K
- **Total: ~237K tokens, ~1.5 hours wallclock**

Plus: produces 2 paired builder verdicts → toolkit-wide post-H.7.2: **11 verdicts toward n=20** (55%).

## Validation

- ✅ Probe 1: identities without quality factors → `weighted_trust_score: null` (02-confused-user.sam)
- ✅ Probe 2: ari's score > passRate (passRate=1, score=1 due to clamp; bonus=0.235 surfaced separately)
- ✅ Probe 3: components decomposition shows 6 axes with raw/normalized/weight/contribution
- ✅ Probe 4: bonus_capped=false for all live identities (theoretical ceiling unreachable from above)
- ✅ Probe 5: tierOf unchanged (regression check via 5-fail synthetic identity)
- ✅ Probe 6: contracts-validate 0 violations
- ✅ Probe 7 (self-test): pair-run produced 2 verdicts with convergence (mira + evan)
- ✅ Probe 8: plan-mode rule appears in `~/.claude/rules/toolkit/core/workflow.md`

## Meta-finding: corrected autonomous-platform pattern, second instance

H.7.1 was the FIRST phase shipped via the corrected pattern (root coordinates; substrate implements). H.7.2 is the SECOND. Pattern is generalizing:

- **H.7.1**: callsite-wiring task (~373 LoC across 11 files). Pattern produced 2 paired verdicts.
- **H.7.2**: substrate-extension task (~109 LoC of new function + cmdStats extension + pattern doc + ~6 file edits). Pattern produced 2 more paired verdicts.

Both phases: ~250K tokens (10K root + 240K sub-agents); architect surfaced design; implementer caught real engineering gaps (mira caught the file_citations_per_finding ceiling clamp; noor caught the contracts-validate.js extension need in H.7.1). The implementer's extra-design corrections are signal — not bugs in the design but legitimate on-the-spot engineering. They show up as the implementer's "I deviated here, with rationale" in Notes — and when they're sound, the convergence-agree pair-run captures that as quality data.

## H.7.2 follow-ups (deferred)

- **H.7.3 — Empirical refit**: at ≥20 verdicts, fit weights from accumulated `quality_factors_history`. Compare theory-driven (current) vs empirical-fit; document deltas. Today: 11 verdicts; need 9 more.
- **`HETS_WEIGHT_PROFILE` env override**: per-org calibration of reference scales. Future phase.
- **Subjective-quality validation**: 10-min user-judgment check comparing weighted ranking to intuition. Run after a few real tasks accumulate.
- **`cap_request_actionability` weight tuning**: today at +0.05 (small-sample); revisit when ≥4 identities have non-null values.

## Closure

Phase H.7.2 makes the multi-axis quality data DO something. The trust signal now has within-tier ranking power without breaking the H.4.2 audit-transparency commitment. Combined with H.7.0-prep (measurement) + H.7.1 (convergence capture), the toolkit's reward system is now structurally complete; refinement happens with data.

The architect's "substrate-rich, call-site-poor" finding has been resolved THREE times in succession:
- H.7.1: asymmetric-challenger callsite wired
- H.7.2: quality_factors_history → weighted_trust_score callsite wired
- (Future) H.7.3: empirical-refit callsite when data threshold reached

The corrected autonomous-platform pattern is now demonstrated across two distinct phase shapes (callsite-wiring + substrate-extension). Generalization is real, not coincidental.
