---
kb_id: spring-boot/externalized-configuration
version: 1
tags:
  - spring-boot
  - configuration
  - property-binding
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-boot-properties"
  - "Baeldung tutorials (eugenp/tutorials) module: spring-boot-environment"
  - "Spring Boot 4.0 Migration Guide (github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide)"
related:
  - spring-boot/bootstrapping-lifecycle
  - spring-boot/auto-configuration
  - spring-boot/validation
status: active
---

## Summary

**Concept**: The most concept-dense Boot cluster — type-safe and placeholder-based binding of external properties, conversion, validation, profiles, YAML, and Environment manipulation.
**Key APIs**: `@ConfigurationProperties(prefix=)` + `@EnableConfigurationProperties`, `@Value("${k:default}")` + SpEL, `@PropertySource`, `spring.config.import`, `EnvironmentPostProcessor`, `@Profile`, `spring-boot-configuration-processor`.
**Gotcha**: `${csv}` into `List<String>` yields a single-element list — use SpEL `#{'${csv}'.split(',')}`; a custom config converter must be `@ConfigurationPropertiesBinding`.
**2026-currency**: `@ConstructorBinding` redundant at class level in Boot 3 (records are the idiom); YAML multi-doc already on the Boot-2.4 `spring.config.activate.on-profile` side.
**Sources**: Baeldung `spring-boot-properties` / `-environment`; Spring Boot 4.0 migration guide.

## Quick Reference

**Type-safe binding** — `@ConfigurationProperties` over a POJO (flat values, `List`, `Map`, nested static classes, relaxed binding):

```java
@ConfigurationProperties(prefix = "mail")
@Validated
public class MailProperties {
    @NotBlank private String host;
    private List<String> defaultRecipients;
    private Map<String, String> additionalHeaders;
    private Credentials credentials;   // nested static class needs its own @Validated
}
```

Register via `@EnableConfigurationProperties(MailProperties.class)` (no `@Component` needed) or a `@Bean @ConfigurationProperties` factory method.

**Immutable config**: `@ConstructorBinding` with all-final fields (class-level in Boot 2.x; constructor-level / automatic in Boot 3; Java records are the modern idiom).

**Conversion**: built-in `Duration`/`DataSize` with `@DurationUnit`/`@DataSizeUnit`. A custom `Converter<String,T>` **must** be annotated `@ConfigurationPropertiesBinding` or binding ignores it.

**`@Value` placeholders**: `${key}`, `${key:default}`, blank `${key:}`, SpEL `#{...}` (Elvis `?:`, `split`, `systemProperties`). The classic gotcha: `@Value("${csv}") List<String>` yields a **single-element** list — use `@Value("#{'${csv}'.split(',')}")`.

**`@PropertySource`** (repeatable) + `Environment.getProperty`. It does NOT load `.yml`/JSON natively — supply a custom `PropertySourceFactory` (`YamlPropertiesFactoryBean`) or an `ApplicationContextInitializer`.

**YAML**: hierarchical binding, multi-document `---` with `spring.config.activate.on-profile` (Boot 2.4+, replaced the deprecated `spring.profiles:`), `spring.profiles.group`. Multi-doc `.properties` uses `#---`.

**External files**: `spring.config.import=file:./extra.properties,optional:file:/path/jdbc.properties` (Boot 2.4+, current).

**`EnvironmentPostProcessor`**: `postProcessEnvironment(env, app)` adds a `MapPropertySource` (e.g. rename OS env vars → dotted keys) before context creation; registered in `spring.factories`.

**Profiles**: `@Profile`, `@ActiveProfiles` (test), per-profile `application-<profile>.properties`.

**Config metadata**: the optional `spring-boot-configuration-processor` generates `META-INF/spring-configuration-metadata.json` (field Javadoc → IDE descriptions).

**Top gotchas**:
- `@RefreshScope` (Spring Cloud) + `POST /actuator/refresh` picks up `@ConfigurationProperties` changes, but a singleton `@Value` bean keeps the OLD value.
- A custom config converter without `@ConfigurationPropertiesBinding` is silently ignored.

