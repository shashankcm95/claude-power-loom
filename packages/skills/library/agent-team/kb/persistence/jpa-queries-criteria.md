---
kb_id: persistence/jpa-queries-criteria
version: 1
tags:
  - persistence
  - jpa
  - jpql
  - criteria-api
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: hibernate-jpa"
  - "Baeldung tutorials (eugenp/tutorials) module: java-jpa-3"
  - "Hibernate ORM 7 — in.relation.to (https://in.relation.to/2025/05/20/hibernate-orm-seven/)"
related:
  - persistence/jpa-entity-mapping
  - persistence/jpa-locking-concurrency
  - persistence/spring-data-repositories
status: active
---

## Summary

**Concept**: The JPA query surface — JPQL string queries, native SQL, the type-safe Criteria API, named/stored-procedure queries, result-set mappings, and entity graphs.
**Key APIs**: `Query`/`TypedQuery`, `createNativeQuery(sql, Class)`, `@NamedQuery`/`@NamedNativeQuery`/`@NamedStoredProcedureQuery`, `CriteriaBuilder`→`CriteriaQuery`→`Root`/`Predicate`/`Subquery`, `SqlResultSetMapping`, `@NamedEntityGraph`/`createEntityGraph`.
**Gotcha**: `MultipleBagFetchException` — two eager `List` (bag) fetch-joins produce a Cartesian product Hibernate refuses; fix with bag+`Set`, `@OrderColumn`, split queries, or `passDistinctThrough`.
**2026-currency**: Hibernate 6 removed `org.hibernate.Criteria` (use JPA Criteria); Hibernate 7 adds a static-metamodel-driven type-safe query API (`SelectionSpecification`/`Restriction`/`Range`).
**Sources**: Baeldung `hibernate-jpa`, `java-jpa-3`; Hibernate ORM 7 release.

## Quick Reference

**JPQL / native**:

```java
TypedQuery<Foo> q = em.createQuery("SELECT f FROM Foo f WHERE f.name = :name", Foo.class);
q.setParameter("name", v);
List<Bar> bars = em.createNativeQuery("SELECT * FROM bar", Bar.class).getResultList();
```
Positional `?1` vs named `:name` params; `IN (:list)`.

**Named queries**: `@NamedQuery`/`@NamedNativeQuery`/`@NamedStoredProcedureQuery`.

**Criteria API** (type-safe, programmatic):
```java
CriteriaBuilder cb = em.getCriteriaBuilder();
CriteriaQuery<Emp> cq = cb.createQuery(Emp.class);
Root<Emp> r = cq.from(Emp.class);
cq.where(cb.equal(r.get("dept"), d));
```
`cb.and`/`cb.or`/`in`/`multiselect`/`tuple`/aggregates; `Subquery`; IN+subquery `cb.in(emp.get("department")).value(subquery)`.

**Stored procedures**: `@NamedStoredProcedureQuery` + `createNamedStoredProcedureQuery`/`registerStoredProcedureParameter`/`ParameterMode`.

**`SqlResultSetMapping`**: `@EntityResult`/`@FieldResult`/`@ConstructorResult`/`@ColumnResult` for native-query shaping.

**Entity graphs** (fetch control): `@NamedEntityGraph`/`@NamedAttributeNode`/`@NamedSubgraph` or programmatic `createEntityGraph`; applied as `jakarta.persistence.fetchgraph` (unlisted = LAZY) vs `loadgraph` (unlisted = mapped default); `@EntityGraph(value=…, type=FETCH)` on Spring Data repos.

**Joins (JPQL)**: implicit-path, explicit `JOIN`, theta, collection-valued, `LEFT JOIN`, `JOIN FETCH`, `LEFT JOIN FETCH`.

**Top gotchas**:
- `MultipleBagFetchException`: two eager `List` fetch-joins → Cartesian; fix bag+`Set` / `@OrderColumn` / split / `passDistinctThrough`.
- Bulk JPQL `delete`/`update` (and `CriteriaUpdate`/`CriteriaDelete`) bypass the persistence context — managed entities go stale; `@SQLDelete` is bypassed by JPQL `delete`.

