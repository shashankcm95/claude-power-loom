---
kb_id: reactive/vertx
version: 1
tags:
  - reactive
  - vertx
  - event-driven
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: vertx"
  - "Eclipse Vert.x 5 released (vertx.io/blog/eclipse-vert-x-5-released)"
related:
  - reactive/rxjava
  - reactive/akka-actors-streams
status: active
---

## Summary

**Concept**: Vert.x is an event-driven, non-blocking toolkit for the JVM — verticles deployed on an event loop, an event bus for inter-verticle messaging, and a reactive web router; the loop must never be blocked.
**Key APIs**: `AbstractVerticle` (`start`/`stop`) + `Vertx.deployVerticle`; `vertx.eventBus().send/consumer/reply`; Vert.x Web `Router` + `RoutingContext`; `vertx.executeBlocking(...)`; Rxified `io.vertx.reactivex.*` (`rxReadFile` → `Single`, `toFlowable()`).
**Gotcha**: blocking the event loop stalls everything — wrap blocking work (JPA, file I/O) in `executeBlocking`.
**2026-currency**: Vert.x **5.0 GA** (May 15, 2025) removes the callback model entirely (futures-only), adds JPMS modules, requires JDK 11+; the corpus's 3.x callback APIs are a breaking-rewrite away.
**Sources**: Baeldung `vertx`/`spring-vertx`/`vertx-and-rxjava` modules; Eclipse Vert.x 5 blog.

## Quick Reference

**Verticles**: `AbstractVerticle` with `start`/`stop`, deployed via `Vertx.deployVerticle`; lifecycle signaled async (3.x `Future`, 5.x `Promise`).

**Event bus** (inter-verticle seam): `vertx.eventBus().send(addr, msg, replyHandler)` / `.consumer(addr).handler(...)` / `.reply(...)`.

**Vert.x Web**:
```java
vertx.createHttpServer().requestHandler(router).listen(port, handler);
router.get("/path/:id").handler(rc ->
  rc.response().putHeader(...).setStatusCode(200).end(...));
```
- `Router` + `RoutingContext`, path params via `:id`, JSON via `Json.encodePrettily`.

**Blocking off the event loop**: `vertx.executeBlocking(future, resultHandler)` wraps blocking work (e.g. JPA) so it doesn't stall the loop.

**Spring integration**: verticles as `@Component` beans deployed in `@PostConstruct`; the event bus bridges to Spring `@Service`/JPA.

**Rxified Vert.x** (`io.vertx.reactivex.*`): callback API → RxJava types — `fileSystem.rxReadFile(...)` → `Single<Buffer>`; `HttpClientResponse.toFlowable()`; cold subscription-triggered request via `req.toFlowable().doOnSubscribe(s -> req.end())`; chunk aggregation via `response.toObservable().reduce(Buffer.buffer(), Buffer::appendBuffer)`.

**Top gotchas**:
- Never block the event loop — offload to `executeBlocking`.
- The `vertx-and-rxjava` weather demo hits the **dead MetaWeather API** (shut down 2022) — that test cannot run.
- `Thread.sleep(20000)`-as-async-gate in the corpus is flaky — use `vertx-unit`.

**Current (mid-2026)**: **Vert.x 5.0 GA** (May 15, 2025) removes the callback model entirely (futures-only — the base doc's hybrid note is fully realized), adds **JPMS explicit modules**, enhances gRPC, and requires **JDK 11+**. Vert.x 4 gets bug-fixes until **April 2027**. The 3.x→4.x→5.x path is a breaking rewrite.

## Full content

Vert.x is a polyglot, event-driven toolkit built on Netty. Application logic lives in **verticles** that run on a small pool of event-loop threads, communicating via an **event bus**. Like WebFlux's Netty model, the cardinal rule is to never block the event loop. The Baeldung corpus covers the basics (`vertx`, `spring-vertx`, `vertx-and-rxjava`) but not the Vert.x 4 `Future` model, clustering, or reactive SQL.

### Verticles and the event bus

A verticle extends `AbstractVerticle` (overriding `start`/`stop`) and is deployed via `Vertx.deployVerticle`; deployment completion is signaled asynchronously (a `Future` in 3.x, a `Promise` in 4.x/5.x). Verticles do not share state — they coordinate through the **event bus**: `vertx.eventBus().send(addr, msg, replyHandler)` to send (point-to-point with optional reply), `.consumer(addr).handler(...)` to receive, `.reply(...)` to respond. This message-passing seam is conceptually close to the actor model.

### Vert.x Web

`vertx.createHttpServer().requestHandler(router).listen(port, handler)` mounts a `Router`; routes are declared with `router.get(path).handler(rc -> ...)` where `rc` is a `RoutingContext` carrying request/response. Path params use `:id`, JSON is serialized with `Json.encodePrettily`.

### Blocking off the loop

When a verticle must do blocking work (JPA, synchronous I/O), it wraps it in `vertx.executeBlocking(future, resultHandler)`, which runs the blocking code on a worker pool and returns the result back on the event loop — the Vert.x analog of Reactor's `boundedElastic` offload.

### Spring and RxJava integration

Spring integration treats verticles as `@Component` beans and deploys them in `@PostConstruct`, bridging the event bus to Spring `@Service`/JPA (`spring-vertx`). The **Rxified** API (`io.vertx.reactivex.*`) maps Vert.x's callback API onto RxJava types: `fileSystem.rxReadFile(...)` returns a `Single<Buffer>`, an HTTP response exposes `toFlowable()`, and a cold, subscription-triggered request is expressed as `req.toFlowable().doOnSubscribe(s -> req.end())`. Chunked bodies aggregate via `response.toObservable().reduce(Buffer.buffer(), Buffer::appendBuffer)` (`vertx-and-rxjava`). Note this demo targets the MetaWeather API, which shut down in 2022.

### 2026 currency

- **Vert.x went 3.x → 4.x → 5.x.** Vert.x **5.0 GA** shipped May 15, 2025: it **removes the callback model entirely** (futures-only — the base doc's hybrid-model note is now fully realized), adds **JPMS explicit modules**, enhances gRPC, and requires **JDK 11+**. Vert.x 4 receives bug-fix releases until **April 2027**. [Eclipse Vert.x 5 released](https://vertx.io/blog/eclipse-vert-x-5-released/) · [What's new in Vert.x 5](https://vertx.io/blog/whats-new-in-vert-x-5/) · [Vert.x 4→5 migration guide](https://vertx.io/docs/guides/vertx-5-migration-guide/)
- **Breaking API changes 3.x → 4.x.** `requestHandler(router::accept)` → `requestHandler(router)`; `start(Future)` → `start(Promise)`; `HttpClient.getNow`/callback client → `Future`/request model; `executeBlocking` callback/`Future` → `Promise`; event-bus `send(reply-handler)` → `request(...)`; `io.vertx.core.Starter` → `Launcher`; `vertx-rx-java2` → `vertx-rx-java3`. The corpus's Vert.x 3.4–3.8 (one a beta) needs migration. [Vert.x 4→5 migration guide](https://vertx.io/docs/guides/vertx-5-migration-guide/)
- **The MetaWeather API shut down in 2022** — the `vertx-and-rxjava` integration test is permanently dead regardless of code modernization, with no successor API. [Eclipse Vert.x 5 released](https://vertx.io/blog/eclipse-vert-x-5-released/)
- **The verticle/event-loop model carries forward unchanged** at the concept level; what changed is the construction surface (futures-only, JPMS). [What's new in Vert.x 5](https://vertx.io/blog/whats-new-in-vert-x-5/)
