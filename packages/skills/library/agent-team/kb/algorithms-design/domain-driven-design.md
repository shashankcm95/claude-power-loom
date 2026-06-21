---
kb_id: algorithms-design/domain-driven-design
version: 1
tags:
  - algorithms-design
  - ddd
  - domain-modeling
  - bounded-contexts
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: ddd, ddd-modules"
  - "Spring Framework 7.0 Release Notes (https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-7.0-Release-Notes)"
related:
  - algorithms-design/solid-and-dependency-inversion
  - algorithms-design/clean-hexagonal-architecture
  - algorithms-design/cqrs-event-sourcing
status: active
---

## Summary

**Concept**: Domain-Driven Design as a coherent spine — tactical DDD (aggregate roots, value objects, double dispatch, separate persistence model) and strategic DDD (bounded contexts enforced at compile time via JPMS, anti-corruption per context, event-bus integration).
**Key APIs**: aggregate root guarding invariants in its constructor + defensive copies; value object as JPA `@Embeddable` with by-value `equals`/`hashCode`; Joda-Money `Money`; JPMS `module-info` `requires`/`exports`/`provides`/`uses` for bounded contexts; custom Spring Data Mongo `Converter<Document,Money>`.
**Gotcha**: JPA forces a separate anemic persistence model; `JpaOrder.equals`/`hashCode` are id-based so unsaved (null-id) entities collide (classic JPA identity pitfall); package misspelled `infrastracture`.
**2026-currency**: `javax.persistence.*` → `jakarta.persistence.*` (Boot 3/4, Jakarta EE 11 / JPA 3.2); Hibernate 6.x/7.x; JPMS evergreen.
**Sources**: Baeldung `ddd` + `ddd-modules`.

## Quick Reference

**Tactical DDD** (inside one bounded context):
- **Aggregate root** — guards invariants in its constructor, recomputes derived state, and returns **defensive copies** of internal collections so callers can't break the invariant.
- **Value objects** — by-value identity; e.g. Joda-Money `Money`. Persisted as a JPA `@Embeddable` with by-value `equals`/`hashCode`.
- **Separate persistence model from rich domain model** — the JPA entity is anemic (no-arg ctor, mutable); the domain aggregate is rich.
- **Double dispatch** — `Order.accept(visitor)` → `visitor.visit(this)` (shared with the Visitor pattern).

**JPA aggregate persistence**: `@Entity` / `@Table` / `@Id` / `@GeneratedValue` / `@ElementCollection(fetch=EAGER)` / `@Embeddable` / `@Embedded`; a value object becomes an `@Embeddable` with by-value `equals`/`hashCode` (`JpaOrder`/`JpaOrderLine`/`JpaProduct` — all `javax.persistence.*`).

**Custom Spring Data Mongo converter**: `MongoCustomConversions` + a `@ReadingConverter` enum-singleton `Converter<Document,Money>` (`CustomMongoConfiguration`).

**Strategic DDD** (across bounded contexts):
- **Bounded Contexts enforced at compile time via JPMS** — `module-info` `requires` / `exports` / `provides` / `uses`.
- **Anti-corruption** — each context owns its *own* `Order` representation; contexts do **not** share an `Order` class.
- **Integration via an event bus**, not direct calls between contexts.

**Top gotchas**:
- JPA forces a separate anemic persistence model (no-arg ctor, mutable) distinct from the rich aggregate.
- `JpaOrder.equals`/`hashCode` are id-based, so unsaved (null-id) entities collide — the classic JPA identity pitfall.
- The hexagonal-DDD example misspells the package `infrastracture` throughout.

**Current (mid-2026)**: all `javax.persistence.*` aggregate annotations move to **`jakarta.persistence.*`** under Spring Boot 3.x+ (Boot 4 / Spring 7 → JPA 3.2 / Jakarta EE 11); the JPA provider is Hibernate ORM 6.x (Boot 3.x) / 7.x (Boot 4). JPMS bounded-context wiring is unchanged.

## Full content

The `ddd` and `ddd-modules` modules present DDD as a coherent spine spanning tactical and strategic design, plus the hexagonal wiring that keeps the domain framework-free (covered in the clean/hexagonal architecture section).

### Tactical DDD

The aggregate root is the consistency boundary: it validates its invariants in the constructor, recomputes derived state when it changes, and returns defensive copies of its internal collections so external code cannot mutate them behind its back. Value objects carry by-value identity (the example uses Joda-Money `Money`) and persist as JPA `@Embeddable`s with by-value `equals`/`hashCode`. A recurring DDD tension is that JPA forces a *separate*, anemic persistence model (a mutable no-arg-ctor entity) distinct from the rich domain aggregate — and the entity's id-based `equals`/`hashCode` collide for unsaved (null-id) entities, the classic JPA identity pitfall. Double dispatch (`Order.accept`/`visit`) appears here too, shared with the GoF Visitor pattern.

### Strategic DDD

Bounded contexts are enforced at compile time using JPMS `module-info`: each context is a module declaring `requires` / `requires transitive` / `exports` / `provides ... with` / `uses`, and integration crosses module boundaries via `ServiceLoader` and an event bus rather than direct calls. The anti-corruption discipline is concrete: each context owns its *own* `Order` representation — the order context and the shipping context do not share an `Order` class — so a change in one cannot corrupt the other's model. This is the same `uses`/`provides` SPI mechanism used for Dependency Inversion (cross-reference the SOLID/DIP section).

### 2026 currency

- **`javax.persistence.* → jakarta.persistence.*`.** Every JPA aggregate annotation (`@Entity`, `@Table`, `@Id`, `@GeneratedValue`, `@ElementCollection`, `@Embeddable`, `@Embedded`) moves to the Jakarta namespace under Spring Boot 3.x and 4.x. Boot 4 / Spring 7 (GA Nov 2025) adopt Jakarta EE 11 (JPA 3.2). [Spring Boot 4 & Spring Framework 7 — What's New | Baeldung](https://www.baeldung.com/spring-boot-4-spring-framework-7) · [Spring Framework 7.0 Release Notes](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-7.0-Release-Notes)
- **Hibernate 6.x / 7.x.** Under Boot 3.x the JPA provider is Hibernate ORM 6.x (latest 6.6.x) on `jakarta.persistence`; Boot 4 / Spring 7 moves to Hibernate 7.x. [Hibernate ORM releases](https://github.com/hibernate/hibernate-orm/releases)
- **Java records** can model value objects (the `Money`-style by-value carriers) with far less boilerplate; **Immutables** still adds withers where needed.
- **JPMS** bounded-context wiring is a stable Java 9 feature and carries forward unchanged.
- The DDD concepts (aggregates, value objects, bounded contexts, anti-corruption) are evergreen; only the persistence namespace and ORM versions moved.
