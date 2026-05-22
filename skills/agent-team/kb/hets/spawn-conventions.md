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
identity: "{persona}.{name}~{contentHash}"
task: ...
---
```

**YAML quoting requirement (v2.9.0 FIX-I2)**: the `identity` scalar MUST be
double-quoted. SynthId suffixes contain `~` (e.g. `04-architect.theo~f8bf4854`),
which is the YAML 1.2 null literal marker — an unquoted scalar with a leading
`~` is parsed as null by spec-compliant parsers. Always quote.

If a legacy report has unquoted `identity:` and the suffix appears to have
been dropped, `contract-verifier.js` falls back to `_extractIdentityFromRaw`
(see `_lib/frontmatter.js`) which extracts the raw scalar bypassing YAML
semantics. The drift-note logs to stderr but does NOT fail the verdict.

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

### Capability-gap signal (H.6.5)

When a sub-agent (architect, builder, auditor) identifies a missing toolkit capability — a missing persona, skill, KB doc, stack-skill-map entry — it does NOT write the file itself. It returns a structured `request` in its `## Notes` section. Root reads the request and acquires the missing capability using its full toolkit context (Edit/Write tools, /forge skill, kb-resolver register, etc.).

Schema (one or more requests per spawn return):

```yaml
## Notes — Capability requests

- request:
    type: forge-persona | forge-skill | author-kb-doc | extend-stack-map
    scope: <human-readable description>
    proposed_name: <hint; root may override>      # for forge-persona / forge-skill
    rationale: <why this gap matters>
    related_skills: [...]                          # for forge-persona / forge-skill
    related_kb_scope: [...]                        # for forge-persona / author-kb-doc
    suggested_files:                               # for author-kb-doc
      - path: skills/agent-team/kb/<domain>/<name>.md
        purpose: <one line>
```

The sub-agent MUST NOT:
- Write any persona / contract / KB / stack-map files
- Edit `agent-identity.js` rosters or the live `~/.claude/agent-identities.json`
- Make file-level decisions about layout, naming, schema

The sub-agent MUST:
- Cite the source where the gap was identified (file:line in the contract / stack-map / persona that reveals the gap)
- Provide a precise proposal that root could act on
- Mark the task as `blocked-on-capability-gap` if the missing capability is load-bearing for the task

See `patterns/missing-capability-signal.md` for the full pattern + failure modes + user-gate flow.
