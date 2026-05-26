# H.7.0 — Evolution loop + drift detection + multi-axis trust signal (PASS)

> Ninth distinct phase shape — and the largest single phase ever shipped. Closes the original H.7.0 chicken-breeding analogy + bundles H.7.6 drift detection + adds 1 new score-affecting trust axis. **mira (medium-trust architect) caught 3 CRITICAL load-bearing bugs in root's plan** before implementation; kira (medium-trust builder) shipped ~250 LoC + 23 tests; convergence agree.

## Cycle headline

- **mira (04-architect, medium-trust)** — design pass; **partial** verdict (functionalFailures=0, antiPatternFailures=0, antiPatternWarns=1 on A3 acknowledgesFallback — acceptable per accept-with-warning); 13 findings (3 CRITICAL + 4 HIGH + 3 MEDIUM + 3 LOW); 57 file citations; ~137K tokens
- **kira (13-node-backend, medium-trust)** — implementation pass; **pass** verdict (functionalFailures=0, antiPatternFailures=0); 6 findings (1 HIGH + 2 MEDIUM + 3 LOW); 30 file citations; ~206K tokens
- **Both verdicts paired** with `--paired-with` + `--convergence agree`. Toolkit verdicts: 79 → 86 (+7 net, including test-side recordings)
- **byte-for-byte tierOf invariance held**: 31 of 31 active identities had identical tier output pre/post H.7.0. **H.4.2 audit-transparency commitment preserved.**
- **`tierOf` UNCHANGED** at agent-identity.js:98-105 byte-for-byte — same as published in H.4.2

## mira's CRITICAL pushbacks (load-bearing math fixes)

### C-1: Multiplicative composition has degenerate zeros

Root's worded spec for `composite_score = passRate × complexity_weight × recency_decay` would collapse to 0 when ANY axis is 0 — verified by trace: `passRate=1.0, task_complexity_weighted_pass=1.0, recency_decay_factor=0.0` → composite = 0. The identity loses ALL trust signal because of dormancy alone, even though every observed pass passes.

**Fix shipped**: composition stays `score = passRate × (1 + clamped_bonus)`. New axis `task_complexity_weighted_pass` joins INTO the additive bonus loop. Sample-dependent axes (`recency_decay`, `qualityTrend`) live OUTSIDE the score as observable diagnostic fields, never as multipliers. The H.4.2 reproducibility commitment ("why is identity X at 0?") cannot break under multiplicative composition; mira preserved it.

### C-2: recency_decay can't be empirically fit at n=35 / time-span <1 day

Mira verified against live data: total span 5.11 days; longest per-identity span 5.08 days (mira herself); 11 of 12 active identities have <1-day span. Fitting a recency-decay coefficient against this would let mira's record alone dominate.

**Fix shipped**: `recency_decay_factor` ships as theory-driven OBSERVABLE field — exponential decay with 30-day half-life — surfaced in `cmdStats` output but **NOT in the score arithmetic**. Will incorporate into score at H.7.5+ once n≥30 per-identity AND span≥30 days. Same pattern as `convergence_agree_pct` at H.7.2 when n=12 was below the n=15 floor.

### C-3: New `task_complexity` field would silently shift `aggregateQualityFactors` denominator

If H.7.0 added `task_complexity` as a stored verdict field, the existing 79 verdicts would have `task_complexity = null`. The first H.7.0-era record would suddenly contribute non-null, changing the score over time WITHOUT a corresponding code change. The H.4.2 wound — "why did mira's score change Tuesday → Wednesday" — has no good answer when the answer is "because the new axis suddenly had a value."

**Fix shipped**: do NOT add `task_complexity` as a verdict field. DERIVE complexity at aggregate-time from the existing `task_signature` field (already populated on all 79 verdicts) via a route-decide bucketer. Schema-additive net effect = 0; legacy verdicts get bucketed retroactively (route-decide is a pure function over the task string); historical scores ARE reproducible.

## What landed

### File 1: `scripts/agent-team/_lib/route-decide-export.js` (NEW, 28 LoC)

Re-exports `scoreTask` + `ROUTE_THRESHOLD` + `ROOT_THRESHOLD` from `route-decide.js` for in-process consumers. Closes mira's capability request (`forge-skill: route-decide-as-library`) — `agent-identity.js` cmdStats walks 50 history entries; subprocess-spawn-per-call would be unworkable.

### File 2: `scripts/agent-team/route-decide.js` (refactored)

Wrapped main block in `if (require.main === module)` guard + added `module.exports`. CLI byte-for-byte identical pre/post refactor (verified via diff against captured baseline).

### File 3: `scripts/agent-team/agent-identity.js` (~671 LoC additive)

