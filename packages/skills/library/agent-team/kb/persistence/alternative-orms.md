---
kb_id: persistence/alternative-orms
version: 1
tags:
  - persistence
  - orm
  - sql-mapper
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-jooq"
  - "Baeldung tutorials (eugenp/tutorials) module: spring-mybatis"
  - "OpenFeign/querydsl releases — github.com (https://github.com/OpenFeign/querydsl/releases)"
related:
  - persistence/jdbc-fundamentals
  - persistence/spring-data-repositories
  - persistence/transactions
status: active
---

## Summary

**Concept**: Non-JPA data-access libraries — type-safe SQL DSLs (jOOQ, Querydsl), SQL-mappers (MyBatis), JDBC-convenience layers (Jdbi, sql2o), and niche ORMs taught as "not-Hibernate" alternatives.
**Key APIs**: jOOQ `DSLContext`/`select().from().join().where().fetch()`; MyBatis `@Mapper`/`@Select`/`@Results`/`@One`/`@Many`; Jdbi `Handle`/`withHandle`/SqlObject `@SqlUpdate`/`@SqlQuery`; Querydsl APT-generated `Q`-types + `JPAQuery`; sql2o `executeAndFetch`.
**Gotcha**: Codegen/instrumentation modules (jOOQ tables, Querydsl `Q`-types, ActiveJDBC bytecode, Reladomo finders) will not compile from source alone — they are build-time generated.
**2026-currency**: original Querydsl is dead (last release July 2021) → OpenFeign fork (`io.github.openfeign.querydsl` 7.x); MyBatis 3.5.x alive; Jdbi maintained; sql2o → Spring Data JDBC / `JdbcClient` / jOOQ.
**Sources**: Baeldung `jooq`/`spring-jooq`, `mybatis`/`spring-mybatis`, `java-jdbi`, `querydsl`; OpenFeign Querydsl releases.

## Quick Reference

**jOOQ** (type-safe SQL DSL over code-generated table/record classes):
```java
DSL.using(conn, SQLDialect.H2)
   .select(AUTHOR.ID, DSL.count())
   .from(AUTHOR).join(AUTHOR_BOOK).on(AUTHOR.ID.eq(AUTHOR_BOOK.AUTHOR_ID))
   .groupBy(AUTHOR.ID).fetch();
```
`DSLContext`, `SQLDialect`, `UpdatableRecord.store()`, `fetchCount`; `TransactionAwareDataSourceProxy` to honor Spring tx; `spring-boot-starter-jooq`.

**MyBatis** (SQL-mapper — hand-written SQL bound to interfaces):
```java
@Mapper interface ArticleMapper {
  @Select("SELECT * FROM ARTICLES WHERE id=#{id}") Article get(@Param("id") Long id);
}
```
`@Insert`/`@Update`/`@Delete`, `#{param}`; `@Results`/`@Result`/`@One`/`@Many` (N+1 sub-select associations); `@Options(useGeneratedKeys)`; Spring via `@MapperScan` + `SqlSessionFactoryBean`.

**Jdbi 3** (SQL-convenience over JDBC): `jdbi.withHandle(h -> h.createQuery(sql).bind("name", v).mapTo(String.class).findFirst())`; SqlObject DAOs (`@SqlUpdate`/`@SqlQuery`/`@SqlBatch`/`@UseClasspathSqlLocator`).

**Querydsl** (APT-generated `Q`-types): `JPAQuery`/`JPAQueryFactory`, `where`/`join`/subqueries/`Tuple`/`GroupBy`; used across JPA/MongoDB/REST.

**sql2o** (thin JDBC POJO mapper): `executeAndFetch`/`executeScalar`/`executeAndFetchLazy`, `addColumnMapping`, `bind`, `addToBatch`.

**Niche/declining** (taught as alternatives): Apache Cayenne (XML model + codegen, `ObjectContext`), Jinq (JPA-as-Java-8-streams), Reladomo, ORMLite, JDO/DataNucleus, Ebean, ActiveJDBC, Apache DeltaSpike Data.

**Top gotchas**:
- Codegen modules won't compile from source alone (jOOQ tables, Querydsl/JNoSQL `Q`-types, JDO `QProductItem`, Reladomo finders, ActiveJDBC bytecode instrumentation, DeltaSpike `QMember`).
- Honor Spring transactions in jOOQ/Jdbi via `TransactionAwareDataSourceProxy`.
- ActiveJDBC untyped `set("first_name1", …)` typos silently write nonexistent columns (a corpus bug).

