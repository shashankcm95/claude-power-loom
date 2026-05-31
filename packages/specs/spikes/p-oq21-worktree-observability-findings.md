# P-OQ21 — Harness Worktree-Observability Empirical Findings

**Probe**: Can a `PostToolUse:Agent|Task` close hook observe the harness-created
`isolation:"worktree"` filesystem delta — its path, branch, and the changes the
sub-agent made — at hook-fire time?
**Date**: 2026-05-31
**Resolves**: OQ-21 (v3.1 plan PR-3a; the gate on PR-3b enforcement mode).
**Verdict**: **YES — GO for enforcing/detection mode** (observe-the-contained-delta),
with one honest scope caveat (worktree ≠ security sandbox; see §6).
**Evidence**: `packages/specs/spikes/p-oq21-capture.jsonl` (raw headless hook payloads).

---

## TL;DR

The harness hands the close hook **more** than the spike hoped. The `PostToolUse:Agent`
payload's structured `tool_response` object directly contains `worktreePath`,
`worktreeBranch`, `agentId`, and a `toolStats` delta summary — and at hook-fire time the
worktree is **live on disk** with the sub-agent's changes readable via `git -C <worktreePath>`.
No path-discovery heuristic is needed. The earlier assumption that the close hook might see
only the sub-agent's *text claims* (shadow-only) is **falsified**: it can see the real delta.

**One caveat, not a blocker:** `p-writescope-findings.md` (Wave -1) already proved the
worktree is **not** a write-containment boundary — a sub-agent escapes it via absolute paths
silently. So "enforcing" means *the kernel can observe & decide (PROMOTE/REJECT) on the
**in-worktree** delta*, which is real. It does **not** mean all sub-agent writes are contained
or seen. Out-of-worktree side-effects remain an undetected escape (§6, follow-up).

---

## Method

Two independent probes + one prior-evidence cross-reference. Per the ADR-0012 discipline
("empirically probe an assumed harness capability before building enforcement on it"), this
spike **proves**, it does not infer from docs.

**Probe 1 — interactive (this real session).** Spawned a `general-purpose` Agent with
`isolation:"worktree"` via the Agent tool; it reported its cwd/git state and wrote a marker
file; then the parent inspected the filesystem post-close. Faithful to the actual environment
where v3.1 spawns happen.

**Probe 2 — headless (`claude -p`), controlled-hook.** A throwaway capture hook registered on
**both** `PreToolUse` and `PostToolUse` for `Agent|Task` in a clean temp git repo, driven by
`claude -p ... --settings <throwaway> --dangerously-skip-permissions --model sonnet`, forcing
one `isolation:"worktree"` Agent spawn. The hook dumped the full payload + a live
`git worktree list` at fire time. This isolates "does the close hook fire and what does it
see" from any installed-plugin state.

**Why Probe 2 was necessary (a confound, ruled out).** Probe 1's spawn produced **no**
`spawn-record.js` envelope, which first looked like "the close hook doesn't fire." Diagnosis:
the **active installed plugin is v2.9.1** (`~/.claude/plugins/cache/power-loom-marketplace/power-loom/2.9.1/`),
which **predates the entire v3.x kernel and has no `spawn-record.js`**. The non-fire was
**version skew**, not a harness limitation. Probe 2 (own hook, guaranteed registered) confirms
the close hook fires.

---

## Evidence

### The decisive payload — `PostToolUse:Agent` `tool_response` (Probe 2, verbatim excerpt)

```json
{
  "status": "completed",
  "agentId": "a5a0e9fe0135ccbc2",
  "agentType": "general-purpose",
  "content": [{ "type": "text", "text": "pwd: /private/tmp/oq21probe2/repo/.claude/worktrees/agent-a5a0e9fe0135ccbc2 ..." }],
  "toolStats": { "readCount": 0, "bashCount": 1, "editFileCount": 1, "linesAdded": 1, "linesRemoved": 0, "otherToolCount": 0 },
  "worktreePath": "/private/tmp/oq21probe2/repo/.claude/worktrees/agent-a5a0e9fe0135ccbc2",
  "worktreeBranch": "worktree-agent-a5a0e9fe0135ccbc2",
  "totalDurationMs": 8763, "totalTokens": 17877
}
```

