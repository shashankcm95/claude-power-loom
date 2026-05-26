---
kb_id: architecture/crosscut/idempotency
version: 1
tags:
  - crosscut
  - data
  - concurrency
  - distributed-systems
  - foundational
  - retry-semantics
sources_consulted:
  - "Designing Data-Intensive Applications (Martin Kleppmann, 2017) ch 4 (Encoding/Evolution + RPC) + ch 5 (Replication) + ch 7 (Transactions) + ch 11 (Stream Processing)"
  - "Release It! (Michael Nygard, 2nd ed 2018) — retry semantics + circuit breaker + steady state"
  - "Clean Code (Robert C. Martin, 2008) ch 7 (Error Handling)"
  - "charlax/professional-programming antipatterns: code-antipatterns + error-handling-antipatterns"
  - "Software Architecture: The Hard Parts (Ford/Richards/Sadalage/Dehghani, 2021) ch 11 (Distributed Workflow) + ch 12 (Sagas)"
related:
  - architecture/crosscut/single-responsibility
  - architecture/crosscut/dependency-rule
  - architecture/discipline/error-handling-discipline
  - architecture/discipline/stability-patterns
  - architecture/discipline/reliability-scalability-maintainability
  - architecture/ai-systems/evaluation-under-nondeterminism
  - architecture/ai-systems/inference-cost-management
status: active+enforced
---

## Summary

**Principle**: Operation `f` is idempotent if `f(f(x)) = f(x)` — applying N times = applying once. Critical for retried operations: network calls, queues, replicated writes.
**Real-world reality**: at-least-once delivery is achievable; exactly-once isn't. Idempotency converts at-least-once into practical exactly-once.
**Test**: invoke twice with same input; assert state identical to one invocation.
**Sources**: DDIA ch 4 + 5 + 7 + 11 + Release It! + Clean Code ch 7 + Hard Parts ch 11+12.
**Substrate**: atomic-rename for tracker files; verify-plan-gate block-and-retry; kb-resolver content-addressed refs.

## Quick Reference

**Principle**: An operation is idempotent if applying it N times produces the same result as applying it once.

**HTTP method conventions** (RFC 9110):

- Idempotent: GET, HEAD, PUT, DELETE, OPTIONS
- Non-idempotent: POST (use Idempotency-Key header to absorb retries)

**Database operations**:

| Op | Idempotent? | Make idempotent via |
|----|-------------|---------------------|
| INSERT | No | UPSERT with UNIQUE constraint on natural key |
| UPDATE | Often | UPDATE with deterministic WHERE |
| DELETE | Yes | Second DELETE is no-op |
| INCREMENT | No | Track operation IDs; reject duplicates |
| COMPARE-AND-SWAP | Yes | Inherent (condition is the dedupe) |

**Six patterns for achieving idempotency**:

1. **Dedupe via Request ID** (most general) — Stripe-style Idempotency-Key
2. **Natural-Key UPSERT** — `INSERT ... ON CONFLICT DO UPDATE`
3. **Conditional Write (CAS)** — `UPDATE ... WHERE expected_old_value`
4. **Event Sourcing** — store events; derive state via deterministic replay
5. **Outbox Pattern** — atomically write business state + outbound message
6. **Saga** (Hard Parts ch 12) — idempotent steps + compensating actions

**Top pitfalls**:

- "It's idempotent because we use PUT" — the IMPLEMENTATION must keep the promise
- TTL too short for retry windows (24+ hours typical)
- Forgetting non-idempotent side effects (DB write idempotent; email send isn't — outbox)
- ABA in CAS (use monotonic version, not just value)
- Returning None instead of raising (loses retry-time disambiguation)

**Granularities**:

| Layer | Idempotency expression |
|-------|------------------------|
| HTTP API | PUT/DELETE idempotent; POST requires Idempotency-Key |
| Database | UPSERT, UPDATE-with-WHERE, COMPARE-AND-SET |
| Message queue | Consumer dedupes by message ID |
| Distributed transaction | Saga steps + compensations each idempotent |
| File system | Atomic rename; content-addressed names |
| RPC | Client-provided idempotency token |

**Tensions**:

- **Performance**: dedupe has cost; apply where duplicate cost > dedupe machinery cost
- **Correctness under replay**: events / metrics need NON-idempotent semantic; use Outbox to convert at-least-once to exactly-once-effect
- **Simplicity**: idempotency machinery is complexity; only add for retry-vulnerable operations

**Substrate examples**:

- Atomic-rename for tracker files (multiple hooks): filesystem-level idempotency
- `verify-plan-gate.js` block-and-retry: heading-presence is the idempotency key
- `error-critic.js` consolidation: dedupe via key (command + working dir + error pattern hash)
- `kb-resolver` content-addressed refs: hash-pinned resolution; retrieving twice always returns same content
- `auto-store-enrichment.js`: keyed on enriched prompt's normalized form; multiple Stop firings don't double-count

## Intent

Real systems lose messages, retry requests, and duplicate writes — that's not a bug, it's the cost of operating in an unreliable world. Networks drop packets, processes crash mid-write, message queues redeliver, clients retry on timeout. The question isn't "how do I prevent duplicates?" (you can't, fully) but "how do I tolerate them?" Idempotency is the answer.

