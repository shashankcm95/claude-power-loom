---
status: pre-lock spec for architect spot-review
component: Spawn Lifecycle + GC + Retention
parent_rfc: causal-recall-graph-rfc.md (v3.2-pending-this-component)
created: 2026-05-24
purpose: Focused review of GC design before integration into locked v3.2 RFC
---

# Spawn Lifecycle + GC + Retention — Component Spec

Focused architectural spec for the operational/runtime hygiene layer of v3.2. Self-contained: assume reviewer knows the v3.2 context (parent-records L_spawn, delta capture via pre/post snapshots, 4-class axiom/theorem/sample/attestation model, three-cycle dreaming). This spec describes ONLY the GC component.

## Why this component exists

Three failure modes are happening in v2.9.x runtime TODAY (empirically observed in this brainstorm session alone):

1. **Stuck process accumulation** — 6+ orphan `git status --short` processes accumulated mid-session, all in S-state (sleeping but never returning). Required manual `kill -9` via `ps aux | grep | awk '{print $2}'`. This is the runtime leaking resources.
2. **Stale lock files** — `.git/index.lock` left behind by killed background tasks; required manual `rm -f` to unwedge subsequent git operations.
3. **Wedged session recovery** — the Phase-5 session (documented in `~/Documents/TB_to_Tutorial_converter/PHASE-5-RESUME-NOTES.md`) entered an API-retry storm that corrupted JSONL; recovery required forking to a clean session UUID. No automated recovery; pure manual triage.

These are NOT speculative. They are the operational baseline. v3.2 introduces spawn-state-namespaces, pre/post snapshots, theorem memo caches, dream output stores — each is a new resource class that can leak. GC is overdue, not aspirational.

## Design principles

Drawn from distributed-systems hygiene canon:

| Principle | Source | Application |
|---|---|---|
| **Supervision over panic** | Erlang OTP — "let it crash" + supervisor restart strategies | Spawns can fail; supervisor (GC) decides what to do |
| **Idempotent recovery** | `kb:architecture/crosscut/idempotency` | GC actions are safely repeatable; "kill an already-dead PID" is fine |
| **Fail-soft observability** | `kb:architecture/discipline/error-handling-discipline` §"fail-open hooks with observability" | GC sweep failures emit events; never block forward progress |
| **Generational retention** | GC algorithms (young vs old generation) | Recent attestations = hot; old ones = archived; oldest = purged |
| **Active-set marking** | mark-and-sweep GC | Mark active spawns + their dependencies; sweep unreachable |
| **Health-check probes** | Kubernetes liveness/readiness probes | Per-spawn watchdog with timeout + idle thresholds |

## Trigger criteria (the watchdog)

Six trigger classes; each maps to a recovery action.

### Trigger 1: Wallclock timeout

```yaml
detection:
  metric: spawn_started_at + timeout_seconds < now()
  poll_interval: 30s (cheap; checks active-spawns table only)
  default_timeout_seconds: 1800  # 30min; configurable per persona contract

recovery:
  action: terminate
  steps:
    1. Send SIGTERM to spawn process tree (graceful)
    2. Wait 5s for clean exit; emit `spawn_grace_period` event
    3. Send SIGKILL if still alive
    4. Capture partial delta (pre-snap → current FS state)
    5. Write attestation: status=timed_out; bounded_output=null OR partial-marker
    6. Release any locks held by spawn process tree
    7. Mark parent_state_id as "child_timed_out"; available for fork retry per max_retries
```

### Trigger 2: Idle/unresponsive

```yaml
detection:
  metric: no observable progress in idle_threshold_seconds
  observable_progress:
    - PostToolUse:Agent|Task fired
    - filesystem mutation in spawn's affected_paths
    - any tool_use event from spawn's identity
  default_idle_threshold_seconds: 300  # 5min

recovery:
  action: probe-then-terminate
  steps:
    1. Emit `spawn_idle_warning` observability event at threshold-1x
    2. Wait threshold/2 more
    3. If still idle (threshold-2x), escalate to wallclock-timeout recovery
    4. Idle attestation type: bounded_output=null; status=idle_terminated; partial_delta captured
```

### Trigger 3: Retry exhaustion

