---
lifecycle: persistent
---

# Ghost Heartbeat W2-PR-B — the emitted-set retention bound (+ marker-GC)

> The LAST code go-live precondition (runbook `docs/ghost-heartbeat-go-live.md` (c)).
> Wires a SAFE keep-set so the emitted-set + the Stop-hook markers stay bounded under
> continuous operation. The emitted-set is the **double-emit correctness boundary** —
> a wrong prune un-dedups a session → over-counts the cross-session convergence
> threshold-of-3 → a false `/self-improve` graduation. This is why PR-B was SPLIT out of
> the go-live-readiness PR-A and gets its own TDD + 3-lens VALIDATE.

## Problem (from the runbook OPEN brief — the key-space mismatch)

`pruneEmitted(state, keepSessionIds)` exists, is immutable + unit-tested (T10), and has
**ZERO live callers** → the emitted-set grows `O(all-sessions-ever)` on the hot path.

The naive "keep the sessions of all present transcripts" is UNSAFE (VERIFY board 2026-06-20,
three holes):

1. **Key-space mismatch.** The emitted-set is keyed by the **dominant in-content sessionId**
   (a many-to-one, non-injective function of the file path). Any cheap keep-set comes from a
   **path**-keyed (explicitly lossy) cost-map. "Every present path contributes its sessionId"
   does NOT equal "every still-re-auditable session is kept."
2. **`audited` != `sid-known`.** `auditTranscript` does not return a sessionId, and the runner
   records a path as "audited" on ANY non-throw (incl. no-drift / judge-fail / digest-fail).
   "audited-in-cost-map" and "sessionId-known" are DISTINCT predicates.
3. **Non-monotonic dominant sid.** A file's MAX-count session can flip `B -> C -> B` across
   compaction, so "present sids this run" is not a stable superset of "re-auditable ever."

## Runtime Probes (claims verified against the actual repo this session)

| Claim | Probe | Result |
|---|---|---|
| `pruneEmitted` has ZERO live callers | `grep -rIn pruneEmitted packages tests --include=*.js` | CONFIRMED — only its own module (`ghost-heartbeat-state.js:77,109`) + its test (`ghost-heartbeat-state.test.js:131-138` T10). No caller. |
| `auditTranscript` computes a dominant sid but does NOT return it | Read `drift-audit.js:118-137` (`buildDigest` -> `{ ok, sessionId, digest }`) + `:209-232` (`auditTranscript` returns `{ ok, emitted }` / `{ ok:false, reason, emitted:[] }`) | CONFIRMED — `dg.sessionId` exists in scope on every post-digest branch; the return shape never carries it. |
| The runner cost-map is path-keyed bare-mtime | Read `ghost-heartbeat-run.js:62-73` (`loadRunState` -> `audited[path]=finite mtimeMs`), `:148` skip-gate, `:152` record | CONFIRMED — `audited: { [path]: mtimeMs:number }`; validated finite in `[0, now+1d]`. |
| The runner records on ANY non-throw (not on `.ok`) | Read `ghost-heartbeat-run.js:150-156` | CONFIRMED — `audit({...}); nextAudited[c.path]=c.mtimeMs` ignores the result's `.ok`. |
| The emitted-set lock is `statePath + '.lock'` (shared by recordEmissions) | Read `ghost-heartbeat-state.js:91-92` | CONFIRMED — the lock path defaults to `statePath` + `.lock`. A prune deriving the same default shares the lock. |
| Stop-hook markers have no GC | Read `ghost-heartbeat-stop.js:56-64,125` (`markerDir()`, `markerPathFor`, write-only) | CONFIRMED — one `<sha256(path)[:16]>.json` per session, written, never swept. `markerDir` is exported. |
| `envIntClamped` exists for env-bound clamping | Read `ghost-heartbeat-run.js:48-52` | CONFIRMED — `envIntClamped(name, def, min, max)`, whole-digit, clamped. |
| R13 poison test asserts bare-value drop | Read `ghost-heartbeat-run.test.js:219-234` | CONFIRMED — `1e308` / numeric-string / `null` each dropped. The new object-form validator must keep these dropping. |