An idempotent operation is one that *welcomes* duplicates: receiving the same operation twice produces the same effect as receiving it once. The system can therefore retry freely, deduplicate at any layer, and recover from partial failures without corrupting state.

The principle exists at a deep tension: **at-least-once delivery is achievable; exactly-once delivery is not.** Idempotency converts at-least-once into the practical equivalent of exactly-once, by absorbing duplicates into a single effect.

## The Principle

Formal definition: an operation `f` is idempotent if `f(f(x)) = f(x)` for all `x`.

In software terms:

- **Idempotent**: `setUserEmail(user_id, "alice@example.com")` — applying it 1 or 100 times leaves the system in the same state.
- **Non-idempotent**: `incrementBalance(user_id, +100)` — applying it 100 times debits 10,000.
- **Conditionally idempotent**: `transferMoney(from, to, amount, request_id)` — idempotent IFF the system tracks `request_id` and absorbs duplicates.

The third case is the architecturally interesting one: most business operations *can* be made idempotent through deliberate design (request IDs, deterministic keys, conditional writes), even when their natural form (increment, append, send) is not.

## Why idempotency matters

Per Kleppmann (DDIA ch 4): every distributed system designer hits the same problem. RPC mimics local function calls, but networks fail in ways local function calls don't:

1. Request lost in transit → client retries → server may have processed it
2. Response lost in transit → client retries → server has processed it
3. Server processes successfully → returns response → client times out → client retries

Without idempotency, retry semantics become unsafe. The client can't tell whether to retry (it might cause a duplicate) or give up (it might lose data). Every safe retry mechanism in distributed systems builds on idempotent operations.

### The cost of non-idempotency

Real-world failures from missing idempotency:

- **Stripe charges**: a customer charged twice because the first charge succeeded but the response was lost; client retried; second charge succeeded against the same card. Stripe's API explicitly accepts an `Idempotency-Key` header to absorb this class of failure.
- **Email sends**: SMTP server reports failure; sender retries; recipient gets two copies. Email is famously non-idempotent at the protocol level; senders must dedupe via Message-ID.
- **Database inserts**: an INSERT with auto-incrementing primary key creates a new row each time; retrying after a network timeout creates duplicate rows.

The losses can be financial (duplicate charges), reputational (spam from duplicate emails), or correctness-bound (corrupt aggregate counts, wrong report totals).

### The cost of *over*-applying idempotency

Conversely, forcing idempotency where it isn't natural (e.g., counters, append-only logs) produces awkward designs: every counter increment requires a unique request ID; every log append needs deduplication. The result is operational overhead and conceptual complexity.

The right discipline: identify *which* operations need idempotency (those that may be retried under failure) and design those carefully; leave naturally-non-idempotent operations alone.

## Recognizing idempotency

### HTTP method conventions (REST)

HTTP RFC 9110 specifies which methods are required to be idempotent:

| Method | Idempotent? | Notes |
|--------|-------------|-------|
| GET | Yes | Read-only; trivially idempotent |
| HEAD | Yes | Same as GET without body |
| OPTIONS | Yes | Metadata; trivially idempotent |
| PUT | **Yes** | Replace the entire resource at this URL with the request body |
| DELETE | **Yes** | Remove the resource; second DELETE is a no-op (or 404) |
| POST | **No** | Create / process; each POST is a new operation |
| PATCH | **No** (often) | Partial update; non-deterministic semantics |

