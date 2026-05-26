# Wave -1 — v3 Entry-Gate Probes

**Branch**: `feat/v3.0-phase-1-verification-spike`
**Scope**: empirical validation of 7 Anthropic-native primitive assumptions BEFORE Phase 0 / v3.0-alpha commits any code.
**Spec**: `swarm/thoughts/shared/design/v3.3-substrate-synthesis.md` §6.0a
**Effort budget**: 6-9h total + 1-2h write-up.
**Exit gate**: every probe has a verdict (PASS / FAIL / PARTIAL) backed by on-disk evidence. Any FAIL forces a re-plan of v3.0-alpha BEFORE code lands.

## Status table

| Probe | Tests | Status | Verdict | Evidence |
|---|---|---|---|---|
| P-Worktree | `isolation: "worktree"` honored; `git worktree list` shows allocation; composes with `git stash` | ✅ DONE | PASS (3 caveats) | agent `ab0594eadd8056107`; §P-Worktree |
| P-DepthOne | depth-1 constraint for plugin sub-agents under v3.1 contract shape | ✅ DONE | PASS (tool-registry enforcement) | agent `a172fa167d2299f0d`; `p-depthone-findings.md`; §P-DepthOne |
| P-Inject | `PreToolUse(Agent).updatedInput` rewrites tool_input; size limits | ✅ DONE | PASS (must wrap in hookSpecificOutput) | agent `ae7ad3affc4e2dee2`; §P-Inject |
| P-Settings | settings.json `permissions.allow` applies to spawn-init's PreToolUse context for the spawned sub-agent | ✅ DONE | ⚠️ PARTIAL PASS (allow/deny not in payload) | probe-inject log; §P-Settings |
| P-EscapeHatch | `LOOM_DISABLE_WORKTREE=1` actually bypasses K1 as documented | ⏸️ DEFERRED | **DEFERRED-TO-V3.0-ALPHA** (untestable pre-K1; promoted to K1/K10 acceptance criterion) | §P-EscapeHatch |
| P-HookChain | K8 composes with existing PreToolUse(Agent) hooks; execution order + cumulative-rewrite semantics | ✅ DONE | ⚠️ PARTIAL (no composition; K8 must be exclusive injector) | agent `afd40cab0c96200c7`; §P-HookChain |
| P-WriteScope | spawned agent attempting to write outside its allocated worktree fails / blocked / detected | ✅ DONE | ❌ **FAIL — writes leak everywhere** | agent `a9b4956b00a618ac2`; `p-writescope-findings.md`; §P-WriteScope |
| **OQ-11 decision** | full validators vs slim predicates for leaf criteria (2-3× LoC swing on v3.2) | ✅ DECIDED | **SLIM PREDICATES** (matches blueprint v4.2 §11 OQ-11 lock) | §OQ-11 |

**Wave -1 exit gate (2026-05-26): SATISFIED.** All 7 probes have verdicts; OQ-11 decided (slim predicates); P-EscapeHatch dispositioned as a v3.0-alpha K1/K10 acceptance criterion (untestable until K1 exists). The lone FAIL (P-WriteScope) already forced the v3.0-alpha re-plan — K14 Write-Scope Enforcer added, A1 split into A1+A7 — absorbed into blueprint v5.4 (BLUEPRINT-LOCKED). **Phase 0 workspace restructure is unblocked.**

## Load-bearing assumptions under test

If P-Inject FAILS → K8 capability-injection design dies → v3.1 persona contracts need an alternative mechanism (likely persona-internal capability check, slower).
If P-Worktree FAILS → K1 declarative-isolation dies → v3.0-alpha falls back to manual `git worktree add` orchestration (~150 LoC added).
If P-DepthOne FAILS in unexpected direction → 16-persona migration design assumptions break.
If P-Settings FAILS → spawn-init permission scoping has to migrate from declarative settings.json into hook scripts (~200 LoC added).
If P-EscapeHatch FAILS → entire escape-hatch contract for v3.0-alpha is undermined.
If P-HookChain FAILS → K8 cannot coexist with existing hooks → either K8 owns the hook slot exclusively (breaks contract-reminder + route-decide) or K8 is redesigned.
If P-WriteScope FAILS → A1 transactional determinism has a hole (delta capture can include OUT-OF-SCOPE writes) → either kernel detects + rejects post-hoc, or worktree boundary is enforced upstream.

