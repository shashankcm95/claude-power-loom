---
kb_id: reactive/spring-webflux
version: 1
tags:
  - reactive
  - spring
  - webflux
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-5-webflux"
  - "HeroDevs — Spring Boot versions & EOL (herodevs.com/blog-posts/spring-boot-versions-eol-dates-and-latest-releases-april-2026)"
related:
  - reactive/reactive-streams-foundations
  - reactive/project-reactor-core
  - reactive/spring-webclient
  - reactive/reactor-test-stepverifier
  - reactive/rsocket
  - reactive/reactive-data-integrations
  - reactive/jvm-async-alternatives
status: active
---

## Summary

**Concept**: Spring WebFlux is the non-blocking, Reactor-backed sibling of Spring MVC — runs on Netty event loops, controllers return `Mono`/`Flux`, with two programming models (annotated + functional).
**Key APIs**: `@RestController`/`@GetMapping` returning `Mono`/`Flux`; functional `RouterFunctions.route()` + `HandlerFunction` + `ServerResponse`/`BodyInserters`; `PathPattern`; reactive WebSockets (`WebSocketHandler`); SSE (`Flux<ServerSentEvent<T>>`); `WebFilter`; `AbstractErrorWebExceptionHandler`; `reactor.util.retry.Retry`; `WebTestClient`.
**Gotcha**: never block a Netty worker — `Thread.sleep`/blocking JPA on the event loop stalls the server; offload to `boundedElastic`.
**2026-currency**: Spring 6 / Boot 3 brought `javax`→`jakarta`; Boot 2.x EOL; APIs largely stable; CVE-2024-38819 (WebFlux.fn path traversal) fixed in 6.1.14+.
**Sources**: Baeldung `spring-5-webflux`/`spring-5-reactive` modules; HeroDevs Spring Boot EOL.

## Quick Reference

**Two programming models**:
1. **Annotated** — `@RestController`/`@GetMapping` methods returning `Mono`/`Flux`. Same annotations as MVC.
2. **Functional endpoints** — `RouterFunction` + `HandlerFunction` composed via `RouterFunctions.route(predicate, handler).andRoute(...).andNest(...).filter(...)`; `RequestPredicates.GET/POST/accept`; `ServerResponse.ok().body(BodyInserters.fromValue(...))`; `serverRequest.bodyToMono(Class)`.

**`PathPattern` matching**:

| Token | Matches |
|-------|---------|
| `?` | single character |
| `*` | within a segment |
| `**` / `{*var}` | capture the rest |
| `{var1}_{var2}` | multi-var per segment |
| `{name:[a-z]+}` | regex var |

**Reactive WebSockets**: `WebSocketHandler.handle(WebSocketSession)`, `session.send(Flux<WebSocketMessage>)` + `session.receive()`; registered via `SimpleUrlHandlerMapping` + `WebSocketHandlerAdapter`.

**Server-Sent Events (SSE)**: return `Flux<ServerSentEvent<String>>`, or a `produces=text/event-stream` `Flux<String>`.

**Filters**: global `WebFilter` (`filter(ServerWebExchange, WebFilterChain)`) vs route-scoped `HandlerFilterFunction`.

