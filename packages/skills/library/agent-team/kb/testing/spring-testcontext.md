---
kb_id: testing/spring-testcontext
version: 1
tags:
  - testing
  - spring
  - integration
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: spring-testing, spring-testing-2"
  - "Spring AssertJ MockMvc integration (MockMvcTester) — docs.spring.io (https://docs.spring.io/spring-framework/reference/testing/mockmvc/assertj.html)"
related:
  - testing/junit5-jupiter
  - testing/mockito
  - testing/testcontainers
  - testing/assertion-libraries
  - testing/async-awaitility
  - testing/bdd-acceptance
  - testing/rest-api-testing
status: active
---

## Summary

**Concept**: The Spring TestContext Framework loads + caches an `ApplicationContext` for tests, swaps beans with mocks, overrides properties, and exercises the web tier via MockMvc — the integration-testing ergonomics aimed at Spring/Boot apps.
**Key APIs**: `@ExtendWith(SpringExtension.class)`/`@SpringJUnitConfig` (JUnit 5) or `@RunWith(SpringRunner.class)` (JUnit 4); `@MockBean`/`@SpyBean`; `@TestPropertySource`, `@ActiveProfiles`, `@DynamicPropertySource`; `ReflectionTestUtils`; `@DirtiesContext`; `TestExecutionListener`; `MockMvcBuilders.webAppContextSetup`; Boot slices `@WebMvcTest`/`@DataJpaTest`/`@SpringBootTest`.
**Gotcha**: `@MockBean` swaps the *context* bean; plain `@Mock` is standalone and silently does not affect the context. `@DynamicPropertySource` method must be `static`.
**2026-currency**: `javax.*`→`jakarta.*` required at Spring 6 / Boot 3; `MockMvcTester` (Boot 3.4+) is the AssertJ-native MockMvc replacing Hamcrest `.andExpect`; `@DynamicPropertySource` is the recommended runtime-property idiom.
**Sources**: Baeldung `spring-testing`/`spring-testing-2`; Spring MockMvcTester docs.

## Quick Reference

**Runner/extension**: `@ExtendWith(SpringExtension.class)` / `@SpringJUnitConfig` (JUnit 5) vs `@RunWith(SpringRunner.class)` (JUnit 4).

**Bean swapping**: `@MockBean` (replaces a context bean with a Mockito mock — `context.getBean` returns the mock) vs `@SpyBean` (wraps the real bean) vs plain `@Mock` (standalone, does NOT touch the context).

**Property override** (≥5 mechanisms, inline > locations precedence):
```java
@DynamicPropertySource
static void props(DynamicPropertyRegistry r) {
    r.add("db.url", container::getJdbcUrl);   // lazy Supplier; container started first
}
```
Also: `@TestPropertySource(locations=/properties=)`, `@ActiveProfiles`, `@SpringBootTest(properties=)`, `ApplicationContextInitializer` + `TestPropertyValues`.

**Reflection**: `ReflectionTestUtils.setField/invokeMethod` for non-public state.

**Context lifecycle**: `@DirtiesContext(MethodMode.AFTER_METHOD)` (order-dependent — pair with `@TestMethodOrder`); custom `TestExecutionListener` (+ `MergeMode.MERGE_WITH_DEFAULTS`).

**Web tier**: `MockMvcBuilders.webAppContextSetup(ctx)` / `standaloneSetup(controller)`; conditional `@EnabledIf`/`@DisabledIf` (SpEL/property/literal). Boot test slices: `@WebMvcTest` (web layer), `@DataJpaTest` (JPA + embedded/Testcontainers DB), `@SpringBootTest` (full context).

**Top gotchas**:
- `@Mock` where a wired bean is needed silently fails — use `@MockBean`.
- `@TestExecutionListeners` *replaces* defaults unless `mergeMode=MERGE_WITH_DEFAULTS` — without it, dependency injection is disabled and `@Autowired` returns null.
- `@DynamicPropertySource` method must be `static` + take a `DynamicPropertyRegistry`; values are lazy `Supplier`s.
- `@DirtiesContext(AFTER_METHOD)` is only meaningful with a defined method order.

**Current (mid-2026)**: `javax.*`→`jakarta.*` is fully required at Spring 6 / Boot 3+ for every Spring-touching test module; Spring Boot 4.x is current (Spring Framework 7); `MockMvcTester` is the AssertJ-native MockMvc.

## Full content

The TestContext Framework's core service is loading and **caching** an `ApplicationContext` across tests that request the same configuration — so the expensive context build amortizes. The framework is engine-agnostic: `SpringExtension` (JUnit 5) and `SpringRunner` (JUnit 4) are thin adapters over the same machinery.

### Swapping beans for mocks

`@MockBean`/`@SpyBean` are the load-bearing integration-test tools: they replace (or wrap) a bean *in the context*, so any other bean that `@Autowired`s the dependency receives the mock. This is the distinction from plain Mockito `@Mock`, which produces a standalone object the context never sees — a silent no-op if you expected wired collaborators to use it.

### Property override and runtime values

Spring offers many property-injection mechanisms with a precedence order (inline `properties=` beats `locations=`). The modern, recommended one for *runtime-computed* values is `@DynamicPropertySource`: a static method receiving a `DynamicPropertyRegistry`, registering lazy `Supplier`s. The laziness matters — a Testcontainers container is started before the supplier is evaluated, so `container::getJdbcUrl` resolves the real mapped port (see [testing/testcontainers](testcontainers.md)).

### Listeners, reflection, and context dirtying

`TestExecutionListener` hooks into the test lifecycle — but registering custom listeners *replaces* the defaults (including the dependency-injection listener) unless `MergeMode.MERGE_WITH_DEFAULTS` is set, a classic foot-gun. `ReflectionTestUtils` pokes non-public state. `@DirtiesContext` evicts the cached context after a test that mutated it (order-dependent).

### 2026 currency

- **`javax.*`→`jakarta.*` is fully required at Spring 6 / Boot 3+** for every Spring-touching test module (Servlet/JPA/Mail namespaces). [Spring Boot 3.4 release notes](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-3.4-Release-Notes)
- **`MockMvcTester` — AssertJ-native MockMvc (Spring Framework 6.2 / Boot 3.4+).** New entry point `MockMvcTester.from/create/of(...)`; results wrap in `assertThat(...)`, and unresolved exceptions surface on `MvcTestResult` rather than being thrown — replacing the `MockMvcBuilders.webAppContextSetup` + Hamcrest `.andExpect(...)` idiom. [Spring AssertJ MockMvc integration (docs)](https://docs.spring.io/spring-framework/reference/testing/mockmvc/assertj.html) · [MockMvcTester guide (JetBrains)](https://blog.jetbrains.com/idea/2025/04/a-practical-guide-to-testing-spring-controllers-with-mockmvctester/)
- **Spring Boot 4.x is current** (inherits Spring Framework 7); 3.5.x is the final 3.x minor; Spring Framework 6.2.x OSS support ends June 2026; 7.0.x is current. [Spring Framework 6.2.18 & 7.0.7 blog](https://spring.io/blog/2026/04/17/spring-framework-6-2-18-and-7-0-7-available-now/)
- **`@WebMvcTest`/`@DataJpaTest`/`@SpringBootTest` focused test slices** and `@DynamicPropertySource` carry forward unchanged as the recommended idioms; field `@Autowired` injection used throughout the base is now superseded by constructor injection.