## The safe design (superset-safe over-approximation — default-KEEP on uncertainty)

Three coordinated changes, then the wiring.

### 1. Prerequisite — thread the dominant sid out of the producer (additive)

`auditTranscript` returns `{ ok, emitted, sessionId? }`. Thread `sessionId: dg.sessionId` into
**every return branch that ran AFTER a successful `buildDigest`** (judge-fail, no-drift,
state-write-error, lock-timeout, success). The pre-digest branches (killswitch, digest-fail)
carry NO sessionId — there is genuinely no sid. Backward-compatible: existing tests assert
`.ok`/`.reason`/`.emitted`; an added field cannot break them.

### 2. The runner cost-map becomes a tri-state `{ mtimeMs, sessionId }`

`loadRunState` tolerates BOTH forms (back-compat):

- a **bare number** `n` (legacy / pre-PR-B) -> "never captured a sid" — FORCE re-audit + BLOCK
  prune-completeness until resolved (self-heals the cost-map; bounded — once captured it is the
  object form forever).
- `{ mtimeMs:<finite in [0,now+1d]>, sessionId:"<str>" }` -> a captured sid.
- `{ mtimeMs:<finite>, sessionId:null }` -> "audited, NO derivable sid" (digest-fail /
  no-session-id transcript). NORMAL mtime-skip (do not waste a judge re-auditing it); EXCLUDED
  from prune-completeness blocking (a no-sid transcript can never emit).

Anything else -> dropped (poison). R13's bare-value poisons still drop (number > ceiling /
string / null-value).

**Skip-gate** (`ghost-heartbeat-run.js:148`): skip iff the entry is the OBJECT form AND
`entry.mtimeMs >= c.mtimeMs`. A bare-number / missing entry always (re)audits to capture the sid.

**Record** (`:152`): on a non-throwing audit, store `{ mtimeMs: c.mtimeMs, sessionId: <result.sessionId || null> }`.

### 3. The runner observes (present sids + completeness), the store decides

After the audit loop, over the FULL discovered `cands`:

- `complete = !truncated` (the loop did not break on the cap or the wall-clock budget) AND no
  present path is "never-captured" (bare-number / missing object entry).
- `presentSids` = the string `sessionId`s of the present paths' object entries (null-sid entries
  contribute nothing but do NOT block — they cannot emit).

Then ONE new locked store function `pruneEmittedState({ presentSids, complete, now, statePath,
lockPath, absentRuns:K, floorMs })` (sibling of `recordEmissions`, same `withLockSoft`, same
default `statePath + '.lock'`):

- `!complete` -> **defer**: do NOT advance absence counters, do NOT prune. Return `{ deferred:true }`.
- `complete` -> for each sid in `state.emitted`: if present, RESET its tracker; else increment
  `absentRuns` (stamp `firstAbsentAt` on first absence). Prune a sid ONLY when
  `absentRuns >= K (default 2)` AND `now - firstAbsentAt >= floorMs (default 24h)`. Keep
  `pruneEmitted` as the pure primitive; `pruneEmittedState` is the absence-policy + lock + write.

`state.pruneTracking: { [sid]: { absentRuns, firstAbsentAt } }` is a new top-level field;
`emptyState`/`loadState` add it tolerantly (drop non-conforming).

**Why K>=2 + a wall-clock floor:** absorbs (a) the non-monotonic dominant-sid flip, (b) the
concurrent Stop-child emit-during-prune race (the lock makes the WRITE atomic, not the DECISION
correct), and (c) a transient discovery blip (an unreadable project dir one run).

### 4. Marker-GC (bundled — same runner-owned retention concern)

`sweepMarkers({ markerDir, keepNewest, ttlMs, now })`, called once per run, fail-open:

