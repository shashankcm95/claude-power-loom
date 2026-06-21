---
kb_id: spring-boot/testing
version: 1
tags:
  - spring-boot
  - testing
  - test-slices
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-boot-testing"
  - "Baeldung tutorials (eugenp/tutorials) module: spring-boot-config-jpa-error"
  - "Improved Testcontainers Support in Spring Boot 3.1 (spring.io/blog/2023/06/23/improved-testcontainers-support-in-spring-boot-3-1)"
related:
  - spring-boot/auto-configuration
  - spring-boot/persistence-jpa
  - spring-boot/security
status: active
---

## Summary

**Concept**: Boot's test ergonomics — sliced test contexts, mock beans, and the config-discovery rule; plus Testcontainers wiring.
**Key APIs**: `@SpringBootTest(webEnvironment=RANDOM_PORT)`, `@WebMvcTest`, `@DataJpaTest` + `TestEntityManager`, `@RestClientTest` + `MockRestServiceServer`, `@MockBean`/`@SpyBean`, `@TestConfiguration`, `MockMvc`/`TestRestTemplate`, `@ServiceConnection`.
**Gotcha**: slices discover config by walking *up* package levels — a `@SpringBootConfiguration` deeper than the test class is not found (library modules need a test-only app class).
**2026-currency**: `@MockBean`/`@SpyBean` → `@MockitoBean`/`@MockitoSpyBean` (deprecated 3.4, removed 4.0); `@ServiceConnection` Testcontainers (3.1); Boot 4 `@SpringBootTest` no longer auto-wires MockMvc/TestRestTemplate.
**Sources**: Baeldung `spring-boot-testing` / `-config-jpa-error`; spring.io 2023.

## Quick Reference

**The slices**:
- `@SpringBootTest(webEnvironment=RANDOM_PORT)` — full context; inject `@LocalServerPort`, use `MockMvc`/`TestRestTemplate`.
- `@WebMvcTest(Ctrl.class)` — web layer only; `@MockBean` collaborators; `MockMvc` auto-wired.
- `@DataJpaTest` — JPA layer; `TestEntityManager` (`persistAndFlush`); in-memory DB by default.
- `@RestClientTest(Client.class)` — REST client; `MockRestServiceServer.expect(requestTo("/x")).andRespond(withSuccess(...))`.

```java
@WebMvcTest(FooController.class)
class FooControllerTest {
    @Autowired MockMvc mvc;
    @MockBean FooService svc;
    @Test void getsFoo() throws Exception {
        mvc.perform(get("/foo/1"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.name").value("bar"));
    }
}
```

**`@TestConfiguration`**: supply a real bean (e.g. the service under test) while `@MockBean`-ing its dependencies.

**Config discovery rule**: `@DataJpaTest`/`@WebMvcTest` walk *up* package levels from the test class to find a `@SpringBootConfiguration`. A library module with no main app needs a test-only `@SpringBootApplication` under `src/test/java` *above* the test package.

**Suppressing runners in tests**: keep `CommandLineRunner`/`ApplicationRunner` from firing with `@Profile("!test")`, test props, or `ConfigDataApplicationContextInitializer`.

**Top gotchas**:
- A `@SpringBootApplication` placed deeper than the test is NOT found (the config-discovery rule).
- `@AutoConfigureMockMvc(addFilters=false)` is needed to test around filters like `ShallowEtagHeaderFilter`.
- JUnit 4/5 coexistence requires `junit-vintage-engine`; mixing carelessly yields `NoSuchMethodError`.

**Current (mid-2026)**: `@MockBean`/`@SpyBean` were deprecated in Boot 3.4 and **removed in Boot 4.0** → `@MockitoBean`/`@MockitoSpyBean`. Boot 3.1 added built-in Testcontainers via `@ServiceConnection` (auto-creates `ConnectionDetails`, replacing manual `@DynamicPropertySource`). Boot 4.0 `@SpringBootTest` no longer auto-wires MockMvc/TestRestTemplate — add `@AutoConfigureMockMvc`/`@AutoConfigureTestRestTemplate`; Spock support was removed (Groovy 5).

## Full content

Spring Boot's test support trades a slow full-context boot for fast, focused *slices* that load only the layer under test. The corpus exercises every slice plus the config-discovery rule that trips up library modules.

### The slice catalogue

`@SpringBootTest` boots the whole application (optionally on a random port for real HTTP via `TestRestTemplate`). The narrower slices each auto-configure one layer: `@WebMvcTest` loads controllers + MVC infrastructure and mocks the service layer with `@MockBean`; `@DataJpaTest` loads JPA repositories with a `TestEntityManager` and an in-memory database; `@RestClientTest` loads a REST client with a `MockRestServiceServer` to script responses. `@TestConfiguration` inner classes inject a real bean while mocking its dependencies.

### The config-discovery rule

A slice needs a `@SpringBootConfiguration` to anchor its minimal context, and it finds one by walking *up* the package hierarchy from the test class. A library module (no `main` app class) therefore needs a test-only `@SpringBootApplication` placed in `src/test/java` at or above the test's package; one placed deeper is silently not found (`spring-boot-config-jpa-error`).

### Ergonomics

The corpus also covers Spock/Groovy specs, four ways to exclude auto-config in tests, three ways to control test log levels (plus `OutputCaptureRule`), embedded Redis, and suppressing `CommandLineRunner`/`ApplicationRunner` so they do not run during tests. JUnit 4 predominates in the snapshot (`@RunWith(SpringRunner.class)`), with several modules mid-migration to JUnit 5.

### 2026 currency

- **`@MockBean`/`@SpyBean` → `@MockitoBean`/`@MockitoSpyBean`.** Deprecated in Boot 3.4, **removed** in Boot 4.0. [Spring Boot 4.0 Migration Guide](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide)
- **Built-in Testcontainers + Docker Compose (Boot 3.1).** `@ServiceConnection` auto-creates `ConnectionDetails` beans, replacing manual `@DynamicPropertySource`, and works at dev time as well as in tests. [Improved Testcontainers Support in Spring Boot 3.1](https://spring.io/blog/2023/06/23/improved-testcontainers-support-in-spring-boot-3-1/)
- **Boot 4.0 test changes.** `@SpringBootTest` no longer auto-wires `MockMvc`/`TestRestTemplate` (add `@AutoConfigureMockMvc`/`@AutoConfigureTestRestTemplate`); Spock support was removed (Groovy 5); JUnit 5 only. [Spring Boot 4.0 Migration Guide](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide)
- **The slices, `TestEntityManager`, the config-discovery rule, and `ConfigDataApplicationContextInitializer` carry forward unchanged.** `@LocalServerPort` moved package (`org.springframework.boot.web.server` → `org.springframework.boot.test.web.server`) in Boot 3. [Spring Boot 4.0.0 available now](https://spring.io/blog/2025/11/20/spring-boot-4-0-0-available-now/)
