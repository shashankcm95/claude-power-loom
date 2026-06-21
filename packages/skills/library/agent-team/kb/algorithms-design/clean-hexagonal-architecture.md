---
kb_id: algorithms-design/clean-hexagonal-architecture
version: 1
tags:
  - algorithms-design
  - architecture
  - hexagonal
  - clean-architecture
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: patterns/clean-architecture, ddd (dddhexagonalspring), patterns/front-controller, patterns/intercepting-filter, patterns/enterprise-patterns/wire-tap, patterns/design-patterns-architectural"
  - "Spring Boot 4 & Spring Framework 7 — What's New | Baeldung (https://www.baeldung.com/spring-boot-4-spring-framework-7)"
related:
  - algorithms-design/solid-and-dependency-inversion
  - algorithms-design/domain-driven-design
  - algorithms-design/cqrs-event-sourcing
status: active
---

## Summary

**Concept**: The architectural-boundary patterns — Clean Architecture (Dependency Rule, concentric layers), Hexagonal / Ports & Adapters (framework-free domain), DAO vs Repository, Service Locator (anti-pattern), Front Controller, Intercepting Filter, and the Wire Tap EIP.
**Key APIs**: domain interface `OrderRepository` implemented by `@Component @Primary MongoDbOrderRepository` + `CassandraDbOrderRepository`; manual `@Bean OrderService` in `@Configuration`; transaction template `executeInsideTransaction(Consumer<EntityManager>)`; Front Controller reflective `Class.forName(...)`; Apache Camel `wireTap("direct:tap").onPrepare(...)`.
**Gotcha**: Service Locator is widely an anti-pattern vs DI; Intercepting Filter has an implicit ordering dependency (`VisitorCounterFilter` NPEs without `AuthenticationFilter` first); Wire Tap shallow copy aliases the body — deep-copy in `onPrepare`.
**2026-currency**: `javax.servlet.*`/`@WebFilter` → `jakarta.*`; `Class.newInstance()` → `getDeclaredConstructor().newInstance()`; `WebSecurityConfigurerAdapter` removed (Spring Security 6) → `SecurityFilterChain` bean.
**Sources**: Baeldung `clean-architecture` + `dddhexagonalspring` + `front-controller` + `intercepting-filter` + `wire-tap` + `design-patterns-architectural`.

## Quick Reference

**Clean Architecture (Uncle Bob)**: concentric layers obeying the **Dependency Rule** (source dependencies point inward only): entities → use-case interactor → boundaries (input/output/data-source ports) → interface adapters → frameworks/drivers. DTOs cross boundaries; **package-private visibility enforces the boundary** in Java.

**Hexagonal / Ports & Adapters**: the domain depends only on a **port interface**; driving adapters (REST/CLI) and driven adapters (Mongo/Cassandra) sit on the outside; Spring wiring is isolated in a `@Configuration` class so the domain stays framework-free:
```java
// domain owns the port; adapters implement it
interface OrderRepository { ... }
@Component @Primary class MongoDbOrderRepository implements OrderRepository { ... }
@Component class CassandraDbOrderRepository implements OrderRepository { ... }
@Configuration class BeanConfiguration { @Bean OrderService orderService(OrderRepository r){...} }  // manual wiring keeps domain Spring-free
```

**DAO vs Repository**: a generic `Dao<T>` maps to a *data source*; a `Repository` is a *collection of domain objects* that can compose multiple DAOs into a richer aggregate. **Service Locator** (registry + cache) is shown but flagged as an anti-pattern vs DI.

**Transaction template via lambda**: `executeInsideTransaction(Consumer<EntityManager>)` (begin/commit, rollback + rethrow) — `JpaUserDao`.

**Front Controller**: a single dispatching servlet with reflective command resolution — `Class.forName("...%sCommand", param).asSubclass(FrontCommand.class).newInstance()` with an `UnknownCommand` fallback.

**Intercepting Filter**: a chain of pluggable filters for cross-cutting concerns — container `@WebFilter` + a programmatic chain (template-method + short-circuit interception).

**Wire Tap EIP**: copy in-flight messages to a secondary endpoint via Apache Camel — `from(...).wireTap("direct:tap").onPrepare(new MyPayloadClonePrepare())` (deep-copy on prepare to avoid shallow-copy aliasing).

