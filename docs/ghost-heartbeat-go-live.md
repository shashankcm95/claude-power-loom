# Ghost Heartbeat -- go-live runbook

> The single forward contract for turning the advisory drift heartbeat ON. Today the
> heartbeat is **built, schedulable, and DEFAULT-OFF -- it is NOT live**. This runbook
> consolidates the go-live preconditions (previously scattered across five plan files +
> MEMORY) surfaced by the Wave-2 `/phase-close` (2026-06-20, `CLOSEABLE-WITH-NOTES`).

## What it is

An **advisory, draft-only, default-OFF** drift-detection heartbeat: a capability-free
`claude -p` judge classifies process/quality drift in a session transcript against a FROZEN
taxonomy, and a deterministic wrapper `bump`s an **advisory counter** (never an action, never a
rule mutation -- *narrows-not-hardens*; `integrity != provenance` unchanged). Promotion stays
**human-gated** (the existing `/self-improve` path).

Integrated arc (5 merged PRs): #367 STORE+SURFACE -> #369 capability-free EMIT producer
(`drift-audit.js`) -> #371 Stop-hook carrier (realtime, best-effort) -> #373 drain runner
(unattended backstop) -> #375 `install.sh` launchd/cron scheduler offer.

## Two carriers, one producer

- **Stop-hook carrier** (`hooks/lifecycle/ghost-heartbeat-stop.js`): realtime, best-effort.
  Fires the producer on an opted-in turn end as a detached child (debounced per session). Its
  detached child *may* be reaped by the harness -- which is why the runner exists.
- **Drain runner** (`spawn-state/ghost-heartbeat-run.js`): the unattended drain path + the
  reaping backstop (the real runner-to-judge end-to-end is gated to a post-install dogfood --
  precondition (e)). Scheduled via `--schedule-heartbeat` (launchd/cron). Scans
  `~/.claude/projects` directly.

Both converge on ONE shared `withLockSoft` + `isEmitted` critical section
(`ghost-heartbeat-state.js`), so concurrent firing cannot double-emit. **Invariant: never let a
future carrier pass a different `statePath` without sharing the lock**, or the mutual exclusion
silently breaks.

## Current state (verify before relying on it)

- Plugin version **3.11.0**; Wave 2 shipped without a version bump (a feature arc, not a
  release). A locally-installed plugin cache OLDER than 3.11.0 lacks the ghost-heartbeat files.
- **Default-OFF**: every entry point returns unless `GHOST_HEARTBEAT_EMIT=1`. Two killswitches:
  the `GHOST_HEARTBEAT_DISABLED=1` env var (interactive path) AND a home-readable touch-file
  `~/.claude/checkpoints/ghost-heartbeat.disabled` (the scheduled minimal-env path, which does
  not see your shell profile).

## GO-LIVE preconditions (do ALL before flipping `GHOST_HEARTBEAT_EMIT=1`)

None of these block today (the feature is default-OFF + narrows-only); they are the contract for
making it safely reachable.

- **(a) Deployment templates agree.** `settings-reference.json` (the manual-merge template) now
  carries the `stop:ghost-heartbeat` Stop entry, mirroring `hooks.json`; a unit test
  (`tests/unit/kernel/settings-reference-stop-consistency.test.js`) locks the agreement. *Done in
  this PR.*
- **(b) Plugin cache is current.** Run `claude plugin update` to >=3.11.0 and verify
  `ghost-heartbeat-stop.js` is present in the installed cache (`ls
  ~/.claude/plugins/cache/.../packages/kernel/hooks/lifecycle/ghost-heartbeat*`). Until then the
  realtime Stop carrier does not fire (the manifest path deploys it only on update).
- **(c) The emitted-set retention bound is wired (PR-B).** *Done.* The runner now prunes the
  emitted-set (superset-safe, default-KEEP, K>=2 absences past a 24h floor) and GCs the Stop-hook
  markers, so continuous operation is bounded. See the closed design summary below.
