---
kb_id: spring-core/spring-testing
version: 1
tags:
  - spring-core
  - testing
  - mockmvc
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-mockito / spring-threads / spring-5"
  - "Spring Boot 3.4 Release Notes (official wiki, github.com/spring-projects/spring-boot/wiki/Spring-Boot-3.4-Release-Notes)"
related:
  - spring-core/spring-mvc-web-tier
  - spring-core/rest-client
status: active
---

## Summary

**Concept**: The Spring TestContext framework loads an ApplicationContext for integration tests, with slice tests, MockMvc, and bean overrides for the web/AOP layers.
**Key APIs**: `@SpringBootTest`/`@WebMvcTest`/`@DataJpaTest`/`@RestClientTest`; `MockMvc` + `MockMvcResultMatchers`; `SpringExtension`/`@SpringJUnitConfig`; `@MockitoBean` (was `@MockBean`); Mockito `@Mock`/`@InjectMocks`.
**Gotcha**: `@MockitoBean` is not supported on `@Configuration` classes (annotate test-class fields); never mix raw values and Mockito argument matchers in one stub.
**2026-currency**: `@MockBean`/`@SpyBean` deprecated in Boot 3.4 → `@MockitoBean`/`@MockitoSpyBean`; JUnit 4 → JUnit 5; Mockito 2.x → 5.x.
**Sources**: Baeldung `spring-mockito`/`spring-5`; Spring Boot 3.4 Release Notes.

## Quick Reference

**Context tests**:
- `@SpringBootTest` (+ `webEnvironment=RANDOM_PORT`/`DEFINED_PORT`, `@LocalServerPort`) — full context.
- `@WebMvcTest` — web slice + `MockMvc`; `@DataJpaTest` — JPA slice; `@RestClientTest` — client slice.
- `@AutoConfigureMockMvc`, `@ContextConfiguration`, `@DirtiesContext`, `@ActiveProfiles`.

**JUnit 5 + Spring**: `SpringExtension` via `@ExtendWith`; composed `@SpringJUnitConfig` (= `SpringExtension` + `@ContextConfiguration`) / `@SpringJUnitWebConfig` (+ `@WebAppConfiguration`). (The 2021 corpus is mostly JUnit 4 `@RunWith(SpringRunner.class)`.)

**MockMvc**: `MockMvcBuilders.webAppContextSetup`/`standaloneSetup`; `MockMvcRequestBuilders.get/post/multipart`; `MockMvcResultMatchers` (`status()`, `view().name()`, `model().attribute()`, `content().contentType()`, `jsonPath`, `xpath`). Read the thrown exception via `result.getResolvedException()`.

**Mockito**: `@Mock`/`@InjectMocks` (+ `MockitoExtension`); `when().thenReturn()`; `verify(mock, times(n))`; `ArgumentMatchers` (`eq`, `anyInt`, custom `ArgumentMatcher` + `argThat`).

**Bean override**: `@MockitoBean` / `@MockitoSpyBean` (core Spring, `org.springframework.test.context.bean.override.mockito`) replace beans in the test context — superseding `@MockBean`/`@SpyBean`.

**Top gotchas**:
- **Never mix raw values and matchers** in one Mockito stub — all-or-nothing.
- `@MockitoBean` is NOT supported on `@Configuration` classes — annotate test-class fields instead.
- Corpus naming traps: `*ManualTest`/`*LiveTest` need running servers/DBs and are CI-excluded; some "tests" make no assertions; an `EmployeeServletIntegrationTest` is actually a unit test.

**Current (mid-2026)**: `@MockBean`/`@SpyBean` deprecated for removal in Spring Boot 3.4 → core-Spring `@MockitoBean`/`@MockitoSpyBean`. JUnit 4 → JUnit 5 throughout; Mockito 2.x → 5.x; embedded-redis test helpers → Testcontainers; `Cargo + Jetty` live-test harness → `@SpringBootTest`.

## Full content

Spring's TestContext framework caches a loaded `ApplicationContext` across test classes (keyed by configuration), so integration tests share an expensive context. Slice annotations (`@WebMvcTest`, `@DataJpaTest`, `@RestClientTest`) load only the relevant auto-configuration for faster, focused tests. `MockMvc` drives the MVC web tier without a running server, asserting on status, view, model, and JSON/XML body.

### Mock vs. real

Mockito mocks collaborators in unit tests; `@MockitoBean` mocks them inside a loaded Spring context (e.g. mocking a service in a `@WebMvcTest`). The discipline trap is mixing raw arguments and matchers in one stub, which Mockito forbids.

### Corpus testing hazards

The base corpus surfaces several anti-patterns worth knowing: tests named `*ManualTest`/`*LiveTest` require external infrastructure and are excluded from normal CI; some live tests hit the real internet and fail offline; and some named "tests" assert nothing. The `ThreadPoolTaskExecutor` sizing test is the canonical reminder that `maxPoolSize` is a no-op with an unbounded queue.

### 2026 currency

The TestContext model is durable; the mock-override API moved:

- **`@MockBean` / `@SpyBean` deprecated (Spring Boot 3.4) for removal**, superseded by core-Spring `@MockitoBean` / `@MockitoSpyBean` (in `org.springframework.test.context.bean.override.mockito`). Caveat: `@MockitoBean` is not supported on `@Configuration` classes — annotate test-class fields instead. [Spring Boot 3.4 Release Notes (official wiki)](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-3.4-Release-Notes)
- **JUnit 4 → JUnit 5** (`SpringExtension` / `@SpringJUnitConfig`), **Mockito 2.x → 5.x** — "version-stale but concepts transfer." [Spring Framework Versions (official wiki)](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-Versions)
- **Testcontainers** replaces ad-hoc embedded-redis / live harnesses; `Cargo + Jetty` IT harness is superseded by `@SpringBootTest`. [Spring Boot | endoflife.date](https://endoflife.date/spring-boot)
- **Current versions (mid-2026)**: Spring Boot 4.1.0 (2026-06-10) / Spring Framework 7.0.8; Java 17 floor. [Spring Boot | endoflife.date](https://endoflife.date/spring-boot)
