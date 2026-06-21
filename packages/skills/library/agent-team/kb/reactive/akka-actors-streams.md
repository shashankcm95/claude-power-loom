---
kb_id: reactive/akka-actors-streams
version: 1
tags:
  - reactive
  - akka
  - actors
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: akka-streams"
  - "Apache Pekko version support (pekko.apache.org/version-support.html)"
related:
  - reactive/vertx
  - reactive/reactive-streams-foundations
status: active
---

## Summary

**Concept**: Akka brings the actor model (message-passing concurrency) and Akka Streams (a Reactive-Streams graph with built-in backpressure) to the JVM, plus Akka HTTP and a Spring-DI bridge.
**Key APIs**: `AbstractActor`/`UntypedActor` + `receiveBuilder().match(...)`; `sender().tell(...)`; ask pattern `Patterns.ask`; Akka Streams `Source → Flow → Sink` (`mapConcat`/`grouped`/`mapAsyncUnordered`); `system.actorOf(Props.create(...))`; Akka HTTP routing DSL.
**Gotcha**: Akka moved to the BSL (Business Source License) in Sept 2022 — any 2026 Akka adoption is a licensing decision; the OSS drop-in is **Apache Pekko** (a fork of Akka 2.6).
**2026-currency**: `UntypedActor` removed → `AbstractActor`/Akka Typed; `PatternsCS` → `Patterns`; `ActorMaterializer` deprecated; Apache Pekko 1.1.x is the Apache-2.0 successor.
**Sources**: Baeldung `akka-streams`/`akka-http`/`spring-akka` modules; Apache Pekko version support.

## Quick Reference

**Actor model**:
- `AbstractActor` (or legacy `UntypedActor`) with a `Receive` dispatch via `receiveBuilder().match(MsgType.class, handler)`.
- Immutable, serializable message protocol; reply via `sender().tell(reply, self())`.
- **Ask pattern**: `Patterns.ask(actorRef, msg, timeout)` (deprecated `PatternsCS.ask`) → a `CompletionStage`/Scala `Future`.
- Create: `system.actorOf(Props.create(MyActor.class, args), "name")`.

**Akka HTTP**: routing DSL (`path`/`get`/`post`/`entity`/`complete`), `HttpApp.routes()`, Jackson marshalling, bridge HTTP→actor via ask; TestKit `JUnitRouteTest`.

**Akka Streams** (`Source → Flow → Sink`, built-in backpressure):
- Operators: `mapConcat` (1→N), `grouped(n)`, `mapAsyncUnordered(parallelism, fn)`.
- Materialization: `ActorMaterializer`, materialized value via `Keep.right()/left()`.
- Markers: `NotUsed` / `Done`; TestKit `TestSink.probe`.

```java
Source.single(x)
  .via(Flow.of(Class).mapConcat(...).grouped(2).mapAsyncUnordered(8, fn))
  .runWith(Sink.ignore(), materializer);
```

**Spring + Akka** (DI-into-actor): a custom `Extension` (`SPRING_EXTENSION_PROVIDER`) + `IndirectActorProducer`/`SpringActorProducer.produce()` routing `actorOf` through `applicationContext.getBean(name)`; actors must be `@Scope(SCOPE_PROTOTYPE)`.

**Top gotchas**:
- **LICENSE FLAG**: Akka moved to BSL (Sept 2022) — the corpus pins old Apache-2.0-era versions (2.4.14/2.5.x).
- `UntypedActor` removed (→ `AbstractActor` classic → Akka Typed `akka.actor.typed`).
- `ActorSystem.shutdown()/awaitTermination()` removed (→ `terminate()`).
- `ActorMaterializer` deprecated (→ implicit system materializer since Akka 2.6).

**Current (mid-2026)**: The OSS path is **Apache Pekko 1.1.x** (Apache 2.0, fork of Akka 2.6; first GA July 13, 2023). Commercial Akka switched to calendar versioning — **Akka 25.10** (~Nov 5, 2025, certifies Java 25, still BSL; > USD 25M revenue needs a commercial license). For any Akka content, the 2026 choice is BSL Akka vs Apache Pekko.

## Full content

