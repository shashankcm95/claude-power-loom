---
kb_id: persistence/jpa-entity-mapping
version: 1
tags:
  - persistence
  - jpa
  - entity-mapping
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: java-jpa"
  - "Baeldung tutorials (eugenp/tutorials) module: hibernate-jpa"
  - "Hibernate ORM 7 — in.relation.to (https://in.relation.to/2025/05/20/hibernate-orm-seven/)"
related:
  - persistence/jpa-queries-criteria
  - persistence/jpa-locking-concurrency
  - persistence/hibernate-native
  - persistence/spring-data-repositories
status: active
---

## Summary

**Concept**: The JPA standard for mapping Java objects to relational tables — entities, identifiers, relationships, enums, converters, and inheritance (provider = Hibernate; EclipseLink also).
**Key APIs**: `@Entity`/`@Table`/`@Id`/`@GeneratedValue`/`@Column`/`@Embeddable`/`@EmbeddedId`/`@IdClass`/`@MapsId`, `@OneToMany`/`@ManyToOne`/`@ManyToMany`/`@OneToOne`/`@JoinColumn`/`@JoinTable`, `@Enumerated`, `AttributeConverter`/`@Convert`, inheritance strategies.
**Gotcha**: `@Enumerated(ORDINAL)` corrupts data on enum reorder; `STRING` breaks on rename — use an `AttributeConverter` with a stable DB code.
**2026-currency**: `javax.persistence.*` → `jakarta.persistence.*` (Jakarta EE 9+, mandatory on Hibernate 6/7 + Spring 6/Boot 3); Hibernate 7 native JSON (`@JdbcTypeCode(SqlTypes.JSON)`) and array support reduce converter need.
**Sources**: Baeldung `java-jpa`(-2/-3), `hibernate-jpa`; Hibernate ORM 7 release.

## Quick Reference

**Entity basics**: `@Entity` (logical name via `@Entity(name=…)` for JPQL) + `@Table(name=…)` (physical); `@Column`(length/nullable/unique), `@Transient`, `@Basic`(optional, fetch), `@Temporal`, `@Lob`.

**ID generation**: `@GeneratedValue(strategy = GenerationType.{AUTO,IDENTITY,SEQUENCE,TABLE})`; `@SequenceGenerator`/`@TableGenerator`. *When* the PK is set differs: IDENTITY is null until flush; SEQUENCE/TABLE pre-allocate at `persist`.

**Composite keys**: `@IdClass` vs `@EmbeddedId` + `@Embeddable` (must `implements Serializable` + `equals`/`hashCode`). Derived id: `@MapsId`.

**Relationships**:
- `@OneToMany(mappedBy=…)` / `@ManyToOne` — owning side = the FK side.
- `@ManyToMany` + `@JoinTable`.
- `@OneToOne` in 3 strategies: FK `@JoinColumn`, shared-PK `@PrimaryKeyJoinColumn`, join-table.
- M:N-with-payload → model the join as an entity with `@EmbeddedId` + two `@MapsId @ManyToOne`.

**Enum persistence** (preferred):

```java
@Converter(autoApply = true)
class CategoryConverter implements AttributeConverter<Category, String> { … }
```

**Inheritance**: `SINGLE_TABLE` (+`@DiscriminatorColumn`/`@DiscriminatorValue`), `JOINED` (+`@PrimaryKeyJoinColumn`), `TABLE_PER_CLASS`, `@MappedSuperclass`.

**Top gotchas**:
- `@Enumerated(ORDINAL)` corrupts on reorder; `STRING` breaks on rename — use `AttributeConverter`.
- `@Column(length)`/`@Column(nullable)` are **DDL-only**; they do NOT trigger runtime validation (only Bean Validation `@Size`/`@NotNull` fails at flush).
- Entity equality: `@Id`-based equals is unstable pre-persist — prefer a business key.
- `CascadeType.REMOVE` vs `orphanRemoval` differ in semantics.

