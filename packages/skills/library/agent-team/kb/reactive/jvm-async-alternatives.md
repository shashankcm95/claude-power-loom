---
kb_id: reactive/jvm-async-alternatives
version: 1
tags:
  - reactive
  - virtual-threads
  - resilience
sources_consulted:
  - "JEP 444: Virtual Threads (openjdk.org/jeps/444)"
  - "Baeldung — Resilience4j (baeldung.com/resilience4j)"
related:
  - reactive/reactive-streams-foundations
  - reactive/spring-webflux
  - reactive/lmax-disruptor
status: active
---

## Summary

**Concept**: The 2022–2026 JVM async landscape added imperative alternatives and companions to reactive — Virtual Threads (Loom), structured concurrency, automatic context propagation, Resilience4j, and GraalVM native image — reshaping when WebFlux/Reactor is the right choice.
**Key APIs**: Virtual Threads (JEP 444, Java 21); Structured Concurrency (JEP 505) + Scoped Values (JEP 506, JDK 25); Resilience4j 2.x (`resilience4j-reactor`, circuit breaker / retry / bulkhead); Micrometer Observation API + OpenTelemetry; Spring AOT / GraalVM native image; Spring 7 `@Retryable` for reactive returns.
**Gotcha**: Virtual Threads are a simpler alternative for I/O-bound thread-per-request code, but WebFlux still wins for streaming/backpressure and end-to-end reactive pipelines — they are complementary, not strictly one-or-the-other.
**2026-currency**: Virtual Threads finalized in Java 21 LTS; Structured Concurrency 5th preview / Scoped Values final in JDK 25; this is the biggest shift since the 2021 snapshot.
**Sources**: OpenJDK JEP 444; Baeldung Resilience4j.

## Quick Reference

**Virtual Threads (Project Loom, JEP 444, Java 21 LTS)**: lightweight JVM-managed threads — blocking thread-per-request code scales like reactive without the reactive programming model. Imperative blocking code, linear stack traces, ordinary debugging.
- **Use VTs** for I/O-bound services where the appeal of reactive was just thread-scaling.
- **Use WebFlux/Reactor** for streaming, backpressure, and end-to-end reactive pipelines.

**Structured Concurrency + Scoped Values** (JDK 25): the imperative-concurrency toolkit that complements/competes with reactive composition — Structured Concurrency reached its 5th preview (JEP 505); Scoped Values were finalized (JEP 506).