```yaml
detection:
  metric: count(forks from parent_state_id with status in [failed, timed_out]) >= max_retries
  default_max_retries: 3

recovery:
  action: promote-to-drift
  steps:
    1. Mark parent_state_id status=exhausted
    2. Refuse new fork requests from this parent_state_id (return error to orchestrator)
    3. Emit `parent_state_exhausted` attestation
    4. Auto-create drift-note entry in bench/control-runs/<current>/DRIFT-NOTES.md
       with all N failed children's bounded outputs (if any) for human review
    5. Orchestrator sees the refusal + drift; decides escalation path
```

### Trigger 4: Storage threshold

```yaml
detection:
  metric:
    - per-project ~/.claude/spawn-state/<run_id>/ total > 1GB
    - per-spawn delta > 100MB
    - per-persona dream-history > 500MB
  poll_interval: every GC sweep (see Cadences below)

recovery:
  action: archive-then-refuse
  steps:
    1. Auto-archive oldest attestations beyond retention to ~/.claude/library/_archive/spawn-state/<year-month>/
    2. Compact (gzip) archived data
    3. Update attestation index pointers
    4. If still over threshold, refuse new attestations + emit critical observability event
    5. Block new spawns from this persona until cleanup complete (fail-closed at PreToolUse:Agent|Task)
```

### Trigger 5: Stale lock file

```yaml
detection:
  metric: lock file (any) older than 30 minutes
  scope:
    - .git/*.lock (especially index.lock)
    - ~/.claude/library/_meta/*.lock
    - ~/.claude/spawn-state/*/locks/*

recovery:
  action: verify-then-remove
  steps:
    1. Read PID from lock file (if PID-formatted)
    2. Check `kill -0 <pid>` to verify alive
    3. If dead: remove lock file; emit `lock_recovered` attestation with original PID + age
    4. If alive: emit `lock_long_held` warning (no removal); flag for human review
    5. If unparseable: log + leave alone (do no harm)
```

### Trigger 6: Orphan process

```yaml
detection:
  metric: 
    process_name matches our spawn pattern (claude-spawn-*, persona-*)
    parent PID not in active-spawns table OR parent PID dead
    age > orphan_age_threshold (default 1h)
  scope: process tree under our session's parent PID

recovery:
  action: kill-with-attestation
  steps:
    1. Capture process metadata (PID, cmdline, age, parent_pid)
    2. SIGTERM → wait 5s → SIGKILL
    3. Emit `gc_purged` attestation with metadata
    4. If process held any tracked locks, run trigger 5 recovery for those
```

## Periodic GC sweep cadences

Three-tier schedule; cost proportional to scope:

| Cadence | Cost | Scope |
|---|---|---|
| **Stop hook** (every turn) | ~50ms | Check active-spawns timeouts only (trigger 1, 2). No filesystem walk. |
| **PreCompact hook** (~every 50-100 turns) | ~500ms | Triggers 1-3 + stale memos + abandoned forks (mark-and-sweep over spawn-state dir). |
| **Daily scheduled** (cron-style or session-start if >24h since last) | ~5-10s | Full sweep: all 6 triggers + retention archival + lock-file scan + storage thresholds + attestation index rebuild |

Per-tier idempotency: running twice with no new activity produces no changes. Concurrent GC sweeps serialize on `~/.claude/library/_meta/gc.lock` (10s acquire timeout; emit warning if contention).

## Persona contract additions

```yaml
# Added to state_interface in persona contracts
spawn_lifecycle:
  timeout_seconds: 1800              # configurable per persona class
  idle_threshold_seconds: 300
  max_retries: 3
  on_timeout: archive | purge | hold  # what to do with timed-out spawn state
  on_orphan: kill-attest | warn-only

retention:
  pre_snapshot_lifetime_hours: 24    # how long fork-capable snapshots survive
  delta_lifetime_days: 30            # delta record retention before archive
  attestation_lifetime_days: 90      # bounded-output + metadata retention
  dream_output_lifetime_days: 180    # dream sibling stores
  archive_after_days: 365            # everything older → compressed archive
```

Personas can declare tighter or looser bounds per their class (e.g., a quick `code-reviewer` spawn has lower timeout; a long-running `architect` plan-review spawn has higher).

## New attestation types

Each is a self-contained record written to `~/.claude/checkpoints/attestation-log.jsonl`:

