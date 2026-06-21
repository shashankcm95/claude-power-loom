---
kb_id: persistence/connection-pooling
version: 1
tags:
  - persistence
  - connection-pool
  - hikaricp
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: core-java-persistence"
  - "Baeldung tutorials (eugenp/tutorials) module: spring-boot-persistence-2"
  - "Virtual threads with Spring Boot — bell-sw.com (https://bell-sw.com/blog/a-guide-to-using-virtual-threads-with-spring-boot/)"
related:
  - persistence/jdbc-fundamentals
  - persistence/transactions
status: active
---

## Summary

**Concept**: A connection pool reuses physical `Connection`s instead of opening one per request; HikariCP is the de-facto standard and the Spring Boot default.
**Key APIs**: `HikariConfig`/`HikariDataSource` (+ prep-stmt cache tuning); alternatives `BasicDataSource` (DBCP2), `ComboPooledDataSource` (C3P0), Tomcat JDBC pool, Oracle UCP `PoolDataSource`.
**Gotcha**: Pool sizing and prepared-statement cache settings (`cachePrepStmts`, `prepStmtCacheSize`, `prepStmtCacheSqlLimit`) materially affect throughput.
**2026-currency**: HikariCP remains the Boot default; keep HikariCP current (5.1.x+) with virtual threads (Project Loom, JDK 21+) — pinning was a JVM-level `synchronized` issue (JEP 491, JDK 24), not a HikariCP correctness floor, so blocking JDBC scales.
**Sources**: Baeldung `core-java-persistence`, `libraries-data-db`, `spring-boot-persistence-2`; BellSoft virtual-threads guide.

## Quick Reference

**HikariCP (default)**:

```java
HikariConfig cfg = new HikariConfig();
cfg.setJdbcUrl(url);
cfg.setUsername(user);
cfg.setPassword(pwd);
cfg.addDataSourceProperty("cachePrepStmts", "true");
cfg.addDataSourceProperty("prepStmtCacheSize", "250");
cfg.addDataSourceProperty("prepStmtCacheSqlLimit", "2048");
DataSource ds = new HikariDataSource(cfg);
```

**Alternative pools** (taught for completeness, dated):

| Pool | Entry class | Notes |
|------|-------------|-------|
| HikariCP | `HikariDataSource` | de-facto standard, Boot default |
| Apache Commons DBCP2 | `BasicDataSource` | legacy |
| C3P0 | `ComboPooledDataSource` | legacy |
| Tomcat JDBC | `org.apache.tomcat.jdbc.pool.DataSource` | selected via `spring.datasource.type` |
| Oracle UCP | `PoolDataSource` | Oracle-specific |

**Hand-rolled teaching pool** (`BasicConnectionPool`): fixed initial/max size, `getConnection`/`releaseConnection`, `isValid` health check, grow-on-demand — illustrative of the contract a real pool implements.

**Top gotchas**:
- Tune the prepared-statement cache (`cachePrepStmts`/`prepStmtCacheSize`/`prepStmtCacheSqlLimit`) — defaults are off.
- Boot selects the pool via `spring.datasource.type`; HikariCP is auto-chosen when on the classpath.

**Current (mid-2026)**: HikariCP is still the Spring Boot default DataSource pool. With virtual threads (Project Loom, GA Java 21) enabled (`spring.threads.virtual.enabled=true`), keep HikariCP current (5.1.x+). The virtual-thread *pinning* concern was a JVM-level `synchronized` issue (addressed by JEP 491 in JDK 24), not a HikariCP-version correctness floor. Blocking JDBC then scales without code change as a genuine alternative to reactive R2DBC.

## Full content

A connection pool amortizes the high cost of establishing a database connection by keeping a bounded set of physical `Connection`s open and handing them out. The corpus covers pooling in `core-java-persistence` (HikariCP + a hand-rolled teaching pool), `libraries-data-db`, and `spring-boot-persistence-2` (Tomcat/Oracle/C3P0 selection).

### HikariCP — the default

HikariCP is configured via `HikariConfig` and instantiated as `HikariDataSource`. Beyond URL/credentials, the load-bearing tuning knobs are the prepared-statement cache properties (`cachePrepStmts`, `prepStmtCacheSize`, `prepStmtCacheSqlLimit`), which are off by default and meaningfully reduce round-trips when enabled.

### Alternative pools

Taught for completeness but dated: Apache Commons DBCP2 (`BasicDataSource`), C3P0 (`ComboPooledDataSource`), the Tomcat JDBC pool (selected via `spring.datasource.type`), and Oracle UCP (`PoolDataSource`). In a Spring Boot app the pool is chosen by classpath presence and the `spring.datasource.type` property.

### The teaching pool

`BasicConnectionPool` is a hand-rolled pool with fixed initial/max size, `getConnection`/`releaseConnection`, an `isValid` health check, and grow-on-demand behavior — useful for understanding the contract (acquire, validate, release, bound) that production pools implement robustly.

### 2026 currency

- **HikariCP remains the Spring Boot default** connection pool; the pooling concept and tuning knobs carry forward unchanged.
- **Virtual threads change the I/O-bound calculus.** With `spring.threads.virtual.enabled=true` on JDK 21+, blocking JDBC/JPA scales without code changes because blocking calls park at the socket layer. keeping HikariCP current (5.1.x+) is good hygiene, but virtual-thread *pinning* was a JVM-level `synchronized` issue (resolved by JEP 491 in JDK 24), not a HikariCP correctness gate — blocking JDBC on virtual threads is a genuine alternative to reactive access for data-layer concurrency. [Virtual threads with Spring Boot — bell-sw.com](https://bell-sw.com/blog/a-guide-to-using-virtual-threads-with-spring-boot/)
