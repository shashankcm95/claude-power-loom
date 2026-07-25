# Plan — dispose-on-failure sweep (zombie `solving` cleanup)

lifecycle: ephemeral

## Goal

A solver that dies mid-flight leaves its solve-queue entry stuck at `solving` with no terminal
path (confirmed by the Wave D test `failed-solve-rests-at-solving`). Build a TOTAL, SHADOW,
weight-inert **dispose-on-failure sweep** that advances *stale* `solving` entries to `disposed`
(which is re-openable), wired as **PASS 0** of the existing poll cron. This is the internal
robustness gap the beta-internal-verification mandate says to close before any live loop run.

## Runtime Probes (firsthand-verified against the repo)

- `STATES` + `LEGAL`: `solving -> [drafted, disposed]` is legal; `disposed -> [queued]` is
  re-openable. Probe: `solve-queue-fold.js:23-33`. OK
- `mkEvent` stamps `ts: Date.now()` on every event (audit-only; LINE ORDER is authoritative for
  the fold). Probe: `solve-queue-store.js:163` + the fold header `solve-queue-fold.js:17-18`. OK
- `foldEntry` returns `{entry_id, repo, issue_ref, state, evidence}` — **no `ts`**. Probe:
  `solve-queue-fold.js:90-113`. => the fold must expose the last-accepted-event `ts` for staleness.
- `reason` is a valid evidence field (string, max 256). Probe: `solve-queue-fold.js:38-43,51-56`.
  => the dispose carries `evidence: { reason: 'stale-solving-timeout' }`.
- Evidence RESETS on a `-> queued` re-open. Probe: `solve-queue-fold.js:104`. => a dispose `reason`
  never leaks onto a later re-queued/solved run.
- `DEFAULT_ACTOR_TIMEOUT_MS = 180000` (3 min). Probe: `docker-actor-backend.js:42`. => a 1-hour
  staleness threshold is `>>` the max solve time, so the sweep can never dispose a LIVE solve.
- Poll = PASS 1 (observe `in_flight`) + PASS 2 (promote `merged`); TOTAL, SHADOW; all-or-nothing
  dir wiring over `DIR_KEYS`. Probe: `solve-queue-poll.js`. => dispose slots in as PASS 0, needing
  only `queueDir`.
- `emitEgressAlert(reason, detail)` — the positional `reason` token CLOBBERS a `reason` key in
  `detail` (`alert.js:19`; the Wave D VALIDATE HIGH). => dispose alerts use a `kind` key, never a
  `reason` key in the detail object.
- Test blast radius for adding `updated_at`: fold tests use field-access (`f.state`), not
  whole-shape `deepStrictEqual`; the 3 `deepStrictEqual`s in `solve-queue-store.test.js` all assert
  `list() === []` (absent/oversize/symlink empty cases). Probe: grep. => adding `updated_at` breaks
  ZERO existing tests. No existing consumer reads `list().updated_at`.

## Design (REVISED post-architect-VERIFY — a wall-clock heuristic ALONE is unsafe)

Two load-bearing additions the naive plan lacked: a **compare-and-swap** so the mutation can't
dispose an entry that advanced out of `solving` (HIGH-3), and a **generous, configurable window +
a CLI bound** so the clock can't race a live solve (HIGH-1/HIGH-2). See the "findings folded"
section for the disposition of each finding.

### Part 1 — expose the staleness clock (fold; DRY-correct, single-sourced)

Extend `foldEntry` to also return `updated_at` = the `ts` of the LAST ACCEPTED event. The fold is
the ONE acceptance authority (verify-on-read skips an illegal/tampered event), so the clock must be
computed there — re-deriving it in the store would duplicate acceptance logic AND wouldn't be
acceptance-aware (the existing `_queuedAt` decoration records ANY `-> queued` event regardless of
fold acceptance — MED-2). Rules:

- Set only from an ACCEPTED event's `ts` when finite; non-numeric `ts` -> `updated_at` undefined
  (=> the sweep skips it, fail-safe).
