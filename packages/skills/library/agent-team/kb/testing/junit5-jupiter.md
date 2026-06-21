---
kb_id: testing/junit5-jupiter
version: 1
tags:
  - testing
  - junit5
  - test-runner
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: junit-5, junit-5-advanced, junit-5-basics, junit5-annotations, junit5-migration, junit-4, testng"
  - "JUnit current release notes — docs.junit.org (https://docs.junit.org/current/release-notes.html)"
related:
  - testing/mockito
  - testing/assertion-libraries
  - testing/spring-testcontext
  - testing/async-awaitility
  - testing/testcontainers
  - testing/bdd-acceptance
  - testing/test-data-fixtures
  - testing/architecture-coverage-quality
status: active
---

## Summary

**Concept**: JUnit 5 / Jupiter is the flagship JVM test framework — a programming model (Jupiter) over a pluggable engine/launcher (Platform) that also runs legacy JUnit 4 via Vintage. Supersedes JUnit 4 `@Rule`/`@RunWith` with a composable extension SPI.
**Key APIs**: `@Test`, `@BeforeAll/@AfterAll/@BeforeEach/@AfterEach`, `@Nested`, `@Tag`, `@DisplayName`, `@ExtendWith`/`@RegisterExtension`, `@ParameterizedTest`, `@TestFactory`→`Stream<DynamicTest>`, `@TestTemplate`, `@RepeatedTest`, `@TempDir`, `@TestInstance(PER_CLASS)`, `Assertions.assertAll/assertThrows/assertTimeoutPreemptively`.
**Gotcha**: a JUnit 4 `@Ignore` on the classpath via Vintage is silently ineffective under the Jupiter engine (use `@Disabled`); `@RegisterExtension` ordering is non-deterministic without `@Order`.
**2026-currency**: JUnit 6.0.0 (2025-09-30) / 6.1.0 (GA 2026-05-19) is a real generation — Java 17 baseline, unified `6.x` versioning, JSpecify nullability, Kotlin `suspend` tests, `CancellationToken`.
**Sources**: Baeldung `junit-5*`, `junit5-annotations`, `junit5-migration`, `junit-4`, `testng`; docs.junit.org release notes.

## Quick Reference

**Lifecycle**: `@BeforeAll`/`@AfterAll` (static by default), `@BeforeEach`/`@AfterEach`, `@Test`. `@TestInstance(PER_METHOD)` (default — fresh instance, isolated state) vs `PER_CLASS` (one instance, non-static `@BeforeAll`, shared state).

**Assertions** (`org.junit.jupiter.api.Assertions`): `assertAll`, `assertThrows(Type.class, executable)` (matches derived types), `assertIterableEquals`, `assertLinesMatch`, `assertTimeout` vs `assertTimeoutPreemptively`, lazy `Supplier<String>` messages. **Assumptions**: `assumeTrue`/`assumingThat` (failed assumption *aborts*, not fails).

**Extension model** (replaces Rules + Runners): implement SPIs — `ParameterResolver`, `TestInstancePostProcessor`, lifecycle callbacks (`BeforeAllCallback`/`AfterEachCallback`/…), `ExecutionCondition`, `TestExecutionExceptionHandler`, `TestWatcher`; register via `@ExtendWith` (declarative) or `@RegisterExtension` (programmatic + `@Order`).

**Parameterized**: `@ParameterizedTest` + `@ValueSource`/`@EnumSource`/`@CsvSource`/`@CsvFileSource`/`@MethodSource`/`@ArgumentsSource`, `@NullAndEmptySource`, `@ConvertWith`, `@AggregateWith`.

**Dynamic / templated**: `@TestFactory` → `Stream<DynamicTest>`; `@TestTemplate` + `TestTemplateInvocationContextProvider` (the generalization under parameterized & repeated); `@RepeatedTest` + `RepetitionInfo`.

**Conditional**: `org.junit.jupiter.api.condition.*` — `@EnabledOnOs/Jre`, `@EnabledForJreRange`, `@Enabled/DisabledIfSystemProperty/EnvironmentVariable`, composed meta-annotations.

**Misc**: `@TempDir Path` (field/param/static); `@TestMethodOrder` + `@Order`/`MethodOrderer`; `@DisplayNameGeneration` + `DisplayNameGenerator` (`ReplaceUnderscores`). Programmatic launch: `LauncherDiscoveryRequestBuilder` + `LauncherFactory` + `SummaryGeneratingListener`.

**Top gotchas**:
- JUnit 4 `@Ignore`/`@Test(expected=)`/`org.junit.Assert` "work" via Vintage but `@Ignore` is silently ineffective under Jupiter — use `@Disabled`.
- State-mutating-field tests pass only under `PER_METHOD`; non-static `@BeforeAll` requires `PER_CLASS`.
- `@RegisterExtension` order is non-deterministic without `@Order`.