**Current (mid-2026)**: original Querydsl's last release was July 2021; the maintained successor is `io.github.openfeign.querydsl` (7.x — 7.0 2025-06, 7.2 2026-05), which Spring Data tracks. MyBatis (3.5.x), Jdbi, and jOOQ (codegen pattern durable, versions old) remain alive. sql2o is superseded by Spring Data JDBC / Spring 6.1 `JdbcClient` / jOOQ.

## Full content

Outside JPA there is a long tail of data-access libraries, each illustrating a different point on the abstraction spectrum: type-safe SQL DSLs, SQL-mappers, thin JDBC convenience layers, and alternative ORMs. The corpus teaches them as "an ORM/mapper that is not Hibernate."

### Type-safe SQL DSLs — jOOQ and Querydsl

jOOQ generates table/record classes from the live schema, then offers a fluent, compile-checked SQL DSL (`DSLContext.select().from().join().where().fetch()`). It honors Spring transactions through a `TransactionAwareDataSourceProxy`. Querydsl uses APT to generate `Q`-types and builds `JPAQuery`s — and is reused across JPA, MongoDB, and Spring Data REST.

### SQL-mapper — MyBatis

MyBatis binds hand-written SQL to `@Mapper` interface methods (`@Select`/`@Insert`/`@Update`/`@Delete`, `#{param}`), with `@Results`/`@One`/`@Many` for association mapping and `@Options(useGeneratedKeys)` for keys. Spring integrates it three ways: the Boot starter `@MapperScan`, a Java `SqlSessionFactoryBean`, or XML `MapperFactoryBean`.

### JDBC-convenience — Jdbi and sql2o

Jdbi 3 wraps JDBC ergonomically: a `Handle` (`withHandle`/`useHandle` auto-close), fluent `createQuery`/`createUpdate`, mappers (`mapTo`/`mapToMap`/`bindBean`), and SqlObject DAOs (`@SqlUpdate`/`@SqlQuery`). sql2o is a thin POJO mapper (`executeAndFetch`/`executeScalar`).

### Niche ORMs

Taught as alternatives, mostly declining: Apache Cayenne (XML model + generated superclass + `ObjectContext` unit of work), Jinq (JPA queries as Java-8 stream lambdas → JPQL), and a cluster of "not-JPA" ORMs — Reladomo (GS, bitemporal), ORMLite, JDO/DataNucleus, Ebean (active-record-ish), ActiveJDBC (Active Record, bytecode instrumentation), Apache DeltaSpike Data (the CDI/JEE analogue of Spring Data).

### Codegen caveat

Many of these depend on build-time code generation — jOOQ tables, Querydsl `Q`-types, JDO `QProductItem`, Reladomo finders (`reladomogen`), ActiveJDBC bytecode instrumentation, DeltaSpike's `QMember`. None of those generated classes live in the source tree, so the modules will not compile from source alone.

### 2026 currency

- **Querydsl moved to the OpenFeign fork.** The original project's last release was July 2021; the actively maintained successor is `io.github.openfeign.querydsl` (7.x line — 7.0 2025-06, 7.2 2026-05), which Spring Data has tracked. Coordinates also churned: `com.mysema.query.*` (3.x) → `com.querydsl.*` (4.x+), `.list()` → `.fetch()`, and the apt-maven-plugin → `querydsl-apt` with a `jakarta` classifier (5.x). [OpenFeign/querydsl releases — github.com](https://github.com/OpenFeign/querydsl/releases) · [Switch to OpenFeign fork — spring-data-jpa#3335](https://github.com/spring-projects/spring-data-jpa/issues/3335)
- **Still alive:** MyBatis (3.5.x), Jdbi (maintained), jOOQ (the codegen pattern is durable; the corpus version is old). Jdbi renamed `findOnly()` → `findOne()`/`one()`.
- **Superseded:** sql2o → Spring Data JDBC / Spring 6.1 `JdbcClient` / jOOQ; LinkRest → Agrest (`io.agrest`); JMapper → MapStruct; `hibernate-types-52` → `hypersistence-utils`. Reladomo, ORMLite (Android — Room is default), Ebean, JDO, ActiveJDBC, Apache DeltaSpike (Attic), Cayenne, Jinq are niche/declining, not 2026 defaults.
- **MapStruct** (compile-time DTO/bean mapping) remains a durable, recommended choice in this lane.