At that same `PostToolUse` fire, the hook's own `git worktree list --porcelain` returned the
worktree **live**, and `find` located the sub-agent's `CHANGED_marker.txt` on disk inside it.

### Worktree lifecycle (Probe 1, interactive)

`git worktree list --porcelain` post-close:

```
worktree .../claude-toolkit/.claude/worktrees/agent-a08a13ee3be8b7d0a
HEAD dc9369d...   branch refs/heads/worktree-agent-a08a13ee3be8b7d0a
locked claude agent agent-a08a13ee3be8b7d0a (pid 97258)
```

- The worktree **persists** after the agent returns (consistent with last session having to
  manually `git worktree remove` stale `.claude/worktrees/wf_*` dirs).
- It is **locked** with a reason string embedding **agentId + pid** — a built-in
  provenance/correlation channel, robust under concurrency.
- It is on a dedicated branch `worktree-agent-<id>` sharing the **main repo's `.git`** object
  store (`git-common-dir` = main `.git`).
- The parent's main working tree stayed **clean** — the harness does **not** auto-merge the
  worktree back; the delta lives on the branch until someone merges or discards it.

---

## Does the close hook observe the delta? (point by point)

| Question | Answer | Evidence |
|---|---|---|
| Does `PostToolUse:Agent` fire on an `isolation:worktree` spawn? | **Yes** | Probe 2 capture LINE 2, `event=PostToolUse tool=Agent` |
| Is the worktree **path** in the payload? | **Yes** — `tool_response.worktreePath` | Probe 2 (structured) + Probe 1 (result footer) |
| The branch to diff/merge? | **Yes** — `tool_response.worktreeBranch` | both probes |
| A delta summary? | **Yes** — `tool_response.toolStats` (`editFileCount`, `linesAdded/Removed`) | Probe 2 |
| Is the worktree **live on disk** at fire time? | **Yes** — `git worktree list` + file `find` both hit | Probe 2 hook-time capture |
| Full delta readable (not just summary)? | **Yes** — `git -C <worktreePath> status/diff` works (shared `.git`) | Probe 1 + 2 |
| Provenance / correlation under concurrency? | **Yes** — `agentId` in payload == dir name == branch == lock reason | both probes |

Every input PR-3b's resolver needs (`envelope.worktree_root`, a readable delta, a correlation
key) is present **at the close hook**, in the structured payload.

---

## Cross-validation: worktree ≠ security sandbox (Wave -1)

`p-writescope-findings.md` (2026-05-26) established, empirically, that a sub-agent running in an
`isolation:worktree` worktree can write to the **parent tree**, **/tmp**, and **sibling repos**
via both the Write tool and Bash — **no permission prompt, no error**. The worktree is the
sub-agent's default cwd, **not** an enforced jail.

Combined with this spike:

- **In-worktree (relative-path) writes** → land in the worktree → **observable** in its git
  delta → kernel can PROMOTE/REJECT them. ✅
- **Out-of-worktree (absolute-path) writes** → hit the real filesystem directly → **not** in
  the worktree delta → already happened by close time → **not contained, not observed** by this
  mechanism. ⚠️ (separate detection problem; see follow-ups)

So "enforcing mode" is honest as: **observe the agent's intended (contained) delta and decide
whether to promote it.** It is *not* "the sub-agent is sandboxed."

---

## Verdict & implications for PR-3b

**GO — enforcing/detection mode (not shadow-only).** The close hook can build a *real*
`k14_ctx` from the observed worktree delta and call `resolve()` with a populated
`envelope.worktree_root = tool_response.worktreePath`.

Design consequences the PR-3b plan should absorb (each is a simplification or an honesty fix):