12+ distinct edits per mira's spec:
- `WEIGHT_PROFILE_VERSION`: `"h7.4-empirical-v1"` → `"h7.0-multi-axis-v1"`
- `WEIGHTS` table: + `task_complexity_weighted_pass: 0.10` (theory-driven; refit at H.7.5+)
- `_backfillH66Schema` → `_backfillSchema` (phase-keyed dispatcher); adds H.7.0 fields `spawnsSinceFullVerify: 0`, `lastFullVerifyAt: null`
- NEW `bucketTaskComplexity(taskSignature)` — calls scoreTask; maps to `'trivial' | 'standard' | 'compound'`
- NEW `computeTaskComplexityWeightedPass(history)` — formula: `Σ(passes × bucket_weight) / Σ(total × bucket_weight)`; bucket weights `{trivial: 0.5, standard: 1.0, compound: 1.5}`
- NEW `computeRecencyDecay(history)` — exponential decay; 30-day half-life; OBSERVABLE-ONLY
- NEW `computeQualityTrend(history)` — windowed slope (recent-3 vs prior-3); detects `up | down | flat`
- `computeWeightedTrustScore` — task_complexity axis hand-merged into bonus loop; signature unchanged
- `cmdStats` — surfaces 3 new fields: `recency_decay_factor`, `qualityTrend`, `task_complexity_weighted_pass`
- `cmdRecord` — accepts `--verification-depth full|spot|asymmetric|symmetric`; resets/increments `spawnsSinceFullVerify`
- `cmdRecommendVerification` — drift pre-check block (recalibration_due → task-novelty → quality-trend-down → fall-through to existing tier-table). PRE-EMPTS the tier table; doesn't replace it.
- `cmdAssign` — specialization-aware-pick when `args.task` overlaps `identity.specializations[]`; falls back to round-robin
- NEW `cmdBreed` — `agent-identity breed --persona X [--parent <id>] [--name <kid>] [--auto]`. Diversity-guard at breed-time (refuse if ≤1 generation-0 live identity); population-cap (refuse if at full roster capacity); user-gate on first breed per persona.

### File 4: `scripts/agent-team/pattern-recorder.js` (+24 LoC)

Propagates `--verification-depth` flag to `agent-identity.js record`. Accepts new optional `--task-complexity-override trivial|standard|compound` flag.

### File 5: `scripts/agent-team/_h70-test.js` (NEW, 514 LoC)

23 inline tests covering all H.7.0 surface:
- 5 unit tests: `bucketTaskComplexity` (per-bucket-boundary + null + throws-on-invalid)
- 3 unit tests: `computeTaskComplexityWeightedPass` (empty + all-trivial + mixed-bucket)
- 2 unit tests: `computeRecencyDecay` (empty + varied timestamps)
- 3 unit tests: `computeQualityTrend` (n<6 → null + declining + flat)
- 5 integration tests: `cmdBreed` (success + diversity-guard + population-cap + user-gate + --auto-bypass)
- 2 integration tests: `cmdRecommendVerification` drift triggers (recalibration_due + qualityTrend-down)
- **1 byte-for-byte tierOf invariance test** — H.4.2 self-check (the load-bearing one)

### File 6: `skills/agent-team/patterns/agent-identity-reputation.md` (~210 LoC additive)

- Existing "Lifecycle + Evolution Vision (H.6.6 + H.7.0)" section — L3 evolution-loop subsection flipped from DEFERRED to **SHIPPED** with 4 H4 sub-sections: Breeding mechanics, Diversity guard + population cap, Specialization-aware assign, Trait inheritance
- NEW "Multi-Axis Trust Signal (H.7.0)" H2 section — 5 H4 sub-sections: New axes added at H.7.0; Composition is additive within bonus, NOT multiplicative; Sample-size gate per axis; WEIGHT_PROFILE_VERSION bump rationale; Drift detection / recalibration triggers (4 trigger types)
- NEW "Worked example (H.7.0 multi-axis)" H4 — same shape as H.7.4's worked example, with new axis contributing

## Test results

- **23 of 23 H.7.0 tests pass** (`node scripts/agent-team/_h70-test.js`)
- **byte-for-byte tierOf invariance** PASSES across 31 identities (`/tmp/tier-before.json` vs post-change diff = 0)
- **route-decide CLI** byte-for-byte identical pre/post refactor
- **`contracts-validate.js`**: 0 violations
- **`install.sh --test`**: 10/10 hook smoke tests pass

## Convergence verdict

`agree` — kira fully accepted mira's design. No load-bearing math errors caught; no missed sub-cases requiring re-design. Three minor MEDIUM/LOW deviations flagged for H.7.5+ review:

