---
kb_id: hets/spawn-conventions
version: 1
tags: [hets, conventions, spawn]
---

## Summary

To spawn an actor in a HETS run: (1) `agent-identity assign --persona NN-name --task chaos-{run-id}` → returns `persona.name`; (2) `tree-tracker spawn --child actor-{persona}-{name}`; (3) launch Agent with persona file + contract + skills block (names only) + identity in frontmatter; (4) write to `node-actor-{persona}-{name}.md`; (5) on completion, `contract-verifier --identity {persona}.{name}` validates AND records to both `agent-patterns.json` (per-persona) and `agent-identities.json` (per-identity).

## Full content

### The five-step spawn convention

Every HETS actor spawn follows the same sequence. Skipping a step means the audit trail or the trust accumulation is incomplete.

#### 1. Assign identity

```bash
IDENTITY=$(node ~/Documents/claude-toolkit/scripts/agent-team/agent-identity.js assign \
  --persona ${PERSONA} --task chaos-${RUN_ID} | jq -r .identity)
# IDENTITY is "persona.name", e.g., "04-architect.mira"
```

Round-robin assignment from the persona's roster. The roster lives in `~/.claude/agent-identities.json` under `rosters[<persona>]`.

#### 2. Track in spawn tree

```bash
node ~/Documents/claude-toolkit/scripts/agent-team/tree-tracker.js spawn \
  --run-id $RUN_ID \
  --parent super-root \
  --child "actor-${PERSONA_NAME}-${IDENTITY##*.}" \
  --task "..." \
  --role actor
```

The child id pattern is `actor-{persona-name}-{identity-name}`, e.g., `actor-architect-mira`.

#### 3. Spawn the Agent

Spawn prompt MUST include:
- The persona file path (or content if path resolution unavailable)
- The contract file path
- A **skills block** listing `skills.required` + `skills.recommended` from the contract by **name only** — actor invokes `Skill` tool to load on demand. See `kb:hets/spawn-conventions` (this doc) for the full convention.
- The actor's frontmatter, including `identity: {full-identity-string}` so the verifier auto-records per-identity

#### 4. Actor writes output

The actor writes to:
```
~/Documents/claude-toolkit/swarm/run-state/${RUN_ID}/node-actor-${PERSONA_NAME}-${IDENTITY##*.}.md
```

with frontmatter:
```yaml
---
id: actor-{persona-name}-{identity-name}
role: actor
depth: 1
parent: super-root
persona: {NN-name}
identity: {persona}.{name}
task: ...
---
```

#### 5. Verify and record

```bash
node ~/Documents/claude-toolkit/scripts/agent-team/contract-verifier.js \
  --contract ~/Documents/claude-toolkit/swarm/personas-contracts/${PERSONA_NAME}.contract.json \
  --output ${OUTPUT_PATH} \
  --previous-run ${PRIOR_RUN_PATH} \
  --identity ${IDENTITY}
```

Identity flows automatically to:
- `~/.claude/agent-patterns.json` (per-persona aggregate)
- `~/.claude/agent-identities.json` (per-identity track record)

### Path-resolution caveat

Always invoke from `~/Documents/claude-toolkit/scripts/agent-team/...`, NOT `~/.claude/scripts/agent-team/...`. The `tree-tracker.js` resolves `tree.json` relative to its own directory; the two install locations write to different `swarm/run-state/` trees, leading to "Node not found" errors when `spawn` and `complete` are called from different copies. Filed for proper fix in H.2.

### Identity rosters

See `kb:hets/identity-roster` for the canonical roster per persona.

### Challenger spawns (H.2.3)

After an implementer completes, the parent MAY spawn a challenger to surface disagreements. Challenger uses a different convention (different identity-pick policy, different contract, different output shape). See `kb:hets/challenger-conventions` for the full flow.