---

## P-Worktree

**Hypothesis**: A parent agent invoking the Agent tool with `isolation: "worktree"` causes Claude Code to allocate a fresh git worktree for that sub-agent; the worktree appears in `git worktree list`; on sub-agent completion the worktree is either auto-cleaned (if unchanged) or persists for diff inspection.

**Method**: Spawn `general-purpose` agent with `isolation: "worktree"` and instruct it to report `pwd`, `git rev-parse --show-toplevel`, `git rev-parse --absolute-git-dir`, `git branch --show-current`, `git worktree list`, `ls -la`, and to create a marker file. Inspect from parent before + after.

**Findings (2026-05-26, agent id `ab0594eadd8056107`)**:

1. ✅ **Worktree allocation mechanism CONFIRMED.** Agent's `pwd` = `<session-root>/.claude/worktrees/agent-<hash>/`. Path is distinct from parent.
2. ✅ **Branch naming convention**: `worktree-agent-<hash>` — deterministic, hash-keyed (16-hex-char hash visible in branch name).
3. ✅ **Git-dir layout**: `.git` in the worktree is a 121-byte file (worktree pointer), absolute-git-dir resolves to `<session-root>/.git/worktrees/agent-<hash>/`. Standard git worktree mechanics — NOT a separate clone, shares object database with main repo.
4. ✅ **Files synced from parent HEAD**: worktree contains the parent's working files at the parent's current HEAD commit. Agent's HEAD = parent's HEAD (`021030e [main]` in this run).
5. ✅ **Writes isolated**: marker file `WAVE-NEG-1-WORKTREE-MARKER.txt` shows as `??` in agent's `git status --porcelain`; does NOT appear in parent's working tree. Isolation works at the filesystem level.
6. ✅ **Cross-worktree visibility**: agent CAN see all sibling worktrees + parent via `git worktree list` (they share the same `.git/worktrees/` registry).
7. ⚠️ **STRUCTURAL: worktrees bind to SESSION root, not the current working repo.** This Claude Code session was launched in `portfolio-website-builder`. Worktree was allocated under `/Users/.../portfolio-website-builder/.claude/worktrees/`, NOT under `/Users/.../claude-toolkit/` where the v3 spike actually lives. **For v3.0-alpha to spawn worktrees against the toolkit repo, the Claude Code session must be rooted there.** K1 spec needs to make this explicit.
8. ⚠️ **NO auto-cleanup.** After agent completion, worktree persists and is marked `locked`. Pre-probe state showed 4 stale worktrees from prior sessions: `agent-a15bd70a1c31fd5a8`, `agent-aaf8b7cc5cb30e0c0`, `agent-af16c4a189d360a19`, `hopeful-carson-8b12b0`. Post-probe state added a 5th. **K1's "auto-cleaned if unchanged" claim from Agent tool docs is NOT operational** — at minimum, the marker-file write made this run "changed", but the prior 4 were also locked. Locked status prevents `git worktree remove` without `--force`.
9. ⚠️ **First-spawn transient failure.** Initial probe attempt returned `Failed to create worktree: Preparing worktree (new branch 'worktree-agent-a63d6ee273b9a7345')` — truncated, no further error context. Second attempt succeeded immediately. Possible causes: (a) hash collision with a previously-allocated branch name, (b) lock contention from concurrent metadata writes, (c) macOS file-system races we've seen before in this session (`com.apple.provenance` attribute blocking). **Implication**: K1 must implement retry-with-fresh-hash on creation failure (or pre-prune dead worktrees before allocating).

