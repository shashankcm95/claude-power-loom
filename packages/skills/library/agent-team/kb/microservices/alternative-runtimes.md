---
kb_id: microservices/alternative-runtimes
version: 1
tags:
  - microservices
  - runtimes
  - quarkus
  - micronaut
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: quarkus, micronaut, helidon, dropwizard, bootique, microprofile, open-liberty, spark-java, restx, msf4j"
  - "Micronaut Framework 4.9.0 release announcement (micronaut.io); Helidon 4.4.0 release (helidon.io/Medium)"
related:
  - microservices/distributed-tracing
  - microservices/serverless-cloud-sdk
status: active
---

## Summary

**Concept**: Spring Boot's competitor runtimes — opinionated ops bundles, compile-time DI, GraalVM-native frameworks, and lightweight REST DSLs that each pick a different startup/footprint/DI trade-off.
**Key APIs**: Dropwizard `Application<Configuration>`; Bootique `Bootique.app(args)...exec()`; Helidon `WebServer`+`Routing` (SE) vs CDI+JAX-RS (MP); Micronaut compile-time `@Client`; Quarkus `@QuarkusTest`/`@InjectMock`/`@BuildStep`/`@Recorder`.
**Gotcha**: Quarkus extension DB/network work MUST be `RUNTIME_INIT` not `STATIC_INIT` (a build-time connection is invalid in a native image); three distinct Quarkus mock lifecycles (`@InjectMock`/`QuarkusMock`/`@InjectSpy`) are easy to conflate.
**2026-currency**: `javax.* -> jakarta.*` mandatory across all (Quarkus 3, Helidon 3+, Micronaut 3+, Dropwizard 4); Quarkus `@NativeImageTest` -> `@QuarkusIntegrationTest`.
**Sources**: Baeldung `quarkus`/`micronaut`/`helidon`/`dropwizard` modules; Micronaut 4.9.0 + Helidon 4.4.0 release announcements.

## Quick Reference

**The runtime landscape** (each is a Spring Boot alternative with a different default):

- **Dropwizard** — opinionated ops bundle (Jetty + Jersey + Jackson + Codahale Metrics + health checks). `Application<Configuration>` lifecycle: `initialize(Bootstrap)` then `run(Configuration, Environment)`. Typed YAML config bound by Jackson + Bean Validation, JAX-RS resources, `HealthCheck`s on an admin port, fat-JAR via maven-shade.
- **Bootique** — minimal Guice-DI-first runnable-JAR framework; `Bootique.app(args).autoLoadModules().exec()`, module SPI auto-loading via `BQModuleProvider`, JAX-RS over Jersey, YAML-configured embedded Jetty.
- **Helidon SE vs MP** — two models in one project. **SE** = functional/reactive, explicit `WebServer` + `Routing.builder()`, no DI. **MP** = Eclipse MicroProfile (CDI + JAX-RS, declarative). Plus typed `Config` with pluggable sources and HTTP-Basic `Security`.
- **Micronaut** — compile-time/AOT DI via annotation processing (no runtime reflection) -> fast startup, low memory. Declarative `@Client` HTTP client vs low-level `RxHttpClient`; reactive (`Single`) endpoints; embedded Netty.
- **Quarkus** — GraalVM-oriented ("supersonic-subatomic"); JAX-RS + CDI + Hibernate Panache; native-image profile. The **testing taxonomy** is the headline: `@QuarkusTest`, `@InjectMock`/`QuarkusMock.installMockForType`/`@InjectSpy`, `QuarkusTestProfile`, `@NativeImageTest`. **Extension authoring**: deployment/runtime split, `@BuildStep` build items, `@Recorder` + `ExecutionTime.STATIC_INIT`/`RUNTIME_INIT`.
- **MicroProfile on Open Liberty** — JAX-RS + CDI + JSON-P, custom `MessageBodyReader`/`Writer` entity providers; Liberty `server.xml` feature composition + JNDI datasource.
- **Niche REST DSLs** — Spark Java (Sinatra-style route DSL, manual Gson), RESTX (annotation-processor routing + YAML spec testing), WSO2 MSF4J (`MicroservicesRunner`).

