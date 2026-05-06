---
pattern: trust-tiered-verification
status: active+enforced
intent: Verification depth scales inversely with measured per-identity trust score.
related: [agent-identity-reputation, asymmetric-challenger, hets, prompt-distillation]
---

## Summary

High-trust identity → spot-check + verifier only (1× cost). Medium-trust → asymmetric pair (1.3–1.5×). Low-trust → symmetric pair OR challenger (2×). Top-of-tree (super-root, CRITICAL claims) → symmetric pair regardless of trust. Trust scored per [identity](agent-identity-reputation.md), not per persona class.

## Intent

A verification system that runs the same depth of checks on every output wastes budget on already-trusted contributors and under-verifies risky ones. Tiering by measured trust concentrates verification cost where it produces signal.

## Components

- **Trust source** — `~/.claude/agent-identities.json` records per-identity verdict history. Tier formula: `passRate >= 0.8 AND totalRuns >= 5` → high; `>= 0.5` → medium; otherwise low. Identities below 5 runs are "unproven" → treated as low-trust regardless of pass rate.
- **Tier policy table** — encoded in spawn-prompt builder; not hardcoded in actors. Lets the policy evolve without touching personas.
- **Override** — any CRITICAL claim escalates that finding to symmetric pairing regardless of identity trust.

## Failure Modes

1. **Cold start** — fresh identities have no history; treating them as low-trust is correct but expensive until ~5 runs accumulate. Cost: ~10 chaos runs of paying 2× across the board.
2. **Trust gaming** — an identity could optimize for verifier checks rather than actual quality. Counter: convergence-as-signal across different personas catches output that passes checks but contradicts reality.
3. **Trust decay** — old identities with stale track records could be over-trusted. Counter: weight recent runs higher (exponential decay over runs, not calendar time).
4. **Tier flip-flop** — identity oscillates between medium/low if pass rate hovers near 0.5. Counter: hysteresis (different threshold for promotion vs demotion).

## Validation Strategy

Stress-test scenarios:
- Inject a deliberately-bad output from a high-trust identity. Does the system catch it via the post-hoc verifier (the only check at high-trust tier), or does the spot-check let it through?
- Spawn a fresh (zero-history) identity. Verify it's treated as low-trust and gets a challenger.
- Promote an identity to high-trust over 5 runs, then start producing low-quality output. Measure how many runs of bad output occur before the tier demotes.
- Run with `--no-tiering` flag (every identity treated as low-trust) and compare findings count vs run with tiering. Measure: how many real bugs did tiering miss in exchange for cost savings?

## When to Use

- Steady-state operation after `agent-identities.json` has ≥20 runs of history per persona
- Any time chaos-test cost or wall-clock is becoming a constraint

## When Not to Use

- First ~10 runs of a new HETS deployment (no history; tiering provides no benefit)
- Any run where the goal is **finding maximum bugs** rather than steady-state validation — turn off tiering, accept the 2× cost

## Enforcement callsite

The policy table at `agent-identity.js:419-457` (`VERIFICATION_POLICY`) is consumed by `commands/build-team.md` Step 7. Step 7 branches on the `verification` field returned by `recommend-verification --identity X`, dispatching to one of three flows: high-trust spot-check (with `--skip-checks`), medium-trust asymmetric (1 challenger via `assign-challenger`), or low-trust/unproven symmetric pair (2 challengers via `assign-pair`). See `commands/build-team.md` Step 7 for the literal shell flow.

## Related Patterns

- [Agent Identity & Reputation](agent-identity-reputation.md) — provides the per-identity trust source this pattern reads
- [Asymmetric Challenger](asymmetric-challenger.md) — what gets deployed at medium-trust
- [Convergence-as-Signal](convergence-as-signal.md) — the cross-check that catches trust-gaming
