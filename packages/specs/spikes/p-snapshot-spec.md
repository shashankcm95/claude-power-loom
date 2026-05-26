# P-Snapshot Probe Spec — K9 Implementation Choice

**Status**: spec drafted; probe NOT yet run. Decision required at v3.0-alpha kickoff.
**Scope**: ~2-3h probe; ~150 LoC test fixtures.
**Question**: which K9 implementation strategy best satisfies §6.1.1 K14-sequencing contract while minimizing LoC?

## Background

Round-6 architect verdict (NEEDS-PROBE on field-survey C2): v4.3's K9 reverse-cherrypick journal (~650-1,050 LoC) MAY be over-engineered relative to field-converged alternatives (Cursor zip, Hermes content-addressable shadow git, Aider `git reset HEAD`). Estimated 400-700 LoC simplification — but this assumes snapshot-restore handles §6.1.1's 5 K14-sequencing sub-cases as well as reverse-cherrypick does. Unproven.

## Three K9 implementation candidates

| Candidate | LoC | Disk cost | Atomic rollback | Audit granularity |
|---|---|---|---|---|
| (a) Reverse-cherrypick journal (v4.3 current) | ~650-1,050 | ~journal size | multi-step (potential for partial failure) | per-cherrypick (`spawn-state.journal[]`) |
| (b) Spawn-bookended zip snapshot (Cursor-style) | ~200-300 | full worktree zip per spawn | single git op (atomic) | spawn-level only |
| (c) Content-addressable shadow git (Hermes pattern) | ~300-500 | dedup'd object store | single git op | per-content-blob via shadow git log |

## Test fixtures (~150 LoC)

Implement each candidate on toy fixtures. For each, run §6.1.1's 5 K14-sequencing sub-cases:

1. **PASS path**: K14 PASS → K9 cherrypicks → spawn-state PROMOTED. Verify all 3 candidates leave the filesystem in the expected post-state.

2. **K14 FAIL pre-K9**: K14 detects out-of-scope writes BEFORE K9 runs. spawn-state = REJECTED. K9 should NOT execute. Verify no partial state.

3. **K14 FAIL post-K9 (tail-window)**: K14 detects backgrounded write that completed AFTER K9 ran. K9.rollback must consume journal/snapshot to revert. For candidate (a), this is journal-driven; for (b)/(c), this is snapshot-driven. Verify the post-rollback filesystem matches the pre-spawn state.

4. **K14 FAIL during K9** (event-stream variant; v3.1+ only): K9 receives in-process abort signal mid-cherrypick. Verify atomic rollback for each candidate.

5. **Override (LOOM_ALLOW_OUT_OF_SCOPE_WRITES=1)**: K14 RECORDS violations but does NOT cause REJECTED state. K9 proceeds normally. Verify all 3 candidates emit the audit record correctly.

## Semantic-invalidity test (§6.1.2 boundary)

Per K9 semantic-invalidity caveat: rollback restores syntactic state only. Verify all 3 candidates leave the post-rollback filesystem in a state where downstream verification gates (typecheck, lint, tests) can be re-run cleanly. This is a wash across candidates (none of them fix semantic invalidity) — but the fixture should demonstrate that ALL candidates produce identical syntactic post-rollback state for a simple "delete a file then revert" workflow.

## Measurement

For each candidate, report:
- Implementation LoC (excluding test fixtures)
- Disk cost per spawn at 1KB / 10KB / 100KB / 1MB worktree sizes
- Atomic-rollback verification (any partial-failure window?)
- Audit-record fidelity (can a reviewer reconstruct what happened from the audit log alone?)
- §6.1.1 compliance: PASS / PARTIAL / FAIL per sub-case

## Decision criteria

Choose the candidate that:
1. Passes all 5 K14-sequencing sub-cases (mandatory)
2. Minimizes LoC (tie-breaker 1)
3. Provides per-event audit granularity if other criteria are close (tie-breaker 2)

Document the decision in `swarm/thoughts/shared/spikes/p-snapshot-findings.md` and update §6.1.K14 + §6.1.1 + the v3.0-alpha K9 budget accordingly.

## Phase 0 independence

Phase 0 file moves are AGNOSTIC to the K9 implementation choice. The K9 module's location in the new workspace layout (`packages/kernel/k9/` or equivalent) is the same regardless of which candidate ships. Phase 0 may proceed in parallel with P-Snapshot — the probe lands its decision before v3.0-alpha K9 implementation begins, not before Phase 0.

## Effort

- Fixture implementation: ~2h
- Run + measure 3 candidates: ~1h
- Write up findings + update spec: ~30 min
- **Total: ~3-4h**

## Carry-forward

If a 4th candidate emerges between now and v3.0-alpha kickoff (e.g., a new published pattern in 2026 literature), add it to the fixture suite. The probe is extensible.
