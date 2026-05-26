---
pattern: missing-capability-signal
status: active
intent: When a sub-agent identifies a missing toolkit capability (persona, skill, KB doc, stack-map entry), it returns a structured request to root rather than trying to author files itself. Root holds full toolkit context + tools to acquire on demand.
related: [skill-bootstrapping, tech-stack-analyzer, persona-skills-mapping, hets]
---

## Summary

Sub-agents (architect, builders, auditors) that diagnose a missing capability **MUST NOT write toolkit-substrate files themselves**. They emit a structured `request` field in their return value; root (the chat orchestrator) reads the request and acquires the missing capability using its full toolkit context — invoking `/forge`, authoring persona/contract/KB files via Edit, updating rosters + stack-map, etc. Root is the only place where toolkit-substrate-extension actually happens.

## Intent

The toolkit's deeper goal isn't "ship a plugin." It's **autonomous agent platform that adapts to any host environment**. Achieving that requires the orchestrator to be able to grow its own substrate (new personas, skills, KB docs, stack-map entries) on demand, gated by user approval.

But the work has to happen in the **right place**. Sub-agents have focused, narrow context (the task at hand + persona contract). Root has full toolkit context (every persona, every skill, every prior decision, every config edit). When a missing capability is identified, **root is the only place where the acquisition work can be done well + cheaply**.

The rule: **sub-agents diagnose; root acquires**.

## Why this rule matters

| Where authoring happens | Token cost | Quality | UX |
|------|-------|---------|-----|
| Inline in main chat (current default; no convention) | low | variable; depends on context-juggling | "Claude figured it out" — invisible to user |
| **Sub-agent forges files itself** | high (~25-35K tokens) | low (sub-agent lacks toolkit context) | sub-agent does work it's not equipped for |
| **Sub-agent diagnoses + root acquires (THIS PATTERN)** | low (~5K diagnosis tokens) | high (root has full context) | structured handoff; reviewable |

The asymmetric cost-quality trade is real: file authoring is cheap when you have full context (root) and expensive + low-quality when you don't (sub-agent). Skill-forge works because skills are small, focused artifacts; persona/contract/KB files are larger + need broader context.

## Components

### Sub-agent side: emit a structured `request`

When a sub-agent's task hits a substrate gap (no fitting persona, missing skill, missing KB doc, etc.), it appends a `request` object to its return value:

```jsonc
{
  "task_status": "blocked-on-capability-gap",
  "diagnosis": "Express/Node task hit no fitting persona; closest match 07-java-backend has JVM-only contract",
  "request": {
    "type": "forge-persona",            // forge-persona | forge-skill | author-kb-doc | extend-stack-map
    "scope": "Node backend developer for Express/NestJS work",
    "proposed_name": "13-node-backend",  // hint; root may override
    "required_skills": ["node-backend-development", "express"],
    "kb_scope_proposal": [
      "kb:backend-dev/node-runtime-basics",
      "kb:backend-dev/express-essentials"
    ],
    "rationale": "Async-first, single-threaded event loop, JS/TS ecosystem; warrants its own persona vs cross-domain routing"
  }
}
```

The sub-agent does NOT:
- Write any persona/contract/KB files
- Edit rosters or stack-map
- Make file-level decisions about layout, naming, schema

It DOES:
- Identify the gap precisely (cite source contracts/KB docs)
- Propose a name + skill list + scope (hints, not commitments)
- Provide rationale (so root can evaluate the request)

### Root side: receive + acquire

Root reads the sub-agent return, sees `request.type`, and dispatches to the right acquisition path:

