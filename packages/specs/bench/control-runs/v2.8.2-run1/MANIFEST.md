# v2.8.2-run1 — Manifest

**This is data point #1.** Established as the baseline for cross-version benchmarking.

## Status

- Toolkit version under test: **v2.8.2**
- Toolkit-repo commit at time of run: see `~/Documents/claude-toolkit/` HEAD at `2026-05-21` (~3576684 v2.8.2 merge or later)
- Brief: `bench/control-runs/brief.md` (v1)
- Run date: 2026-05-21
- Run mode: live (project built on actual disk; not a dry-run)

## Where the run artifacts actually live

The shakedown was executed on the user's machine; project artifacts and per-phase debriefs are in a SEPARATE directory tree (not in the toolkit repo):

| Artifact | Path |
|---|---|
| Project code | `~/Documents/Textbook_to_Tutorial/` |
| Phase debriefs | `~/Documents/Textbook_to_Tutorial/bench/phase-{1,2,3}-debrief.md` |
| FINAL-DEBRIEF | `~/Documents/Textbook_to_Tutorial/bench/FINAL-DEBRIEF.md` |
| Phase snapshots | `~/Documents/Textbook_to_Tutorial/bench/snapshots/` |
| Identity store snapshot | (taken at each phase; in snapshots/) |
| Forged skills (Phase 0 + Phase 4 evolve) | `~/Documents/claude-toolkit/skills/postgres-engineering/` + `~/Documents/claude-toolkit/skills/next-js/` (currently uncommitted — pending harvest PR) |
| Test report (the full session log) | `~/Downloads/test_log.txt` |

## Why metrics.json was extracted manually (not via extract-run.sh)

This baseline was established BEFORE the framework existed. The extractor was bootstrapped from the test log + FINAL-DEBRIEF reading. Future runs use `extract-run.sh`. The numbers in `metrics.json` are pulled from the documented findings + telemetry in the test log; cross-check against the FINAL-DEBRIEF for the source-of-truth narrative.

## Caveats specific to v2.8.2-run1 (informed cross-version comparison)

1. **No pre-run identity snapshot.** The baseline reputation state was whatever happened to be live (identities had varying tier states from prior session work). v2.8.2-run2 and v2.8.2-run3 should snapshot the identity store BEFORE starting to establish a clean baseline.

2. **Spawn ceremony skipped throughout (Drift 1).** 83% of actor spawns bypassed the formal HETS flow. This means `contract_verifier_exercise_rate = 0%` and `verdict_loop_closure = 87.5%` (achieved only via manual catch-up via pattern-recorder, not via the formal flow). These baseline numbers are conservative — a more disciplined run would push both higher.

3. **Pivots from brief**:
   - Docker absent → local Postgres (env condition; documented as P1-3 LOW)
   - Anthropic API → OpenAI API (user-directed mid-run; documented as P2 pivot)
   - These DO NOT invalidate the run as a baseline but should be flagged when comparing v2.8.3+ runs that follow the brief verbatim.

4. **No external validation sample.** All findings were rated by the toolkit's own actors. lior (honesty-auditor) provided internal calibration in Phase 4 but the run lacks an external (human or different-model) audit on a sample of findings.

## Deliverables produced by this run

- 44 documented findings (1 CRITICAL · 4 HIGH · 14 MEDIUM · 25 LOW)
- 2 forged skills (`postgres-engineering`, `next-js`)
- 1 evolved skill (`next-js` +47% in Phase 4)
- 1 capability request surfaced (`actor-integration-architect` persona)
- 7-feature scorecard (FINAL-DEBRIEF §Honest scorecard)
- Toolkit ship recommendations: v2.8.3 (urgent) + v2.9.0 (substantive)

## What this baseline is good for

✅ Establishing the metric extraction shape
✅ One data point against which v2.8.2-run2/3 (variance bounding) compare
✅ Reference narrative for what a "complete" shakedown looks like
✅ Documenting the known v2.8.2 substrate gaps (so v2.8.3 treatment effects are measurable)

## What this baseline is NOT good for

❌ Variance bounding (n=1)
❌ Claiming any cross-version delta as "significant" until n≥3 baselines exist
❌ External validation (toolkit auditing itself with no outside check)
