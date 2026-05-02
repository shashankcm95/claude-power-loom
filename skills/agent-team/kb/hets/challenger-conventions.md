---
kb_id: hets/challenger-conventions
version: 1
tags: [hets, challenger, asymmetric, conventions]
---

## Summary

A challenger is an agent spawned AFTER the implementer with the implementer's output as input. Challenger does NOT redo the implementer's task; it surfaces ≥1 substantive disagreement. Use `agent-identity assign-challenger --exclude-persona <implementer-persona>` to pick a DIFFERENT persona (avoids shared blind spots). Use the shared `challenger.contract.json` (~10K token budget vs 35K for implementers). Output uses `### CHALLENGE-N` headings; `noEmptyChallengeSection` check enforces ≥1 challenge.

## Full content

### Spawn flow

```bash
# 1. Implementer completes
IMPL_IDENTITY="07-java-backend.sasha"
IMPL_OUTPUT="$RUN_DIR/node-actor-java-backend-sasha.md"

# 2. Pick challenger (different persona preferred)
CHALLENGER=$(node ~/Documents/claude-toolkit/scripts/agent-team/agent-identity.js \
  assign-challenger \
  --exclude-persona 07-java-backend \
  --exclude-identity $IMPL_IDENTITY \
  --task "challenge-${IMPL_IDENTITY}" | jq -r .challenger.identity)
# e.g., CHALLENGER="04-architect.theo"

# 3. Track in tree
node ~/Documents/claude-toolkit/scripts/agent-team/tree-tracker.js spawn \
  --run-id $RUN_ID \
  --parent $IMPL_IDENTITY \
  --child "challenger-${CHALLENGER//./-}-vs-${IMPL_IDENTITY//./-}" \
  --task "challenge implementer output" \
  --role challenger

# 4. Spawn the Agent with:
#    - Path to implementer's output (challenger reads it)
#    - challenger.contract.json (NOT the persona's normal contract)
#    - Identity: $CHALLENGER
#    - Frontmatter must include: challenges_implementer: $IMPL_IDENTITY
```

### Challenger output format

```markdown
---
id: challenger-{challenger-identity-flat}-vs-{implementer-identity-flat}
role: challenger
depth: <implementer.depth + 1>
parent: <implementer-identity>
persona: <challenger-persona>
identity: <challenger-identity>
challenges_implementer: <implementer-identity>
task: <task summary>
---

# Challenge Report — {challenger-name} vs {implementer-name}

## Implementer output reviewed
- File: `node-actor-{persona}-{name}.md`
- Identity: {implementer-identity}
- Verdict (per their own contract): {pass|partial|fail}

## Challenges

### CHALLENGE-1 — {one-line summary}
**Implementer claim** (quoted): "{exact text from their output}"
**Why I disagree**: {substantive reasoning, citing file:line or kb:doc evidence}
**Recommended action**: {accept-with-caveat | reject | demand-revision}

### CHALLENGE-2 — {if any}
[same shape]

## Verified claims (optional but useful)
[List of implementer claims you independently verified, with evidence]

## Notes
[Anything the parent agent should know — was challenger restricted, did the implementer's KB scope match, etc.]
```

### Different-persona preference (and the fallback)

`assign-challenger` picks from a pool of identities EXCLUDING the implementer's persona by default. If no different-persona identities are available (e.g., only one persona exists in rosters), falls back to same-persona-different-identity. The `poolType` field in the assign output tells you which path was taken — `different-persona` is preferred; `same-persona-different-identity` is acceptable but inherits more blind spots.

### Verifier

```bash
node ~/Documents/claude-toolkit/scripts/agent-team/contract-verifier.js \
  --contract ~/Documents/claude-toolkit/swarm/personas-contracts/challenger.contract.json \
  --output $CHALLENGER_OUTPUT \
  --identity $CHALLENGER
```

Key checks (per `challenger.contract.json`):
- F1-F2: frontmatter + `challenges_implementer` field
- F3: `noEmptyChallengeSection` (≥1 `### CHALLENGE-N` heading)
- F4: outputLengthMin 400 (challenger doesn't need to be long, but must be substantive)
- A1: `noPaddingPhrases` with stricter list (`looks fine`, `no issues found`, `I agree with everything`, `minor nit`, `could be clearer`, `nothing to add`) — defends against the "capitulation drift" failure mode in the asymmetric-challenger pattern doc

### When to spawn a challenger

Per H.2.4 (trust-tiered verification, planned):
- High-trust implementer (≥0.8 pass rate, ≥5 runs) → no challenger
- Medium-trust → asymmetric challenger (this doc)
- Low-trust → symmetric pair (planned in H.2.4)

For now, before H.2.4 ships: spawn a challenger any time you'd want a second pair of eyes — particularly for novel surface, high-stakes claims, or when the implementer's verifier verdict was `partial`.

### Failure modes (what to watch for)

- **Inherited blind spots**: challenger only sees what implementer wrote; an issue the implementer never considered remains invisible. Different-persona preference partially mitigates.
- **Capitulation drift**: challenger defers + produces nominal disagreements. `noPaddingPhrases` (with stricter list) catches the lazy version.
- **Scope explosion**: challenger raises 20 minor disagreements that drown out the real ones. Cap challenger output to ≤5 challenges (informally enforced via `outputLengthMax: 8000`).

See `patterns/asymmetric-challenger.md` for the full design context.
