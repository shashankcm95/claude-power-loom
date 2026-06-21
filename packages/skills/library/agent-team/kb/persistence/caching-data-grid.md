---
kb_id: persistence/caching-data-grid
version: 1
tags:
  - persistence
  - caching
  - data-grid
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: libraries-data"
  - "Baeldung tutorials (eugenp/tutorials) module: spring-hibernate-5"
  - "Hibernate ORM 7 — in.relation.to (https://in.relation.to/2025/05/20/hibernate-orm-seven/)"
related:
  - persistence/hibernate-native
  - persistence/spring-data-nosql
status: active
---

## Summary

**Concept**: Caching and in-memory data grids that sit beside or in front of the database — the JCache (JSR-107) standard, distributed grids (Infinispan, Apache Ignite, Hazelcast), and Hibernate's second-level cache.
**Key APIs**: JCache `Cache`/`CacheManager`/`Caching`/`CachingProvider` + `CacheLoader`/`EntryProcessor`/`CacheEntryListener`; Infinispan `ConfigurationBuilder`; Ignite `IgniteCache`+SQL; Hibernate `@Cacheable` + `@Cache(usage=READ_WRITE)`.
**Gotcha**: `javax.cache` (JCache) is one of the few `javax.*` namespaces that did NOT move to `jakarta.*`; Hibernate 2L cache + query cache must be explicitly enabled.
**2026-currency**: JCache `javax.cache` unchanged; EhCache 2 (`net.sf.ehcache`) → JCache/EhCache 3; Ignite/Infinispan/Hazelcast in the corpus are several majors behind.
**Sources**: Baeldung `libraries-data`/`-2`, `spring-hibernate-5`; Hibernate ORM 7 release.

## Quick Reference

**JCache (JSR-107)** — vendor-neutral caching API:
```java
CacheManager cm = Caching.getCachingProvider("com.hazelcast.cache.HazelcastCachingProvider")
                         .getCacheManager();
Cache<K,V> cache = cm.createCache(name, new MutableConfiguration<>());
cache.invoke(key, entryProcessor); // atomic in-place mutation
```
Extension points: `CacheLoader` (read-through), `EntryProcessor` (atomic in-place mutation), `CacheEntryListener`.

**Infinispan** — fluent `ConfigurationBuilder`: expiring (lifespan TTL), evicting (max-count), passivating (single-file store), transactional (JTA `TransactionManager` + pessimistic locking).
```java
.transaction().transactionMode(TRANSACTIONAL).lockingMode(PESSIMISTIC);
```

**Apache Ignite** — SQL-over-grid, JDBC thin driver, Spring Data `IgniteRepository`, `IgniteDataStreamer`.

**Hazelcast** — a JCache provider; also distributed maps/locks.

**Hibernate second-level cache**: `@Cacheable` + `@org.hibernate.annotations.Cache(usage=READ_WRITE)`; query cache via the `org.hibernate.cacheable` hint; EhCache region factory.

**Top gotchas**:
- `javax.cache` (JCache) and `javax.measure` did NOT move to `jakarta.*` — do not "fix" them in a migration.
- The Hibernate 2L cache + query cache are off until explicitly enabled (annotation + provider + config).
- A distributed cache stores entries that may need to be `Serializable` (default serialization).

**Current (mid-2026)**: JCache's `javax.cache` namespace is unchanged. EhCache 2 (`net.sf.ehcache`, `EhCacheRegionFactory`) is superseded by JCache/EhCache 3. The corpus's Ignite 2.4, Infinispan 9.1, and Hazelcast 3.x are several majors behind current releases. Hibernate's 2L cache concepts carry forward.

## Full content

Caching and data grids reduce database load by keeping hot data in memory, optionally distributed across a cluster. The corpus covers the standard and several grids in `libraries-data`(-2) and the Hibernate 2L cache in `spring-hibernate-5`.

### JCache (JSR-107) — the standard

JCache is a vendor-neutral caching API: `CachingProvider` → `CacheManager` → `Cache`. Its extension points — `CacheLoader` (read-through population), `EntryProcessor` (atomic in-place entry mutation), and `CacheEntryListener` — let one program target Hazelcast, Ignite, EhCache 3, or any compliant provider. Notably, `javax.cache` is one of the few `javax.*` namespaces that survived the Jakarta rename.

### Distributed grids — Infinispan, Ignite, Hazelcast

Infinispan's fluent `ConfigurationBuilder` configures cache modes: expiring (TTL lifespan), evicting (max count), passivating (overflow to a single-file store), and transactional (JTA transaction manager + pessimistic locking). Apache Ignite adds SQL-over-grid, a JDBC thin driver, Spring Data (`IgniteRepository`), and data streaming (`IgniteDataStreamer`). Hazelcast doubles as a JCache provider and a distributed-object grid.

### Hibernate second-level cache

Distinct from the application-level grids above, Hibernate's own second-level cache (`@Cacheable` + `@Cache(usage=READ_WRITE)`, plus an optional query cache via the `org.hibernate.cacheable` hint) caches entities/collections across `Session`s, backed by a region factory (EhCache historically). It is off by default and must be explicitly enabled. See [persistence/hibernate-native](hibernate-native.md) for the surrounding Hibernate surface.

### 2026 currency

- **JCache `javax.cache` is unchanged** — it (and `javax.measure`) did NOT move to `jakarta.*`. Treat them as exceptions to the namespace migration. [Hibernate 7 — in.relation.to](https://in.relation.to/2025/05/20/hibernate-orm-seven/)
- **EhCache 2 → EhCache 3 / JCache.** The corpus's `net.sf.ehcache` + `EhCacheRegionFactory` is superseded by JCache/EhCache 3.
- **Grid versions are stale.** Ignite 2.4, Infinispan 9.1, and Hazelcast 3.x in the corpus are several majors behind current releases.
- **The caching concepts carry forward unchanged** — JCache's API, the read-through/write-through/listener model, and Hibernate's 2L cache are durable; what moved is the provider/library versions (except the deliberately-unchanged `javax.cache` namespace).
