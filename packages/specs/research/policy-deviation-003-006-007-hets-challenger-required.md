---
date: 2026-05-22
phase: v2.9.0 Phase E.2
topic: DEVIATION-003/006/007 — HETS implementer-challenger requirement policy
status: decided
deciding_authority: 04-architect.theo (v2.9.0 design review) + user (Phase E sign-off)
related_versions: [v2.8.5-treatment, v2.9.0]
related_docs:
  - bench/control-runs/v2.8.5-treatment/notes.md
  - skills/agent-team/kb/agent-team/patterns/asymmetric-challenger.md
  - skills/agent-team/kb/hets/spawn-conventions.md
---

# Policy decision — should HETS implementer-challengers be ceremonially required?

## Empirical signal

The v2.8.5-treatment debrief identified DEVIATION-003/006/007 as a recurring pattern: when `/build-team` spawns an implementer persona for engineering work, the convention says "spawn an asymmetric challenger" (per `kb:agent-team/patterns/asymmetric-challenger`). In practice, the scope-down reflex fires more often than the spawn-challenger reflex:

| Bench run | Implementer spawns | Challenger spawns | Ratio |
|-----------|---------------------|---------------------|-------|
| v2.8.2-run1 | 8 | 0 | 0.0 |
| v2.8.3-run1 | 6 | 1 | 0.17 |
| v2.8.5-treatment | 11 | 2 | 0.18 |
| v2.8.5-control | 9 | 0 | 0.0 |

User-facing characterization: *"the single biggest source of toolkit-feature non-exercise"* per the v2.8.5 brief. The asymmetric-challenger pattern is documented load-bearing for HETS quality but is not enforced.

## Options considered

### Option A — Ceremonially required (mandatory pairs)

`/build-team` blocks at implementer-spawn time unless either (a) a challenger is also spawned, or (b) `--no-challenger` is passed explicitly with a justification string logged to the run-state directory.

**Pros**:
- Forces the discipline; no scope-down by default
- Catches the v2.8.5-treatment observation deterministically (build-team would have refused to ship without challenger spawns)
- Aligns spawn-time enforcement with the existing kb-citation-gate model (deterministic enforcement of a load-bearing kb pattern)

**Cons**:
- High false-positive risk: many engineering tasks are mechanical (config fix, doc update) where a challenger adds noise more than signal — and the bench audit shows the toolkit struggles to identify "trivial" vs "substantive" task complexity reliably
- Cost: every challenger spawn is ~2-3x the budget of the implementer spawn; mandating doubles substrate cost across the board
- Operator burnout: forcing a challenger on every trivial-fix prompt erodes operator trust in the substrate's judgement — they learn to bypass via `--no-challenger` for everything, defeating the discipline

### Option B — WARN-not-BLOCK at spawn-time (default-soft)

`/build-team` emits a stderr WARN at implementer-spawn time if no challenger is spawned, citing the asymmetric-challenger pattern + the empirical non-exercise observation. Does NOT block. Operator can pair-spawn manually.

**Pros**:
- Preserves observability (the load-bearing signal from FIX-I9: WARN-not-BLOCK avoids the false-positive cliff)
- Operator sees the discipline; no forced cost
- Cheap to implement (a `console.warn` in the spawn flow)

**Cons**:
- Empirically demonstrated insufficient — the v2.8.5 runs WITH this convention documented in `kb:agent-team/patterns/asymmetric-challenger` produced 0-2 challengers per 8-11 implementers
- Operators may not read the WARN if it's noisy in transcript context

### Option C — Tier-gated mandate

`/build-team` requires challenger pairing ONLY for tasks tagged as `audit` / `security` / `architecture` (the high-stakes complexity ranges). Engineering-task tier remains opt-in.

**Pros**:
- Matches the existing engineering-task vs audit-contract tier split in `swarm/personas-contracts/`
- Targets the highest-value enforcement (audit tier) without blanket cost
- Aligns with the substrate-philosophy "discipline costs paid at high-value boundaries"

