---
pattern: agent-identity-reputation
status: active
intent: Personas as roles; identities as persistent named instances accumulating per-identity trust.
related: [trust-tiered-verification, persona-skills-mapping, hets, prompt-distillation]
---

## Summary

Persona = role (e.g., `04-architect`). Identity = named instance within that role (e.g., `architect.mira`). Each identity has persistent track record across runs: verdicts, specializations, skill invocations. Trust scored per identity, not per persona class — so "I trust mira" is meaningful, not just "I trust architects." Identities are assigned at spawn time from a per-persona roster (round-robin initially; trust-weighted later).

## Intent

A team of three architects on a real engineering team isn't three interchangeable units — each has a track record, specialty, and earned trust. Modelling agents the same way enables (a) reasoning about specific contributors, (b) targeted skill development per identity, (c) graceful retirement of underperforming identities, (d) social-cognitive scaffolding for humans reviewing the team's output ("mira flagged this — she's been right 19/20 times on architecture claims").

## Components

- **Identity registry** — `~/.claude/agent-identities.json` (gitignored). Schema: per-identity entry with `persona`, `name`, `createdAt`, `lastSpawnedAt`, `totalSpawns`, `verdicts {pass, partial, fail}`, `specializations[]`, `skillInvocations {skill: count}`.
- **Per-persona roster** — small set of names per persona, defined once at toolkit init. Suggested:
  - `01-hacker` → `["zoe", "ren", "kai"]`
  - `02-confused-user` → `["sam", "alex", "rafael"]`
  - `03-code-reviewer` → `["nova", "jade", "blair"]`
  - `04-architect` → `["mira", "theo", "ari"]`
  - `05-honesty-auditor` → `["quinn", "lior", "aki"]`
- **Assignment policy** — `agent-identity assign --persona 04-architect [--task ...]` returns an identity name. v1: round-robin across roster. v2 (post-tiering): pick best-fit by `(specializations × task tags)` overlap.
- **Recording** — `pattern-recorder record --identity 04-architect.mira --verdict pass ...` updates the identity's history. Existing per-persona stats remain (aggregated view).
- **Frontmatter ID convention** — actor spawns now have `id: actor-architect-mira` (was `actor-architect`). Tree-tracker child IDs follow same convention.

## Failure Modes

1. **Roster exhaustion** — if all roster names for a persona are spawned in a single run, round-robin starts to repeat. Counter: roster size ≥ max parallel actors per persona; default 3 covers current chaos-test usage.
2. **Stale specializations** — auto-derived specializations (e.g., "regex-bug-hunting") may persist after the identity's actual focus shifts. Counter: decay specializations over runs; require ≥3 recent runs in a category to keep the tag.
3. **Identity squatting** — a persona's roster could be exhausted by a single bad-faith user pre-spawning all names. Counter: rosters are toolkit-shipped, not user-mutable in v1.
4. **Concurrent identity assignment race** — two parallel spawns ask for an architect simultaneously; both get `mira`. Counter: file lock on `agent-identities.json` write; same lock pattern as `pattern-recorder.js`.

## Validation Strategy

Stress-test scenarios:
- Spawn 3 architects in one run. Verify each gets a distinct identity. Verify `nextIndex` advances correctly.
- Spawn 4 architects in one run (exceeds default roster of 3). Verify round-robin wraps and the 4th reuses `mira` (and downstream tooling tolerates duplicate identities in one run).
- Run 5 chaos cycles with consistent personas. Verify each identity's `totalSpawns` advances monotonically and `passRate` is computed correctly.
- Manually edit `agent-identities.json` to corrupt one identity's verdict counts. Verify the script either repairs or refuses to advance until corrected.
- Spawn under file-lock contention (5 parallel `record` calls). Verify no lost updates.

## When to Use

- All HETS chaos runs once `agent-identities.json` exists (Phase H.2 onwards)
- Any future multi-agent coordination outside chaos-test (HETS pattern is general)

## When Not to Use

- One-off experiments where identity continuity is noise
- Test runs that need fresh / unbiased identities (use `--ephemeral` flag — not yet implemented)

## Trust Formula (H.4.2 — explicit + auditable)

The trust score is **computed on demand** from each identity's persisted verdict history; there is no static `trust: 0.85` field on disk. Source of truth: `tierOf(stats)` in `scripts/agent-team/agent-identity.js:97-104`. The formula is intentionally simple — no recency decay, no skill-invocation weighting, no per-task complexity adjustment — so audits can reproduce any tier assignment from `verdicts {pass, partial, fail}` alone.

### The actual formula

