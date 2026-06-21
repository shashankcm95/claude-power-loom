---
kb_id: persistence/spring-data-repositories
version: 1
tags:
  - persistence
  - spring-data
  - repository
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-data-jpa-query"
  - "Baeldung tutorials (eugenp/tutorials) module: spring-data-jpa-enterprise"
  - "Jakarta Data 1.0 — jakarta.ee (https://jakarta.ee/specifications/data/1.0/jakarta-data-1.0)"
related:
  - persistence/jpa-entity-mapping
  - persistence/jpa-queries-criteria
  - persistence/jdbc-fundamentals
  - persistence/hibernate-native
  - persistence/spring-data-nosql
  - persistence/transactions
  - persistence/alternative-orms
  - persistence/schema-migration
status: active
---

## Summary

**Concept**: The Spring Data repository abstraction — one programming model (derived queries, `@Query`, projections, pagination, auditing, custom fragments) over many backends; only annotations and the engine change per store.
**Key APIs**: `CrudRepository`/`PagingAndSortingRepository`/`JpaRepository`, derived query DSL (`findBy…`), `@Query`/`@Modifying`, `Pageable`/`PageRequest`/`Sort`/`Page<T>`, projections (closed/open/DTO/dynamic), `<Repo>Custom`+`<Repo>Impl`, `@EntityGraph`, auditing (`@CreatedDate`/`@EnableJpaAuditing`/`AuditorAware`).
**Gotcha**: Spring Data JDBC/Geode/Redis/Mongo use `org.springframework.data.annotation.Id`, NOT `javax.persistence.Id` — wrong `@Id` silently breaks mapping.
**2026-currency**: Spring Data 1.x→2.x idioms long-settled (`findById:Optional`, `PageRequest.of`, `getReferenceById`); Jakarta Data 1.0 is a standardized vendor-neutral analogue; Spring Data R2DBC adds reactive SQL.
**Sources**: Baeldung `spring-data-jpa-*`, `spring-jpa`; Jakarta Data 1.0 spec.

## Quick Reference

**Repository hierarchy**: `CrudRepository` → `PagingAndSortingRepository` → `JpaRepository` (or store-specific `*Repository`). Declare an interface; Spring supplies the implementation.

**Derived query DSL** (method-name → query):
`findBy`/`Is`/`Equals`/`Not`/`StartingWith`/`Containing`/`Like`/`LessThan`/`GreaterThan`/`Between`/`After`/`In`/`IgnoreCase`/`And`/`Or`/`OrderBy…Asc/Desc`/`findFirst`/`findTop`/`existsBy`/`deleteBy`/`countBy`; nested-property `findByAddress_City`.

**`@Query`**:
```java
@Query("SELECT u FROM User u WHERE u.status = ?1")
@Modifying(clearAutomatically = true, flushAutomatically = true) // for writes
```
`nativeQuery=true` needs an explicit `countQuery` for paging; Spring Data JDBC `@Query` takes raw SQL in a *different package*.

**Pagination**: `Pageable`/`PageRequest.of(page, size)`/`Sort`/`JpaSort.unsafe("LENGTH(name)")`/`Page<T>`.

**`save()` semantics**: upsert (insert when id null, merge when set); `saveAndFlush`; `saveAll` batches.

**Projections**: closed interface (fewer columns), open interface (`@Value` SpEL — loads full entity), class-based DTO, dynamic (`<T> T findByLastName(String, Class<T>)`), constructor-expression JPQL.

**Custom fragments**: `<Repo>Custom` interface + `<Repo>Impl` (the `*Impl` suffix is **load-bearing**).

**Auditing**: `@CreatedDate`/`@LastModifiedDate`/`@CreatedBy`/`@LastModifiedBy` + `AuditingEntityListener` + `AuditorAware` + `@EnableJpaAuditing`. Hibernate Envers (`@Audited`) for full history.

**Top gotchas**:
- Wrong `@Id` package: Spring Data JDBC/Geode/Redis/Mongo use `org.springframework.data.annotation.Id`, NOT `javax.persistence.Id`.
- `*Impl` fragment naming is load-bearing — wrong name/package → not wired.
- Interface-projection aggregation requires SELECT aliases to exactly match getter names.
- `@CreatedDate`/`@CreatedBy` are inert without `@EnableJpaAuditing` + `AuditorAware` (a recurring "dead annotation").
- Native paginated `@Query` needs an explicit `countQuery`.
- Batch inserts: `hibernate.jdbc.batch_size` + periodic `flush()`/`clear()`; **IDENTITY id strategy disables batching — use SEQUENCE**.

**Current (mid-2026)**: the Spring Data 1.x→2.x idiom shifts (`findOne`→`findById:Optional`, `new PageRequest()`→`PageRequest.of()`, `getOne()`→`getReferenceById()`) are long-settled. The repository programming model carries forward unchanged; Jakarta Data 1.0 (Jakarta EE 11) standardizes it vendor-neutrally; Spring Data R2DBC adds reactive relational repositories.