The distinction PUT vs POST is the canonical idempotency design question in REST APIs:

- `PUT /users/123` with body `{name: "Alice"}` — idempotent. Two PUTs leave the user with name "Alice."
- `POST /users` with body `{name: "Alice"}` — non-idempotent. Two POSTs create two users.

A correctly-designed REST API prefers PUT for "create-or-update" semantics (with client-provided IDs) and reserves POST for "create-with-server-generated-ID" cases (which require explicit Idempotency-Key headers to retry safely).

### Database operations

| Operation | Idempotent? | Patterns to make idempotent |
|-----------|-------------|----------------------------|
| INSERT | No | UPSERT (`INSERT ... ON CONFLICT DO UPDATE`); UNIQUE constraint on natural key |
| UPDATE | Often (depending on WHERE clause) | UPDATE with deterministic WHERE — replace value, not delta |
| DELETE | Yes | Second DELETE is a no-op |
| INCREMENT | No | Track operation IDs; reject duplicates; compute via event sourcing instead |
| COMPARE-AND-SWAP | Yes | Inherently idempotent (the condition is the dedupe) |

The classical lost-update problem (per DDIA ch 7): two concurrent transactions read a value, modify it, and write it back. One write overwrites the other. Solutions:

- **Atomic operations** — `UPDATE counters SET value = value + 1` (atomic at the database level)
- **Explicit locks** — `SELECT ... FOR UPDATE` on the row
- **Compare-and-set** — `UPDATE ... WHERE id = X AND content = "old"`; if 0 rows updated, retry
- **Snapshot isolation with conflict detection** — database aborts conflicting transactions; client retries with fresh read

### Message queues

In any queue system providing at-least-once delivery (which includes virtually all production message queues — Kafka, RabbitMQ, SQS, etc.), the consumer MUST be idempotent. Patterns:

- **Idempotency keys**: every message carries a unique ID; consumer maintains a "seen IDs" set; duplicates are recognized and dropped
- **Idempotent operations**: consumer's effects are inherently idempotent (set state, not increment; UPSERT, not INSERT)
- **Outbox pattern** (DDIA ch 11): producer atomically writes both the business state change AND the outbound message in a single transaction; a separate process publishes from the outbox; this lets the producer guarantee "at-most-once-publish" semantics on top of at-least-once delivery, by making publication the system's only outbound operation

## Patterns for achieving idempotency

### Pattern 1: Dedupe via Request ID (Idempotency Key)

The most common and most general pattern. Client generates a unique ID per logical operation (UUID, deterministic hash of operation parameters, or client-provided key). Server maintains a "processed IDs" cache. On duplicate, server returns the cached response without re-applying the operation.

```python
def charge_card(card_token, amount, idempotency_key):
    cached = request_cache.get(idempotency_key)
    if cached:
        return cached  # ← duplicate; return same response
    result = stripe.charge(card_token, amount)
    request_cache.set(idempotency_key, result, ttl=24*hours)
    return result
```

Trade-offs:

- ✓ General — works for any operation
- ✓ Doesn't require operation-specific logic
- ✗ Requires durable storage for the request cache
- ✗ TTL choice is non-obvious (long enough to absorb retries; short enough to bound storage)
- ✗ Cache invalidation between region failovers is tricky

This is Stripe's API design and AWS's Idempotency-Token mechanism in many services.

### Pattern 2: Natural-Key UPSERT

When the operation has a natural unique identifier in the data itself, use UPSERT (insert-or-update on conflict):

```sql
INSERT INTO users (email, name, created_at)
VALUES ('alice@example.com', 'Alice', NOW())
ON CONFLICT (email) DO UPDATE
  SET name = EXCLUDED.name, updated_at = NOW();
```

The UNIQUE constraint on `email` provides the dedupe; the operation is idempotent because the second invocation with the same email updates rather than inserting.

Trade-offs:

- ✓ Database-level enforcement; no application-level state required
- ✓ Performant (single statement)
- ✗ Requires a natural unique key — not always available
- ✗ "Last write wins" semantics on conflict — may not be what you want

### Pattern 3: Conditional Write (Compare-and-Set)

Only apply the change if the system is in the expected state:

