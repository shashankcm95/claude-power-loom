# ③.0-W1 — kernel close-path latency hardening

**Phase:** ③.0 (foundation-hardening, the live-beta prereq track) · **Date:** 2026-06-17 ·
**Status:** PLAN (pre-VERIFY) · **Charter:** `2026-06-16-test-phase-live-beta-charter.md` ③.0-W1

## Goal

Keep the synchronous PostToolUse:Agent|Task close path well inside its **10 s hook timeout**
(`hooks.json` `spawn-close-resolver.js` `timeout: 10`) at sustained beta volume — where the persona
runs on large external repos (CPython/Django) and fires many concurrent spawn/Edit closes. A timed-out
or killed close hook silently loses the spawn's provenance. Derived from the 2026-06-16 whole-substrate
review (board `wf_39a1072c-fe6`, Bucket A) — the 3 kernel-latency HIGHs + 2 cheap MEDs.

This is a **pure hardening wave** — no new feature, no shadow→live flip, no trust change (OQ-NS-6
untouched). The measured-out item below is the discipline working: a flagged HIGH that measurement
downgrades to YAGNI.

## Scope (measurement-revised)

| Item | Review tier | This wave | Why |
|---|---|---|---|
| **W1-A** library-catalog `process.exit(2)` → soft-fail | HIGH | **BUILD** | a lock-timeout in a hook must not kill the process |
| **W1-B** collapse the two close-path git tree-walks → one `status --porcelain` | HIGH | **BUILD** | deterministic ~2×→1× walk; scales with repo size |
| **W1-C** `deepFreeze` cycle-guard via WeakSet | MED | **BUILD** | #266 recurrence-class; cheap + contained |
| ~~in-memory record-store index~~ | HIGH | **SCOPE OUT** | measured ~30 ms @ N=1000 = 0.3% of budget; the feared D×N isn't on the hook path (probe #3). YAGNI — the code comments already say so |
| `validateTransactionRecord` `abort_detail` bound | MED | **CONDITIONAL** | likely redundant with the canonical-json depth bound (probe #4); VERIFY board decides — recommend scope-out |

## Runtime Probes (claims verified against the actual repo/runtime, not prose)

1. **Git walk cost — collapse is a real, deterministic win.**
   Probe (this repo, 5-run avg): `git diff --name-only HEAD` 30.3 ms; `git status --porcelain` 30.7 ms;
   two-walk total **61.0 ms** vs one-walk **30.7 ms**. Each walk is a full working-tree scan → on a
   CPython/Django-sized tree both grow together; halving the count halves the dominant close-path git
   cost. → **W1-B is worth it.**

2. **record-store O(N) append latency — measured.**
   Probe (`/tmp/loom-latency-probe.js`, real `buildSpawnRecord`→`appendRecord` into a temp run dir):
   append incl. the `readByIdempotencyKey` dedup scan = 0.68 ms @N=10 · 3.06 @N=100 · 13.9 @N=500 ·
   **29.8 ms @N=1000**; the isolated scan ≈ 27 ms @N=1000. Linear, as expected. At a pessimistic
   N=1000 records in ONE run dir it is **0.3% of the 10 s budget**, dwarfed by the git walks. →
   **in-memory index is YAGNI; SCOPE OUT** (documented; resurrect only if a real long-beta-run
   measurement shows otherwise).

3. **The feared D×N chain-walk is NOT on the synchronous hook path.**
   Probe: `spawn-close-resolver.js:596` `resolveParentFn: undefined` (comment: "live spawns are
   genesis-position (D3)") → `resolve()` never walks the state chain in the close hook. The only
   record-store call per close is the single `appendRecord` in `recordSpawnProvenance`. The review's
   "chain-walk × appendRecord = D×N in the synchronous close hook" is FALSE for the current shadow
   wiring — `readByPostStateHash` runs only in the out-of-band `integrator.js`. → confirms probe #2's
   scope-out.

4. **`abort_detail` is already depth-bounded at the hash layer.**
   Probe: `transaction-record.js:425-429` validates `abort_detail` is object-or-null; the comment +
   `appendRecord:206-215`/`loadRecordFile:311-313` show a deep/wide field trips
   `canonicalJsonSerialize`'s `MAX_CANONICAL_DEPTH=100`/node budget → controlled throw →
   `record-uncomputable`. The DoS is already closed fail-closed. A validate-time bound adds only
   fail-fast + a clearer reason, at the cost of a 2nd depth constant to keep in sync (DRY hazard). →
   **recommend SCOPE OUT**; VERIFY confirms.

5. **The soft-fail pattern to mirror already exists (W1-A).**
   Probe: `error-critic.js:54-101` + `pre-compact-save.js:30-44,264-276` — both hook consumers import
   `{acquireLock, releaseLock}` with an `acquireLock = () => false` fallback and do
   `if (acquireLock(lockPath,{maxWaitMs})) { try {…} finally { releaseLock(lockPath); } }` — acquire-
   or-skip, **never** `process.exit`. W1-A brings library-catalog to this established convention.

6. **W1-A caller chain (why it's on the beta hot path).**
   Probe: `library-catalog.js` `writeCatalog`/`upsertEntry`/`removeEntry` → `withLock` (`lock.js:191-197`,
   `process.exit(2)` on timeout). Callers: `library-reconcile.js:209,300` → `catalog-reconcile-write.js`
   (PostToolUse:**Edit|Write** hook). Under the beta's many concurrent Edit closes, a lock-timeout
   `process.exit(2)` kills the hook process (lost work; non-zero exit). → real.

## Design

### W1-A — library-catalog soft-fail (`lock.js` + `library-catalog.js`)

- **`lock.js` (additive, Open/Closed — do NOT touch `withLock`):** add
  `withLockSoft(lockPath, fn, opts)` → returns `{ ok: true, value: fn() }` on success, or
  `{ ok: false, reason: 'lock-timeout' }` on acquire failure (acquire → try/finally release → never
  `process.exit`). The soft sibling of `withLock`; `acquireLock`/`releaseLock` reused verbatim.
- **`library-catalog.js`:** `writeCatalog`/`upsertEntry`/`removeEntry` call `withLockSoft` instead of
  `withLock`; on `!ok` emit ONE guarded `process.stderr.write('[library-catalog] …\n')` (matching
  lock.js's own stderr style) and **return a `{ ok, reason }` status** (additive — current callers
  ignore the void return, so a dropped best-effort catalog write degrades search, never corrupts
  state or kills the hook). The index write is best-effort by design (a lost entry is re-derivable by
  `library reconcile`); soft-fail is the correct posture in a hook.
- **Immutability:** `withLockSoft` constructs a fresh result object; no shared mutable state.

### W1-B — collapse the two git walks (`spawn-close-resolver.js`)

Currently `resolveAndJournal` runs TWO full working-tree scans: `buildK14CtxFromWorktree` →
`diff --name-only HEAD` (k14_git_ms), then `recordSpawnProvenance` → `status --porcelain` (the dirty
gate). Collapse to **ONE** `status --porcelain` run in `resolveAndJournal`, parsed into both outputs:

- `dirty = (trimmed output !== '')` — **unchanged** from the current producer semantics (untracked-aware).
- `k14Names` — parse porcelain lines, **exclude untracked/ignored** (lines whose first char is `?` or
  `!`), strip the `XY ` 3-char prefix, and for a rename (`XY ORIG -> NEW`) take the post-`-> ` path.
  This **preserves the current K14 semantics** (`diff --name-only HEAD` = tracked-only, worktree+index
  vs HEAD) — a pure latency change, zero scope-detection behavior drift.
- Thread both down: `buildK14CtxFromWorktree` becomes a pure builder taking the parsed `k14Names`
  (no own git); `recordSpawnProvenance` takes the `dirty` bit (no own status call). The rev-parse
  `HEAD^{tree}` (O(1), only when clean) stays.
- **Behavior-preservation is the load-bearing constraint** — the K14 targetPath, the dirty gate, and
  postStateHash must be byte-identical to today on every existing test. Verified by the existing
  `spawn-close-resolver.test.js` suite passing unchanged + new collapse-specific tests.
- **Telemetry:** emit `status_git_ms` (the one shared walk); keep `producer_git_ms` (now rev-parse
  only) + `k14_git_ms` (now 0 / shared) for journal-reader back-compat, documented honestly.
- **SUPERSEDED by the VERIFY folds below** — the line-mode parse + the "quoting parity means no
  regression" rationale were proven FALSE by the hacker lens (`od -c` evidence). The build adopts
  `--porcelain -z`. See `## VERIFY result + folds (2026-06-17)`.

### W1-C — `deepFreeze` cycle-guard (`deep-freeze.js`)

Replace the `Object.isFrozen(value) → return` termination (which conflates "already frozen, skip
children" with "cycle") with a `WeakSet` of visited nodes threaded through an internal recursion param:

```js
function deepFreeze(value, seen) {
  if (value === null || typeof value !== 'object') return value;
  const s = seen || new WeakSet();
  if (s.has(value)) return value;   // cycle guard
  s.add(value);
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key], s);
  return value;
}
```

Public signature unchanged (`deepFreeze(value)`); `seen` is internal. Now an already-frozen node with
unfrozen children gets fully frozen (closes the #266 recurrence class the header documents as latent),
and true cycles terminate. Identical behavior for the record-store use (JSON.parse output is never
pre-frozen / never cyclic).

## Test plan (TDD — red first)

- `lock.test.js`: `withLockSoft` returns `{ok:true,value}` on a free lock; `{ok:false,reason:'lock-timeout'}`
  when the lock is held past `maxWaitMs` (no `process.exit`); releases on success AND on `fn()` throw.
- `library-catalog.test.js`: `upsertEntry`/`writeCatalog`/`removeEntry` return `{ok:true}` normally; on a
  held lock they return `{ok:false}` + do NOT `process.exit` + leave the catalog intact (no partial write).
- `spawn-close-resolver.test.js`: (a) the full existing suite passes unchanged (behavior preservation);
  (b) a fake `runGit` asserts `status --porcelain` is invoked and `diff --name-only` is NOT; (c) K14
  targetPath is derived from a tracked porcelain line and a rename line; (d) `??` untracked lines are
  excluded from K14 names but DO set `dirty`; (e) dirty→postStateHash=null, clean→rev-parse path.
- `deep-freeze.test.js`: a pre-frozen parent with an unfrozen child → child frozen after; a cyclic
  object → no infinite recursion; record-store parse output → deeply frozen (unchanged).

## Gate

`bash install.sh --hooks --test` (eslint/yaml/markdownlint → green) + the full kernel suite
(`find tests/unit/kernel -name '*.test.js' -print0 | xargs -0 -n1 node` → all green). ASCII-only; zero
eslint-disable. Prune stale `.claude/worktrees/` before Test 80.

## Routing Decision

```json
{ "recommendation": "route", "rationale": "kernel/enforced multi-file change (4-5 files) touching the synchronous close-path hook + a shared lock primitive + the immutability primitive; earns the 3-lens board by stakes despite route-decide scoring substrate work 'root' on a stakes-lexicon miss (documented escalation-by-judgment)." }
```

## HETS Spawn Plan

- **VERIFY (pre-build, 3 read-only lenses, parallel):** architect (design soundness of `withLockSoft`
  + the git-walk collapse data-flow + the deepFreeze WeakSet; behavior-preservation risk) · hacker
  (does the collapse change what K14 scope-detection sees? can soft-fail drop a security-relevant
  write silently? porcelain-parse edge cases — quoted/rename/`->`) · honesty-auditor (is HIGH-2's
  scope-out evidence-backed? is W1-B truly behavior-preserving or is "preserving" cover for drift?).
- **BUILD:** direct TDD by the orchestrator (tight cross-file design coupling; surgical kernel edits).
- **VALIDATE (post-build, 3 lenses, parallel):** code-reviewer (correctness/diff) · hacker (Rule-2a
  LIVE re-probe of the BUILT code — run the collapsed git path + the soft-fail path against real
  fixtures, not just unit mocks) · honesty-auditor (claims-vs-diff: did behavior actually stay
  preserved; is the telemetry honest).

## VERIFY result + folds (2026-06-17)

3-lens board `wf_b2bd9426-e88` (architect + hacker + honesty). **All three: PROCEED-WITH-CHANGES.**
Both scope-outs (HIGH-2 record-store index, MED-2 abort_detail bound) were **independently re-derived
and CONFIRMED correct** by the honesty lens (resolveParentFn:undefined at spawn-close-resolver.js:596 →
no D×N in the hook; canonical-json `MAX_CANONICAL_DEPTH=100` already fail-closes abort_detail). The
convergent catch: **W1-B's line-mode parse is unsafe** — folded below.

### Pinned probe output (honesty H2 — was an unprovenanced /tmp point-estimate)

```
record-store appendRecord incl. O(N) idempotency scan, real buildSpawnRecord into a temp run dir:
N       append_ms(incl O(N) scan)   readByIdem_ms
10      0.68                        0.24
100     3.06                        2.02
500     13.93                       1.16
1000    29.82                       27.14
git walk (this repo, 5-run avg): diff --name-only HEAD 30.3ms ; status --porcelain 30.7ms ; 2-walk 61.0 vs 1-walk 30.7
```

29.82 ms @N=1000 / 10000 ms budget = 0.30%. Scope-out is wiring-conditional: if a future enforcing
wave wires `resolveParentFn` into the close hook, the D×N concern reopens (noted, not permanent).

### W1-B — REVISED design (folds hacker H1/H2/H3 + honesty H1)

Run ONE `git status --porcelain -z` (NUL-framed — **never quoted, no octal escaping**, unambiguous
rename framing). Parse:

- Split on `\0`; drop the trailing empty token. Each entry token is `XY␠PATH` (2 status chars, a
  space, then the raw path). For a rename/copy (`X` or `Y` is `R`/`C`) the **next** NUL token is the
  SOURCE path — consume + skip it; the entry's own PATH is the destination (matches `diff`'s view).
  `-z` framing means a literal `' -> '` inside any filename is just data (kills H2); raw bytes mean a
  path with spaces/non-ASCII is byte-exact (kills H1).
- `dirty = (raw output !== '')` — untracked-aware, **unchanged** from the current `status --porcelain`
  producer semantics. Via the SAME `okStdout` fail-CLOSED discipline: a non-ok/timed-out read → null →
  `dirty=true`.
- `k14Names` = entries whose `XY` is not `??` (untracked) and not `!!` (ignored) — the tracked-changed
  set, matching `diff --name-only HEAD`. **SORT lexicographically** before taking `[0]` (kills H3: the
  two commands have no shared ordering contract; sorting makes targetPath order-stable — a small,
  defensible determinism improvement).
- **Fail-direction (honesty H1) — preserved explicitly + tested:** on a failed/timed-out status read,
  `dirty` fails-CLOSED (→ true → `post_state_hash=null`) and `k14Names` is empty (K14 target-less,
  fail-open — same as today's diff-fail-open). Documented as an acceptable narrowing, **proven by a
  failed-read test**, not asserted.
- Claim correction: NOT "byte-identical on every read". Correct claim: **behavior-preserving on every
  SUCCESSFUL read (tracked-name set + dirty + postStateHash); a defined, tested fail-direction on a
  failed read.**

### W1-A — folds (architect W1A-1, hacker M1, honesty L2)

- **Outer persona lock (W1A-1): defer with rationale + tripwire.** Probe: `persona-store.js`'s
  `withPersonaLock`→`sharedWithLock`(=hard-exit `withLock`) is reached ONLY by `pattern-recorder.js`
  + `identity/registry.js`, both `process.argv`-driven CLI/orchestration tools — **NOT** any
  synchronous PostToolUse hook (grep: zero hook requires persona-store). There `process.exit(2)` is
  the acceptable CLI-abort. W1-A's catalog lock IS hook-reached (`catalog-reconcile-write.js`
  PostToolUse:Edit|Write) — the correct hot-path target. **Beta-tripwire:** if a future wave wires
  persona-store into a synchronous hook (e.g. per-spawn reputation), convert `withPersonaLock` to the
  soft variant FIRST.
- **Observability (M1):** keep the stderr line + the `{ok,reason}` status return now; aggregate
  drop-rate telemetry is deferred to the ③.1 structured trace-emitter (which instruments every seam by
  design — the natural home, vs coupling a counter into a leaf `_lib` module). Named deferral, not a
  dismissal.
- **Wording (L2):** W1-A adopts the soft-fail POSTURE of the existing hooks via a NEW `withLockSoft`
  wrapper (additive, Open/Closed) — not a pre-existing convention.

### Telemetry fold (W1B-2 / hacker L1 / honesty L1 — all converge)

Grep-confirmed no analytics tool consumes the fields. **Drop `k14_git_ms`** (its referent no longer
exists); add `status_git_ms` (the one shared walk) as the authoritative close-path git metric; keep
`producer_git_ms` (now accurately the rev-parse-only time). Update the test's field assertion.

### W1-C fold (architect W1C-1)

Add a one-line comment on `seen || new WeakSet()`: fresh-per-top-level-call so an independent graph in
a later call is never falsely skipped + the set is GC'd with the call (pre-empts a module-scope
"optimization" that would reintroduce the skip bug).

## VALIDATE result (2026-06-17)

3-lens board `wf_3739b4c2-75a` on the BUILT diff (code-reviewer + hacker Rule-2a live re-probe +
honesty). **reviewer SHIP-WITH-NITS · hacker SHIP-WITH-NITS · honesty SHIP (Grade A, NO-OVERCLAIM).**
The hacker live-probed all four surfaces (24 parseStatusZ byte-streams + 6 real-git scenarios,
traversal targetPath, dirty-default hashing, held-lock soft-fail + catalog corruption, deepFreeze
cycles + deep-nesting) — **every security-load-bearing defense HELD** (the `-z` parse agrees
byte-exactly with `diff --name-only HEAD`; traversal targetPath dropped by checkWithinRoot; `dirty ===
false` fail-closes; soft-fail never partial-writes; the WeakSet terminates cycles + fixes #266). The
honesty lens verified all 4 claim classes against the code firsthand. 3 LOW findings, all folded:

- **H-W1-1 (hacker):** deepFreeze was depth-unbounded (stack-overflow ~10K; defended today only by every
  consumer's depth-100 verify-on-read). **Folded:** converted to an iterative explicit-stack walk —
  self-defending on depth, no `RangeError` at any depth + a >10K-deep regression test.
- **F1 (reviewer):** test #11 tested the wrong mechanism post-W1-B (its `failingRunGit` no longer
  invoked). **Folded:** reframed to "missing-dirty defaults fail-closed" (its now-actual contract); the
  failed-status-read path is covered by the new `readWorktreeStatus` fail-closed test.
- **H-AUDIT-1 (honesty):** `library-reconcile` callers ignore the new `{ok}` return (a soft-fail drop
  is invisible to their boolean). **Folded:** a one-line "intentionally ignored / best-effort /
  ③.1-owns-telemetry" comment; behavior unchanged (already disclosed in the Honest frame).
- Plus a self-spotted defensive `if (pathStr.length === 0) continue` in parseStatusZ (a malformed
  <3-char token) + its test.

Post-fold gate: full kernel suite 75/0; `install.sh --hooks --test` 125/0; all 186 `tests/unit` files
green by exit code. **Build was orchestrator-direct (not delegated) → no Rule-4 verdict-attestation
subject.**

## Honest frame

Pure latency hardening. No shadow→live flip, no `LIVE_SOURCES` change, no weight gates anything. Trust
moves ZERO (OQ-NS-6). The intentional behavior changes are scoped + safe: (1) the **catalog-write hook
path** (`catalog-reconcile-write.js`) that would have `process.exit(2)`-killed now soft-fails
(best-effort catalog write may drop under extreme contention — logged, re-derivable; the persona-lock
remains a CLI-context hard-exit, see W1A-1 — not a hook hot path). (2) The git-walk collapse is
**behavior-preserving on every successful read** (tracked-name set, dirty bit, postStateHash) with a
**defined, tested fail-direction** on a failed read — proven by new collapse-specific tests
(multi-file/rename/space-in-name/failed-read), NOT merely by the existing single-file suite passing.