**Cons**:
- Requires task-classification reliability (the substrate currently leans on persona selection — `06-ios-developer` vs `01-hacker` — which IS a tier signal but not deterministic enough for spawn-time blocking)
- Adds a config surface (`tier_requiring_challenger: [audit, security, architecture]`) that drifts over time

### Option D — Defer to v3.x; document as known-limitation

Acknowledge DEVIATION-003/006/007 as a load-bearing observation but defer the policy fix to v3.x. v2.9.0 ships ONLY the substrate that enables future deterministic enforcement (the agent-team doctor + format-spec + env-placeholder); the policy ride-along comes after another bench-cycle of empirical data.

**Pros**:
- Respects the "measure before mandating" discipline (v2.9.0 Phase A established this for counter integrity)
- Avoids shipping a policy that proves wrong against empirical data
- Keeps v2.9.0 scope tight

**Cons**:
- DEVIATION-003/006/007 persists for another release cycle; operators continue to scope-down despite the documented pattern
- The user-facing "biggest source of non-exercise" framing remains active

## Decision

**Option D — Defer to v3.x; document as known-limitation.**

v2.9.0 ships the *infrastructure* that future enforcement will use (agent-team doctor + asymmetric-challenger KB doc + spawn-conventions documentation), but does NOT introduce blocking behavior for the implementer-challenger pairing pattern in this release.

## Rationale

Three forces:

1. **Measure-before-mandate (v2.9.0 Phase A precedent)**: lior's CRITICAL-1 phase-ordering pushback for FIX-I3 was "measurement instrumentation MUST ship before counter-integrity warns so the noise floor is empirically verifiable." Same principle applies here: we have empirical signal from 4 runs that the discipline isn't followed, but we don't yet have evidence that BLOCKING fixes more problems than it creates. Ship the observability (sub-tag chronology, contract-verifier ergonomics) in v2.9.0; defer the mandate to v3.x after we run v2.9.0 against test3 + test4 with the new infrastructure in place.

2. **Test3 will tell us more**: the v2.9.0 substrate adds agent-team doctor + format-spec hint + env-placeholder. test3 (planned post-v2.9.0 ship) will exercise these against a complex PDF→tutorial scenario. The challenger-pairing rate in test3 — with the new infrastructure — provides the missing data point for the v3.x mandate decision.

3. **Option A's empirical case is weak**: the bench audit showed scope-down happens because the LLM mis-classifies task complexity, not because it's actively bypassing the convention. Mandating pairs would force pair-spawns on trivial-fix tasks (high false-positive cost) without addressing the actual classification gap. The right v3.x design is more likely "improve the route-decide heuristic + spawn-builder defaults" than "force a hard block."

## Action items

| Item | Owner | Phase |
|------|-------|-------|
| Document DEVIATION-003/006/007 + decision in this policy doc | (this turn) | v2.9.0 Phase E.2 |
| Add explicit "implementer-challenger non-exercise" call-out in spawn-conventions.md | NEXT (v2.9.1 or v3.x prep) | post-v2.9.0 |
| Re-measure challenger-spawn rate in test3 — make this an explicit success-criterion variable | test3 design | post-v2.9.0 ship |
| If test3 challenger-rate < 0.3, escalate decision: Option B (WARN) → Option C (tier-gate) → Option A (mandate) | v3.x design review | v3.x |
| If test3 challenger-rate ≥ 0.5 (the new infrastructure shifted behavior on its own), stop here — discipline self-corrected | v3.x design review | v3.x |

## Cross-references

- `kb:agent-team/patterns/asymmetric-challenger` — the canonical pattern doc; describes the convention without enforcement
- `bench/control-runs/v2.8.5-treatment/notes.md` line 25 — empirical anchor for this decision
- `swarm/run-state/v2.9.0-design/node-actor-architect-theo.md` — architect's v2.9.0 design review (which itself spawned 2 challengers as a load-bearing example)
- ADR-0007 — v2.9.0 minor-bump rationale (defers policy decisions to test3+v3.x)

## Status

**Decision: deferred to v3.x with explicit measurement plan.** This is documented + accepted. The deferral is itself a load-bearing decision (not a punt) — it's anchored on the measurement discipline established in Phase A.
