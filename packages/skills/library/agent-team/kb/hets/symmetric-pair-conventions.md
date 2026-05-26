---
kb_id: hets/symmetric-pair-conventions
version: 1
tags: [hets, symmetric-pair, low-trust, conventions]
---

## Summary

Symmetric pair = TWO challengers spawned alongside (or after) the implementer, each redoing the implementer's task with their own framing. Used for low-trust / unproven identities OR top-of-tree (super-root) per asymmetric-challenger pattern's "When Not to Use." Cost: ~3× (1 implementer + 2 redos). Compare outputs for [convergence-as-signal](../patterns/convergence-as-signal.md) — convergent findings = high confidence.

## Full content

### When to spawn a symmetric pair

Per `agent-identity recommend-verification`:
- `tier == low-trust` → policy returns `verification: symmetric-pair`, `challengerCount: 2`
- `tier == unproven` (under 5 runs) → same as low-trust per pattern doc
- Top-of-tree (super-root, CRITICAL-claim arbitration) → always symmetric regardless of trust

For everything else (high-trust spot-check, medium-trust asymmetric challenger), see `kb:hets/challenger-conventions`.

### Spawn flow

```bash
# 1. Pick TWO challenger identities (different persona preferred for both)
CH1=$(node ~/Documents/claude-toolkit/scripts/agent-team/agent-identity.js \
  assign-challenger --exclude-persona $IMPL_PERSONA --task "$RUN_ID" | jq -r .challenger.identity)
CH2=$(node ~/Documents/claude-toolkit/scripts/agent-team/agent-identity.js \
  assign-challenger --exclude-persona $IMPL_PERSONA --exclude-identity $CH1 --task "$RUN_ID" | jq -r .challenger.identity)
# Note: --exclude-identity prevents picking the same challenger twice

# 2. Spawn both with the implementer's TASK as input (not just output)
#    Each runs the persona's normal contract (NOT challenger.contract.json)
#    because they're redoing the work, not critiquing
```

### Critical difference from asymmetric challenger

| Aspect | Asymmetric challenger | Symmetric pair |
|--------|----------------------|----------------|
| Input | Implementer's OUTPUT | Implementer's TASK |
| Contract | `challenger.contract.json` (~10K) | Persona's normal contract (~35K) |
| Cost | ~1.3-1.5× | ~3× |
| Catches | Plausible-but-wrong reasoning | Implementer's blind spots (challenger doesn't see them) |
| Output | `### CHALLENGE-N` headings | Normal severity-tagged findings |
| Comparison | Direct disagreement | Convergence analysis (synthesizer compares all 3 outputs) |

### Convergence comparison

The synthesizer (orchestrator or super-agent) takes all 3 outputs and applies the convergence-as-signal pattern:
- Same finding by ≥2 different-persona identities = high-confidence
- Finding by only one identity = lower-confidence (recheck or escalate)
- Findings that diverge = potential disagreement (escalate to human review)

See `patterns/convergence-as-signal.md` for the formal signal definition.

### Failure modes

- **Cost shock**: 3× implementer cost + comparison overhead. Don't apply blanket — only when tier policy says low-trust/unproven OR for high-stakes claims at the top of the tree.
- **Roster exhaustion**: 2 challengers + 1 implementer = 3 distinct identities needed from a roster of 3 default names. Larger rosters help; for now, this is fine but worth monitoring.
- **Blind-spot collapse**: if all 3 spawned identities share a common blind spot (e.g., all ML personas miss a security implication), convergence is misleading. Mitigation: prefer different-FAMILY identities (auditor + builder mix) when stakes are high.

### Open question for H.2.5+

The current `assign-challenger` returns ONE identity. To spawn a symmetric pair cleanly, we call it twice with `--exclude-identity` to prevent collision. A future `assign-pair --exclude-persona X --count N` subcommand could clean this up. Logged in BACKLOG.