**Top gotchas**:
- Service Locator is widely an anti-pattern vs constructor DI.
- Intercepting Filter has an implicit ordering dependency — `VisitorCounterFilter` NPEs unless `AuthenticationFilter` runs first.
- Wire Tap's shallow copy aliases the body — deep-copy in `onPrepare` (though `deepClone` here is only "deep enough" for the immutable `String` field).
- `design-patterns-cloud` POM has zero `<dependencies>` despite importing Resilience4j — won't compile standalone; logic lives in the test tree.

**Current (mid-2026)**: `javax.servlet.*` / `@WebFilter` / `@WebServlet` → `jakarta.*` (Boot 3.x+, Servlet 6.1 under Jakarta EE 11). `Class.newInstance()` (deprecated Java 9) → `getDeclaredConstructor().newInstance()`. `WebSecurityConfigurerAdapter` removed in Spring Security 6 → configure via a `SecurityFilterChain` `@Bean`.

## Full content

This section collects the patterns that draw architectural *boundaries* — the concentric-layer and ports-and-adapters styles plus the servlet-era request-handling patterns and one EIP.

### Clean Architecture and Hexagonal

Clean Architecture organizes code into concentric layers governed by the Dependency Rule: inner layers (entities, then use-case interactors) know nothing of outer layers (interface adapters, frameworks/drivers); DTOs carry data across boundaries; and Java's package-private visibility is used to physically enforce the boundary. Hexagonal / Ports & Adapters is the closely-related style the DDD module uses: the domain defines a port interface (`OrderRepository`), driven adapters (`MongoDbOrderRepository` `@Primary`, `CassandraDbOrderRepository`) implement it, driving adapters (REST/CLI) call in, and all Spring wiring lives in a `@Configuration` `BeanConfiguration` so the domain itself stays framework-free.

### DAO, Repository, Service Locator

A generic `Dao<T>` abstracts a single data source; a `Repository` models a collection of domain objects and can compose several DAOs into a richer aggregate. A transaction template, `executeInsideTransaction(Consumer<EntityManager>)`, wraps begin/commit with rollback-and-rethrow. Service Locator (a registry + cache) is presented and then flagged as an anti-pattern relative to dependency injection.

### Request-handling and EIP patterns

Front Controller routes every request through one dispatching servlet that reflectively resolves a `FrontCommand` (`Class.forName(...).newInstance()` with an `UnknownCommand` fallback). Intercepting Filter chains pluggable filters for cross-cutting concerns (auth, logging, counting) via container `@WebFilter` plus a programmatic chain, using template-method and short-circuit interception — though it carries an implicit ordering dependency (one filter NPEs if another hasn't run first). The Wire Tap EIP copies in-flight messages to a secondary endpoint with Apache Camel's `wireTap`, deep-copying the body in `onPrepare` to avoid shallow-copy aliasing.

### 2026 currency

- **`javax.* → jakarta.*` (the most pervasive flag).** All servlet/filter code (`javax.servlet.*`, `@WebFilter` / `@WebServlet` in Front Controller and Intercepting Filter) and JMS (via Camel) move to `jakarta.*` under Spring Boot 3.x / Spring 6 / Tomcat 10+, and now one generation deeper: Boot 4 / Spring 7 (Nov 2025) adopt Jakarta EE 11 (Servlet 6.1). [Spring Boot 4 & Spring Framework 7 — What's New | Baeldung](https://www.baeldung.com/spring-boot-4-spring-framework-7) · [Spring Framework 7.0 Release Notes](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-7.0-Release-Notes)
- **`Class.newInstance()` (deprecated Java 9) → `getDeclaredConstructor().newInstance()`** in the Front Controller and Intercepting Filter reflective command resolution.
- **`WebSecurityConfigurerAdapter` removed (Spring Security 6).** Configure via a `SecurityFilterChain` `@Bean` + lambda DSL; `authorizeRequests()` → `authorizeHttpRequests()`, `antMatchers()`/`mvcMatchers()` → `requestMatchers()` — touches the DAO / clean-arch / hexagonal wiring. [Spring Security without WebSecurityConfigurerAdapter — spring.io](https://spring.io/blog/2022/02/21/spring-security-without-the-websecurityconfigureradapter/)
- **GraalVM Native Image + Spring AOT** (production-ready since Boot 3.0) requires reflection hints for the reflection-heavy Front Controller / Service Locator / reflective-command patterns to be native-friendly. [Native Images with Spring Boot and GraalVM — Baeldung](https://www.baeldung.com/spring-native-intro)
- The architectural concepts (Dependency Rule, ports & adapters, DAO/Repository distinction) are evergreen; only the namespace, reflection idiom, and security-config API moved.
