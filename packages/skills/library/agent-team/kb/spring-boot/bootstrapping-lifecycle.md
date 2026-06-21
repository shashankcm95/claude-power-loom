---
kb_id: spring-boot/bootstrapping-lifecycle
version: 1
tags:
  - spring-boot
  - bootstrapping
  - lifecycle
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-boot-bootstrap"
  - "Baeldung tutorials (eugenp/tutorials) module: spring-boot-ctx-fluent"
  - "Spring Boot 4.0 Migration Guide (github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide)"
related:
  - spring-boot/auto-configuration
  - spring-boot/externalized-configuration
  - spring-boot/runtime-performance
status: active
---

## Summary

**Concept**: How a Boot app starts, runs startup logic, builds context hierarchies, and shuts down cleanly.
**Key APIs**: `@SpringBootApplication` (= `@SpringBootConfiguration` + `@EnableAutoConfiguration` + `@ComponentScan`), `SpringApplication.run`, `CommandLineRunner`/`ApplicationRunner`, `@PostConstruct`/`@PreDestroy`, `SpringApplicationBuilder`, `ExitCodeGenerator`.
**Gotcha**: `@Service` on an interface/abstract class creates no bean (put it on the concrete impl); slices walk *up* package levels for `@SpringBootConfiguration`.
**2026-currency**: model unchanged through Boot 4.0; `@PostConstruct`/`@PreDestroy` are now `jakarta.annotation.*`.
**Sources**: Baeldung `spring-boot-bootstrap` / `-ctx-fluent`; Spring Boot 4.0 migration guide.

## Quick Reference

**Entry point**: annotate the main class `@SpringBootApplication` and call `SpringApplication.run(App.class, args)`. The meta-annotation decomposes into `@SpringBootConfiguration` (the single bean-definition source per app) + `@EnableAutoConfiguration` + `@ComponentScan`. All three can be used standalone; `@SpringBootConfiguration` can run bare with a hand-written `@ComponentScan`.

**Explicit scan control** (when packages diverge from the main-class package): `@SpringBootApplication(scanBasePackages=...)`, `@EnableJpaRepositories`, `@EntityScan`, `@ServletComponentScan`, `@EnableTransactionManagement`. Default scan root = the annotated class's package and below.

**Startup logic — the full menu** (runs in roughly this order): constructor logic → `@PostConstruct` → `InitializingBean.afterPropertiesSet` → `@Bean(initMethod=...)` → `CommandLineRunner.run(String...)` / `ApplicationRunner.run(ApplicationArguments)` → `@EventListener(ContextRefreshedEvent)`. `CommandLineRunner` is the canonical DB-seed hook:

```java
@Bean
CommandLineRunner seed(FooRepository repo) {
    return args -> repo.save(new Foo("init"));
}
```

**Context hierarchies**: `new SpringApplicationBuilder().parent(P).web(WebApplicationType.NONE).child(C1).web(SERVLET).sibling(C2).run(args)`. Give each child a distinct `server.port` / `server.servlet.context-path` and a distinct JMX `spring.application.admin.jmx-name` to avoid `MBean already registered`.

**Shutdown & exit**: `@PreDestroy`, `DisposableBean`, `@Bean(destroyMethod=...)`, `ConfigurableApplicationContext.close()`. For exit codes: `ExitCodeGenerator.getExitCode()`, then `System.exit(SpringApplication.exit(ctx, generators...))` — the result MUST be passed to `System.exit`.

**Top gotchas**:
- `@Service` on an interface/abstract class creates no bean — it belongs on the concrete impl.
- `@DataJpaTest`/`@WebMvcTest` discover config by walking *up* package levels; a `@SpringBootApplication` placed deeper than the test is not found.
- A `CommandLineRunner` will fire in tests unless guarded (`@Profile("!test")`, test props, or `ConfigDataApplicationContextInitializer`).

**Current (mid-2026)**: the bootstrap model is unchanged through Spring Boot 4.0. `@PostConstruct`/`@PreDestroy` moved from `javax.annotation` to `jakarta.annotation` in Boot 3. Graceful shutdown is now built in (`server.shutdown=graceful`), superseding the manual `ThreadPoolTaskExecutor.setWaitForTasksToCompleteOnShutdown(true)` + `@PreDestroy` pattern.

## Full content