```json
{ "type": "spawn_timeout", "spawn_id": "...", "timeout_seconds": 1800, "partial_delta_captured": true, "ts": "..." }
{ "type": "spawn_idle_warning", "spawn_id": "...", "idle_seconds": 320, "ts": "..." }
{ "type": "spawn_idle_terminated", "spawn_id": "...", "idle_seconds": 620, "ts": "..." }
{ "type": "parent_state_exhausted", "parent_state_id": "...", "child_count": 3, "promoted_to_drift": "DRIFT-...", "ts": "..." }
{ "type": "gc_purged", "process_pid": 67297, "cmdline": "git ...", "age_seconds": 4200, "reason": "orphan", "ts": "..." }
{ "type": "lock_recovered", "lock_path": ".git/index.lock", "original_pid": 51144, "age_seconds": 2100, "alive_check": "dead", "ts": "..." }
{ "type": "lock_long_held", "lock_path": "...", "owner_pid": 12345, "age_seconds": 1900, "alive_check": "alive", "ts": "..." }
{ "type": "storage_threshold", "scope": "spawn-state", "size_bytes": 1073741824, "action_taken": "archive-oldest", "ts": "..." }
{ "type": "retention_archive", "items_archived": 47, "bytes_freed": 524288000, "scope": "delta>30d", "ts": "..." }
{ "type": "gc_sweep_complete", "tier": "PreCompact", "duration_ms": 487, "actions_taken": {...}, "ts": "..." }
```

## New CLI verbs

```
loom gc status                          — current resource usage + impending purges + active spawns
loom gc sweep [--tier X] [--dry-run]    — manual trigger (Stop|PreCompact|daily)
loom gc verify-locks                    — explicit lock-file check + recovery
loom gc orphans [--max-age 1h]          — list orphan processes
loom gc terminate <spawn-id>            — manually terminate a stuck spawn (operator escape hatch)
loom states orphans                     — spawns without bounded-output close
loom states timeouts [--persona X]      — recent timeouts; useful for tuning timeout_seconds
loom retention preview [--scope X]      — what would get archived/purged at next sweep
loom retention apply [--dry-run]        — apply retention policy NOW
```

## Recovery contracts (failure modes of GC itself)

Critical: GC cannot fail in ways that worsen the problem it's supposed to solve.

| GC failure | Recovery contract |
|---|---|
| Sweep itself takes too long (>30s) | Abort gracefully; emit `gc_sweep_aborted` event; next sweep picks up |
| GC tries to terminate a process that's actually doing useful work | Per-spawn `spawn_lifecycle` contract is the ground truth; if timeout fires the spawn IS expired by contract. False positives accepted as cost of safety. |
| GC removes a lock that's actually still held | PID liveness check is mandatory; if PID alive, never remove. If unparseable PID, leave alone. |
| Concurrent GC sweeps race | Serialize on `~/.claude/library/_meta/gc.lock` with 10s acquire timeout |
| GC sweep crashes mid-operation | Atomic-write discipline (`_lib/atomic-write.js`) — partial writes not visible; next sweep retries |
| Storage threshold trip refuses spawns indefinitely | Hard escape: `loom retention apply --force` operator command; emit `escape_hatch_used` event |
| Retention archives unrecoverable data | Archive ≠ delete; everything goes to `_archive/<year-month>/` first, gzipped; explicit `loom archive purge --older-than 365d` for hard delete |

## Concurrency considerations

| Scenario | Handling |
|---|---|
| GC sweep fires while spawn N is mid-execution | Active spawns are EXCLUDED from sweep candidate set. GC only operates on terminated/stale state. |
| Two GC sweeps spawn simultaneously (e.g., PreCompact + scheduled overlap) | `gc.lock` serializes; second waits up to 10s then aborts with warning |
| Spawn termination triggers cascade — child of N also gets terminated | Process tree termination via `kill -TERM 0` (process group); single SIGTERM affects whole tree |
| Operator runs `loom gc terminate <id>` on a spawn that's actually progressing | Explicit operator override; emit `manual_termination` attestation; persona contract may forbid (set `manual_termination_allowed: false`) |

## What GC explicitly does NOT do

- Touch axioms (KB anchors, ADRs, contracts) — these are durable; never garbage-collected
- Touch user-data outside our managed namespaces (e.g., `src/`, `tests/`)
- Delete data without archiving first (hard delete is always operator-explicit)
- Make policy decisions (always honors persona contract `spawn_lifecycle` + `retention`)
- Modify in-flight spawns (only operates on stale/terminated)

