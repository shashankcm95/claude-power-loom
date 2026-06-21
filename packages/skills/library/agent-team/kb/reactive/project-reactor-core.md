---
kb_id: reactive/project-reactor-core
version: 1
tags:
  - reactive
  - reactor
  - flux-mono
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: reactor-core"
  - "reactor-core releases (github.com/reactor/reactor-core/releases)"
related:
  - reactive/reactive-streams-foundations
  - reactive/reactor-test-stepverifier
  - reactive/spring-webflux
  - reactive/spring-webclient
  - reactive/rxjava
  - reactive/reactive-data-integrations
status: active
---

## Summary

**Concept**: Project Reactor is the canonical Reactive Streams implementation and the connective tissue under WebFlux, RSocket, and reactive-systems — `Flux` (0..N) / `Mono` (0..1) publishers with a rich operator algebra.
**Key APIs**: `Flux`/`Mono` (`just`/`range`/`generate`/`create`/`push`/`handle`/`fromIterable`/`interval`); combine (`merge`/`concat`/`zip`/`combineLatest`); `map` vs `flatMap`; `Mono.defer`/`block`/`flatMapMany`/`switchIfEmpty`; `Sinks` (`Sinks.many().multicast()`); `Schedulers.boundedElastic()`.
**Gotcha**: `flatMap` does not preserve order (interleaves async); `map` is synchronous 1:1; `Mono.just(supplier())` runs the supplier at assembly — use `Mono.defer` for per-subscription laziness.
**2026-currency**: Reactor 3.8.x; `.RELEASE` suffix dropped; `Schedulers.elastic()` → `boundedElastic()`; EventBus replaced by `Sinks`.
**Sources**: Baeldung `reactor-core` module; reactor-core GitHub releases.

## Quick Reference

**Publishers**: `reactor.core.publisher.Flux` (0..N) and `Mono` (0..1).

**The operator families**:
- **Transform** — `map` (sync 1:1, order-preserving), `flatMap` (returns a `Publisher` per element, flattens asynchronously, **does not preserve order**), `handle` (map+filter — conditionally `sink.next`).
- **Combine** — `merge`/`mergeSequential`/`mergeDelayError`/`mergeWith` (interleave by emission time), `concat`/`concatWith` (preserve source order), `zip`/`zipWith` (pairwise), `combineLatest`.
- **Filter / slice** — `filter`, `take`, `delayElements`, `interval`, `collectList`, `index`, `switchIfEmpty`.

**Combine ordering semantics**:
- `concat` preserves source order.
- `merge` interleaves by emission time.
- `mergeDelayError` defers errors to the end.

**The four programmatic generators**:

| Method | Sync/Async | Emissions per call | Use |
|--------|-----------|--------------------|-----|
| `Flux.generate` | synchronous, stateful | exactly one `sink.next` | imperative generation |
| `Flux.create` | asynchronous | multi-emission | bridge a callback/listener API |
| `Flux.push` | async single-producer | with `OverflowStrategy` | one-producer bridge |
| `Flux.handle` | — | conditionally | map+filter inline |

**Mono content extraction**:
- Blocking: `block()` / `block(Duration)` / `blockOptional()`.
- Non-blocking: `subscribe(consumer)` / `doOnNext`.
- `Mono<List<T>>` → `Flux<T>` via `flatMapIterable(identity)` or `flatMapMany(Flux::fromIterable)`.

**Lazy evaluation**: `Mono.defer(supplier)` defers source creation to subscription time (re-evaluated per subscriber); contrast eager `Mono.just` (assembled once). Also used inside `switchIfEmpty` so the fallback builds only when needed.

**Sinks** (modern EventBus replacement): `Sinks.many().multicast()`, `Sinks.one()` — the Reactor-3 answer to the dead `reactor-bus`.

**Top gotchas**:
- `flatMap` reorders (`containsExactlyInAnyOrder`); `generate` must call `sink.next` exactly once per invocation.
- Eager `Mono.just(expensiveSupplier())` runs the supplier at assembly time ("my supplier ran too early"); use `Mono.defer`.
- `block()` defeats reactivity and can deadlock on certain schedulers — demos only.
- Side effects inside a pure `.map(...)` break atomicity/ordering.

**Current (mid-2026)**: Reactor `reactor-core` is on the **3.8.x** line (3.8.6, Jun 8 2025; Release Train 2025.0.6). `Flux`/`Mono`/`generate`/`create`/`push`/`handle`/`Schedulers.boundedElastic`/`Retry` are all current; concepts transfer directly. The `.RELEASE` suffix was dropped after 3.3; `Schedulers.elastic()` → `boundedElastic()`; the EventBus replacement is `Sinks`.