A Spring Boot application is a Spring `ApplicationContext` plus an opinionated assembly process. The single annotation `@SpringBootApplication` on the main class plus `SpringApplication.run(...)` is the whole bootstrap. Understanding the composite annotation matters because each part can be used independently when the default assembly is too coarse.

### The composite entry point

`@SpringBootApplication` = `@SpringBootConfiguration` (marks the one bean-definition source per app) + `@EnableAutoConfiguration` (turns on classpath-driven auto-config) + `@ComponentScan` (discovers `@Component`/`@Service`/`@Repository`/`@Controller`). The Baeldung `spring-boot-bootstrap` module demonstrates the bare-`@SpringBootConfiguration` form and the standalone use of `@EnableAutoConfiguration` + `@ComponentScan` (`-basic-customization-2`). When scan packages diverge from the main-class package, spell them out: `scanBasePackages`, `@EnableJpaRepositories`, `@EntityScan`, `@ServletComponentScan`.

### Component scanning fundamentals

The default scan root is the annotated class's package and everything below it. `@ComponentScan` filters narrow or widen this: `includeFilters`/`excludeFilters` with `FilterType.ANNOTATION` / `ASSIGNABLE_TYPE` / `REGEX`, including a custom-annotation-as-marker filter (`spring-boot-di`).

### Startup logic options

Boot offers a menu of startup hooks: constructor logic, `@PostConstruct`, `InitializingBean.afterPropertiesSet`, `@Bean(initMethod=...)`, `CommandLineRunner.run(String...)`, `ApplicationRunner.run(ApplicationArguments)`, `@EventListener(ContextRefreshedEvent)`, and `ApplicationListener<ContextRefreshedEvent>` (`spring-boot-data`). `CommandLineRunner` is the canonical database-seed hook, used across the `-angular`, `-react`, and `-bootstrap` modules.

### Context hierarchies

`SpringApplicationBuilder` exposes a fluent `.parent().child().sibling()` API with per-context `web(WebApplicationType.NONE/SERVLET)`; beans inherit and can be overridden across the hierarchy (`spring-boot-ctx-fluent`). Each context needs distinct ports, context-paths, and JMX names.

### Shutdown, exit, restart

Cleanup hooks mirror startup: `@PreDestroy`, `DisposableBean`, `@Bean(destroyMethod=...)`, and `ServletContextListener` via `ServletListenerRegistrationBean`. `ConfigurableApplicationContext.close()` triggers them. Exit codes flow through `ExitCodeGenerator` (a bean, an exception that implements it, or an `ExitCodeEvent`); `SpringApplication.exit(ctx, generators...)` computes the code and its return value must be handed to `System.exit(...)`. Restart means closing and re-running the context on a non-daemon thread, or using Spring Cloud's `RestartEndpoint` (`spring-boot-runtime`).

### Lazy initialization

Boot 2.2+ supports `spring.main.lazy-initialization=true` (or `SpringApplication.setLazyInitialization` / `SpringApplicationBuilder.lazyInitialization`), which defers bean creation and moves error surfaces to first use (`spring-boot-performance`).

### 2026 currency

- **`javax.* → jakarta.*` done.** `@PostConstruct`/`@PreDestroy` are now `jakarta.annotation.*`; any 2021 sample using `javax.annotation` must be migrated. Spring Boot 3 / Spring Framework 6 (Nov 2022) moved to the `jakarta.*` namespace on a Java 17 baseline; Boot 4.0 advances to Jakarta EE 11. [Spring Boot 4.0 Migration Guide](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide)
- **Graceful shutdown is built in.** `server.shutdown=graceful` replaces the manual executor-drain + `@PreDestroy` pattern the 2021 snapshot used (it was not wired in the corpus).
- **The bootstrap model carries forward unchanged** at the concept level — the auto-configuration / starter / `@SpringBootApplication` model is confirmed still-current in Boot 4.0. [Spring Boot 4.0.0 available now](https://spring.io/blog/2025/11/20/spring-boot-4-0-0-available-now/)
- **Boot 4.0 testing change**: `@SpringBootTest` no longer auto-wires `MockMvc`/`TestRestTemplate`; add `@AutoConfigureMockMvc` / `@AutoConfigureTestRestTemplate` (relevant when bootstrapping the test context). [Spring Boot 4.0 Migration Guide](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide)