- Audit-only. NEVER an ordering/sort key (the fold's load-bearing LINE-ORDER invariant). Guarded by
  a regression test asserting `claimNext` still orders by `_queuedAt`, not `updated_at` (MED-2a).
- NEVER folded into a content-addressed identity — probed invariant: `merge-promote.js:82` passes
  explicit fields to `mintCapturedMerge`, not the folded entry, so `updated_at` cannot leak into a
  `content_hash` (the retry-collision class `merge-promote.js:15` warns of). Stated so a future edit
  can't regress it (MED-2b).
- Additive: flows through `list`/`get` (no consumer breaks — probed). A `-> queued` re-open restarts
  the clock naturally. Immutability preserved (`foldEntry` builds a fresh object per call).

### Part 2 — compare-and-swap on `advance` (HIGH-3 keystone)

Add an optional `expect_state` to `advance(input, opts)`: under the store lock, after re-folding, if
`input.expect_state` is set and `cur.state !== input.expect_state`, refuse
`{ ok:false, reason:'state-changed' }` + an OBSERVABLE alert. Backward-compatible (no
`expect_state` => today's behavior). Validated like `to_state` (must be a known STATE).

This is the keystone: the dispose passes `expect_state:'solving'`, so an entry that raced to
`drafted` (or any other state) between the sweep's unlocked `list` and its `advance` is
UN-disposable. It collapses the blast radius of HIGH-2/HIGH-3 even when the clock is imperfect —
a live solve that reaches `drafted` first can never be reaped.

### Part 3 — the dispose-sweep module (`dispose-stale.js`, mirrors `merge-promote.js`)

`disposeStaleSolving({ now?, staleMs?, queueDir?, queue? }) -> { ok, disposed:[], skipped:[], errors:[] }`

- TOTAL (never throws). SHADOW / weight-0. Mirrors Wave B's summary-object + fail-soft + FIXED
  positional alert token (`'dispose-stale'` + a `kind` detail key — never a variable positional
  arg, never a `reason` key in detail; the `alert.js` positional-clobber lesson — LOW-3).
- `now` DI (default `Date.now()`), `staleMs` DI (default `DEFAULT_STALE_MS`, exported), `queue` DI
  (default the real store).
- Per `solving` entry: `typeof updated_at !== 'number'` -> `skipped:no-timestamp`;
  `age = now - updated_at < staleMs` -> `skipped:not-stale` (a negative/future-ts age is `< staleMs`
  too -> skipped, fail-safe — LOW-4); else
  `advance({ to_state:'disposed', expect_state:'solving', evidence:{ reason:'stale-solving-timeout' } })`;
  ok -> `disposed[]` + alert; `state-changed`/other non-ok -> `skipped`/`errors` (a CAS refusal is a
  benign lost-race skip, not an error).
- `DEFAULT_STALE_MS = 7200000` (2h): ~40x the 3-min default actor timeout, so a crashed zombie is
  reaped within 2h (the re-submission-lockout latency — LOW-2) while a realistic live solve (default
  or a bounded `--timeout`) never ages out mid-run. Configurable (reverses the naive plan's YAGNI —
  MED-1) so an operator running longer solves can widen it.

### Part 4 — bound `--timeout` to the window (HIGH-1)

At the solve-driver boundary (`live-solve-one.js`, where the unbounded `--timeout` enters), assert
`timeout_ms + MARGIN <= DEFAULT_STALE_MS` (import the exported constant). An operator who needs a
longer solve gets a fail-fast error telling them to widen `staleMs`, instead of a silently-disposed
live solve. Closes HIGH-1 (the default and `live-loop` paths are already well within the window).

### Part 5 — wire PASS 0 into the poll

`pollSolveQueue` runs `disposeStaleSolving({ queueDir: o.queueDir })` FIRST (before PASS 1),
wrapped in try/catch so a throw can't abort PASS 1/2 (mirrors the existing `queue.list` fail-soft,
`solve-queue-poll.js:61-62` — LOW-1); adds `summary.disposed`. `dispose` issues zero gh calls, so it
can't consume PASS 1's rate-limit budget. Only `queueDir` (production 0-dir -> store default;
isolated -> supplied). No `solve-queue-schedule.js` change.

### Accepted residual (documented, bounded)

HIGH-2 (resume-a-zombie: a re-run resumes a still-`solving` entry WITHOUT refreshing the clock) is
NOT fully closed — a heartbeat/`solving -> solving` self-transition would close it but costs a
state-machine change. Instead it is BOUNDED: with `staleMs = 2h`, the race needs a resume within
`timeout` (~3 min) of the 2-hour mark after the original crash — resuming a crashed solve ~1h57m
later, absurd in practice — and CAS caps the harm (a resumed solve that reaches `drafted` is
un-disposable; the worst case is one wasted re-solve + a benign alert, SHADOW-bounded). If it ever
bites, the heartbeat is the escalation.

## Test plan (TDD-first)

- **fold**: `updated_at` = last-accepted-event `ts`; = re-queue `ts` after a `disposed -> queued`
  re-open; `undefined` when the accepted event's `ts` is non-numeric; a SKIPPED event's `ts` is NOT
  the `updated_at`. MED-2a: `claimNext` orders by `_queuedAt` even when `updated_at` order differs.
- **store CAS**: `advance` with matching `expect_state` succeeds; with a mismatched `expect_state`
  refuses `state-changed` (+ alert) and writes NO event; absent `expect_state` = unchanged behavior;
  a bad `expect_state` value -> `bad-input`.
- **dispose-stale**: happy dispose (stale `solving` -> `disposed` + `evidence.reason` + FIXED-token
  alert); not-stale skip (fresh `solving` untouched — the race guard); no-timestamp skip;
  only-`solving` (`queued`/`drafted`/`in_flight` untouched); the CAS race — an entry that advanced to
  `drafted` after the list-read is `skipped:state-changed`, NOT disposed (inject a `queue` DI whose
  `list` returns a `solving` snapshot but whose `advance` sees `drafted`); disposed re-openable via
  `enqueue` (`disposed -> queued`, evidence reset); advance-failure -> `errors[]`; TOTAL (throwing
  `queue` DI -> `ok:false`, never throws); `now`/`staleMs` DI determinism; real-store write-through
  (isolated `LOOM_LAB_STATE_DIR`, non-vacuous — plant a real stale `solving` entry with a back-dated
  `now` and assert the on-disk state becomes `disposed`).
- **poll**: PASS 0 runs before PASS 1; `summary.disposed` populated; production 0-dir uses the store
  default; isolated wiring passes `queueDir`; a full sweep disposes a stale `solving` entry; a
  throwing PASS 0 does NOT abort PASS 1/2 (TOTAL).
- **live-solve-one**: `--timeout` within the window is accepted; `--timeout` exceeding
  `DEFAULT_STALE_MS - MARGIN` fails fast with a clear error.

## Files

- `packages/lab/solve-queue/solve-queue-fold.js` — `updated_at` in `foldEntry`.
- `packages/lab/solve-queue/solve-queue-store.js` — `expect_state` CAS in `advance`.
- `packages/lab/solve-queue/dispose-stale.js` — NEW sweep module (exports `DEFAULT_STALE_MS`).
- `packages/lab/solve-queue/solve-queue-poll.js` — PASS 0 wire (try/catch) + `summary.disposed`.
- `packages/lab/persona-experiment/live-solve-one.js` — `--timeout <= staleMs` bound (HIGH-1).
- tests: `solve-queue-fold.test.js` (+`updated_at`, +ordering), `solve-queue-store.test.js` (+CAS),
  `dispose-stale.test.js` (NEW), `solve-queue-poll.test.js` (+PASS 0), `live-solve-one.test.js`
  (+timeout bound).

## Architect VERIFY — findings folded

- **HIGH-1** (mis-probed premise: `--timeout` unbounded, not capped at the 180s default) -> FIXED,
  Part 4 (CLI bound `timeout_ms + MARGIN <= DEFAULT_STALE_MS`).
- **HIGH-2** (resume-a-zombie decouples `updated_at` from liveness) -> BOUNDED + documented (Accepted
  residual): generous `staleMs` defeats the concrete scenario; CAS caps the harm; heartbeat is the
  named escalation.
- **HIGH-3** (TOCTOU / no CAS; `drafted -> disposed` legal) -> FIXED, Part 2 (`expect_state` CAS).
- **MED-1** (flat constant, decoupled knobs) -> FIXED: `staleMs` configurable + coupled to
  `--timeout` via the Part 4 bound.
- **MED-2** (fold-layer choice) -> CONFIRMED correct (acceptance-aware) + guardrails 2a (ordering
  test) / 2b (content-hash non-leak probe).
- **LOW-1** (PASS 0 fail-soft) -> Part 5 try/catch. **LOW-2** (re-submission lockout) -> documented.
  **LOW-3** (fixed alert token) -> Part 3. **LOW-4** (forward clock jump) -> fail-safe skip + CAS.

## Out of scope

- A CLI `--stale-ms` flag (YAGNI — the default + DI suffice; add if ops needs tuning).
- Sweeping `queued`/`drafted` (a `queued` entry waits for `claimNext`; a `drafted` entry waits for
  the operator-armed emit — neither is a zombie).
- The armed emit (`drafted -> in_flight`) — operator-only, never Claude.

## VALIDATE — board findings folded (code-reviewer + hacker, on the BUILT diff)

- **code-reviewer: APPROVE** — 0 CRITICAL/HIGH/MED; all six focus areas verified correct against the built
  code. 1 LOW (`alert()` `kind` clobberable by a same-named detail key) -> FIXED (`kind` spread LAST).
- **hacker H1 (age-TOCTOU, HIGH)** — the state-only CAS pinned STATE but not AGE: an entry cycling
  `solving(stale) -> disposed -> queued -> solving(FRESH)` in the unlocked list->advance window would be
  disposed (CAS sees `solving`). Proven with a live probe. -> FIXED: added an `expect_updated_at` VERSION-CAS
  (`updated_at` changes on every accepted event -> a natural version token). The sweep pins
  `expect_updated_at: e.updated_at`; a re-solve wrote a new event -> `version-changed` -> refused.
  **Mitigation premise-probed firsthand** (not just asserted): the hacker's exact attack DI (stale list
  snapshot + real-store advance) now returns `version-changed` and the fresh solve stays `solving`. Probe:
  `scratchpad/probe-h1-fix.js`.
