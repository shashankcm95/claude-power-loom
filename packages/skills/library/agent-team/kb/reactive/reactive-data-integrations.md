---
kb_id: reactive/reactive-data-integrations
version: 1
tags:
  - reactive
  - persistence
  - messaging
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-webflux-threads"
  - "Reactor Kafka will be discontinued (spring.io/blog/2025/05/20/reactor-kafka-discontinued)"
related:
  - reactive/project-reactor-core
  - reactive/spring-webflux
  - reactive/spring-webclient
status: active
---

## Summary

**Concept**: The reactive ecosystem bridges Reactor/WebFlux to data + messaging — reactive Mongo, reactor-kafka, an AMQP→Flux bridge, R2DBC for reactive SQL, and a saga-style reactive-system architecture.
**Key APIs**: `ReactiveMongoRepository<T,ID>` (`Mono`/`Flux`); reactor-kafka `KafkaSender`/`KafkaReceiver` (`receiverOffset().acknowledge()`); AMQP bridge via `Flux.create(emitter -> ...)`; R2DBC `DatabaseClient` + reactive repositories; reactive-systems = WebFlux REST + reactive Mongo + Kafka choreography.
**Gotcha**: `@Transactional` on reactive Mongo is a no-op against a standalone (non-replica-set) MongoDB; classic `@KafkaListener` is imperative and must be bridged with `.subscribe()`.
**2026-currency**: **Reactor Kafka is discontinued** (1.3 final); **R2DBC / Spring Data Relational 4.x** is the modern reactive-SQL stack (closes the corpus's #1 gap).
**Sources**: Baeldung `spring-webflux-threads`/`reactive-systems`/`spring-webflux-amqp` modules; spring.io Reactor Kafka discontinuation blog.

## Quick Reference

**Reactive MongoDB**: `ReactiveMongoRepository<T,ID>` returns `Mono`/`Flux`; starter `spring-boot-starter-data-mongodb-reactive`. `@Transactional` needs a replica-set / Mongo 4.x+ (no-op against standalone).

**Reactor Kafka** (the *truly* reactive Kafka, vs imperative `KafkaTemplate`/`@KafkaListener`):
- `KafkaSender` / `KafkaReceiver` with `SenderRecord` / `ReceiverRecord`.
- Manual offset ack via `receiverOffset().acknowledge()`.

**Reactive AMQP bridge**: adapt the push-based Spring AMQP `MessageListener` into a `Flux` via `Flux.create(emitter -> ...)` + SSE transport. (Genuine reactive RabbitMQ would use `reactor-rabbitmq`.)

**R2DBC** (reactive relational, the 2026 successor to dead `rxjava-jdbc`): `DatabaseClient` + reactive repositories over `r2dbc-postgresql`/`r2dbc-mysql`, returning `Mono`/`Flux`.

**Reactive system architecture** (`reactive-systems`): responsive / resilient / elastic / message-driven realized as WebFlux REST + reactive Mongo + Kafka choreography (saga-style status state machine across order/inventory/shipping services); the SPA consumes via browser `EventSource` (SSE) wrapped in an RxJS `Observable` with `NgZone.run`.

**Top gotchas**:
- `@Transactional` on reactive Mongo is a no-op against standalone Mongo.
- Forgetting to subscribe at an imperative boundary — a `@KafkaListener`/`@RabbitListener` that builds a chain but never `.subscribe()`s does nothing.
- Side effects inside pure operators (a `save` inside `.map(...)`, or saving on both success and failure paths) break atomicity/ordering.

**Current (mid-2026)**: **Reactor Kafka is being discontinued** — 1.3 is the final minor release (dropped from the Reactor BOM); plan migration. **R2DBC / Spring Data Relational (4.x)** is the idiomatic reactive-SQL stack, replacing the dead `rxjava-jdbc`. Reactive Mongo (`ReactiveMongoRepository`) remains idiomatic.

## Full content

The reactive lane is only useful end-to-end if persistence and messaging are also non-blocking; otherwise a blocking JDBC call or a synchronous broker poll stalls the event loop. The corpus shows reactive Mongo, reactor-kafka, a hand-built AMQP bridge, and a multi-service reactive system, with R2DBC and `reactor-rabbitmq` as named 2026 gaps later filled.

### Reactive MongoDB

`ReactiveMongoRepository<T,ID>` is the reactive analog of `MongoRepository`, returning `Mono`/`Flux` from the `spring-boot-starter-data-mongodb-reactive` starter. The key caveat: `@Transactional` on reactive Mongo is a no-op against a standalone server — multi-document transactions require a replica set (Mongo 4.x+).

### Reactor Kafka vs classic Kafka

There are two Kafka models in the corpus. Classic `KafkaTemplate`/`@KafkaListener` is **imperative** — the listener is push-based and a reactive chain built inside it must be explicitly subscribed (the "forgetting to subscribe" trap, e.g. `OrderConsumer`). **reactor-kafka** is the genuinely reactive client: `KafkaSender`/`KafkaReceiver` with `SenderRecord`/`ReceiverRecord` and manual offset acknowledgement via `receiverOffset().acknowledge()`. The base doc framed reactor-kafka as "the truly reactive Kafka" — a framing now invalidated (see 2026 currency).

### AMQP bridge

There is no native reactive RabbitMQ in the corpus; instead the push-based Spring AMQP `MessageListener` is adapted into a `Flux` via `Flux.create(emitter -> ...)` and exposed over SSE (`spring-webflux-amqp`). Genuine reactive RabbitMQ would use `reactor-rabbitmq`.

### The reactive system

`reactive-systems` is the only multi-service example: the four reactive tenets (responsive, resilient, elastic, message-driven) realized as WebFlux REST endpoints + reactive Mongo + Kafka choreography, with a saga-style status state machine spanning order/inventory/shipping services. The Angular SPA consumes the stream via the browser `EventSource` (SSE) wrapped in an RxJS `Observable`, with `NgZone.run` to re-enter Angular's change detection. (It ships no test sources — runtime-demonstrated only.) Common bugs surface here: forgetting to subscribe, and side effects inside pure operators (`OrderService.createOrder` saving inside `.map`).

### 2026 currency

- **Reactor Kafka is being discontinued.** Spring announced (May 20, 2025) that **Reactor Kafka 1.3 is the final minor release**; it is dropped from the Reactor BOM, and Spring Cloud Stream's Reactor Kafka Binder + the reactive template in Spring for Apache Kafka are deprecated alongside it. This invalidates the base doc's "truly reactive Kafka" framing — migrate to standard Spring Kafka bridged to reactive, or a third-party reactive client. [Reactor Kafka will be discontinued (spring.io)](https://spring.io/blog/2025/05/20/reactor-kafka-discontinued/)
- **R2DBC / Spring Data R2DBC — reactive relational persistence** (closes the corpus's #1 named gap). `DatabaseClient` + reactive repositories over `r2dbc-postgresql`/`r2dbc-mysql`, returning `Mono`/`Flux`. Spring Data R2DBC merged into **Spring Data Relational** at v3.0; the Relational module is at **4.x** (e.g. 4.1.0) in the 2026 train. This is the idiomatic 2026 reactive-DB stack, replacing the dead `rxjava-jdbc`. [Spring Data R2DBC project](https://spring.io/projects/spring-data-r2dbc) · [Spring Data Relational reference](https://docs.spring.io/spring-data/relational/reference/index.html)
- **Reactive Mongo remains idiomatic** — `ReactiveMongoRepository` and reactor-kafka `KafkaSender`/`KafkaReceiver` (now end-of-road) were both still current at snapshot; `Schedulers.newBoundedElastic` is current. [Reactor Kafka discontinued (spring.io)](https://spring.io/blog/2025/05/20/reactor-kafka-discontinued/)
- **Resilience4j is the current reactive resilience library** for these data/messaging flows — circuit breaker / retry / bulkhead via `resilience4j-reactor` operators on `Mono`/`Flux`. [Baeldung — Resilience4j](https://www.baeldung.com/resilience4j)