```sql
UPDATE accounts
SET balance = 1100
WHERE id = 42 AND balance = 1000;
```

If `balance` has changed (because another transaction already applied this update), the WHERE clause fails to match, no rows are updated, and the client knows the operation is already done.

This pattern is inherently idempotent: applying it twice with the same expected-old-value produces the same effect (one update on first invocation; zero updates on second).

Trade-offs:

- ✓ No client-side ID tracking required
- ✓ Naturally handles concurrent retries
- ✗ Requires reading the current state before computing the new one (not possible for blind writes)
- ✗ "ABA problem" — value can change to A, then B, then back to A; CAS doesn't detect this. Mitigate with version numbers / sequence IDs.

### Pattern 4: Event Sourcing (Append-Only with Deterministic Effects)

Per DDIA ch 11: instead of storing current state, store the sequence of events that produced it. Replaying the events deterministically produces the state.

If event consumption is idempotent (consumer recognizes and skips duplicates), the system gracefully tolerates duplicate-delivery from the queue.

Trade-offs:

- ✓ Replay-from-log enables full recovery and auditability
- ✓ Naturally fits at-least-once delivery
- ✗ Higher conceptual complexity (state derived, not stored directly)
- ✗ Schema evolution of events is its own concern (DDIA ch 4)

### Pattern 5: Outbox Pattern (DDIA ch 11)