- **hacker M1 (future-ts un-reapable, MED)** — a future-dated `ts` pins `updated_at` above `now`, so the
  entry is never stale and (via idempotent enqueue) never re-openable. -> FOLDED as OBSERVABLE: a materially
  future age (`< -staleMs`) emits a `future-ts-suspect` alert for manual intervention. Kept the fail-safe
  skip (auto-reaping risks disposing a skew-live solve). Permanent lockout requires a TAMPERED log, which
  the store header already documents as an accepted SHADOW risk ("a tampered entry can at worst deny/mis-drive").
- **hacker L1 (throwing-getter escapes TOTAL, LOW; not production-reachable)** -> FIXED: per-entry loop body
  wrapped in try/catch (null-safe id) so even a hostile test-only DI can't break TOTAL.
- **hacker L2 (--timeout lenient `Number()`)** -> SKIP (cosmetic; the hacker confirmed no over-window bypass
  — every coerced form is bound-checked). **L3 (store doesn't re-derive entry_id on read)** -> SKIP
  (pre-existing documented KISS choice of the weight-inert store; not this change; no cross-entry disposal).

## Pre-PR CodeRabbit CLI (the cheaper complementary lens, run BEFORE the PR) — 5 findings, all folded

The board (architect + code-reviewer + hacker) passed the diff; the pre-PR `coderabbit review --agent`
still caught 3 MAJORS the board missed (the recurring "pre-PR CodeRabbit catches Majors a board rated
clean/bounded" signal), one round before the PR:

- **Major (store): the ts-based version-CAS can COLLIDE at ms-resolution** — two events in the same
  millisecond share a `ts`, so a `solving -> disposed -> queued -> solving` cycle within 1ms would present a
  stale snapshot as current. -> FIXED: replaced `expect_updated_at` with `expect_rev` (a MONOTONIC count of
  accepted events, clock-independent, ms-collision-proof). `updated_at` stays the staleness clock only.
  Regression test: a 5-event cycle at one shared `ts=100` -> the stale rev-2 snapshot is refused.
- **Major (fold): `updated_at` fell BACK to an older ts on a corrupt last-event ts** — fail-DANGEROUS (an
  entry whose latest event has a bad ts looks staler than it is -> premature disposal). -> FIXED:
  `updated_at` = ONLY the last accepted event's ts, `undefined` if that is non-finite (-> sweep skips, fail-safe).
- **Major (poll): PASS 0 swallowed a whole-sweep failure** (`swept.ok===false` with empty `errors[]`, e.g.
  `list-threw`) -> FIXED: a dispose-stage summary error is recorded (fail-closed-must-be-observable).
- **Minor**: timeout help/error text clarified (the cap is the window MINUS the grade/draft margin); m6 poll
  test strengthened to assert no dispose-stage error (proves PASS 0 examined the queue).
- **Self-added while folding**: the version-CAS is now NON-BYPASSABLE — a rev-less entry is skipped `no-rev`
  (never disposed without version protection), so the H1 guard can't be dodged by a snapshot lacking `rev`.

## Runtime Probes accretion / sign-off

- H1-fix mitigation probe (`scratchpad/probe-h1-fix.js`): stale-snapshot (old rev) attack -> `version-changed`,
  fresh solve stays `solving`. PASS (re-run after the rev-CAS fold).
- Full lab unit suite green after ALL folds (fold 18 / store 23 / dispose-stale 16 / poll 6 / live-solve 17;
  all lab tests exit 0). eslint / signpost / release-surface / markdownlint clean.
