---
kb_id: security/spring-session-ldap
version: 1
tags:
  - security
  - spring-session
  - ldap
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: spring-session/spring-session-redis/jdbc/mongodb, spring-ldap, spring-security-ldap"
  - "What's New in Spring Security 7.0 (https://docs.spring.io/spring-security/reference/7.0/whats-new.html)"
related:
  - security/authentication-backends
  - security/web-security-controls
  - security/federation-sso
status: active
---

## Summary

**Concept**: Externalized HTTP sessions (Spring Session over Redis/JDBC/Mongo) and LDAP directory access + authentication — the session and directory infrastructure around the auth core.
**Key APIs**: Spring Session transparent `HttpSession` backing, `spring.session.store-type`, `MongoIndexedSessionRepository`, `SPRING_SESSION*` tables; LDAP `LdapTemplate`/`ContextSource`, ODM `@Entry`/`LdapRepository`, `contextSource.getContext(dn, pw)` bind-auth, Spring Security `ldapAuthentication()`.
**Gotcha**: Spring Session stores attributes as Java-serialized bytes (JDBC `ATTRIBUTE_BYTES` BLOB) -> all session objects must be `Serializable`, and class-version skew breaks deserialization across deploys; SHA-1 LDAP password hashing (`MessageDigest("SHA")`) is weak.
**2026-currency**: `spring.session.store-type` removed in Boot 3 (store selection is classpath-driven); SS 7.0 removed embedded Apache DS LDAP-test support in favor of UnboundID.
**Sources**: Baeldung `spring-session/*`, `spring-ldap`, `spring-security-ldap`; Spring Security 7.0 What's New.

## Quick Reference

**Spring Session (externalized HTTP session)**: transparently backs the servlet `HttpSession` into an external store — Redis, JDBC (`SPRING_SESSION*` tables, Java-serialized attribute BLOBs), or MongoDB (`MongoIndexedSessionRepository`). Store selection in the corpus is via `spring.session.store-type`. The Redis test proves the session is the source of truth: `flushAll()` -> the same cookie now 401s.

**LDAP — two distinct uses**:

```java
// 1. Directory access (spring-ldap): LdapTemplate / ContextSource
//    ODM mapping: @Entry / LdapRepository
//    bind-as-authentication: contextSource.getContext(dn, password)

// 2. Spring Security LDAP authentication (spring-security-ldap)
auth.ldapAuthentication()
    .userSearchFilter("(uid={0})")
    .groupSearchFilter("(member={0})")
    .contextSource()...;     // embedded ApacheDS + LDIF in the demo
```

**Top gotchas**:

- Spring Session attributes are Java-serialized (JDBC `ATTRIBUTE_BYTES` BLOB) -> all stored objects must be `Serializable`; schema/class-version skew breaks deserialization across deploys.
- SHA-1 LDAP password hashing (`spring-ldap` `MessageDigest("SHA")`) is weak.
- Several Spring Session "live tests" require an external running Redis/Mongo and assert nothing; the Redis `SessionControllerIntegrationTest` is the one load-bearing proof.

**Current (mid-2026)**: `spring.session.store-type` removed in Boot 3 — store selection is now classpath-driven; SS 7.0 removed embedded Apache DS support in favor of UnboundID, so the corpus's embedded-ApacheDS LDAP test harness is a dead-end on 7.x.

## Full content

This is the session and directory infrastructure around the authentication core. Spring Session transparently externalizes the servlet `HttpSession` into Redis, JDBC, or MongoDB, so session state survives application restarts and is shared across instances. The JDBC backend persists attributes as Java-serialized bytes in `SPRING_SESSION*` tables (an `ATTRIBUTE_BYTES` BLOB), the Mongo backend uses `MongoIndexedSessionRepository`, and the corpus selects the store with `spring.session.store-type`. The Redis integration test is the load-bearing proof that the external store is authoritative: after `flushAll()`, the same session cookie now returns 401. Evidence: `spring-session/spring-session-{redis,jdbc,mongodb}/.../{SecurityConfig,*Controller,*IntegrationTest}.java` (the Redis `SessionControllerIntegrationTest` is the key one).

LDAP appears in two distinct roles. `spring-ldap` is directory access — `LdapTemplate`/`ContextSource`, ODM via `@Entry`/`LdapRepository`, and bind-as-authentication through `contextSource.getContext(dn, pw)`. `spring-security-ldap` is authentication — `ldapAuthentication()` with user-search and group-search filters, backed by an embedded ApacheDS server seeded from LDIF. Evidence: `spring-security-ldap/.../config/SecurityConfig.java` + `users.ldif`, `spring-ldap/.../ldap/{client/LdapClient,data/repository/User}.java`. The corpus's `spring-ldap` uses SHA-1 (`MessageDigest("SHA")`) for password hashing — weak by current standards.

### 2026 currency

- **`spring.session.store-type` removed in Boot 3.** Store selection is now classpath-driven (add the `spring-session-data-redis` / `-jdbc` / `-mongodb` dependency); the Spring Session project itself is alive, only the `store-type` selection and client/test plumbing are dated. [Spring Boot System Requirements](https://docs.spring.io/spring-boot/system-requirements.html)
- **Apache DS for embedded LDAP testing is removed.** SS 7.0 removed Apache DS support in favor of **UnboundID** — the corpus's embedded-ApacheDS LDAP test harness is a dead-end on 7.x. [What's New in Spring Security 7.0](https://docs.spring.io/spring-security/reference/7.0/whats-new.html)
- **LDAP bind-as-auth + ODM carry forward.** `LdapTemplate`/`ContextSource`, `@Entry`/`LdapRepository`, and `ldapAuthentication()` are current at the API-shape level (bump versions); use a strong password hash, not SHA-1. [What's New in Spring Security 7.0](https://docs.spring.io/spring-security/reference/7.0/whats-new.html)
- **Serialization caveat persists.** Java-serialized session attributes remain a deploy-time fragility (class-version skew) and an insecure-deserialization attack surface — a reason to prefer a typed serializer where the store supports it. [What's New in Spring Security 7.0](https://docs.spring.io/spring-security/reference/7.0/whats-new.html)