1. **Observe, don't allocate (K1 is redundant for this path).** The harness *already* creates
   the worktree and hands back its path. The plan's `spawn-init-worktree.js` calling K1
   `allocateWorktree()` to make a worktree the spawn writes into is **moot** — ADR-0012 already
   proved the kernel can't inject its path into the spawn, so a kernel-allocated worktree is an
   orphan nobody writes to. PR-3b's close hook should **read `tool_response.worktreePath`**, not
   allocate. This likely **drops** the pre-spawn allocator and revisits the "K1 first-reader /
   `dormancy-assertion-k1` flip" story (the real first reader is the close hook over the
   *harness* worktree). **Probe before building the allocator path.**
2. **PROMOTE = merge `worktreeBranch` into the parent; REJECT = discard the branch + remove the
   worktree.** The harness does not auto-merge (Probe 1: main stayed clean), so PROMOTE is a
   real `git merge worktree-agent-<id>` (via K9), and REJECT means the contained writes never
   reach main. This is genuine enforcement *for the contained delta*.
3. **Cleanup is the kernel's job.** Worktrees **accumulate** (persist + locked). On REJECT — and
   arguably on PROMOTE-after-merge — the resolver/recovery-sweep must `git worktree remove` +
   delete the branch, or hygiene rots (we hit this manually last session). Lock must be released
   first (`git worktree unlock` / `remove --force`).
4. **Correlate via `agentId`.** Map the close payload to its worktree with
   `tool_response.agentId` (== dir suffix == branch == lock reason). Covers the K13 concurrency
   case (multiple live worktrees).
5. **Do NOT claim full write enforcement.** Scope the claim to the in-worktree delta; record the
   out-of-worktree absolute-path escape (Wave -1) as a known, currently-undetected gap.

---

## Bonus findings (each independently useful)

- **`isolation` IS visible in `tool_input`** (`tool_input.isolation: "worktree"`, both Pre and
  Post) — *unlike* `tools`, which ADR-0012 found absent. So a **pre**-spawn hook *can* detect
  that a spawn requested worktree isolation and branch logic on it (useful for K13 admission /
  conditional observation). Notable asymmetry vs ADR-0012's `tools`-is-absent result.
- **`tool_use_id`** is present in the payload **pre and post** (`toolu_01KgFge6...`) — confirms
  R13's idempotency-key source (PR-4 keys off the harness `tool_use_id`, not the minted
  `spawn_id`).
- **`cwd` is non-null** for real spawns (`/private/tmp/oq21probe2/repo`). The `cwd:null` in the
  May-25 `spawn-record` was an artifact of the synthetic 6-char smoke, not the real shape.
- **Payload top-level keys** (Post): `session_id, transcript_path, cwd, permission_mode, effort,
  hook_event_name, tool_name, tool_input, tool_response, tool_use_id, duration_ms`.

---

## Residual / follow-ups (not blockers)

- **Out-of-worktree write detection** (the Wave -1 escape): a full-FS or parent-tree diff would
  be needed to catch absolute-path writes; out of scope for PR-3b's worktree-delta path. Track
  as its own OQ.
- **Timing guarantee**: confirmed the worktree is live at the *first* close-hook fire; the
  ordering of harness worktree-teardown vs. multiple PostToolUse hooks on the same matcher was
  not stress-tested. PR-3b should read the delta defensively (fail-soft if the path is already
  gone) rather than assume permanence.
- **Interactive `toolStats`**: confirmed present in the *headless* structured `tool_response`;
  the interactive result *footer* renders a subset (path/branch/agentId). PR-3b consumes the
  structured field, so this is immaterial, but noted for precision.

---

## Reproduction

- Probe 2 harness: `/tmp/oq21probe2/` (`post-hook.js`, `settings.json`, `repo/`) — ephemeral.
- Raw captured payloads (durable): `packages/specs/spikes/p-oq21-capture.jsonl`.
- Command shape: `claude -p "<force one isolation:worktree Agent spawn>" --settings
  /tmp/oq21probe2/settings.json --dangerously-skip-permissions --model sonnet`.