**Current (mid-2026)**: migrate toward JUnit 6, not just "JUnit 5." JUnit 6.0.0 shipped 2025-09-30 (Java 17 baseline, up from Java 8); 6.1.0 GA 2026-05-19; 5.14.x still maintained. Base migrations entrenched: `@RunWith(JUnitPlatform.class)`/`org.junit.platform.runner` → `@Suite` (`junit-platform-suite`); `MethodOrderer.Alphanumeric` → `MethodName`.

## Full content

JUnit 5 is three sub-projects: **Jupiter** (the test API + programming model), **Platform** (the engine/launcher infrastructure that any `TestEngine` plugs into), and **Vintage** (a `TestEngine` that runs JUnit 3/4 tests on the Platform). This separation is the architectural advance over JUnit 4: the launcher is decoupled from the API, so frameworks like Spock and Cucumber run as Platform engines alongside Jupiter.

### The extension SPI replaces Rules and Runners

JUnit 4's two extension mechanisms — `@RunWith(Runner)` (one per class, not composable) and `@Rule`/`TestRule` (composable but limited) — collapse into a single composable extension model. An extension implements one or more SPIs (`ParameterResolver` to inject method args, lifecycle callbacks, `ExecutionCondition` to enable/disable, `TestWatcher` to observe outcomes) and is attached via `@ExtendWith` or `@RegisterExtension`. Mockito's `MockitoExtension` and Spring's `SpringExtension` are the canonical examples.

### Parameterized, dynamic, templated tests

`@ParameterizedTest` draws arguments from a rich source catalog (`@ValueSource`, `@CsvSource`, `@MethodSource`, `@ArgumentsSource`, `@NullAndEmptySource`) with argument conversion (`@ConvertWith`) and aggregation (`@AggregateWith`). `@TestFactory` returns a `Stream<DynamicTest>` for tests computed at runtime. Both are specializations of `@TestTemplate` + `TestTemplateInvocationContextProvider`, the generalization that also underlies `@RepeatedTest`.

### Lifecycle and isolation

`@TestInstance(PER_METHOD)` is the default: a fresh test-class instance per method, so instance fields can't leak state between tests. Switching to `PER_CLASS` (one instance for all methods) enables non-static `@BeforeAll`/`@AfterAll` and shared state — but a test that relied on per-method isolation will then break. This aliasing is a common migration foot-gun.

### Legacy context (JUnit 4, TestNG)

JUnit 4 remains the baseline many modules straddle (via the Vintage engine): `@Test`, `@Before/@After`, `@Ignore`, `@RunWith`, `@FixMethodOrder`, and **Rules** (`TemporaryFolder`, `ExpectedException`, `Timeout`, `ErrorCollector`, `RuleChain`). Migration mappings: `@Rule`/`TestRule` → Extensions; `ExpectedException` → `assertThrows`; `TemporaryFolder` → `@TempDir`; `Assume` → `Assumptions`/`@Enabled*`; custom `Runner` → `TestEngine`/extensions; `@Category`+`Categories` → `@Tag`. **TestNG** is the alternative full framework (groups, `dependsOnMethods`, `priority`, `@DataProvider`, suite XML) — note its default order is *not* source order.

### 2026 currency

- **JUnit 5 → JUnit 6 is a real generation.** JUnit 6.0.0 shipped 2025-09-30 with a Java 17 baseline (up from Java 8), unified `6.x` versioning across Platform/Jupiter/Vintage, JSpecify nullability annotations, Kotlin `suspend` test functions, a `CancellationToken` API, and JFR integration. 6.1.0 reached GA 2026-05-19; 5.14.x is still maintained. Plan migrations toward JUnit 6. [JUnit 6.0.0 release coverage](https://earezki.com/ai-news/2025-10-20-junit-600-ships-with-java-17-baseline-cancellation-api-and-kotlin-suspend-support/) · [JUnit current release notes (docs.junit.org)](https://docs.junit.org/current/release-notes.html)
- **Base migrations entrenched under 6.x**: `@RunWith(JUnitPlatform.class)` / `org.junit.platform.runner` → `@Suite` (`junit-platform-suite`); `MethodOrderer.Alphanumeric` → `MethodName`. [JUnit current release notes (docs.junit.org)](https://docs.junit.org/current/release-notes.html)
- **Kotlin baseline contested**: primary docs (docs.junit.org) state Kotlin 2.1; some secondary coverage claims 2.2 — treat 2.1 as authoritative. [JUnit current release notes (docs.junit.org)](https://docs.junit.org/current/release-notes.html)
- The Jupiter programming model (lifecycle annotations, parameterized tests, extensions) and the AAA (arrange-act-assert) structure carry forward unchanged at the conceptual level.