- `readdir` (fail-open -> return); for each entry `lstat` **NO-FOLLOW** + `isFile` (reject
  symlink/dir/FIFO -> never traverse out of `markerDir`); collect `{ path, mtimeMs }`.
- delete a marker iff `mtimeMs < now - ttlMs` OR it is not among the newest `keepNewest`.
- guarded unlink per file (re-`lstat` no-follow + `isFile`, fail-open on any error).
- bounds env-clamped via `envIntClamped`: `GHOST_HEARTBEAT_MARKER_KEEP` (default 256, [1,100000]),
  `GHOST_HEARTBEAT_MARKER_TTL_MS` (default 7d, [1h, 365d]).

Losing a marker costs AT MOST one extra debounced spawn (the emitted-set still de-dups) -> safe.
Resolve `markerDir` by importing the single exported `markerDir` from `ghost-heartbeat-stop.js`
(ONE source of truth for the env contract; requiring the hook has no top-level side effects).

## Named residual (honest — corrected per VERIFY #10 + VALIDATE)

A sid that is PHYSICALLY absent across `K` complete scans and later RETURNS (restored backup /
remounted volume / a sid emitted by a now-gone file that reappears only in the truncated HEAD of
a present transcript first-audited while already >8MB) will re-audit and re-emit. The bound is
`MAX_EMIT_PER_SESSION` (6) classes **per prune/return CYCLE, RECURRING** with each return — NOT a
one-time 6. If `>= 3` returning sessions share a class, the cross-session threshold-of-3 can
re-trip, surfacing a repeat false `/self-improve` human-triage prompt (NEVER an action;
narrows-only; integrity != provenance unchanged). The keyset fixes remove the two COMMON halves:
the dominant-sid FLIP is now KEPT (full keyset, fix #1) and the grow-past-8MB head-sid is KEPT
(monotonic union, VALIDATE fix), leaving only genuine physical absence and the rare
cold-start-while-oversized corner. A signed/kernel-minted emitted-set would close it fully — out
of scope (v-next).

## Env knobs (all `envIntClamped`, all default-safe)

| Var | Default | Clamp | Meaning |
|---|---|---|---|
| `GHOST_HEARTBEAT_PRUNE_ABSENT_RUNS` | 2 | [1, 100] | K consecutive complete absences before prune |
| `GHOST_HEARTBEAT_PRUNE_FLOOR_MS` | 86400000 (24h) | [1h, 365d] | wall-clock floor before prune |
| `GHOST_HEARTBEAT_MARKER_KEEP` | 256 | [1, 100000] | newest-N markers kept |
| `GHOST_HEARTBEAT_MARKER_TTL_MS` | 604800000 (7d) | [1h, 365d] | marker age TTL |

## Test plan (TDD — red first)

- **state**: `pruneEmittedState` — defer on `!complete` (no counter advance, no prune);
  absent-once keeps (K=2); absent-twice-past-floor prunes; absent-twice-under-floor keeps;
  present resets the counter; a Stop-emit-during-absence is absorbed (counter, not immediate
  prune); immutability + tolerant `pruneTracking` load; the same-lock no-deadlock with
  recordEmissions (sequential).
- **run**: cost-map object round-trip; legacy bare-number forces re-audit + blocks completeness;
  null-sid object skips normally + does NOT block; truncation (cap/budget) -> `complete:false` ->
  defer; a full clean run -> a long-absent sid prunes; R13 poison still drops under the new
  validator; the prune targets the SAME emitted-set path the audits wrote (alignment).
- **markers**: keep-newest-N; TTL; symlink/dir/FIFO never unlinked (no out-of-dir traversal);
  fail-open on unlink error; env-clamped bounds.
- **R-real extension**: drive the REAL `auditTranscript` (mock judge) through a prune cycle —
  prove a re-audit after a (wrongly-forced) prune does NOT double-emit beyond the bound.

## Out of scope

- Signed / kernel-minted emitted-set (the integrity!=provenance close) — v-next.
- Any change to the FROZEN drift taxonomy or the judge.
- Flipping `GHOST_HEARTBEAT_EMIT` on (still default-OFF; go-live preconditions (b)(d)(e) remain
  user-gated).

## VERIFY board (pre-build — fold corrections BEFORE TDD)

Kernel correctness-boundary change -> the full 3-lens parallel tier:
- **architect** — is the superset-safe keep-set actually superset-safe? does the tri-state +
  force-re-audit self-heal TERMINATE? is the completeness predicate correct under truncation?
- **code-reviewer** — the cost-map migration / back-compat; the skip-gate change; the two
  sequential lock sections; fd/edge hygiene in `sweepMarkers`.
- **hacker** — can a crafted transcript / cost-map / marker dir DENY pruning forever, force an
  out-of-dir unlink, or drive a double-emit past the bound?

## Pre-Approval Verification

3-lens parallel VERIFY board (architect + code-reviewer + hacker), each reading the plan AND
the live source. **All three returned NEEDS-REVISION** — the naive design had a non-superset
keep-set, a prune-never-runs starvation path, unbounded-poison gaps, and a marker/emit coupling
bug. Folded BEFORE build (the verify-before-codify discipline). Dispositions:

| # | Lens | Sev | Finding | Disposition (FOLDED into the design above) |
|---|---|---|---|---|
| 1 | arch | HIGH | keep-set NOT a superset — a non-dominant-but-present sid flips to dominant and re-emits | **FIX**: `buildDigest` returns `sessionIds` = the FULL keyset of `sidCounts` (not just the argmax `sessionId`); the cost-map stores the full set; `presentSids` = union over present files. The keep-set is now a true superset; the flip case is KEPT, not pruned. |
| 2 | arch | HIGH | completeness-starvation — cap/legacy pins `complete=false` forever -> prune never runs (unbounded growth on the exact busy box this PR targets) | **FIX**: decouple completeness from the audit CAP (a cost limit). Compute presence over ALL discovered `cands` using their cost-map entries (this-OR-prior run); a stale-but-present object entry still contributes (over-approx). A never-captured path blocks ONLY until `CAPTURE_GRACE` (default 3) consecutive attempts, then stops blocking (a never-captured path that keeps failing never emitted -> protects nothing). |
| 3 | hack | HIGH | `pruneTracking` numeric fields unbounded -> poison games K+floor BOTH ways (deny-prune-forever / prune-immediately) | **FIX**: validate with the R13 rigor — `absentRuns` integer in `[0, 1e6]`, `firstAbsentAt` finite in `[0, now+skew]`; ANY non-conforming field -> DROP that sid's whole tracker (re-stamp on next genuine absence). + an R13-analog test. |
| 4 | hack | HIGH | marker-GC and emitted-prune are COUPLED -> "lose a marker = one extra spawn" is false once the emit floor is non-permanent (re-spawn + re-emit) | **FIX**: enforce `effectiveTtl = max(ttlMs, pruneFloorMs)` so a debounce marker ALWAYS outlives its emitted entry; raise `MARKER_KEEP` default so keep-newest is an anti-runaway backstop, TTL is the normal GC. + a test: a session pruned from emitted still has a live marker. |
| 5 | CR | HIGH | `emittedStatePath` plumbing unspecified -> runner prunes the WRONG file in production (the R-real test would pass while prod is broken) | **FIX**: runner imports `{ pruneEmittedState, DEFAULT_STATE_PATH }`; `runHeartbeat` gains `emittedStatePath` (default `DEFAULT_STATE_PATH`, env `GHOST_HEARTBEAT_STATE`); the R-real test passes the tmp path explicitly. |
| 6 | CR | HIGH | `loadState`'s strict whitelist drops `pruneTracking` -> `recordEmissions` write erases counters -> prune never fires (silent reinstatement of the bug) | **FIX**: `loadState` explicitly reads + per-field-validates + RETURNS `pruneTracking`; `emptyState` includes it; `recordEmissions` preserves it. + a "pruneTracking survives a recordEmissions round-trip" test. |
| 7 | hack/arch | MED | `presentSids` computed pre-lock (TOCTOU) — a Stop-child emit in the gap is counted absent -> a sid at K-1 past floor is pruned the run it was emitted to | **FIX**: `recordEmissions` DELETEs `pruneTracking[sid]` for every sid it emits (the emit is a presence signal, recorded transactionally under the SHARED lock) -> a fresh emit resets the counter regardless of the stale snapshot. + an interleave test. |
| 8 | hack | MED | a transiently-unreadable project DIR makes its sessions falsely-absent without tripping `complete=false` | **FIX**: `discover` returns `{ candidates, discoveryComplete }`; a readdir/lstat error on a project dir -> `discoveryComplete=false` -> defer the prune (no absence-counting), like truncation. |
| 9 | CR | MED | no try/catch around `pruneEmittedState` in the runner (disk-full throws out of fail-open `runHeartbeat`) | **FIX**: wrap `pruneEmittedState` + `sweepMarkers` in try/catch, `log` + continue (fail-open), like the existing run-state write. |
| 10 | arch/hack | MED | residual UNDERSTATED — it is `MAX_EMIT_PER_SESSION` per prune/return CYCLE (recurring), not a one-time 6; >=3 returning sessions sharing a class re-trip the threshold | **FIX**: residual reworded to the honest bound; note fix #1 removes the flip half, leaving only genuine physical absence (restored backup / remount). |
| 11 | hack | LOW | `GHOST_HEARTBEAT_MARKER_DIR` is a traversal lever for the new unlink path | **FIX**: `sweepMarkers` unlinks ONLY entries whose basename matches the marker grammar `^[0-9a-f]{16}\.json$`; guarded re-lstat-no-follow immediately before each unlink (TOCTOU). |
| 12 | CR | LOW/NIT | object `sessionIds` malformed / void-returning `auditFn` stub -> TypeError or wrong-drop | **FIX**: `sessionIds` non-array -> `[]` (keep `mtimeMs` anchor, resolved-no-sid); record step guards `Array.isArray(result && result.sessionIds) ? ... : []`. |
| 13 | arch | LOW | lock +1-not-+N; keep-newest eviction cost | **NOTE** (no code): PR-B adds exactly ONE lock acquisition per run (post-loop prune); re-entrancy covered by T8b. |

**Corrected design deltas (supersede the sketch above where they differ):**

- **cost-map entry** = `{ mtimeMs, sessionIds: string[] }` (the FULL present sid-set), NOT
  `{ mtimeMs, sessionId }`. `presentSids` = the union over present object entries. A bad
  `sessionIds` normalizes to `[]`. Legacy bare-number = never-captured.
- **run-state** gains `captureFailures: { [path]: int }` (a throwing audit increments it WITHOUT
  touching `audited` — R8's retry semantics preserved); a never-captured path stops blocking
  completeness once `captureFailures[path] >= CAPTURE_GRACE`.
- **completeness** = `discoveryComplete AND (no present path is never-captured-under-grace)`.
  The audit CAP no longer gates it.
- **`recordEmissions`** resets (`delete`) `pruneTracking[sid]` for each emitted sid.
- **`sweepMarkers`** uses `effectiveTtl = max(ttlMs, pruneFloorMs)` and the marker-name grammar
  allowlist.
- **env knobs (final)**: `PRUNE_ABSENT_RUNS` K=2 `[1,100]`; `PRUNE_FLOOR_MS` 24h `[1h,365d]`;
  `CAPTURE_GRACE` 3 `[1,100]`; `MARKER_KEEP` 1024 `[1,1e6]`; `MARKER_TTL_MS` 7d `[1h,365d]`
  (floored to `PRUNE_FLOOR_MS` at runtime).

Board verdict after fold: the corrected design closes all four HIGHs; build proceeds under TDD
with a post-build 3-lens VALIDATE (the emitted-set is the correctness boundary).

## VALIDATE result

Post-build 3-lens board (code-reviewer + hacker live-probe + honesty-auditor) on the built diff.
The hacker ran **14 live probes** against the real modules in `/tmp` (Rule 2a). Verdicts:
code-reviewer NEEDS-REVISION (test-coverage gaps), hacker CLOSEABLE-WITH-NOTES (one real HIGH),
honesty-auditor CLOSEABLE-WITH-NOTES. All three confirmed the 13 VERIFY folds are genuinely in
the code. Folded:

| Sev | Finding | Disposition |
|---|---|---|
| HIGH (hacker, live-proven) | **Keyset-loss over-prune** — for a transcript > `MAX_TRANSCRIPT_BYTES` (8MB) the producer's keyset is TAIL-ONLY, so a HEAD sid is dropped, counted absent, and PRUNED while the file is present (reproduced an end-to-end double-emit; a real 56k-line transcript exceeds 8MB -> the COMMON long-session case, not the named residual) | **FIXED**: (a) the runner UNIONS the fresh keyset with the path's PRIOR captured keyset (monotonic — a sid once captured is never dropped; capped `MAX_KEYSET_PER_PATH=256`), so a session audited while small keeps its sid as it grows; (b) `isValidSid` bounds the sid (len<=128, no control chars) closing the on-disk-DoS LOW. Regression test **R-bigfile** drives the REAL >8MB tail-truncation. The rare cold-start-while-oversized corner folded into the named residual. |
| HIGH (CR) | the `CAPTURE_GRACE` starvation-fix path had no test | **FIXED**: **R-grace** (throw `grace` times -> completeness unblocks -> prune resumes) + **R-grace-clear** (a success clears the failure count). |
| HIGH (CR) | R-real never drove the real prune-then-re-audit cycle | **FIXED**: **R-real-prune** (real `auditTranscript` -> force-prune -> re-audit re-emits EXACTLY once). |
| HIGH (honesty) | the marker "ALWAYS outlives its emitted entry" claim is false on the keep-newest path | **FIXED (reword)**: the comment + disposition now scope it honestly — the TTL floor governs the AGE path; keep-newest is a bounded anti-runaway backstop (one extra debounced spawn, no re-emit since the emitted-set de-dups). |
| MED (CR) | null-sid-no-block + cap-induced-defer untested | **FIXED**: **R-nullsid-noblock** + **R-cap-defer**. |
| MED (honesty #10) | the plan's Named residual still read the pre-#10 per-session bound | **FIXED**: reworded to the per-prune/return-CYCLE bound (above). |
| MED (honesty) | the grace "protects no sid" comment was over-scoped | **FIXED (reword)**: the transient-fail-after-prior-emit case is the bounded residual, not a protected sid. |
| LOW (CR) | `sanitizePruneTracking` used real `Date.now()` (fake-clock trap) | **FIXED**: threaded an optional `now` through `loadState` -> `sanitizePruneTracking`. |
| LOW (hacker) | unbounded/control-char sessionId | **FIXED** by `isValidSid` (above). |
| NIT (CR/hacker) | `Array.includes` keep-filter; `now` type-guard | **FIXED**: `Set.has`; `now` normalized to a clock in `pruneEmittedState`/`sanitizePruneTracking`. |

Board's other notes accepted as-is (the trust-model NIT on spawn-verification; the lastRunAt
two-clock NIT — both no-change). Post-fold: state 19/19, run 30/30, drift-audit 19/19, stop 13/13,
full kernel suite green; eslint + ADR-0006 zero-suppression clean. The two install-gate reds
(yaml fm-24 = the untracked persona-jardin file; contract-plugin-hook-deployment = the known
stale-cache artifact, auto-passes in CI) are pre-existing + not-mine.

**Verdict: CLOSEABLE** after the fold (the one real HIGH closed + regression-tested on the real path).
