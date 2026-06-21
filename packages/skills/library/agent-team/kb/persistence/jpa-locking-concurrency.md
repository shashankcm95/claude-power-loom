---
kb_id: persistence/jpa-locking-concurrency
version: 1
tags:
  - persistence
  - jpa
  - locking
  - concurrency
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: hibernate-jpa"
  - "Baeldung tutorials (eugenp/tutorials) module: spring-data-eclipselink"
  - "Hibernate ORM 7 — in.relation.to (https://in.relation.to/2025/05/20/hibernate-orm-seven/)"
related:
  - persistence/jpa-entity-mapping
  - persistence/jpa-queries-criteria
  - persistence/hibernate-native
  - persistence/transactions
status: active
---

## Summary

**Concept**: JPA concurrency control — optimistic locking via `@Version`, pessimistic locking via `LockModeType`, and the persistence-context lifecycle (transaction-scoped vs extended, `find` vs `getReference`).
**Key APIs**: `@Version`, `LockModeType.{OPTIMISTIC,PESSIMISTIC_READ,PESSIMISTIC_WRITE,PESSIMISTIC_FORCE_INCREMENT}`, `em.find(Class,id,LockModeType)`/`lock`/`refresh`, `PessimisticLockScope.{NORMAL,EXTENDED}`, `@PersistenceContext(type=EXTENDED)`, `getReference()`.
**Gotcha**: A concurrent update of a `@Version`-ed entity throws `OptimisticLockException`; lazy access after the `Session`/context closes throws `LazyInitializationException`.
**2026-currency**: lock-scope hint key `javax.persistence.lock.scope` → `jakarta.persistence.lock.scope`; locking concepts otherwise stable through Hibernate 7.
**Sources**: Baeldung `hibernate-jpa` (optimistic/pessimistic), `spring-data-eclipselink` (lock scopes).

## Quick Reference

**Optimistic locking** (no DB lock; detect conflict on write):
```java
@Entity class Foo { @Version Long version; }
// concurrent update of a stale version → OptimisticLockException
```

**Pessimistic locking** (DB-level lock held for the tx):
```java
Foo f = em.find(Foo.class, id, LockModeType.PESSIMISTIC_WRITE);
```
Modes: `PESSIMISTIC_READ` / `PESSIMISTIC_WRITE` / `PESSIMISTIC_FORCE_INCREMENT`; also `em.lock(entity, mode)` / `em.refresh(entity, mode)` / `setLockMode`.

**Lock scope**: `PessimisticLockScope.NORMAL` (the entity + owned state) vs `EXTENDED` (extends locks to JOINED parents, `@CollectionTable`s, join tables).

**Persistence context lifecycle**:
- Transaction-scoped (default) vs `@PersistenceContext(type=EXTENDED)`.
- `find()` = eager SELECT; `getReference()` = lazy proxy with a deferred SELECT (setting an FK to a `getReference` proxy avoids a SELECT entirely).

**Top gotchas**:
- `OptimisticLockException` on concurrent `@Version` update — the application must retry or surface the conflict.
- `LazyInitializationException`: accessing a lazy association after the `Session`/context closes — fix with `JOIN FETCH`, `@EntityGraph`, keeping the tx open, or (anti-pattern) OSIV.
- OSIV (`spring.jpa.open-in-view`) masks N+1 by keeping the context open into the view layer — an anti-pattern, not a fix; likewise `enable_lazy_load_no_trans`.

**Current (mid-2026)**: the lock-scope hint key moved to `jakarta.persistence.lock.scope` with the namespace rename. Optimistic/pessimistic locking and the persistence-context model carry forward unchanged through Hibernate 6/7.

## Full content

JPA provides two complementary concurrency strategies and a lifecycle model for managed entities. The corpus covers locking in `hibernate-jpa` (optimistic + pessimistic) and lock scopes in `spring-data-eclipselink`.

### Optimistic locking

A `@Version` field (incremented by the provider on each update) detects lost updates: if two transactions read version N and both write, the second write fails with `OptimisticLockException`. It holds no database lock — concurrency is high, and the application handles the (rare) conflict by retry. This is the default-preferred strategy for low-contention workloads.

### Pessimistic locking

`LockModeType.PESSIMISTIC_READ`/`PESSIMISTIC_WRITE`/`PESSIMISTIC_FORCE_INCREMENT` acquire a real database lock, applied via `find`, `lock`, `refresh`, or `setLockMode`. `PessimisticLockScope.NORMAL` locks the entity and its owned state; `EXTENDED` also locks JOINED parents, `@CollectionTable`s, and join tables. Pessimistic locking trades throughput for guaranteed serialization on high-contention rows.

### Persistence context and lazy loading

The persistence context tracks managed entities for dirty checking and identity. It is transaction-scoped by default or `EXTENDED` (spanning multiple transactions, typically in stateful beans). `find()` eagerly SELECTs; `getReference()` returns a lazy proxy whose SELECT is deferred until first access — and setting a foreign key to a `getReference` proxy avoids the SELECT entirely.

### The LazyInitializationException cluster

Accessing a lazy association after the `Session`/persistence-context has closed throws `LazyInitializationException`. Correct fixes are `JOIN FETCH`, `@EntityGraph`, or keeping the transaction open over the access. OSIV (Open Session In View, `spring.jpa.open-in-view`) and `enable_lazy_load_no_trans` make the symptom disappear but are anti-patterns that mask N+1 query explosions.

### 2026 currency

- **Lock-scope hint key moved** from `javax.persistence.lock.scope` to `jakarta.persistence.lock.scope` with the Jakarta namespace rename (mandatory on Hibernate 6/7, Spring 6 / Boot 3+). [Hibernate 7 — in.relation.to](https://in.relation.to/2025/05/20/hibernate-orm-seven/)
- **Hibernate 7 removed `saveOrUpdate()`-style reassociation** of detached entities — only `merge()` and `StatelessSession` remain, which affects detached-entity concurrency workflows (see [persistence/hibernate-native](hibernate-native.md)). [Hibernate 7 — in.relation.to](https://in.relation.to/2025/05/20/hibernate-orm-seven/)
- **The locking and persistence-context concepts carry forward unchanged** — `@Version`, `LockModeType`, and lazy/eager fetching are durable; what moved is the hint namespace.
