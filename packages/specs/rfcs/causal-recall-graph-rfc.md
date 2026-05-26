---
status: rfc-v3.2-LOCKED
version: 3.2
phase: pre-v3.0
author: brainstorm session 2026-05-24
created: 2026-05-24
revised: 2026-05-24 (v3.2 — LOCKED after dual review + GC spot-review absorbed; ready for Phase 1 spike)
related:
  - swarm/thoughts/shared/HT-state.md
  - swarm/adrs/0007-v290-minor-bump-rationale.md
  - swarm/thoughts/shared/design/gc-component-spec.md (focused spec — superseded by §GC in this RFC)
  - docs/concepts/library-vs-mempalace.md
  - bench/control-runs/test3/DRIFT-NOTES.md
external_references:
  - https://platform.claude.com/docs/en/build-with-claude/context-editing
  - https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool
  - https://platform.claude.com/docs/en/managed-agents/dreams
  - https://platform.claude.com/docs/en/managed-agents/memory
  - https://alexop.dev/posts/understanding-claude-code-full-stack/
target_release: v3.0.0
gate_shape: MANDATORY (5/5 HT.1.6 triggers; ADR-0008 required for new MAJOR criterion)
scope_estimate: ~1050 LoC + 90-130h end-to-end including pair-reviews + dream prompt iteration + GC fixture testing
review_history:
  - architect spot-review of v3 — APPROVE-WITH-REVISIONS; 3 CRITICAL + 3 HIGH absorbed via pivots
  - honesty-auditor of v3+pivots — LOCK-WITH-PROBES; 4 probes + 3 framing resolutions absorbed
  - architect spot-review of GC component — APPROVE-WITH-REVISIONS; 3 CRITICAL + 4 HIGH absorbed
flags_absorbed_total: "25+ across 3 reviews"
live_bugs_caught: "2 (C1-v3 plugin-sub-agents-no-hooks; C1-GC false process model)"
---

# RFC v3.2 (LOCKED): Power-Loom-Trace — Encapsulated Causal Recall + Three-Layer Scoped Memory + Dream-Lite + Spawn Lifecycle + GC

## v3.2 lock statement

This RFC is the durable architectural artifact for v3.0.0. It absorbs 3 architectural pivots beyond v3 (parent-records, delta-capture, axiom/attestation/sample/theorem split) + a dual-review pass (architect + honesty-auditor) + a focused GC spot-review. All flags absorbed. Phase 1 spike is empirical-only (4 verification probes); no further design iteration expected before v3.0 implementation begins.

## Why this exists

Power-loom v2.9.x has rich persistence (snapshots, plans, ADRs, drift notes, chaos audits, identity events, pattern store) but only KB anchors + prompt patterns feed back into runtime recall. Everything else is write-only memory.

Meanwhile, Anthropic has shipped exactly the primitives we'd otherwise have invented — context-editing for active-memory eviction, memory tool for passive-memory persistence, Dreams API for batch theorem-extraction. Dreams are managed-agents-only; not plugin-accessible. We replicate locally with schema-compatibility for future handoff.

This RFC proposes power-loom v3.0 as:
1. **Four-class state model** (Axioms / Deterministic Theorems / Stochastic Samples / Attestations)
2. **Encapsulated three-layer scoped memory** (global / per-persona / per-spawn) mirroring OOP information-hiding
3. **Parent-records L_spawn** — orchestrator captures spawn invocations + bounded outputs via existing `PostToolUse:Agent|Task` hook (empirically validated at `hooks/hooks.json:175-183`)
4. **Delta-capture attestation** — pre/post filesystem snapshots via `git stash` + `affected_paths` scoping; deltas are the ground truth, bounded outputs are claims; discrepancy = automated honesty signal
5. **Dream-lite at three cycles** (spawn-close → persona → global) — schema-compatible with Anthropic Dreams API for mechanical future handoff
6. **Spawn Lifecycle + GC + Retention** — operational hygiene layer with split GC-Process / GC-Spawn semantics (different recovery mechanisms for genuinely different problems)
7. **Interface contracts** — persona-contract `state_interface` field governs what crosses boundaries (axiom store access, side-effects declaration, spawn-lifecycle policy, retention)

## Non-goals (explicit hard NOs)

- Full agent runtime / LangGraph replacement — plugin-shape preserved
- LLM completion "replay" — non-deterministic; we offer regeneration with explicit honesty
- Workspace-file content-addressable store — Git owns that
- Distributed/consensus layer — wrong shape for one-user agent state
- Replacing v2.1.0 library substrate — becomes the storage backend; v3.0 adds schema + queries + dream-lite + GC on top
- Inventing a page manager / LRU cache — Anthropic's `context-editing` does this; we orchestrate
- Cross-spawn state browsing — orchestrator cannot see inside spawn N from spawn M (feature, not limit)
- Bypassing persona interface contracts — orchestrator uses declared interface; no direct state-store access
- **Process termination of Agent/Task spawns** — they're in-process LLM invocations, not OS processes; recovery is contractual ("stop waiting"), not signal-based

## Empirical findings (load-bearing for design; verified)

### Finding 1: Context editing — shipping

