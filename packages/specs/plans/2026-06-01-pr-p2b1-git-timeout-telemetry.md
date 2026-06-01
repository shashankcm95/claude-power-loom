# PR-P2b.1 — bound spawn-close git reads with a timeout + producer latency telemetry

> **Status**: plan authored 2026-06-01, firsthand-probed against main @ `569a01e` (post-#190). A small
> fast-follow to PR-P2b, from the USER's review of #190. Branch
> `feat/v3.1-shadow-producer-git-timeout-telemetry`. Cadence: this plan → focused 2-lens verify
> (architect + code-reviewer) → TDD → build → reviewer on the diff → smoke → commit → **USER merge gate**.

## Context

PR-P2b (#190) wired the live shadow provenance producer. The USER's review surfaced two items:

- **F-01 (idempotency)** — a re-fired close → a duplicate record. **Out of scope here**: it is a
  **P3-entry decision** (the root cause is the wall-clock `intent_recorded_at` in the *shared*
  `genesisRecordFields`; the workable key is `writer_spawn_id`/idempotency_key, connecting to R13 +
  INV-22; recorded in MEMORY). Not a P2b.1 concern.
- **`status --porcelain` latency** — THIS PR. The producer runs `status --porcelain` (+ a cheap
  `rev-parse`) synchronously at spawn-close; PostToolUse is synchronous, so the harness blocks on the
  hook's exit. On a massive worktree, `status` can be slow → a latency spike at close. Two mitigations:
  (a) a **timeout** on the guarded git reads — bounds hook latency AND degrades correctly (timeout →
  fail-closed → dirty → null); (b) **`git_ms` telemetry** in the journal — makes the producer's git
  latency observable per-close (directly serving the "watch the latency" ask).

**Not a new cost class**: the shadow path *already* runs `git diff --name-only HEAD` for K14
(`spawn-close-resolver.js:368`). P2b added one more comparable stat, gated to *completed* worktree-spawns.

## Routing Decision

```json
{ "task": "P2b.1 — add a timeout to the shared guarded git runner (makeGuardedRunGit) + git_ms latency telemetry to the shadow provenance producer",
  "override": "route",
  "override_rationale": "Touches the SHARED hot-path makeGuardedRunGit (used by both the producer and the K14 verdict path) on a fail-soft close hook; the timeout-default value + the degradation-correctness + the call-time-env decision earn a focused verify. Small (~20 LoC impl), but shared-critical-path." }
```

## Runtime Probes (firsthand against main @ `569a01e` this session)

| # | Claim | Probe | Result |
|---|---|---|---|
| 1 | `makeGuardedRunGit`'s `execFileSync` has `{cwd,encoding,maxBuffer,stdio}` — NO timeout; its catch already returns `ok:false` on any throw | `spawn-close-resolver.js:331-348` | ✅ Adding `timeout:` makes a slow git throw (ETIMEDOUT/SIGTERM) → the EXISTING catch (`:338-347`) → `{ok:false}`. **No new degradation code.** |
| 2 | `makeGuardedRunGit` is SHARED — the producer (`status`,`rev-parse`) + `buildK14CtxFromWorktree` (`diff`) both use it; both degrade safely on `ok:false` | `:451-462` (producer), `:367-376` (K14, with its own empty-ctx-on-error comment) | ✅ A timeout degrades BOTH safely (producer → dirty→null; K14 → empty ctx). Bounding both is a feature. |
| 3 | The fail-CLOSED `okStdout` makes a timeout FREE: `ok:false` → null → (`null !== ''`) → DIRTY → null hash | `:397-399`, `:453` | ✅ A timed-out cleanliness check = "couldn't verify clean" = dirty = null — *exactly* the existing correct-or-null semantics. No special-casing. |
| 4 | The producer's git calls are `status` (`:453`) + `rev-parse HEAD^{tree}` (`:460`); the `shadow-provenance-record` journal entry (`:475-489`) is where `git_ms` goes | `:432-489` | ✅ Measure `Date.now()` around the two git reads; add `git_ms` to the existing entry (additive). |
| 5 | `LOOM_SPAWN_STATE_DIR` is read at MODULE-LOAD (`:69`); a CALL-time read of `LOOM_GIT_TIMEOUT_MS` is in-process-testable + runtime-tunable | `:69` | ✅ Read the timeout inside the closure (per git call) — negligible overhead (ns-scale env read vs ms-scale git), unit-testable without a subprocess, tunable without restart. |

## Design — additive, fail-soft

1. **`packages/kernel/hooks/post/spawn-close-resolver.js`**:
   - `DEFAULT_GIT_TIMEOUT_MS = 3000` (a named const near `MAX_GIT_BUFFER`; V4 lowered 5000→3000).
   - `gitTimeoutMs()` — reads `process.env.LOOM_GIT_TIMEOUT_MS`; returns it iff it parses to a **positive
     finite integer**, else `DEFAULT_GIT_TIMEOUT_MS`. Called inside `makeGuardedRunGit`'s closure.
   - Add `timeout: gitTimeoutMs()` to the `execFileSync` options (`:331-336`). The existing catch handles
     the throw → `{ok:false}`; enhance the `git-read-failed` log with `timed_out: err.killed === true`
     for observability (a killed-by-timeout git sets `err.killed`).
   - In `recordSpawnProvenance`: `const gitStart = Date.now()` before the `status` read; `const gitMs =
     Date.now() - gitStart` after the tree read; add `git_ms: gitMs` to the `shadow-provenance-record`
     journal entry. (Scoped to the producer's git wall-time — the latency the USER flagged.)
   - Export `gitTimeoutMs` (test-exposed, like the other helpers).
2. **No change** to the allow-list, `okStdout`, the completed-gate, `head_anchor`, `buildSpawnRecord`,
   `appendRecord`, `record-store.js`, `transaction-record.js`, the schema, the enforcing path, K1.

## Architectural Decisions

1. **Timeout default = 3000ms, env-tunable** (`LOOM_GIT_TIMEOUT_MS`) — V4-revised from 5000. The bound is
   PER guarded git CALL, so worst-case ADDED hook latency on a completed shadow close ≈ **2× the timeout**
   (two tree-walks: the K14 `diff` + the producer `status`; `rev-parse` is O(1)) ≈ **~6s** at 3000ms,
   while giving a large repo's single walk ~3s of headroom; a false-timeout is **harmless** (records null —
   correct-or-null), so an aggressive default is safe. Tunable *down* for more-protective deployments,
   *up* for giant repos.
2. **Call-time env read** (not module-load) — in-process-testable + runtime-tunable; the per-call
   `process.env` read + `Number()` is ns-scale vs the ms-scale git call (negligible).
3. **The timeout on the SHARED runner bounds BOTH** the producer AND the K14 verdict `diff` — a feature
   (both degrade to their existing safe-degraded paths), not a risk.
4. **The fail-CLOSED design makes the timeout free** (Probe #3) — a timed-out cleanliness check is
   "couldn't verify clean" = dirty = null. No new degradation logic; the timeout just reaches the
   already-tested `ok:false → null` path sooner.
5. **`git_ms` scoped to the producer's git wall-time**, in the existing journal entry — additive, no new
   on-disk surface; `record_appended`/`post_state_hash` semantics unchanged.

## Security / correctness review

- **No partial-read hazard.** `execFileSync` with `timeout` THROWS on expiry (kills the child); it never
  returns a partial stdout. So a timed-out git → the catch → `{ok:false, stdout:''}` → `okStdout` null —
  never a truncated tree treated as valid. The S5 "never a partial-path verdict" contract holds.
- **ZERO mutation preserved.** The timeout only makes a read ABORT sooner; it cannot make a read-only verb
  mutate. The allow-list is untouched.
- **Telemetry is inert.** `git_ms` is a number in a journal entry — no injection / no control-flow effect.
- **Validation fails safe.** A hostile/garbage `LOOM_GIT_TIMEOUT_MS` (non-numeric, negative, zero, `NaN`,
  `Infinity`, `1e100`) falls back to the 3000ms default — never `0`/negative (which Node treats as "no timeout").

## TDD test inventory (write RED first — the file's imperative `assert` + `test(...)` style)

1. **`gitTimeoutMs()` default** — no env → `3000`.
2. **`gitTimeoutMs()` valid override** — `LOOM_GIT_TIMEOUT_MS='250'` → `250` (restore env after).
3. **`gitTimeoutMs()` invalid overrides fall back to default** — `''`, `'abc'`, `'-5'`, `'0'`, `'1.5'`,
   `'Infinity'`, `'1e100'`, `'5e308'` each → `3000` (pin the fail-safe validation; `0`/negative must NOT pass — Node reads them
   as "no timeout").
4. **Timeout degradation (real git)** — `LOOM_GIT_TIMEOUT_MS='1'`: `makeGuardedRunGit(repo)(['status',
   '--porcelain'])` → `ok:false` (1ms < git process startup → reliably killed); and end-to-end via
   `recordSpawnProvenance` on a clean committed repo → `post_state_hash:null` (a timed-out status reads
   dirty). Restore env.
5. **`git_ms` telemetry** — a normal completed-clean producer run → the `shadow-provenance-record` journal
   entry carries a **numeric, finite `git_ms >= 0`**.
6. **Regression** — the existing 32 hook tests pass (the 3000ms default never times out a normal test git
   call; `git_ms` is additive; the `timed_out` log field is additive).

## Out of scope / deferred

| Item | Why | Target |
|---|---|---|
| F-01 idempotency (skip-if-exists vs tolerate-on-read; the K9 walk tolerating sibling dups) | a store/builder-surface decision; the root cause is the shared wall-clock `intent_recorded_at` | **P3** (+ R13/INV-22, PR-4) |
| Consolidating K14 + the dirty-gate onto a SINGLE `status` stat (one worktree walk) | changes the K14 targetPath logic — its own concern + risk | a separate optimization PR (optional) |
| Verdict-path (`resolve()`/K14) latency telemetry | this PR scopes `git_ms` to the producer (the flagged call) | future, if needed |

## Risks & Open Questions

- **R-1:** the 1ms-timeout test (test #4) relies on git process-startup (typically 2–10ms) exceeding 1ms.
  Robust in practice; if ever flaky on an extreme machine, assert the degradation via a
  guaranteed-`ok:false` injected runner instead (the producer-level path is already covered by P2b's
  test #11). Low risk.
- **R-2:** the shared-runner timeout changes the K14 `diff`'s behavior under a slow repo (→ empty ctx).
  That is the *existing* safe-degraded path (the K14 honesty comment at `:351-361` documents
  empty-ctx-on-error). No new behavior class.

## HETS Spawn Plan

| Stage | Persona | Lens |
|---|---|---|
| Verify (plan) | `architect` + `code-reviewer` (read-only) | the timeout default's sanity (→ lowered to 3s); the call-time-env decision; degradation correctness (no partial read); test adequacy (the 1ms approach) |
| Build | self (main loop) | TDD (RED → GREEN); small, well-understood, full-context |
| Review (diff) | `code-reviewer` (read-only) | concrete bugs, the shared-runner blast radius, fail-soft, the validation edge cases |
| Probe | self | smoke `118/0` + the timeout-degradation + `git_ms` tests firsthand |

Read-only verify personas only (architect/code-reviewer), never Write-capable.

## Drift Notes

- **DN-1:** the fail-CLOSED design (P2b's `okStdout`) made the timeout *free* to add — a timed-out
  cleanliness check is already "dirty → null". A latency bound and a correctness posture composed for free
  because the earlier phase chose fail-closed. (Worth noting: defensive fail-closed choices pay forward.)
- **DN-2 (verify-caught, empirical):** the code-reviewer ran `execFileSync('git',…,{timeout})` and found
  `err.killed` is **`undefined`** on the synchronous timeout (only `err.code==='ETIMEDOUT'` + `err.signal`
  are set) — the plan's first `err.killed === true` telemetry predicate would have been permanently false.
  *Empirically probe the runtime's error shape before keying telemetry/logic on a field name.*

## Pre-Approval Verification

Two read-only lenses (architect + code-reviewer) reviewed this plan against main @ `569a01e`. The
code-reviewer verified the load-bearing runtime claims **empirically** (a throwaway `/tmp` git repo).

**Verdicts:** architect `APPROVE-WITH-REVISIONS` · code-reviewer `APPROVE-WITH-REVISIONS`. **No CRITICAL.**
Both **confirmed**: `execFileSync` timeout THROWS (never a partial stdout — the S5 contract holds); the
existing catch (`:338-347`) turns it into `{ok:false}` (no new degradation code); `okStdout` fail-closed
makes the timeout free (timed-out clean-check → dirty → null); the shared-runner timeout degrades the K14
`diff` safely (empty-ctx, the documented path); `git_ms` is additive/inert; F-01 idempotency is correctly
deferred to P3.

| # | Lens | Sev | Finding | Resolution |
|---|---|---|---|---|
| V1 | code-reviewer | HIGH | `timed_out: err.killed === true` is **always false** — `execFileSync` timeout sets `err.code==='ETIMEDOUT'`/`err.signal==='SIGTERM'` but NOT `err.killed` (empirically confirmed) | Use **`err.code === 'ETIMEDOUT'`** for the `timed_out` log field. |
| V2 | code-reviewer | HIGH | the validation predicate accepts `1e100` (`Number.isInteger(1e100)===true`) → an effectively-infinite timeout defeats the feature | Predicate = **`Number.isInteger(n) && n > 0 && n <= Number.MAX_SAFE_INTEGER`**; add `'1e100'` to the test #3 reject set. |
| V3 | architect | HIGH | `git_ms` under-measures — the K14 `diff` (`:377`, runs FIRST via `buildK14CtxFromWorktree` at the top of `resolveAndJournal`) is equally slow but excluded | Rename → **`producer_git_ms`** (the status+rev-parse) on the provenance record; ADD **`k14_git_ms`** (measured around `buildK14CtxFromWorktree`) on the always-journaled `shadow-resolver-verdict` entry → complete close-time git telemetry. |
| V4 | architect | HIGH | the timeout bounds each CALL, not hook latency — worst-case ≈ N×timeout (~10s at 5000ms, 2 tree-walks) | **Default 3000ms** (worst-case ~6s; big-repo single-walk headroom 3s; false-timeout is harmless→null); AD-1 states the **N×timeout** bound honestly. |
| V5 | architect | MED | reading the env per-git-call could observe 3 different values mid-close (a non-issue in the synchronous lifetime, but unclean) | Read `gitTimeoutMs()` **once** in `makeGuardedRunGit(cwd)` (outside the returned closure) — one consistent value per close, still call-time/testable/tunable. |
| V6 | code-reviewer | MED | test #4's 1ms-timeout is fine here (git startup ~14ms) but OS/CI-variance-fragile for the *semantic* assert | Assert the `post_state_hash:null` degradation via an **injected `ok:false` runner** (P2b's test #11 path); keep ONE real **1ms** test that the timeout option *physically fires* (`ok:false`). |
| V7 | reviewer+architect | LOW | edge inputs `'1e2'`(→100, accept), `' 5000 '`(→5000, accept) are harmless; `'1e100'` is the dangerous one (V2) | Covered by V2's `MAX_SAFE_INTEGER` cap; document that `Number()` whitespace/sci-notation that lands on a safe positive int is intentionally accepted. |

**Net:** mechanism correct + safe to ship; the two HIGH bugs (the always-false `err.killed`; the
unbounded `1e100`) and the two HIGH framings (`producer_git_ms`+`k14_git_ms`; the 3000ms default + honest
N×timeout) are folded. **Build-ready.**