```
total = pass + partial + fail
if total < 5:                  tier = 'unproven'
else:
  passRate = pass / total
  if passRate >= 0.8:          tier = 'high-trust'
  elif passRate >= 0.5:        tier = 'medium-trust'
  else:                        tier = 'low-trust'
```

Three things to notice:

1. **Minimum-runs gate** — under 5 verdicts you're treated as `unproven` (which the verification policy maps to `low-trust` defaults). One lucky pass doesn't earn high-trust.
2. **Partial = miss** — `partial` verdicts count toward the denominator but NOT the numerator. Equivalent to `partial → 0.0 credit`. Conservative; could be tuned to give partial credit (e.g., 0.5) in a future pass.
3. **No recency decay** — old verdicts weigh equally with new ones. An identity that passed 100 times two years ago and failed 5 times this week stays high-trust. **Known limitation**; tracked in BACKLOG for H.4.x or H.5.

### Worked example (live data, 2026-05-05)

```
identity                       totalSpawns   pass  partial  fail   tier
04-architect.mira              2             0     0        0      unproven (passes < 5)
06-ios-developer.riley         1             1     0        0      unproven (passes < 5)
01-hacker.zoe (CS-1)           1             0     1        0      unproven (passes < 5)
[hypothetical: 9 pass, 1 fail] 10            9     0        1      high-trust (passRate=0.9)
[hypothetical: 6 pass, 4 fail] 10            6     0        4      medium-trust (passRate=0.6)
```

Every live identity is currently `unproven` — this isn't a bug, it's the gate doing its job. Trust accumulates with verdict count.

### Tier → policy mapping (read by `recommend-verification`)

The trust formula above is purely descriptive; the **policy table** (`agent-identity.js:293-322`) maps each tier to a verification recommendation:

| Tier | Verification | Challenger | Skips |
|------|--------------|------------|-------|
| `high-trust` | spot-check only | none | `noTextSimilarityToPriorRun` |
| `medium-trust` | asymmetric challenger (1) | 1, different persona preferred | none |
| `low-trust` | symmetric pair | 2 | none |
| `unproven` | symmetric pair (cautious default) | 2 | none |

### Why simple beats sophisticated here

