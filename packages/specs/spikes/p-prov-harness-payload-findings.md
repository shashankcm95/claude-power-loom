# P-PROV — Harness Spawn-Payload Provenance Empirical Findings

**Probe**: For the provenance layer, three load-bearing questions about the harness
`Agent|Task` spawn lifecycle: (OQ#1) is `tool_use_id` present **and stable** across a spawn's
`PreToolUse` init and `PostToolUse` close — a usable init↔close correlation key? (OQ#2) does
the hook payload carry **any** parent/nesting field (`parent_tool_use_id`/`depth`/`isSidechain`)?
(OQ#3) does the harness **nest** Agent/Task spawns at all (agent-spawns-agent)?
**Date**: 2026-06-01
**Resolves**: the provenance-layer design's three load-bearing probes (OQ#1/OQ#2/OQ#3) — the
gates on whether genesis-vs-nested is observable and whether safe auto-merge-to-HEAD is
harness-blocked or buildable.
**Verdict**: **OQ#1 = YES (empirical)** · **OQ#2 = NO in the hook payload** (present only on
transcript/SDK messages, reachable via `transcript_path`) · **OQ#3 = NO — nesting is impossible
(documented 4×, structurally enforced, empirically confirmed)**. Net: **the design's #1
auto-merge blocker ("can't reliably detect nested spawns") DISSOLVES** — every observed spawn is
genesis-from-main by construction. Safe auto-merge-to-HEAD is **gated on buildable kernel work
(a HEAD-anchor invariant + a close-time sibling-concurrency lock), NOT on a harness-capability
floor.** Quarantine remains the *current* ceiling only until that kernel work ships.
**Evidence**: `packages/specs/spikes/p-prov-harness-payload-capture.jsonl` (raw headless hook
payloads, verbatim) + official docs (cited inline) + GitHub issues #40140 / #32175 / #14859.

---

## TL;DR

The provenance-layer design (HETS-verified by architect + code-reviewer + honesty, all APPROVE)
concluded `auto-merge-not-yet-safe` with the **primary** blocker being *"reliable nested-detection
— blocked at the substrate floor: the harness payload carries no `parent_tool_use_id`/`depth`."*
The USER chose **"harness probe first"** before any build. The probe falsifies that blocker's
**premise**:

- **Nested sub-agents cannot exist.** Official docs state it four times ("subagents cannot spawn
  other subagents"); the `Agent` tool is on the hard exclusion list for subagents; empirically my
  spawned subagent made **0** Agent tool-calls. So there is **no nested spawn to mis-detect** —
  every `PostToolUse:Agent|Task` close the kernel observes is a **direct child of main = genesis**.
  Hardcoding `is_genesis_position: true` is therefore **correct** for the spawn-tree sense.
- **`tool_use_id` is present AND stable across init↔close** — both the `PreToolUse:Agent` and
  `PostToolUse:Agent` payloads carry the *same* `"toolu_01SQnhuTZu5cDghemv4fRuMn"`. The design's
  load-bearing OQ#1 (the Tier-1 correlation gate) is an empirical **YES**, settling a direct
  contradiction in the docs (the official `/en/hooks` example *omits* `tool_use_id`; the real
  payload *carries* it).
- **No parent/nesting field is in the hook payload** (confirms the docs + GH#40140). The parent
  reference (`parent_tool_use_id`, `isSidechain`) lives only on **transcript/SDK messages**,
  reachable via the `transcript_path` the payload *does* carry — but it is moot, since nesting
  cannot occur.

**The honest revision:** the four safe-auto-merge preconditions the design listed — (1) reliable
nested-detection, (2) a HEAD-anchor invariant, (3) a close-time merge lock, (4) R10 evidence-ref
content verification — reduce to **#1 DISSOLVED** (no nesting) and **#2/#3/#4 = buildable kernel
work with no harness gap**. Auto-merge is **not** permanently harness-blocked; it is gated on the
hardest-but-buildable piece, **sibling-concurrency-safe merge into a moving HEAD**.

**Meta (codify-candidate):** the design *and all three verification lenses* APPROVED the
"harness-blocked" conclusion — but they verified the design's internal logic against the **code**,
never probing the **harness nesting premise** against reality. The recon *assumed* nesting and
asked "can we detect it?"; the premise was false. This is the ADR-0012 lesson recurring:
**multi-reviewer blessing is not runtime/harness verification — empirically probe an assumed
harness capability (or impossibility) before building (or deferring) on it.**

---

## Method

Per the ADR-0012 discipline ("empirically probe an assumed harness capability before building"),
this spike **proves**, it does not infer from docs — then triangulates the proof against the
documented contract.

**Probe 1 — live headless capture (`claude -p`, own hook).** A throwaway capture hook
(`hook-dump.js`, append full stdin verbatim) registered on **both** `PreToolUse` and `PostToolUse`
(matcher `.*`) in a clean temp dir's `.claude/settings.json`, driven by
`claude -p "…spawn one general-purpose subagent…" --dangerously-skip-permissions`. Captured the
full init+close payload pair of one real Agent spawn. This isolates "what does the harness
actually put on the hook's stdin" from any installed-plugin state — the **same technique** the
P-OQ21 worktree-observability spike used. Installed harness: **Claude Code 2.1.158**. (The
Power Loom *plugin* is v2.9.1-skewed and its `spawn-record.js`/resolver don't fire here — but
that is **orthogonal** to the raw harness payload, which this probe captured with its **own** hook,
so the v2.9.1 skew does **not** taint this evidence.)

**Probe 2 — transcript cross-read.** Read the headless session's main transcript +
`subagents/agent-<agentId>.jsonl` to confirm (a) the parent reference lives on
transcript/sidechain messages, and (b) the subagent spawned nothing.

**Probe 3 — documented-contract triangulation.** Two independent `general-purpose` + WebFetch
agents over `code.claude.com/docs` (hooks, sub-agents, Agent SDK TypeScript types, SDK hooks) +
GitHub issues, with strict DOCUMENTED/UNDOCUMENTED/CONTRADICTED tagging.

---

## Evidence

### The decisive payloads — verbatim (Probe 1; full in the capture .jsonl)

`PreToolUse:Agent` (init):

```json
{ "hook_event_name":"PreToolUse", "tool_name":"Agent",
  "session_id":"cbe595fb-…", "transcript_path":"…/cbe595fb-….jsonl",
  "cwd":"/private/tmp/loom-probe-prov", "permission_mode":"bypassPermissions",
  "effort":{"level":"high"},
  "tool_input":{"description":"Compute 2+2","prompt":"…","subagent_type":"general-purpose"},
  "tool_use_id":"toolu_01SQnhuTZu5cDghemv4fRuMn" }
```

`PostToolUse:Agent` (close):

```json
{ "hook_event_name":"PostToolUse", "tool_name":"Agent",
  "session_id":"cbe595fb-…", "transcript_path":"…/cbe595fb-….jsonl",
  "cwd":"/private/tmp/loom-probe-prov", "permission_mode":"bypassPermissions",
  "effort":{"level":"high"}, "tool_input":{…},
  "tool_response":{ "status":"completed", "agentId":"a4eab5b44535a83c4",
    "agentType":"general-purpose", "content":[{"type":"text","text":"4"}],
    "totalDurationMs":1562, "totalTokens":21981, "totalToolUseCount":0, "usage":{…} },
  "tool_use_id":"toolu_01SQnhuTZu5cDghemv4fRuMn", "duration_ms":1563 }
```

The two `tool_use_id` values are **identical** — a stable init↔close correlation key on the shell
hook's stdin. (This spawn was a *plain* Agent spawn; per P-OQ21, `isolation:"worktree"` spawns add
`worktreePath`/`worktreeBranch`/`toolStats` to `tool_response` — the top-level `tool_use_id` and
the absence of any parent field hold regardless.)

### Transcript cross-read (Probe 2)

- Main transcript: 18 lines, all `"isSidechain":false`; `parentUuid` values are **intra-transcript
  message-threading** links (each message → its predecessor), **not** spawn-parentage; **one**
  `"name":"Agent"` tool-use = the single main→subagent spawn.
- `subagents/agent-a4eab5b44535a83c4.jsonl` exists (keyed by the close payload's `agentId`) and
  carries `"isSidechain":true` (4×) — the subagent's messages are sidechain-marked **in their own
  file**. The subagent made **0** Agent tool-calls → **no nesting** occurred.

### Documented contract (Probe 3) — key citations

- **No nesting** (DOCUMENTED 4×): `code.claude.com/docs/en/sub-agents` — *"Subagents cannot spawn
  other subagents."* The `Agent` tool is listed as **unavailable to subagents** even if named in
  `tools`. SDK subagents page repeats it; forks "cannot spawn further forks."
- **`tool_use_id` correlates Pre/Post** (DOCUMENTED, SDK): `…/agent-sdk/hooks` — *"correlates
  `PreToolUse` and `PostToolUse` events for the same tool call."* The official **command-hook**
  `/en/hooks` stdin example **omits** it (the contradiction Probe 1 settles: it is really present).
- **`parent_tool_use_id`** (DOCUMENTED, transcript/SDK only): `…/agent-sdk/typescript` —
  *"For subagent messages, the `tool_use_id` of the spawning `Agent` tool call. `null` for
  main-session messages."* On **messages**, not on the hook event. GH#40140 (closed not-planned)
  empirically confirms tool-level hooks carry **no** agent/parent discriminator; GH#32175/#14859
  confirm cross-session parent linkage is an unshipped feature request.

---

## Implications for the provenance-layer plan

The provenance layer remains a **producer + persistence** job on the complete dormant decision
spine (`resolve()` immutable; `lineage.js`/K9 chain-walk/`prev_state_hash` all exist) — but its
**value reframes** given no-nesting:

1. **PR-P1 (`record-store.js`, dormant) — still the foundational first step**, and its payoff is
   now *clearer*: it is the **state-chain** tracker (which sibling spawns committed what against
   which HEAD), which — combined with #2/#3 below — is exactly what an eventual safe auto-merge
   consumes. Build-ready; trips no CI dormancy gate (honesty-verified: gates are module-specific
   greps for k3b/k1/k6 only). Fold in the code-reviewer revisions (key by `transaction_id`; one
   file per spawn; `isAcyclicChain` is an in-set-cycle check, **not** a completeness check —
   completeness is K9's chain-walk's job).
2. **`is_genesis_position` can be honestly = true** for every harness spawn (it is genesis-from-main
   by construction) — no kernel spawn-tree / Tier-2 open-spawn-registry is needed for nesting
   (there is none). `tool_use_id` is still the clean canonical spawn identity (vs the
   agentId/UUID/spawn_id reconciliation mess), now empirically reliable across init↔close.
3. **The deferred frontier is now concrete and buildable** (was: "harness-blocked"): a **HEAD-anchor
   invariant** (record the forked-from HEAD sha at materialize — `materializeDelta` already computes
   it; re-check HEAD unchanged/fast-forwardable before the cherry-pick) + a **close-time
   sibling-concurrency lock** (N concurrent main-fanned-out spawns racing a moving HEAD — the hard
   part) + a delta-acceptance policy. None requires a harness capability that does not exist.

**Honest residual caveat (not a blocker):** this is a *headless* capture on harness 2.1.158, not a
real installed interactive session (the resolver "has never fired live" — v2.9.1 plugin skew). The
**raw payload contract** is captured directly here and is strong evidence; a final
post-`claude plugin update` interactive confirmation of the live resolver path remains prudent
before flipping any **enforcing** auto-merge that writes the user's real HEAD.
