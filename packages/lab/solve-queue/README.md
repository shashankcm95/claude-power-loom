# `solve-queue` — the solve-queue lifecycle store (Wave A / item-8 Part-A)

A durable, append-only event log that tracks each external-issue **solve entry** through its lifecycle. It is the state backbone of the queued one-at-a-time autonomous-SDE pipeline: the producer solves issues one at a time, several emitted PRs sit in-flight awaiting merge, and Wave B mints a persona-tied lesson asynchronously as each one merges.

**SHADOW / weight-inert.** The queue gates **nothing** — it is operational bookkeeping and MUST NEVER become a weight/trust input. Wave B re-verifies `merge_sha` from GitHub independently, so a tampered entry can at worst deny or mis-drive (poll the wrong PR); PR-opening is operator-gated. A tamper-evident hash-chain is the named escalation *if* the queue ever gates a trust decision.

## Lifecycle states

`queued → solving → drafted → in_flight → merged → minted` (terminal), plus `disposed` (reachable from any non-terminal; **re-openable** to `queued` for a retry).

| From | Legal to | Who transitions |
|---|---|---|
| _absent_ | `queued` | `enqueue` (pipeline) |
| `queued` | `solving`, `disposed` | `claimNext` (pipeline) |
| `solving` | `drafted`, `disposed` | pipeline (candidate + captured lesson) |
| `drafted` | `in_flight`, `disposed` | **operator** (opened the PR) |
| `in_flight` | `merged`, `disposed` | **Wave B** (merge-poll) |
| `merged` | `minted`, `disposed` | **Wave B** (lesson promotion) |
| `disposed` | `queued` | re-open / retry |
| `minted` | — | terminal |

## Model

- **Storage**: an append-only event log at `$LOOM_LAB_STATE_DIR/solve-queue/events.jsonl`. Each event is one lifecycle transition; **line order is authoritative** (`ts` is audit-only).
- **Current state** = a fold over an entry's events; **evidence is per-field accumulated** across events (`persona`@solving, `candidate_patch_sha`+`lesson_signature`@drafted, `pr_url`+`pr_number`@in_flight, `merge_sha`@merged). `candidate_patch_sha` is the Wave-B join key (`resolveCapturedSignatureForAttest`).
- **`entry_id`** = `sha256(canonicalJson({repo, issue_ref}))` — one entry per (repo, issue); enqueue idempotent, re-opens a `disposed` entry.
- **Concurrency**: a single store-wide lock (`.lock`, `withLockSoft`) serializes every mutating op, so a one-at-a-time `claimNext` never double-claims. Reads (`get`/`list`) are lock-free and tolerate a torn trailing line.
- **Hardening**: the read path is `O_RDONLY|O_NOFOLLOW|O_NONBLOCK` + fstat-same-fd + reject non-regular / foreign-owned / `size > MAX_LOG_BYTES` (a **log** bound, not the per-node cap). Every refuse is observable via `emitEgressAlert`.

## Files

- [`solve-queue-fold.js`](solve-queue-fold.js) — the pure fold + transition-legality table (no I/O).
- [`solve-queue-store.js`](solve-queue-store.js) — the I/O layer: append log, `withLockSoft` ops, hardened read, boundary validation.
- [`cli.js`](cli.js) — thin dispatcher: `enqueue` / `next` / `advance` / `list` / `get`.

## Out of scope (later waves)

- **Wave B**: the async merge-poll + the merge→mint promotion (`mintFromMergeOutcome`) + wiring `live-solve-one` to `claimNext`.
- **Wave C**: persona-carry as a non-identity pin (never a `BASIS_FIELD`).
- Operator-only: opening PRs; arming; the authenticated signed-edge minter.
