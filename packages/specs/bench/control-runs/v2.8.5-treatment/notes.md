# v2.8.5-treatment — Human Notes

## What happened in this run

The v2.8.5-treatment control-benchmark exercised power-loom v2.8.5 against a multi-phase PDF→Tutorial Next.js 14 build. 15 sub-agent spawns across 4 phases produced 108 passing project tests + 5 git commits + 27 chaos-audit findings. Substrate-level fixes for v2.8.3 vlad CRIT-1+2 were SHIPPED (SSRF validator with 28-case test matrix; Drizzle ^0.45.2 pinned post-GHSA-gpj5-g38j-94v9). Phase 4 honored the brief's "full 4-actor chaos team — do NOT scope down" — zoe + sam + jade + aki produced load-bearing findings (2 new CRIT SSRF bypasses beyond the test matrix; 4 HIGH architectural gaps; honest-with-calibration-error rating from aki). Tutorial-generation E2E blocked by an env-inheritance DRIFT (ANTHROPIC_API_KEY shows set-but-empty in sub-shells).

## Notable findings vs v2.8.3-run1 (prior run, same toolkit family)

- **More substrate work** (15 vs 8 spawns) — but additional ambition surfaced new failure modes
- **Full chaos team honored** (vs v2.8.3's single-actor scope-down DRIFT-015) — Phase 4 produced 27 findings
- **SSRF actually substrate-fixed** with 28-case test matrix (vs deferred in v2.8.3) — though Phase 4 found 2 NEW CRIT bypasses beyond the matrix
- **Drizzle CVE actually pinned** ^0.45.2 with advisory citation (vs referenced-not-pinned in v2.8.3)
- **SynthId drift observed** for first time (priya: 917b0b18 → 51f2c14d) — feature exercised in production rather than synthetic probe
- **Tutorial gen E2E missed** (vs v2.8.3 chen achieved) — environment constraint (DRIFT-007)
- **TDD-treatment empirically GREEN** with vitest live (vs v2.8.3 offline-traced only)
- **Format-DRIFT root cause located** (DRIFT-002 → contract-verifier.js:78 regex requires `## SEVERITY` H2 buckets, not docstring's `### LOW-1` under `## Findings`) — actionable fix surfaced

## Open follow-ups

1. **3 block-class fixes** (per jade): orchestrator transaction, /api/ingest auth+rate-limit, markChapterCompleteAction FK-verify
2. **2 NEW CRIT SSRF fixes** (per zoe): trailing-dot localhost + IPv4-compat IPv6 — substrate-level fixes required
3. **DRIFT-002** (contract docstring) — update `swarm/personas-contracts/engineering-task.contract.json:36` _doc to match countFindings regex
4. **DRIFT-014** (mio accounting) — investigate persistence-layer drift between aggregate counter + quality_factors_history length
5. **DRIFT-007** (env inheritance) — document + wire env layer between root + Bash sub-shells + Agent sub-processes + Next.js dev sub-process
6. **DEVIATION-003/006/007** policy decision — should HETS implementer-challengers be ceremonially required (current scope-down pattern is "the single biggest source of toolkit-feature non-exercise" per brief)?

## What I'd do differently next time

- **Pre-wire env layer for Phase 2 LLM E2E** — source `.env` via dotenv in Next.js runtime BEFORE Phase 2 spawn so priya can do live smoke + orchestrator can complete tutorial gen
- **Spawn implementer challengers (at least asymmetric) rather than scope-down** — chaos team's load-bearing signal demonstrated the value of challenger pairs
- **Apply nova's 3 MEDIUM fixes at TDD step 4** (instead of carrying as known-future-work) — closes the TDD feedback loop fully rather than ending at "surfaced but deferred"
- **Run extract-run.sh after each phase** (not just at end) — accumulating snapshots gives the extractor better data than a final crawl
- **Investigate DRIFT-014 (mio accounting) BEFORE next run** — could be persistence-layer drift between counter writes and history writes
- **Apply the 5 block-class items** (3 jade + 2 zoe CRITs) before considering Phase 2+ shippable to external users