**Current (mid-2026)**: all annotations moved from `javax.persistence.*` to `jakarta.persistence.*` (mandatory on Hibernate 6/7, Spring 6 / Boot 3+). Hibernate 7's native `@JdbcTypeCode(SqlTypes.JSON)` / `SqlTypes.ARRAY` make many custom converters unnecessary.

## Full content

JPA is the standard object-relational mapping API; Hibernate is the dominant provider (the corpus also has one EclipseLink module). Mapping is taught end-to-end across `java-jpa`(-2/-3) and `hibernate-jpa`.

### Entities and identifiers

`@Entity` marks a mapped class; `@Id` + `@GeneratedValue` declares its key. The four generation strategies (`AUTO`, `IDENTITY`, `SEQUENCE`, `TABLE`) differ in *when* the PK becomes available — a subtle but load-bearing point for batch inserts (IDENTITY disables JDBC batching; SEQUENCE pre-allocates). Composite keys use `@IdClass` or `@EmbeddedId` + `@Embeddable`, the latter requiring `Serializable` plus correct `equals`/`hashCode`. `@MapsId` derives a child's id from its parent.

### Relationships

The owning side of an association is the FK holder. `@OneToMany(mappedBy)`/`@ManyToOne` model the common one-to-many; `@ManyToMany` + `@JoinTable` the many-to-many; `@OneToOne` has three strategies (FK, shared-PK, join-table). A many-to-many carrying its own attributes is modeled as an explicit join entity with `@EmbeddedId` + two `@MapsId @ManyToOne` — the standard "association with payload" pattern.

### Enums and converters

Persisting enums via `@Enumerated(ORDINAL)` is fragile (reorder corrupts existing rows) and `STRING` breaks on rename; the recommended path is an `AttributeConverter` (`@Convert`/`@Converter(autoApply=true)`) that maps the enum to an explicit, stable DB code. `AttributeConverter` generalizes to any custom Java type → one column (PersonName→String, LocalDate↔`java.sql.Date`, Map→JSON).

### Inheritance

Four Hibernate-mapping strategies: `SINGLE_TABLE` (one table + discriminator column), `JOINED` (table per class joined on PK), `TABLE_PER_CLASS`, and `@MappedSuperclass` (shared mapping without a shared table).

### Validation boundary

A critical gotcha: `@Column(length)`/`@Column(nullable)` only affect generated DDL — they do not validate at runtime. Only Bean Validation (`@Size`/`@Length`/`@NotNull`) fails at flush with a `ConstraintViolationException` before the DB rejects the write.

### 2026 currency

- **`javax.persistence.*` → `jakarta.persistence.*` is the floor.** Jakarta EE 9+ (2020) renamed the namespace; Hibernate 6/7 and Spring 6 / Boot 3+ require `jakarta.*` — 2021 entity code does not compile unchanged. Property hint keys moved too (`jakarta.persistence.fetchgraph`). Hibernate ORM 7.0.0.Final (2025-05-19/20) fully implements Jakarta Persistence 3.2 / Jakarta EE 11. [Hibernate 7 — in.relation.to](https://in.relation.to/2025/05/20/hibernate-orm-seven/) · [Spring Framework 7.0 GA — spring.io](https://spring.io/blog/2025/11/13/spring-framework-7-0-general-availability/)
- **Native type support reduces third-party need.** `@JdbcTypeCode(SqlTypes.JSON)` (auto-detects a JSON lib) and `SqlTypes.ARRAY` are first-class in Hibernate 6/7, so many `AttributeConverter`s and the old `hibernate-types-52` library are now obsolete. [Postgres JSON with Hibernate 6 — dzone.com](https://dzone.com/articles/postgres-json-functions-with-hibernate-6)
- **The mapping concepts carry forward unchanged** — entities, ids, relationships, converters, inheritance are durable; only the namespace and library spellings moved.