Beta `context-management-2025-06-27`; strategy `clear_tool_uses_20250919` clears OLDEST tool results when context grows past threshold; placeholder text replaces them. Chronological FIFO eviction. Plugin-runtime exposure: not documented; Phase 1 Probe P3.

### Finding 2: Memory tool — shipping; we control storage

Tool `memory_20250818`; client-side `/memories` directory. We control storage backend. Auto-injected system prompt: *"ALWAYS VIEW YOUR MEMORY DIRECTORY BEFORE DOING ANYTHING ELSE."*. Plugin-runtime: not documented; Phase 1 Probe P3.

### Finding 3: Anthropic Dreams API — managed-agents-only; NOT plugin-accessible

Beta `managed-agents-2026-04-01` + `dreaming-2026-04-21`. `POST /v1/dreams` async job. **Input store never modified; output is new sibling store.** Lifecycle: pending→running→completed|failed|canceled. Models: opus-4-7, sonnet-4-6. Research preview.

**Critical**: input/output separation is the architectural invariant. Sibling-output discipline applied at every layer of our local dream-lite.

### Finding 4: MEMORY.md auto-injection live on this machine

`~/.claude/projects/<proj>/memory/MEMORY.md` exists; auto-injected as `# claudeMd` in every conversation system reminder (empirically observable in this very session). ~660+ session JSONLs across all projects (~ figure; not exact-counted).

### Finding 5: Plugin sub-agents cannot ship own hooks