Akka is a toolkit for building concurrent and distributed JVM applications around the actor model, with Akka Streams layered on top as a Reactive-Streams implementation. The Baeldung corpus covers it thinly — only Akka HTTP (one minimal server), Akka Streams (one linear pipeline), and a Spring-DI integration, all on very old (2.4.14/2.5.x) versions — and the licensing change since makes Akka a deliberate adoption decision rather than a default.

### The actor model

An actor (`AbstractActor`, or the legacy `UntypedActor`) processes one message at a time from its mailbox, dispatching on type via `receiveBuilder().match(MsgType.class, handler).build()`. Messages should be immutable and serializable; an actor replies with `sender().tell(reply, self())`. Actors are created through `system.actorOf(Props.create(...), name)`, never with `new`. The **ask pattern** turns the fire-and-forget `tell` into a request/response: `Patterns.ask(actorRef, msg, timeout)` returns a `CompletionStage` (the older `PatternsCS.ask` is deprecated), which is how Akka HTTP bridges an inbound HTTP request to an actor and awaits its reply.

### Akka HTTP

Akka HTTP exposes a routing DSL (`path`/`get`/`post`/`entity`/`complete`) and an `HttpApp.routes()` entry point, with Jackson marshalling. The typical pattern bridges HTTP to the actor system via ask (`UserServer.java` → `UserActor.java`), tested with `JUnitRouteTest`.

### Akka Streams

Akka Streams models a pipeline as `Source → Flow → Sink`, a graph with backpressure built in for free from the Reactive-Streams substrate. Operators include `mapConcat` (one element to many), `grouped(n)` (batch), and `mapAsyncUnordered(parallelism, fn)` (async with bounded concurrency). The graph must be materialized to run (`ActorMaterializer`), and the materialized value is selected with `Keep.right()/left()`; the marker types `NotUsed` and `Done` express "no useful value" and "completion." `DataImporter.java` shows a linear import pipeline; `TestSink.probe` drives stream tests.

### Spring DI into actors

Wiring Spring-managed dependencies into actors needs an indirection because actors are constructed by Akka, not Spring. The corpus uses a custom `Extension` (`SPRING_EXTENSION_PROVIDER`) plus an `IndirectActorProducer` (`SpringActorProducer.produce()`) that resolves the actor instance via `applicationContext.getBean(name)`; the actor bean must be `@Scope(SCOPE_PROTOTYPE)` so each `actorOf` gets a fresh instance.

### 2026 currency

- **Akka went BSL; Apache Pekko is the OSS successor.** Akka's BSL license change is real (Sept 2022, effective Akka 2.7.x): companies > USD 25M revenue need a commercial license, and BSL code reverts to Apache 2.0 three years after each release. The Apache-2.0 drop-in is **Apache Pekko**, a fork of Akka 2.6.x — first GA **v1.0.0 on July 13, 2023**, now at **Pekko 1.1.x**. Commercial Akka switched to calendar versioning: **Akka 25.10** (~Nov 5, 2025) certifies Java 25, still BSL. [Akka BSL License FAQ](https://akka.io/bsl-license-faq) · [Apache Pekko version support](https://pekko.apache.org/version-support.html) · [Baeldung — Intro to Apache Pekko](https://www.baeldung.com/scala/apache-pekko) · [Akka 25.10 release notes](https://doc.akka.io/reference/release-notes/2025-11-05-akka-25.10-released.html)
- **Removed/deprecated APIs.** `UntypedActor` removed (→ `AbstractActor` classic → **Akka Typed** `akka.actor.typed`); `ActorSystem.shutdown()/awaitTermination()` removed (→ `terminate()`); `PatternsCS` removed (→ `Patterns`); `ActorMaterializer` deprecated (→ implicit system materializer since Akka 2.6). The corpus's 2.4.14/2.5.x versions are very old. [Apache Pekko version support](https://pekko.apache.org/version-support.html)
- **The licensing fork is a design decision, not a version bump.** Treat Apache-2.0-era Akka in the corpus as a migration-or-fork choice between BSL Akka (calendar-versioned, paid above the revenue threshold) and Apache Pekko (Apache 2.0, OSS). [Akka licence change one year later (Lunatech)](https://blog.lunatech.com/posts/2023-10-27-akka-licence-change-one-year-later)