- **(d) The capability-free guarantee is freshly probed.** Run the G3 sentinel-leak test with a
  real `claude` on PATH (CI cannot -- it self-skips). The flags are CLI-version-dependent; a
  real-`claude` G3 pass is the go-live gate, not a continuous CI guarantee. The model is now
  overridable via `GHOST_HEARTBEAT_JUDGE_MODEL` (defaults to the pinned cheap model).
- **(e) Real end-to-end dogfood (the mock-vs-real gap).** The unit tests mock the judge. Before
  trusting it unattended, run BOTH real paths once and record the result:
  - **Stop:** with `GHOST_HEARTBEAT_EMIT=1`, end a turn; confirm a detached `drift-audit.js`
    child spawns and survives the harness reaping, and that an emit fires.
  - **Cron/launchd:** a real scheduled fire on a clean minimal-PATH environment (the absolute
    `process.execPath` baking was added precisely so launchd/cron's minimal PATH resolves node;
    the scheduled read path is still unexercised live).
- **(f) Honesty defects closed.** *Done in this PR:* the stale "marker = PR-3 drain queue"
  comment, the `drift-audit.js` "mismatch rejected" comment, the run.js "GUARANTEED" overclaim,
  and the RFC "guarded by a CI regression test" overclaim are all corrected.

## How to turn it on / off (after the preconditions)

```bash
bash install.sh --schedule-heartbeat      # enable: launchd (macOS) / cron (Linux), every 4h
bash install.sh --unschedule-heartbeat    # disable: remove the scheduled task
touch ~/.claude/checkpoints/ghost-heartbeat.disabled   # pause without unscheduling
rm    ~/.claude/checkpoints/ghost-heartbeat.disabled   # resume
```

## Closed design -- PR-B: the emitted-set retention bound (shipped)

Full plan + the VERIFY/VALIDATE boards:
`packages/specs/plans/2026-06-20-ghost-heartbeat-w2-prB-retention-bound.md`.

The emitted-set is the **double-emit correctness boundary** (a class converges only across
DISTINCT sessions), so a wrong prune un-dedups a session and over-counts convergence. The naive
"keep the sessions of all present transcripts" was proven UNSAFE by the pre-build VERIFY board
(key-space mismatch: the emitted-set is keyed by the in-content sessionId, the cost-map by path).
The shipped design is **superset-safe / default-KEEP on uncertainty**:

- `buildDigest` returns the **full sid keyset** of a transcript (not just the dominant sid); the
  runner cost-map is `{ mtimeMs, sessionIds[] }`, and `presentSids` is the union over present
  files -- a non-dominant-but-present sid (a compaction flip target) is KEPT.
- The keyset is **monotonic per path** (a sid once captured is never dropped) so a long session
  whose head scrolls past the 8MB digest cap keeps its sid (the VALIDATE keyset-loss fix).
- A sid is pruned only after **K >= 2 consecutive COMPLETE runs** absent AND past a 24h wall-clock
  floor; an emit RESETS the sid's tracker (closing the Stop-child snapshot race); an incomplete
  observation (truncated discovery, or a never-captured present path within its `CAPTURE_GRACE`)
  DEFERS the whole prune. All counters are R13-rigor poison-validated.
- Marker-GC: a bounded keep-newest-N + TTL sweep, `effectiveTtl = max(ttl, pruneFloor)` so a
  debounce marker outlives its emitted entry; unlinks ONLY marker-grammar names, regular files,
  lstat-no-follow + re-lstat (TOCTOU), fail-open.

**Named residual (honest):** a sid PHYSICALLY absent across `K` complete scans that later RETURNS
(restored backup / remount / the cold-start-while-oversized corner) re-audits and re-emits,
bounded by `MAX_EMIT_PER_SESSION` per prune/return CYCLE (recurring); advisory + narrows-only
(worst case = a repeat false `/self-improve` human-triage prompt, NEVER an action). A
signed/kernel-minted emitted-set closes it fully -- v-next.