Producer atomically writes both business state AND an outbound message to the same database in one transaction. A separate publisher reads the outbox and emits messages; on failure, it retries (idempotency comes from the outbox row's status field).

```text
   ┌─────────────────────┐
   │   Application       │
   │                     │
   │ BEGIN;              │
   │  UPDATE order       │
   │   SET status='paid';│  ← business state
   │  INSERT INTO outbox │
   │   (msg, status)     │  ← outbound message
   │ COMMIT;             │
   └─────────────────────┘
                │
                ▼
   ┌─────────────────────┐
   │  Outbox Publisher   │
   │  (separate process) │
   │  reads pending msgs │
   │  publishes to queue │
   │  marks status=sent  │
   └─────────────────────┘
                │
                ▼
   ┌─────────────────────┐
   │   Message Queue     │
   └─────────────────────┘
```

The trick: the business state and outbound message commit atomically. This eliminates the failure mode where state changes but the message is lost (or vice versa). The publisher's at-least-once retry behavior is safe because the outbox row's status field tracks whether the message has been published.

This is the pattern Kafka producers + many CDC systems implement under the hood.

### Pattern 6: Saga Pattern (Hard Parts ch 12)

For long-running, multi-step distributed transactions where atomicity isn't possible:

- Each step is idempotent (so retries are safe)
- Each step has a *compensating action* (so cancellation is possible)
- A coordinator (orchestrated saga) or peer messages (choreographed saga) drives the sequence

Hard Parts catalogs 7 saga types: Epic, Phone Tag, Fairy Tale, Fantasy Fiction, Horror Story, Parallel, Anthology. The "best-of-class" saga (Anthology — async, eventual, choreographed, very loose coupling) requires every step to be idempotent and every compensating action to be idempotent.

## Idempotency at different granularities

The principle recurses across the system stack:

| Layer | Idempotency expression | Source |
|-------|------------------------|--------|
| HTTP API | PUT/DELETE are idempotent; POST requires Idempotency-Key | RFC 9110 |
| Database | UPSERT, UPDATE-with-WHERE, COMPARE-AND-SET | DDIA ch 7 |
| Message queue | Consumer dedupes by message ID | DDIA ch 11 |
| Distributed transaction | Saga steps + compensations are each idempotent | Hard Parts ch 12 |
| File system | Atomic rename (mv); content-addressed names | Unix tradition |
| Build/deploy | Idempotent infrastructure (Terraform, Kubernetes apply) | DevOps practice |
| RPC call | Client-provided idempotency token | gRPC, AWS APIs |
| Cache write | Compare-and-swap; deterministic keys | Memcached / Redis SETNX |

A robust system applies idempotency at *multiple* layers — defense in depth. A retry-storm at the HTTP layer is absorbed by the API's idempotency keys; messages duplicated by the queue are absorbed by the consumer; a write-amplification at the database is absorbed by UPSERT; and so on.

## Common pitfalls

### Pitfall 1: "It's idempotent because we use PUT"

PUT-the-HTTP-method is idempotent; the *underlying business logic* is what we actually need idempotent. A PUT handler that internally increments a counter or sends an email each invocation is non-idempotent regardless of HTTP semantics.

The HTTP method is the API's *promise*; the implementation must keep that promise.

### Pitfall 2: TTL too short for retries

Idempotency caches with a TTL shorter than the maximum retry window allow the cache to expire mid-retry-burst, causing the operation to re-execute. TTL should be at least:

- Maximum end-to-end retry timeout (often hours, not minutes)
- Plus any clock-skew between client and server
- Plus any failover propagation delay

Stripe defaults to 24 hours for this reason; AWS uses similar windows.

### Pitfall 3: Forgetting non-idempotent side effects

The database write may be idempotent, but the email-send embedded in the same handler isn't. Common pattern: the database UPSERT succeeds; then the handler crashes; then a retry triggers another UPSERT (no-op) AND another email-send (duplicate).

**Fix**: separate side effects into outbox-style atomic-with-state-change patterns; or make every side effect itself idempotent (idempotent emails via deterministic Message-IDs; idempotent push notifications via dedupe).

### Pitfall 4: Idempotency key collisions

Using a short, weakly-unique key (timestamps, sequential integers) across a large operation space causes collisions: two distinct operations get the same key; the second is treated as a duplicate of the first; data is lost.

**Fix**: use UUIDs, full SHA hashes, or composite keys that include enough entropy.

### Pitfall 5: ABA problem in compare-and-set

CAS detects "value changed" but not "value oscillated." If A → B → A occurs between the read and the CAS, the CAS succeeds even though the system is no longer in a consistent state.

**Fix**: include monotonic version numbers / sequence IDs in the CAS condition; check the version, not just the value.

### Pitfall 6: Returning None vs raising on retry

Per charlax (code-antipatterns / "Returning nothing instead of raising NotFound"): a function that returns `None` to mean "not found" or "already done" makes retry logic ambiguous — was the operation a no-op because it was already done, or because there's nothing to do?

**Fix** (per charlax + Clean Code): raise structured exceptions for "not applicable" conditions; reserve `None` for cases where absent-result is the legitimate happy path.

## Substrate-Specific Examples

### Tracker file atomic rename (multiple hooks)

The substrate's `fact-force-gate.js` and `auto-store-enrichment.js` (among others) use atomic-rename for tracker file mutations:

```js
const tmpPath = TRACKER_PATH + '.tmp.' + process.pid;
fs.writeFileSync(tmpPath, JSON.stringify(state));
fs.renameSync(tmpPath, TRACKER_PATH);  // ← atomic on POSIX
```

The pattern is idempotent at the filesystem level: if two concurrent invocations race, one rename succeeds; the other rename is a no-op (or replaces with the same content if state is deterministic). Crashes mid-write don't corrupt the file because rename is atomic; we never see a partially-written tracker.

This is Pattern 3 (Conditional Write) applied to filesystem semantics, where the rename's atomicity is the conditional.

### `verify-plan-gate.js` block-and-retry pattern (H.7.23.1)

The PreToolUse:ExitPlanMode hook implements block-and-retry: when the plan is HETS-routed and missing the `## Pre-Approval Verification` section, the hook returns `decision: block` with a forcing-instruction-shaped reason. Claude reads the reason, runs `/verify-plan` (which idempotently appends the section if absent — uses a heading-presence check), then retries ExitPlanMode. The hook now approves.

The whole flow is idempotent on three levels:

1. **The check itself** is idempotent: presence of the heading is a deterministic test
2. **The append** is idempotent: `/verify-plan` first checks if the section exists; if so, no-op
3. **The retry** is idempotent: ExitPlanMode invocation can fire any number of times; each time the gate either approves or blocks based on current plan state

This is the retry-on-block discipline encoded as substrate primitive — same shape as fact-force-gate's "must Read before Edit" pattern.

### `auto-store-enrichment.js` consume-and-bump

The Stop hook's per-signal counter bump is idempotent in a specific way: the input is the LLM's response text, parsed for `[ENRICHED-PROMPT-START]...[ENRICHED-PROMPT-END]` markers. The counter is keyed by the enriched prompt's normalized form; multiple Stop firings within a session don't double-count because the bump is keyed on the marker content, not on the firing count.

If the substrate runs the same response through the auto-store hook N times (which can happen with re-tries or replays), the same pattern is bumped N times only if it appears N times in the input. The keying-on-content makes the operation effectively idempotent at the per-pattern level.

### `kb-resolver` content-addressed refs

KB references take the form `kb:hets/spawn-conventions@10429c4c` where the suffix is a short hash of the doc content. Resolution is idempotent: the same ref always points to the same snapshot; the hash provides verification that the content hasn't changed. Snapshots-per-run-state freezes the manifest at run start, so all child agents during a run see the same KB state.

This is content-addressing (Pattern 5 sibling) applied to documentation: the URL itself encodes the desired content, so retrieving twice always returns the same thing — or fails loudly with a hash mismatch if drift has occurred.

### `error-critic.js` failure consolidation

Per H.7.7: when a Bash command fails twice with the same key (command + working dir + error pattern hash), the hook emits `[FAILURE-REPEATED]` forcing instruction. The session-scoped failure log is idempotent at the per-key level — same failure registered N times still produces one forcing instruction (the threshold is "≥2," so additional duplicates beyond 2 don't multiply the warning).

Substrate is implementing dedupe-via-key (Pattern 1) where the key is "what's failing repeatedly" and the response is rate-limited to once per session.

### Claude tool retries (substrate dogfood)

Claude itself sometimes retries tool invocations (Read/Edit/Write) after a failure. The substrate's hooks must absorb these retries gracefully:

- Read retries: trivially idempotent (read-only)
- Edit retries: fact-force-gate ensures the file was Read first (state-dependent block); the validator chain is deterministic (same input → same decision)
- Write retries: same analysis; the file path becomes the natural key

The substrate's hook architecture is built on the assumption that any tool invocation may be re-attempted, and the validators must give the same answer each time. This is idempotent validation as a substrate primitive.

## Tension with Other Principles

### Idempotency vs Performance

Idempotency keys, dedupe caches, and conditional writes all add overhead — extra storage for the cache, extra round-trip for the read-before-CAS, extra serialization for the version vector.

**Heuristic**: apply idempotency where the cost of duplicates exceeds the cost of the dedupe machinery. For high-value operations (charges, sends, state mutations), the overhead is trivial. For trivial reads, full idempotency machinery is overkill.

### Idempotency vs Correctness Under Replay

Some operations need explicit non-idempotency for correctness: appending to a log; recording a metric; emitting an event. Treating these as idempotent loses the operational semantic.

**Resolution**: separate "operations that should retry safely" from "events that should record exactly once." The first need idempotency; the second need an outbox-pattern to convert at-least-once delivery into exactly-once effect.

### Idempotency vs Simplicity

The most idempotent design is often more complex than the most natural one. UPSERT requires a unique constraint; idempotency tokens require a request cache; outbox patterns require a separate publisher process. The simplest "just do the thing" approach is non-idempotent.

**Heuristic**: don't add idempotency machinery preemptively. Add it when the failure mode it prevents has been measured (or is highly predictable for the operation type). HTTP POST handlers that may be retried by clients DO need idempotency keys; HTTP GET handlers don't.

### Idempotency vs DDIA's "Define Errors Out of Existence"

Per Ousterhout (PoSD ch 10): the best error handling is no error at all. Sometimes the path to that is making operations idempotent so retries become safe — eliminating the "did this succeed?" anxiety.

The two principles are complementary: design the operation so retries are safe (idempotency); then the error-recovery code becomes "just retry" rather than complex distinguish-error-types logic.

## When to use this principle

- **Always at the API boundary**: any externally-callable interface should specify which operations are idempotent and how
- **Always for retried operations**: if your client library, message queue, or background job processor retries on failure, the operation MUST be idempotent
- **Always for state-mutating distributed calls**: anything that crosses a process or machine boundary AND modifies state needs idempotency design
- **At the database layer**: prefer UPSERT over INSERT-then-handle-conflict; prefer compare-and-set over read-modify-write where possible

## When NOT to use this principle (or apply with caveat)

- **Read-only operations**: trivially idempotent; no special design needed
- **Truly single-attempt operations**: rare in distributed systems, but possible (e.g., manual administrator commands with confirmation)
- **Operations within a single transaction's atomic boundary**: the transaction itself provides idempotency at the right granularity; don't add a second layer
- **Trivial scripts where retries don't happen**: don't engineer for retry semantics that won't occur

## Failure modes

- **Stale idempotency cache**: cache evicts before retry window ends; operation re-executes. Solution: TTL ≥ max retry window.
- **Idempotency-key collisions**: two distinct operations get same key. Solution: high-entropy keys (UUIDs).
- **Over-application**: every operation gets idempotency machinery whether or not it's retried. Solution: scope idempotency to operations that may actually be retried.
- **Side effects outside the idempotent scope**: DB write is idempotent but email send isn't; retries cause duplicate emails. Solution: outbox pattern; or make every side effect itself idempotent.
- **ABA in CAS**: value oscillates; CAS doesn't detect. Solution: include monotonic version in the CAS condition.
- **"Hidden duplicates"**: the request-response cycle reports failure but the operation succeeded; client retries; second invocation succeeds; system now has duplicate effect. Solution: idempotency keys make the second invocation a no-op.

## Tests / verification

- **Repetition test**: invoke the operation twice with the same input; assert system state is identical to one invocation
- **Concurrency test**: invoke the operation N times in parallel; assert exactly one effect (or N no-ops)
- **Recovery test**: kill the process mid-operation; restart; retry; assert no duplicate effect
- **Replay test**: replay a log of operations N times; assert the final state is identical to the first replay
- **Property test**: encode "applying f twice = applying f once" as a property; run with random inputs (Hypothesis, QuickCheck, etc.)

## Related Patterns

- [architecture/crosscut/single-responsibility](single-responsibility.md) — idempotent operations are typically simpler-responsibility (one effect, not many); SRP makes idempotency easier
- [architecture/crosscut/dependency-rule](dependency-rule.md) — idempotency design lives in business logic; mechanism (UPSERT, outbox) lives in infrastructure; the boundary is enforced by the Dependency Rule
- [architecture/discipline/error-handling-discipline](../discipline/error-handling-discipline.md) — idempotent operations make graceful degradation easier; error handling can "just retry" instead of distinguishing error types
- [architecture/discipline/stability-patterns](../discipline/stability-patterns.md) — Release It!'s circuit breakers, bulkheads, and retries depend on idempotent operations to be safe

## Sources

Authored by multi-source synthesis of:

1. **Designing Data-Intensive Applications** (Martin Kleppmann, 2017), the canonical modern source. Key chapters:
   - Ch 4 (Encoding/Evolution + RPC) — RPC retry semantics; the "did the response get lost or did the request get lost?" problem
   - Ch 5 (Replication) — conflict resolution; happens-before; merge values; version vectors; last-write-wins trade-offs
   - Ch 7 (Transactions) — the lost update problem; atomic operations; explicit locking; compare-and-set; ACID semantics
   - Ch 11 (Stream Processing) — Outbox pattern; at-least-once delivery + idempotent consumers
2. **Release It!** (Michael Nygard, 2nd ed 2018) — operational patterns. Retry semantics; circuit breakers depending on idempotency; steady state.
3. **Clean Code** (Robert C. Martin, 2008) ch 7 — error handling philosophy. "Throw exceptions rather than return null."
4. **charlax/professional-programming antipatterns** — the "Returning nothing instead of raising NotFound" antipattern as it relates to retry-time ambiguity.
5. **Software Architecture: The Hard Parts** (Ford/Richards/Sadalage/Dehghani, 2021) ch 11 + 12 — distributed workflow; saga types; compensating actions; the granularity of idempotency in distributed transactions.

Substrate examples cite drift-notes from H.7.7 (`error-critic.js` failure consolidation), H.7.10 (`_lib/lock.js` RMW-race fix providing transactional retry safety), H.7.23.1 (`verify-plan-gate.js` block-and-retry), and the broader hook architecture's idempotent-validator design.

## Phase

Authored: kb authoring batch 3 (post-H.7.27, soak-track work). First-wave priority 4 of the authoring queue. Multi-source synthesis from 5 sources spanning data systems (DDIA), operational stability (Release It!), error handling philosophy (Clean Code), antipatterns (charlax), and distributed transactions (Hard Parts). Substrate examples emphasize the substrate's own idempotency-by-design at fact-force-gate, verify-plan-gate, kb-resolver, and tracker-file atomic-rename.
