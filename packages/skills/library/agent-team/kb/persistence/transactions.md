---
kb_id: persistence/transactions
version: 1
tags:
  - persistence
  - transactions
  - jta
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-persistence-simple"
  - "Baeldung tutorials (eugenp/tutorials) module: atomikos"
  - "Spring fixes for CVE-2025-41248/41249 — spring.io (https://spring.io/blog/2025/09/15/spring-framework-and-spring-security-fixes-for-CVE-2025-41249-and-CVE-2025-41248/)"
related:
  - persistence/jdbc-fundamentals
  - persistence/jpa-locking-concurrency
  - persistence/spring-data-repositories
  - persistence/alternative-orms
  - persistence/connection-pooling
status: active
---

## Summary

**Concept**: Transaction management across three styles — declarative `@Transactional`, programmatic `TransactionTemplate`/`PlatformTransactionManager`, and distributed XA/JTA two-phase commit.
**Key APIs**: Spring `org.springframework.transaction.annotation.@Transactional` (isolation/propagation/readOnly/rollbackFor) vs JTA `jakarta.transaction.@Transactional` (TxType); `TransactionTemplate.execute`; `PlatformTransactionManager`; Atomikos `UserTransactionManager` + `AtomikosDataSourceBean` + `JtaTransactionManager`.
**Gotcha**: Two `@Transactional` annotations (Spring vs JTA) with different rollback semantics — easy to import the wrong one. Spring rolls back on unchecked exceptions by default.
**2026-currency**: JTA namespace moved `javax.transaction.*` → `jakarta.transaction.*`; Bitronix abandoned (Atomikos remains valid embedded JTA); saga/outbox now preferred over XA in microservices.
**Sources**: Baeldung `spring-persistence-simple`, `spring-jpa-2`, `atomikos`, `jta`; Spring CVE advisory.

## Quick Reference

**Declarative — the two annotations**:

| Annotation | Package | Attributes |
|------------|---------|-----------|
| Spring | `org.springframework.transaction.annotation.Transactional` | `isolation`/`propagation`/`readOnly`/`timeout`/`rollbackFor`/`noRollbackFor`; rolls back on unchecked by default |
| JTA | `jakarta.transaction.Transactional` (was `javax.transaction`) | `TxType`, `rollbackOn`/`dontRollbackOn` |

Class-level sets defaults; method-level overrides.

**Programmatic**:
```java
transactionTemplate.execute(status -> { …; status.setRollbackOnly(); return null; });
// low level: PlatformTransactionManager.getTransaction(new DefaultTransactionDefinition()) + commit/rollback
TransactionAspectSupport.currentTransactionStatus().setRollbackOnly();
TransactionSynchronizationManager.isActualTransactionActive();
```
Test-side: `TestTransaction.flagForCommit()`/`flagForRollback()`.

**Distributed / XA / JTA** (two-phase commit across independent DBs):
- **Atomikos**: `UserTransactionManager` + `AtomikosDataSourceBean`, one EMF per DB under a shared `JtaTransactionManager`.
- **Bitronix**: `spring-boot-starter-jta-bitronix`, `BitronixXADataSourceWrapper` (abandoned — see currency).
- XA datasources: Derby `EmbeddedXADataSource`, HSQLDB `JDBCXADataSource`. One failure rolls back both DBs.

**Top gotchas**:
- Two `@Transactional` annotations — import the right one for your intended rollback semantics.
- Spring rolls back on unchecked (RuntimeException/Error) by default — checked exceptions do NOT roll back unless `rollbackFor` says so.
- `@Transactional` self-invocation (a method calling another `@Transactional` method on the same proxy) bypasses the AOP proxy.

**Current (mid-2026)**: JTA annotations moved to `jakarta.transaction.*` (Boot 3+). Bitronix is abandoned and was removed from Spring Boot 2.3+; Atomikos remains a valid embedded JTA transaction manager. Modern microservice guidance prefers saga/outbox over distributed XA. Staying on EOL Spring (Boot 2.7 / Framework 5.x) is an unpatched-CVE risk class.

## Full content

Transactions are managed in three escalating styles. The corpus covers declarative + programmatic in `spring-persistence-simple` and `spring-jpa-2`, and distributed XA in `atomikos` and `jta`.

### Declarative `@Transactional`

The default and recommended style. The critical confusion is that *two* `@Transactional` annotations exist with different semantics: Spring's (`isolation`/`propagation`/`readOnly`/`rollbackFor`, rolls back on unchecked exceptions by default) and the JTA one (`TxType`, `rollbackOn`/`dontRollbackOn`). Class-level annotations set defaults that method-level annotations override. A subtle but common bug: Spring `@Transactional` rolls back only on unchecked exceptions unless `rollbackFor` is specified for checked ones; and self-invocation bypasses the proxy entirely.

### Programmatic transactions

When declarative scope does not fit, `TransactionTemplate.execute` runs a callback with explicit `status.setRollbackOnly()`. The lower-level `PlatformTransactionManager.getTransaction(DefaultTransactionDefinition)` + `commit`/`rollback` gives full control. Active-transaction detection is `TransactionSynchronizationManager.isActualTransactionActive()`; tests use `TestTransaction.flagForCommit`/`flagForRollback`.

### Distributed XA / JTA

When a single logical unit must span independent databases, two-phase commit via a JTA transaction manager guarantees atomicity. Atomikos wires a `UserTransactionManager` + `AtomikosDataSourceBean` with one `EntityManagerFactory` per DB under a shared `JtaTransactionManager` — and the corpus proves the atomicity (one failure rolls back both DBs). Bitronix is the alternative. XA-aware datasources include Derby `EmbeddedXADataSource` and HSQLDB `JDBCXADataSource`.

### 2026 currency

- **JTA namespace moved** `javax.transaction.*` → `jakarta.transaction.*` (Jakarta EE 9+, mandatory on Spring 6 / Boot 3+); the Spring `@Transactional` package is unchanged.
- **Bitronix is abandoned** and was removed from Spring Boot 2.3+; Atomikos remains a valid embedded JTA transaction manager, though saga/outbox patterns are now preferred over distributed XA in microservices.
- **EOL-Spring CVE risk.** Two annotation-detection CVEs landed in 2025 — CVE-2025-41248 (Spring Security `@EnableMethodSecurity` on generic superclasses → authorization bypass; fixed 6.4.11 / 6.5.5) and CVE-2025-41249 (Spring Framework annotation detection with unbounded generics; fixed 6.2.11). No OSS fixes ship for EOL lines (Boot 2.7 / Framework 5.x), making them an unpatched-CVE risk class. [Spring fixes — spring.io](https://spring.io/blog/2025/09/15/spring-framework-and-spring-security-fixes-for-CVE-2025-41249-and-CVE-2025-41248/) · [Security risks of Spring Boot 2.7 — herodevs.com](https://www.herodevs.com/blog-posts/the-security-risks-of-staying-on-spring-boot-2-7-and-spring-framework-5)
- **The transaction concepts carry forward unchanged** — declarative/programmatic/XA management via `@Transactional` is durable; what moved is the JTA namespace and the microservice-era preference away from XA.