**Current (mid-2026)**: `@ConstructorBinding` is redundant at class level in Boot 3 (single-constructor binds automatically); records are idiomatic. The snapshot already uses the new Boot-2.4 YAML/`spring.config.import` model, which carries forward. Boot 4.0 → 4.x hop offers `spring-boot-properties-migrator` for renamed keys.

## Full content

Externalized configuration is the broadest and deepest cluster in the Spring Boot corpus, spanning `spring-boot-properties`/`-2`/`-3`, `-environment`, and `-property-exp`. It covers two distinct binding styles plus everything around them.

### Type-safe binding with `@ConfigurationProperties`

`@ConfigurationProperties(prefix=...)` binds a whole subtree of properties onto a POJO with relaxed name matching (`mail.default-recipients` → `defaultRecipients`). It handles flat scalars, `List`, `Map`, and nested static classes; each nested class needing validation must carry its own `@Validated`. Register the type with `@EnableConfigurationProperties` (so it need not be a `@Component`) or via a `@Bean` factory method.

### Placeholder binding with `@Value`

`@Value` injects single values via `${...}` placeholders with `${key:default}` defaults and SpEL `#{...}` for computation. The most-bitten gotcha is comma-separated lists: a bare `${csv}` into a `List<String>` produces one element containing the whole string, so the SpEL form `#{'${csv}'.split(',')}` is required.

### Conversion and validation

Boot binds `Duration` and `DataSize` out of the box (with `@DurationUnit`/`@DataSizeUnit` defaults and suffixes like `9ns`). Custom conversions need a `Converter<String,T>` annotated `@ConfigurationPropertiesBinding`, without which the binder ignores it. Configuration validation rides on JSR-380 (`@NotBlank`, `@Min`/`@Max`, `@Pattern`, Hibernate `@Length`) via `@Validated`.

### Property sources and YAML

`@PropertySource` is repeatable but does not understand `.yml` or JSON without a custom `PropertySourceFactory`. YAML supports hierarchical binding and multi-document files separated by `---`, activated per-profile with `spring.config.activate.on-profile` (Boot 2.4+, which replaced the deprecated `spring.profiles:` key) and grouped via `spring.profiles.group`. External files are imported with `spring.config.import=file:...` / `optional:file:`.

### Mutating the Environment

`EnvironmentPostProcessor` runs before the context exists and can add or reshape property sources (a common use is mapping OS environment variables to dotted keys), registered in `spring.factories` under `org.springframework.boot.env.EnvironmentPostProcessor`. For runtime reload, Spring Cloud's `@RefreshScope` + `POST /actuator/refresh` re-binds `@ConfigurationProperties` but not singleton `@Value` beans.

### 2026 currency

- **`@ConstructorBinding` redundant at class level.** In Boot 3 a single-constructor class binds automatically; the annotation is constructor-level only, and Java records are the modern immutable-config idiom. [Spring Boot 4.0 Migration Guide](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide)
- **The new YAML / `spring.config.import` model carries forward unchanged** — the 2021 snapshot is already on the Boot-2.4 side (`spring.config.activate.on-profile`, `spring.profiles.group`, `optional:file:`), and these remain current in Boot 4.0. [Spring Boot 4.0.0 available now](https://spring.io/blog/2025/11/20/spring-boot-4-0-0-available-now/)
- **`@ConfigurationProperties` binding + validation + conversion and `EnvironmentPostProcessor` registration are forward-looking** — only version numbers move; `EnvironmentPostProcessor` via `spring.factories` is still valid. [Spring Boot 4.0 Migration Guide](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide)
- **Renamed keys** between major lines (e.g. `logging.file` → `logging.file.name`, `management.port` → `management.server.port`, `server.tomcat.max-http-post-size` → `max-http-form-post-size`) are handled on upgrade by `spring-boot-properties-migrator`. [Spring Boot 4.0 Migration Guide](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide)
