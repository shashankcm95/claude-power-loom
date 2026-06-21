---
kb_id: microservices/centralized-config
version: 1
tags:
  - microservices
  - configuration
  - spring-cloud-config
  - vault
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-cloud-config, spring-cloud-bus, spring-cloud-archaius, spring-cloud-vault, spring-cloud-cli"
  - "Spring Cloud 2025.0.0 Northfields release (spring.io/blog/2025/05/29)"
related:
  - microservices/service-discovery
  - microservices/event-driven-streaming
  - microservices/microservice-security
status: active
---

## Summary

**Concept**: Externalize configuration from the binary into a central, versioned source so a fleet reads the same config and can refresh without redeploy. Spring Cloud Config Server (Git-backed) is canonical; Spring Cloud Bus broadcasts refresh; Vault supplies secrets; Archaius is the legacy polled-source model.
**Key APIs**: `@EnableConfigServer`, `spring.cloud.config.server.git.uri`, `{app}-{profile}.properties`, `{cipher}`/`/encrypt`/`/decrypt`; client `@Value`/`@RefreshScope`; `/actuator/busrefresh` over AMQP; Vault `bootstrap.yml` `spring.cloud.vault.*`.
**Gotcha**: `@RefreshScope` + a static-secret approach means committed plaintext/keystore creds leak — the corpus has a real Vault token + root keys committed (teaching artifacts, never reuse).
**2026-currency**: Config Server + Git-backed `{app}-{profile}` ages well; Archaius EOL -> Config Server/`@RefreshScope`; bootstrap context disabled by default since 2020.0 -> `spring.config.import`.
**Sources**: Baeldung `spring-cloud-config`/`-bus`/`-vault`/`-archaius`; Spring Cloud 2025.0.

## Quick Reference

**Config Server**:
```java
@EnableConfigServer
// application.properties:
//   spring.cloud.config.server.git.uri=...; clone-on-start=true
```
Serves `{app}-{profile}.properties` resolved from Git. HTTP-Basic secured; CSRF carve-out for `/encrypt`/`/decrypt`; `{cipher}...` values decrypted server-side from a keystore (`encrypt.keyStore.location`).

**Config client**: `bootstrap.properties` (now `spring.config.import=configserver:`) — `spring.cloud.config.uri/username/password`, `fail-fast=true`, profile -> `@Value` injection; `@RefreshScope` beans re-read on refresh.

**Spring Cloud Bus** (fleet-wide refresh): `@RefreshScope` beans + `spring-cloud-starter-bus-amqp` + Actuator `/actuator/busrefresh` -> broadcast over RabbitMQ -> every instance re-reads `@Value`.

**Netflix Archaius** (legacy polled): `DynamicPropertyFactory.getInstance().getStringProperty(name, default)` (polled; sees its own `config.properties`, invisible to Spring `@Value`); custom source via `PolledConfigurationSource` + `FixedDelayPollingScheduler` -> `DynamicConfiguration` bean (file/JDBC/DynamoDB/ZooKeeper sources).

**Vault as a PropertySource**: no Vault Java API — secrets appear as `Environment` properties (`env.getProperty("foo")`); configured in `bootstrap.yml` (`spring.cloud.vault.uri/token/generic.enabled/database.enabled/database.role`). Dynamic DB backend leases short-lived per-role creds into `spring.datasource.username/password`.

**Top gotchas**:
- Committed demo secrets everywhere — plaintext passwords, hardcoded keystore passwords, a real Vault token + unseal keys committed. Never reuse.
- Bootstrap-context properties disabled by default since Spring Cloud 2020.0.
- Archaius properties are invisible to Spring `@Value` (separate property tree).

**Current (mid-2026)**: Config Server + Git-backed `{app}-{profile}` is a still-valid concept in the 2025.0 train. Archaius is EOL -> Config Server + `@RefreshScope`. The `bootstrap.{yml,properties}` mechanism is disabled by default — migrate to `spring.config.import=configserver:`/`vault:`/`consul:` (or add `spring-cloud-starter-bootstrap`).

## Full content

Centralized configuration moves config out of the deployable and into a shared, versioned source of truth. This gives consistency across a fleet, an audit trail (Git history), profile-per-environment resolution, and the ability to change config at runtime without redeploying. The corpus covers the full toolkit: a Config Server, a broadcast-refresh bus, a secrets backend (Vault), and the legacy polled-source model (Archaius).

### Config Server and refresh

The server (`@EnableConfigServer`) is typically Git-backed and resolves `{app}-{profile}.properties` per requesting client. Sensitive values use `{cipher}` ciphertext decrypted server-side from a keystore, with `/encrypt`/`/decrypt` helper endpoints (which need a CSRF carve-out). Clients inject via `@Value`; `@RefreshScope` beans can re-read config when refreshed. To refresh a whole fleet at once, Spring Cloud Bus connects instances over AMQP and propagates `/actuator/busrefresh`.

### Secrets via Vault

Spring Cloud Vault exposes Vault as an ordinary `PropertySource` — there is no Vault Java API in app code; secrets are just `Environment` properties. The powerful mode is the dynamic database backend: Vault mints short-lived, per-role DB credentials injected straight into the datasource, so the HikariCP pool uses leased creds that never appear in source (with TTL renewal).

### 2026 currency

- **Config Server + Git-backed config ages well** — listed in the corpus freshness verdict as a still-valid abstraction, and shipped in the Spring Cloud 2025.0.0 "Northfields" train. [Spring Cloud 2025.0.0 release](https://spring.io/blog/2025/05/29/spring-cloud-2025-0-0-is-abvailable/)
- **Archaius -> Config Server / `@RefreshScope`.** Netflix Archaius is EOL with the rest of Netflix OSS; centralized config + refresh-scope is the replacement.
- **Bootstrap context disabled by default** since Spring Cloud 2020.0 — `spring.cloud.config/consul/vault.*` in `bootstrap.{properties,yml}` needs `spring-cloud-starter-bootstrap` or migration to `spring.config.import=configserver:`/`consul:`/`vault:`. [Spring Cloud 2025.0.0 release](https://spring.io/blog/2025/05/29/spring-cloud-2025-0-0-is-abvailable/)
- **Spring Boot 4 / Framework 7** add built-in API versioning and programmatic bean registration, but the externalized-config + Config-Server model carries forward unchanged at the concept level. [Spring Framework 7.0 GA](https://spring.io/blog/2025/11/13/spring-framework-7-0-general-availability/)
