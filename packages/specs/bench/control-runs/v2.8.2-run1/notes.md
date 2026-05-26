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

2. **Forged skills are uncommitted.** RESOLVED — harvested via PR #150 (merged 2026-05-22 at f7b725e). `skills/postgres-engineering/SKILL.md` + `skills/next-js/SKILL.md` now in main. Manifest timestamp-noise deliberately excluded.

3. **eslint_errors not measured.** Phase 3 verified `next build EXIT=0` but didn't run eslint separately. Retroactive extraction is possible from the project repo; default to null until measured.

4. **External validation sample not done.** All ratings are internal-to-toolkit. Should sample 4-5 findings for human re-rating to validate severity assignments.

5. **CHAOS-SUB-1 (prompt-enrich runtime gap) was a FALSE POSITIVE.** RESOLVED — see post-hoc correction below.

## Post-hoc correction (2026-05-22 v2.8.3 investigation)

The single CRITICAL finding from Phase 4 chaos test — **"prompt-enrich Fix-2(a) is in source but NOT operative in runtime"** — was a false positive caused by temporal-blindness in the chaos actors. Investigation summary:

### Evidence that disproved the finding

The actual prompt-enrich-trigger.log shows "merged" classifications evolved cleanly across the /plugin update at May 21 17:53:

```
May 21 14:45  vague:true   ← pre-fix
May 21 17:28  vague:true   ← pre-fix
May 21 17:51  vague:true   ← pre-fix (mid-session sighting)
┄┄ /plugin update at 17:53 ┄┄
May 21 21:24  vague:FALSE  ← post-fix ✓
May 22 00:41  vague:FALSE  ← post-fix ✓
May 22 00:49  vague:FALSE  ← post-fix ✓ (and later)
```

All 4 candidate hook copies on disk (`~/.claude/hooks/scripts/`, `~/.claude/plugins/cache/.../2.8.2/`, `~/.claude/plugins/marketplaces/...`, `~/Documents/claude-toolkit/hooks/scripts/`) are byte-identical and contain the new skip pattern at line 95. Source/cache binary diff is empty.

### Root cause of the false positive

Both `blair` (03-code-reviewer) and `lior` (05-honesty-auditor) inspected the prompt-enrich-trigger.log and saw `vague:true` entries for "merged". They concluded "the fix is broken in runtime." But neither filtered by timestamp — both were looking at PRE-/plugin-update entries and treating them as current behavior.

### The deeper finding this generated

**Convergence between two actors is NOT a strong-enough validation signal when both actors share the same blindspot.** The H.2 trust-tiered verification design assumed independent perspectives → reliable convergence. But "independent actors" with shared methodological blindspots produce coordinated false positives that look like high-confidence findings.

This is itself a load-bearing finding for v2.8.3+:

- **Chaos-actor prompt template needs temporal-filtering discipline**: when reading hook logs for "current behavior" claims, MUST filter to entries newer than the most-recent /plugin update timestamp.
- **Convergence-validation pattern needs refinement**: the strong signal is "diverse-method convergence" (e.g., one actor reads logs, another spawns a probe). Same-method convergence (both actors read same logs) only validates that the input was processed twice — not that the conclusion is correct.

### Impact on this run's metrics

- `tier_1_substrate.hook_runtime_gaps`: corrected from `1` → `0`
- `findings_breakdown_by_severity.critical`: corrected from `1` → `0` (the CRITICAL was this false positive; SSRF in /api/ingest is HIGH product-code, separate)
- `scorecard_7_feature.prompt_enrich_fix_2a`: corrected from `BROKEN-IN-RUNTIME` → `EXERCISED`
- `findings_density_critical_high`: corrected from `5` → `4`

The original numbers are preserved in `metrics.json._original_baseline_uncorrected` for audit transparency.

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
