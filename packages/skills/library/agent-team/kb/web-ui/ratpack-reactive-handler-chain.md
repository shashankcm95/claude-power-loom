---
kb_id: web-ui/ratpack-reactive-handler-chain
version: 1
tags:
  - web-ui
  - ratpack
  - reactive
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: ratpack"
  - "Resilience4j Spring Cloud Circuit Breaker (docs.spring.io/spring-cloud-circuitbreaker)"
related:
  - web-ui/play-async-reactive
  - web-ui/micro-functional-frameworks
  - web-ui/javax-jakarta-migration
status: active
---

## Summary

**Concept**: Ratpack is a lean, non-blocking JVM web framework on Netty — routes are a chain of `Handler`s, async is expressed through a `Promise`/`Execution` primitive, and DI is a `Registry` (context bag) optionally backed by Guice. The richest single async module in the corpus (7 articles: handler chains, Promises, Guice, Spring both ways, Hystrix ×3, RxJava bridging, Groovy DSL).
**Key APIs**: `RatpackServer.start(spec -> spec.handlers(chain -> chain.get("path", h)))`; `Promise.sync(...).map(...).then(...)`; `ctx.next()` filter chaining; `ctx.get(Type.class)` registry lookup; `Guice.registry(b -> b.module(DependencyModule.class))`; `HttpClient.of(spec -> spec.poolSize(10))`; `EmbeddedApp.fromHandlers().test(...)` / `ExecHarness.yieldSingle(...)`.
**Gotcha**: `chain.insert` ordering matters (a catch-all first shadows later routes); blocking IO must be wrapped to keep the event loop free; Hystrix + RxJava 1 examples are EOL outliers; `Ratpack.groovy` leaks JDBC `Connection`/`Statement`/`ResultSet`; `System.getProperty` with no default → `NumberFormatException`.
**2026-currency**: Hystrix is EOL → Resilience4j; RxJava 1 is EOL → RxJava 3; `jcenter()` is gone (use Maven Central); virtual threads (JDK 21) undercut the Promise/event-loop premise.
**Sources**: Baeldung `ratpack`; Spring Cloud Circuit Breaker (Resilience4j) docs.

## Quick Reference

**The handler-chain model**: a request flows through an ordered chain of `Handler`s on Netty; each handler either responds or calls `ctx.next()` to pass control on (filters work this way). Async is non-blocking via a `Promise` primitive — never block the event loop.

**Server + chain**:
```
RatpackServer.start(spec -> spec
  .handlers(chain -> chain
    .get("path", ctx -> ctx.render("..."))
    .get(":id", ctx -> ...)));
```

**Async (`Promise`/`Execution`)**:
- `Promise.sync(() -> compute()).map(x -> transform(x)).then(x -> ctx.render(x))`.
- Filters: a handler calls `ctx.next()` to continue the chain (e.g. `RequestValidatorFilter`).
- Test a `Promise` directly with `ExecHarness.yieldSingle(...)`.

**DI / Registry**:
- `ctx.get(Type.class)` — context-bag lookup (the Registry as DI).
- Populate with `Guice.registry(bindings -> bindings.module(DependencyModule.class))`, `Scopes.SINGLETON`.

**HTTP client**:
- `HttpClient.of(spec -> spec.poolSize(10))`; `client.get(uri)` → `Promise<ReceivedResponse>`.

**Persistence**:
- `HikariModule` + H2 (`INIT=RUNSCRIPT FROM 'classpath:/DDL.sql'`).

**Testing**:
- `EmbeddedApp.fromHandlers().test(...)`, `MainClassApplicationUnderTest` (black-box HTTP); `ExecHarness.yieldSingle` (unit-test a Promise).

**Top gotchas**:
- Route ordering: `chain.insert` order matters — a catch-all first shadows everything after.
- Blocking IO must be wrapped (`Blocking.get(...)`) so it doesn't stall the event loop.
- Resource leaks: the Groovy `Ratpack.groovy` opens JDBC `Connection`/`Statement`/`ResultSet` and never closes them.
- `RatpackHystrixApp` reads `System.getProperty(...)` with no default → `NumberFormatException` if unset.

