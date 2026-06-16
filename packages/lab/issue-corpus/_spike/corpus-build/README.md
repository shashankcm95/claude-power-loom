# v3.11 bootcamp corpus-build (`_spike` — manual, OUT of CI)

The harness + data for the v3.11 full-bootcamp re-run (the validation behind the phase-close, PR #333).
**Everything here is a manual spike**: run by hand, never globbed by CI or any unit test.

## Pipeline

1. `stage-from-pr.js` — a merged GitHub PR → a staged record in `staged/<id>.json` (derives `base_sha` =
   the PR's first-commit^1, splits the diff: tests → `test_patch`, `.py` → the fix, else dropped).
2. `verify-record.js` — the per-issue GATE: sandbox-prove a staged record is a genuine
   fail-before / pass-after OSS bug; writes `staged/<id>.verdict.json`.
3. `add-to-manifest.js` — accrete a VERIFIED record into `bootcamp-manifest.json` (verified-only invariant).
4. `bootcamp-capture.js` — the real `claude -p` derive leg over the manifest → mint lesson nodes into
   `recall-graph/` (+ `sidecar/`).
5. `bootcamp-measure.js` — the discrimination measurement → `measurement-report.json` +
   `consolidation-report.json` (regenerated over the full corpus).

`collision_clusters` in the manifest is a **planning hint** — issues grouped so ≥2 plausibly land in one
`trigger|gotcha|corrective` cell; the derive leg assigns the ACTUAL signature at capture (Phase 2b).

## Schema note (why these records are NOT W0 corpus records)

These staged records are consumed ONLY by the harness above:
`verify-record.js` → `makeBehavioralFn` (the sandbox), and `bootcamp-capture.js` →
`captureLessons` (whose eligibility gate, `recall-graph.js` `isEligibleForPopulation` /
`CLEAN_FOR_RETRIEVAL`, **requires** `contamination_tier` on `attempt.reference`).

They are **NOT** the W0 sealed corpus validated by `packages/lab/issue-corpus/corpus.js` `validateOne`
(`seed-manifest.json`), whose schema forbids `contamination_tier` at W0 (it is populated later by W2/W3
demotion) and requires `is_negative_control`. Nothing here is fed to `validateOne`. So a staged record
**intentionally** carries `contamination_tier: clean-pending-probe` (load-bearing for retrieval
eligibility — removing it mints 0 nodes) and omits `is_negative_control`. The two schemas are distinct;
do not apply the W0 corpus contract to these spike records.
