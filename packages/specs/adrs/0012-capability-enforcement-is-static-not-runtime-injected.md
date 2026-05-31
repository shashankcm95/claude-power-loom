---
adr_id: 0012
title: "Capability enforcement is static (agent.md frontmatter), not runtime-injected: updatedInput is inert on Agent spawns"
tier: technical
status: accepted
created: 2026-05-31
author: 04-architect + empirical probe (claude -p hook experiment) + user-gated re-scope
superseded_by: null
files_affected:
  - packages/kernel/hooks.json
  - packages/kernel/hooks/pre/pre-spawn-tool-mask.js
  - packages/kernel/enforcement/k6-subset-check.js
  - packages/runtime/orchestration/contracts-validate.js
  - packages/specs/plans/2026-05-31-phase-2-v3.1-runtime-foundation.md
  - docs/ROADMAP.md
invariants_introduced:
  - "A PreToolUse hook's `updatedInput` is INERT for the Agent/Task tool: the harness does not apply it to sub-agent spawns (empirically proven — neither `tools` nor `prompt` rewrites reach the sub-agent)."
  - "The Agent `tool_input` schema is {description, prompt, subagent_type, model} — there is NO `tools` field to narrow per-spawn."
  - "Sub-agent capability (tools) is determined by the STATIC agent definition (agent.md frontmatter `tools:` / --agents), which the harness DOES honor — not by per-spawn injection."
  - "v3.1 capability ENFORCEMENT = static agent.md frontmatter, validated build-time by the agent.md<->contract reconciliation validator (contracts-validate.js). K8 (runtime capability-injection at spawn-init) is DROPPED — its mechanism does not exist."
  - "pre-spawn-tool-mask is INERT (it rewrites a non-existent tool_input.tools via updatedInput) — UNREGISTERED from hooks.json; its 'enforce-not-document' claim is retracted. The network-tool restriction belongs in agent.md frontmatter + the reconciliation validator. [AMENDED 2026-05-31: static network-axis reconciliation is NOT viable (no tools: referent); the Bash-egress vector is audited at runtime instead — see Amendment.]"
related_adrs:
  - 0011
  - 0009
related_kb:
---

## Context

v3.1's plan (PR-2) specified **K8 — capability injection at spawn-init**: a `PreToolUse:Agent|Task` hook that rewrites the spawn's `tool_input` via `hookSpecificOutput.updatedInput` to (a) narrow the sub-agent's `tools` to the persona's declared capabilities and (b) inject a K3.b context envelope. The pre-existing **`pre-spawn-tool-mask`** hook (shipped v3.0-alpha, registered on the `Agent|Task` matcher) used the *same* mechanism to strip network-effecting tools — its own hooks.json comment claimed it "replaces honor-system persona-contract discipline" with real "Kernel-layer Pillar-2 ... enforcement."

Both rest on one premise: **that Claude Code applies a PreToolUse hook's `updatedInput` to Agent/Task (sub-agent) spawns.** The design+verify board for PR-2 flagged this as unconfirmed (FORK-1/OQ-21); a docs probe found the Agent `tool_input` schema has no `tools` field and that multiple `updatedInput` emitters wholesale-replace (last-writer-wins). The user elected to confirm empirically before building K8 (consistent with the OQ-21 spike-first decision).

## Decision

Two empirical probes (headless `claude -p` with a throwaway `PreToolUse:Agent` hook + a sub-agent doing observable work, captured raw `tool_input` + behavior) settled it:

| Probe | Result |
|---|---|
| Raw Agent `tool_input` keys | `{description, prompt, subagent_type}` — **no `tools` field** |
| `updatedInput.tools = ['Read']` honored? | **No** — the sub-agent kept Bash/Edit/Write/… and ran `echo` successfully |
| `updatedInput.prompt` (full replacement) honored? | **No** — the sub-agent ran the ORIGINAL prompt, not the hook's replacement |

