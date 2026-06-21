---
kb_id: java-libraries/resilience-concurrency
version: 1
tags:
  - java-libraries
  - resilience
  - concurrency
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: libraries-6 (resilience4j), libraries (quartz/multiverse), libraries-2 (parallel-collectors), libraries-5 (jctools), libraries-concurrency (quasar)"
  - "Oracle releases Java 25 (oracle.com) — virtual threads / structured concurrency"
related:
  - java-libraries/embedded-servers
  - java-libraries/logging
status: active
---

## Summary

**Concept**: fault-tolerance, scheduling, and concurrency-utility libraries — Resilience4j (circuit breaker/bulkhead/retry, Hystrix successor), Quartz (scheduling), Parallel Collectors (bounded-concurrency streams), event buses, lock-free queues (JCTools), and fibers (Quasar — obsoleted by virtual threads).
**Key APIs**: Resilience4j `CircuitBreaker`/`Bulkhead`/`Retry`/`TimeLimiter` from `*Config`+`*Registry`, then `decorateFunction(..)`; Quartz `StdSchedulerFactory`/`JobBuilder`/`TriggerBuilder`; Parallel Collectors `parallelToList`/`parallelToStream`; JCTools SPSC/MPSC/MPMC queues; Guava `RateLimiter`/`Monitor`/`AtomicLongMap`.
**Gotcha**: Resilience4j 0.x names (`ringBufferSizeInClosedState`, `isCallPermitted`) renamed in 1.x/2.x (`slidingWindowSize`, `tryAcquirePermission`); Parallel Collectors gives bounded concurrency on a supplied `ExecutorService` vs unbounded `parallelStream` common-pool; Quasar needs `-javaagent` instrumentation.
**2026-currency**: Resilience4j 2.4.0; Quasar obsoleted by JDK 21 virtual threads (in JDK 25, blocking in `synchronized` no longer pins the carrier).
**Sources**: Baeldung `libraries-6`/`libraries`/`libraries-2`/`libraries-5`/`libraries-concurrency` modules.

## Quick Reference

**Resilience4j (functional, Hystrix successor):**

```java
CircuitBreaker cb = CircuitBreaker.of("name", CircuitBreakerConfig.custom()
    .slidingWindowSize(10)        // 0.x was ringBufferSizeInClosedState
    .build());
Function<I,O> decorated = CircuitBreaker.decorateFunction(cb, fn);
// also Bulkhead / Retry / TimeLimiter from *Config + *Registry
```
Circuit opens after the configured window of failures. **0.x → 2.x rename**: `isCallPermitted` → `tryAcquirePermission`.

**Scheduling — Quartz:**

```java
Scheduler s = StdSchedulerFactory.getDefaultScheduler();
JobDetail j = JobBuilder.newJob(MyJob.class).build();   // Job.execute(context)
Trigger t = TriggerBuilder.newTrigger().withSchedule(SimpleScheduleBuilder...).build();
s.scheduleJob(j, t);
```

**Async / bounded parallelism:**

- **Parallel Collectors** (pivovarit) — `parallelToList`/`parallelToStream` on a **supplied** `ExecutorService` with **bounded** concurrency (vs unbounded common-pool `parallelStream`).
- **JDeferred** (JS-Promise-style `Deferred`/`Promise`, `done`/`fail`/`progress`).
- Atomix/Curator/Hazelcast lean on `CompletableFuture`.

**Event buses (in-process pub/sub):** Guava `EventBus` (`@Subscribe`, `DeadEvent`; discouraged by Guava itself); **MBassador** (`@Handler`, sync/async, `DeadMessage`).

**Lock-free + Guava concurrency:** **JCTools** SPSC/MPSC/MPMC array queues (`offer`/`poll`/`drain`); Guava `Monitor` (guard-based mutex), `AtomicLongMap`, `RateLimiter` (`@Beta`), `MoreExecutors.directExecutor`.