**Current (mid-2026)**: Ratpack itself is low-activity/niche (base 1.5.4/1.6.1, ~2018). Its **Hystrix** circuit-breaker examples are EOL → **Resilience4j**; its **RxJava 1** bridging is EOL → **RxJava 3**; the Gradle build's `jcenter()` is shut down (resolve from Maven Central). **Virtual threads (JDK 21, JEP 444)** undercut Ratpack's core selling point — thread-per-request blocking now scales like the event loop.

## Full content

Ratpack is a thin, non-blocking web framework on Netty. Its identity is the **handler chain**: a request passes through an ordered list of `Handler`s, each of which either renders a response or calls `ctx.next()` to delegate to the next handler — which is exactly how filters/middleware are implemented. The server bootstraps from `main`: `RatpackServer.start(spec -> spec.handlers(chain -> chain.get("path", handler)))`. Because everything runs on a small Netty event-loop pool, blocking IO must be explicitly wrapped so it doesn't stall the loop.

### The Promise primitive

Ratpack's async model is `Promise`/`Execution`, not `CompletionStage`: `Promise.sync(() -> compute()).map(transform).then(consume)`. Blocking work is offloaded and rejoined as a `Promise`. The unit-test seam is `ExecHarness.yieldSingle(...)`, which executes a `Promise` outside a running server.

### Registry-as-DI

Dependency injection in Ratpack is a `Registry` — a typed context bag. A handler asks for a collaborator with `ctx.get(Type.class)`. The registry is populated directly or via Guice: `Guice.registry(bindings -> bindings.module(DependencyModule.class))` with `Scopes.SINGLETON`. Ratpack also integrates Spring in both directions (Spring beans into Ratpack and vice versa). The HTTP client is `HttpClient.of(spec -> spec.poolSize(10))`, whose `client.get(uri)` returns a `Promise<ReceivedResponse>`. Persistence in the teaching module is HikariCP + H2 (`HikariModule`, `INIT=RUNSCRIPT FROM 'classpath:/DDL.sql'`).

### Known defects

Ratpack is the richest async module in the corpus but carries several defects: the Groovy `Ratpack.groovy` opens JDBC `Connection`/`Statement`/`ResultSet` and never closes them; `RatpackHystrixApp` reads `System.getProperty(...)` with no default, throwing `NumberFormatException` when the property is unset; and the Hystrix + RxJava-1 examples teach two dead libraries.

### 2026 currency

- **Hystrix is EOL** (in maintenance since 2018); the modern replacement is [Resilience4j](https://docs.spring.io/spring-cloud-circuitbreaker/docs/current/reference/html/spring-cloud-circuitbreaker-resilience4j.html), usually via Spring Cloud Circuit Breaker. Resilience4j is at **2.4.0** (14 Mar 2024, JDK 17 target). Ratpack's entire circuit-breaker article + 4 classes teach a dead library.
- **RxJava 1 is EOL**; current is the [`io.reactivex.rxjava3`](https://github.com/ReactiveX/RxJava/releases) line (3.1.12, 24 Sep 2025), with `fromOptional()`/`fromStream()` interop. RxJava 4 is in alpha.
- **`jcenter()` is gone** — it became read-only in 2021 (permanent); Ratpack's Gradle build won't resolve as-is and must switch to Maven Central.
- **Virtual threads (Project Loom), final in JDK 21 ([JEP 444](https://blog.marcnuri.com/java-virtual-threads-project-loom-complete-guide)),** undercut Ratpack's raison d'être: thread-per-request blocking now scales like reactive code, so the Promise/event-loop avoidance buys much less. [JDK 24 reduced pinning (JEP 491)](https://inside.java/2025/02/22/devoxxbelgium-loom-next/) and [JDK 25 LTS](https://ankurm.com/java-21-to-25-lts-features/) finalize the concurrency overhaul. Ratpack itself is low-activity/niche; its `javax.*`-era integrations are pre-Jakarta (see the migration doc).