**Resilience4j 2.x** (the current reactive resilience library — closes the corpus's resilience gap):
- Circuit breaker / retry / bulkhead / rate-limiter.
- WebFlux: `resilience4j-spring-boot3` + `resilience4j-reactor` (operators on `Mono`/`Flux`), or `spring-cloud-starter-circuitbreaker-reactor-resilience4j`.
- JDK baseline bumped 17 → 21 for virtual-thread support.

**Context propagation** (automatic since Reactor-Core 3.5.0): Micrometer `context-propagation` SPI bridges Reactor `Context`/`ContextView` ↔ `ThreadLocal` — trace/MDC/security flows across reactive↔imperative boundaries with no manual wiring.

**Observability**: Micrometer Observation API (metrics + tracing in one instrumentation) + OpenTelemetry as a first-class backend; standard in Spring Boot 3+.

**GraalVM native image + Spring AOT**: compile WebFlux/Reactor apps to native images for fast startup / low memory. Caveat: lambda/instance-supplier beans (e.g. functional `RouterFunction` defined as lambdas) are not fully AOT-supported.

**Spring Framework 7**: adds `@Retryable` for reactive return types + improved Kotlin coroutine interop — resilience built into core Spring, reducing reliance on hand-rolled Reactor `Retry`.

**Current (mid-2026)**: Virtual Threads (Java 21) are the single biggest shift in the JVM async landscape since the 2021 snapshot — for many I/O-bound services a simpler alternative to WebFlux. Java LTS cadence: 17 (2021), 21 (2023), 25 (2025). Spring Boot 3.x baselines Java 17; Spring Framework 7 keeps Java 17 baseline but fully supports Java 25.

## Full content

Between the 2021 snapshot and mid-2026 the JVM gained imperative concurrency primitives that change the calculus for reactive adoption, plus companion libraries (resilience, observability, native image) that fill gaps the base corpus left open. None of these replace reactive wholesale, but they reframe when reactive earns its complexity.

### Virtual Threads — the big shift

Virtual Threads (Project Loom, JEP 444, finalized in Java 21 LTS, Oct 2023) are lightweight threads scheduled by the JVM onto a small pool of carrier threads. They let ordinary blocking, thread-per-request code scale to millions of concurrent operations — the scaling benefit that previously required the reactive programming model — while keeping imperative control flow, linear stack traces, and normal debugging. For many I/O-bound services this is now a simpler alternative to WebFlux/Reactor. The trade-off: WebFlux/Reactor still wins for streaming, backpressure, and genuinely end-to-end reactive pipelines, where the demand-driven contract matters. They are complementary tools, not a strict replacement.

### Structured concurrency and scoped values

Structured Concurrency (JEP 505, 5th preview in JDK 25) treats a group of concurrent subtasks as a single unit of work with a defined lifetime, and Scoped Values (JEP 506, finalized in JDK 25) provide an immutable, inheritable alternative to `ThreadLocal` that works cleanly with virtual threads. Together they form the imperative-concurrency toolkit that complements (and in places competes with) reactive composition.

### Resilience4j — closing the resilience gap

The base corpus only sketched reactive resilience (`ServerHttpSecurity`, hand-rolled retry). Resilience4j 2.x is the current library: circuit breaker, retry, bulkhead, and rate-limiter, with `resilience4j-reactor` providing operators that decorate `Mono`/`Flux`, plus `spring-cloud-starter-circuitbreaker-reactor-resilience4j` for WebFlux. Recent releases bumped the JDK baseline from 17 to 21 for virtual-thread support.

### Context propagation, observability, native image

Three more 2026 must-knows: Reactor context propagation is now automatic via the Micrometer `context-propagation` SPI (since Reactor-Core 3.5.0), so trace/MDC/security context flows across reactive↔imperative boundaries without manual wiring; observability standardized on the Micrometer Observation API (unified metrics + tracing) with OpenTelemetry as a first-class export backend; and GraalVM native image + Spring AOT compile WebFlux/Reactor apps for fast startup and low memory in serverless/cloud, with the caveat that lambda-defined `RouterFunction` beans are not fully AOT-supported. Spring Framework 7 also folds resilience into core Spring with `@Retryable` for reactive return types.

### 2026 currency

- **Virtual Threads — JEP 444, finalized in Java 21 LTS (Oct 2023).** The single biggest shift in the JVM async landscape since the snapshot; for many I/O-bound services a simpler alternative to WebFlux/Reactor (imperative blocking code, linear debugging). WebFlux still wins for streaming/backpressure. [JEP 444: Virtual Threads (OpenJDK)](https://openjdk.org/jeps/444) · [Virtual Threads vs WebFlux 2025 (Medium)](https://medium.com/@mesfandiari77/virtual-threads-vs-reactive-webflux-which-one-should-you-use-in-2025-9720996b57e3) · [loom-webflux-benchmarks](https://github.com/chrisgleissner/loom-webflux-benchmarks)
- **Structured Concurrency + Scoped Values matured through JDK 25.** Structured Concurrency reached its 5th preview (JEP 505); Scoped Values were finalized (JEP 506). [Java 25 — Virtual Threads and beyond (javapro.io)](https://javapro.io/2026/03/05/java-25-and-the-new-age-of-performance-virtual-threads-and-beyond/)
- **Resilience4j is the current reactive resilience library.** Resilience4j 2.x (circuit breaker / retry / bulkhead / rate-limiter); use `resilience4j-spring-boot3` + `resilience4j-reactor` for WebFlux. JDK baseline bumped 17 → 21. [Resilience4j releases](https://github.com/resilience4j/resilience4j/releases) · [Baeldung — Resilience4j](https://www.baeldung.com/resilience4j)
- **Observability is the Micrometer Observation API + OpenTelemetry.** Standard in Spring Boot 3+; trace context propagates through reactive pipelines via the Micrometer context-propagation SPI. [OpenTelemetry with Spring Boot (spring.io, Nov 2025)](https://spring.io/blog/2025/11/18/opentelemetry-with-spring-boot/) · [Micrometer Context Propagation docs](https://docs.micrometer.io/context-propagation/reference/)
- **GraalVM native image + Spring AOT for reactive apps.** Spring Boot 3+ compiles WebFlux/Reactor apps to native images; lambda-defined `RouterFunction` beans are a known AOT limitation. [Spring Boot — GraalVM Native Images](https://docs.spring.io/spring-boot/reference/packaging/native-image/index.html)
- **Java LTS cadence: 17 / 21 / 25.** Java 25 is the newest LTS (support to Sep 30, 2031); Spring Boot 3.x baselines Java 17, Spring Framework 7 keeps the Java 17 baseline but fully supports Java 25. [endoflife.date — Eclipse Temurin](https://endoflife.date/eclipse-temurin) · [Baeldung — Spring Boot 4 / Framework 7](https://www.baeldung.com/spring-boot-4-spring-framework-7)