**Conclusion: a PreToolUse hook's `updatedInput` is INERT for Agent/Task spawns.** This matches the official docs (Agent `tool_input` is `{prompt, description, subagent_type, model}`; sub-agent tools come from the agent definition, not a per-spawn field).

Therefore:

1. **Capability enforcement is STATIC.** A sub-agent's tools come from its **agent.md frontmatter `tools:`** (which the harness honors), validated build-time by the **agent.md↔contract reconciliation validator** (PR-2a, `contracts-validate.js`). That is the real, working enforcement.
2. **K8 is DROPPED.** A runtime capability-injection hook would be enforcement-theater — the mechanism does not exist.
3. **`pre-spawn-tool-mask` is UNREGISTERED** (removed from hooks.json). It has been inert since it shipped (it rewrites a non-existent `tool_input.tools`); leaving it running gives false assurance. The file is retained but marked inert, pending a follow-up deletion. The network-tool restriction it intended belongs in agent.md frontmatter (don't grant `WebFetch`/`WebSearch`/`mcp__*` to personas that shouldn't have them) + the reconciliation validator. [AMENDED 2026-05-31 — RETRACTED: binding the network axis is not viable (no tools: referent); the Bash-egress vector is audited at runtime by network-egress-audit.js instead. See Amendment.]
4. **K6 + K3.b `buildEnvelope` ship as dormant primitives** (PR-2a). K6 backs the reconciliation set-math; `buildEnvelope`'s per-spawn delivery channel does not exist (no `updatedInput` injection), so any context delivery must come from the static agent definition or a future, empirically-confirmed mechanism.

## Consequences

- v3.1's "spawn-init capability injection" pillar collapses into "**static agent.md frontmatter + build-time validation**" — simpler and honest. R1–R4 (persona contracts + traits, PR-1) and K6 + the reconciliation validator (PR-2a) remain the load-bearing capability layer.
- **Broader flag:** any substrate assumption that a PreToolUse hook can intercept/rewrite sub-agent *input* per-spawn is now suspect. The v3.0-alpha "K2 tool-mask enforcement" claim was never true. Other per-spawn-injection assumptions need the same empirical scrutiny before being relied upon.
- The agent.md frontmatter becomes the single source of capability truth; the reconciliation validator is the gate keeping it consistent with the contract. Extending that validator to the network axis closes the network-restriction gap tool-mask falsely claimed to cover. **[AMENDED 2026-05-31 — RETRACTED; see Amendment below.]**
- Two `claude -p` probe captures are the preserved empirical basis for this decision.

## Amendment (2026-05-31) — network-axis reconciliation retracted; Bash-egress audited

The original frontmatter invariant, Decision §3, and the final Consequence above stated
that **extending the reconciliation validator to bind the network axis** is a follow-up that
"closes the network-restriction gap." A later same-session audit **retracted** that claim:

- **Static reconciliation of a `network` axis is not viable.** `network` is not a Claude Code
  tool, so `agents/<name>.md` `tools:` carries no referent for the validator to bind to.
  `contracts-validate.js` (the shipped validator) documents this as correct-by-design
  ("DELIBERATELY un-reconciled … not a missing edge").
- **The network axis decomposes into two vectors, handled separately:**
  - *Tool-mediated* egress (`WebFetch` / `WebSearch` / MCP) — already enforced by the harness
    via `tools:` (don't grant the tool → no egress through it).
  - *Bash-subprocess* egress (`curl` / `wget` / `nc`) — now **audited** (advisory, on
    `PostToolUse:Bash`) by `packages/kernel/observability/network-egress-audit.js`.
- **Real egress *prevention*** (vs detection) is ContainerAdapter-tier (network namespace /
  egress policy), deliberately deferred.

So "the reconciliation validator does not cover network" is **correct AND complete**, not a
pending gap. The core decision of this ADR (`updatedInput` inert on Agent spawns → capability
enforcement is static; K8 dropped) is **unchanged**. See
`packages/specs/plans/2026-05-31-network-egress-audit.md`.
