---
kb_id: persistence/hibernate-native
version: 1
tags:
  - persistence
  - hibernate
  - orm
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: hibernate5"
  - "Baeldung tutorials (eugenp/tutorials) module: hibernate-annotations"
  - "Hibernate ORM 7 — in.relation.to (https://in.relation.to/2025/05/20/hibernate-orm-seven/)"
related:
  - persistence/jpa-entity-mapping
  - persistence/jpa-locking-concurrency
  - persistence/caching-data-grid
  - persistence/spring-data-repositories
status: active
---

## Summary

**Concept**: Hibernate's provider-native APIs beyond the JPA standard — the `Session` lifecycle, custom types, dynamic mapping annotations, interceptors, multitenancy, the second-level cache, and Hibernate Search.
**Key APIs**: `Session`/`SessionFactory` (`save`/`persist`/`get`/`load`/`merge`/`saveOrUpdate`/`flush`), `UserType`/`@Type`/`@TypeDef`, `@Formula`/`@Where`/`@Filter`/`@Fetch`/`@LazyCollection`, `@Immutable`/`@DynamicUpdate`/`@SQLDelete`, `Interceptor`, `MultiTenantConnectionProvider`.
**Gotcha**: `load()` returns a proxy throwing `ObjectNotFoundException` on access (vs `get()`→null); `merge` on a detached entity returns a *different* managed instance.
**2026-currency**: Hibernate 7 removed `saveOrUpdate` and `EmptyInterceptor` (the legacy `org.hibernate.Criteria` API was already removed in 6.0); the `UserType`/`CompositeUserType` SPI was reworked; native `@SoftDelete` (6.4+) replaces the `@SQLDelete`+`@Where` trio.
**Sources**: Baeldung `hibernate5`, `hibernate-annotations`, `hibernate-enterprise`, `hibernate-mapping`; Hibernate ORM 7 release.

## Quick Reference

**Session lifecycle**: `save`/`persist`/`get`/`load`/`evict`/`update`/`merge`/`saveOrUpdate`/`delete`/`flush`/`refresh`; entity states transient → persistent → detached → removed; dirty checking on flush.

**Key semantic differences**:
- `get()` → `null` if absent; `load()` → a proxy throwing `ObjectNotFoundException` on access.
- `merge` on a detached entity returns a *different* managed instance (`assertNotSame`).
- `persist` is `void`; `save` returns the generated id.

**Bootstrap (Hibernate 5)**: `BootstrapServiceRegistryBuilder` → `StandardServiceRegistryBuilder` → `MetadataSources` → `Metadata` → `SessionFactory` (or `Configuration` + `addAnnotatedClass`).

**Custom types**: `UserType`/`CompositeUserType` + `@Type`/`@TypeDef`/`@Parameter` (multi-column phone, salary-with-currency). The Hibernate Types library (`hibernate-types-52`, Vlad Mihalcea) added JSON columns (`JsonStringType`/`JsonBinaryType`), `StringArrayType`.

**Dynamic mapping**: `@Formula` (computed read-only column), `@Where`/`@WhereJoinTable` (filter), `@Filter`/`@FilterDef`/`@ParamDef` (per-`Session`), `@Fetch(FetchMode.SELECT/JOIN/SUBSELECT)`, `@LazyCollection(EXTRA)`.

**Behavior annotations**: `@Immutable`, `@DynamicUpdate` (UPDATE only changed columns), soft delete (`@SQLDelete` + `@Where`/`@Filter`).

**Cross-cutting**: `Interceptor`/`EmptyInterceptor` (`onSave`/`onFlushDirty`); multitenancy (`MultiTenantConnectionProvider` + `CurrentTenantIdentifierResolver`); Hibernate Spatial (JTS geometry); Hibernate Search (Lucene `@Indexed`/`@Field`).

**Top gotchas**:
- `load()`/`get()` confusion (proxy-throws vs null).
- `merge` returns a new instance — keep the return value, don't reuse the detached one.
- Naming strategies: Spring's `SpringPhysicalNamingStrategy` (camelCase→snake_case) differs from the legacy JPA-impl default.

