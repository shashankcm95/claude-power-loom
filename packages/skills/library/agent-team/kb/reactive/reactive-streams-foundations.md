---
kb_id: reactive/reactive-streams-foundations
version: 1
tags:
  - reactive
  - reactive-streams
  - backpressure
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: reactor-core"
  - "Reactor Context-Propagation reference (projectreactor.io/docs/core/release/reference/advanced-contextPropagation.html)"
related:
  - reactive/project-reactor-core
  - reactive/rxjava
  - reactive/spring-webflux
  - reactive/rsocket
  - reactive/akka-actors-streams
  - reactive/jvm-async-alternatives
status: active
---

## Summary

**Concept**: The Reactive Streams contract — `Publisher` → `Subscriber` → `Subscription`, demand-driven via `request(n)` — is the one stable, unchanged interface across the whole JVM reactive lane (Reactor, RxJava, Akka Streams, RSocket).
**Key APIs**: `org.reactivestreams.{Publisher,Subscriber,Subscription}`; cardinalities Reactor `Flux`/`Mono`, RxJava `Observable`/`Flowable`/`Single`/`Maybe`/`Completable`; cold vs hot (`ConnectableFlux`/`ConnectableObservable`); backpressure strategies; `subscribeOn` vs `publishOn`/`observeOn`.
**Gotcha**: nothing happens until subscription — a pipeline is an inert blueprint; forgetting `.subscribe()` at an imperative boundary (Kafka/AMQP listener) silently does nothing.
**2026-currency**: contract unchanged into RxJava 3.x / Reactor 3.8; `null` forbidden in streams; context propagation now automatic via Micrometer SPI.
**Sources**: Baeldung `reactor-core` module; projectreactor.io context-propagation reference.

## Quick Reference

**The contract (`org.reactivestreams.*`)** — four interfaces:

- `Publisher<T>` — emits 0..N items; `subscribe(Subscriber)`.
- `Subscriber<T>` — `onSubscribe(Subscription)`, `onNext(T)`, `onError(Throwable)`, `onComplete()`.
- `Subscription` — `request(n)` (signal demand), `cancel()`.
- `Processor<T,R>` — both Publisher and Subscriber.

Demand is pulled: the subscriber calls `request(n)`, the publisher emits at most `n`. This is **backpressure** — bounding a fast producer against a slow consumer.

**Publisher cardinalities**:

| Lib | Type | Cardinality |
|-----|------|-------------|
| Reactor | `Flux` | 0..N |
| Reactor | `Mono` | 0..1 |
| RxJava | `Observable` | 0..N (no backpressure) |
| RxJava | `Flowable` | 0..N (backpressure-aware Publisher) |
| RxJava | `Single` | exactly 1 or error |
| RxJava | `Maybe` | 0 or 1 |
| RxJava | `Completable` | completion / error, no value |

**The single most important law — nothing happens until subscription**. A pipeline is an inert assembly-time blueprint; `.subscribe()` / `.block()` / `.connect()` triggers execution. The classic trap appears at every imperative→reactive boundary (Kafka listener, AMQP listener, a controller that subscribes instead of returning the publisher).

**Cold vs hot**:
- **Cold** — each subscriber gets an independent execution from the start (`Flux.range`, `Observable.range`).
- **Hot** — a shared, already-running source; late subscribers miss prior emissions. Reactor `ConnectableFlux` via `Flux.publish()` + `.connect()`; RxJava `ConnectableObservable` via `publish()` + `connect()`/`autoConnect()`/`refCount()`.

**Backpressure**:
- Reactor — `limitRate(n)`; `BaseSubscriber.hookOnNext` calling `request(n)`/`cancel()`.
- RxJava — `Flowable` + `BackpressureStrategy` (BUFFER/DROP/LATEST/ERROR/MISSING), `onBackpressureBuffer`/`onBackpressureDrop`; unbounded hot sources throw `MissingBackpressureException`.
- Akka Streams — backpressure for free from the Reactive-Streams substrate.
- RSocket — backpressure carried end-to-end over the wire.

**Schedulers / threading**: `subscribeOn` (where the source/subscription runs) vs `observeOn` (RxJava) / `publishOn` (Reactor) (where downstream runs).

**Top gotchas**: forgetting to subscribe; `null` is forbidden in a stream (`onErrorReturn(null)` violates the spec); hot sources have no backpressure (flood → `MissingBackpressureException`).

**Current (mid-2026)**: `org.reactivestreams.Publisher` is the one unchanged interface. The model carries forward into RxJava 3.x (`io.reactivex.rxjava3.*`) and Reactor 3.8.x. Context propagation across reactive↔imperative boundaries is now automatic via the Micrometer `context-propagation` SPI.

