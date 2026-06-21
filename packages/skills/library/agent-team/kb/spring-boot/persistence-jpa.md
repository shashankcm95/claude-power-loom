---
kb_id: spring-boot/persistence-jpa
version: 1
tags:
  - spring-boot
  - persistence
  - spring-data-jpa
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-boot-crud"
  - "Baeldung tutorials (eugenp/tutorials) module: spring-boot-data"
  - "Hibernate ORM releases (endoflife.date/hibernate)"
related:
  - spring-boot/testing
  - spring-boot/web-rest-controllers
  - spring-boot/auto-configuration
status: active
---

## Summary

**Concept**: How Boot wires Spring Data JPA — repository interfaces, derived queries, entity mapping, and DTO conversion — the persistence on-ramp Boot auto-configures.
**Key APIs**: `CrudRepository`/`JpaRepository`/`PagingAndSortingRepository`/`Repository<T,ID>` + `@NoRepositoryBean`, derived queries (`findByName`), `findById(...).orElseThrow(...)`, `@Entity`/`@Id`/`@GeneratedValue`/`@Column`/`@EmbeddedId`, `spring-boot-starter-data-jpa`.
**Gotcha**: Boot auto-wires the `DataSource`/HikariCP/`EntityManager` from the starter — exclude `DataSourceAutoConfiguration` to opt out.
**2026-currency**: `javax.persistence` → `jakarta.persistence` (Boot 3); Hibernate ORM 7.0 GA (Jakarta Persistence 3.2); `JdbcClient` joins `JdbcTemplate`.
**Sources**: Baeldung `spring-boot-crud` / `-data`; Hibernate ORM releases.

## Quick Reference

**Repository hierarchy**: declare an interface extending `JpaRepository<Entity, Id>` (or `CrudRepository`, `PagingAndSortingRepository`); Boot supplies the implementation. `Repository<T,ID>` is the empty root; `@NoRepositoryBean` marks an intermediate read-only/shared base that should not itself become a bean.

```java
public interface FooRepository extends JpaRepository<Foo, Long> {
    Optional<Foo> findByName(String name);   // derived query
}
// usage
Foo f = repo.findById(id).orElseThrow(() -> new NotFoundException(id));
```

**Derived queries**: method names parse into queries (`findByNameAndActiveTrue`, `findByAgeGreaterThan`).

**Entity mapping**: `@Entity`, `@Id`, `@GeneratedValue`, `@Column`, `@EmbeddedId`. In-memory H2/HSQLDB for demos and tests.

**Auto-config**: `spring-boot-starter-data-jpa` auto-wires the `DataSource` (HikariCP pool), the `EntityManagerFactory`, a `JpaTransactionManager`, and Spring Data repository scanning. Opt out via `exclude = DataSourceAutoConfiguration.class`.

**DTO conversion**: ModelMapper (or MapStruct) for entity↔DTO; JaVers for entity auditing.

**Top gotchas**:
- A repo whose ID type mismatches the entity's `@Id` fails at startup.
- `@DataJpaTest` needs a discoverable `@SpringBootConfiguration` above the test package (see [spring-boot/testing](testing.md)).
- A corpus teaching bug: `spring-boot-react` `updateClient` saves the incoming entity, discarding its own mutations.

**Current (mid-2026)**: entity/repository annotations moved to `jakarta.persistence.*` in Boot 3. Hibernate ORM 7.0.0.Final (GA 2025-05-20; 7.4.x current) implements Jakarta Persistence 3.2. The fluent `JdbcClient` (Boot 3.2 / Spring 6.1) joins `JdbcTemplate`/`NamedParameterJdbcTemplate` for non-JPA SQL.

## Full content

Spring Boot does not teach persistence depth itself — it *wires* Spring Data JPA so the application code is just repository interfaces and entities. The corpus shows this assembly across `spring-boot-crud`, `-data`/`-2`, and the CRUD front-ends (`-angular`, `-react`).

### Repositories

The Spring Data repository abstraction lets you declare an interface and get a working implementation. `JpaRepository` adds JPA-specific operations on top of `PagingAndSortingRepository` and `CrudRepository`; `Repository<T,ID>` is the marker root. `@NoRepositoryBean` on a shared intermediate interface prevents Spring from trying to instantiate it as a concrete repository. Query methods are *derived* from method names (`findByName`), and `findById` returns an `Optional` that pairs with `orElseThrow` for the not-found path.

### Entities

JPA entity mapping uses the standard annotations (`@Entity`, `@Id`, `@GeneratedValue`, `@Column`, `@EmbeddedId`). Demos and tests run against in-memory H2/HSQLDB, which Boot auto-detects on the classpath.

### Auto-configuration of the persistence stack

Adding `spring-boot-starter-data-jpa` triggers auto-config of the `DataSource` (with HikariCP), the `EntityManagerFactory`, a transaction manager, and repository scanning — the developer supplies only connection properties. This is opt-out via `exclude = DataSourceAutoConfiguration.class` (the corpus demonstrates disabling it).

### Boundary conversion

Entity↔DTO mapping (ModelMapper in the corpus) keeps the persistence model out of the API contract, and JaVers provides entity-change auditing.

### 2026 currency

- **`javax.persistence` → `jakarta.persistence`.** All entity and persistence-context annotations moved to the `jakarta.*` namespace in Boot 3 / Spring 6; 2021 samples must migrate. [Spring Boot 4.0 Migration Guide](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide)
- **Hibernate ORM 7.0.** Hibernate ORM 7.0.0.Final reached GA on 2025-05-20 (the current line is 7.4.x as of mid-2026), implementing Jakarta Persistence 3.2 — the spec for Jakarta EE 11. [Hibernate ORM releases (endoflife.date)](https://endoflife.date/hibernate), [Jakarta Persistence 3.2 specification](https://jakarta.ee/specifications/persistence/3.2/)
- **`JdbcClient` joins the toolkit.** The fluent `JdbcClient` (Boot 3.2 / Spring 6.1) is the successor to `NamedParameterJdbcTemplate` for plain-SQL access alongside JPA. [Spring Boot 3.2.0 available now](https://spring.io/blog/2023/11/23/spring-boot-3-2-0-available-now/)
- **The repository abstraction and entity-mapping idioms carry forward unchanged** — only namespace and library versions move. [Spring Boot 4.0.0 available now](https://spring.io/blog/2025/11/20/spring-boot-4-0-0-available-now/)
