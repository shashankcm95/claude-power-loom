# bench/control-runs — Cross-Version Toolkit Benchmark

## Purpose

Treat the **Textbook→Tutorial Web App** project as a constant test object. Re-run the same 4-phase build across multiple toolkit versions and measure the *delta* in substrate metrics (findings density, convergence rate, verdict-loop closure, tier transition counts, hook-runtime-gap incidents, etc.).

This is the v2.4.0 architect-bench pattern (multi-run characterization → variance bounds → trend analysis) scaled up from per-agent verdicts to whole-toolkit ships. Same methodology, same lessons.

## What this is NOT

- **Not a regression suite for the project code.** The project is the *vehicle*. The measurements are about the *toolkit*.
- **Not a single-run truth machine.** One run is LLM-stochastic, not toolkit-signal. n≥3 per version minimum.
- **Not self-validating.** The toolkit auditing itself is recursive. External validation samples (human eyeball OR different model family) on every Nth run.

## Methodology

### Hold constant (the controls)

| What | How |
|---|---|
| **Project brief** | `brief.md` — verbatim, no edits between runs. Brief evolution = independent variable contamination. Version separately as `brief-v2.md` if revised. |
| **Dependencies** | `deps-lock.md` — Node version, npm packages, OS state. Pinned via Volta or asdf; documented per run. |
| **Phase contracts** | 4 phases (0 pre-flight → 4 chaos audit) per the original handoff brief. Acceptance criteria documented per phase. |
| **Starting identity store** | Snapshot `~/.claude/agent-identities.json` BEFORE each run; restore after. Each run starts from the same baseline reputation state. |

### Vary (the treatments)

| What | When |
|---|---|
| **Toolkit version** | One per ship — v2.8.2 baseline, v2.8.3, v2.9.0, etc. |
| **Model rolls** | Inherent — LLM stochasticity is the noise we're trying to measure variance for |

### Measure (the metrics)

See `metrics-schema.json` for the canonical extraction commands.

#### Tier 1 — toolkit-substrate (load-bearing signal)

| Metric | Direction | Notes |
|---|---|---|
| `findings_density_critical_high` | ↑ better up to saturation, then ↓ | Total CRITICAL+HIGH findings across all phases |
| `convergence_rate` | ↑ better | % of findings caught by ≥2 independent actors |
| `verdict_loop_closure` | ↑ better | (verdicts recorded via pattern-recorder) / (actors spawned) |
| `tier_transition_count` | ↑ better | Identities crossing unproven→low→med→high |
| `contract_verifier_exercise_rate` | ↑ better | (HETS spawns with verifier run) / (total HETS spawns) |
| `hook_runtime_gaps` | ↓ better | Cases where source says X, runtime does Y. v2.8.2 baseline = 1 (prompt-enrich Fix-2(a)). |
| `forge_cite_rate` | ↑ better | Forged skills referenced by ≥1 downstream actor |
| `tokens_per_finding` | ↓ better | Total tokens / total drift count. Cost efficiency. |
| `spawn_ceremony_deviation_rate` | ↓ better | % of spawns that skipped formal HETS flow |
| `cache_reuse_pct` | ↑ better | Token cache_read / (input + cache_read + cache_create) |

#### Tier 2 — project-outcome (downstream noise; use with caution)

| Metric | Direction |
|---|---|
| `tests_passing` | ↑ |
| `build_success` | binary |
| `eslint_errors` | ↓ |
| `typescript_errors` | ↓ |
| `wall_clock_per_phase` | context-dependent |

**Tier 2 is influenced by LLM rolls + library quirks + actor micro-decisions — too noisy to attribute to toolkit changes without large n.**

## Run protocol

For each new run:

1. **Pre-run snapshot**:
   ```bash
   cp ~/.claude/agent-identities.json bench/control-runs/<version>-run<N>/identities-pre.json
   ```

2. **Reset to baseline reputation state** (so the run starts from the same point):
   ```bash
   # Decision: restore-pre-baseline-snapshot OR start-fresh-and-track-delta
   # See "Learning-effect contamination" in risks below.
   ```

3. **Open a fresh chat session.** Paste `brief.md` verbatim. Do the work across 4 phases.

4. **Per-phase telemetry**: the new session creates a project-local `bench/` and runs `capture.sh` at each phase boundary (per the brief).

