# v2.8.5-treatment — Manifest

**Run extracted via extract-run.sh on 2026-05-22T17:11:55.384188Z.**

## Where the run artifacts live

- Project: `/Users/shashankchandrashekarmurigappa/projects/textbook-tutorial-v2.8.5-treatment`
- FINAL-DEBRIEF: `/Users/shashankchandrashekarmurigappa/projects/textbook-tutorial-v2.8.5-treatment/bench/FINAL-DEBRIEF.md`
- Per-phase debriefs: `bench/debriefs/phase-{0-and-bootstrap,1,2,3}.md`
- Spawn-run state: `~/Documents/claude-toolkit/swarm/run-state/v2.8.5-treatment-phase-{1,2,3,4}/`
- Pre-flight state: `pre-flight-state.json` (this dir)
- Identities pre-snapshot: `identities-pre.json` (this dir)

## Status

- **Toolkit version under test**: power-loom v2.8.5
- **Cache install timestamp**: 2026-05-22 09:06:04 (temporal filter for log analysis)
- **Brief**: `bench/control-runs/brief.md` v1 (locked, not edited mid-run)
- **Run date**: 2026-05-22
- **Run wall-clock**: single session multi-phase continuous (vs brief's "4 sessions ~2-3h each") — logged as PROCESS variance
- **Git commits in project**: 5

## Caveats

1. **DEVIATIONs 003/006/007** — 7 of 8 implementer ceremonies actor-only scope-down. Per brief: "the single biggest source of toolkit-feature non-exercise." Logged honestly.
2. **DRIFT-007 (env-inheritance)** — `ANTHROPIC_API_KEY` shows set-but-empty across sub-shells + Next.js process. Tutorial generation E2E could not complete. Pipeline code shipped; LLM round-trip blocked at env layer.
3. **DRIFT-014 (mio accounting)** — aki HIGH-2 surfaced accounting drift: `12-security-engineer.mio` aggregate `verdicts.total` = 5 but `quality_factors_history.length` = 4. Tier transition outcome may still be correct under threshold, but arithmetic in Phase 1 debrief off by one. Real toolkit-level finding.
4. **2 NEW CRIT SSRF bypasses** — Phase 4 chaos hacker zoe found `localhost.` trailing-dot + `[::127.0.0.1]` IPv4-compat IPv6 bypasses. Beyond the 28-case test matrix; substrate-level fixes required for next iteration.
5. **3 block-class architectural gaps** — jade flagged orchestrator (no transaction → permanent orphan books), /api/ingest (no auth/rate-limit), markChapterCompleteAction (no FK verify → cross-book progress poisoning).

## Comparison vs v2.8.3-run1

- 15 spawns vs 8
- /chaos-test full 4-actor (vs v2.8.3 single-actor scope-down — DRIFT-015 there)
- SSRF substrate-level fix shipped (vs v2.8.3 deferred)
- Drizzle CVE actually pinned ^0.45.2 (vs v2.8.3 referenced not pinned)
- Tutorial generation E2E NOT achieved (vs v2.8.3 achieved with chen) — env constraint
- SynthId drift observed (vs v2.8.3 all stable) — new capability exercised

## metrics.json gaps (per extraction notes)

- `actors_spawned_total`: actual 15 (extractor reports 0 — extractor doesn't crawl run-state/)
- `tier_transitions_detail`: 1 (mio Phase 1; with DRIFT-014 accounting note)
- `cache_reuse_pct`: prompt-caching wired in priya's claude-api client but live smoke skipped
- `tokens_per_finding`: not measured