**Fibers / STM:** **Quasar** (`Fiber`, java-agent instrumentation — **obsoleted by JDK 21 virtual threads**); **Multiverse** STM (`TxnLong`/`StmUtils.atomic` — abandoned).

**Current (mid-2026):** Resilience4j **2.4.0** (use 2.x config names). **Virtual threads** (GA Java 21) obsolete Quasar; in **Java 25** blocking in `synchronized` no longer pins the carrier (last pinning footgun removed).

## Full content

This atom collects the libraries for keeping systems resilient and managing concurrency above the raw JDK primitives. **Resilience4j** is the functional successor to Netflix Hystrix: each resilience concern (`CircuitBreaker`, `Bulkhead`, `Retry`, `TimeLimiter`) is built from a `*Config` and obtained from a `*Registry`, then applied by *decorating* a function (`CircuitBreaker.decorateFunction(cb, fn)`); the circuit opens after the configured window of failures. The base shows the 0.x API (`ringBufferSizeInClosedState`, `isCallPermitted`), which is two majors stale — the 1.x/2.x equivalents are `slidingWindowSize` and `tryAcquirePermission`. **Quartz** is the heavyweight scheduler: a `StdSchedulerFactory` yields a `Scheduler`, jobs are assembled with `JobBuilder`/`TriggerBuilder`/`SimpleScheduleBuilder`, and a `Job.execute(context)` callback runs the work.

For asynchronous and bounded-parallel work, **Parallel Collectors** (pivovarit) is the standout: `parallelToList`/`parallelToStream` run on a *supplied* `ExecutorService` with *bounded* concurrency — the key advantage over `parallelStream`, which is unbounded on the shared common ForkJoinPool. **JDeferred** offers JS-Promise-style `Deferred`/`Promise` with `done`/`fail`/`progress` callbacks. The in-process event buses are Guava's `EventBus` (`@Subscribe` handlers, `DeadEvent` for unhandled messages — discouraged by Guava itself) and **MBassador** (`@Handler`, sync/async dispatch, `DeadMessage`). Lock-free queues come from **JCTools** (SPSC/MPSC/MPMC array queues with `offer`/`poll`/`drain`), and Guava contributes its own concurrency toolkit (`Monitor` for guard-based mutual exclusion, `AtomicLongMap`, the `@Beta` `RateLimiter`, `Interners`, `MoreExecutors.directExecutor`).

The fiber and STM corner is largely historical: **Quasar** provides `Fiber` lightweight threads via java-agent bytecode instrumentation, and **Multiverse** is a software-transactional-memory library (`TxnLong`, `StmUtils.atomic`). Both are superseded — Quasar by JDK virtual threads and Multiverse by abandonment.

### 2026 currency

- **Resilience4j 2.4.0** (14 Mar 2025) — use the 2.x config names (`slidingWindowSize`, `tryAcquirePermission`); the base's 0.x names are two majors stale. Only the DSL changed — the circuit-breaker/rate-limiter/retry patterns carry forward. [Resilience4j releases](https://github.com/resilience4j/resilience4j/releases)
- **Virtual threads (Project Loom)** GA in **Java 21** obsolete Quasar fibers; in **Java 25** virtual threads that block in `synchronized` blocks now release their carrier, removing the last big pinning footgun — blocking-style code on virtual threads replaces much reactive/fiber plumbing. [Oracle releases Java 25](https://www.oracle.com/news/announcement/oracle-releases-java-25-2025-09-16/)
- **Structured Concurrency + Scoped Values** (Scoped Values finalized in Java 25, JEP 506) are the modern structured-async and immutable-context primitives. [What's new in Java 25 (Keyhole)](https://keyholesoftware.com/java-25-whats-new/)
- **Multiverse STM** remains abandoned. Quartz, JCTools, and Guava `RateLimiter` carry forward (bump pins). Quasar needs `-javaagent` — a build-time prerequisite invisible in the code.
