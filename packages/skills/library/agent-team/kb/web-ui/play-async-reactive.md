---
kb_id: web-ui/play-async-reactive
version: 1
tags:
  - web-ui
  - play
  - async
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: play-framework (introduction, routing-in-play, student-api, async-http, websockets)"
  - "Play 3.0 Migration & Highlights (playframework.com/documentation/3.0.x/Migration30)"
related:
  - web-ui/action-mvc-frameworks
  - web-ui/ratpack-reactive-handler-chain
  - web-ui/realtime-websocket-webrtc
  - web-ui/javax-jakarta-migration
status: active
---

## Summary

**Concept**: The Play Framework's reactive layer — a text `conf/routes` file for routing, `CompletionStage`-based async with a managed execution context, JSON CRUD via Jackson, and an Akka(now Pekko)-backed WS client + WebSocket support. The corpus's `CompletionStage` async exemplar, complementing Ratpack's `Promise` model.
**Key APIs**: `conf/routes` text DSL (`VERB path controllers.X.m(id: Int ?= 1)`, `$num<[0-9]+>`, `*data`, `Assets.versioned`); `CompletableFuture.supplyAsync(..., ec.current())` → `CompletionStage<Result>` with `HttpExecutionContext`; `request.body().asJson()` + `play.libs.Json.fromJson/toJson/newObject`; WS client `ws.url(url).addQueryParameter(...).get()` → `CompletionStage<WSResponse>`, `stream()` → Akka `Source`; `Futures.timeout(stage, 1, SECONDS)`; WebSocket `WebSocket.Json.acceptOrResult` + `ActorFlow.actorRef`.
**Gotcha**: `student-api` uses `int id = students.size()` as a map key (size-as-id collision after delete) + unsynchronized `HashMap` mutated from async; `routing-in-play` uses SLF4J `{}` placeholders with `String.format` (literal `{}` returned).
**2026-currency**: Akka relicensed to BSL (2022) → Play 3.0 (Oct 2023) migrated to Apache Pekko; `ActorMaterializer` deprecated; base Play 2.7.3 several majors behind, `javax.*`.
**Sources**: Baeldung `play-framework`; Play 3.0 Migration/Highlights.

## Quick Reference

**Routing** (text `conf/routes`):
- `VERB path controllers.X.method(params)` — e.g. `GET /users controllers.HomeController.users(id: Int ?= 1)`.
- Typed/default/optional params (`id: Int ?= 1`), regex constraints (`$num<[0-9]+>`), wildcard/catch-all (`*data`), `Assets.versioned` for fingerprinted assets.
- Route-ordering hazard: a `*data` catch-all placed first shadows later routes.

**Async** (`CompletionStage`):
- `CompletableFuture.supplyAsync(() -> compute(), ec.current())` → return `CompletionStage<Result>`.
- `HttpExecutionContext ec` (injected) keeps the HTTP context across the async boundary — this is the Play 2.x idiom.

**JSON CRUD**:
- `request.body().asJson()` → `JsonNode`; `play.libs.Json.fromJson/toJson/newObject`.

**WS client** (outbound HTTP):
- `ws.url(url).addQueryParameter(k, v).get()` → `CompletionStage<WSResponse>`.
- Streaming: `.stream()` → an Akka `Source`; timeouts via `Futures.timeout(stage, 1, SECONDS)` or `setRequestTimeout(Duration)`.

**WebSocket** (inbound, actor-backed):
- `WebSocket.Json.acceptOrResult(req -> ...)`; `ActorFlow.actorRef(out -> Messenger.props(out), system, mat)` — an actor per connection.
- Auth gate: return `F.Either.Left(forbidden())` to reject.

**Top gotchas (teaching defects — do not copy)**:
- `student-api`: `int id = students.size()` as a map key → after a delete, `size()` collides with an existing key (silent overwrite); the `HashMap` is mutated from async actions with no synchronization.
- `Messenger.createMessageDTO(...)` ignores all four parameters and hardcodes field values (dead args).
- `routing-in-play`: `String.format("Got user id {} ...", userId)` uses SLF4J `{}` placeholders that `String.format` does not interpret — the literal `{}` is returned.
- Play WebSockets pins akka-actor to a *milestone* build (`2.6.0-M8`).

**Current (mid-2026)**: **Play 3.0.x** (on Apache Pekko); **Play 2.9.x is the last Akka line**. Akka was relicensed to the Business Source License in Sept 2022; Play 3.0 (Oct 2023) swapped Akka/Akka-HTTP for Pekko/Pekko-HTTP — a "replace imports/config keys" migration, not a rewrite. `ActorMaterializer` is deprecated (use the system materializer). The base's 2.7.3 (Scala 2.13, sbt 1.2.8) is several majors behind and `javax.*`.