## Full content

Spring Data's thesis — proven across ~20 corpus modules — is that one programming model serves wildly different backends. You declare a repository interface; Spring generates the implementation. The corpus exercises the JPA variant most heavily (`spring-data-jpa-*`, `spring-jpa`).

### Derived queries and `@Query`

Method names parse into queries via a rich DSL (`findByNameAndActiveTrueOrderByCreatedDesc`). When the DSL is insufficient, `@Query` supplies JPQL (or `nativeQuery=true` raw SQL); `@Modifying` marks writes (returns affected-row count, needs a transaction, and `clearAutomatically`/`flushAutomatically` avoid stale managed entities). Native paginated queries require an explicit `countQuery` because Spring cannot auto-derive the count.

### Projections

Four projection styles trade off column-narrowing vs flexibility: closed interface (selects only declared getters — fewer columns), open interface (`@Value` SpEL — defeats narrowing, loads the full entity), class-based DTO, and dynamic (`Class<T>` parameter). Interface-projection aggregation requires SELECT aliases to match getter names exactly or yields silent nulls.

### Custom fragments and base repositories

A repository can mix derived methods with hand-written logic via a `<Repo>Custom` interface + `<Repo>Impl` class (the `*Impl` suffix and package are load-bearing for wiring). Multiple fragments compose. An app-wide base via `@EnableJpaRepositories(repositoryBaseClass=…)` extends `SimpleJpaRepository` (broad blast radius vs per-repo fragments).

### Auditing and lifecycle

Spring Data auditing (`@CreatedDate`/`@LastModifiedBy` + `@EnableJpaAuditing` + `AuditorAware`) stamps create/modify metadata — but is inert without the enabling annotation. Hibernate Envers (`@Audited`) keeps a full revision history. Lifecycle callbacks (`@PrePersist`/`@EntityListeners`) and domain events (`@DomainEvents`/`AbstractAggregateRoot.registerEvent`) integrate DDD patterns.

### Enterprise plumbing

Multiple datasources use one config class per DS with `@Primary` and per-package `@EnableJpaRepositories(entityManagerFactoryRef/transactionManagerRef)`. `AbstractRoutingDataSource` picks a DS per call via a ThreadLocal context holder. Batch inserts loop `em.persist` + periodic `flush()`/`clear()` — and critically, IDENTITY id strategy silently disables JDBC batching, so SEQUENCE is required.

### Spring Data JDBC (no-ORM variant)

Spring Data JDBC has no lazy loading, dirty checking, persistence context, or proxies — every save/load is explicit SQL, aggregate-root driven, with id 0/null meaning "new". It uses `org.springframework.data.annotation.Id` (not the JPA `@Id`).

### 2026 currency

- **Spring Data 1.x→2.x idioms are long-settled.** `findOne(ID)`→`findById(ID):Optional`, `new PageRequest(...)`→`PageRequest.of(...)`, `getOne()`→`getReferenceById()` persist through current Spring Data. [Spring Data R2DBC / Relational — spring.io](https://spring.io/projects/spring-data-r2dbc/)
- **Jakarta Data 1.0 (Jakarta EE 11) standardizes the pattern.** `@Repository` + `@Find`/`@Query` (JDQL) + lifecycle `@Insert`/`@Update`/`@Save`/`@Delete`, implemented by Hibernate Data Repositories (Hibernate 7) and consumable from Spring — a vendor-neutral analogue. [Jakarta Data 1.0 — jakarta.ee](https://jakarta.ee/specifications/data/1.0/jakarta-data-1.0) · [Hibernate Data Repositories — docs.hibernate.org](https://docs.hibernate.org/orm/7.0/repositories/html_single/)
- **Spring Data R2DBC** merged into Spring Data Relational (3.0+) adds reactive, non-blocking relational repositories (`Mono`/`Flux`, `DatabaseClient`) — the reactive-SQL story the 2021 corpus lacked. [Spring Data R2DBC — spring.io](https://spring.io/projects/spring-data-r2dbc/)
- **`JdbcClient` (Spring 6.1+)** is the modern fluent wrapper over `JdbcTemplate`/`NamedParameterJdbcTemplate` for non-repository SQL (see [persistence/jdbc-fundamentals](jdbc-fundamentals.md)). [Spring Framework 7.0 GA — spring.io](https://spring.io/blog/2025/11/13/spring-framework-7-0-general-availability/)
- **GraalVM native image** (Boot 3+) needs reflection/proxy hints for ORM-heavy data layers; Spring Boot's native-image reference has a dedicated Spring Data JPA section. [Spring Boot native-image — docs.spring.io](https://docs.spring.io/spring-boot/reference/packaging/native-image/introducing-graalvm-native-images.html)
- **The repository abstraction carries forward unchanged** — derived queries, `@Query`/`@Modifying`, projections, pagination, QBE, auditing are durable; only namespace and library versions moved.
