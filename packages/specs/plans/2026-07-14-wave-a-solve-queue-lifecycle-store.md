---
lifecycle: persistent
---

# Wave A — the solve-queue lifecycle store (item-8 Part-A)

**Status**: Proposed → pending `/verify-plan` (architect + code-reviewer) → USER approval before build.
**Date**: 2026-07-14
**Scope**: SHADOW / weight-inert / additive. ONE new lab store + its CLI. The state backbone for the queued-solve pipeline; Waves B (merge→mint promotion) and C (persona-carry) build ON it and are OUT of scope here.

## Context

The live-solve capture pipeline (ladder item 3) is already built and LIVE (contained `claude -p` solve → lesson captured at the solve into `live_pending`, weight-0, emit dry-by-construction). The recon (2026-07-14, 5-agent Workflow) found the real gap to a queued one-at-a-time-with-in-flight-PRs pipeline is three SHADOW wires; the first and foundational one — **item-8 Part-A, a durable one-at-a-time driver — is MISSING** ("nothing drives the loop persistently", anchor §3:138). This wave builds the durable **solve-queue lifecycle store**: it tracks each external-issue solve entry through its lifecycle (`queued → solving → drafted → in_flight → merged → minted`, terminal `disposed`), supports concurrency-safe **one-at-a-time dequeue**, and holds the seam fields (persona, captured-lesson ref, pr_url, merge_sha) that Waves B/C consume. It gates nothing; the operator alone opens PRs and arms anything.

## Routing Decision

