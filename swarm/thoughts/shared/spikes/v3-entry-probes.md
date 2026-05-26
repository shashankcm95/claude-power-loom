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
| P-Inject | `PreToolUse(Agent).updatedInput` rewrites tool_input; size limits | ⏳ PENDING | — | — |
| P-Settings | settings.json `permissions.allow` applies to spawn-init's PreToolUse context for the spawned sub-agent | ⏳ PENDING | — | — |
| P-EscapeHatch | `LOOM_DISABLE_WORKTREE=1` actually bypasses K1 as documented | ⏳ PENDING | — | — |
| P-HookChain | K8 composes with existing PreToolUse(Agent) hooks; execution order + cumulative-rewrite semantics | ⏳ PENDING | — | — |
| P-WriteScope | spawned agent attempting to write outside its allocated worktree fails / blocked / detected | ✅ DONE | ❌ **FAIL — writes leak everywhere** | agent `a9b4956b00a618ac2`; `p-writescope-findings.md`; §P-WriteScope |
| **OQ-11 decision** | full validators vs slim predicates for leaf criteria (2-3× LoC swing on v3.2) | ⏳ PENDING | — | — |

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

**Method**: TBD.

**Findings**: TBD.

**Verdict**: TBD.

---

## P-Settings

**Hypothesis**: A spawn-init PreToolUse hook that reads `settings.json` `permissions.allow` and uses those values to scope the spawned sub-agent's tool access actually receives the right permission set for the SPAWNED agent's context (not the parent's).

**Method**: TBD.

**Findings**: TBD.

**Verdict**: TBD.

---

## P-EscapeHatch

**Hypothesis**: Setting `LOOM_DISABLE_WORKTREE=1` in the environment causes K1's worktree allocation to be bypassed — the sub-agent inherits the parent's working tree instead. K10 (the escape hatch) is empirically real, not just designed.

**Method**: TBD.

**Findings**: TBD.

**Verdict**: TBD.

---

## P-HookChain

**Hypothesis**: When K8's capability-injection hook is registered alongside existing PreToolUse(Agent) hooks (contract-reminder, route-decide), they execute in deterministic order; cumulative rewrites compose; one hook's `updatedInput` is visible to subsequent hooks in the chain.

**Method**: TBD.

**Findings**: TBD.

**Verdict**: TBD.

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

**Resolution**: TBD after probe results inform what runtime hooks are realistically composable.

---

## Carry-forward / Open

- If ANY probe FAILS, flag in `swarm/thoughts/shared/design/v3.3-substrate-synthesis.md` §11 (Open Questions) and re-plan v3.0-alpha before Phase 0.
- Composition of `git stash`-based delta capture with worktree isolation (validated in P4 already, but re-confirm under Wave -1's actual workflow).
- Plugin hook visibility: only PARENT-installed hooks fire for sub-agents per RFC v3.2 §"Pivot 1" — Wave -1 should empirically reconfirm this in P-Settings.

---

## Handoff — what's done, what's left, what blocks

**Done in this session (3 of 7 probes; biggest empirical finding so far)**:
- ✅ P-Worktree — PASS with 3 caveats (no auto-clean; retry-on-collision; session-root binding)
- ✅ P-DepthOne — PASS, depth-1 enforced at tool-registry layer (strong guarantee)
- ❌ P-WriteScope — **FAIL** — worktree is NOT a write sandbox; forces v4 revision (K14 new + K9 detector + A1 restated)

**Remaining probes (4 of 7) + 1 decision**:
- ⏳ P-Inject — needs PreToolUse(Agent) fixture hook installed on the session's active settings.json
- ⏳ P-Settings — needs settings.json permission scoping fixture
- ⏳ P-EscapeHatch — BLOCKED on K1 prototype existing (LOOM_DISABLE_WORKTREE has nothing to bypass yet)
- ⏳ P-HookChain — needs K8-shaped fixture hook + composition with existing route-decide + contract-reminder hooks
- ⏳ OQ-11 decision — informed by P-Inject + P-HookChain results

**Session-context constraint identified**: this Claude Code session is rooted in `portfolio-website-builder`, but the v3 substrate work + toolkit hooks live in `/Users/.../claude-toolkit/`. Hook-installation probes (P-Inject, P-Settings, P-HookChain) need a Claude Code session launched FROM the toolkit so the toolkit's hooks.json is the active one. Doing them from portfolio-rooted session would pollute portfolio's settings.

**Recommended next-session sequence**:
1. Open a fresh Claude Code session in `/Users/.../claude-toolkit/`
2. Read this file + `p-writescope-findings.md` + `p-depthone-findings.md` for context
3. Update v4 spec for P-WriteScope FAIL (A1 restatement + K14 added + K9 LoC bump + abort-trigger note)
4. Run P-Inject as a Bash + Write-tool probe: create a temp `~/.claude/hooks/scripts/probe-inject-rewrite.js` that emits `{updatedInput: {prompt: "REWRITTEN"}}` on PreToolUse(Agent); wire it in via temporary settings.json edit; spawn an agent; observe whether its prompt was the rewritten one
5. Run P-HookChain: install probe alongside existing PreToolUse(Agent) hooks; observe execution order + whether one hook's updatedInput is visible to the next
6. Run P-Settings: configure permissions.allow with a fixture entry; spawn agent; observe whether the spawn-init PreToolUse hook context reflects the sub-agent's effective permission set
7. Defer P-EscapeHatch to v3.0-alpha implementation (cannot probe before K1 exists)
8. OQ-11 decision after P-Inject + P-HookChain land

**Self-improve candidates from this wave**:
- Always check session-root vs working-repo BEFORE designing isolation-dependent primitives. Worktrees bind to session-root, not to the directory you're "working in".
- A1's "filesystem-delta-as-truth" needs explicit boundary scoping. The worktree is a delta CONTAINER for in-scope writes; it is not a SANDBOX for out-of-scope ones. These are different load-bearing properties.
- One empirical FAIL early (P-WriteScope after 2 PASSes) is exactly the spike payoff. Round-4 doc review would NOT have surfaced this. Gemini's "go directly to Wave -1" recommendation was correct.
