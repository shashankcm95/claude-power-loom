---
kb_id: testing/testcontainers
version: 1
tags:
  - testing
  - testcontainers
  - integration
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: test-containers, spring-testing-2 (dynamicproperties)"
  - "Testcontainers Java releases — github.com/testcontainers/testcontainers-java (https://github.com/testcontainers/testcontainers-java/releases)"
related:
  - testing/spring-testcontext
  - testing/junit5-jupiter
  - testing/rest-api-testing
status: active
---

## Summary

**Concept**: Testcontainers spins up throwaway Docker containers (databases, message brokers, Selenium browsers, arbitrary images) bound to a test's lifecycle — giving integration tests real backing services instead of mocks/embedded fakes.
**Key APIs**: JUnit 5 `@Testcontainers` + `@Container`; JUnit 4 `@Rule`/`@ClassRule`; `GenericContainer("img").withExposedPorts(80)` → `getMappedPort(80)`; `PostgreSQLContainer` → `getJdbcUrl/getUsername/getPassword`; `DockerComposeContainer.withExposedService`; `BrowserWebDriverContainer` → `RemoteWebDriver`.
**Gotcha**: container ports are random — never hard-code; resolve via `getMappedPort`/`getFirstMappedPort` and feed Spring via `@DynamicPropertySource` (lazy supplier started before evaluation).
**2026-currency**: Testcontainers 2.x is breaking — all module artifacts gain a `testcontainers-` prefix, classes relocate to `org.testcontainers.<module>`, JUnit 4 support is removed; `DockerComposeContainer`→`ComposeContainer`, `getContainerIpAddress()`→`getHost()`, raw `new GenericContainer("img")`→`DockerImageName.parse(...)`; `postgres:11` is EOL → use `postgres:16/17`.
**Sources**: Baeldung `test-containers`, `spring-testing-2`; Testcontainers Java releases.

## Quick Reference

**JUnit 5 (the modern style)**:
```java
@Testcontainers
class ArticleLiveTest {
    @Container
    static PostgreSQLContainer<?> pg = new PostgreSQLContainer<>("postgres:16");

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", pg::getJdbcUrl);  // started before supplier runs
    }
}
```

**JUnit 4 (legacy, dropped in TC 2.x)**:
```java
@ClassRule
public static GenericContainer<?> redis =
    new GenericContainer<>("redis:7").withExposedPorts(6379);
int port = redis.getMappedPort(6379);
```

**Container flavors**:
- `GenericContainer` — arbitrary image + `withExposedPorts`/`withCommand`, `getMappedPort`.
- `PostgreSQLContainer` (and other DB modules) — auto `getJdbcUrl`/`getUsername`/`getPassword`.
- `DockerComposeContainer` — multi-service, `withExposedService`.
- `BrowserWebDriverContainer` — Selenium-in-Docker → `RemoteWebDriver`.

**Top gotchas**:
- Ports are randomly mapped — always resolve via `getMappedPort`/`getFirstMappedPort`, never hard-code.
- Wire dynamic ports into Spring via `@DynamicPropertySource` (lazy supplier — container is up before evaluation).
- These are *LiveTest/IntegrationTest*-class tests: they need a Docker daemon and are excluded from the default `test` phase.

**Current (mid-2026)**: Testcontainers 2.0.5 is a breaking release — a BOM-only bump is insufficient (artifact rename + class relocation + JUnit 4 removal). Use maintained base images (`postgres:16`/`17`; `postgres:11` is EOL since Nov 2023).

## Full content

Testcontainers replaces brittle embedded fakes (H2 standing in for Postgres, in-memory message brokers) with the *real* service in a disposable Docker container, eliminating the fidelity gap between test and production backends. The container's lifecycle is bound to the test: `@Container` on a static field = one container per class; on an instance field = one per method.

### Resolving dynamic ports

The defining constraint is that the container's published ports are mapped to random host ports (to allow parallel runs). Code must ask the container — `getMappedPort(internalPort)` for `GenericContainer`, or convenience accessors like `getJdbcUrl()` for the typed DB modules. In a Spring test, those values flow into the context through `@DynamicPropertySource`, whose lazy `Supplier` is evaluated after the container has started (see [testing/spring-testcontext](spring-testcontext.md)).

### Container types

`GenericContainer` wraps any image. The typed modules (`PostgreSQLContainer`, etc.) add convenience APIs. `DockerComposeContainer` orchestrates a multi-service compose file. `BrowserWebDriverContainer` runs a Selenium browser in Docker and hands back a `RemoteWebDriver`, decoupling UI tests from a locally-installed browser/driver.

### The LiveTest honesty caveat

Testcontainers tests are environment-coupled by design — they require a running Docker daemon. Baeldung's `*LiveTest`/`*IntegrationTest`/`*IT` naming excludes them from the default unit-test phase; this seam (real DB in Docker verifying a persistence layer) is where the external-infra honesty caveat is strongest.

### 2026 currency

- **Testcontainers moved past 1.20 to a breaking 2.x.** Testcontainers 2.0 prefixes all module artifacts with `testcontainers-` (e.g. `org.testcontainers:mysql` → `org.testcontainers:testcontainers-mysql`), relocates container classes to `org.testcontainers.<module>`, and removes JUnit 4 support — a BOM-only bump is insufficient. The base's 1.x facts (`DockerComposeContainer`→`ComposeContainer`, `getContainerIpAddress()`→`getHost()`, `DockerImageName.parse(...)`) remain valid intermediate steps. Current is 2.0.5. [Testcontainers Java releases (GitHub)](https://github.com/testcontainers/testcontainers-java/releases) · [Testcontainers 2.0 migration MR note (GitLab)](https://gitlab.opencode.de/OC000004892873/Taxonomy/-/merge_requests/65)
- **`postgres:11` image is EOL** (Nov 2023) — use `postgres:16`/`17`. Compose v1 `_1` service suffix → v2 `-1`.
- The Testcontainers *concept* (real backing services in Docker) carries forward unchanged as a current integration-testing idiom.