## Lineage / pattern references

This design borrows established discipline:

- **Erlang OTP supervisors** — restart strategies (`one_for_one`, `one_for_all`); permanent vs transient vs temporary children → maps to our persona `on_timeout` modes
- **Kubernetes liveness/readiness probes** — periodic check; restart if unresponsive → maps to trigger 1+2
- **GC algorithms (mark-and-sweep)** — mark active set, sweep unreachable → PreCompact tier
- **Generational GC** (young/old) — recent attestations hot; old archived → retention policy
- **Database connection pool eviction** — idle timeout + max-lifetime + validation → trigger 1+2
- **Airflow task retry-with-backoff + dead-letter** → trigger 3 (parent_state_exhausted → drift-note)
- **systemd cgroups process management** → trigger 6 (orphan process tree handling)

## Open questions for architect

1. **Timeout default value** — 1800s (30min) is a guess. Most current sub-agent spawns complete in <120s based on session observations. Tighter default (e.g., 300s) catches stuck-loops faster; looser respects legitimate long-running architect reviews. What's defensible?
2. **Idle detection sensitivity** — what counts as "observable progress"? Only PostToolUse:Agent|Task fires? Or also intermediate tool calls if visible to parent? Some persona classes do long thinking with no tool calls — they'd false-positive as idle.
3. **GC interference with active spawns** — confirmed GC excludes active spawns from sweep, but the lock-recovery trigger could remove a lock held by a spawn that's just slow. Risk: race between liveness-check and spawn's next tool call. Defense?
4. **Storage threshold escalation** — fail-closed (refuse new spawns) seems right for "out of disk" but draconian for "approaching 1GB." Better: progressive throttle (warn at 70%, refuse at 100%)?
5. **Retention policy per persona** — should EACH persona contract specify retention OR is global config sufficient? Probably global with per-persona override.
6. **Cron-style daily scheduled sweep** — how triggered in plugin context? SessionStart hook with "if >24h since last sweep, run"? Or a separate daemon?
7. **Operator escape hatches** — should `loom gc terminate <id>` require confirmation prompt? `loom archive purge` definitely should. Audit log of escape-hatch usage?
8. **GC interaction with dream cycles** — dream cycles read/write to library; should they hold the gc.lock for the duration? Or just acquire briefly when writing the sibling store?

## Validation criteria

- [ ] Fixture test: spawn that exceeds `timeout_seconds` gets terminated; attestation type=spawn_timeout written
- [ ] Fixture test: spawn that doesn't emit progress for `idle_threshold_seconds` gets warning then terminated
- [ ] Fixture test: 3 failed forks from same parent_state → 4th fork refused; drift-note created
- [ ] Fixture test: storage threshold trip → oldest archived; gc_purged events emitted
- [ ] Fixture test: stale .git/index.lock (>30min, PID dead) → removed; lock_recovered emitted
- [ ] Fixture test: orphan process (parent dead) → killed; gc_purged emitted
- [ ] Fixture test: GC sweep idempotent — running twice produces no second-run changes
- [ ] Fixture test: two concurrent sweeps serialize via gc.lock; second waits then warns
- [ ] Fixture test: GC sweep crash mid-operation → atomic writes preserve state; next sweep recovers
- [ ] Empirical: across a 4h continuous session, GC reduces stuck-process count to zero (currently we accumulate 6+ over this brainstorm session)

## What integration into RFC v3.2 looks like

This component becomes RFC v3.2 §"Spawn Lifecycle + GC + Retention" — new top-level section between current §"Three dream cycles" and §"Failure-mode matrix". Schema additions to persona contracts (`spawn_lifecycle`, `retention`) merge into §"Interface contracts". New attestation types extend §"Architecture diagram" / "Attestations" class. CLI verbs extend §"Query CLI". The component is additive; no other section needs revision.

Net LoC: ~150 (vs ~1050 total v3.2). Net effort: ~10-15h of the 90-130h v3.2 budget.

---

*Spec author's note*: This GC design is heavily borrowed from well-validated distributed-systems patterns. The novelty is in applying them to spawn-state management. The intent of the architect spot-review is to (a) catch where the borrowing-from-distributed-systems assumes more than the plugin runtime offers, (b) catch where the trigger criteria or recovery contracts have edge cases I missed, and (c) surface anything load-bearing that's missing.