| Request type | Root's tools | Optional sub-agent? |
|--------------|--------------|---------------------|
| `forge-skill` | `/forge` skill (existing); user-gate | Yes — skill-forge can use sub-agent for drafting (small artifact) |
| `forge-persona` | Direct file authoring via Edit/Write; updates `agent-identity.js` rosters + live `agent-identities.json` + stack-skill-map | **No** — root authors directly (full context > sub-agent's narrow scope) |
| `author-kb-doc` | Direct authoring via Write; `kb-resolver scan` to register | No — root authors directly |
| `extend-stack-map` | Edit `kb:hets/stack-skill-map` | No — root edits directly |

Root may surface the request to the user before acting (per the user-gate convention from skill-bootstrapping) but the **execution** stays at root.

### User-gate convention

For all request types, the user is the trust boundary. Root surfaces the request as a single batched approval:

```
> Architect identified a capability gap during your task.
>
>   Request: forge-persona
>   Scope: Node backend developer for Express/NestJS
>   Files this would create:
>     - swarm/personas/13-node-backend.md
>     - swarm/personas-contracts/13-node-backend.contract.json
>     - skills/agent-team/kb/backend-dev/node-runtime-basics.md
>     - skills/agent-team/kb/backend-dev/express-essentials.md
>   Files this would update:
>     - scripts/agent-team/agent-identity.js (DEFAULT_ROSTERS)
>     - ~/.claude/agent-identities.json (live store rosters)
>     - skills/agent-team/kb/hets/stack-skill-map.md
>
> Approve? [y/n/cancel]
```

Same shape as skill-bootstrapping. User decides; root executes.

## Failure modes

1. **Sub-agent ignores convention + writes files anyway** — caught by post-task review (Edit history) AND by contract-verifier if the sub-agent's output references files the contract says it shouldn't touch. Counter: the convention is in the spawn prompt; future automation could lint the sub-agent's tool-use record for unauthorized writes.
2. **Vague diagnosis** — sub-agent returns a request with insufficient detail (missing rationale, no proposed name, no scope). Counter: `request` schema is part of `kb:hets/spawn-conventions`; sub-agents are expected to populate all fields.
3. **Root doesn't notice the request** — this becomes a no-op; the missing capability stays missing. Counter: root's task-completion checklist should always scan return values for `request` fields. (The build-team workflow doc enforces this.)
4. **Same capability requested repeatedly** — sub-agent doesn't know prior runs already requested the same thing. Counter: root maintains the singleton view of the substrate; if a recent request matches a known pending one, root deduplicates.
5. **User gate fatigue** — every chaos run pauses for capability requests. Counter: per-session "approve all instances of forge for stack X" preference (opt-in only); same shape as skill-bootstrapping's mitigation.

## Validation strategy

Stress-test scenarios:
- Spawn architect on an Express task (the H.6.1 case). Verify it returns `request: forge-persona`; verify root authors the persona + admits it.
- Spawn 12-security-engineer with a `not-yet-authored` required skill. Verify the existing `forgeNeeded` flow (H.6.3) and the new request flow (H.6.5) compose cleanly — i.e., the sub-agent surfaces the gap via `forgeNeeded` AND can return a `request: forge-skill` for the same skill, both pointing at the same artifact.
- Spawn architect on a stack with no map entry (e.g., Rust). Verify it returns `request: extend-stack-map` AND `request: forge-persona` (chained).
- Inject a sub-agent that violates the convention (writes files directly). Verify post-task review catches the violation.
- Test user-gate: deny a forge-persona request; verify root falls back to closest-fit + records the rejection in the run.

## When to use

- All sub-agent spawns (architect, builders, auditors) — this is the default convention going forward
- Tech-stack-analyzer when no stack matches — emit `request: extend-stack-map` instead of falling back silently
- Any time a contract field references something not-yet-existing

## When NOT to use

- The sub-agent IS the persona-forge / skill-forge sub-agent (those run with explicit authoring authority — they're the exception that proves the rule)
- Inline chat where root is the only agent (no sub-agent role split applies)

## Related patterns

- [Skill Bootstrapping](skill-bootstrapping.md) — the user-gate flow this pattern extends to all capability types (was previously skill-only)
- [Tech-Stack Analyzer](tech-stack-analyzer.md) — should emit `request: extend-stack-map` when no match found
- [Persona-Skills Mapping](persona-skills-mapping.md) — what gets requested via `forge-persona`
- [HETS](../SKILL.md) — the substrate that this pattern keeps growing