## Full content

Project Reactor is the Reactive Streams implementation that backs Spring WebFlux, RSocket, reactive-systems, and reactor-kafka. It is the most freshness-stable surface in the JVM reactive lane — concepts learned here transfer directly to 2026. The Baeldung `reactor-core` module is the deepest, most current concept set in the corpus (7 articles: Flux/Mono, combining publishers, the four generators, Mono extraction, `Mono<List>`→Flux, map vs flatMap, `Mono.defer`).

### Flux and Mono

`Flux<T>` is the 0..N publisher; `Mono<T>` is the 0..1 publisher. Static factories build them: `Flux.just`/`range`/`fromIterable`/`interval`/`generate`/`create`/`push`/`handle`/`merge`/`concat`/`zip`/`combineLatest`; `Mono.just`/`empty`/`defer`. The type encodes cardinality at the API boundary.

### map vs flatMap

`map` is a synchronous, order-preserving 1:1 transform — pure, no async. `flatMap` returns a `Publisher` per element and flattens the inner publishers asynchronously; because inner subscriptions complete out of order, `flatMap` **does not preserve order** (the `MappingUnitTest.java` test asserts `containsExactlyInAnyOrder`). Use `flatMap` for async per-element work (an HTTP call per item); use `map` for pure transforms. A frequent bug is invoking a producer or `save()` inside `.map(...)` — `map` is meant to be pure, and side effects there break atomicity and ordering.

### The four generators

Programmatic sequence creation has four distinct tools (`ProgrammaticSequences.java` + `creation/*.java`): `Flux.generate` is synchronous and stateful — it must call `sink.next` exactly once per invocation. `Flux.create` is asynchronous and supports multi-emission, ideal for bridging a callback/listener API. `Flux.push` is the async single-producer variant with an `OverflowStrategy`. `Flux.handle` combines map+filter, conditionally calling `sink.next`.

### Mono extraction and laziness

Extract a `Mono`'s value via blocking `block()`/`block(Duration)`/`blockOptional()` (CLI/tests only) or non-blocking `subscribe(consumer)`/`doOnNext`. Convert `Mono<List<T>>` to `Flux<T>` with `flatMapIterable(identity)` or `flatMapMany(Flux::fromIterable)`. `Mono.defer(supplier)` is the laziness primitive: it defers source creation to subscription time and re-evaluates per subscriber, unlike `Mono.just` which assembles its value once at declaration. `defer` is also the right tool inside `switchIfEmpty` so the fallback is built only when actually needed.

### Combining and ordering

`concat`/`concatWith` preserves source order (subscribes sequentially); `merge`/`mergeWith` interleaves by emission time (subscribes eagerly to all); `mergeDelayError` defers any error to the end so other sources complete; `zip`/`zipWith` pairs elements positionally; `combineLatest` emits on any source's latest. `CombiningPublishersIntegrationTest.java` verifies each with `StepVerifier` ordering assertions.

### Sinks — the EventBus replacement

`Sinks` (`Sinks.many().multicast()`, `Sinks.one()`) is the modern, programmatic multicast primitive — named as the Reactor-3 answer to the dead Reactor 2.x `reactor-bus` EventBus, though it is thinly demonstrated in the corpus.

### 2026 currency

- **Reactor is on the 3.8.x line.** `reactor-core` is at **3.8.6** (Jun 8, 2025; Release Train 2025.0.6); the `.RELEASE` suffix was dropped after 3.3. `Flux`/`Mono`/`generate`/`create`/`push`/`handle`/`StepVerifier`/`Schedulers.boundedElastic`/`Retry` are all current. [reactor-core releases](https://github.com/reactor/reactor-core/releases)
- **`Schedulers.elastic()` → `boundedElastic()`** (deprecated since Reactor 3.4.0, removed in 3.5.0; the unbounded `elastic()` could exhaust threads). [reactor-core releases](https://github.com/reactor/reactor-core/releases)
- **`Sinks` replaced the dead EventBus.** Reactor 2.x / `reactor-bus` (`EventBus`/`Environment`/`Selectors.$`) is history with no Reactor-3 equivalent; the replacement is `Sinks.many().multicast()` / `Sinks.one()`. [reactor-core releases](https://github.com/reactor/reactor-core/releases)
- **Context propagation is automatic** via the Micrometer `context-propagation` SPI (since Reactor-Core 3.5.0). [Reactor Context-Propagation reference](https://projectreactor.io/docs/core/release/reference/advanced-contextPropagation.html)