**Current (mid-2026)**: Hibernate ORM 7.0 (GA 2025-05) removed `saveOrUpdate()`-style reassociation (only `merge()` + `StatelessSession` remain) and `EmptyInterceptor` (use `Interceptor` default methods); the legacy `org.hibernate.Criteria` API was already removed in 6.0. The `UserType`/`CompositeUserType` SPI + type descriptors were renamed/reworked. Native `@SoftDelete` (6.4+) and `@JdbcTypeCode(SqlTypes.JSON)` make the `hibernate-types-52` library and the `@SQLDelete`+`@Where` soft-delete trio largely obsolete.

## Full content

Beyond the JPA standard, Hibernate exposes a richer provider-native surface. The corpus covers it across `hibernate5`, `hibernate-annotations`, `hibernate-enterprise`, `hibernate-mapping`, `hibernate-libraries`, and `spring-hibernate-5`.

### Session lifecycle

`Session`/`SessionFactory` is Hibernate's unit of work. Entities move through transient → persistent → detached → removed, with dirty checking applied at flush. The load-bearing semantic distinctions: `get()` returns null for a missing row while `load()` returns a proxy that throws `ObjectNotFoundException` on first access; `merge` on a detached entity returns a *new* managed instance (not the argument); `persist` is void while `save` returns the generated id.

### Custom types and dynamic mapping

`UserType`/`CompositeUserType` (with `@Type`/`@TypeDef`) map arbitrary Java types across one or more columns (`nullSafeGet`/`nullSafeSet`/`isMutable`/`deepCopy`). Dynamic-mapping annotations include `@Formula` (computed read-only column), `@Where`/`@Filter` (row filtering, the latter enabled per-`Session`), `@Fetch` (fetch-mode selection), and `@LazyCollection(EXTRA)`. Behavior annotations `@Immutable` and `@DynamicUpdate` (UPDATE only changed columns) tune write semantics; soft delete combines `@SQLDelete` + `@Where`/`@Filter`.

### Interceptors, multitenancy, search

`Interceptor`/`EmptyInterceptor` hook `onSave`/`onFlushDirty` at session or factory scope. Multitenancy (DATABASE vs SCHEMA) wires a `MultiTenantConnectionProvider` + `CurrentTenantIdentifierResolver`. Hibernate Search indexes entities into Lucene (`@Indexed`/`@Field`, `FullTextEntityManager` + `QueryBuilder` DSL). The second-level cache (`@Cacheable` + `@Cache(usage=READ_WRITE)`, query cache) is covered under [persistence/caching-data-grid](caching-data-grid.md).

### Exception catalog

Hibernate surfaces a rich exception set: `MappingException`, `SQLGrammarException`, `ConstraintViolationException`, `StaleStateException`, `NonUniqueObjectException`, `OptimisticLockException`, `QueryException` (unset named param), and `LazyInitializationException`.

### Teaching bugs (do not copy)

`SalaryType.setPropertyValue` switch falls through (always throws); the Couchbase `equals` compares only `hashCode()` — realistic bugs left in the corpus.

### 2026 currency

- **Hibernate ORM 7.0 (GA 2025-05-19/20) — first Apache-licensed major, first to fully support Jakarta EE 11.** It removed `saveOrUpdate()`-style detached-entity reassociation (only `merge()` and `StatelessSession` remain) and removed `EmptyInterceptor` (use `Interceptor` default methods). (The legacy `org.hibernate.Criteria`/`Projections` API had already been removed back in Hibernate 6.0; `ScrollableResults` is *not* removed — it remains in 7.x.) [Hibernate 7 — in.relation.to](https://in.relation.to/2025/05/20/hibernate-orm-seven/)
- **`UserType`/`CompositeUserType` SPI reworked** in Hibernate 6 — type descriptors (`VarcharTypeDescriptor`, etc.) renamed/removed; custom-type code needs porting.
- **Native features replace third-party libs.** `@SoftDelete` (Hibernate 6.4+) supersedes the `@SQLDelete`+`@Where`+`@Loader` trio; `@JdbcTypeCode(SqlTypes.JSON)` + `SqlTypes.ARRAY` supersede `hibernate-types-52` (which moved to `hypersistence-utils`). Hibernate Search 5 (`FullTextEntityManager`) was fully rewritten in Search 6 (`SearchSession`, `@FullTextField`). [Hibernate @SoftDelete — vladmihalcea.com](https://vladmihalcea.com/hibernate-softdelete-annotation/) · [Hibernate 7 — in.relation.to](https://in.relation.to/2025/05/20/hibernate-orm-seven/)
- **Enhanced `StatelessSession`** in Hibernate 7 now supports the 2nd-level cache and better batching.