## Full content

Play is a stateless, reactive full-stack framework. Its web doc (action-MVC `Controller`/`Result`, the routes file) is covered in the action-MVC doc; this doc focuses on Play's async and real-time layer — the corpus's `CompletionStage` exemplar.

### Routing

Routes live in a text `conf/routes` file mapping `VERB path controllers.X.method(params)`. Parameters can be typed, defaulted, and optional (`id: Int ?= 1`), constrained by regex (`$num<[0-9]+>`), or wildcard/catch-all (`*data`); `Assets.versioned` serves fingerprinted static assets. As with every routing model here, a catch-all registered first shadows later routes.

### Async with CompletionStage

Play's async model is `CompletionStage`/`CompletableFuture` over a *managed* execution context: `CompletableFuture.supplyAsync(() -> compute(), ec.current())` returns a `CompletionStage<Result>`, and the injected `HttpExecutionContext` carries the HTTP request context across the async boundary. (This `HttpExecutionContext` form is the 2.x idiom; later versions move to a plain `Executor`/`ClassLoaderExecutionContext`.) JSON CRUD parses the body with `request.body().asJson()` and converts via `play.libs.Json.fromJson/toJson/newObject`.

### WS client and Akka streaming

The outbound WS HTTP client is `ws.url(url).addQueryParameter(k, v).get()` returning a `CompletionStage<WSResponse>`; `.stream()` yields an Akka `Source` for streaming bodies (`Sink`/`Source`/`ByteString`). Timeouts use `Futures.timeout(stage, 1, SECONDS)` or `setRequestTimeout(Duration)`. Tests use `WithApplication`/`WithServer` + `Http.RequestBuilder` + `Helpers.route`, though `WSTestClient.newClient(port)` in the teaching test is never closed (a resource leak).

### WebSocket (actor-per-connection)

Inbound WebSockets bind an Akka actor per connection: `WebSocket.Json.acceptOrResult(req -> ...)` plus `ActorFlow.actorRef(out -> Messenger.props(out), system, mat)`; the actor uses `AbstractActor`, `PoisonPill`, and `Source.tick`. Auth is gated by returning `F.Either.Left(forbidden())`. The teaching `Messenger.createMessageDTO(...)` is broken — it ignores all four parameters and hardcodes field values (dead args).

### Teaching-code defects

The `student-api` module is a cautionary store: `int id = students.size()` is used as a map key, so after a delete `size()` collides with an existing key and silently overwrites it (the classic size-as-id anti-pattern), and the backing `HashMap` is mutated from async actions with no synchronization. The `routing-in-play` module logs with SLF4J `{}` placeholders fed to `String.format`, which doesn't interpret them — the literal `{}` is returned.

### 2026 currency

- **Akka → Apache Pekko, and Play 3.0.** Akka adopted the Business Source License in 2022; [Apache Pekko](https://news.apache.org/foundation/entry/apache-software-foundation-announces-new-top-level-project-apache-pekko) is the Apache-2.0 fork of Akka 2.6.x. [Play 3.0 (Oct 2023)](https://www.playframework.com/documentation/3.0.x/Migration30) swaps Akka/Akka-HTTP for Pekko/Pekko-HTTP — a "replace `akka` imports and config keys" migration, not a rewrite ([Play 3.0 Highlights](https://www.playframework.com/documentation/3.0.x/Highlights30)). **Play 2.9 is the last Akka-based line.** All `akka.*`/`com.typesafe.akka` imports in this corpus are pre-relicense, and `ActorMaterializer` is deprecated even within Akka 2.6 (use the system materializer).
- **Play 2.7.3 / Scala 2.13 / sbt 1.2.8** is several majors behind (2.8.x, then 3.x on Jakarta/Pekko); `HttpExecutionContext` is the 2.x idiom (later: plain `Executor`/`ClassLoaderExecutionContext`).
- Play's `javax.persistence`/`javax.validation`/`javax.inject` usage is pre-Jakarta — see the `javax→jakarta` migration doc.
- **Virtual threads (JDK 21, [JEP 444](https://blog.marcnuri.com/java-virtual-threads-project-loom-complete-guide))** make thread-per-request blocking scale like reactive code, reducing the need for Play's `CompletionStage` juggling for I/O-bound work.
