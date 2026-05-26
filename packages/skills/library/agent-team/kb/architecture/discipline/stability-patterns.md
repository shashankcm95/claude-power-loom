---
kb_id: architecture/discipline/stability-patterns
version: 1
tags:
  - discipline
  - architecture
  - foundational
  - reliability
  - stability
  - operational
sources_consulted:
  - "Release It! (Michael Nygard, 2nd ed 2018) — canonical source; entire book"
  - "Site Reliability Engineering (Beyer/Jones/Petoff/Murphy, Google, 2016) — operational reliability"
  - "Software Architecture: The Hard Parts (Ford/Richards/Sadalage/Dehghani, 2021) ch 12 (Sagas) — compensation patterns"
  - "Designing Data-Intensive Applications (Martin Kleppmann, 2017) ch 5 + 8 + 11 — distributed systems failures"
  - "Pragmatic Programmer (Hunt/Thomas, 20th anniv 2019) — defensive design instincts"
related:
  - architecture/crosscut/idempotency
  - architecture/discipline/error-handling-discipline
  - architecture/discipline/reliability-scalability-maintainability
  - architecture/ai-systems/rag-anchoring
status: active+enforced
---

## Summary

**Principle (Nygard)**: Production systems fail in patterns. Stability patterns are named, reusable defenses: Circuit Breaker, Bulkhead, Timeouts, Fail Fast, Steady State, Handshaking, Stranglers.
**Anti-patterns** (each pattern's complement): Integration Points, Cascading Failures, Users, Blocked Threads, Self-Denial Attacks, Scaling Effects, Capacity.
**Test**: every integration point has timeout + circuit breaker; every accumulating resource has purging; chaos-test reveals failure modes.
**Sources**: Release It! (canonical) + SRE book + Hard Parts ch 12 + DDIA ch 5+8+11 + Pragmatic Programmer.
**Substrate**: forcing instructions ARE stability patterns; fact-force-gate as bulkhead; Pre-Approval Verification as circuit breaker.

## Quick Reference

**Principle (Nygard, Release It!)**: Production systems fail in predictable ways. Patterns defend; anti-patterns describe the failure modes.

**The pattern catalog**:

| Pattern | What it defends |
|---------|-----------------|
| **Circuit Breaker** | Wraps call to unreliable downstream; trips when failure rate exceeds threshold; subsequent calls fail fast |
| **Bulkhead** | Isolates resources (thread pools, processes, quotas); failure in one component doesn't propagate |
| **Timeouts** | Every remote call has bounded wait; default of "wait forever" is a vector for cascading failures |
| **Fail Fast** | Determine failure early; reject malformed inputs immediately; preserve resources for valid work |
| **Steady State** | Every accumulating resource (logs, cache, connections) has a purging mechanism |
| **Handshaking** | Server signals capacity (HTTP 429); client applies backpressure |
| **Test Harness** | Production-like environments; expose production failure modes during dev |
| **Stranglers** | Incremental migration; route traffic gradually; rollback per-feature |

**The complementary anti-patterns**:

- **Integration Points** — every external call is a potential failure source
- **Cascading Failures** — single component outage propagates to take down the whole
- **Users** — refresh-during-slowness; submit duplicates; pile up retries during outage
- **Blocked Threads** — thread pool exhaustion during downstream slowness
- **Self-Denial Attacks** — system attacks itself (cache miss thunder; deploy too fast; monitor too aggressively)
- **Scaling Effects** — patterns that work at small scale fail at large scale
- **Capacity** — running near limits leaves no headroom for the unexpected

**Stability granularity**:

- Process: timeouts, circuit breakers, bulkheads on RPC
- Service: rate limiting, request queuing, graceful degradation
- System: capacity planning, autoscaling, monitoring + alerting
- Operational: deploy practices, rollback discipline, incident response

**Tensions**:

- **Stability vs Velocity**: full pattern suite slows iteration; scope to operational maturity
- **Stability vs Simplicity**: each pattern adds complexity; only add where failure cost is real
- **Stability vs Correctness**: circuit breakers cause "soft failures"; tier the response (critical vs degradable)
- **Stability vs Idempotency**: stability patterns rely on idempotent retries (see [idempotency](../crosscut/idempotency.md))

**Substrate examples**:

- Forcing instructions IS stability: deterministic detect → trip → emit signal → outer layer (Claude) recovers; like circuit breaker
- `fact-force-gate.js` as bulkhead: isolates "must Read before Edit" violations; fails fast on un-Read file
- Pre-Approval Verification as circuit breaker: HETS-routed plans trigger architect+reviewer spawn before ExitPlanMode
- Atomic-rename for tracker files: steady-state design; mid-write crashes don't corrupt
- `_lib/lock.js` self-PID reclamation: fault tolerance; recovers from crashed lock holder
- `error-critic.js` consolidation: circuit-breaker shape; rate-limited to once per session per key
- Soak period as capacity buffer: don't ship major version until headroom validated empirically
- H.7.27 markdown migration as strangler: verify markdownlint catches before retiring substrate hook; gradual cutover

## Intent

Software in development is well-behaved: tests pass, requests complete, errors are handled. Software in production is hostile: networks partition, services slow down, queues back up, retries amplify load, deploys roll out unevenly.

The intent of stability patterns is to prepare for production reality, not the development simulation. They're operational defenses — patterns to prevent the kinds of failures that happen at 3am on a Saturday when no one is watching.

Per Nygard:

> "A system that is stable can be confidently deployed and operated under highly demanding conditions. The patterns in this section help engineers and architects build software that is operations-friendly."

The patterns aren't optimization tricks. They're load-bearing operational primitives — without them, complex distributed systems fail in unrecoverable ways.

## The catalog of stability patterns

Per Nygard's *Release It!*, the canonical pattern set:

### Circuit Breaker

Wraps a call to a remote system; tracks failure rate; when failure rate exceeds threshold, "trips" — subsequent calls fail immediately without attempting the remote call. Periodically retries (half-open state) to detect when the remote system has recovered.

```text
Closed state (normal):       calls go through; failures counted
Open state (tripped):        calls fail immediately; no remote attempt
Half-open state (recovery):  occasional probe call; if success, close; if fail, stay open
```

**When to use**: any call to an unreliable downstream (external API, database, microservice). Without circuit breaker, a slow downstream causes upstream threads to pile up waiting; eventually upstream exhausts its thread pool and goes down too.

**Substrate analog**: substrate's `error-critic.js` (H.7.7) is a circuit-breaker shape — tracks repeated failures with same key; emits `[FAILURE-REPEATED]` after threshold; substrate-Claude relationship "trips" toward escalation.

### Bulkhead

Per the nautical metaphor: a ship has internal walls (bulkheads) so a hull breach floods only one section, not the whole ship. Software bulkhead: isolate resources so a failure in one component doesn't propagate.

Common implementations:

- **Thread pool partitioning**: separate thread pools for different downstream services; one slow service can't exhaust all threads
- **Process isolation**: separate processes for different concerns; one crash doesn't take down the whole
- **Resource quotas**: per-service CPU/memory limits; runaway service can't starve others

**Substrate analog**: each substrate hook runs in its own process; one hook crashing doesn't crash other hooks or Claude itself. The fail-open discipline is a bulkhead: hook failure is isolated to that hook's domain.

### Timeouts

Every remote call must have a timeout. No exceptions. The default of "wait forever" is a vector for cascading failures.

**Common mistakes**:

- No timeout configured (default is often infinite)
- Timeout too long (5 minutes is "infinite" for an interactive request)
- Timeout per-attempt but not per-overall-operation (with retries, total time can exceed user patience)
- Layered timeouts not aligned (inner timeout > outer timeout means inner never fires)

**Substrate analog**: substrate's hook execution has timeout limits per Claude Code's hook protocol (hooks failing to return within limit are killed). Substrate hooks themselves use short bounded operations (file reads, JSON parsing) that complete quickly; long-running operations (Bash commands, agent spawns) have their own timeout discipline.

### Fail Fast

When you can determine an operation will fail, fail immediately rather than waiting for the failure mode to manifest. Examples:

- Validate inputs at the system boundary; reject malformed requests immediately
- Check for required resources at startup; fail to start if missing rather than failing per-request
- Pre-flight checks before expensive operations

**Why it matters**: failing fast preserves resources for valid work. Failing slow consumes capacity that could serve other requests; cascading load is the result.

**Substrate analog**: `fact-force-gate.js` fails fast — if the file hasn't been Read, Edit/Write is rejected immediately rather than allowing the edit to potentially corrupt state. The gate's bounded latency keeps it cheap.

### Steady State

Design systems to run forever in steady state — no resources accumulate without bound. Common violations:

- Logs grow until disk fills
- Cache grows until memory exhausts
- Connections leak until pool exhausts
- Database tables grow until queries become unmanageable

**Discipline**: every accumulating resource must have a complementary purging mechanism. Logs rotate. Caches evict. Connections recycle. Old database rows get archived.

**Substrate analog**: H.7.10 + H.7.24 cleanup mechanisms — `session-reset.js` cleans up stale tracker files; `error-critic.js` session-scoped storage prevents leak across sessions; chaos-test runs are versioned by `RUN_ID` and old runs eventually purged. The substrate is steady-state-aware.

### Handshaking

Before sending a request that might overload a server, the server signals its capacity (or refuses). Common implementations:

- HTTP 429 (Too Many Requests) responses with Retry-After headers
- Backpressure in message queues (consumer slow → producer slows)
- Token-bucket rate limiting

**Counter-example**: synchronous services without handshaking get bombed during traffic spikes; the spike causes timeouts; timeouts cause retries; retries cause more load; system collapses.

**Substrate analog**: relatively rare — substrate is single-process. The closest is the rate-limiting baked into Claude Code's hook timeout (hooks that take too long are killed; this is implicit handshaking).

### Test Harness

Per Nygard: build production-like environments for testing. The development environment should expose the same failure modes the production environment does — slow networks, flaky services, concurrent updates, partial failures.

**Counter-example**: development-on-localhost-with-fast-network tests behavior that's nothing like production. The first time the team sees production-like failures is in production.

**Substrate analog**: `chaos-test` skill (per H.x.x) — runs hierarchical multi-persona test against substrate; surfaces failure modes that single-persona spawns wouldn't show. Per the chaos-test skill instructions: "find what's broken" rather than "verify what works."

### Stranglers (Strangler Fig Pattern)

For migration: incrementally replace an old system. Build the new system alongside; route some traffic to new while keeping rest on old; gradually shift traffic; eventually remove old system.

**Why it matters**: big-bang migrations fail. Incremental migrations let you rollback per-feature, observe new system behavior, and discover unknowns before commitment.

**Substrate analog**: H.7.27's `[MARKDOWN-EMPHASIS-DRIFT]` migration to markdownlint pipeline was strangler-shaped — verified markdownlint catches the same patterns BEFORE retiring the substrate hook; gradual cutover; substrate maintained both layers in parallel briefly; only removed when confidence was complete.

## The complementary anti-patterns

Each stability pattern has a corresponding failure mode it's designed to prevent. Per Nygard:

### Integration Points

Every place your system calls another is a potential failure source. The anti-pattern is treating integration points as if they were local function calls.

**Defense**: timeouts, circuit breakers, bulkheads at every integration point.

### Cascading Failures

A failure in one component propagates to its callers, which fail, propagating to their callers — a single component's outage takes down the whole system.

**Defense**: bulkheads (isolate); circuit breakers (stop propagation); fail-fast (don't tie up resources waiting).

### Users

Users do unpredictable things — refresh repeatedly during slowness, submit duplicate requests, pile up in retries during outage. User behavior amplifies load exactly when system is degraded.

**Defense**: idempotency on user-initiated operations; rate limiting; queue depth monitoring; graceful degradation.

### Blocked Threads

Threads waiting on remote calls or database queries that never complete. Thread pool exhaustion → request queueing → timeout cascade.

**Defense**: timeouts always; circuit breakers; thread-pool monitoring; bulkhead the thread pools.

### Self-Denial Attacks

The system attacks itself: aggressive caching that thunders the database when cache misses; monitoring that DDoSes the monitored service; deployment that rolls out too fast and overwhelms downstream.

**Defense**: aware-of-load designs (jittered cache TTLs, sampled monitoring, rate-limited deploys); fail-fast inside the system to prevent self-amplification.

### Scaling Effects

Patterns that work at small scale fail at large scale. Synchronous calls, broadcast messages, fan-out queries — all scale poorly. The system that handles 100 requests/second well may collapse at 1000.

**Defense**: design for asynchronous interaction; use bulkheads to limit fan-out; capacity planning before scaling.

### Capacity

Running near capacity gives no headroom for the unexpected — load spikes, garbage collection pauses, network blips. The system that's "barely enough" is one anomaly away from outage.

**Defense**: explicit capacity planning; SLO-driven scaling; autoscaling with conservative thresholds.

## Stability patterns at architectural granularity

Per Nygard + Hard Parts: stability is multi-layer. Patterns apply at:

- **Process level**: timeouts, circuit breakers, bulkheads on RPC calls
- **Service level**: rate limiting, request queuing, graceful degradation
- **System level**: capacity planning, autoscaling, monitoring + alerting
- **Operational level**: deploy practices, rollback discipline, incident response

The stability patterns aren't a one-time design choice — they're an ongoing operational discipline. New integrations are added with their own circuit breakers; new features get rate limits; new metrics get alerting.

## Substrate-Specific Examples

### Forcing instructions as stability primitives

The substrate's forcing-instruction architecture is the load-bearing application of stability patterns to LLM-substrate domain:

- **Detection** (deterministic): substrate hooks detect drift / vagueness / schema violation deterministically — like a circuit breaker watching for failure
- **Trip** (forcing instruction emission): when detection fires, substrate doesn't try to recover; emits structured signal — like circuit breaker tripping
- **Recovery** (Claude reads + acts): outer layer (Claude) decides recovery action — like the circuit breaker's half-open state
- **Steady state**: forcing instructions emit per session; idempotent markers; no accumulation across sessions

Each forcing instruction is a stability pattern application. `[PROMPT-ENRICHMENT-GATE]` is fail-fast for vague prompts. `[FAILURE-REPEATED]` is circuit-breaker-shape for repeated bash failures. `[PRE-APPROVAL-VERIFICATION-NEEDED]` is bulkhead for plan exits without verification.

### Fact-force-gate as bulkhead

`fact-force-gate.js` is a bulkhead for "must Read before Edit" violations: the gate isolates the failure mode (hallucinated edits) by blocking Edit/Write operations on un-Read files. The bulkhead is the substrate's strongest defense against the Claude failure mode of "edit a file based on guessed contents."

The gate fails fast (immediate block on un-Read file); doesn't wait for the Edit to potentially corrupt state. This is fail-fast applied to LLM tool use.

### Pre-Approval Verification as circuit breaker

The H.7.22+ Pre-Approval Verification process is a circuit-breaker-shape for architectural decisions:

- **Closed state (normal)**: simple plan changes proceed without verification
- **Threshold detection**: HETS-routed plans are detected (architecturally significant)
- **Open state (tripped)**: Pre-Approval Verification REQUIRED — parallel architect + code-reviewer spawn before ExitPlanMode
- **Half-open**: verification spawn determines whether to approve or reject

The "circuit" is the gate between plan-write and plan-execution. When the threshold (HETS-routed) is met, the circuit "trips" toward verification. This isolates the failure mode (deploying a flawed architectural plan) by requiring verification first.

### Atomic-rename as steady-state primitive

Tracker files in the substrate use atomic rename for mutations. This is steady-state design: the file always contains a consistent state; mid-write crashes don't leave partial state; the system recovers automatically on restart by reading the (consistent) file.

Without atomic-rename, partial writes would accumulate as inconsistent state — a steady-state violation that would manifest as unpredictable behavior over time.

### `_lib/lock.js` self-PID reclamation as fault tolerance

H.3.6's self-PID orphan reclamation in `_lib/lock.js` handles the failure mode where a process crashes while holding the lock. Instead of the lock staying held forever (blocking subsequent operations), the reclamation logic detects "the holder is no longer alive" and releases. This is fault-tolerance: the system recovers from process-level failures without manual intervention.

### `error-critic.js` consolidation at outer Bash layer

`error-critic.js` (H.7.7) implements failure consolidation: when the same Bash command fails twice with the same error pattern, the substrate emits `[FAILURE-REPEATED]`. This is a circuit-breaker shape — track failure rate; trip threshold; emit forcing instruction.

The consolidation is rate-limited (one forcing instruction per session per key) to prevent forcing-instruction spam — a form of steady-state design at the substrate level.

### Soak period as capacity buffer

The H.7.27 soak commitment ("5+ phases with 0 new drift-notes before v2.0.0") is a capacity-buffer discipline: don't ship a major version until the substrate has demonstrated stability headroom. This gives capacity for the unexpected — drift, coupling problems, abstraction leaks that don't show in single-phase testing.

The soak window is reliability machinery applied at the release-cadence level: pause feature work to validate stability before committing to a major version.

### Auto-release-on-tag retry semantics

Per H.7.23: the auto-release-on-tag CI workflow uses `git for-each-ref` (idempotent retrieval of tag annotations) rather than `git tag -l --format=...` (which returns empty in CI runners). The fix per drift-note 51 was a stability fix — the original implementation had a hidden failure mode that triggered in production-like (CI) environments but not in development.

This is a small but exemplary stability fix: the workflow's behavior was consistent in development, broken in production; the resolution converged the two.

## Tension with Other Principles

### Stability vs Velocity

Adding circuit breakers, bulkheads, timeouts, retries adds code complexity. For early-stage prototypes, the overhead exceeds the benefit.

**Heuristic**: add stability patterns in proportion to operational maturity:

- **Pre-MVP**: minimal patterns; failure tolerance via "restart it"
- **Early production**: timeouts everywhere; basic circuit breakers on critical paths
- **Mature production**: full pattern suite + monitoring + auto-remediation
- **Scale**: capacity planning, advanced bulkheads, sophisticated load shedding

The substrate is in "early production" mode — has timeouts and circuit-breaker-shapes (forcing instructions) for critical concerns; full pattern suite is post-v2.0+ work.

### Stability vs Simplicity

Each stability pattern adds complexity. A simple system without patterns may be more readable than a complex system with full pattern coverage.

**Heuristic**: add stability where the failure cost is real and measured. Don't add patterns speculatively. The fail-open hook discipline (rather than circuit breakers around every internal call) is appropriate for the substrate's single-process scale.

### Stability vs Correctness

Circuit breakers cause "soft failures" — the system serves degraded responses rather than perfect ones. For some applications (financial transactions), this is unacceptable.

**Resolution**: tier the stability response. Critical transactions: full ACID, no soft failures, fail loudly. Non-critical operations (recommendations, analytics): degrade gracefully under stress. The substrate uses this tiering: validation is critical (fail-fast); auxiliary metadata (counters, logs) is degradable (fail-open).

### Stability vs Idempotency

Stability patterns rely on idempotency: circuit breaker retries assume the underlying operation is safe to retry. Without idempotency, retries become a source of bugs.

**Resolution**: idempotency is foundational; stability patterns build on it. See [idempotency](../crosscut/idempotency.md) for the foundational pattern.

## Recognizing missing stability discipline

### Symptom: "weekend outages"

Failures that only happen at 3am on Saturday usually mean stability patterns are missing. Weekday traffic is well-behaved; weekend traffic exposes edge cases (lower aggregate load but unusual usage patterns; concurrent maintenance windows; etc.).

**Cause**: implicit assumptions about load patterns that don't hold; cascading failures that only trigger under specific conditions.

**Fix**: capacity planning + chaos-testing for unusual conditions.

### Symptom: thundering herd on cache miss

A cache miss causes the protected resource to be hit by ALL requests simultaneously (all clients see the miss; all retry to populate the cache; underlying service is overwhelmed).

**Cause**: cache eviction strategy; missing rate limiting; missing handshaking.

**Fix**: jittered cache TTLs; cache request coalescing; rate-limit cache misses to the protected resource.

### Symptom: deploy causes outage

Production deploy of new version causes stability degradation that wasn't visible in development.

**Cause**: development environment is too unlike production; rollout strategy is too aggressive; monitoring isn't fast enough to catch the issue before it cascades.

**Fix**: improved test harness; canary deploys; faster monitoring + automated rollback.

## Tests / verification

- **Chaos engineering**: deliberately introduce failures (kill processes, partition networks, slow downstream) and verify stability patterns activate correctly
- **Capacity testing**: load test to identify the system's bounds; verify graceful degradation past those bounds
- **Failure-mode catalogue**: enumerate known failure modes; for each, verify a stability pattern defends against it
- **Postmortem audit**: after each incident, audit whether stability patterns would have prevented it; if not, identify what pattern is missing

## When to use this principle

- **Always for any production system with meaningful availability requirements**
- **At every integration point** (timeouts, circuit breakers minimum)
- **For multi-team systems** where one team's failure can propagate to others
- **For long-running systems** where steady-state design is essential

## When NOT to use this principle (or apply with caveat)

- **Single-process scripts and tools**: stability patterns are overkill
- **Truly stateless / restart-friendly systems**: where "restart it" is the operational answer; full pattern suite is unnecessary
- **Pre-production / development**: full patterns slow iteration; add as the system enters production maturity

## Failure modes when applied incorrectly

- **Patterns without monitoring**: a circuit breaker that never alerts is worthless. Solution: every stability pattern needs corresponding observability.
- **Pattern theater**: invoking patterns by name without actually doing the analysis. Solution: each pattern application must articulate the specific failure mode it defends against.
- **Premature pattern application**: full circuit breakers + bulkheads in a 100-line script. Solution: scope patterns to operational reality.
- **Missed integration points**: pattern coverage at most call sites but missing one critical point. Solution: enumerate ALL integration points; verify each has appropriate defenses.

## Related Patterns

- [architecture/crosscut/idempotency](../crosscut/idempotency.md) — stability patterns rely on idempotency for safe retries
- [architecture/discipline/error-handling-discipline](error-handling-discipline.md) — end-to-end error propagation enables stability patterns to fire at the right boundary
- [architecture/discipline/reliability-scalability-maintainability](reliability-scalability-maintainability.md) — stability is the operational expression of the Reliability axis
- [architecture/ai-systems/rag-anchoring](../ai-systems/rag-anchoring.md) — RAG-anchoring is itself a stability pattern (anchoring on canonical content vs noisy training data is fail-fast for hallucinations)

## Sources

Authored by multi-source synthesis of:

1. **Release It!** (Michael Nygard, 2nd ed 2018) — the canonical and definitive source. The entire book is the source for this pattern catalog. Specifically:
   - The named patterns (Circuit Breaker, Bulkhead, Timeouts, Fail Fast, Steady State, Test Harness, Handshaking, Stranglers)
   - The named anti-patterns (Integration Points, Cascading Failures, Users, Blocked Threads, Self-Denial Attacks, Scaling Effects, Capacity)
   - The operational discipline framing
2. **Site Reliability Engineering** (Beyer / Jones / Petoff / Murphy, Google, 2016, free online) — the operational practice. SLOs / Error Budgets / Toil reduction / Postmortems as supporting practices for stability discipline.
3. **Software Architecture: The Hard Parts** (Ford/Richards/Sadalage/Dehghani, 2021) ch 12 (Sagas) — compensation patterns; how distributed systems handle failures via saga coordination.
4. **Designing Data-Intensive Applications** (Kleppmann, 2017):
   - Ch 5 (Replication) — synchronous vs async failure modes
   - Ch 8 (The Trouble with Distributed Systems) — Byzantine faults; crash-stop vs crash-recovery faults
   - Ch 11 (Stream Processing) — at-least-once delivery + idempotent consumers
5. **The Pragmatic Programmer** (Hunt/Thomas, 20th anniv 2019) — defensive design instincts; "let it crash" vs defensive programming.

Substrate examples cite drift-notes from H.7.7 (`error-critic.js` consolidation as circuit-breaker), H.7.10 (lock.js fault tolerance), H.7.22 (Pre-Approval Verification as circuit-breaker for plans), H.7.23 (auto-release stability fix per drift-note 51), H.7.27 (`[MARKDOWN-EMPHASIS-DRIFT]` migration as strangler pattern), and the broader fail-open hook discipline + atomic-rename steady-state design + soak-period-as-capacity-buffer.

## Phase

Authored: kb authoring batch 6 (post-H.7.27, soak-track work). First-wave priority 10 of the authoring queue — **the final first-wave doc**. Multi-source synthesis from 5 sources. Substrate examples emphasize the forcing-instruction architecture as load-bearing stability-pattern application; fact-force-gate as bulkhead; Pre-Approval Verification as circuit breaker; soak period as capacity buffer; auto-release fix as exemplary stability bug. The substrate is itself a working example of stability patterns applied to LLM-substrate domain.

**WITH THIS DOC, THE FIRST-WAVE 10-DOC AUTHORING SET IS COMPLETE.**
