# v2.8.3-run1 — Manifest

**Run extracted via extract-run.sh on 2026-05-22T12:59:43.103313Z.**

## Where the run artifacts live

- Project: `/Users/shashankchandrashekarmurigappa/projects/textbook-tutorial-v2.8.3-run1`
- Snapshots: `/Users/shashankchandrashekarmurigappa/projects/textbook-tutorial-v2.8.3-run1/bench/snapshots/`
- FINAL-DEBRIEF: `/Users/shashankchandrashekarmurigappa/projects/textbook-tutorial-v2.8.3-run1/bench/FINAL-DEBRIEF.md`
- Per-phase debriefs: `/Users/shashankchandrashekarmurigappa/projects/textbook-tutorial-v2.8.3-run1/bench/debriefs/phase-0-and-bootstrap.md`, `phase-1.md`, `phase-2.md`, `phase-3.md`
- Spawn-run state: `/Users/shashankchandrashekarmurigappa/Documents/claude-toolkit/swarm/run-state/v2.8.3-run1-{bootstrap,phase-1,phase-2,phase-3,phase-4}/`

## Status

- **Toolkit version under test**: power-loom v2.8.3
- **Toolkit-repo commit at time of run**: ab023b29590ebab2cad67c64fbb09d1d972b5152 (tag v2.8.3, merge "v2.8.3 — v2.8.2-run1 baseline corrections + bench-harness fixes" #151)
- **Brief**: `bench/control-runs/brief.md` v1 (locked, not edited mid-run)
- **Run date**: 2026-05-22
- **Run wall-clock**: ~5 hours (session start to FINAL-DEBRIEF commit)
- **Deviations from brief**: see metrics.json `deviations` array (5 deviations captured: DRIFT-004, DRIFT-008, DRIFT-009, DRIFT-014, DRIFT-015)

## Caveats

1. **DRIFT-015 — Phase 4 scoping**: /chaos-test NOT invoked; single 12-security-engineer.vlad spawn substituted. Audit was substantively adversarial (found 2 CRITICALs including a CVE) but missing the brief's 4-actor minimum.
2. **TDD verification offline-traced only**: evan's 11-test chapter-parser suite was authored tests-first and traced-green by mental execution against impl, not by running `npm test` (env constraint blocked `npm install`).
3. **DRIFT-001 skill loader on 2.8.2**: skills resolved from the 2.8.2 cache path even after `/plugin update`+`/reload-plugins`. Hooks were on 2.8.3 (probe-verified). Skill files identical between 2.8.2 and 2.8.3 caches so no behavior delta — but reveals reload-plugins cutover is non-uniform.
4. **identities-pre.json** in this dir was captured BEFORE Phase 0 sync-legacy ran — so the diff against final `agent-identities.json` includes the sync-legacy delta + the run's spawn deltas. To isolate the run's effect, subtract the sync-legacy delta (33 identities → 33 identities, but synthid_history backfill of 18 entries between them).
5. **Identity round-robin selection**: jade got assigned twice (bootstrap + Phase 1 challenger). Other identities got 1 spawn each. Round-robin behavior may differ on runs 2+3 — if a different jade-equivalent gets double-spawned, that's the rotation working.

## Run is part of variance-bounding campaign

This is **run 1 of 3** for v2.8.3 baseline variance bounding. After runs 2 and 3 land in `v2.8.3-run2/` and `v2.8.3-run3/`, `python3 bench/control-runs/aggregate.py v2.8.3-run*` produces the first scientifically-defensible variance bands. Until then every claim is anecdote.
