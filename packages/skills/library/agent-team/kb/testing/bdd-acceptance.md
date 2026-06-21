---
kb_id: testing/bdd-acceptance
version: 1
tags:
  - testing
  - cucumber
  - bdd
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: cucumber, rest-testing (cucumber/jbehave/karate), testing-libraries (cucumber), libraries-testing (serenity), groovy-spock"
  - "Cucumber-JVM releases — github.com/cucumber/cucumber-jvm (https://github.com/cucumber/cucumber-jvm/releases)"
  - "Spock 2.4-M5 modules docs — spockframework.org (https://spockframework.org/spock/docs/2.4-M5/modules.html)"
related:
  - testing/junit5-jupiter
  - testing/rest-api-testing
  - testing/spring-testcontext
  - testing/mockito
status: active
---

## Summary

**Concept**: Behavior-driven / acceptance testing — express tests as human-readable specifications. **Cucumber** (Gherkin Given/When/Then) is the canonical tool; **Serenity** adds living-documentation reporting; **JBehave** (story-based), **Karate** (API DSL on the Cucumber engine), and **Spock** (Groovy `given/when/then` blocks) round out the space.
**Key APIs**: Cucumber `.feature` files + step defs (`io.cucumber.java.en.*`, cucumber-expressions `{int}`/`{string}`), `@Before/@After` hooks (tag-scoped), `DataTable`, Scenario Outline + Examples, Background, `@CucumberContextConfiguration` (Spring); Serenity `@Steps`/`@Step`, Screenplay (Actor/Task/Question); Spock `Specification`, `where:` data tables, `thrown(Type)`.
**Gotcha**: Cucumber hooks should be public (`private @Before` is fragile); `cucumber-glue` scope is essential so step/context beans reset per scenario (singleton scope leaks state).
**2026-currency**: Cucumber-JVM 7.x — registry-based `DataTableType` removed (now `@DataTableType` methods), `@Cucumber` annotation removed → `@Suite` + `@IncludeEngines("cucumber")`; Spock 2.x runs on the JUnit 5 Platform; Karate group moved to `io.karatelabs:karate-core`; Serenity 4.x needs JDK 17.
**Sources**: Baeldung `cucumber`/`rest-testing`/`testing-libraries`/`libraries-testing`/`groovy-spock`; Cucumber-JVM + Spock releases.

## Quick Reference

**Cucumber (Gherkin)**:
```gherkin
Scenario Outline: add two numbers
  Given the calculator
  When I add <a> and <b>
  Then the result is <sum>
  Examples: | a | b | sum |
            | 1 | 2 | 3   |
```
Step defs in `io.cucumber.java.en.*` (regex or cucumber-expressions `{int}`/`{string}`); hooks `@Before/@After/@BeforeStep` (tag-scoped `@Before("@ui")`, ordered); `DataTable.asLists/asMaps/cells` + custom `DataTableType`/`TableTransformer`; Background; Java 8 lambda steps (`implements En`, steps in constructor). **Runners**: legacy `@RunWith(Cucumber.class)` + `@CucumberOptions`; JUnit-5-Platform `@Cucumber`; **Spring** via `@CucumberContextConfiguration` + `cucumber-glue` scope. Tags (`@ui`/`@api`) select scenarios and route hooks.

**Serenity BDD** (living docs on JUnit 4): `@Steps`/`@Step` step libraries, `SerenityRunner`, Page Objects + **Screenplay** (Actor/Task/Question/Ability), Spring DI (`SpringIntegrationSerenityRunner`), `SerenityRest` (REST-Assured), JBehave integration.

**JBehave** (story-based): extend `JUnitStories`, `configuration()`/`stepsFactory()`/`storyPaths()`, `@Given/@When/@Then` with `$param`, `.story` files.

**Karate**: DSL API testing on the Cucumber engine — assertions in `.feature` (`Given url`, `When method GET`, `Then status 200`, `match`/`contains`, fuzzy markers `#notnull`).

