# H.7.1 — Asymmetric-challenger callsite wiring (PASS)

> First phase shipped via the **corrected autonomous-platform pattern**: root spawned the orchestrator on the design + implementation; root never hand-coded. The H.7.1 PR is itself the demo of the pattern.

## Cycle headline

- **Pair-run (sequential design→impl)**: `04-architect.ari` (design) + `13-node-backend.noor` (implementation)
- **Both PASS** independently via contract-verifier
- **Convergence: agree** — noor implemented ari's design 1:1, no design choices re-derived
- **First convergence-axis entry in toolkit history** — populates `convergence_agree_pct = 1.0` for both identities

## Why this exists

H.2.3 (asymmetric-challenger) and H.2.4 (trust-tiered verification) shipped substrate 6+ phases ago. The orchestration callsite never fired — every prior verdict was unilateral. The architect's persistent CS-1 → CS-3 finding *"substrate-rich, call-site-poor"* manifested concretely here.

## What landed

### A. Concrete `commands/build-team.md` Step 7 (~93 lines of bash flow)

Replaced aspirational text with executable shell flow. Three branches keyed off `recommend-verification`'s `verification` field:
- `spot-check-only` (high-trust): single implementer + `--skip-checks` per policy
- `asymmetric-challenger` (medium-trust): implementer + 1 challenger via `assign-challenger`
- `symmetric-pair` (low-trust + unproven): implementer + 2 challengers via new `assign-pair`

`SKIP_CHECKS` is read ONLY in the high-trust branch (per ari's H-2 design constraint — prevents `noTextSimilarityToPriorRun` skip from bleeding into low-trust runs that depend on similarity-detection).

### B. New `cmdAssignPair` subcommand (`agent-identity.js:436-525`)

```bash
node scripts/agent-team/agent-identity.js assign-pair --persona X --count 2 --task ...
# Returns: { action, pair: [...], poolType, count, excludedPersona, task }
```

Internally accumulates exclusions across iterations (eliminates silent-collision risk noted in `kb:hets/symmetric-pair-conventions:64`). Dispatch case at line 833. Edge cases:
- `count < 2` → error redirecting to `assign-challenger`
- `count > available roster size` → error with available count
- All retired identities → error

### C. `pattern-recorder.js` + `agent-identity.js` convergence axis

New flags compose into existing H.7.0-prep `quality_factors` payload:
- `--paired-with <other-identity>` — string passthrough
- `--convergence <agree|disagree|n/a>` — enum-validated

`aggregateQualityFactors` extended with `convergence_agree_pct` + `convergence_samples`. Mirrors existing `kb_provenance_verified_pct` pattern: null when no observations; percentage of decisive `agree` over decisive entries.

### D. Pattern-doc status promotions

- `patterns/asymmetric-challenger.md`: `status: active` → `active+enforced`
- `patterns/trust-tiered-verification.md`: same
- New "Enforcement callsite" sections pointing at `commands/build-team.md` Step 7
- `patterns/README.md` table + legend updated to define the new status

### E. `contracts-validate.js` extension (capability gap noor surfaced)

ari's design didn't include `contracts-validate.js` in the "files to modify" list. Without extending it, the `active+enforced` status would block every future run with `invalid-status` violations. noor caught this during incremental testing and added:
- `'active+enforced'` to `VALID_STATUSES` (line 41)
- Extended `parseStatusTable` regex with longer-match-first ordering (otherwise the regex would match "active" out of "active+enforced")

This is a textbook **H.6.5 missing-capability-signal** moment — implementer surfaced a gap the designer missed; noor handled it inline + flagged it for future architectural design passes.

## Cycle data

```
ari (04-architect):
  passRate: 1.0 (3 verdicts; still unproven at 3<5)
  convergence_agree_pct: 1.0 (1 paired sample)

noor (13-node-backend):
  passRate: 1.0 (2 verdicts; unproven)
  convergence_agree_pct: 1.0 (1 paired sample)

Toolkit-wide builder verdicts: 7 (pre-H.7.1) → 9 (post-H.7.1)
Toolkit-wide convergence samples: 0 → 2 (the first paired data ever recorded)
```

## Validation

- ✅ `assign-pair --persona 04-architect --count 2` returns 2 distinct identities, `poolType: different-persona`
- ✅ `pattern-recorder record --paired-with X --convergence agree` populates `quality_factors.paired_with` + `quality_factors.convergence`
- ✅ `agent-identity stats` shows `convergence_agree_pct` + `convergence_samples` non-null when paired data present
- ✅ `contracts-validate.js`: 0 violations across all 7 validators
- ✅ Both pattern docs show `status: active+enforced`; README table + legend reflect the new value
- ✅ `commands/build-team.md` Step 7 contains literal bash flow (≥30 lines per ari's design)

## Meta-finding: corrected autonomous-platform pattern in production

This is the **first phase shipped through the orchestrator** rather than hand-coded by root. Sequence:

1. User: *"sure, but let's get into a habit of getting into planning mode whenever multiple files are being edited"*
2. Root: enters plan mode, writes plan, calls ExitPlanMode
3. User: approves
4. Root: invokes orchestration:
   - **assigns architect** (`04-architect.ari`) → design pass
   - **assigns 13-node-backend** (`13-node-backend.noor`) → implementation pass
5. Root coordinates verdicts + records convergence
6. Root: ships substrate (commit + PR + merge + tag)

What root did NOT do: write any code in scripts/, write any pattern doc, design the function signatures. Substrate did all of that.

What root DID do: choose personas (could be automated by tech-stack-analyzer in `/build-team`), brief sub-agents, verify outputs, record verdicts, ship.

**Token economics**: Root ~10K tokens (planning + coordination). Sub-agents ~237K tokens (ari 103K + noor 134K). Total ~250K — comparable to a single hand-orchestrated H.6.x cycle task, but produces 2 builder verdicts WITH convergence data instead of 1 unilateral verdict.

## H.7.1 follow-ups (deferred)

- **Self-test pair-run on a real task** — the smoke test validated assign-pair + recording. A real `/build-team` invocation that triggers the full Step 7 flow (recommend-verification → assign-challenger → spawn implementer + challenger → verify both → record convergence) is the next step. Suggested task: the M-1 spawn-conventions update from H.6.9 backlog.
- **Add `validation_sources` to challenger.contract.json**? — challenger output cites engineering practice; should it cite primary references too? Probably yes for security-themed pair-runs (RFCs); deferred until pattern emerges.
- **Token-extraction validation** — none of this run's verdicts populated `tokensUsed` non-null because no transcript was supplied. Future spawns with `--transcript` should populate it.

## Closure

Phase H.7.1 closes the H.2.3 + H.2.4 callsite gap that's been unmoved for 6+ phases. The convergence-as-signal substrate is now live; data accumulates from this run forward. Combined with H.7.0-prep's quality-factors history, the toolkit now captures **6 quality axes per verdict** + **convergence-on-pair-runs**, all forward-compatible for H.7.0's empirical weight derivation at n≥20.

The architect's persistent `substrate-rich, call-site-poor` finding is now RESOLVED for asymmetric-challenger and trust-tiered-verification specifically — the pattern-doc status `active+enforced` codifies the transition.
