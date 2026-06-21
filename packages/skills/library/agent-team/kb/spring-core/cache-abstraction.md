---
kb_id: spring-core/cache-abstraction
version: 1
tags:
  - spring-core
  - caching
  - cross-cutting
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-caching / spring-caching-2"
  - "Spring Framework Versions (official wiki, github.com/spring-projects/spring-framework/wiki/Spring-Framework-Versions)"
related:
  - spring-core/spring-aop
  - spring-core/scheduling-async-retry
status: active
---

## Summary

**Concept**: Spring's declarative cache abstraction adds method-result caching via annotations over a pluggable `CacheManager`, implemented through AOP proxies.
**Key APIs**: `@EnableCaching`; `@Cacheable`/`@CachePut`/`@CacheEvict`/`@Caching`/`@CacheConfig`; SpEL `key=`/`condition=`/`unless=`; `CacheManager` impls (Caffeine, Redis, JCache/EhCache3).
**Gotcha**: same proxy self-invocation caveat as AOP — a self-call to a `@Cacheable` method is not cached; `getCache(name)` returns null if the cache is undeclared.
**2026-currency**: The 5-annotation model is durable core; EhCache 2.x is dead (use EhCache 3/JCache); `spring.redis.*` → `spring.data.redis.*`.
**Sources**: Baeldung `spring-caching` ×2; Spring Framework wiki.

## Quick Reference

**Enable**: `@EnableCaching` on a `@Configuration` + a `CacheManager` bean.

**Five annotations**:
- `@Cacheable` — cache the result; skip the method on a hit
- `@CachePut` — always run the method, update the cache with the result
- `@CacheEvict` — remove entries (`allEntries=true` clears the cache; `beforeInvocation=` controls timing)
- `@Caching` — group multiple cache ops on one method
- `@CacheConfig` — class-level defaults (cache names, key generator)

**SpEL controls**:
- `key=` — custom cache key (e.g. `"#customer.id"`)
- `condition=` — pre-invocation gate (args only, can't see the result)
- `unless=` — post-invocation veto (can use `#result`, e.g. `unless="#result == null"`)
- custom `KeyGenerator` / `CacheResolver` beans for advanced cases

**CacheManager impls**: `SimpleCacheManager` + `ConcurrentMapCache`, `ConcurrentMapCacheManager`, `CaffeineCacheManager`, JCache / EhCache 3, Redis via `RedisCacheManagerBuilderCustomizer` + `RedisCacheConfiguration` + `GenericJackson2JsonRedisSerializer` (per-cache TTL through `.withCacheConfiguration(name, cfg.entryTtl(...))`).

**Top gotchas**:
- **Self-invocation** — same as AOP: a bean calling its own `@Cacheable` method bypasses the proxy, so nothing is cached.
- `getCache(name)` returns null if that cache was never declared.
- `condition` is evaluated before invocation (cannot reference `#result`); `unless` after (can).

**Current (mid-2026)**: `@EnableCaching` + the 5 annotations are in the durable core, unchanged on Spring 6/7. EhCache 2.x is dead — use EhCache 3 / JCache. The Redis cache property prefix moved from `spring.redis.*` to `spring.data.redis.*`. Java 17 baseline.

## Full content

The cache abstraction is a declarative layer, not a cache implementation: annotations describe *what* to cache and *when*, while a `CacheManager` bean decides *where* (in-memory map, Caffeine, Redis, JCache). Because it is implemented as AOP advice around bean methods, it inherits the proxy model's central limitation — self-invocation is not intercepted, so `this.cacheableMethod()` runs uncached.

### Keys, conditions, and the result veto

The SpEL controls form a small but expressive language: `key` computes the cache slot, `condition` decides pre-invocation whether to consult/store the cache (only the arguments are in scope), and `unless` decides post-invocation whether to *suppress* storing (the result `#result` is in scope). A common idiom is `unless = "#result == null"` to avoid caching empty lookups.

### Backends

In-process caches (`ConcurrentMapCache`, Caffeine) need no infrastructure; Redis adds a distributed, TTL-capable backend wired through `RedisCacheManagerBuilderCustomizer`, with per-cache TTL and a JSON serializer for the values.

### 2026 currency

The abstraction is in the base doc's durable core ("the cache abstraction — `@EnableCaching` + the 5 annotations"):

- **The annotation model is unchanged** on Spring 6/7; only the surrounding `javax.* → jakarta.*` namespace and JDK 17 baseline moved. [Spring Framework Versions (official wiki)](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-Versions)
- **EhCache 2.x is dead** — EhCache 3 / JCache are current; the base doc flags this as "version-stale but concepts transfer." [Spring Framework Versions (official wiki)](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-Versions)
- **Redis property prefix moved** `spring.redis.*` → `spring.data.redis.*`; embedded-redis test helpers (`it.ozimov`) give way to Testcontainers. [Spring Boot | endoflife.date](https://endoflife.date/spring-boot)
- **Current versions (mid-2026)**: Spring Framework 7.0.8, Spring Boot 4.1.0. [Spring Framework | endoflife.date](https://endoflife.date/spring-framework)