Per [alexop.dev architecture writeup](https://alexop.dev/posts/understanding-claude-code-full-stack/) — plugin-shipped agents cannot ship their own hooks. PostToolUse fires in PARENT runtime. **Phase 1 Probe P2: re-verify from Anthropic source directly.**

### Finding 6: Parent-side hook mechanism EMPIRICALLY VALIDATED

`hooks/hooks.json:71` registers `PreToolUse:Agent|Task` (spawn-start observability).
`hooks/hooks.json:175-183` registers `PostToolUse:Agent|Task` consumed by `kb-citation-gate.js` (spawn-close observability + bounded-output extraction proven to work).

This is the load-bearing finding: Pivot 1 (parent-records L_spawn) is built on real, working infrastructure — not speculation.

### Finding 7: PreCompact hook budget is 10s (not 30s as initially assumed)

`hooks/hooks.json:203` — PreCompact tier has 10s timeout. GC PreCompact-tier sweep must complete in 8s hard limit (2s margin).

### Finding 8: v2.x context — verified

- v2.1.0 explicitly chose no-embeddings / no-ChromaDB / no-MCP (`docs/concepts/library-vs-mempalace.md:18-19`)
- v2.9.0 FIX-I3 introduced `dropped_to_cap_count` invariant (`CHANGELOG.md:77`); FIX-I4 doctor dispatcher; FIX-I7 env-placeholder helper
- Anthropic's own Dreams uses **no embeddings** — validates our v2.1.0 architectural decision

## The Four-Class State Model (per user's framing; foundational)

Every piece of state in v3.0 lands in exactly one class:

| Class | Definition | Storage | Examples |
|---|---|---|---|
| **Axioms** | Irreducible, deterministic inputs | Persistent on disk; durable; immutable | ADRs, KB anchors, persona contracts (versioned), input prompts, model IDs, parent_state_id |
| **Deterministic Theorems** | Pure functions of axioms (graph walks, recall, counts) | Memoized opportunistically; recoverable trivially on miss | `recall(topic)`, `causal_chain(node_id)`, `frequency(pattern)`, `cluster(node_id)`, `closure_status(drift_id)` |
| **Stochastic Samples** | LLM-derived re-renderings; not deterministic | Memoized per-session; explicit "draw from distribution conditioned on axioms" framing | Agent reasoning traces (re-derived on demand), dream-consolidated insights, persona-memory snapshots |
| **Attestations** | Action witnesses; verifiable proofs that something happened | Persistent on disk; small; verifiable | Filesystem deltas, bounded outputs, tool-call envelopes visible to parent, GC events |

**Key insight (resolves honesty-auditor contradiction C.2)**: deterministic theorems and stochastic samples are NOT the same thing. The former memoize cleanly (same inputs → same outputs). The latter "memoize" only in the sense of caching one drawn sample. UI must reflect this honestly: `loom states reasoning <id>` returns "a representative sample of reasoning consistent with the axioms" — never "the reasoning."

## HETS Encapsulation Model — three-layer scoped memory

OOP information hiding applied to multi-agent memory. Sub-agents are opaque objects with bounded interfaces. Orchestrator holds class references + interface contracts — never raw state. Strengthened encapsulation: parent observes from outside; doesn't need cooperation.

### Layer definitions

| Layer | Lifetime | Scope | Owner |
|---|---|---|---|
| **L_global** | Project lifetime | All personas + orchestrator | Orchestrator-mediated writes; all-read |
| **L_persona** | Per persona class (across all its spawns) | Spawns of that persona | Persona-class-cycle writes; spawns of that class read |
| **L_spawn** | Single spawn invocation | One sub-agent instance | **Parent records observations** (NOT child's private state — see Pivot 1) |

### L_spawn semantics (HONEST framing; resolves C.1)

L_spawn is **invocation-level, not sub-step-level**. Captures:
- Spawn-start event (PreToolUse:Agent|Task)
- Spawn-close event (PostToolUse:Agent|Task) with bounded output
- Pre-snapshot of filesystem state
- Post-snapshot + delta
- Metadata (timestamp, duration, cost, token usage)

Does NOT capture:
- Sub-agent's intermediate tool calls (not visible to parent's PostToolUse)
- Sub-agent's reasoning trace (theorem-class; regenerable; not stored)
- Sub-agent's scratch/working memory (private; opaque)

**Within-spawn fork** (rewind to S2-inside-spawn) is NOT supported — would require sub-agent hooks which don't exist in plugin runtime.
**Cross-spawn fork** (re-spawn from pre-snapshot + alternative input) IS supported — the canonical and only fork mechanism.

### Filesystem-as-shared-observable (resolves C.3)

Delta capture exposes filesystem state. This is NOT a peek into private spawn state — filesystem is **shared-observable** (like a microservice's DB writes are observable in the DB even though request handlers are private). What remains opaque is the sub-agent's in-context reasoning. Delta capture is allowed; reasoning extraction is not.

### Access matrix

| Reader | L_global | L_persona (own class) | L_persona (other class) | L_spawn (own children) | L_spawn (other) |
|---|---|---|---|---|---|
| Orchestrator | ✅ read+write | ❌ bounded view via dream-output | ❌ same | ✅ records via hooks | ❌ scope violation |
| Sub-agent | ✅ read | ✅ read | ❌ scope violation | ❌ never sees own record | ❌ scope violation |
| Dream cycle | ✅ own cycle | ✅ own cycle | ❌ same | ✅ read at close → emit candidate | ❌ scope violation |

## Pivot 1: Parent-records L_spawn (resolves prior C1)

Empirically validated. Mechanism:

```
Parent's runtime
├── PreToolUse:Agent|Task fires → spawn-init event captured
│   • pre_snapshot via git stash create (or affected_paths sha256 fallback)
│   • spawn record initialized: {spawn_id, parent_state_id, axioms, pre_snap}
├── Task tool dispatches to sub-agent (in-process LLM call)
├── Sub-agent runs (opaque)
└── PostToolUse:Agent|Task fires → spawn-close event captured
    • post_snapshot taken; delta computed
    • bounded_output read from tool_response.text
    • spawn record completed: {..., attestations: {post_snap, delta, bounded_output_path, status, duration, cost}}
```

Recursive composability: if a sub-agent (acting as sub-orchestrator) itself spawns children, the same pattern applies one level down. Each level manages its own delegation history.

## Pivot 2: Delta capture (attestation as ground truth)

Pre/post filesystem snapshots make sub-agent actions independently verifiable. Bounded output is what the sub-agent CLAIMS; delta is what ACTUALLY changed.

### Mechanism

| Mode | When | How |
|---|---|---|
| **git-stash** (default) | cwd is a git repo | `git stash create` returns SHA without modifying working tree (~10-100ms estimated) |
| **path-list-sha256** (fallback) | not a git repo | sha256 of files matching persona's `affected_paths` glob (~50-200ms estimated) |

### Persona contract field

```yaml
state_interface:
  affected_paths:
    allow: ["src/**", "tests/**", "swarm/run-state/<run_id>/**"]
    deny: ["swarm/personas-contracts/**", ".claude-plugin/**", "node_modules/**"]
  delta_capture:
    mode: git-stash | path-list | off
    max_delta_bytes: 100000
    store_diff_content: true
```

### Concurrency framing (absorbed from architect first review C1-v3.2)

`git stash create` is repo-global. Parallel spawns share the working tree → cross-attribution risk.

**v3.0 policy**: SERIAL-ONLY delta capture. If parent spawns multiple children in parallel, mark all but one as `attestation: skipped` with observability event. Worktree-based isolation deferred to v3.1.

```yaml
concurrency_policy:
  attest_parallel_spawns: false   # v3.0 — only one per parent at a time gets delta
  on_parallel_overflow: skip-with-event
  worktree_isolation: false        # v3.1 future
```

### Side-effects declaration (absorbed from H2)

Delta misses HTTP / env / DB / MCP / subprocess effects. Make these EXPLICIT in persona contract:

```yaml
state_interface:
  side_effects_declared:
    filesystem: ["src/**"]          # attested via delta
    http: ["api.openai.com"]        # declared, NOT attested in v3.0
    mcp_tools: ["memory"]           # declared, NOT attested
    subprocess: ["pnpm", "git"]     # declared
```

Undeclared category = contract violation at PreToolUse:Agent|Task (security policy gain becomes explicit).

## Pivot 3: Axiom→Attestation discipline; reasoning is stochastic-sample

Reasoning is theorem/sample-class, NOT stored. Storage drops 1-2 orders of magnitude (projection — Phase 1 Probe P4 will measure).

```yaml
# L_spawn record — final shape after all pivots
spawn_id: <id>
parent_state_id: <prior_spawn_id>

axioms:                          # deterministic inputs
  input_prompt: "<text>"
  kb_anchors: [<kb_id@version>, ...]   # SORTED list of in-context anchors
  persona: <name>
  persona_contract_hash: <sha256>      # content hash of contract at spawn time
  persona_contract_version: <semver>
  model_id: <claude-opus-4-7>          # NOT model_alias; exact ID

attestations:                    # action witnesses
  pre_snapshot_id: <sha>         # git stash SHA or sha256-of-path-list
  post_snapshot_id: <sha>
  delta:                         # what actually changed
    paths_modified: [...]
    paths_created: [...]
    paths_deleted: [...]
    sizes_before: {...}
    sizes_after: {...}
  bounded_output_path: "swarm/run-state/<run_id>/node-actor-<persona>-<identity>.md"
  status: completed | timed_out | idle_terminated | parent_state_exhausted

metadata:
  timestamp: <iso>
  duration_ms: <n>
  token_usage: {input: <n>, output: <n>}
  cost_usd: <n>
```

Reasoning trace, intermediate tool calls, scratch memory: **NOT stored**. `loom states reasoning <id>` re-derives via re-spawn with same axioms (Phase 1 Probe P1: how close is "equivalent quality"?).

## Axiom Hash Specification (normative; resolves architect H3)

```
H(axioms) = sha256(canonical_json({
  prompt: <input_prompt, normalized whitespace>,
  kb_anchors: <sorted list of "kb_id@version" pairs in context>,
  persona: <name>,
  persona_contract_hash: <sha256>,
  persona_contract_version: <semver>,
  model_id: <exact model ID>,
  recall_scope: <sorted L_global|L_persona|L_spawn list>,
  // EXCLUDED: timestamp, run_id, parent_state_id, identity_tier, cost
}))

hash_spec_version: "v1"        # versioned; bump = clean cache flush
```

Memos record their `hash_spec_version`; spec bumps allow side-by-side v1/v2 during migration.

## Dreaming Integration — Three Cycles (mirroring Anthropic Dreams API)

All three cycles enforce immutable-input + sibling-output discipline. Original input never modified; output is new sibling store; review then promote-or-discard.

### Cycle 1: Spawn-close dream (L_spawn → candidate for L_persona)

**Resolves architect C2 (spawn-close-dream encapsulation breach)**: parent (NOT the spawn) writes a `candidate-for-L_persona` sibling artifact under `~/.claude/spawn-state/<run_id>/<persona>-<identity>/_candidates/`. Persona-dream cycle (Cycle 2) is sole L_persona writer.

| Field | Value |
|---|---|
| Trigger | Spawn-close event; `dream_policy.spawn_close_dream: true` |
| Input | L_spawn record (axioms + attestations + bounded output) |
| Process | Parent-side LLM call distilling "what's the call-site pattern? when I spawn persona P with task T, what attestation tends to emerge?" |
| Output | Candidate file in spawn's `_candidates/` dir; awaits Cycle 2 absorption |
| Duration | Seconds; ~$0.01-0.05 (estimate — Phase 1 measurement) |
| Cost cap | `max_spawn_close_dream_cost_usd: 0.10` per spawn |

### Cycle 2: Persona dream (candidates → L_persona)

| Field | Value |
|---|---|
| Trigger | Auto: weekly per `dream_policy.persona_dream_interval_hours`; manual `loom dream --persona <name>` |
| Input | All `_candidates/` for persona since last cycle + current L_persona memory |
| Process | 4-phase: Orient → Gather → Consolidate (last-state-wins; merge dupes; resolve contradictions) → Prune+Index |
| Output | NEW sibling L_persona memory store (per Anthropic discipline; original kept) |
| Duration | Minutes; ~$0.05-0.20 (estimate) |
| Cost cap | `max_persona_dream_cost_usd_per_day: 0.50` per persona |

### Cycle 3: Global dream (L_persona promotions + L_global → L_global')

| Field | Value |
|---|---|
| Trigger | Auto: 24h + 5+ sessions (matches Anthropic Auto Dream); manual `/loom-dream` |
| Input | Current MEMORY.md + curated L_persona promotions + recent session JSONLs |
| Process | Same 4-phase at project scope |
| Output | NEW sibling MEMORY.md (≤200 lines) + topic files in `~/.claude/projects/<proj>/memory/_dream/<timestamp>/` |
| Approval gate | User reviews diff; manual swap-in via `loom dream promote <timestamp>` |
| Cost cap | `max_global_dream_cost_usd: 1.00` per pass |

## Spawn Lifecycle + GC + Retention (operational hygiene)

**Critical: GC is split into two genuinely different mechanisms** (absorbed from architect GC C1):

### GC-Process (Bash-tool children, shells, lock holders)

Real OS processes with PIDs. Where the operational pain actually lives (stuck `git status` procs, stale `.git/index.lock`, orphan shells).

| Trigger | Detection | Recovery |
|---|---|---|
| **Stale lock file** | Lock file > 30min old | TOCTOU defense: capture `(pid, mtime, inode)` at T1; verify pid alive via `kill -0`; re-check tuple at T3; abort if changed (`lock_recovery_aborted_raced` event); else unlink + emit `lock_recovered` |
| **Orphan process** | Process matching our spawn pattern, parent dead, age > 1h | SIGTERM → wait 5s → SIGKILL; emit `gc_purged` with metadata |
| **Stuck process tree** | E.g., orphan `git`/`zsh` chains we observed | Per-tree termination via process group |

### GC-Spawn (Agent/Task LLM invocations)

**Not OS processes.** Cannot terminate. Recovery is contractual.

| Trigger | Detection | Recovery |
|---|---|---|
| **Wallclock timeout** | `spawn_started_at + timeout_seconds < now()` | Mark spawn record `status: timed_out`; orchestrator stops waiting; capture partial delta (pre-snap → current FS); emit `spawn_timeout` attestation; release any locks acquired during spawn |
| **Idle detection** | DEFAULT-DISABLED in v3.0 (no token-stream event hook verified) | Available only via manual `loom gc terminate <id> --force`; v3.3 candidate to enable once Anthropic exposes streaming events to hooks |
| **Retry exhaustion** | `count(forks from parent_state with status in [failed, timed_out]) >= max_retries` | Mark `parent_state_id: exhausted`; refuse new forks; emit `parent_state_exhausted` attestation; auto-create drift-note (throttled max 1 per parent_state per 24h) |
| **Storage threshold** | Per-project spawn-state > 1GB; per-spawn delta > 100MB; per-persona dream-history > 500MB | Progressive throttle: warn at 70%; archive oldest at 90%; refuse new attestations at 100% (fail-closed) |

### Persona contract additions

```yaml
state_interface:
  spawn_lifecycle:
    timeout_seconds: 300            # DEFAULT 300s (5min) — most current spawns <120s
    # per-persona overrides:
    # architect: 1800, code-reviewer: 600, general-purpose: 600
    idle_detection: false           # default-disabled per architect C2
    max_retries: 3
    on_timeout: archive | purge | hold
  retention:
    pre_snapshot_lifetime_hours: 24
    delta_lifetime_days: 30
    attestation_lifetime_days: 90
    dream_output_lifetime_days: 180
    archive_after_days: 365
    # NOTE: thresholds are GUESSES; revisit after 30 days of empirical attestation data
```

### Periodic sweep cadences

| Tier | Schedule | Budget | Scope |
|---|---|---|---|
| Stop hook | Every turn | 50ms | Wallclock-timeout check on active spawns; lock-staleness check (top-level only) |
| PreCompact hook | Every compaction (~50-100 turns) | **8s hard limit** (per `hooks.json:203` 10s budget − 2s margin) | + abandoned-fork sweep + theorem-memo cache cleanup |
| Daily scheduled | SessionStart hook reads `last-sweep.json`; if >24h, fire async (matches `session-reset.js` precedent) | 10s budget | Full sweep: all triggers + retention archive + lock scan + storage thresholds + attestation index rebuild |

**Concurrency**: serialize on `~/.claude/library/_meta/gc.lock` with 10s acquire timeout. If contention: second session writes `gc_sweep_deferred` attestation; skips entirely (do NOT wait; do NOT proceed unlocked).

### New attestation types

`spawn_timeout`, `spawn_idle_warning`, `spawn_idle_terminated`, `parent_state_exhausted`, `gc_purged`, `lock_recovered`, `lock_recovery_aborted_raced`, `lock_long_held`, `storage_threshold`, `retention_archive`, `gc_sweep_complete`, `gc_sweep_deferred`, `escape_hatch_used`.

All written to `~/.claude/checkpoints/attestation-log.jsonl` (mirrors `kb-citation-log.jsonl` pattern).

### New CLI verbs (GC subset)

```
loom gc status [--persona X]
loom gc sweep [--tier Stop|PreCompact|daily] [--dry-run]
loom gc verify-locks
loom gc orphans [--max-age 1h]
loom gc terminate <spawn-id> --force      # operator escape hatch; mandatory --force
loom gc metrics [--window 7d]             # MTTR per trigger class
loom states orphans
loom states timeouts [--persona X]
loom retention preview [--scope X]
loom retention apply [--dry-run]
```

### Recovery contracts (GC's own failure modes)

| Failure | Recovery |
|---|---|
| Sweep > budget (8s PreCompact / 10s daily) | Abort gracefully; `gc_sweep_aborted` event; next sweep picks up |
| `_lib/atomic-write.js` partial write | Atomic-write contract prevents partial visibility; next sweep retries |
| Stale `gc.lock` itself | Same TOCTOU defense as user locks: pid liveness + tuple check |
| Storage threshold blocks legitimate spawns | Operator escape: `loom retention apply --force`; `escape_hatch_used` attestation |
| Attestation log itself disk-full | Rotate to `.<timestamp>.archive`; fall back to stderr emission; emit `attestation_log_rotated` |
| GC fires during dream-cycle write | Dream-write acquires `gc.lock` only during write phase (not full duration); GC defers if contended |

### Security (absorbed from architect GC L3)

`loom gc terminate <spawn-id>` validates spawn-id against active-spawns table; rejects unknown ids (`kb:architecture/discipline/error-handling-discipline` fail-closed). Mandatory audit log to attestation-log.

## Causal Recall Graph (queryable layer; scoped per encapsulation)

Schema additions to existing artifacts (additive; null-OK; gradual migration):

```yaml
node_id: <slug>
layer: global | persona | spawn
persona_scope: <persona-name>           # if layer=persona or spawn
spawn_scope: <run_id>/<identity>        # if layer=spawn
content_hash: <sha256>
parent_id: <node_id>
causal_predecessors: [<node_id>, ...]
related_node_ids: [<node_id>, ...]
supersedes: [<node_id>, ...]
superseded_by: <node_id>
tags: [<topic>, ...]
surface: <file-path-or-symbol>
node_type: axiom | deterministic_theorem_memo | stochastic_sample | attestation
derivation_rule: <name>                 # for theorem/sample classes
hash_spec_version: <v1>                 # for memo invalidation
```

Per-scope indices: `~/.claude/library/_meta/causal-graph-{global,persona/<name>,spawn/<run_id>/<persona>-<identity>}.json`. Incremental rebuild on artifact write; full rebuild via `loom graph reindex`.

### CLI

```
loom recall <topic> [--scope X] [--persona Y]   — top-K (deterministic theorem)
loom causal-chain <node-id>                     — parent walk (deterministic)
loom related <node-id>                          — graph DAG neighbors (deterministic)
loom cluster <node-id>                          — connected component (deterministic)
loom fork <node-id> --input "<alt>"             — re-spawn from pre-snap (cross-spawn fork only)
loom diff <id-A> <id-B>                         — compare branches/states
loom invalidate <axiom-id>                      — drops dependent memos in scope
loom states reasoning <state_id> [--samples N]  — STOCHASTIC SAMPLES via re-spawn; honest label
loom graph reindex [--scope X] [--full]
loom dream [--scope X] [--persona Y]
loom dream history [--scope X]
loom dream promote <dream-id>                   — swap sibling output → current
loom dream rollback <scope>
loom spawn-state <run-id> <persona>             — bounded-summary inspect (interface only)
```

Cross-scope queries fail with `scope_violation`; mediated via bounded summaries.

## Architecture (final shape, locked v3.2)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ANTHROPIC PRIMITIVES (we orchestrate; fall back if plugin-inaccessible) │
│  • context-editing (clear_tool_uses_20250919) — active-memory eviction   │
│  • memory tool (memory_20250818) — passive memory dir                    │
│  • Dreams API (managed-agents ONLY; NOT plugin-accessible — replicate)  │
│  • MEMORY.md auto-injected as # claudeMd                                 │
└─────────────────────────┬────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  ORCHESTRATOR (knows class structure + memory boundaries)                │
│  • L_global axiom store + recall                                          │
│  • Persona class registry (interface contracts)                          │
│  • Spawn instance lookup table                                           │
│  • PreToolUse:Agent|Task → pre-snap + record init                        │
│  • PostToolUse:Agent|Task → post-snap + delta + bounded-output ingest    │
│  • Spawn-close dream emits candidate-for-L_persona                       │
│  • Global dream cycle                                                    │
│  • GC: Process-tier + Spawn-tier (split per architect C1)                │
└────────────┬─────────────────────────────────────────────┬───────────────┘
             │ (interface call)                            │ (read-only)
             ▼                                             ▼
┌────────────────────────────────────────┐  ┌────────────────────────────┐
│  L_PERSONA (per-class memory)           │  │  L_GLOBAL                  │
│  • Consolidated insights                │  │  • KB anchors, ADRs        │
│  • Per-persona causal graph             │  │  • MEMORY.md (auto-inj)    │
│  • Persona dream cycle (candidates →)   │  │  • Identity reputation     │
│  • Read-allowed for spawns of class     │  │  • Drift docket            │
└────────────┬────────────────────────────┘  └────────────────────────────┘
             │ (read for spawns; write at dream cycle)
             ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  L_SPAWN (parent-records-only, invocation-level)                         │
│  • Parent's record of {axioms, attestations} per child invocation        │
│  • DAG via parent_state_id (cross-spawn fork lineage)                    │
│  • Pre/post snapshots for verifiable fork                                │
│  • NO sub-step state graph (out of scope; plugin limitation)             │
│  • Spawn-close emits candidate-for-L_persona                             │
└──────────────────────────────────────────────────────────────────────────┘
```

## Phased delivery (locked)

### Phase 0 — RFC v3.2 capture ✅ DONE (this document)

### Phase 1 — Verification spike (~14-16h; no merge)

5 probes + 1 prototype + measurement:

**Probes**:
- **P1**: Re-spawn equivalence — A/B: spawn same persona with same axioms twice; measure output divergence
- **P2**: Plugin sub-agent hook ban — verify directly from Anthropic plugin docs, not 3rd-party only
- **P3**: Anthropic API beta header strings — attempt actual API calls; record HTTP responses
- **P4**: Delta storage budget — measure 10 real spawn deltas; refine retention defaults
- **P5 (NEW)**: GC-Process vs GC-Spawn split — confirm Bash-tool children are PID-addressable but Agent/Task spawns are not; verify recovery semantics differ correctly

**Prototype**:
- Parent-side PostToolUse:Agent|Task hook that captures axioms + writes L_spawn record
- One persona (`04-architect`) extended with `state_interface` field
- `loom recall` against L_global only
- Encapsulation-invariant fixture: cross-spawn state access denied

**Measurement**:
- Blind hit-rate: 10 real recent tasks; user rates Y/N blind to recall-vs-random
- Target ≥50% useful

### Phase 2 — Productionize axiom + recall + attestation layers (~30h; v3.0.0-alpha)

- Schema additions across all artifact classes
- Per-scope index builders
- Full scope-aware CLI
- Theorem memo caches with `hash_spec_v1` invalidation
- Self-improve cluster integration
- Interface contracts across 16 personas (migration order: 04-architect → code-reviewer → builders → orchestrators; **1 PR per persona; NO stacking** per DRIFT-test3-020 anti-pattern)
- Spawn-state-namespace + delta capture infra
- ADR-0008 codifies new MAJOR-bump criterion (substrate-fundament with new CLI noun + new persona-contract field + new storage namespace)

### Phase 3 — Dream-lite + GC (~35h; v3.0.0)

- Three dream cycles (spawn-close / persona / global) — async-job machinery mirroring Anthropic API
- Spawn Lifecycle + GC + Retention machinery (Process + Spawn tiers)
- Failure-mode matrix code paths
- `/loom-dream` + `/loom-gc` slash commands
- Pair-review on each dream prompt design (architect + honesty-auditor)
- Fixture tests per validation criteria

### Phase 4 — Advanced (~25h; v3.1+)

- Cross-spawn fork API (re-spawn-with-state-injection — honest re-spawn semantics)
- Predictive recall via causal-graph at pre-spawn
- v3.1: worktree-based delta-capture isolation (enables parallel attestation)
- v3.3: idle-detection re-enable if token-stream events ship in hooks
- If Anthropic Dreams API gets plugin access: delegate dream-lite cycles

## Failure-Mode Matrix (absorbed from architect H1)

| Failure | Recovery (per `kb:architecture/discipline/error-handling-discipline`) |
|---|---|
| `git stash create` fails pre-spawn | Fall back to `affected_paths` sha256; if THAT fails, mark `attestation: none` + observability event; spawn proceeds (fail-open) |
| Sub-agent crashes between pre-snap and bounded-output | Post-snap still runs; delta captured; `bounded_output: null` recorded; honest "attested action with no narrative" |
| Post-snap before final write flushes | All Edit/Write tools synchronous via Claude Code runtime; PostToolUse fires after transcript closes. Backgrounded bash (`&`) is the only risk; persona contract must declare/forbid |
| PostToolUse hook itself fails | Sub-agent reply still returned; attestation missing; observability event; **idempotent retry** via `loom attest --replay <spawn_id>` |
| `git stash` SHA lost | `loom attest --replay` fails for that spawn; manual triage; rare |
| Atomic-write fails mid-archive | `_lib/atomic-write.js` prevents partial visibility; next sweep retries |

## Validation criteria (lock-ready when all green)

- [ ] **P1**: re-spawn equivalence measured; envelope quantified
- [ ] **P2**: plugin sub-agent hook ban verified via Anthropic source
- [ ] **P3**: Anthropic API beta headers tested; HTTP responses recorded
- [ ] **P4**: delta storage budget measured on 10 spawns
- [ ] **P5 (NEW)**: GC-Process vs GC-Spawn semantics confirmed via fixture
- [ ] Phase 1 spike shows ≥50% useful-hit rate (blind)
- [ ] Encapsulation invariant: cross-spawn state access denied (fixture)
- [ ] Spawn-state-namespace prototype produces valid record for one persona
- [ ] Sibling-output rollback discipline demonstrated at all 3 dream cycles + L_persona promotion
- [ ] Dream-lite produces ≤200-line MEMORY.md on global cycle; sensible persona-memory; ≥1 actionable insight per spawn-close
- [ ] GC fixture tests pass (10 listed in `gc-component-spec.md`)
- [ ] No regression on existing 116/116 install.sh smoke + 108/108 unit + 17-baseline contracts
- [ ] Architect + code-reviewer pair-review absorbed (MANDATORY gate)
- [ ] Honesty-auditor verifies attestations: every claim in dream output traces to source axiom in correct scope
- [ ] ADR-0008 documents v3.0 substrate addition + new MAJOR-bump criterion

## Risks + mitigations (consolidated)

| Risk | Mitigation |
|---|---|
| Encapsulation violation (orchestrator browses spawn state) | Scope-violation guards in CLI + interface validation hooks + fixture tests |
| Spawn-state storage explosion | Per-spawn 100MB cap; auto-archive on spawn-close; configurable retention |
| Plugin can't trigger Anthropic primitives | Phase 1 probes document; fall-back uses our LLM-call directly |
| Privacy leak via recall | Per-scope opt-out; persona contracts declare `recall_scope`; results cite source |
| Token-cost regression from dream cycles | 3-tier cost ceilings (spawn-close $0.10; persona $0.50/day; global $1.00/pass); rate limits |
| Dream-pass output quality | Per-cycle pair-review; honesty-auditor verification; sibling-output discipline = trivial rollback |
| Schema migration burden | Backfill null-OK; gradual; 1 PR per persona |
| Anthropic primitives change shape post-GA | Our schema mirrors theirs; migration is mechanical rename |
| Re-derived reasoning misleads users | UI ALWAYS labels "stochastic sample"; never "the reasoning" |
| Concurrency causes delta cross-attribution | v3.0 serial-only attestation; worktree isolation v3.1 |
| GC terminates legitimate long-thinking spawn | Idle default-disabled; only wallclock terminates; defaults tuned per-persona |
| GC TOCTOU on lock recovery | `(pid, mtime, inode)` tuple check at T1 + T3; abort if changed |
| Concurrent Claude Code sessions | `gc.lock` with 10s acquire timeout then defer (not wait) |

## Open questions deferred to per-phase plans

- Subgoal-marker convention (Phase 4 persona-contract revision)
- Cross-session theorem memo aggregation (Phase 4+)
- Exact dream-prompt designs (Phase 3; pair-review per prompt)
- KB schema migration script details (Phase 2 plan)
- Nested HETS spawn-state composition (Phase 2 design when first nested case appears)
- Identity reputation cross-layer flow (Phase 2-3)
- Storage threshold defaults revisit (30 days after Phase 2 ship)
- Cross-persona-read for L_persona (e.g., reviewer benefits from architect's L_persona) — Open Question for Phase 2

## What this RFC explicitly DECIDES

- Four-class model (Axioms / Deterministic Theorems / Stochastic Samples / Attestations) — load-bearing
- Three-layer scoped memory (global / per-persona / per-spawn) — encapsulation via interface contracts
- Parent-records L_spawn at invocation-level only (sub-step capture out of scope)
- Delta capture via git-stash (default) or path-list-sha256 (fallback); serial-only in v3.0
- Filesystem is shared-observable; reasoning is private; both framings made explicit
- Three dream cycles all enforce immutable-input + sibling-output discipline
- GC split into GC-Process (PID-based) and GC-Spawn (contractual)
- Idle detection default-DISABLED in v3.0 (re-enable v3.3 pending streaming-event hook)
- No embeddings for v3.0 (Path A locked); validates Anthropic's own choice for Dreams
- Dream-lite mirrors Anthropic Dreams API shape for mechanical future handoff
- Plugin-shape preserved; no runtime/framework expansion
- Major-bump per ADR-0008 (to be written): "substrate-fundament with new CLI noun + new persona-contract field + new storage namespace"
- Migration: 1 PR per persona, NO stacking (DRIFT-test3-020 anti-pattern)

## Next steps

1. ✅ RFC v3.2 LOCKED (this document)
2. Draft ADR-0008 stub introducing new MAJOR-bump criterion
3. Phase 1 probe + measurement spike on a branch (~14-16h; no merge)
4. If Phase 1 validates → Phase 2 plan + ADR-0008 finalization with full pair-review

---

## Review history summary

| Round | Reviewer | Verdict | Material flags absorbed |
|---|---|---|---|
| 1 | architect (RFC v3) | APPROVE-WITH-REVISIONS | C1 plugin-runtime sub-agent hooks; C2 spawn-close encapsulation; C3 contract validation timing; H1 manifest bump rationale; H2 fork-semantics honest framing; H3 dream cost throttle |
| 2 | architect (synthesized v3.2 with 3 pivots) | APPROVE-WITH-REVISIONS | C1 concurrency; H1 failure matrix; H2 side-effects declared; H3 normative hash spec; M2 migration order |
| 3 | honesty-auditor (RFC v3 + pivots) | LOCK-WITH-PROBES | C.1 L_spawn invocation-level honest framing; C.2 deterministic-vs-stochastic theorem split; C.3 filesystem-as-shared-observable; 4 Phase-1 probes; overconfidence corrections (19 agents not 18; ~660+ not 662; DRIFT-FIX mapping) |
| 4 | architect (GC component) | APPROVE-WITH-REVISIONS | C1 GC-Process vs GC-Spawn split; C2 idle default-disabled; C3 TOCTOU defense; H1 timeout defaults closed; H2 SessionStart-hook daily-sweep; H3 PreCompact 8s hard limit; H4 concurrent-session lock-deferral; M1-5 + L1-5 inline |

**Two LIVE-bug catches across reviews**: 
1. Original v3 L_spawn design would have built sub-agent-side machinery in a plugin context that doesn't support sub-agent hooks (caught by architect round 1)
2. GC spec process-termination story assumed Agent/Task spawns are OS processes (caught by architect round 4) — would have wasted Phase 1 spike time

The user's choice of Path B for the extra GC spot-review was vindicated by the C1-GC catch alone.

---

*Author's lock statement*: RFC v3.2 is the durable architectural artifact for v3.0.0. The shape held across 4 review rounds; the corrections were mechanical and the design converged via increasingly-honest framing. Phase 1 begins with 5 empirical probes; design iteration ends here.