**Error handling**:
- Per-handler: `onErrorReturn`/`onErrorResume`.
- Global: `AbstractErrorWebExceptionHandler` (`@Order(-2)`, precedes Boot's `@Order(-1)`) + a `DefaultErrorAttributes` subclass.
- Status control (5 techniques): `@ResponseStatus`, `ServerHttpResponse.setStatusCode`, `ResponseEntity.status(...)`, `@ExceptionHandler`, functional 404.

**Retry** (`reactor.util.retry.Retry`): `Retry.max`, `Retry.fixedDelay`, `Retry.backoff(+.jitter)`, `.filter` (retry only on a condition), `.onRetryExhaustedThrow`; conditional via `.retrieve().onStatus(HttpStatus::is5xxServerError, ...)`.

**Thread model**: work runs on Netty event loops; `subscribeOn`/`publishOn` shift blocking-ish work to `boundedElastic`. **Never block a Netty worker.**

**Testing**: `WebTestClient` (five bind modes: server / RouterFunction / WebHandler / ApplicationContext / Controller) with fluent `.exchange().expectStatus().expectBody().jsonPath(...)`.

**Current (mid-2026)**: WebFlux's annotated + functional models, `PathPattern`, `RouterFunction`, `WebTestClient`, SSE, and reactive WebSockets are largely stable into Spring 6 (modulo the `javax`→`jakarta` migration). Patch ≥ Spring Framework 6.1.14 to clear the WebFlux.fn path-traversal CVE.

## Full content

Spring WebFlux is the reactive web stack introduced in Spring 5, running on a non-blocking Reactor-Netty event loop instead of the servlet thread-per-request model of Spring MVC. Controllers return reactive types (`Mono`/`Flux`) and the framework subscribes for you, draining the publisher onto the HTTP response. The Baeldung WebFlux material spans four modules (`spring-5-reactive`, `spring-5-reactive-2`, `spring-5-reactive-client`, `spring-5-webflux`) and is the most thoroughly covered Spring family in the corpus.

### Two programming models

The **annotated** model reuses the MVC vocabulary: `@RestController` + `@GetMapping`/`@PostMapping`, methods returning `Mono<T>`/`Flux<T>`. The **functional** model composes routes declaratively: `RouterFunctions.route(RequestPredicates.GET(path), handler)` chained with `.andRoute(...)`/`.andNest(...)`/`.filter(...)`; the handler returns a `ServerResponse` (`ServerResponse.ok().body(BodyInserters.fromValue(...))`) and reads the body via `serverRequest.bodyToMono(Class)`. (`FunctionalWebApplication.java` even shows a manual Tomcat bootstrap via `toHttpHandler` — a teaching device; production uses Netty by default.)

### PathPattern, WebSockets, SSE

`PathPattern` is WebFlux's matcher: `?` (one char), `*` (within a segment), `**`/`{*var}` (capture-the-rest), `{var1}_{var2}` (multi-var per segment), and regex vars `{name:[a-z]+}`. Reactive WebSockets implement `WebSocketHandler.handle(WebSocketSession)` — `session.send(Flux<WebSocketMessage>)` and `session.receive()` — registered via `SimpleUrlHandlerMapping` + `WebSocketHandlerAdapter`. Server-Sent Events return a `Flux<ServerSentEvent<String>>` (or a `produces=text/event-stream` `Flux<String>`), the natural transport for a streaming feed.

### Error handling and retry

Per-handler errors use `onErrorReturn`/`onErrorResume`. The **global** handler subclasses `AbstractErrorWebExceptionHandler` at `@Order(-2)` (ahead of Boot's `@Order(-1)`) plus a custom `ErrorAttributes`. Status control has five techniques in one controller (`ResponseStatusController.java`): `@ResponseStatus`, `ServerHttpResponse.setStatusCode`, `ResponseEntity.status(...)`, `@ExceptionHandler`, and a functional 404. Retry uses `reactor.util.retry.Retry` — `Retry.max`/`fixedDelay`/`backoff` (+`.jitter`), `.filter` to retry only on a condition, `.onRetryExhaustedThrow` — often conditional via `.retrieve().onStatus(HttpStatus::is5xxServerError, ...)` so 4xx is not retried.

### The thread model — never block the event loop

WebFlux work runs on a small pool of Netty event-loop threads. Blocking one of them (a `Thread.sleep`, a blocking JPA call) stalls the whole server — the explicit anti-pattern in `TimeoutController`. Offload blocking work to a `boundedElastic` scheduler via `subscribeOn`/`publishOn` (or, in Vert.x, `executeBlocking`). The `spring-webflux-threads` module instruments which thread runs Reactor vs RxJava vs Kafka vs Mongo work.

### Server tuning, session, testing

Reactor-Netty event-loop/SSL/HTTP2 tuning goes through `WebServerFactoryCustomizer<NettyReactiveWebServerFactory>` + `NettyServerCustomizer`. Reactive sessions use `@EnableSpringWebSession` + `ReactiveSessionRepository` and `ServerHttpSecurity` for security. `WebTestClient` tests the stack in five bind modes (server / RouterFunction / WebHandler / ApplicationContext / Controller) with a fluent `.exchange().expectStatus().expectBody().jsonPath(...)` chain.

### 2026 currency

- **`javax.*` → `jakarta.*` with Spring Boot 3 / Spring 6 (Nov 2022).** Every Boot 2.x WebFlux module here predates the Jakarta namespace migration; Spring Boot 2.x is fully EOL, **Boot 3.4 reached EOL Dec 31, 2025**, and **3.5 OSS support ends June 30, 2026** (Boot 4.x GA Nov 2025, Spring Framework 7). [HeroDevs — Spring Boot versions & EOL](https://www.herodevs.com/blog-posts/spring-boot-versions-eol-dates-and-latest-releases-april-2026) · [Baeldung — Spring Boot 4 / Framework 7](https://www.baeldung.com/spring-boot-4-spring-framework-7)
- **CVE-2024-38819 — WebFlux.fn / WebMvc.fn path traversal (HIGH, CVSS 7.5).** Affects Spring Framework 5.3.0–5.3.40, 6.0.0–6.0.24, 6.1.0–6.1.13 when functional web frameworks serve static resources; **fixed in 6.1.14+**. Keep Spring Framework ≥ 6.1.14 to clear this class. [GHSA-g5vr-rgqm-vf78](https://github.com/advisories/GHSA-g5vr-rgqm-vf78) · [Wiz — CVE-2024-38819](https://www.wiz.io/vulnerability-database/cve/cve-2024-38819)
- **Deprecated idioms to migrate:** `Schedulers.elastic()` → `boundedElastic()`; `syncBody(...)` → `bodyValue(...)`; `BodyInserters.fromObject` → `fromValue`; `MediaType.APPLICATION_JSON_UTF8_VALUE` → `APPLICATION_JSON_VALUE`; Reactor-Netty `httpServer.tcpConfiguration(...)` removed (configure `HttpServer` directly). [reactor-core releases](https://github.com/reactor/reactor-core/releases)
- **Spring Framework 7 adds `@Retryable` for reactive return types**, reducing reliance on hand-rolled Reactor `Retry`; and GraalVM native image + Spring AOT compile WebFlux apps for fast startup (caveat: lambda-defined `RouterFunction` beans are not fully AOT-supported). [Baeldung — Spring Boot 4 / Framework 7](https://www.baeldung.com/spring-boot-4-spring-framework-7) · [Spring Boot — GraalVM Native Images](https://docs.spring.io/spring-boot/reference/packaging/native-image/index.html)
