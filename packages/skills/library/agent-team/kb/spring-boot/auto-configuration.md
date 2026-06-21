---
kb_id: spring-boot/auto-configuration
version: 1
tags:
  - spring-boot
  - auto-configuration
  - conditional-beans
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-boot-autoconfiguration"
  - "Baeldung tutorials (eugenp/tutorials) module: spring-boot-custom-starter"
  - "Spring Boot 4.0 Migration Guide (github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide)"
related:
  - spring-boot/bootstrapping-lifecycle
  - spring-boot/build-packaging
  - spring-boot/externalized-configuration
  - spring-boot/testing
  - spring-boot/persistence-jpa
status: active
---

## Summary

**Concept**: Classpath-driven conditional bean registration — the mechanism behind Boot's "it just works", and how to write your own auto-config + custom starter.
**Key APIs**: `@Configuration` registered in `AutoConfiguration.imports`, the `@ConditionalOnX` family, `@AutoConfigureOrder`, `SpringBootCondition`/`ConditionOutcome`, `ApplicationContextRunner`.
**Gotcha**: registration file is load-bearing — a missing entry = silently never picked up; `@ConditionalOnBean` is order-sensitive (only sees already-defined beans).
**2026-currency**: registration moved off `spring.factories` to `META-INF/spring/...AutoConfiguration.imports` (deprecated Boot 2.7, removed Boot 3).
**Sources**: Baeldung `spring-boot-autoconfiguration` / `-custom-starter`; Spring Boot 4.0 migration guide.

## Quick Reference

**Custom auto-config**: a `@Configuration` class gated by conditions, registered in a discovery file:

```java
@Configuration
@ConditionalOnClass(DataSource.class)
@AutoConfigureOrder(Ordered.HIGHEST_PRECEDENCE)
public class MySQLAutoconfiguration {
    @Bean
    @ConditionalOnProperty(name = "usemysql", havingValue = "local")
    @ConditionalOnMissingBean
    DataSource dataSource() { ... }
}
```

**Registration** (load-bearing): pre-Boot-2.7 was `META-INF/spring.factories` under the `org.springframework.boot.autoconfigure.EnableAutoConfiguration=` key; current is one line per class in `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`.

**The `@ConditionalOnX` family**: `@ConditionalOnClass`, `@ConditionalOnMissingClass`, `@ConditionalOnBean`, `@ConditionalOnMissingBean`, `@ConditionalOnProperty(name, havingValue, matchIfMissing)`, `@ConditionalOnResource`, `@ConditionalOnWarDeployment`, `@ConditionalOnEnabledHealthIndicator`. `@ConditionalOnMissingBean` is the override-friendliness idiom — user beans win.

**Custom conditions**: implement `Condition.matches(...)` + `@Conditional(...)`, or extend `SpringBootCondition` returning a descriptive `ConditionOutcome.match/noMatch(ConditionMessage...)` (gives good condition-report logging); `AnyNestedCondition` with a `ConfigurationPhase` for composite logic.

**Disabling auto-config**: `@SpringBootApplication(exclude={...})`, `@EnableAutoConfiguration(exclude=...)`, or the `spring.autoconfigure.exclude` property — e.g. excluding `DataSourceAutoConfiguration`, `SecurityAutoConfiguration`.

**Custom starter anatomy** (the triplet): a *library* jar + an *autoconfigure* module (`@Configuration` + `@EnableConfigurationProperties(XProperties.class)` + `@ConditionalOnMissingBean` + the registration file) + a thin *starter POM* with no Java, only dependencies.

**Isolated testing**: `new ApplicationContextRunner().withUserConfiguration(C.class).withPropertyValues("k=v").run(ctx -> assertThat(ctx).hasBean("x").doesNotHaveBean("y"))` — fast, no server.

**Top gotchas**:
- A missing registration entry = the config is silently never applied (it runs before/outside component scanning).
- `@ConditionalOnBean` only sees already-defined beans → use `@AutoConfigureOrder` so dependency beans exist first.

**Current (mid-2026)**: registration via `spring.factories` for `EnableAutoConfiguration` was removed in Boot 3; use `AutoConfiguration.imports`. `FailureAnalyzer`/`EnvironmentPostProcessor` registration via `spring.factories` is *still valid*. Boot 4.0 ships modular autoconfigure jars.

## Full content

Auto-configuration is the heart of Spring Boot's "convention over configuration": Boot inspects the classpath and the existing bean definitions and conditionally registers infrastructure beans (a `DataSource`, a `DispatcherServlet`, a `JacksonObjectMapper`) so the developer rarely writes them by hand. The same mechanism is exposed for library authors to ship drop-in starters.

### Writing a custom auto-config

A custom auto-config is just a `@Configuration` class whose `@Bean` methods are guarded by `@ConditionalOnX` annotations and whose registration lives in a discovery file rather than being component-scanned (because auto-config must run before the app's own scanning). The Baeldung `MySQLAutoconfiguration.java` example gates the whole class with `@ConditionalOnClass(DataSource.class)`, orders it `HIGHEST_PRECEDENCE`, and gates each bean with `@ConditionalOnProperty` + `@ConditionalOnMissingBean`.

### The conditional family

The `@ConditionalOnX` annotations test classpath presence, bean presence/absence, property values, resources, WAR deployment, and health-indicator enablement. `@ConditionalOnMissingBean` is the single most important idiom: it makes a library's bean a default that the user can override simply by declaring their own. Custom conditions extend `SpringBootCondition` and return a `ConditionOutcome` carrying a `ConditionMessage`, which produces a readable condition-evaluation report.

### Ordering

Because `@ConditionalOnBean` only observes beans already defined when the condition is evaluated, ordering matters. `@AutoConfigureOrder(Ordered.HIGHEST_PRECEDENCE)` ensures a producing auto-config runs before a consuming one that uses `@ConditionalOnBean`.

### Custom starter anatomy

A reusable starter is a triplet: a plain *library* jar with the real code; an *autoconfigure* module that wires the library's beans conditionally and declares `@EnableConfigurationProperties`; and a thin *starter POM* (`spring-boot-custom-starter`) that contains no Java and exists only to aggregate the dependencies a consumer needs.

### Testing in isolation

`ApplicationContextRunner` spins up a minimal context per test with chosen user configuration and property values, then asserts on bean presence/absence — far faster than a full `@SpringBootTest` and the idiomatic way to test conditional logic.

### Infrastructure that runs before the context

`FailureAnalyzer` (pretty startup-failure messages) and `EnvironmentPostProcessor` (mutating the `Environment` before context creation) run before the context exists, so they are registered via `spring.factories`, never component-scanned (`spring-boot-basic-customization`, `-environment`).

### 2026 currency

- **Registration moved off `spring.factories`.** The `EnableAutoConfiguration` key was deprecated in Boot 2.7 and removed in Boot 3 → `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`. The custom-auto-config *mechanism* is otherwise unchanged — only the registration file moved. `FailureAnalyzer`/`EnvironmentPostProcessor` via `spring.factories` remain valid. [Spring Boot 4.0 Migration Guide](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide)
- **The `@ConditionalOnX` family and `ApplicationContextRunner` carry forward unchanged** — confirmed still-current and forward-looking; only version numbers move. [Spring Boot 4.0.0 available now](https://spring.io/blog/2025/11/20/spring-boot-4-0-0-available-now/)
- **Boot 4.0 modularizes the autoconfigure jars** and renamed several starters (`spring-boot-starter-web` → `spring-boot-starter-webmvc`; Flyway/Liquibase now need explicit starters). [Spring Boot 4.0 Migration Guide](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide)