A weighted formula like `0.4·passRate + 0.2·skillCompleteness + 0.2·recency + 0.2·complexity` (cf. ruflo's published `0.4·success + 0.2·uptime + 0.2·threat + 0.2·integrity`) is more expressive but also more opaque. Audits become "why is mira high-trust?" → "she's at 0.78 weighted trust" → "what does that mean?" The current pass-rate-with-floor model gives every audit a one-line answer: *"mira is high-trust because she's passed 8 of her 10 verdicts (80%) since being spawned 2026-05-02."* When the formula evolves, it does so explicitly — change the function, bump the doc, ship a new phase.

### Tunables (BACKLOG)

- `MIN_VERDICTS_FOR_TIER` — currently hardcoded at 5 in `tierOf`. Future: contract-level override per persona.
- Partial-credit weight — currently 0.0; tuning to 0.5 would let challenger personas (which often produce partial verdicts on edge cases) accumulate trust faster.
- Recency window — track `passRate` over last N verdicts as well as lifetime; surface both in `tier` output.
- **Empirical refit of weighted-trust weights at H.8.x** — once `n≥20` builder verdicts accumulate (n=9 today), regress `verdict ∈ {pass, partial, fail}` against the 6 weighted axes and replace the theory-driven values in the `WEIGHTS` const at `agent-identity.js`. Reference scales may also need empirical adjustment as the observed range shifts.

### Weighted Trust Score (H.7.2 — supplemental signal)

`tierOf` (above) remains the audit-default trust signal — reproducible from `verdicts {pass, partial, fail}` alone, per the H.4.2 commitment. H.7.2 adds a **supplemental** weighted score that incorporates the H.7.0-prep + H.7.1 quality axes. The two are sibling signals; tier is the policy input, weighted score is the diagnostic / fine-grained ranking input. **Tier is NOT modified** — `tierOf` remains the formula at `agent-identity.js:97-104`, unchanged.

#### Formula

```
score = passRate × (1 + clamped_bonus)
clamped_bonus = clamp(Σ axis_contribution_i, -0.10, +0.50)
axis_contribution_i = WEIGHTS[i] × normalize_i(aggregateQF[i])
```

Source of truth: `computeWeightedTrustScore(stats, aggregateQF)` in `scripts/agent-team/agent-identity.js`. Surfaced as `cmdStats --identity X` JSON field `weighted_trust_score`.

#### Weights table (theory-driven; refit scheduled for H.8.x at n≥20)

| Axis | Weight | Direction | Citation / Rationale |
|------|--------|-----------|----------------------|
| `findings_per_10k` | +0.10 | positive | Dunsmore 2003: review effectiveness ~ defect density. Higher findings density per token = more efficient signal. |
| `file_citations_per_finding` | +0.135 | positive | Bacchelli & Bird MSR 2013: evidence depth ~ review quality. **Empirical refit H.7.4** (Pearson r=0.439, n=20, moderate confidence) — adjusted from theory's +0.10. See "Empirical Refit (H.7.4)" subsection below. |
| `cap_request_actionability` | +0.05 | positive | Half-weight; small sample size at H.7.2 (n=1 record on disk). Diagnostic-instinct signal. |
| `kb_provenance_verified_pct` | +0.10 | positive | Contract compliance — equal weight to evidence axes. Represents discipline. |
| `convergence_agree_pct` | +0.15 | positive | HIGHEST. Cohen 1960 / Krippendorff 2004: inter-rater agreement is the gold-standard reliability signal. |
| `tokens` | -0.05 | negative | Efficiency penalty. High token use for the same output = waste; weight sign inverts the standard normalization. |

Bonus cap: `[-0.10, +0.50]`. Asymmetric — bonus differentiates among passers more than it penalizes near-misses.

**Note on tightness**: under the H.7.2 weight table the max-positive theoretical bonus was **exactly +0.50** (sum of positive weights: 0.10+0.10+0.05+0.10+0.15 = 0.50). Under H.7.4 the positive-weights sum becomes 0.535 (0.10+0.135+0.05+0.10+0.15) — the cap of +0.50 is now **genuinely reachable from above**, and `bonus_capped: true` will fire for top-decile identities with all positive axes saturated. The cap was always intended as a real ceiling on excellence-rewarding; H.7.2 happened to sit exactly at the boundary. The defense-in-depth final score-clamp `Math.max(0, Math.min(1, score))` remains reachable: high-passRate identities producing `passRate × (1 + bonus) > 1` engage it.

#### Reference scales for normalization

| Axis | Low (→0) | High (→1) | Validated against H.6.x data |
|------|----------|-----------|------------------------------|
| `findings_per_10k` | 0.5 | 2.5 | observed 0.6→1.1; ample headroom |
| `file_citations_per_finding` | 1.5 | 6.0 | observed 3.0→5.75; raised from 4.0 to keep top observers below ceiling |
| `cap_request_actionability` | 0 | 1 | already in [0,1] |
| `kb_provenance_verified_pct` | 0 | 1 | already in [0,1] |
| `convergence_agree_pct` | 0 | 1 | already in [0,1] |
| `tokens` | 50,000 | 150,000 | observed 57k→134k; reference range 50k→150k |

Values outside `[low, high]` clamp to 0 or 1. Linear scaling between.

#### Worked example (live data, 2026-05-06)

`04-architect.ari` after 3 verdicts (3 pass / 0 partial / 0 fail):

- passRate = 1.000
- findings_per_10k = 1.0654 → normalized 0.2827 → contribution +0.0283
- file_citations_per_finding = 5.273 → normalized 0.8384 → contribution +0.0838
- cap_request_actionability = null → contribution 0
- kb_provenance_verified_pct = 0.0 → contribution 0
- convergence_agree_pct = 1.0 → normalized 1.0 → contribution +0.150
- tokens = 103,250 → normalized 0.5325 → contribution -0.0266
- bonus_sum = +0.235; not capped (within [-0.10, +0.50])
- raw composite = 1.0 × (1 + 0.235) = 1.235 → **clamped to 1.0** by the defense-in-depth final-score clamp

ari's tier remains `unproven` (3 < 5 verdicts) per `tierOf`; ari's weighted score is 1.0 (clamped) — the two signals show what each is for: tier guards against premature high-trust on thin data; weighted score reveals the underlying quality already present.

#### Edge-case rules

1. **No quality_factors_history** → `weighted_trust_score: null` (entire field). `tier` and `passRate` unaffected.
2. **passRate = 0** → `score = 0` regardless of bonus. Multiplicative composition guarantees this.
3. **Some axes null** (e.g., `convergence_samples = 0`) → those axes contribute 0; bonus is reduced but score is non-null.
4. **Bonus exceeds cap** → clamped; `bonus_capped: true` flag set; `quality_bonus` reflects the capped value.
5. **Score after composition outside [0,1]** → clamped to [0,1] (defense-in-depth; today this engages on high-quality identities like ari/noor where `passRate × (1+bonus) > 1`).

#### `decomposition_note` grammar

Comma-separated clauses, each in the form `"<axis>: <reason>"` or `"score: <reason>"`. Future tooling can parse this. Examples:

- `"all axes contributed normally"` (default — no special cases)
- `"convergence_agree_pct: null (no records); kb_provenance_verified_pct: null (no records)"`
- `"bonus capped at 0.5 from raw 0.6235; cap_request_actionability: null (no records)"`
- `"score=0 (passRate=0; never had a pass)"`

#### Why tier stays primary

Tier is the policy input (`recommend-verification` reads it; `prune` reads it). Switching policy to a continuous weighted threshold would re-open the H.4.2 audit-transparency wound. The supplemental score is for diagnostic ranking, debugging individual identities, and (eventually) refitting weights from accumulated empirical data. **`tierOf` is unchanged in H.7.2 (H.4.2 commitment held).**

#### Refit roadmap

Pointer to BACKLOG above: empirical refit at **H.8.x** once `n≥20` verdicts accumulate. The `WEIGHTS` and `REFERENCE_SCALES` constants in `agent-identity.js` are the only places that need to change — `computeWeightedTrustScore`, the `cmdStats` plumbing, and the consumer-facing JSON shape stay identical.

### Empirical Refit (H.7.4)

The H.7.2 doc projected an "empirical refit at H.8.x once n≥20 verdicts accumulate." We hit n=20 (paired pass/fail with quality_factors) at the close of H.7.3, so the refit ran early as **H.7.4**. The output: **one weight adjusted, five kept at theory, one explicitly overridden against the empirical signal.** Methodology, data, and per-axis verdicts below.

#### Methodology

- **Tool**: `scripts/agent-team/weight-fit.js` (Pearson correlation + linear regression; deterministic, auditable, no opaque ML).
- **Data source**: `~/.claude/agent-patterns.json`, filtered to entries with `quality_factors` populated and verdict ∈ {pass, fail}.
- **Confidence thresholds**: high (n≥30 AND |r|≥0.30), moderate (n≥15 AND |r|≥0.20), low (else), insufficient (n<5).
- **Decision rule**: adjust if confidence ≥ moderate AND |delta| ≥ 0.02; flag for human review if |delta| ≥ 0.10; else keep theory.

#### Sample sizes (data limits — read this first)

| Axis | n | Notes |
|------|---|-------|
| `findings_per_10k` | 20 | Fittable. |
| `file_citations_per_finding` | 20 | Fittable. |
| `cap_request_actionability` | 3 | Below floor; kept at theory. |
| `kb_provenance_verified_pct` | 20 | Apparent fit, but **19/20 values are `false`** (predictor near-constant). r is information-free. |
| `tokens` | 20 | Fittable but verdict-imbalanced (90:10 pass:fail). |
| `convergence_agree_pct` | 12 | Below n≥15 moderate threshold. |

**Verdict imbalance caveat**: 18 pass / 2 fail. With only 2 minority points, every `r` is highly sensitive to where those two points land in each predictor's distribution. Treat reported correlations as **rank-orderings, not point estimates**. Tighten thresholds at H.7.5+ once we have ≥10 fails.

#### Comparison: theory (H.7.2) vs empirical (H.7.4)

| Axis | H.7.2 (theory) | H.7.4 (shipped) | Empirical r | n | Verdict |
|------|---------------|------------------|-------------|---|---------|
| `findings_per_10k` | +0.10 | +0.10 (unchanged) | 0.083 | 20 | weak; keep theory |
| `file_citations_per_finding` | +0.10 | **+0.135** | 0.439 | 20 | **adjusted (moderate confidence)** |
| `cap_request_actionability` | +0.05 | +0.05 (unchanged) | n/a | 3 | insufficient n |
| `kb_provenance_verified_pct` | +0.10 | +0.10 (unchanged) | 0.076 | 20 | data near-constant; r meaningless |
| `convergence_agree_pct` | +0.15 | +0.15 (unchanged) | 0.674 | 12 | strong but underpowered |
| `tokens` | -0.05 | -0.05 (unchanged) | +0.288 | 20 | **override**: confound (see below) |

#### Tokens override rationale (H.4.2 audit-transparency disclosure)

The empirical analysis flagged `tokens` for review (delta +0.139; r=+0.288 — sign-flip from theory's negative). **We deliberately kept the theory weight of -0.05.** The disclosure:

1. **The empirical positive correlation is a sample-censoring confound.** Of n=20, only 2 are fails. Mean tokens for fails: 63,434. Mean tokens for passes: 95,273. The 6 highest-token entries (>=107k) are all passes. Both fails happen to land in the lower-token half. Without paired counterfactual data (the same agent doing the same task with vs without verbosity), this correlation reflects **"substantive tasks generate both more tokens AND more successful work"** — task-substantiveness is the lurking variable.

2. **The negative weight is normative, not descriptive.** The score has two roles: it *describes* what correlates with verdict (data) AND *prescribes* what we want to incentivize (architectural design choice — efficient work is preferred over verbose work, all else equal). Allowing data to flip a normative sign blurs these roles. Audits then become "why is high-token use *rewarding*?" → "the data said so" — circular and indefensible.

3. **The linear-regression slope is exactly 0** in the script output. The reported r=0.288 is driven entirely by minority-class clustering, not by a meaningful per-token effect.

The override is itself an audit event: when data and architectural intent conflict, the decision is documented openly so future refits know what was overridden and why. Re-evaluate at H.7.5+ when ≥10 fails exist and tokens-per-output-token can be decomposed from raw tokens.

#### Methodology limitations (honest disclosure)

- **n=20 with 2 fails is the floor of usable** — we ran the refit at the earliest possible point. Statistical power is real but limited.
- **Pearson on 90:10 imbalanced binary outcomes is sensitive to minority-class position** — see verdict-imbalance caveat above.
- **No bootstrap CIs** in the current `weight-fit.js` output — reported r values are point estimates; CIs would be wide.
- **`kb_provenance_verified_pct` is dominated by `false`-defaults** — likely a "no transcript → false" recording-pipeline artifact. The `keep_theory` outcome is correct but the apparent r=0.076 is information-free.
- **`findings_per_10k` and `file_citations_per_finding` are structurally correlated** — both scale with finding count. The shipped citations adjustment may partly reflect findings-volume; cross-check at H.7.5 if findings_per_10k is also adjusted.

#### Successor-phase backlog

- **H.7.5**: Re-run with ≥10 fail records. Decompose tokens-per-output-token from raw tokens. Add bootstrap CIs to `weight-fit.js` output. Add near-constant-predictor warning to script. Tighten moderate-confidence threshold to `|r|≥0.25`.
- **H.8.x**: Reconsider `convergence_agree_pct` once n≥15 paired entries (currently n=12). Joint refit of co-correlated finding-axes if both move.

#### Profile versioning

The shipped `WEIGHTS` object now carries the constant `WEIGHT_PROFILE_VERSION = "h7.4-empirical-v1"`. The `weighted_trust_score` JSON output surfaces this as a top-level `profile` field. Future weight changes bump the profile version; no historical-score migration is needed because scores are derived from `quality_factors_history` on demand (not stored).

#### Forward-compat: tier-policy stability

`tierOf` is unchanged (H.4.2 commitment held). The H.7.4 refit affects ONLY `computeWeightedTrustScore`'s output. `recommend-verification`, `prune`, and the verification-policy table all read `tier`, not `weighted_trust_score`, so no callsites change.

## Multi-Axis Trust Signal (H.7.0)

The H.7.4 refit moved one axis empirically; H.7.0 adds three new axes — one INSIDE the score formula, two OBSERVABLE-ONLY. The phase also formalizes the *composition algebra* under which axes combine, addressing a load-bearing gap surfaced during the H.7.0 architectural design pass: had the new axes composed multiplicatively with `passRate`, a single zero-valued axis (e.g., a dormant identity with `recency_decay → 0`) would have collapsed the entire trust signal to zero. This section documents the additive-bonus rule the score formula commits to, and the sample-size gate that keeps observable axes out of the score until empirical fit is possible.

#### New axes added at H.7.0

| Axis | Where it lives | Empirical floor | Citation / Rationale |
|------|---------------|-----------------|----------------------|
| `task_complexity_weighted_pass` | **In score** (+0.10 in `WEIGHTS`) | n≥1 (pure derivation; no fit needed) | Bacchelli & Bird MSR 2013 evidence-depth framework. passRate weighted by route-decide complexity bucket: `Σ(passes × bucket_weight) / Σ(total × bucket_weight)`. Bucket weights `{trivial: 0.5, standard: 1.0, compound: 1.5}` — theory-driven; refit at H.7.5+. |
| `recency_decay_factor` | OBSERVABLE-ONLY (cmdStats output) | n≥30 per identity AND span≥30 days | Curtis et al. 1988 software-engineering memory window. Exponential decay with half-life 30 days: `decay = exp(-Δdays / 30)`. Surfaced as `cmdStats.recency_decay_factor`. NOT in score formula at H.7.0 — see "Sample-size gate per axis" below for the empirical floor argument. |
| `qualityTrend` | OBSERVABLE-ONLY (cmdStats output) | n≥6 per identity | Windowed slope over per-axis windows: `recent_avg` (verdicts[-3:]) vs `prior_avg` (verdicts[-6:-3]); `slope_sign` ∈ `{up, down, flat}`. Used by `recommend-verification` drift trigger; not a score input. |

The complexity bucketer derives buckets at aggregate-time from existing `task_signature` field (no new verdict field — see CRITICAL C-3 in H.7.0 design pass for why). The route-decide thresholds drive the bucket boundaries: `score_total < 0.30 → trivial`; `0.30 ≤ score < 0.60 → standard`; `score ≥ 0.60 → compound`.

#### Composition is additive within bonus, NOT multiplicative across axes

The H.7.0 design pass surfaced a load-bearing decision: the new axes contribute INTO `clamped_bonus` (additive), they do NOT multiply against `passRate` or each other (multiplicative). Composition stays:

```
score = passRate × (1 + clamped_bonus)
clamped_bonus = clamp(Σ axis_contribution_i, -0.10, +0.50)
```

Why this matters: a multiplicative composition like `passRate × complexity × recency` has degenerate zeros. An identity at `passRate=1.0, complexity=1.0, recency=0` (last verdict 365+ days ago — exponential decay zeros) would collapse to score = 0 *despite a perfect track record*. That's not a TRUST collapse — it's a STALENESS observation, conflated.

The H.4.2 commitment ("any tier assignment must be reproducible from a one-line explanation") would silently break: `"why is mira at 0?" → "she's high-passRate, but recency_decay zeroed her"`. Additive composition keeps each axis's contribution proportional to its weight; clamping caps total excursion; no axis can collapse the score by itself.

#### Sample-size gate per axis

The H.7.4 framework set explicit confidence floors: high (n≥30 AND |r|≥0.30), moderate (n≥15 AND |r|≥0.20), low (else), insufficient (n<5). H.7.0 honors that floor for new axes:

| Axis | Floor required | Observed today | Status at H.7.0 |
|------|---------------|----------------|-----------------|
| `task_complexity_weighted_pass` | n≥1 (derivation, not fit) | All identities | **In score** (theory-driven weight; refit at H.7.5+) |
| `recency_decay_factor` | n≥30 per-identity AND span≥30 days | 0 of 12 active identities (longest span: mira at 5.08d) | **Observable-only** until floor met |
| `qualityTrend` | n≥6 per identity (windowed slope minimum) | 5 of 12 active identities | **Observable-only**; drift trigger fires for the 5 that qualify |

`recency_decay_factor` could be empirically fit at n=35 today, but the per-identity time-span distribution is dominated by mira's record (5+ days vs <1 day for the other 11). Fitting the half-life coefficient now would let mira's record dominate; the coefficient would not generalize. The 30-day half-life is theory-driven from Curtis 1988 typical-memory-window; refit gated on n≥30 per-identity span≥30 days — the toolkit cannot reach that for ~30 calendar days minimum from today.

`qualityTrend` requires n≥6 verdicts to compute the windowed slope (3 recent + 3 prior). Identities below the threshold have `qualityTrend: null`; the drift trigger gracefully degrades — they fall through to the existing tier-table policy unchanged.

#### WEIGHT_PROFILE_VERSION bump rationale

`h7.4-empirical-v1` → `h7.0-multi-axis-v1`. The bump signals to future audits that the formula scope expanded (a new axis joined the bonus computation), independent of whether existing weights changed. The H.7.4 weights are kept (file_citations_per_finding=0.135; the rest at theory). H.7.0 adds task_complexity_weighted_pass=0.10 and surfaces two observable-only axes. The new positive-weights sum is 0.585 (was 0.535); BONUS_CAP.max stays at 0.50, so cap-from-above is genuinely active for top-decile identities with all positive axes saturated.

#### Drift detection / recalibration triggers

`recommend-verification` gains a drift pre-check block that fires BEFORE the tier-based policy. Order is load-bearing; first match wins. Each pre-check returns a `recalibration_reason` field for audit traceability; the tier-table fall-through is unchanged from H.7.4.

| Priority | Trigger | Condition | Policy |
|----------|---------|-----------|--------|
| 1 | `--force-full-verify` flag | Explicit user override | Full-verify (symmetric-pair) |
| 2 | `recalibration_due` | `spawnsSinceFullVerify >= 10` | Full-verify (symmetric-pair) |
| 3 | high-trust + task-novelty | `tier === 'high-trust'` AND task signature has NO overlap with `specializations[]` | Asymmetric-challenger (1) |
| 4 | high-trust + qualityTrend down | `tier === 'high-trust'` AND `qualityTrend.findings_per_10k.slope_sign === 'down'` OR `qualityTrend.file_citations_per_finding.slope_sign === 'down'` | Full-verify (symmetric-pair) |
| 5 | (fall-through) | None of the above | Existing tier-policy table |

The threshold `N=10` for `recalibration_due` is theory-driven (matches `retireMinVerdicts`); refit gate at H.7.5+ once 3 high-trust identities have ≥30 verdicts each. The `qualityTrend` window is 3 (matches typical history depth; covers ~30% of an identity's record at QUALITY_FACTORS_HISTORY_CAP=50).

#### Worked example (H.7.0 multi-axis)

Hypothetical identity (post-H.7.0 spawn) with 6 pass / 0 partial / 0 fail and a mix of task complexities:

- passRate = 1.000
- 2 trivial passes (signature → score < 0.30) + 3 standard passes (0.30-0.60) + 1 compound pass (≥0.60)
  - Weighted passes = 2×0.5 + 3×1.0 + 1×1.5 = 5.5
  - Weighted total = 5.5 (all passed)
  - `task_complexity_weighted_pass` = 5.5 / 5.5 = 1.0 → normalized 1.0 → contribution +0.10
- file_citations_per_finding = 4.5 → normalized 0.667 → contribution +0.090
- findings_per_10k = 1.2 → normalized 0.350 → contribution +0.035
- convergence_agree_pct = 0.8 → normalized 0.8 → contribution +0.120
- kb_provenance_verified_pct = 1.0 → contribution +0.100
- cap_request_actionability = null → contribution 0
- tokens = 80,000 → normalized 0.300 → contribution -0.015
- bonus_sum = +0.430; not capped (within [-0.10, +0.50])
- raw composite = 1.0 × (1 + 0.430) = 1.430 → **clamped to 1.0** by the defense-in-depth final-score clamp
- Profile: `h7.0-multi-axis-v1`

The identity's tier is determined by `tierOf` alone (passRate ≥ 0.8 over ≥5 verdicts → high-trust); the weighted score is 1.0 (clamped) — the two signals stay sibling: tier is the policy input, weighted score is the diagnostic / fine-grained ranking input.

#### Forward-compat: tier-policy stability (H.7.0)

`tierOf` is unchanged at `agent-identity.js:98-105` (H.4.2 commitment held; byte-for-byte invariance test ran at the H.7.0 ship boundary). The H.7.0 changes affect ONLY `computeWeightedTrustScore`'s output (one new axis joins the bonus; observable-only fields surface in cmdStats) and `recommend-verification`'s pre-check block (drift triggers preempt the tier-policy table for high-trust identities). `prune`, `assign`, the verification-policy table itself, and all existing passRate-derived behaviors are unchanged.

## Lifecycle + Evolution Vision (H.6.6 + H.7.0)

Trust scoring isn't an end-state — it's an input to a longer evolution loop. The toolkit's vision is **agent breeding**: after enough iterations, the roster collapses to high-trust specialists tuned to *this user's actual workload*. Mirror of how modern chickens are bred to maximize egg-laying — selection pressure → reproduction → culling → generational specialization.

### L1 — Lifecycle primitives (SHIPPED in H.6.6)

The `prune` subcommand walks the identity store and produces recommendations:

| Recommendation | Rule | Action (with `--auto`) |
|----------------|------|------------------------|
| **Retire** | `verdicts ≥ 10` AND `passRate < 0.3` | Set `retired: true` + `retiredAt` + `retiredReason`. Identity stays in JSON for audit/replay; round-robin in `assign` skips them. |
| **Tag specialist** | `verdicts ≥ 5` AND `passRate ≥ 0.8` AND `skillInvocations[X] ≥ 3` | Add skill to `specializations[]`. Populate `traits.skillFocus = X`. Advisory only — doesn't change routing today. |

Defaults are CLI-tunable (`--retire-min-verdicts`, `--retire-pass-rate-max`, `--specialist-min-verdicts`, `--specialist-pass-rate-min`, `--specialist-min-invocations`).

`agent-identity unretire --identity X` restores a soft-retired identity (mistake-recovery; reversible by design).

**Schema additions (forward-compatible for L3)**:
- `retired: bool`, `retiredAt: ISO`, `retiredReason: string` — used by L1 today
- `parent: identity-id | null` — placeholder for L3 lineage (always null today)
- `generation: int` — 0 for round-robin originals; H.7.0 will increment per generation
- `traits: { skillFocus, kbFocus, taskDomain }` — `skillFocus` populated by `prune --auto`; rest reserved for L3

### L2 — Input-quality (SHIPPED in H.6.7)

Skill-forge consults a canonical-source registry before generic internet research. See [skill-bootstrapping](skill-bootstrapping.md) for the bootstrap flow; this just changes the *sources* it uses.

### L3 — Evolution loop (SHIPPED in H.7.0)

The breeding mechanism is live. `agent-identity breed --persona X` selects a parent (highest weighted_trust_score; tie → passRate; tie → createdAt), picks a kid name (first free roster slot or `--name`), creates the kid identity with parent's traits as priors, and writes the new identity to the store. Diversity-guard + population-cap + user-gate semantics enforce the H.6.6 lifecycle commitments end-to-end.

#### Breeding mechanics (`agent-identity breed`)

```
agent-identity breed --persona <NN-name> [--parent <id>] [--name <kid>] [--auto]
```

Flow:

1. Validate persona is in `DEFAULT_ROSTERS`.
2. Filter live (non-retired) identities of this persona.
3. **Diversity-guard** (refuse-if-monoculture; see below).
4. **Population-cap** (refuse-if-full-roster; see below).
5. Pick parent: `--parent` if supplied (must be live + same persona); else highest `computeWeightedTrustScore` (ranked by `score`; tie → `passRate`; final tie → `createdAt` ascending).
6. Pick kid name: `--name` if supplied; else first free slot in `DEFAULT_ROSTERS[persona]` (live OR retired uses the slot).
7. **User-gate**: if first breed for this persona AND `!args.auto`, emit `requires_confirmation: true` JSON and exit 0; subsequent calls (or `--auto` on the first call) proceed without re-prompt. State carried in `store.breedFirstPromptedFor[persona]`.
8. Create kid: `parent: <parent-id>`, `generation: parent.generation + 1`, `traits: { ...parent.traits }` (deep-copied; parent's skill focus + kb focus inherited as priors), empty verdicts/history/specializations, `spawnsSinceFullVerify: 0` (per architect-mira note: kid is unproven; counter is per-identity, not per-lineage).
9. `writeStore`. Output structured JSON `{ action, applied, kid, parent, generation, traits_inherited }`.

#### Diversity guard + population cap

**Diversity guard** (architect-mira H-2): breeding refuses when `count(persona X live identities with generation === 0) <= 1`. Rationale: every breed advances the parent into specialization-space; without at least 2 generation-0 generalists alive, the next breed would leave 0 generalists for that persona, collapsing the round-robin universe to the bred specialists' priors. Recovery actions surfaced in the error JSON: (1) add a new generation-0 name to `DEFAULT_ROSTERS`; (2) un-retire a previously-retired generation-0 identity.

**Population cap** (architect-mira H-4): breeding refuses when `live.length >= rosters[persona].length`. Rationale: roster names are the universe; a full roster has no slot for a kid without retirement. Caller must `prune --auto` (retire underperforming) or extend the roster first. The cap preserves the "round-robin universe is the roster names" invariant.

The two checks are independent — both must pass before breed proceeds. Together, they ensure the population is bounded (no unbounded growth) AND diverse (always at least 1 generalist remains).

#### Specialization-aware assign

`agent-identity assign --persona X --task <tag>` now honors specialization overlap when picking from the live roster. When at least one live identity has `specializations[]` overlap with the task tag (exact match weighted 2× substring match weighted 1×), the highest-overlap candidate is picked; ties broken by round-robin index. When no overlap exists across all candidates, falls back to round-robin (unchanged H.6.x behavior).

The change is purely additive: callers that don't pass `--task` see no behavioral change. Callers that do pass `--task` get the specialization-overlap pick; the assign output now carries `pickReason: 'specialization-overlap' | 'round-robin'` for audit visibility.

#### Trait inheritance

Kid identities inherit `traits` from parent as priors:

- `skillFocus` — string; dominant skill from parent's `skillInvocations`
- `kbFocus` — array; deep-copied to prevent mutation aliasing
- `taskDomain` — string; dominant task tag prefix

Verdicts, history, specializations, and skill invocations all start empty. The kid is `unproven` per `tierOf` (total verdicts < 5); accumulates trust organically. The traits represent priors — what the toolkit *expects* the kid to be good at, given parental lineage — not earned reputation.

When parent has `traits.skillFocus === null` (no dominant skill yet), the kid inherits the null. Today the design proceeds without refusal; revisit at H.7.5+ if observed.

`spawnsSinceFullVerify` resets to 0 for the kid (drift counter is per-identity, not per-lineage). The kid is unproven; first 10 spawns will get full-verify regardless of trigger because the recalibration_due threshold is reached on the 10th spot-check. 

### Why the staged rollout

L3 needs population-level data to design rules well. Trying to design breeding from n=1 verdict produces guesswork rules that get tuned later anyway. L1 + L2 are the substrate that the population accumulates *into*. After ≥20 builder verdicts, the data exists to design L3 empirically.

## Related Patterns

- [Trust-Tiered Verification Depth](trust-tiered-verification.md) — reads per-identity trust to decide verification depth
- [Persona-Skills Mapping](persona-skills-mapping.md) — identities accumulate per-skill invocation history
- [HETS](../SKILL.md) — the substrate
