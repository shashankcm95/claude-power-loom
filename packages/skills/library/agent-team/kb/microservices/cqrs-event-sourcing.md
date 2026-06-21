---
kb_id: microservices/cqrs-event-sourcing
version: 1
tags:
  - microservices
  - cqrs
  - event-sourcing
  - axon
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: axon, lagom, netflix-modules/mantis"
  - "R2DBC SPI 1.0.0 (search.maven.org/artifact/io.r2dbc/r2dbc-spi)"
related:
  - microservices/event-driven-streaming
  - microservices/distributed-tracing
status: active
---

## Summary

**Concept**: CQRS splits the write model (commands) from the read model (queries); Event Sourcing stores state as an append-only event log and rebuilds aggregate state by replaying it. Axon is the canonical Java framework; Lagom does it reactively over Cassandra; Mantis is reactive stream processing.
**Key APIs**: Axon `@Aggregate`/`@AggregateIdentifier`/`@CommandHandler`/`@EventSourcingHandler`/`@QueryHandler`, `AggregateLifecycle.apply(event)`, `CommandGateway`/`QueryGateway` (`CompletableFuture`), `AggregateTestFixture`; Lagom `Service`/`ServiceCall`/`PersistentEntity`.
**Gotcha**: in Axon, command handlers DECIDE (validate + `apply`) and event handlers APPLY (mutate state) — mutating state inside a command handler breaks replay. Commands/events must override `equals`/`hashCode` (the test fixture compares by value).
**2026-currency**: Axon 4.x is a current major line (the strongest corpus module); Lagom is effectively EOL (-> Akka/Pekko); Mantis is abandoned (RxJava 1).
**Sources**: Baeldung `axon`/`lagom`/`mantis`; R2DBC SPI 1.0.0.

## Quick Reference

**Axon aggregate (write side)**:
```java
@Aggregate
class OrderAggregate {
  @AggregateIdentifier String id;
  @CommandHandler OrderAggregate(CreateOrderCommand c) { apply(new OrderCreatedEvent(c.id())); } // DECIDE
  @EventSourcingHandler void on(OrderCreatedEvent e) { this.id = e.id(); }                       // APPLY
}
```
- `AggregateLifecycle.apply(event)` from inside a command handler emits an event.
- `@AggregateMember` + `@EntityId` route commands to multi-entity aggregates.
- `CommandGateway.send(...)` / `QueryGateway.query(...)` return `CompletableFuture` (chain create->add->confirm->ship via `thenCompose`).
- Idempotent commands return no event if already-applied.

**Axon discipline**: command handlers validate and `apply`; **state changes happen ONLY in event handlers** — otherwise event replay diverges from live state.

**Axon test**: `AggregateTestFixture.given(events).when(command).expectEvents(...)` / `.expectException(...)`.

**Lagom (reactive)**: `Service` interface + `ServiceCall<Req,Resp>` (`restCall`); async `CompletionStage`; event-sourcing via `PersistentEntity` (command -> `thenPersist` -> reply; event-fold state) over a Cassandra journal; immutable JSON-serializable C/E/S types; Guice DI.

**Netflix Mantis**: Job = source -> stage(s) -> sink over RxJava `Observable`; typed stages (`ScalarComputation`, `ToGroupComputation`, `GroupToScalarComputation`); windowed group-by; SSE sink.

**Top gotchas**:
- Mutating state in an Axon command handler breaks replay.
- Commands/events without `equals`/`hashCode` make the test fixture fail spuriously.
- Double-subscribing a cold RxJava `Observable` (Mantis `LogSink`) triggers duplicate emissions.

**Current (mid-2026)**: Axon 4.x remains a current major line — the corpus's strongest, most-complete module. Lagom is effectively EOL (1.3.1) — migrate to Akka/Pekko. Mantis is abandoned (RxJava 1, dead JCenter repo). Saga orchestration-vs-choreography remains a concept-level pattern with no single canonical version pin.

## Full content

CQRS and Event Sourcing are the corpus's deepest distributed-data patterns. CQRS separates the command (write) side from the query (read) side so each can scale and model independently. Event Sourcing persists every state change as an immutable event; current state is a fold over the event stream, which gives a full audit log and time-travel/replay. The two are usually paired.

### Axon's command/event split

Axon enforces the discipline structurally: a `@CommandHandler` validates business rules and emits events via `apply(...)`, but never mutates aggregate fields; an `@EventSourcingHandler` is the only place state changes. This is load-bearing — because state is rebuilt by replaying events, any mutation outside an event handler would be lost on replay and cause divergence. Multi-entity aggregates route commands by `@EntityId`; async gateways return `CompletableFuture`, letting a REST endpoint chain a multi-step workflow with `thenCompose`. The `AggregateTestFixture` gives a given/when/then DSL (which is why commands/events need value equality).

### Lagom and Mantis

Lagom applies the same ideas reactively: a service descriptor (`Service` + `ServiceCall`), non-blocking `CompletionStage`, and event-sourced `PersistentEntity` over a Cassandra journal, with immutable JSON types throughout. Mantis is a different shape — reactive stream processing as source/stage/sink over RxJava observables, with windowed group-by aggregation.

### 2026 currency

- **Axon 4.x is current** — the corpus freshness verdict calls it "still a current major line — the strongest module," and the layered CQRS/ES concept ages well. [Spring Cloud Supported Versions](https://github.com/spring-cloud/spring-cloud-release/wiki/Supported-Versions)
- **Lagom is effectively EOL** (1.3.1) -> Akka/Pekko; **Mantis is abandoned** (RxJava 1 + dead JCenter repo). Do not seed either as a recommendation.
- **Reactive SQL is now stable.** R2DBC SPI reached 1.0.0, so reactive-SQL persistence in an event-sourced read model is a stable contract — the modern reactive-microservice direction the 2021 corpus predates. [R2DBC SPI (Maven Central)](https://search.maven.org/artifact/io.r2dbc/r2dbc-spi)
- **Saga orchestration vs choreography** remains a concept-level pattern with no canonical version pin — the corpus covers raw CQRS/ES (Axon/Lagom) but not the saga layer that coordinates cross-aggregate workflows. [Spring Cloud Supported Versions](https://github.com/spring-cloud/spring-cloud-release/wiki/Supported-Versions)