Verbatim `route-decide.js` output (the substrate-meta lexicon-miss applies — `stakes`/`audit` tokens did not match the phrasing; the task is architect-shaped: a hardened lab store with a security-relevant read path, #273 provenance semantics, and a dequeue TOCTOU. Escalated by USER choice of `/verify-plan` + judgment per the `route-decide.js:11-13` load-bearing comment):

```json
{
  "task": "Build the durable solve-queue lifecycle store item-8 Part-A ...",
  "recommendation": "root",
  "confidence": 0.125,
  "score_total": 0.262,
  "scores_by_dim": {
    "stakes": { "raw": 0, "weight": 0.25, "contribution": 0 },
    "domain_novelty": { "raw": 0, "weight": 0.15, "contribution": 0 },
    "compound_strong": { "matched": ["lock", "content-addressed"], "raw": 1, "weight": 0.15, "contribution": 0.15 },
    "audit_binary": { "raw": 0, "weight": 0.2, "contribution": 0 }
  }
}
```

## HETS Spawn Plan

The `/verify-plan` board (this wave's pre-approval verification), lens-by-task-shape per the persona-selection discipline:

| Persona | Role | Why |
|---|---|---|
| 04-architect | design | event-sourced-log vs mutable-file tradeoff; the state-machine legality guard; the KISS call to NOT content-address every event (workflow-state, not a trust node) |
| 03-code-reviewer | correctness | the dequeue TOCTOU (`withLock` scope), the fold correctness, the hardened read path (`O_NOFOLLOW` + bounded + foreign-owned reject), observable refuses |

Adversarial-security (`hacker`) is deferred to the post-build VALIDATE (Rule 2a re-probe of the BUILT code) rather than pre-approval — the store gates no weight, so the pre-approval board is the 2-lens design+correctness pair.

## Files To Modify

| Path | Action | Risk | Notes |
|---|---|---|---|
| `packages/lab/solve-queue/solve-queue-fold.js` | create | medium | PURE fold + transition-legality table + per-field evidence accumulation (no I/O) — the SRP split (CR6) |
| `packages/lab/solve-queue/solve-queue-store.js` | create | medium | I/O: append-only event log + `withLockSoft` mutating ops + hardened growing-log read + boundary validation |
| `packages/lab/solve-queue/cli.js` | create | low | thin dispatcher: `enqueue`/`next`/`advance`/`list`/`get`; emits JSON; `require.main` guarded |
| `packages/lab/solve-queue/README.md` | create | low | dir doc (states, transitions, ownership, SHADOW/weight-inert + never-a-trust-input invariant) |
| `tests/unit/lab/solve-queue/solve-queue-fold.test.js` | create | medium | TDD-first: the pure fold + legality contract |
| `tests/unit/lab/solve-queue/solve-queue-store.test.js` | create | medium | TDD-first: lock/dequeue, hardened read, validation, observable refuses |
| `tests/unit/lab/solve-queue/cli.test.js` | create | low | CLI dispatch + JSON shape |

## Design (revised post-verify — the board's FLAGs are folded in)

- **Storage = an append-only event log** (JSONL under `$LOOM_LAB_STATE_DIR/solve-queue/events.jsonl`, mirroring the `live-solve-outcomes.jsonl` precedent), NOT a mutable per-entry file. Each event: `{entry_id, repo, issue_ref, from_state, to_state, ts, evidence{...}}`. Immutable + auditable; no mutable-file-rewrite TOCTOU.
- **Ordering is by LINE ORDER, authoritative** (append-order is monotonic given small atomic appends). `ts` is **audit-only, never the sort key** (clock skew / ties would corrupt the fold) — CR2/F8.
- **Current state = a fold** over an entry's events: `state` = the `to_state` of the last legal transition (by line order); **`evidence` is PER-FIELD accumulated** across the entry's events (each field takes the value of the most recent event that set it: `persona`@solving, `candidate_patch_sha`+`lesson_signature`@drafted, `pr_url`+`pr_number`@in_flight, `merge_sha`@merged) — NOT a latest-blob overwrite (else earlier evidence is lost) — F8/CR2.
- **`entry_id = sha256(canonicalJson({repo, issue_ref}))`** — one entry per (repo, issue). `repo` stored as the slug `owner/repo` (matching `repoSlug()` the Wave-B join normalizes with).
- **Wave-B/C forward-contract (F5, firsthand-probed)** — `resolveCapturedSignatureForAttest` (world-anchor-mint.js:566-568) joins the captured lesson on **`(repoSlug, issue_ref, candidate_patch_sha)`**, so the entry MUST carry `candidate_patch_sha` (set at `drafted`) — NOT a generic `captured_lesson_ref`. Evidence schema: `{persona?, candidate_patch_sha?, lesson_signature?, pr_url?, pr_number?, merge_sha?, reason?}`. `persona` is carried as a plain advisory field here (Wave C decides the non-identity-pin form; never a `BASIS_FIELD`).
- **Closed state enum + legality table** (guarded; illegal transition REJECTED + OBSERVABLE, never appended):
  `absent → queued` · `queued → {solving, disposed}` · `solving → {drafted, disposed}` · `drafted → {in_flight, disposed}` · `in_flight → {merged, disposed}` · `merged → {minted, disposed}` · `minted` (terminal) · `disposed → queued` (**re-open/retry** — resolves the "idempotent-forever, never-retryable" gap F4/CR4). Solve-failure = `solving → disposed` with `evidence.reason`. `enqueue` on an absent-or-`disposed` entry appends `→queued`; on a live/minted entry it is an idempotent no-op returning the current state.
- **Ownership of transitions** (F8): `enqueue`/`claimNext`(`→solving`)/`drafted` are the pipeline's; `drafted → in_flight` is the **OPERATOR's** (they opened the PR — Wave-A CLI `advance`, never auto); `in_flight → merged` / `merged → minted` are **Wave B's**.
- **Concurrency — a SINGLE store-wide lock** (CR1/CR4): one fixed lock path `$LOOM_LAB_STATE_DIR/solve-queue/.lock` (NOT per-entry — per-entry defeats cross-entry "oldest queued"). **ALL mutating ops** (`enqueue`, `claimNext`, `advance`) run their fresh-read-then-append inside it, via **`withLockSoft`** — NOT bare `withLock` (whose `process.exit(2)` on timeout would kill the host; this is a LIBRARY, CR7). A lock-timeout returns an observable `{ok:false, reason:'lock-timeout'}`.
- **Growing-log read bound (CR3, the sharpest FLAG)** — do NOT inherit live-pending's `MAX_RECORD_BYTES = 64*1024` (a per-NODE cap). The log grows; bound it with a generous `MAX_LOG_BYTES` (8 MiB — thousands of events at beta scale) and NAME rotation-on-exceed as the escalation (archive `events.jsonl` → `events.<n>.jsonl`, fold across segments). Keep the `O_NOFOLLOW` / non-regular / foreign-owned-reject hardening; only the byte-bound is re-sized for a log.
- **Torn-line + forward-compat tolerance (CR2)** — `get`/`list` are UNLOCKED reads, so a read racing an in-flight append can observe a partial final line under NORMAL operation → the fold SKIPS an unparseable/torn last line (never throws) and SKIPS an unknown `to_state` (forward-compat), each observable.
- **Input validation at the boundary (CR5)** — validate `repo` (slug regex `^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`) + `issue_ref` (positive int, bounded) + field `MAX` bounds (`candidate_patch_sha` 64-hex, `pr_url` bounded, etc.) at `enqueue`/`advance` BEFORE canonical-JSON/store; re-verify on read (store-is-not-a-sandbox, #215).
- **NOT a trust node → deliberately NOT per-event content-addressed** (KISS, F3-hold): the queue gates **no weight** and **must never become a weight/trust input** (a load-bearing invariant to keep explicit); Wave B's mint re-verifies `merge_sha` from gh independently (`verifyMerge merged===true`), so a tampered entry can at worst deny/mis-drive (poll the wrong PR) — and PR-opening is operator-gated. A tamper-evident hash-chain is the NAMED escalation IF the queue ever gates a trust decision.
- **File split (CR6/CR8, pre-committed)** — `solve-queue-fold.js` = the PURE fold + transition-legality table (no I/O), `solve-queue-store.js` = I/O + lock + hardened read/append + the public ops. Keeps each < 800 lines, functions < 50, SRP-clean.
- **SHADOW / weight-inert**: `@loom-layer: lab`; imports only `kernel/_lib` (canonical-json, lock, safe-resolve) + `kernel/egress/alert`.

## Phases

#### Phase 1: TDD — the PURE fold contract (Files: 1 NEW test + 1 NEW impl, Risk: medium)
1. Write `tests/unit/lab/solve-queue/solve-queue-fold.test.js` FIRST: fold by LINE ORDER (not `ts`); PER-FIELD evidence accumulation across events; legal transition accepted / illegal rejected; **torn/unparseable last line SKIPPED not thrown**; **unknown `to_state` SKIPPED** (forward-compat); `disposed → queued` re-open legal; `minted` terminal. Then `solve-queue-fold.js` to green it (pure, no I/O — fast, deterministic).
   - Probe: `node tests/unit/lab/solve-queue/solve-queue-fold.test.js` → RED first, then green.

#### Phase 2: TDD — the store (I/O + lock + hardened read) (Files: 1 NEW test + 1 NEW impl, Risk: medium)
2. Write `tests/unit/lab/solve-queue/solve-queue-store.test.js` FIRST: enqueue idempotency + re-open-from-disposed; `claimNext` returns oldest-queued + marks solving; **two concurrent `claimNext` never return the same entry** (lock non-vacuity — remove the lock → RED); `advance` legality + per-field evidence persisted; input validation rejects a bad `repo`/`issue_ref` (observable); hardened read rejects symlink / foreign-owned / non-regular; a large-but-under-`MAX_LOG_BYTES` log is ACCEPTED (the CR3 regression — the node cap would wrongly reject it); `lock-timeout` returns observable `{ok:false}` not `process.exit`; `LOOM_LAB_STATE_DIR` isolation (set before require). Then `solve-queue-store.js` to green it.
   - Probe: `LOOM_LAB_STATE_DIR=$(mktemp -d) node tests/unit/lab/solve-queue/solve-queue-store.test.js` → all green.

#### Phase 3: The CLI (Files: 1 NEW + 1 test, Risk: low)
3. `packages/lab/solve-queue/cli.js` — `enqueue`/`next`/`advance`/`list`/`get`, JSON emit, `require.main` guard. + `tests/unit/lab/solve-queue/cli.test.js`.
   - Probe: `node packages/lab/solve-queue/cli.js next` on an empty queue → clean JSON `{ok:false, reason:'queue-empty'}`, exit 1.

#### Phase 4: README + gates (Files: 1 NEW, Risk: low)
4. `packages/lab/solve-queue/README.md` (states, transitions, ownership, never-a-trust-input invariant); run the lab suite + eslint + markdownlint + the doc-path gate.

## Runtime Probes (claims this plan rests on — verified against the tree 2026-07-14)

| Claim | Probe | Result |
|---|---|---|
| item-8 Part-A is genuinely MISSING (not duplicating) | `grep -rlnE "solve.?queue\|lifecycle.?state\|enqueue\|dequeue" packages/lab \| grep -v test` | no solve-queue/lifecycle store exists |
| the store hardening template exists | read `packages/lab/causal-edge/live-pending-store.js:1-40` | verify-on-read + `O_NOFOLLOW` + observable-refuse conventions confirmed |
| the lock primitive exists | `grep module.exports packages/kernel/_lib/lock.js` | `{ acquireLock, releaseLock, withLock, withLockSoft }` |
| the append-only-JSONL-ledger precedent exists | `live-solve-outcomes.jsonl` in `live-solve-one.js:29-32` | confirmed (durable outcome ledger) |
| Wave-B consumers exist (forward-contract) | `grep mintFromMergeOutcome\|runMergeObserve packages/lab/world-anchor/*.js` | `mintFromMergeOutcome` (world-anchor-mint.js:303), `runMergeObserve` (merge-observer.js:65) |
| the Wave-B JOIN KEY is `candidate_patch_sha` (F5, field-level) | read `resolveCapturedSignatureForAttest` world-anchor-mint.js:559-589 | Check 1 filters live-pending on `(repoSlug, issue_ref, candidate_patch_sha)` → so the entry MUST carry `candidate_patch_sha`, not a generic ref |
| `MAX_RECORD_BYTES` is a per-NODE cap (CR3) | `grep MAX_RECORD_BYTES live-pending-store.js` | `= 64*1024` sizes ONE node — must NOT be inherited for a growing log; use `MAX_LOG_BYTES` + rotation |
| input-validation precedents | `grep GH_REPO_RE\|isValidIssueRef\|MAX live-pending-store.js` | `GH_REPO_RE` (:63) + a `MAX` field-bound map (:96) — mirror at the queue boundary |

## Verification Probes

| Probe | Pass criterion |
|---|---|
| 1 | both `solve-queue-fold.test.js` + `solve-queue-store.test.js` green under an isolated `LOOM_LAB_STATE_DIR` |
| 2 | two `claimNext` in parallel return DISTINCT entries (lock non-vacuity: remove the lock → RED) |
| 3 | an illegal transition (`queued → merged`) rejected + emits an alert; a `disposed → queued` re-open ACCEPTED |
| 4 | the fold SKIPS (not throws) a torn last line + an unknown `to_state` |
| 5 | a log > 64 KiB but < `MAX_LOG_BYTES` is ACCEPTED (the CR3 regression the node-cap would fail) |
| 6 | a bad `repo` / `issue_ref` at enqueue is rejected + observable; `lock-timeout` returns `{ok:false}`, never `process.exit` |
| 7 | `bash install.sh --hooks --test` green AND full lab suite green; eslint + markdownlint + doc-path gate clean |

## Out of Scope (Deferred)

- **Wave B**: the async merge-poll (read-only gh over `in_flight` entries) + the merge→mint promotion (activate the inert `attest-from-capture` join; `mintFromMergeOutcome`) + wiring `live-solve-one` to `claimNext`.
- **Wave C**: persona-carry (thread the real builder persona through capture→promotion as a NON-identity pin — never a `BASIS_FIELD`, to preserve `node_id` + the Wave-2b cross-repo parity).
- **Operator-gated / never Claude**: emitting PRs; arming (`LIVE_SOURCES` flip); the authenticated signed-edge minter (item 5).
- A tamper-evident hash-chain on the event log (only needed if the queue ever gates a trust decision — it does not).

## Drift Notes

- route-decide returned `root` on an architect-shaped store task (stakes/audit lexicon miss) — the substrate-meta catch-22; escalated by judgment + the `/verify-plan` gate. Dictionary-expansion candidate (a "lifecycle store / hardened read path / TOCTOU" cluster).
- The recon's big finding (ladder item 3 already built) is a `drift:recon-depth` win: the USER's "build option 2" resolved to "wire what exists", not a from-scratch build. Search-before-you-build paid off.

## Pre-Approval Verification

Two lenses spawned in parallel (`/verify-plan`, 2026-07-14). Both returned **NEEDS-REVISION** (no FAIL, no security blocker). All substantive FLAGs are now folded into the Design / Files / Phases / Runtime Probes above. Dispositions:

### Architect (design verification)

- **1 Findings coverage — PASS.** Honest scope boundary; defining seam fields is the forward-contract, not Wave-B absorption.
- **2 Event-sourced-vs-mutable — PASS.** Append-only + fold defensible; mirrors the outcome-ledger; compaction correctly YAGNI.
- **3 KISS no-content-address — PASS (hold).** **Fixed**: the "queue must NEVER become a weight/trust input" invariant is now stated explicitly in Design; hash-chain named as the escalation.
- **4 State machine — FLAG.** **Fixed**: added `disposed → queued` re-open (resolves idempotent-forever/no-retry); solve-failure = `solving → disposed` w/ `reason`; enqueue re-opens a disposed entry.
- **5 Wave-B forward-contract — FLAG.** **Fixed**: firsthand-probed `resolveCapturedSignatureForAttest` — join key is `candidate_patch_sha`; entry now carries `candidate_patch_sha` + `pr_number` (not a generic ref). Added to Runtime Probes.
- **6 YAGNI — PASS.** The `live-solve-one`→`claimNext` wire correctly deferred to Wave B.
- **7 Drift notes — PASS (genuine).**
- **8 Open design choices — FLAG.** **Fixed**: evidence-fold = PER-FIELD accumulation (specified); transition ownership specified (operator owns `drafted → in_flight`).
- **9 Runtime probes — PASS** (caveat: seam under-probed at field level). **Fixed**: field-level join-key probe added.
- Verdict: **NEEDS-REVISION** → resolved.

### Code-reviewer (foot-gun review)

- **1 Dequeue TOCTOU — FLAG.** **Fixed**: single fixed store-wide lock path (not per-entry); ALL mutating ops (incl. `enqueue`) run fresh-read-then-append inside it.
- **2 The fold — FLAG.** **Fixed**: LINE-ORDER authoritative (`ts` audit-only); torn/unparseable last line + unknown `to_state` SKIPPED-not-thrown (observable).
- **3 Growing-log read bound — FLAG (sharpest).** **Fixed**: `MAX_LOG_BYTES` (8 MiB) replaces the inherited 64 KiB node cap; rotation named; a "large-but-valid log accepted" regression test added (Probe 5).
- **4 Idempotent enqueue — FLAG.** **Fixed**: enqueue under the store-wide lock; `disposed → queued` explicit.
- **5 Path/regex — FLAG.** **Fixed**: `repo` slug-regex + bounded `issue_ref` + field `MAX` bounds validated at the boundary, re-verified on read (#215).
- **6 File size — FLAG.** **Fixed**: split into `solve-queue-fold.js` (pure) + `solve-queue-store.js` (I/O).
- **7 Observable refuses — FLAG.** **Fixed**: `withLockSoft` (observable `lock-timeout`, never `process.exit`); refuse paths enumerated (illegal-transition, unknown-entry, bad-input, read-verify-fail, lock-timeout).
- **8 Scope creep — FLAG.** **Fixed** by the CR6 split.
- Verdict: **NEEDS-REVISION** → resolved.

**Resolution**: every FLAG closed in the plan text; no FAIL; nothing deferred-unaddressed. The TDD contracts (Phases 1-2) now encode the torn-line, unknown-state, per-field-fold, re-open, growing-log-bound, input-validation, and lock-timeout behaviors. Ready to build on approval.

## VALIDATE result — BUILT (2026-07-14)

Built TDD-first (fold 12 + store 16 + cli 6 = 34 tests green; eslint + full lab suite 163/0 + signpost clean). 2-lens VALIDATE on the BUILT code (code-reviewer correctness + hacker adversarial-live-probe, Rule 2a). All findings FIXED and re-verified against the hacker's own probe scripts:

- **Self-probe (Rule 2a, orchestrator):** the first concurrency test was **non-vacuous-FAILING** — it passed with the lock BYPASSED (6 single claims rarely hit the tiny read→append window). Strengthened to N=8 loop-claimers over M=30 entries; now REDs on the lock-bypass mutation (clear double-claims), so it genuinely proves the lock load-bearing.
- **H1 [HIGH, both] the fold re-validated transitions but not field CONTENT** — a tampered log's `repo` / `issue_ref` / `candidate_patch_sha` (the Wave-B join key) flowed through `list`/`get`/`claimNext` verbatim, contradicting the "re-checked on read" comment. **Fixed**: the pure validators moved into `solve-queue-fold.js` (DRY); `foldEntry` now skips a bad-identity event and drops a malformed evidence field. Probe A: forged fields now surface `undefined`.
- **M2 [MED, hacker] write followed a symlinked STATE DIR** into a foreign dir while reporting `ok:true`. **Fixed**: `appendEvent` calls `validateReadDir` first. Probe D2: write refused, `write-failed`.
- **M4 [HIGH, both] write path threw uncaught `ELOOP`** on a symlinked `events.jsonl` (violating "every refuse observable"). **Fixed**: `appendEvent` try/catch → `alert('write-reject')` → `{ok:false, reason:'write-failed'}`, propagated by every op. Probe D1: no uncaught throw.
- **M3 [MED, hacker] a torn tail glued onto + swallowed the next event.** **Fixed**: leading-`\n` record framing self-isolates a torn tail. Probe E: recovery event parses + survives.
- **[HIGH, code-reviewer] stale evidence leaked across a `disposed → queued` re-open** (a prior-attempt `reason` surfaced on a later merged entry). **Fixed**: the fold resets transient evidence on a `→queued` re-open.
- **[MED, code-reviewer] `unknown-entry` refuse was silent** (plan claimed observable). **Fixed**: `alert('unknown-entry')` in `advance`/`get`.
- **Deferred with notes (LOW / not-this-store):** the 8 MiB read buffer (perf; the safe version is correct — a scale-ceiling note, optimizing it risks the grow-after-fstat safety); `_queuedAt` from the raw (not legality-filtered) scan (defense-in-depth, only diverges on a tampered log the store never writes); `lock.js` acquiring `.lock` without `O_NOFOLLOW` + its cross-uid stale-steal (a shared-`lock.js` concern, inert for this same-uid store); a symlinked PARENT dir (the accepted same-uid #273 residual). None gates anything (SHADOW / weight-inert).

Verdict: SHIP. No CRITICAL; the two HIGHs + the write-path MEDIUMs were the "cheap now, expensive once Wave B reads these fields" class and are closed.
