---
kb_id: java-libraries/in-process-caching
version: 1
tags:
  - java-libraries
  - caching
  - performance
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: guava-modules/guava-utilities, libraries-5 (caffeine), libraries-3 (cache2k)"
  - "Caffeine releases (github.com/ben-manes/caffeine)"
related:
  - java-libraries/guava-collections
  - java-libraries/messaging-coordination
status: active
---

## Summary

**Concept**: single-JVM in-process caching — Guava `Cache`/`LoadingCache` → **Caffeine** (same author, async-friendly, better hit rates; Spring's default since Spring 5) → **cache2k** (lightweight alternative). MapMaker is the deprecated predecessor of `CacheBuilder`.
**Key APIs**: `CacheBuilder`/`Caffeine.newBuilder()`, `CacheLoader`/`LoadingCache`/`AsyncLoadingCache`; eviction by size (`maximumSize`), weight (`maximumWeight`+`Weigher`), time (`expireAfterWrite`/`expireAfterAccess`/`refreshAfterWrite`), reference (`weakKeys`/`softValues`); `RemovalListener`; `recordStats()`+`stats()`.
**Gotcha**: loaders must NOT return `null` — wrap absent values in `Optional`; a `CacheLoader` loads once per key (dedup) until eviction/refresh.
**2026-currency**: Caffeine 3.2.4 (Java 11+); 2.x only for older JVMs. Caffeine is Spring's default cache.
**Sources**: Baeldung `guava-utilities`/`libraries-5`/`libraries-3` modules.

## Quick Reference

**Evolution order (single-JVM):** Guava `Cache`/`LoadingCache` → Caffeine (the 2026 default) → cache2k (lightweight). Hazelcast `IMap` is the cluster-wide analog; Chronicle Map / MapDB are off-heap/embedded persistent stores.

**Shared Guava + Caffeine builder vocabulary (near-identical):**

```java
LoadingCache<Key,Val> c = Caffeine.newBuilder()
    .maximumSize(10_000)                       // size eviction
    .expireAfterWrite(5, TimeUnit.MINUTES)     // time eviction
    .refreshAfterWrite(1, TimeUnit.MINUTES)
    .recordStats()                             // then c.stats().hitCount()
    .removalListener((k,v,cause) -> ...)
    .build(key -> loadFromDb(key));            // CacheLoader
```

**Eviction axes:**

- **Size** — `maximumSize(n)`.
- **Weight** — `maximumWeight(n)` + `Weigher`/`weigher((k,v) -> v.length())` (mutually exclusive with size).
- **Time** — `expireAfterWrite` / `expireAfterAccess` / `refreshAfterWrite`, or a custom `Expiry`.
- **Reference** — `weakKeys` / `weakValues` / `softValues`.

`RemovalListener` fires with a `RemovalCause` (`SIZE`, `EXPLICIT`, `EXPIRED`, …). Population: `get(k, loader)`, `getIfPresent`, `put`, `putAll`, `getUnchecked`.

**cache2k:**

```java
Cache<Integer,String> c = Cache2kBuilder.of(Integer.class, String.class)
    .name("cache").eternal(true)         // or .expireAfterWrite(..)
    .entryCapacity(100).build();
```
Variants add read-through `CacheLoader`, expiry policy, and event listeners.

**Top gotchas:**

- **Loaders must not return `null`** — wrap absent values in `Optional<V>` (a `CacheLoader` returning `null` throws / is undefined).
- A `CacheLoader` loads **once per key** (concurrent gets for the same missing key dedup to one load) until eviction/refresh.
- `maximumSize` and `maximumWeight` are mutually exclusive.

**Current (mid-2026):** **Caffeine 3.2.4** (~May 2025) on Java 11+; 2.x only for older JVMs. Caffeine is **Spring's default cache**. Caffeine's overlap with JDK 25 `Stable Values` (JEP 455, lazy thread-safe init) overlaps Guava `Suppliers.memoize` for the single-value case.

## Full content

In-process caching keeps computed or fetched values in the local JVM heap to avoid recomputation or repeated I/O. The Baeldung corpus teaches three, in clear evolutionary order. **Guava's `Cache`/`LoadingCache`** came first: a `CacheBuilder` configures eviction policy and a `CacheLoader` supplies values on miss. **Caffeine**, written by the same author (Ben Manes), is a near-drop-in successor with a near-identical builder API, better hit rates (a modern admission/eviction algorithm), and first-class async support (`AsyncLoadingCache`); it is the default backing cache in Spring since Spring 5 and the recommended choice in 2026. **cache2k** is a lighter-weight alternative with its own `Cache2kBuilder` fluent API. Guava's older `MapMaker` is the deprecated caching predecessor of `CacheBuilder`.

The shared builder vocabulary across Guava and Caffeine is the load-bearing knowledge: eviction is configured along four axes — **size** (`maximumSize`), **weight** (`maximumWeight` with a `Weigher`, mutually exclusive with size), **time** (`expireAfterWrite`, `expireAfterAccess`, `refreshAfterWrite`, or a custom `Expiry`), and **reference strength** (`weakKeys`, `weakValues`, `softValues`). A `RemovalListener` observes evictions with a `RemovalCause`, and `recordStats()` enables `stats().hitCount()` instrumentation. Population uses `get(k, loader)`, `getIfPresent`, `put`/`putAll`, and (Guava) `getUnchecked`.

Two correctness rules recur: loaders must never return `null` — absent values must be wrapped in `Optional` — and a `CacheLoader` loads exactly once per key under concurrency (concurrent gets for a missing key collapse to a single load), with reload only on eviction or refresh. The cluster-wide analog of a single-JVM cache is Hazelcast's distributed `IMap`; off-heap/persistent embedded stores (Chronicle Map, MapDB) are the durable cousins.

### 2026 currency

- **Caffeine 3.2.4** (~May 2025) requires Java 11+; the 2.x line remains only for older JVMs. Caffeine is **Spring's default cache**. [Caffeine releases](https://github.com/ben-manes/caffeine/releases)
- **JDK 25 `Stable Values` (JEP 455)** provides lazy, thread-safe one-time initialization in the platform — overlapping Guava `Suppliers.memoize` for single-value memoization (not a full cache replacement). [What's new in Java 25 (Keyhole)](https://keyholesoftware.com/java-25-whats-new/)
- Guava's caching API shape is unchanged at concept level; bump the pin to Guava 33.6.0-jre. The base's evolution-order finding (Guava → Caffeine → cache2k) still holds.
