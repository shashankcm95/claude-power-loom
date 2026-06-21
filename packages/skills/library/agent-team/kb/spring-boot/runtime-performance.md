---
kb_id: spring-boot/runtime-performance
version: 1
tags:
  - spring-boot
  - performance
  - runtime
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-boot-performance"
  - "Baeldung tutorials (eugenp/tutorials) module: spring-boot-runtime-2"
  - "Spring Boot 3.2.0 available now (spring.io/blog/2023/11/23/spring-boot-3-2-0-available-now)"
related:
  - spring-boot/bootstrapping-lifecycle
  - spring-boot/native-image-aot
  - spring-boot/build-packaging
status: active
---

## Summary

**Concept**: Runtime performance and startup levers — lazy initialization, virtual threads, async execution, heap/JVM tuning, and CRaC.
**Key APIs**: `spring.main.lazy-initialization`, `spring.threads.virtual.enabled` (Boot 3.2 + Java 21), `@Async` + `@EnableAsync` + `CompletableFuture`, JVM heap config (`<jvmArguments>`, `-Xms/-Xmx`), CRaC checkpoint/restore.
**Gotcha**: `@Async` without `@EnableAsync` is inert (the annotation does nothing).
**2026-currency**: virtual threads (`spring.threads.virtual.enabled=true`, Boot 3.2 + Java 21); CRaC (Boot 3.2); fully-executable jar `.conf`/`JAVA_OPTS` removed (Boot 3.2).
**Sources**: Baeldung `spring-boot-performance` / `-runtime-2`; spring.io 2023.

## Quick Reference

**Lazy initialization (Boot 2.2+)**: `spring.main.lazy-initialization=true` (or `SpringApplication.setLazyInitialization` / `SpringApplicationBuilder.lazyInitialization`) defers bean creation until first use — faster startup, but error surfaces move to first request.

**Async execution**: `@EnableAsync` on a config class, then `@Async` on a method returning `void` or `CompletableFuture<T>`. **`@Async` without `@EnableAsync` is inert.**

```java
@EnableAsync
@Configuration class AsyncConfig {}

@Async
CompletableFuture<Report> build() { ... }
```

**Heap / JVM tuning**: the `spring-boot-maven-plugin` `<jvmArguments>`, or plain `-Xms`/`-Xmx` on the launch, or (historically) a fully-executable jar `.conf` setting `JAVA_OPTS`.

**Virtual threads (Boot 3.2 + Java 21)**: `spring.threads.virtual.enabled=true` makes Spring use virtual-thread executors for web requests, `@Async`, and scheduled tasks (Tomcat switches to virtual-thread-per-request) — high concurrency without a large platform-thread pool.

**Chaos testing**: Chaos Monkey for Spring Boot injects latency/exception/kill assaults via a profile + Actuator to exercise resilience under fault.

**Top gotchas**:
- `@Async` without `@EnableAsync` silently does nothing.
- Lazy init hides startup wiring errors until first use — a trade-off, not a free win.
- A teaching bug in the corpus: `ExecutorServiceExitCodeGenerator` never assigns its field (always returns 0).

**Current (mid-2026)**: virtual threads (`spring.threads.virtual.enabled=true`, Boot 3.2 + Java 21) and CRaC checkpoint/restore (Boot 3.2) are the headline startup/throughput levers; fully-executable jar `.conf`/`JAVA_OPTS` launch-script support was removed in Boot 3.2. Native image (see [spring-boot/native-image-aot](native-image-aot.md)) is the most extreme startup option.

## Full content

The corpus's performance material (`spring-boot-performance`, `-runtime`/`-2`) covers startup-time and throughput levers that have grown substantially since 2021 with virtual threads and CRaC.

### Lazy initialization

`spring.main.lazy-initialization=true` defers each bean's creation until it is first needed, trimming startup time — at the cost of moving any wiring errors from startup to first use. It is a global switch with per-bean opt-out.

### Asynchronous execution

`@Async` offloads a method to a task executor, returning `void` or a `CompletableFuture`. It only works when `@EnableAsync` is present on a configuration class — a silent no-op otherwise. This is configuration over the underlying `java.util.concurrent` ExecutorService primitives.

### JVM and heap

Heap and JVM flags are set through the Maven plugin's `<jvmArguments>`, directly on the `java` command, or historically via a fully-executable jar's `.conf` file. The last of these is gone in modern Boot.

### Resilience testing

Chaos Monkey for Spring Boot (codecentric) injects faults — latency, exceptions, and process kills — gated behind a `chaos-monkey` profile and driven through Actuator, to verify the application degrades gracefully.

### 2026 currency

- **Virtual threads (Project Loom), Boot 3.2 + Java 21.** Set `spring.threads.virtual.enabled=true` and Spring uses virtual-thread executors for web requests, `@Async`, and scheduled tasks; Tomcat switches to virtual-thread-per-request — a net-new concurrency model the 2021 `@Async`/pool material predates. [Spring Boot 3.2 + virtual threads](https://spring.io/blog/2023/09/09/all-together-now-spring-boot-3-2-graalvm-native-images-java-21-and-virtual/), [Spring Boot 3.2.0 available now](https://spring.io/blog/2023/11/23/spring-boot-3-2-0-available-now/)
- **Project CRaC (Coordinated Restore at Checkpoint), Boot 3.2.** JVM checkpoint/restore for fast startup as an alternative to native image. [Spring Boot 3.2.0 available now](https://spring.io/blog/2023/11/23/spring-boot-3-2-0-available-now/)
- **Fully-executable jar `.conf`/`JAVA_OPTS` removed** in Boot 3.2 — heap tuning now uses normal `java` flags or container env. [Spring Boot 4.0 Migration Guide](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide)
- **Lazy initialization and `@Async`/`@EnableAsync` carry forward unchanged.** [Spring Boot 4.0.0 available now](https://spring.io/blog/2025/11/20/spring-boot-4-0-0-available-now/)