5. **End-of-run extraction**:
   ```bash
   bash bench/control-runs/extract-run.sh \
     --project ~/projects/textbook-tutorial-<version>-run<N>/ \
     --target bench/control-runs/<version>-run<N>/
   ```

6. **Cross-version diff** (after each new completed run):
   ```bash
   python3 bench/control-runs/aggregate.py \
     bench/control-runs/v2.8.2-run* \
     bench/control-runs/v2.8.3-run*
   ```

## Risks (and mitigations)

1. **Learning-effect contamination** — each run trains the toolkit (verdicts accumulate; tier transitions persist). Run 2 ≠ Run 1 even on the same version.
   - *Mitigation*: snapshot identity store BEFORE; restore (or fork to a HETS_IDENTITY_STORE alternate) AFTER. Treat each run as ephemeral state.

2. **Recursive measurement bias** — the toolkit is auditing itself. Findings density can be gamed (intentionally or not).
   - *Mitigation*: external validation sample every 5 runs. Human re-rates 10% of findings; OR forward to a different model family.

3. **Library/runtime drift** — pdf-parse, Next.js, Node, npm all evolve. A "regression" might be an upstream change, not toolkit.
   - *Mitigation*: pin everything in `deps-lock.md`; use Volta or asdf. Document any deviation in the run's notes.

4. **Brief-creep temptation** — each run, you'll want to "improve" the brief based on what you learned. Don't.
   - *Mitigation*: brief is versioned separately (`brief.md` is v1; only branch as `brief-v2.md` if a deliberate methodology change is needed; never silent-edit).

5. **n=1 deltas are noise, not signal** — most readers will treat single-run results as truth.
   - *Mitigation*: `aggregate.py` outputs variance bands. Any claim labeled "Δ" must also report whether it exceeds the n=3 variance band for the baseline.

## Acceptance thresholds (effect-size guidance)

Pre-registered so we don't post-hoc rationalize:

- **Meaningful improvement** = delta > 2× the baseline variance band (95% confidence).
- **Marginal** = delta within 1-2× variance band.
- **Noise** = delta within 1× variance band — NOT claimable as "the toolkit improved."

## Directory layout

```
bench/control-runs/
├── README.md                   # this file — methodology + metric definitions
├── brief.md                    # the LOCKED Textbook→Tutorial brief (verbatim from session-of-record)
├── deps-lock.md                # pinned versions + capture instructions
├── metrics-schema.json         # canonical metric extraction commands
├── extract-run.sh              # pulls metrics from a project's bench/ snapshots into metrics.json
├── aggregate.py                # cross-version comparison + variance bands
│
├── v2.8.2-run1/                # data point #1 (baseline; from the session-of-record)
│   ├── MANIFEST.md             # pointer to where the project artifacts actually live
│   ├── metrics.json            # extracted Tier-1 + Tier-2 metrics
│   ├── identities-pre.json     # snapshot before run (or note: was live state, no pre-snapshot)
│   └── notes.md                # human notes on this run (deviations, anomalies, context)
│
├── v2.8.2-run2/                # to be populated by next session
├── v2.8.2-run3/                # to be populated by next session
│
├── v2.8.3-run1/                # post-treatment runs
├── v2.8.3-run2/
└── v2.8.3-run3/
```

## Phase plan

### Phase A — framework setup (this PR)
- All files in this directory created
- v2.8.2-run1 metrics extracted from the session-of-record test log

### Phase B — baseline variance (next 2 sessions)
- Run brief.md twice more on v2.8.2 → fills v2.8.2-run2 + v2.8.2-run3
- Run `aggregate.py v2.8.2-run*` → outputs variance bands
- **This is the load-bearing step.** Skipping it makes all future treatment-deltas uninterpretable.

### Phase C — first treatment (after v2.8.3 ships)
- Ship v2.8.3 (fix prompt-enrich runtime gap, contract-verifier non-optional, etc.)
- Run brief.md 3× on v2.8.3 → fills v2.8.3-run{1,2,3}
- Run `aggregate.py v2.8.2-run* v2.8.3-run*` → improvement report card

### Phase D — quantified ship reports (ongoing)
- Each v2.X.Y CHANGELOG includes a "Δ vs prior" metrics block
- Ships that don't move metrics get questioned at PR review
