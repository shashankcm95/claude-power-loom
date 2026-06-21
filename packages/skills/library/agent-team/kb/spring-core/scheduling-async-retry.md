---
kb_id: spring-core/scheduling-async-retry
version: 1
tags:
  - spring-core
  - scheduling
  - async
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-scheduling / spring-quartz"
  - "All together now: Spring Boot 3.2, GraalVM, Java 21, virtual threads (official blog, spring.io/blog/2023/09/09/all-together-now-spring-boot-3-2-graalvm-native-images-java-21-and-virtual/)"
related:
  - spring-core/spring-aop
  - spring-core/cache-abstraction
  - spring-core/spring-batch
status: active
---

## Summary

**Concept**: Declarative scheduling (`@Scheduled`), async execution (`@Async`), and retry (`@Retryable`) run background/deferred work; Quartz adds persistent, clustered jobs.
**Key APIs**: `@EnableScheduling`/`@Scheduled`; `@EnableAsync`/`@Async`/`AsyncConfigurer`; `@EnableRetry`/`@Retryable`/`@Recover`; `ThreadPoolTaskScheduler`, `SchedulingConfigurer`; Quartz `SchedulerFactoryBean`/`AutoWiringSpringBeanJobFactory`.
**Gotcha**: `@Async`/`@Scheduled` self-invocation runs synchronously (proxy caveat); DI into a Quartz `Job` needs `AutoWiringSpringBeanJobFactory` because Quartz instantiates jobs itself.
**2026-currency**: Annotations are durable core; virtual threads (Java 21 / Boot 3.2) change the execution substrate without changing the annotations.
**Sources**: Baeldung `spring-scheduling`/`spring-quartz`; spring.io virtual-threads blog.

## Quick Reference

**Scheduling**: `@EnableScheduling` + `@Scheduled`:
- `fixedDelay` (end → start) vs `fixedRate` (start → start), `initialDelay`, 6-field `cron`, and `...String` placeholder variants (`fixedDelayString`/`cron = "${...}"`).
- Programmatic: `ThreadPoolTaskScheduler` + `CronTrigger`/`PeriodicTrigger`.
- Dynamic: `SchedulingConfigurer` + `addTriggerTask` + a `Trigger` computing the next time from `TriggerContext.lastCompletionTime()`.
- Conditional enabling: `@ConditionalOnProperty` / `@Profile` / a cron placeholder `${...:-}`.

**Quartz** (`spring-context-support`): `JobDetailFactoryBean` / `SimpleTriggerFactoryBean` / `SchedulerFactoryBean`; JDBC `JobStoreTX` (persistent/clustered) vs `RAMJobStore`. **DI into a Quartz `Job` needs `AutoWiringSpringBeanJobFactory`** (overriding `createJobInstance`) because Quartz reflectively instantiates jobs, bypassing Spring.

**Async**: `@EnableAsync` + `@Async` — `void` fire-and-forget vs `Future`/`CompletableFuture`. `AsyncConfigurer` supplies a custom executor + `AsyncUncaughtExceptionHandler` (the only place to observe a `void @Async` exception). Self-invocation runs synchronously.

**Retry** (Spring Retry): `@EnableRetry` + `@Retryable(maxAttempts=, backoff=@Backoff(...))` + `@Recover` (first param MUST match the thrown exception); programmatic `RetryTemplate` + `SimpleRetryPolicy` / `FixedBackOffPolicy` / `RetryListenerSupport`.

**Top gotchas**:
- **Self-invocation** — `@Async`/`@Scheduled`/`@Retryable` advice does not fire on a self-call.
- **`AutoWiringSpringBeanJobFactory` is mandatory** for `@Autowired` in a Quartz job.
- **ThreadPool sizing**: `maxPoolSize` is a no-op with an unbounded queue — `ThreadPoolTaskExecutor` queues overflow instead of spawning threads; only a bounded/zero queue makes maxPoolSize take effect.
- `@Recover`'s first parameter type must match the exception or it won't be selected.

**Current (mid-2026)**: Annotations transfer 1:1 to Spring 6/7. **Virtual threads** (Java 21, JEP 444) are wired into `@Async` and scheduling via `spring.threads.virtual.enabled=true` (Spring Boot 3.2, requires Java 21+) — the execution substrate changes, the annotations don't.

## Full content

The three declarative concerns share an AOP-proxy implementation and therefore the self-invocation caveat: a bean calling its own `@Async`/`@Scheduled`/`@Retryable` method bypasses the proxy and runs synchronously/un-retried. Each concern is enabled by an `@Enable*` annotation that registers the proxying infrastructure.

### Static, programmatic, and dynamic scheduling

`@Scheduled` covers fixed-delay/fixed-rate/cron declaratively; a `ThreadPoolTaskScheduler` with explicit `Trigger`s covers programmatic needs; and `SchedulingConfigurer` covers fully dynamic schedules where the next run time is computed at runtime (e.g. from the last completion time or a database-stored cron).

### Quartz vs `@Scheduled`

Quartz is the heavier option: persistent, clustered, misfire-aware jobs backed by a JDBC job store. Its sharp edge is that Quartz — not Spring — instantiates `Job` objects, so dependency injection requires the `AutoWiringSpringBeanJobFactory` bridge.

### Thread-pool sizing trap

The `ThreadPoolTaskExecutor` model is widely misconfigured: with an unbounded queue, `maxPoolSize` never takes effect because tasks queue instead of spawning threads above `corePoolSize`. Only a bounded (or zero-capacity) queue makes the pool grow toward `maxPoolSize`.

### 2026 currency

Scheduling/retry/async annotations are in the base doc's durable core:

- **The annotations carry to Spring 6/7 unchanged**; only `javax.* → jakarta.*` and JDK 17 baseline moved. [Spring Framework Versions (official wiki)](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-Versions)
- **Virtual threads (Project Loom)** finalized in Java 21 (JEP 444, Status: Closed/Delivered, Release: 21) — Spring Boot 3.2 wires them into request handling, `@Async`, and scheduling via one property, `spring.threads.virtual.enabled=true` (requires Java 21+). This is the most consequential net-new for background work: each task can run on a cheap virtual thread. [JEP 444: Virtual Threads (openjdk.org)](https://openjdk.org/jeps/444) · [All together now: Spring Boot 3.2, GraalVM, Java 21, virtual threads (official blog)](https://spring.io/blog/2023/09/09/all-together-now-spring-boot-3-2-graalvm-native-images-java-21-and-virtual/)
- **Current versions (mid-2026)**: Spring Framework 7.0.8, Spring Boot 4.1.0; Java 25 is the latest LTS, Java 17 the floor. [Spring Boot | endoflife.date](https://endoflife.date/spring-boot) · [JDK 25 GA announcement (openjdk.org mailing list)](https://mail.openjdk.org/pipermail/announce/2025-September/000360.html)
