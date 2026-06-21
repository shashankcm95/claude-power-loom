---
kb_id: algorithms-design/cqrs-event-sourcing
version: 1
tags:
  - algorithms-design
  - cqrs
  - event-sourcing
  - architecture
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: patterns/cqrs-es"
  - "Spring Framework 7.0 Release Notes (https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-7.0-Release-Notes)"
related:
  - algorithms-design/domain-driven-design
  - algorithms-design/clean-hexagonal-architecture
status: active
---

## Summary

**Concept**: The four-stage progression CRUD → CQRS → Event Sourcing (ES) → CQRS+ES, where reads and writes are split (CQRS) and state becomes a left-fold over an immutable event log (ES).
**Key APIs**: separate write/read models + a projector; an event store as an append log `Map<String,List<Event>>`; state reconstruction by replay (`recreateUserState` instanceof-dispatch fold); diff-to-events update; command handlers emit events → projector applies to denormalized read repos.
**Gotcha**: `EventStore.getEvents(id)` returns `null` → NPE in `recreateUserState`; `recreateUserState` assigns a fresh random UUID rather than the real id.
**2026-currency**: concepts evergreen; the realistic implementations live in distributed frameworks (Axon / Spring Cloud); R2DBC enables a reactive read side; built-in Spring resilience reduces hand-rolled retry.
**Sources**: Baeldung `cqrs-es`.

## Quick Reference

**The four-stage progression** (one module, escalating designs):

| Stage | Model | Mechanism |
|---|---|---|
| **CRUD** | one model | classic create/read/update/delete |
| **CQRS** | separate write + read models | a projector keeps the read model in sync |
| **ES** | state = left-fold over an immutable event log | replay events to reconstruct state |
| **CQRS + ES** | both | command handlers emit events → projector applies them to denormalized read repos |

**Event Sourcing core**:
- The **event store is an append log** — `Map<String,List<Event>>` keyed by aggregate id (`es/repository/EventStore`).
- **State reconstruction by replay** — `recreateUserState` folds the event list with an `instanceof`-dispatch (apply each event type to the running state).
- **Updates become diffs-to-events** — compare desired vs current and emit the events that close the gap (`es/service/UserUtility`).

**CQRS + ES wiring**: a command handler validates and emits one or more events; the event store appends them; a projector subscribes and applies each event to a denormalized read repository optimized for queries.

**Top gotchas**:
- `EventStore.getEvents(id)` returns `null` for an unknown id → NPE in `recreateUserState`. Return an empty list instead.
- `recreateUserState` assigns a fresh random UUID rather than the real aggregate id — a correctness bug in the replay fold.
- This is a teaching implementation: no concurrency control, snapshotting, or event-versioning (real ES needs all three).

**Current (mid-2026)**: the CQRS/ES *concepts* are fully current and evergreen. Real-world implementations live in distributed-systems frameworks (Axon, Spring Cloud) rather than a hand-rolled in-memory map; R2DBC enables a reactive, non-blocking read side; and Spring Framework 7's built-in resilience reduces the need for hand-rolled retry around projectors.

## Full content

The `patterns/cqrs-es` module is structured as a deliberate four-stage progression that motivates each pattern by escalating the previous one's limitations.

### CRUD → CQRS

The progression starts from classic CRUD against a single model. CQRS then splits the write model (commands that change state) from the read model (queries), with a projector keeping the read model synchronized after each write. The payoff is that reads and writes can be modeled, scaled, and optimized independently — the read model can be denormalized for fast queries without distorting the write model's invariants.

### Event Sourcing

ES replaces stored current-state with an immutable, append-only event log: the event store is a `Map<String,List<Event>>` keyed by aggregate id, and current state is reconstructed by *replaying* (left-folding) the events — `recreateUserState` walks the event list and applies each via an `instanceof` dispatch. Updates are expressed as a diff turned into events. The teaching code has two real bugs worth flagging: `EventStore.getEvents(id)` returns `null` on an unknown id (NPE in the fold), and `recreateUserState` assigns a fresh random UUID instead of preserving the real id.

### CQRS + ES

The combined stage joins the two: command handlers emit events into the event store, and a projector applies those events to denormalized read repositories. This is the canonical CQRS+ES topology — the write side is the event log (the source of truth), the read side is a projection rebuilt from it.

### 2026 currency

- **Concepts carry forward unchanged.** CQRS and Event Sourcing are evergreen architectural patterns; only their realistic implementation moved from a hand-rolled in-memory map to distributed frameworks. [Spring Framework 7.0 Release Notes](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-7.0-Release-Notes)
- **Real implementations live in distributed-systems stacks** — Axon Framework and Spring Cloud realize CQRS/ES as production services (the cross-domain microservices view), with proper concurrency control, snapshotting, and event versioning that the teaching example omits.
- **R2DBC + Spring Data R2DBC** enable a reactive, non-blocking read side for the projection repositories when the persistence port must be non-blocking. [Spring Data R2DBC — spring.io](https://spring.io/projects/spring-data-r2dbc/)
- **Built-in Spring resilience (Spring Framework 7)** — first-class `@Retryable` and `@ConcurrencyLimit` reduce (not replace) hand-rolled retry around event projection. [Spring Boot 4 & Spring Framework 7 — What's New | Baeldung](https://www.baeldung.com/spring-boot-4-spring-framework-7)
- ES pairs naturally with DDD aggregates (the event-emitting boundary) and hexagonal architecture (the event store as a driven adapter behind a port).
