# H.7.4 — Empirical refit of weighted_trust_score weights (PASS)

> Sixth phase via corrected autonomous-platform pattern. Closes the H.6.6 commitment to design weights from data, not theory. **First production firing of H.7.1 high-trust spot-check policy.**

## Cycle headline

- **Pair-run**: 04-architect.ari (review, HIGH-TRUST tier) + 13-node-backend.evan (impl)
- **Both PASS**; convergence: agree (with one arithmetic correction caught by evan)
- **First production high-trust spot-check**: A2 noTextSimilarityToPriorRun marked `skipped` per H.7.1 policy
- **Empirical refit shipped**: 1 weight adjusted, 5 kept theory-driven (data-supported decision per axis)

## What landed

### `weight-fit.js` analysis

70 pattern entries; 20 with quality_factors. Pearson r + linear regression per axis:

| Axis | n | r | Confidence | Recommendation | Rationale |
|------|---|---|-----------|---------------|-----------|
| `findings_per_10k` | 20 | 0.083 | low | keep_theory | Weak correlation; priors stand |
| `file_citations_per_finding` | 20 | 0.439 | moderate | **adjust** | 0.10 → **0.135** |
| `cap_request_actionability` | 3 | — | insufficient | keep_theory | n<5 |
| `kb_provenance_verified_pct` | 20 | 0.076 | low | keep_theory | Predictor near-constant (19/20 false) |
| `tokens` | 20 | 0.288 | moderate | flagged | Empirical sign-flip; ari overrode |
| `convergence_agree_pct` | 12 | 0.674 | low | keep_theory | Strong direction, n=12<15 threshold |

### ari's tokens-axis override (the load-bearing architectural call)

The empirical fit wanted `tokens` to flip from theory's `-0.05` (efficiency penalty) to `+0.089` (positive correlation with pass). ari overrode with rationale:

> "The negative weight is NORMATIVE (efficiency penalty by design), not DESCRIPTIVE (correlation with pass). The empirical positive correlation is a sample-censoring confound — substantive tasks → more tokens AND more passes; only 2 of 20 fails sit in the lower-token half. Conflating normative and descriptive roles makes future audits incoherent."

Real architectural judgment beats blindly applying empirical fit. This is the first time the toolkit has explicitly distinguished normative from descriptive weight design — captured in the pattern doc.

### Code changes

- `scripts/agent-team/agent-identity.js`:
  - `WEIGHT_PROFILE_VERSION = "h7.4-empirical-v1"` (new const)
  - `WEIGHTS.file_citations_per_finding: 0.10 → 0.135`
  - `computeWeightedTrustScore` now surfaces `profile` field in return value
  - All other weights UNCHANGED
  - **`tierOf` UNCHANGED** — H.4.2 audit-transparency commitment held byte-for-byte

- `patterns/agent-identity-reputation.md`:
  - New "Empirical Refit (H.7.4)" subsection with 8 H4 sub-sections (Methodology, Sample sizes, Comparison table, Tokens override rationale, Methodology limitations, Successor-phase backlog, Profile versioning, Forward-compat)

- evan caught arithmetic error in ari's review body (sum of positives = 0.535, not 0.585 as ari's body text had); shipped 0.535. Convergence remains agree on architecture; arithmetic correction is exactly the catch pair-runs are meant to produce.

## Bonus-cap math under H.7.4

- H.7.2: positive weights summed to exactly +0.50 (BONUS_CAP unreachable from above)
- H.7.4: positives sum to **0.535** (BONUS_CAP=0.50 now genuinely reachable from above)

This is a real change in formula behavior — under H.7.4, an identity with maxed positive factors will hit the cap. Documented in pattern doc.

## H.7.1 trust-tiered policy production firing

ari was assigned at HIGH-TRUST (5+ verdicts, passRate 1.0). Per H.7.1 Step 7:
- `verification: spot-check-only`
- `spawnChallenger: false`
- `skipChecks: ["noTextSimilarityToPriorRun"]`

Verifier output confirmed: A2 marked `status: "skipped"`. The latency-saving design that's been substrate-only for 10+ phases (H.2.4 through H.7.3) operationalized for the first time on a real task. **This is what trust accumulation was for.**

## Trust signal

```
04-architect.ari:    pass=7, passRate=1.0, tier=high-trust, score=1.0, bonus=0.231 (was 0.209), profile=h7.4-empirical-v1
13-node-backend.evan: pass=5, passRate=1.0, tier=high-trust (just hit it!), score=1.0, profile=h7.4-empirical-v1
Toolkit verdicts: 20 → 22 (+2 paired)
```

**Two HIGH-TRUST identities now**: ari (carried over from CS-6) + evan (just hit it on this phase).

## Pattern generalization (sixth phase)

| Phase | Shape | Pair |
|-------|-------|------|
| H.7.1 | callsite-wiring | architect + 13-node-backend |
| H.7.2 | substrate-extension | architect + 13-node-backend |
| H.5.7 | contract-template | architect + 13-node-backend |
| CS-6 | doc work | architect + confused-user |
| H.7.3 | intelligence-layer | architect + 13-node-backend |
| H.7.4 | data-driven refit | architect + 13-node-backend (high-trust spot-check) |

Six distinct phase shapes. Pattern continues to generalize. Root coordinates ~10K tokens; substrate produces ~180K tokens (lower than prior phases — high-trust spot-check policy reduces verifier overhead).

## What this DOESN'T change

- `tierOf` — H.4.2 audit-transparency commitment honored
- The 5 unadjusted weights — data didn't support change
- `computeWeightedTrustScore` formula shape — still `passRate * (1 + clamped_bonus)`
- Per-identity quality_factors_history — unchanged (just recomputes scores against new weights on demand)
- Verdict semantics — pass/fail/partial unchanged

## H.7.4 follow-ups (deferred to H.7.5)

- **Bootstrap confidence intervals** — n=20 with 3-decimal precision is overstated. Add CI computation.
- **Verdict-class-imbalance handling** — Pearson r is sensitive to 90:10 pass:fail split. Document or correct.
- **Near-constant-predictor detection** — kb_provenance_verified_pct looks "fittable" with 20 entries but is 19/20 false. Should warn rather than score.
- **Refit cap_request_actionability + kb_provenance_verified_pct** — when ≥10 observations per axis. Today insufficient.
- **Per-persona weight calibration** — different personas may benefit from different weights. Defer.

## Closure

Phase H.7.4 closes the H.6.6 commitment to design weights from data. The trust formula's weights are now **conservatively empirical** — adjusted where data justifies, theory-driven where data is sparse, with explicit normative-vs-descriptive distinction documented. The toolkit now has trust-formula provenance (`WEIGHT_PROFILE_VERSION`) for forward auditing.

The H.7.x evolution-loop arc (H.7.0-prep through H.7.4) is now functionally complete:
- H.7.0-prep: measurement layer (6 quality axes)
- H.7.1: convergence capture (paired runs)
- H.7.2: theory-driven weighted score
- H.7.3: route-decision intelligence + n=20 milestone
- H.7.4: empirical refit + first high-trust spot-check firing

Original H.7.0 vision (chicken-breeding evolution loop) is partially fulfilled: weight design from data ✓; full breeding mechanics (parent-child identity propagation, retire-and-replace cycles) deferred to H.7.5+ when use cases surface.
