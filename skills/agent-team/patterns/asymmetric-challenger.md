---
pattern: asymmetric-challenger
status: implementing
intent: Critic reads implementer's output and surfaces ≥1 substantive disagreement.
related: [hets, trust-tiered-verification, convergence-as-signal]
---

## Summary

A second agent (the **challenger**) does not redo the implementer's task. It receives the implementer's output as input and must surface at least one substantive disagreement. Cost ~1.3–1.5× vs ~2× for symmetric pairing. Catches: plausible-but-wrong reasoning, evidence gaps, unjustified scope. Misses: blind spots the implementer never considered.

## Intent

Most output bugs are visible *in the output itself* — wrong file:line citations, weak evidence chains, severity misclassification, missed cases obvious in retrospect. A second agent reading the output (rather than re-attempting the task) catches these at low marginal cost.

## Components

- **Implementer contract** — produces the output (today's persona contract, unchanged).
- **Challenger contract** — much shorter. Required: produce ≥1 disagreement with `### CHALLENGE-N` heading, citing exact text from the implementer's output and stating why it is wrong/incomplete/unjustified.
- **Spawn pairing** — super-agent or orchestrator spawns implementer first; on completion, spawns challenger with implementer's output as context.
- **Verifier check** — `noEmptyChallengeSection`: challenger must produce ≥1 finding, not "looks fine."

## Failure Modes

1. **Inherited blind spots** — challenger only sees what the implementer wrote, so any issue the implementer never considered is invisible. (E.g., if implementer never thought to check prototype pollution, challenger reading the output won't either.)
2. **Capitulation drift** — challenger trained to defer to upstream output may produce nominal disagreements ("could be clearer") instead of substantive ones. Verifier check `noPaddingPhrases` should be tightened for challenger outputs.
3. **Scope explosion** — challenger raises so many minor disagreements the parent agent ignores them all. Cap challenger output to ≤5 disagreements.

## Validation Strategy

Stress-test scenarios for a future chaos run targeting this pattern:
- Spawn implementer with a deliberately-wrong claim (planted regression). Did challenger catch it?
- Spawn implementer with a correct but unevidenced claim. Did challenger demand evidence?
- Spawn challenger against a deliberately-perfect implementer output. Did challenger fabricate disagreement, or correctly say "no substantive issue + here's why I confirmed each claim"?
- Spawn challenger of same persona class as implementer. Compare findings count vs different-persona challenger — measure shared-blind-spot overhead.

## When to Use

- Leaf actors with low-trust identity (per [Trust-Tiered Verification Depth](trust-tiered-verification.md))
- After any spawn where the contract verifier returned `partial` (not full fail, not full pass)
- Any time the implementer's task touched novel surface (new persona, new contract, new file area)

## When Not to Use

- Top of tree (super-root, final reports) — symmetric pairing pays for itself there
- High-trust identity on routine task (current verifier coverage is sufficient)
- Tasks where convergence-across-different-personas is already happening (free signal)

## Related Patterns

- [Convergence-as-Signal](convergence-as-signal.md) — emergent version of this pattern when different personas attack the same surface
- [Trust-Tiered Verification Depth](trust-tiered-verification.md) — decides *when* to deploy a challenger
- [HETS](../SKILL.md) — the substrate this runs inside