**Verdict**: ✅ **PASS** — mechanism works. **3 caveats become v3.0-alpha implementation requirements**:
- K1 must implement post-spawn worktree cleanup (NOT rely on Anthropic-native auto-clean; that's empirically false)
- K1 must implement retry-on-collision (one-of-N spawns fails inscrutably)
- K1 spec must document session-root binding (Claude Code session must be rooted in the target repo, NOT in a sibling)

---

## P-DepthOne

**Hypothesis**: A plugin sub-agent invoked via the Agent tool cannot itself invoke the Agent tool to spawn a grandchild (depth-1 constraint). Attempting to do so either fails synchronously or is silently no-op'd.

**Method**: Spawn a `general-purpose` sub-agent and instruct it to (1) enumerate its full tool inventory and (2) attempt invoking `Agent` with a "GRANDCHILD-SUCCESS" probe. Findings written to a file (`p-depthone-findings.md`) to survive any response-truncation.

**Findings (2026-05-26, agent id `a172fa167d2299f0d`)**:

1. ✅ **Spawn primitive (Agent/Task/TaskCreate) NOT in sub-agent's tool inventory.** Not in top-level schemas; NOT in the deferred-tool list either. Sub-agent has no mechanism to invoke a grandchild — enforcement happens at the tool-registry layer, not at runtime.
2. ✅ **Depth-1 constraint is structurally enforced.** Because the primitive is absent, no "attempt" can be made. This is a stronger guarantee than runtime rejection (no race conditions; no error handling needed).
3. ✅ **Sub-agent default toolset (empirically observed)**: `Bash`, `Read`, `Write`, `Edit`. Top-level only. Deferred-loadable: `WebFetch`, `WebSearch`.
4. ✅ **NOT in sub-agent default toolset**: `Grep`, `Glob`, `Agent`, `Task`, `TaskCreate`. Search primitives are absent — sub-agent must use Bash + `grep`/`rg` for search.
5. ⚠️ **Sub-agent cwd = session root**, NOT a worktree (this probe was un-isolated). Same finding as P-Worktree's caveat 7.
6. ⚠️ **No session_id injection into sub-agent env.** No `CLAUDE_SESSION_ID` or equivalent env var visible. **Implication for K2 spawn-record envelope**: parent must inject its own session_id into the sub-agent's prompt or hook context if needed for lineage chain (K3). Cannot rely on Anthropic-native env propagation.
7. ✅ **Sub-agent self-identifies as Opus 4.7 1M-context** (per its system-prompt-visible model ID `claude-opus-4-7[1m]`). Same model as parent in this case; suggests parent's model is the default unless explicitly overridden.

**Verdict**: ✅ **PASS** — depth-1 hard-cap is empirically confirmed at the tool-registry layer (stronger than runtime enforcement). Implications:
- v3.0-alpha K8 capability-injection design assumption "sub-agent can spawn sub-agent" was already false in the existing plan; this reconfirms it.
- K3 lineage chain MUST inject parent session_id via prompt/hook (no Anthropic-native env).
- Sub-agent's default toolset is narrower than expected (no Grep/Glob); persona contracts that rely on search must explicitly Bash-out to `grep`/`rg`.

---

## P-Inject

**Hypothesis**: A `PreToolUse(Agent)` hook can return `{updatedInput: {...}}` in its stdout JSON and Claude Code will honor the rewrite, replacing the tool_input the model emitted with the hook's substitute.

**Method**: Wrote `~/.claude/hooks/scripts/probe-inject.js` to (a) log the incoming payload, (b) return `{hookSpecificOutput: {hookEventName: "PreToolUse", updatedInput: {...tool_input, prompt: MARKER + originalPrompt}}}`. Registered in `~/.claude/settings.json` PreToolUse[0]. Spawned `general-purpose` agent and asked it to report the first 60 chars of its prompt + whether marker was present. Both the hook log (`/tmp/probe-inject-log.json`) and the agent's observation file (`/tmp/probe-inject-agent-observation.txt`) were inspected.

**Findings (2026-05-26, agent id `ae7ad3affc4e2dee2`)**:

1. ✅ **Hook fired pre-tool**: log entry written at `2026-05-26T12:10:26.047Z` before the Agent invocation completed (~9.5s later).
2. ✅ **updatedInput.prompt HONORED**: agent reported its prompt began with `[WAVE-NEG-1-PROBE-INJECT-MARKER] Empirical probe for Wave -1`. The rewrite landed at the prompt's start.
3. ✅ **Schema**: returning `{hookSpecificOutput: {hookEventName: "PreToolUse", updatedInput: <new tool_input object>}}` is the correct shape. (The earlier "PreToolUse hook returns `{updatedInput: ...}` directly" docs guess was WRONG — must be wrapped in `hookSpecificOutput`.)
4. ✅ **Hook payload structure observed**: `{session_id, transcript_path, cwd, permission_mode, effort, hook_event_name, tool_name, tool_input, tool_use_id}`. `tool_input` keys = `{description, prompt, subagent_type}` (no `isolation` field unless explicitly set).
5. ⚠️ **`permissions.allow` NOT in hook payload** — only `permission_mode` ("auto") is exposed. If K2 spawn-record envelope needs the active allow/deny list, the hook must read `~/.claude/settings.json` itself. (This is partial P-Settings evidence — see §P-Settings.)
6. ✅ **No subprocess errors**: hook ran inside 5-second timeout cleanly (~50ms wall-clock from log timestamps).

**Verdict**: ✅ **PASS — K8 capability-injection design is feasible at the hook layer.** The `updatedInput` mechanism is real and honored by the Agent tool. Implementation guidance:
- K8 must wrap its output in `hookSpecificOutput: {hookEventName: "PreToolUse", updatedInput: {...}}`.
- K8 must include ALL original tool_input fields in the returned object (spread + override), not just the ones being modified, because the returned object becomes the new tool_input (full replacement, not merge).
- K8 cannot rely on Anthropic-native session-id propagation — K2 must inject session_id into the prompt or a sidecar mechanism.

---

## P-Settings

**Hypothesis**: A spawn-init PreToolUse hook that reads `settings.json` `permissions.allow` and uses those values to scope the spawned sub-agent's tool access actually receives the right permission set for the SPAWNED agent's context (not the parent's).

**Method**: Observed hook payload structure during P-Inject (no separate fixture needed — the question is whether `permissions.allow` is exposed in the PreToolUse(Agent) hook input payload).

**Findings (2026-05-26, payload captured by probe-inject.js)**:

Hook input payload keys observed: `session_id, transcript_path, cwd, permission_mode, effort, hook_event_name, tool_name, tool_input, tool_use_id`.

- ✅ **`permission_mode` IS exposed** — value was `"auto"` in this session. This indicates the spawn-init's permission mode.
- ❌ **`permissions.allow` / `permissions.deny` arrays are NOT in the hook payload.** The hook can see WHICH MODE is active, but not the active allow/deny list.
- ⚠️ **Implication for K8 / K2**: any hook that needs to scope a spawned sub-agent's permissions MUST read `~/.claude/settings.json` (and possibly project-local `.claude/settings.json`) itself — Claude Code does NOT pre-resolve the active allow/deny set into the hook input.
- ⚠️ **Implication for K2 spawn-record envelope**: to capture `axioms.permissions_snapshot` (Reputation-as-Snapshotted-Axiom analog for permissions), K2 must perform the settings.json resolution itself, including the user-global → project-local → project-local-untracked precedence walk.

**Verdict**: ⚠️ **PARTIAL PASS** — hook payload is sufficient to know the permission MODE, but NOT the active allow/deny set. K8 and K2 must own the settings.json read + resolution themselves.

**Follow-up needed (deferred to v3.1 implementation)**: empirically verify that the permission-mode value passed to the hook reflects the EFFECTIVE mode for the SPAWNED sub-agent's tool calls, not just the parent's. (Hard to test without a fixture that toggles permission_mode mid-spawn.) Documented as v3.1 implementation acceptance criterion, not a Wave -1 blocker.

---

## P-EscapeHatch

**Hypothesis**: Setting `LOOM_DISABLE_WORKTREE=1` in the environment causes K1's worktree allocation to be bypassed — the sub-agent inherits the parent's working tree instead. K10 (the escape hatch) is empirically real, not just designed.

**Method**: N/A — **untestable in Wave -1.** `LOOM_DISABLE_WORKTREE` is a *Loom-controlled* env var that K1 would read to decide whether to allocate a worktree. K1 does not exist yet: worktree allocation today is Anthropic-native (the `isolation: "worktree"` flag on the Agent tool), and Loom does not gate it. There is therefore no Loom code path to disable and nothing for the env var to short-circuit. Probing it now would only confirm that an unimplemented mechanism is unimplemented.

**Findings**: deferred to v3.0-alpha (once K1 lands the escape hatch becomes a real, testable code path).

**Verdict**: ⏸️ **DEFERRED-TO-V3.0-ALPHA** — promoted from a Wave -1 probe to a **K1/K10 implementation acceptance criterion**.

**Acceptance criterion (carried into v3.0-alpha)**: once K1 orchestrates worktree allocation, a spawn invoked with `LOOM_DISABLE_WORKTREE=1` MUST inherit the parent's working tree (no worktree allocated) AND emit a Class-4 audit event recording the bypass, per K10's escape-hatch pattern. This is verified as part of v3.0-alpha's acceptance suite (§7 v3.0-alpha row: "escape hatch … empirically verified"), not as a Phase 0 dependency.

**Why this does NOT block Phase 0**: Phase 0 is a mechanical workspace restructure (`git mv` + `_lib/` DAG refactor). It adds no kernel code and does not exercise the escape hatch. The deferral is orthogonal to the restructure.

---

## P-HookChain

**Hypothesis**: When K8's capability-injection hook is registered alongside existing PreToolUse(Agent) hooks (contract-reminder, route-decide), they execute in deterministic order; cumulative rewrites compose; one hook's `updatedInput` is visible to subsequent hooks in the chain.

**Method**: Installed a second injection hook (`probe-inject-B.js`) alongside probe-inject.js. Both emit `updatedInput` with different markers (MARKER_A and MARKER_B). Spawned agent and asked it to report which markers appear in its received prompt + their order.

**Findings (2026-05-26, agent id `afd40cab0c96200c7`; route-decide + contract-reminder also active as plugin hooks)**:

1. ✅ **All hooks DO fire** in a multi-hook chain. probe-inject-B fired at 12:12:57.096Z; probe-inject (A) fired at 12:12:57.098Z; route-decide (plugin) fired at 12:12:57.136Z. All three left log entries.

2. ❌ **Hooks do NOT compose cumulatively.** Each hook receives the ORIGINAL `tool_input` independently — NOT the cumulative result of prior hooks' updatedInputs. Evidence:
   - probe-inject (A) logged `original_prompt_first_120` matching the user-provided prompt verbatim (no MARKER_B prefix). MARKER_B was emitted by hook B but A never saw it.
   - route-decide logged `task_excerpt` matching the user-provided prompt verbatim (no MARKER_A, no MARKER_B). Despite firing 40-90ms AFTER both injection hooks, it saw the original.
   - Hook B's log of `incoming_prompt_first_120` also matched original prompt (the `saw_marker_A: true` field is a false positive — the literal marker text was IN the user-provided prompt as part of probe instructions; B did not actually see A's rewrite).

3. ❌ **Only ONE `updatedInput` is honored when multiple hooks emit it.** Agent reported `MARKER_A_COUNT: 1, MARKER_B_COUNT: 0, ORDER: A_ONLY`. Hook B's updatedInput was silently dropped.

4. ⚠️ **Which hook "wins" is not yet fully characterized.** In this run, hook A (registered first in settings.json `PreToolUse[0]`) won. Possible rules:
   - **First-registered wins**: A at index 0 took precedence over B at index 1. Plausible.
   - **Last-completed-write wins**: A completed log-write at 12:12:57.098Z (2ms after B at .096Z). If the LATER-completing hook wins, that's consistent.
   - These two rules are observationally indistinguishable from one probe. A follow-up probe with reverse registration order would disambiguate — left for v3.0-alpha implementation.

5. ⚠️ **Plugin hooks DO compose with user-global settings.json hooks**. route-decide (plugin) and probe-inject (user-global) both fired for the same Agent invocation. So K8 installed as a plugin hook would coexist with user-global hooks; the question of WHICH updatedInput wins applies cross-source as well as within source.

**Verdict**: ⚠️ **PARTIAL PASS — composition semantics are WORSE than the v4 spec assumed.**

The v4 K8 design implicitly assumed hooks COULD compose cumulatively (hook B reads hook A's updatedInput, applies further rewrite, etc.). Empirically: they don't. Each hook sees the original tool_input; only one updatedInput is honored; the others are discarded silently.

**Forced implications for v3.1 K8 design**:
- **K8 must be the EXCLUSIVE PreToolUse(Agent) hook that emits `updatedInput`** for capability-injection. Other hooks (route-decide, contract-reminder, etc.) must be read-only / observability-only OR K8 must absorb their injection responsibilities.
- The existing `contract-reminder-on-agent-spawn.js` DOES emit a prompt-rewrite (it prepends the contract reminder). **If K8 is added alongside it, ONE of them will silently lose.** This forces a v3.1 unification: either contract-reminder is rewritten as a read-only hook and K8 absorbs the contract-prepend functionality, OR a single hook combines both responsibilities.
- **New OQ-16**: in v3.1, do we merge contract-reminder + K8 into a single PreToolUse(Agent) hook (~400-600 LoC, single responsibility), OR keep them separate and accept that contract-reminder becomes read-only (and the contract-text must be injected via a different mechanism, e.g. spawn-init system-prompt rewrite)?

This is a real spike payoff — would NOT have been caught by document review.

---

## P-WriteScope

**Hypothesis**: A sub-agent spawned with `isolation: "worktree"` cannot write outside its allocated worktree — attempts to `Edit` / `Write` files in the parent worktree either fail at the tool layer, are silently no-op'd, or are detectable post-hoc via `git stash` diff against the sub-agent's worktree.

**Method**: Spawn `general-purpose` agent with `isolation: "worktree"`. Have it attempt 8 writes/reads at varying scopes: inside worktree (control), parent project root, /tmp, sibling repo, and Bash-echo to the same. Findings recorded in `p-writescope-findings.md`.

**Findings (2026-05-26, agent id `a9b4956b00a618ac2`)**:

| # | Action | Result |
|---|---|---|
| 1 | `pwd` (control) | SUCCESS — worktree path observed |
| 2 | Write inside worktree (control) | SUCCESS |
| 3 | **Write to parent's project root** (absolute path) | **SUCCESS — no error, no prompt** |
| 4 | **Write to /tmp** | **SUCCESS — no error, no prompt** |
| 5 | **Write to sibling repo (`claude-toolkit/`)** | **SUCCESS — cross-repo write, no error** |
| 6 | **Bash-write to parent's project root** | **SUCCESS — `echo > path` worked, 0 stderr** |
| 7 | **Bash-write to /tmp** | **SUCCESS** |
| 8 | **Read outside worktree** | **SUCCESS — toolkit file read** |

**Verdict**: ❌ **FAIL — worktree isolation is NOT a write sandbox.**

The worktree is a git-mechanism boundary, NOT a filesystem-permission boundary. An isolated sub-agent can read AND write ANYWHERE the parent's user account can — parent's project, sibling repos, /tmp, anywhere on the user's home directory.

**This refutes a load-bearing v4 assumption.**

A1 "Transactional Determinism — filesystem delta is the truth" was implicitly assuming the worktree was the transaction boundary. Empirically: writes leak. Any out-of-worktree write made by a sub-agent is silently invisible to the parent's `git stash`-based delta capture — it lands on disk but doesn't show up in the transaction's recorded delta.

**Implications for v3.0-alpha** (forced revisions):

1. **K9 promote-deltas needs an out-of-scope-write DETECTOR**, not just a delta cherrypick mechanism. Detection options:
   - (a) Pre-spawn snapshot of mtime + size for parent's working tree; post-spawn diff against snapshot detects unrequested writes.
   - (b) Filesystem-level audit via fswatch / fanotify on parent paths during spawn lifetime.
   - (c) Post-hoc reconciliation: walk the parent's working tree and any "sibling" paths the agent is known to have access to, looking for files modified during the spawn window.
   - None of these is free. ~150-300 LoC added to K9 estimate.

2. **A1 axiom needs to be restated**: filesystem delta within the worktree is the transaction; out-of-scope writes are a kernel-detected POLICY violation that triggers spawn-state rejection, NOT a silent leak. The worktree provides a NATURAL HOME for in-scope writes (git tracks them cleanly via `git stash create`), but does NOT enforce a sandbox boundary.

3. **K1 worktree allocation is necessary-but-not-sufficient** for transaction isolation. The plan was treating it as sufficient. It's not.

4. **NEW primitive needed — K14 Write-Scope Enforcer** (proposed): pre-spawn snapshots parent's working tree (and known sibling paths); post-spawn diffs and rejects/audits any out-of-scope changes. ~200-400 LoC. Belongs in v3.0-alpha (cannot defer — A1's integrity depends on it).

5. **Bash subprocess is the worst offender**: Bash spawns with the user's full ambient permissions. Even if `Write` / `Edit` were tool-layer-sandboxed in some future Claude Code release, Bash `echo > /anywhere` would still leak. K14 detection must run at the filesystem layer, not the tool layer.

**Implications for v4 substrate spec**:
- A1 wording must be amended: "filesystem delta within the worktree is the transaction" (was implicitly "the worktree IS the transaction").
- K9 LoC estimate increases ~150-300 LoC for write-scope detection.
- K14 added as a new v3.0-alpha primitive (was not in the v4 spec).
- v3.0-alpha effort estimate increases: +6-12h for K14 implementation + K9 detection wiring.
- The abort trigger we just added (>60h v3.0-alpha) is now MORE likely to fire — this finding alone pushes the estimate from 20-28h to 26-40h before further surprises.

**Cleanup verification**: all 5 leaked marker files removed post-probe (`rm` confirmed 5 paths gone).

---

## OQ-11 — Full validators vs slim predicates for leaf criteria

**Decision required at Wave -1 design session per Round-3 planner HIGH.**

**Trade-off**: full validators (~300-400 LoC per criterion, 5 criteria, ~1,500-2,000 LoC total) vs slim predicates (~50-80 LoC per criterion, ~250-400 LoC total). 2-3× LoC swing on the single largest v3.2 component.

**Resolution (2026-05-26): ✅ DECIDED — SLIM PREDICATES.** Confirms and matches the blueprint v4.2 §11 OQ-11 lock (already BLUEPRINT-LOCKED through v5.4); this entry records the Wave -1 evidence behind that lock so the probe doc's exit gate is self-contained.

**Wave -1 evidence supporting slim predicates**:
- **P-HookChain** proved K8 must be the *exclusive* `updatedInput` injector (hooks do not compose; only one `updatedInput` is honored). There is no room for layered/chained validators in the PreToolUse path.
- **P-WriteScope** forced K14 to own filesystem-layer write-scope detection — full validators would duplicate detection logic already required in K9 + K14.
- Slim predicates (~250-400 LoC) compose cleanly with K8/K14; full validators (~1,500-2,000 LoC) would both duplicate that work and tighten the v3.2 effort table upward for no benefit.

**Final lock** confirmed at v3.2 kickoff per the blueprint, but carried as the locked default into all intervening planning (v3.2 effort table already tightened to 1,200-1,600 LoC on this basis).

---

## Carry-forward / Open

- If ANY probe FAILS, flag in `swarm/thoughts/shared/design/v3.3-substrate-synthesis.md` §11 (Open Questions) and re-plan v3.0-alpha before Phase 0.
- Composition of `git stash`-based delta capture with worktree isolation (validated in P4 already, but re-confirm under Wave -1's actual workflow).
- Plugin hook visibility: only PARENT-installed hooks fire for sub-agents per RFC v3.2 §"Pivot 1" — Wave -1 should empirically reconfirm this in P-Settings.

---

## Handoff — what's done, what's left

**Done in this session (6 of 7 probes; 3 PASS, 2 PARTIAL, 1 FAIL)**:
- ✅ P-Worktree — PASS with 3 caveats (no auto-clean; retry-on-collision; session-root binding)
- ✅ P-DepthOne — PASS, depth-1 enforced at tool-registry layer (strong guarantee)
- ❌ P-WriteScope — **FAIL** — worktree is NOT a write sandbox; forces v4 revision (K14 new + K9 detector + A1 restated)
- ✅ P-Inject — PASS, `updatedInput` honored when wrapped in `hookSpecificOutput`
- ⚠️ P-Settings — PARTIAL PASS, hook payload has permission_mode but NOT allow/deny lists; K2 must read settings.json itself
- ⚠️ P-HookChain — PARTIAL, hooks DO NOT compose; each sees original tool_input; only ONE updatedInput is honored. Forces OQ-16 (merge or split contract-reminder + K8).

**Remaining (both CLOSED 2026-05-26 — Wave -1 exit gate now SATISFIED)**:
- ⏸️ P-EscapeHatch — **CLOSED as DEFERRED-TO-V3.0-ALPHA.** Untestable before K1 exists (no Loom-controlled worktree allocation to bypass); promoted to a K1/K10 acceptance criterion verified in v3.0-alpha's acceptance suite. Does not block Phase 0. See §P-EscapeHatch.
- ⏳ OQ-11 decision — **CLOSED to SLIM PREDICATES**, matching the blueprint v4.2 §11 lock. See §OQ-11 for the Wave -1 evidence.

**OQ-11 decision rationale (informed by Wave -1; now recorded in §OQ-11)**:

The probe data confirms **slim predicates** for v3.2:
- P-HookChain showed K8 must be exclusive injector — no room for layered validators
- P-WriteScope showed K14 needs filesystem-layer detection, NOT validator chains
- Slim predicates (~250-400 LoC total) compose with K8/K14 cleanly; full validators (~1,500-2,000 LoC) would duplicate detection logic already needed in K9+K14
- Final lock confirmed at v3.2 kickoff per blueprint; carried as the locked default (v3.2 effort table already at 1,200-1,600 LoC on this basis).

**Self-improve candidates from this wave**:
- Always check session-root vs working-repo BEFORE designing isolation-dependent primitives. Worktrees bind to session-root, not to the directory you're "working in".
- A1's "filesystem-delta-as-truth" needs explicit boundary scoping. The worktree is a delta CONTAINER for in-scope writes; it is not a SANDBOX for out-of-scope ones.
- Hook composition is non-cumulative: each PreToolUse hook sees the original tool_input, only one updatedInput is honored. Any v3 mechanism that assumed hook-chain composition (K8 + contract-reminder co-existing as injectors) must be re-architected as either (a) a single unified hook or (b) one injector + N read-only observers.
- The `hookSpecificOutput` wrapper for `updatedInput` is REQUIRED — naive `{updatedInput: ...}` is silently ignored. v3 spec must document this exactly.
- 6 probes ran in ~30 min of conversation time; document review for 6 hours would NOT have caught P-WriteScope FAIL, P-HookChain non-composition, or P-Settings allow/deny absence. Gemini's "go directly to Wave -1" recommendation was empirically correct.

**Probe artifacts captured**:
- `wave-neg-1-evidence/probe-inject-A-log.json` — hook input payload structure
- `wave-neg-1-evidence/probe-inject-B-log.json` — second-hook input + saw_marker_A field
- `wave-neg-1-evidence/p-hookchain-agent-observation.txt` — agent's observed prompt after 2-hook chain
- `p-depthone-findings.md` — sub-agent tool inventory
- `p-writescope-findings.md` — 8-test write-scope matrix