**Current (mid-2026)**: `org.hibernate.Criteria`/`Projections`/`ScrollableResults` were removed in Hibernate 6 (use JPA Criteria); `SQLQuery`→`NativeQuery`, `createSQLQuery`→`createNativeQuery`. The fetch-graph hint keys are `jakarta.persistence.*` now. Hibernate 7 adds type-safe `SelectionSpecification`/`Restriction`/`Range` as a typed alternative to string JPQL and the verbose Criteria API.

## Full content

JPA offers three query styles — string JPQL, native SQL, and the programmatic Criteria API — plus named queries, stored-procedure calls, result-set mappings, and entity graphs for fetch tuning. The corpus covers them across `hibernate-jpa` and `java-jpa`(-2/-3).

### JPQL and native queries

`Query`/`TypedQuery` execute JPQL (entity-oriented, portable); `createNativeQuery(sql, Class)` runs raw SQL. Parameters are positional (`?1`) or named (`:name`); `@NamedQuery`/`@NamedNativeQuery` pre-register them on entities.

### Criteria API

The Criteria API builds queries programmatically and type-safely: `CriteriaBuilder` → `CriteriaQuery` → `Root`, with `Predicate`s composed via `cb.and`/`cb.or`/`in`, `multiselect`/`tuple` projections, aggregates, and `Subquery`. It is verbose but compile-checked and dynamically composable — the corpus's `EmployeeSearchServiceImpl` shows IN + subquery.

### Result-set mapping and stored procedures

`SqlResultSetMapping` (`@EntityResult`/`@FieldResult`/`@ConstructorResult`/`@ColumnResult`) maps a native query's columns onto entities or DTOs. Stored procedures are called via `@NamedStoredProcedureQuery` + `registerStoredProcedureParameter`/`ParameterMode`.

### Entity graphs (fetch tuning)

Entity graphs declaratively control which associations load eagerly. A `fetchgraph` hint treats unlisted attributes as LAZY; a `loadgraph` hint uses the mapped default. They are the structured fix for the N+1 problem and for `LazyInitializationException`.

### The MultipleBagFetchException trap

Two eager `List` (bag) fetch-joins in one query produce a Cartesian product Hibernate refuses with `MultipleBagFetchException`. The fixes are: change one collection to a `Set` (bag+`Set`), add `@OrderColumn` to make it a list, split into multiple queries, or use `passDistinctThrough`.

### Bulk-operation staleness

JPQL bulk `update`/`delete`, `CriteriaUpdate`/`CriteriaDelete`, and `@Modifying` repository writes bypass the persistence context — managed entities go stale. `@SQLDelete` (soft-delete) is also bypassed by a JPQL `delete`.

### 2026 currency

- **Legacy Hibernate query APIs removed in 6.** `org.hibernate.Criteria`, `Projections`, and `ScrollableResults` were removed — use the JPA Criteria API. `SQLQuery`→`NativeQuery`, `createSQLQuery`→`createNativeQuery`; `ResultTransformer`/`Transformers.aliasToBean` deprecated. SQL alias generation changed, breaking hard-coded alias-string assertions. [Hibernate 7 — in.relation.to](https://in.relation.to/2025/05/20/hibernate-orm-seven/)
- **Entity-graph hint keys moved** to `jakarta.persistence.fetchgraph` / `jakarta.persistence.loadgraph` with the namespace rename.
- **Hibernate 7 type-safe queries.** Static-metamodel-driven `SelectionSpecification`/`Restriction`/`Range` provide a typed alternative to string JPQL and the verbose Criteria API. [Hibernate 7 — in.relation.to](https://in.relation.to/2025/05/20/hibernate-orm-seven/)
- **The JPQL / Criteria / entity-graph concepts carry forward unchanged** — the query model is durable; only the deprecated Hibernate-native helpers and the hint namespace moved.