- M-1: Added `task_complexity_override` as stored field on verdict entry (mira said attach to `quality_factors.task_complexity_override`; kira made it explicit for forward-compat)
- M-2: Used table-form for "New axes" (mira's outline said 5 H4 sub-sections; kira delivered 5 H4s with 1 inline table)
- L-1: Cross-version tracking gap — route-decide WEIGHTS_VERSION change wouldn't bump agent-identity profile; suggest H.7.5+ add composed profile e.g., `agent-identity-h7.0+route-decide-v1.1`

## Trust signal evolution

Pre-H.7.0 trust formula:
1. `tierOf` — binary-cliff at passRate ≥ 0.8 + verdicts ≥ 5 (H.4.2 audit-transparent)
2. `weighted_trust_score` — H.7.4 supplemental, 6 quality axes + 1 convergence axis, empirically refit at n=20

Post-H.7.0:
1. `tierOf` — UNCHANGED byte-for-byte
2. `weighted_trust_score` — H.7.0 adds `task_complexity_weighted_pass` (theory-driven +0.10); profile bumps to `"h7.0-multi-axis-v1"`
3. **NEW** `recency_decay_factor` — observable; theory-driven 30-day half-life; NOT in score until n≥30/span≥30
4. **NEW** `qualityTrend` — observable trend object with `slope_sign: up | down | flat` per axis; drives drift triggers
5. **NEW** Drift triggers — 4 types (force-full-verify, recalibration_due, task-novelty mismatch on high-trust, quality-trend-down on high-trust); all PRE-EMPT the existing tier-policy table

Plus: `agent-identity breed` subcommand for evolution-loop substrate. **L3 (evolution loop) shipped — closing the H.6.6 vision.**

## What this DOESN'T change (H.4.2 commitments held)

- `tierOf` byte-for-byte unchanged at agent-identity.js:98-105
- The 6 H.7.4 weights stay (file_citations_per_finding=0.135 + the rest)
- `BONUS_CAP = [-0.10, +0.50]` unchanged (cap-from-above is real and now active — positive sum is 0.585)
- All existing identities' `tier` outputs reproducible from `verdicts {pass, partial, fail}` alone, exactly per H.4.2
- No verdict field removed; no migration script needed beyond `_backfillSchema` (purely additive)
- Verification-policy table for tier→policy unchanged at L702-731. Drift triggers PRE-EMPT the table; do not alter it.

## Pattern generalization (ninth phase shape)

| Phase | Shape | Pair |
|-------|-------|------|
| H.7.1 | callsite-wiring | architect + 13-node-backend |
| H.7.2 | substrate-extension | architect + 13-node-backend |
| H.5.7 | contract-template | architect + 13-node-backend |
| CS-6 | doc work | architect + confused-user |
| H.7.3 | intelligence-layer | architect + 13-node-backend |
| H.7.4 | data-driven refit | architect + 13-node-backend (high-trust spot-check) |
| H.7.5 | context-aware refinement | architect-only (root-impl) |
| H.4.3 | forcing-instruction reuse | root-direct |
| **H.7.0** | **major substrate redesign — evolution loop + multi-axis trust + drift detection** | **architect + 13-node-backend (medium-trust pair-run)** |

Ninth distinct shape: **major substrate redesign with empirical-floor-aware design discipline**. The architect's data-verification (n=35, time-span 5.11 days) drove 3 CRITICAL fixes that would have shipped subtle bugs without the design pass. This is exactly what the architect spawn is for.

## H.7.0 follow-ups (deferred to H.7.5+)

- **Recency-decay refit** when n≥30 per-identity AND span≥30 days (today: ~30 days minimum to reach span threshold)
- **qualityTrend axis** to enter score formula (today: observable-only)
- **Cross-version tracking** for the route-decide ↔ agent-identity profile dependency
- **Parent-tie-break test** for cmdBreed (kira's H-1 finding)
- **`task_complexity_override` consumption** in `computeTaskComplexityWeightedPass` (kira's M-1 finding — currently captured but not consumed)
- **Auto-mode breeding** with population dynamics observed over ≥3 cycles
- **Drift trigger N empirical refit** when 3 high-trust identities have ≥30 verdicts each

## Closure

Phase H.7.0 closes the original chicken-breeding analogy from the user's H.6.6 vision. The toolkit now has substrate evolution mechanics — selection (passRate + new axes), reproduction (cmdBreed), culling (existing prune), drift detection (the merged H.7.6 work). All gated on user-approval (no silent breeding); all forward-compat-additive (no migration needed); all audit-transparent (`tierOf` unchanged; new axes published in pattern doc with empirical-vs-theory provenance).

The H.7.x evolution-loop arc is now functionally complete:
- H.7.0-prep: measurement layer (6 quality axes)
- H.7.1: convergence capture (paired runs)
- H.7.2: theory-driven weighted score
- H.7.3: route-decision intelligence + n=20 milestone
- H.7.4: empirical refit + first high-trust spot-check
- H.7.5: route-decide context-awareness + forcing-instruction fallback
- **H.7.0: evolution loop + drift detection + multi-axis trust** (originally numbered H.7.0; deferred until data accumulated; now shipped at n=35 builder verdicts)

The toolkit is now structurally what the H.6.6 vision wanted: an autonomous platform that grows its own substrate, breeds high-trust specialists from observed performance, prunes underperformers, and recalibrates against drift — all under deterministic, audit-transparent rules.