**Spock (Groovy)**: `class X extends Specification`; string-named feature methods; blocks `given/when/then/expect/where`; data-driven `where:` tables; exceptions `thrown(Type)`; mocks `Stub/Mock/Spy`.

**Top gotchas**:
- Cucumber hooks should be public; mixing annotation-based and `io.cucumber.java8.En` lambda steps needs package isolation to avoid glue ambiguity.
- `cucumber-glue` scope is essential — singleton-scoped step/context beans leak state across scenarios.

**Current (mid-2026)**: Cucumber-JVM 7.34.3; Spock 2.4-M6 on the JUnit 5 Platform; Karate `io.karatelabs:karate-core` 1.5.x/2.x; Serenity 4.x (JDK 17).

## Full content

BDD/acceptance tools push tests up to the specification level: the test artifact is readable by non-developers (Gherkin `.feature` files, Spock string-named features) and often doubles as living documentation.

### Cucumber — the canonical Gherkin tool

A `.feature` file holds Given/When/Then scenarios; step-definition methods (matched by regex or cucumber-expressions) bind each step to code. **Hooks** (`@Before`/`@After`, optionally tag-scoped) run setup/teardown; **Data tables**, **Scenario Outline + Examples**, and **Background** reduce duplication. The Spring integration (`@CucumberContextConfiguration` + the `cucumber-glue` scope) is the load-bearing detail: glue-scoped beans reset per scenario, so shared state doesn't leak between scenarios. Tags route both scenario selection and hook execution.

### Serenity, JBehave, Karate, Spock

**Serenity** layers rich living-documentation reporting (and the Screenplay pattern — Actors performing Tasks, asking Questions) over JUnit 4 + Cucumber/JBehave. **JBehave** is the older story-based engine. **Karate** repurposes the Cucumber engine for API testing, putting the assertions directly in the `.feature` DSL. **Spock** is a Groovy spec framework whose `given/when/then/expect/where` blocks unify test structure, data-driven tables, and mocking in one expressive syntax.

### 2026 currency

- **Cucumber-JVM is on 7.x.** Registry-based `DataTableType`/`TypeRegistry`/`TypeRegistryConfigurer` removed in Cucumber 5+ (now `@DataTableType`-annotated methods); `io.cucumber.core.api.Scenario` → `io.cucumber.java.Scenario`; the `@Cucumber` annotation removed in 7.x → `@Suite` + `@IncludeEngines("cucumber")` on the JUnit Platform. Current is cucumber-jvm 7.34.3 (2026-03-04). [Cucumber-JVM releases (GitHub)](https://github.com/cucumber/cucumber-jvm/releases)
- **Spock 2.x runs on the JUnit 5 Platform** (latest milestone 2.4-M6, 2025-04-15 — not yet final GA; for Groovy 2.5/3.0/4.0). [Spock 2.4-M5 modules docs](https://spockframework.org/spock/docs/2.4-M5/modules.html) · [Spock 2.0 release notes](https://spockframework.org/spock/docs/2.0/release_notes.html)
- **Karate** migrated its Maven group from `com.intuit.karate` to `io.karatelabs:karate-core` (1.5.x/2.x); modern Karate 1.x has its own JUnit 5 runner with no Cucumber dependency — the old `cucumber.api` import is gone. [karate-core 1.5.0 (Maven Central)](https://mvnrepository.com/artifact/io.karatelabs/karate-core/1.5.0)
- **Serenity 4.x** requires JDK 17 with restructured packages (away from legacy `net.thucydides.*`). [Migrating to Serenity 4 (docs)](https://serenity-bdd.github.io/docs/tutorials/migrating_to_serenity_4)
- **JBehave 4.x** and **lambda-behave** are dated/abandoned. BDD with Gherkin/Cucumber carries forward as a current idiom.