**Top gotchas**:
- Quarkus mock confusion — `@InjectMock` vs programmatic `QuarkusMock.installMockForType` (`@BeforeEach`) vs `@InjectSpy` are three distinct lifecycles.
- Quarkus extension `ExecutionTime` — a connection captured at `STATIC_INIT` is invalid in a native image; dead-bean elimination silently drops a producer unless `AdditionalBeanBuildItem.unremovableOf(...)`.
- `@NotNull` on a primitive (`int defaultSize`, Dropwizard) is a no-op; value objects compared by reference equality break when fields are added (no `equals`/`hashCode`).
- Spark Java + most demo stores mutate non-thread-safe in-memory `HashMap`/`List` — demo-only.

**Current (mid-2026)**: `javax.* -> jakarta.*` is mandatory on every current major (Quarkus 3, Helidon 3+, Micronaut 3+, Dropwizard 4, Jersey 3). Quarkus `@NativeImageTest -> @QuarkusIntegrationTest`. Latest lines: Quarkus LTS 3.27 (maintenance 3.36.x), Micronaut 4.9, Helidon 4.4 LTS.

## Full content

The corpus contrasts roughly ten JVM runtimes that compete with Spring Boot, each optimizing a different axis: ops-completeness (Dropwizard), DI minimalism (Bootique), dual programming models (Helidon SE/MP), startup speed via compile-time DI (Micronaut), GraalVM native image (Quarkus), and Sinatra-style simplicity (Spark Java).

### Lifecycle and DI models

Dropwizard's `Application<Configuration>` two-phase lifecycle (`initialize` for bundles/commands, `run` for resources/health checks) bundles Jetty, Jersey, Jackson, and Codahale metrics into one opinionated stack. Bootique inverts this to a Guice-DI-first SPI model where modules auto-load via `BQModuleProvider`. Micronaut and Quarkus both move DI to compile time (annotation processing), eliminating runtime reflection — the key to their fast startup and low memory.

### Helidon's dual model

Helidon ships two distinct programming models in one project: SE (functional, explicit `WebServer`+`Routing` builders, no DI) and MP (Eclipse MicroProfile = CDI + JAX-RS declarative). This makes it a useful teaching contrast between imperative-reactive and declarative-CDI styles.

### Quarkus testing and extensions

The Quarkus module's depth is in its testing taxonomy (`@QuarkusTest`, the three mock lifecycles, `QuarkusTestProfile`, native-image tests) and extension authoring (the deployment/runtime module split, `@BuildStep` build items, `@Recorder` bytecode recording with `ExecutionTime`). The load-bearing extension rule: any DB/network setup must run at `RUNTIME_INIT`, never `STATIC_INIT`, because a connection captured at build time is dead in a native image.

### 2026 currency

- **`javax.* -> jakarta.*` is now unavoidable** across all these runtimes — every JAX-RS/CDI/JSON-P/Validation import moved to `jakarta.*` in Jakarta EE 9+ (2020), mandatory in Quarkus 3, Helidon 3+, Micronaut 3+, Dropwizard 4, Jersey 3. Spring Framework 7.0 (GA Nov 13 2025) is built on Jakarta EE 11 with no `javax.*` path. [Spring Framework 7.0 GA](https://spring.io/blog/2025/11/13/spring-framework-7-0-general-availability/)
- **Quarkus** — `@NativeImageTest` -> `@QuarkusIntegrationTest`; the corpus's Quarkus 1.7 is many majors behind, with a new LTS every 6 months (LTS 3.27, maintenance line 3.36.x as of Jun 18 2026). [Quarkus releases](https://quarkus.io/blog/tag/release/)
- **Micronaut 4.9** (Jun 30 2025) adds an experimental virtual-thread "loom carrier mode"; **Helidon 4.4 (LTS)** adds OpenTelemetry metrics/logs and LangChain4j patterns. [Micronaut 4.9.0 release](https://micronaut.io/2025/06/30/micronaut-framework-4-9-0-released/) · [Helidon 4.4.0 release](https://medium.com/helidon/helidon-4-4-0-released-d10be2fb8039)
- **GraalVM native image is now first-class in Spring Boot itself** (AOT processing + `native` build, GA since Boot 3.0 / Nov 2022, when Spring Native graduated out of the experimental project) — native image is no longer just a Quarkus differentiator. [Native support in Spring Boot 3.0 (GA)](https://spring.io/blog/2022/09/26/native-support-in-spring-boot-3-0-0-m5/)
- **Do NOT seed as recommendations**: WSO2 MSF4J, RESTX (`0.35-rc4`), Bootique 0.23, and Spark Java (dead -> Javalin) are niche / largely dormant per the corpus freshness verdict — do not treat as actively-maintained (Spark Java in particular is dead; the others are low-activity, not strictly EOL).
