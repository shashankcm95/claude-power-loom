# v2.8.2-run1 — Human Notes

## Why this run matters

This is the **first complete shakedown** of the toolkit using the locked brief methodology. It established:

1. The Textbook→Tutorial Web App is a viable control object (4 phases, ~6-8h, 7+ personas, real complexity)
2. The bench harness (project-local `bench/capture.sh` + `diff.sh`) generates useful per-phase telemetry
3. The toolkit produces high finding-density on a single shakedown (44 findings in ~4h)
4. **The single most important finding**: the v2.8.2 Fix-2(a) (prompt-enrich skip-pattern for "merged"/"shipped"/etc.) is in source but NOT operative in the runtime hook. This was caught by two independent chaos-test actors (convergence).

## Notable session-of-record details

- Built across 4 distinct chat sessions (Phase 0+1, Phase 2, Phase 3, Phase 4)
- User pivoted Anthropic → OpenAI mid-run (Phase 2 boundary); captured as a brief-spec deviation
- Docker absent on host; pivoted to local Postgres; captured as an environment deviation
- TDD-treatment applied to chapter-parser (data point #4 in the TDD experiment: jade caught 2 MEDIUM findings that unit tests missed)
- next-js skill was both forged (Phase 0) AND evolved (Phase 4) within the same run — a complete forge-then-evolve cycle in one shakedown

## Open follow-ups specific to this baseline (not future-run concerns)

1. **Identity store snapshot is missing.** Did not capture `~/.claude/agent-identities.json` before the run started; the tier transition count (2) is real but the starting state of all identities isn't documented. Future runs MUST snapshot pre-run.

2. **Forged skills are uncommitted.** `~/Documents/claude-toolkit/skills/postgres-engineering/` and `~/Documents/claude-toolkit/skills/next-js/` are sitting in the working tree of the toolkit repo. Plus `skills/agent-team/kb/manifest.json` is modified. The user said "deferred to a separate cycle." These need their own harvest PR.

3. **eslint_errors not measured.** Phase 3 verified `next build EXIT=0` but didn't run eslint separately. Retroactive extraction is possible from the project repo; default to null until measured.

4. **External validation sample not done.** All ratings are internal-to-toolkit. Should sample 4-5 findings for human re-rating to validate severity assignments.

## What I'd do differently for v2.8.2-run2 (the next baseline replicate)

1. Snapshot `~/.claude/agent-identities.json` before starting (so tier transition deltas are clean)
2. Pin Node + npm explicitly in `deps-lock.md` at session start
3. Follow the formal HETS spawn ceremony rigorously (assign-identity → frontmatter identity → contract-verifier → pattern-recorder) — Drift 1 was a self-inflicted methodology error that cascaded; the brief explicitly says don't bypass
4. Capture eslint + ts errors at end of Phase 4 (Tier-2 metrics shouldn't be null)
5. Have the original (orchestrator) session pre-commit to which v2.8.2 fixes to look for in particular, so the convergence signal has a target

## What this run validated about the methodology

✅ The locked brief is detailed enough to drive a complete 4-phase build
✅ The bench harness telemetry produces actionable cross-phase deltas
✅ The 7-feature scorecard is the right honest framing (forces "EXERCISED" vs "PARTIALLY-EXERCISED" calibration)
✅ Convergence between independent chaos actors produces high-confidence findings (1 strong case in this run)
✅ The shakedown surfaces enough drifts to drive the next ship cycle (44 findings → v2.8.3 + v2.9.0 plans)

## What this run flagged about the methodology

⚠️ Spawn ceremony is easy to bypass — needs to be FORCING (not just documented)
⚠️ Identity-store pre-snapshot is non-obvious — needs to be in `capture.sh` as a Phase-0 step
⚠️ External validation gap — the toolkit auditing itself is fine for finding-detection but suspect for finding-rating; need independent sampling

## Source-of-truth links

- FINAL-DEBRIEF: `~/Documents/Textbook_to_Tutorial/bench/FINAL-DEBRIEF.md`
- Per-phase debriefs: `~/Documents/Textbook_to_Tutorial/bench/phase-{1,2,3}-debrief.md`
- Test log (session transcript): `~/Downloads/test_log.txt`
- Toolkit-repo orphan skills (pending harvest): `~/Documents/claude-toolkit/skills/{postgres-engineering,next-js}/`
