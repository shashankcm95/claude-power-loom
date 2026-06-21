---
kb_id: bigdata-ml-cloud/apache-olingo-odata
version: 1
tags:
  - bigdata-ml-cloud
  - apache-olingo
  - odata
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: apache-olingo"
  - "Spring Boot versions/EOL (herodevs.com/blog-posts/spring-boot-versions-eol-dates-and-latest-releases-april-2026)"
related:
  - bigdata-ml-cloud/cloud-storage-clients
status: active
---

## Summary

**Concept**: Apache Olingo (OData v2) exposes a metadata-driven, RESTful data-access protocol whose EDM is auto-generated from JPA annotations — wire-level query options (`$filter`, `$top`, `$expand`) come for free.
**Key APIs**: `olingo-odata2-jpa-processor`, a `ODataJPAServiceFactory` subclass with `setContainerManaged(true)`, an EM-per-request JAX-RS filter; served through Jersey inside Spring Boot over JPA/Hibernate + H2.
**Gotcha**: JPA entities hand-roll `equals`/`hashCode` over a lazy collection (recursive/lazy-collection anti-pattern); the only test is a bare `contextLoads()` smoke test.
**2026-currency**: OData v2 is legacy (OData v4 is current); the whole stack rests on `javax.*` JPA/JAX-RS, which won't compile on Spring Boot 3+/Jakarta EE 9.
**Sources**: Baeldung `apache-olingo` module; Spring Boot EOL reference.

## Quick Reference

**What OData is**: a RESTful, metadata-driven data-access protocol. The Entity Data Model (EDM) describes the schema; clients then query it with standard URL options.

**Auto-generation from JPA**: the `olingo-odata2-jpa-processor` derives the EDM directly from JPA-annotated entities — no hand-written model.

**Wiring** (OData v2 in Spring Boot):
- Subclass `ODataJPAServiceFactory`, call `setContainerManaged(true)`
- An entity-manager-per-request JAX-RS filter manages the JPA `EntityManager` lifecycle
- Exposed through JAX-RS (Jersey) inside Spring Boot, backed by JPA/Hibernate + H2

**Wire-level query options** (on the `/odata` endpoint):
- `$metadata` (the EDM document), `$format=json`
- `$top` / `$skip` (paging), `$count`
- `$filter` (`startswith(...)`, `eq`, `and`, navigation paths)
- `$expand` (eager-load relations), `$select` (projection), `$orderBy`

**Top gotchas**:
- Entities hand-roll `equals`/`hashCode` over a lazy collection — recursive / lazy-collection anti-pattern.
- The module's only test is a bare `contextLoads()` smoke test.

**Current (mid-2026)**: OData **v2** is legacy — **OData v4** is the current protocol version, and Olingo's v4 library is a different artifact. More fundamentally, the stack rests on `javax.persistence`/`javax.ws.rs` imports; Spring Boot 3.x+ requires the **Jakarta EE 9** namespace (`jakarta.*`), so this code won't compile unchanged on a current Spring Boot.

## Full content

Apache Olingo implements OData, a RESTful, metadata-driven protocol for data access. The Baeldung `apache-olingo` module uses the **OData v2** flavor and its headline trick: the Entity Data Model is auto-generated from JPA annotations via the `olingo-odata2-jpa-processor`, so annotating your domain entities is enough to expose a fully queryable OData service.

The integration is wired by subclassing `ODataJPAServiceFactory` (with `setContainerManaged(true)`) and adding an entity-manager-per-request JAX-RS filter to manage the JPA `EntityManager` lifecycle. The service is exposed through JAX-RS (Jersey) running inside Spring Boot, backed by JPA/Hibernate over an H2 database.

The payoff is the wire-level query language clients get for free: `$metadata` returns the EDM; `$top`/`$skip` page; `$count` totals; `$filter` supports predicates like `startswith(...)`, `eq`, `and`, and navigation-property paths; `$expand` eager-loads related entities; `$select` projects columns; `$orderBy` sorts; `$format=json` controls serialization. This is the protocol-driven-data-access counterpart to the imperative cloud-store CRUD in the sibling cloud-storage doc.

The corpus carries two smells: the JPA entities hand-roll `equals`/`hashCode` over a lazy collection (the classic recursive/lazy-collection JPA anti-pattern), and the module's test coverage is a single `contextLoads()` smoke test.

### 2026 currency

OData **v2** as used here is legacy; **OData v4** is the current protocol version, and Olingo ships a separate v4 library. The deeper blocker is the namespace migration: the whole stack depends on `javax.persistence` (JPA) and `javax.ws.rs` (JAX-RS) imports, and Spring Boot 3.x and later require the **Jakarta EE 9** `jakarta.*` namespace ([Spring Boot versions/EOL (HeroDevs, Apr 2026)](https://www.herodevs.com/blog-posts/spring-boot-versions-eol-dates-and-latest-releases-april-2026)). **Spring Boot 4.0.x** is the latest line (SB 3.4 OSS support ended Dec 31, 2025), and Hibernate ORM 7.x targets Jakarta Persistence 3.2 + a Java 17 baseline ([Hibernate ORM releases (hibernate.org)](https://hibernate.org/orm/releases/)) — so the corpus's Boot 1.5/2.x + `javax.*` imports won't compile on any current baseline without a `javax.*`→`jakarta.*` migration.
