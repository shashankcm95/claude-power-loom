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
- **(c) The emitted-set retention bound is wired (PR-B -- see "Open design" below).** Without it
  the emitted-set grows unbounded under continuous operation. **This is the one remaining CODE
  precondition.**
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

## Open design -- PR-B: the emitted-set retention bound (NOT yet specified-safe)

`pruneEmitted` (the RFC section 5.4 retention bound on the emitted-set) has **zero live
callers**, so the emitted-set grows `O(all-sessions-ever)` on the hot path under continuous
operation. Wiring it is **non-trivial and currently UNSAFE in the naive form** -- the VERIFY
board (2026-06-20) proved three holes. **This section is a design BRIEF for PR-B, not a settled
spec; PR-B must design the safe keep-set under its own TDD + multi-lens review.**

**Why the naive "keep the sessions of all present transcripts" is unsafe (the key-space
mismatch):** the emitted-set is keyed by the **dominant in-content sessionId** (a many-to-one,
non-injective function of the file path), while any cheap keep-set is derived from a **path**-keyed
(and explicitly lossy) cost-map. So "every present path contributes its sessionId" does NOT equal
"every still-re-auditable session is kept." A wrongly-pruned session that is later re-audited
**re-emits** -> a single session over-counts toward the cross-session convergence threshold-of-3
(the exact guarantee the emitted-set exists to provide). Three concrete holes:

1. A present path with a **null/unknown stored sessionId** (e.g. a back-compat bare-number
   cost-map entry, mtime-skipped this run) contributes nothing -> its session is wrongly pruned.
2. `auditTranscript` does **not** carry a sessionId on every return branch, and the runner records
   a path as "audited" (cost-map) on ANY non-throw (incl. no-drift / judge-fail). So
   "audited-in-cost-map" and "sessionId-known" are **distinct predicates** -- conflating them is
   the bug.
3. The dominant sessionId is **non-monotonic across compaction** (a file's MAX-count session can
   flip B -> C -> B), so "present sessions this run" is not a stable superset of "re-auditable
   ever."

**Direction the safe design MUST follow (architect):** the keep-set is a **superset-safe
over-approximation, never tight -- default-KEEP on uncertainty**; prune a sessionId only when
**positively observed absent**.

- Prune only when EVERY present path is audited-this-run-with-a-captured-sid OR
  skipped-with-a-NON-NULL-stored-sid (a null sid => defer the WHOLE prune that run; this also makes
  a reset/back-compat cost-map self-heal by re-auditing).
- `auditTranscript` must thread `dg.sessionId` into every return branch that computed a dominant
  sid (a PREREQUISITE additive change: `{ ok, emitted, sessionId? }`); the runner cost-map becomes
  `{ mtimeMs, sessionId }`.
- Prune a sid only after it has been ABSENT for **K >= 2 consecutive complete runs** AND past a
  wall-clock floor -- this absorbs the non-monotonic dominant-sid flip and the concurrent
  Stop-child race (the lock makes the WRITE atomic, not the DECISION correct).

**Named residual (honest):** a transcript ABSENT during a complete scan that later RETURNS
(restored backup / remounted volume) will re-audit and re-emit; bounded by `MAX_EMIT_PER_SESSION`
per session; acceptable for an advisory counter (narrows-only -> worst case = a false convergence
surfacing a human-triage prompt).

**Bundle marker-GC with PR-B.** The Stop-hook's `ghost-heartbeat-spawns/` markers are
debounce-only (no consumer) and have no GC -> the same unbounded growth. A bounded keep-N-newest /
TTL sweep in the runner is SAFE as sketched (losing a marker costs at most one extra debounced
spawn), provided it: unlinks ONLY via `lstat` no-follow + `isFile` (no symlink traversal out of
`markerDir`), fails open on any unlink error, and env-clamps its bound via the existing
`envIntClamped` helper.