## Full content

The Reactive Streams specification defines a minimal four-interface contract for asynchronous stream processing with non-blocking backpressure. It is deliberately small: `Publisher`, `Subscriber`, `Subscription`, `Processor`. Every JVM reactive library (Project Reactor, RxJava 2+, Akka Streams, RSocket) either implements it directly or bridges to it. The Baeldung `reactor-core` module demonstrates the contract through Reactor's `Flux`/`Mono` plus a hand-rolled `org.reactivestreams.Subscriber` that calls `s.request(n)` in batches (`ReactorIntegrationTest.java`).

### Demand-driven flow

The interaction is pull-based at the demand level even though delivery is push-based. The subscriber signals how much it can handle via `Subscription.request(n)`; the publisher emits no more than the outstanding demand. This is what makes backpressure possible — a slow consumer never gets overwhelmed because it controls the request rate.

### Cardinality is a type-level decision

Reactor splits the world into `Flux` (0..N) and `Mono` (0..1); the type tells callers the cardinality. RxJava is richer: `Observable` (no backpressure), `Flowable` (backpressure-aware), `Single`, `Maybe`, `Completable`. Choosing the right type is part of API design — a `Mono<Void>` signals fire-and-forget completion, a `Single` signals exactly-one-or-error.

### Cold vs hot, and the subscription law

A **cold** publisher replays its full sequence for each new subscriber from the start. A **hot** publisher is a single shared, already-running source — late subscribers miss whatever was emitted before they joined. Reactor models hot via `ConnectableFlux` (`Flux.publish().connect()`); RxJava via `ConnectableObservable` (`publish().connect()` / `autoConnect()` / `refCount()`).

The defining law of the whole model: **nothing happens until subscription**. The operator chain you build is an inert blueprint assembled at "assembly time"; no work runs until `.subscribe()` (or `.block()` for the blocking bridge, or `.connect()` for a `ConnectableFlux`). The most common production bug is a `@KafkaListener`/`@RabbitListener`/Vert.x callback that builds a reactive chain but never subscribes it — the chain does nothing, and side effects then leak into fragile `doOnSuccess`/`doOnError` hooks instead of the composed return path.

### Backpressure across the lane

Backpressure is the bounding of a fast producer against a slow consumer. Reactor exposes `limitRate(n)` and manual `request(n)`/`cancel()` via `BaseSubscriber.hookOnNext`. RxJava handles it with `Flowable` + `BackpressureStrategy` (BUFFER/DROP/LATEST/ERROR/MISSING) — a hot, unbounded source without a strategy throws `MissingBackpressureException`. Akka Streams gets backpressure for free from the substrate. RSocket carries demand end-to-end across the wire, so a slow remote consumer throttles the remote producer.

### Threading

`subscribeOn` controls where the source/subscription is executed (and is positional-insensitive — it affects the whole upstream). `publishOn` (Reactor) / `observeOn` (RxJava) switches the thread for downstream operators from that point on. Scheduler choice (`Schedulers.parallel()`/`boundedElastic()` in Reactor; `Schedulers.io()`/`computation()` in RxJava) decides which pool runs the work.

### 2026 currency

- **The contract is the one unchanged interface.** `org.reactivestreams.Publisher`/`Subscriber`/`Subscription` carry forward verbatim; the Reactor `Mono`/`Flux` operator model, RxJava's observable/operator vocabulary (now under `rxjava3`), and the RSocket interaction models all hold at the concept level. [reactor-core releases](https://github.com/reactor/reactor-core/releases)
- **Reactor context propagation is now automatic via the Micrometer `context-propagation` SPI.** Since Reactor-Core 3.5.0, `ReactorContextAccessor` (loaded via `ServiceLoader`) bridges Reactor `Context`/`ContextView` ↔ `ThreadLocal`, so trace/MDC/security context flows across reactive↔imperative boundaries with no manual wiring — just add `io.micrometer:context-propagation`. This solves the long-standing "ThreadLocal doesn't work in reactive" pain. [Reactor Context-Propagation reference](https://projectreactor.io/docs/core/release/reference/advanced-contextPropagation.html) · [Micrometer Context Propagation docs](https://docs.micrometer.io/context-propagation/reference/)
- **Virtual Threads are now a simpler alternative for many I/O-bound services.** JEP 444 (finalized in Java 21) lets blocking thread-per-request code scale like reactive without the reactive programming model; WebFlux/Reactor still win for streaming/backpressure and end-to-end reactive pipelines. [JEP 444: Virtual Threads](https://openjdk.org/jeps/444)
