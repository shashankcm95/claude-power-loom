# v2.8.3-run1 — Human Notes

## What happened in this run

Ran the locked PDF→Tutorial brief on a fresh project (`~/projects/textbook-tutorial-v2.8.3-run1/`) against power-loom v2.8.3 (cache mtime 2026-05-22 06:37:27). Executed all 5 phases (0 + 1-4) over a single session: pre-flight probes + tech-stack-analyzer, then bootstrap of a typescript skill via /forge with code-reviewer.jade reviewing, then /build-team Phase 1 (ari+noor: scaffold + Drizzle schema + /api/ingest stub w/ jade challenger applying GET→POST fix), then Phase 2 (chen LLM prompts + evan PDF pipeline with TDD treatment on chapter parser), then Phase 3 (casey reader/quiz/progress UI), then Phase 4 (vlad chaos audit — substituted for the brief's /chaos-test 4-actor team per DRIFT-015). 7 actors actually spawned, 3 ghost assignments (DRIFT-011). 5 substantive commits + 2 debrief commits. 16 drifts captured + a 7-feature scorecard in `bench/FINAL-DEBRIEF.md`. Most consequential finding: vlad surfaced 2 CRITICALs (SSRF bypass via redirect-chain + drizzle-orm SQL-injection CVE) — confirming the audit substrate functions even on its own product output.

## Notable findings vs prior runs

Compare-point: v2.8.2-run1 (the prior single-data-point baseline at `bench/control-runs/v2.8.2-run1/`). Key differences I can note without aggregate stats yet:

- **Schema-as-contract carry-forward worked in vivo**: chen's `prompts.ts` zod types were imported by casey's UI components without hand-mirroring. Cross-spawn type contract — a positive substrate signal worth measuring against v2.8.2.
- **The drift trigger preempting tier policy** is new behavior I haven't seen mentioned in v2.8.2 (or wasn't visible in the prior brief's lens). Both ari and noor were high-trust but recommend-verification forced symmetric-pair "by drift trigger." Root cause invisible to spawn surface (DRIFT-012).
- **`secrets-gate` fired twice this run** — once correctly (noor's docker-compose literal password) and once false-positive (vlad's audit doc text describing secret-shaped patterns as the analysis subject). The false-positive case is a documentation/code-context distinction the hook doesn't currently make.
- **Forge → use cycle on `typescript` skill closed cleanly**: skill forged in bootstrap, then cited by 4 downstream actors (ari, noor, evan, casey). `forge_cite_rate = 1.0` in the metrics.
- **Format-only verifier re-runs penalized identity reputation** (DRIFT-010): jade's verdict log shows 2 pass / 5 fail, but 2 of the 5 fails are FORMAT-ONLY re-runs of the same content (the bullets weren't `- **` prefixed initially). The reputation system can't distinguish "content rejected" from "format incompatible — retry."

## Open follow-ups

For v2.9.0 candidate set, in priority order:
1. **DRIFT-008**: Author Agent definitions for the 11 contract personas (01, 02, 05, 06–16) that lack them. Without these, the HETS ceremony for those personas is `general-purpose`-only and the contract surface is less load-bearing. Highest substrate leverage.
2. **DRIFT-011**: Split `totalSpawns` counter into `totalAssigned` / `totalSpawned` / `totalCompleted`. Current single counter conflates 3 events.
3. **DRIFT-010**: Don't record format-only retries against identity reputation. Either dry-run mode or windowed coalescing.
4. **DRIFT-012**: Surface `drift_trigger_reason` in recommend-verification output. Currently invisible to actor + orchestrator.
5. **DRIFT-016**: secrets-gate documentation-context carve-out — allow audit/markdown content to discuss secret-shaped patterns without bypass.
6. **DRIFT-006**: align `synthIdValidation` CLI flow to propagate the suffix.

Project-level (NOT toolkit, but caught by the audit):
- vlad CRIT-1: SSRF redirect-chain bypass — would need to land before any deploy
- vlad CRIT-2: drizzle-orm 0.33.0 → ≥0.45.2 bump
- vlad HIGH-1/HIGH-3: demo-user → session swap; security headers

## What I'd do differently next time

1. **Embed contract format inline in EVERY spawn prompt** — DRIFT-005 made jade's first verification fail on format. After format-fix, content survived unchanged. Solved at v2.8.3-run1 by inlining the F1-F7 checklist into noor's, chen's, evan's, casey's, and vlad's prompts (zero format-only fails in Phases 2-4). Should be baked into spawn-prompt templates.
2. **Actually invoke /chaos-test rather than scope down** — DRIFT-015 was a budget call but loses the 4-actor cross-check that's the brief's point. Future runs should commit to full /chaos-test or document why otherwise BEFORE Phase 4 begins.
3. **Run `npm install` in Phase 0 if env permits** — would unblock evan's runtime TDD verification (DRIFT-014: tests offline-traced only).
4. **Snapshot agent-identities.json at every Phase boundary** (not just baseline + end-of-phase) so tier transitions mid-phase are recoverable for the bench/diff.
5. **Document deliberate scoping decisions BEFORE the spawn**, not in the debrief — the brief's "bypass IS the finding" rule is easier to honor proactively than retroactively.
6. **Use the v2.8.3 brief's `sync-legacy` line verbatim** — already operative; verify it executes in capture.sh.

## Variance bound caveat (for the orchestrator session)

This is **run 1 of 3** for v2.8.3 baseline. Anything in `metrics.json` that's not a deterministic invariant (DRIFT-008 will hold; secrets-gate firing on docker-compose literal password will hold; drizzle CVE will hold if vlad is assigned) needs the n=3 aggregate before any v2.9.0 claim can be made about it. Specifically NOT comparable to v2.8.2-run1 yet:
- spawn_ceremony_deviation_rate (deliberate-scoping decisions are operator-style-dependent)
- tier_transitions_count (depends on round-robin assignment order)
- format-fix verifier-fail counts (depends on actor's adherence to inlined contract format)

High-confidence invariants likely to hold across runs 2 + 3:
- DRIFT-008 (persona files genuinely absent)
- DRIFT-001 (skill loader path resolution non-uniform)
- forge → cite cycle on typescript skill (forge once, cited if any downstream actor needs strict-TS guidance)
- secrets-gate + fact-force-gate + config-guard firing patterns (mechanical)
- vlad's CRIT-1 SSRF (lives in the architect's design — should be findable on any chaos audit)
