---
kb_id: spring-core/ioc-container-di
version: 1
tags:
  - spring-core
  - dependency-injection
  - ioc-container
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-core / spring-di / spring-di-2"
  - "Spring Framework Versions (official wiki, github.com/spring-projects/spring-framework/wiki/Spring-Framework-Versions)"
related:
  - spring-core/bean-lifecycle-extension
  - spring-core/spring-aop
status: active
---

## Summary

**Concept**: The Spring IoC container manages bean lifecycle + wiring; dependency injection supplies collaborators rather than `new`-ing them.
**Key APIs**: `ApplicationContext` (`AnnotationConfigApplicationContext`), `@Component`/`@Bean`/`@Configuration`, `@Autowired`/`@Resource`/`@Inject`, `@Qualifier`/`@Primary`, `@Scope`, `@Profile`, `@Value`/SpEL.
**Gotcha**: `@Value` on a `static` field is silently ignored (route through a non-static setter); ambiguous candidates throw `NoUniqueBeanDefinitionException`.
**2026-currency**: Programming model carries 1:1 to Spring 6/7; only `javax.inject`/`javax.annotation` → `jakarta.*` and JDK 17 baseline changed.
**Sources**: Baeldung `spring-core`/`spring-di`; Spring Framework wiki.

## Quick Reference

**The container**: `ApplicationContext` is the production container (eager singleton init, `BeanPostProcessor` auto-registration, events, i18n) vs the legacy `BeanFactory` (lazy, none of those). Concrete impls: `AnnotationConfigApplicationContext`, `ClassPathXmlApplicationContext`, `FileSystemXmlApplicationContext`, plus web variants `AnnotationConfigWebApplicationContext` / `GenericWebApplicationContext`.

**Declaring beans**: `@Component` + stereotypes (`@Service`/`@Repository`/`@Controller`), `@Bean` factory methods in a `@Configuration` class, or component-scan. A `@Component` outside a scanned base package is NOT registered. `@ComponentScan.Filter(type=ANNOTATION|ASSIGNABLE_TYPE|ASPECTJ|REGEX|CUSTOM)` narrows discovery; a custom `TypeFilter.match(MetadataReader,...)` reads ASM-level metadata (no class loading).

**Injection styles**: field / setter / constructor `@Autowired`. A single-constructor bean needs no `@Autowired` since Spring 4.3 (implicit constructor injection); Lombok `@RequiredArgsConstructor` wires `final` fields. `@Autowired(required=false)` leaves a field null with no candidate.

**Three injection annotations**:
- `@Autowired` (Spring) — by-type, then by-name via `@Qualifier`
- `@Resource` (JSR-250) — by-name first
- `@Inject` (JSR-330) — by-type, pairs with `@Qualifier`/`@Named`

**Disambiguation**: `@Qualifier("name")` + custom `@Qualifier`-meta annotations; `@Primary` picks a default. Ambiguity → `NoUniqueBeanDefinitionException`.

**Scopes**: singleton (default), prototype, web scopes `@RequestScope`/`@SessionScope`/`@ApplicationScope`/websocket.

**Collection injection**: `@Autowired List<T>`/`Set<T>`/`Map<String,T>` auto-collects all beans of a type; order with `@Order(n)`; `ObjectProvider.getIfUnique()`/`getIfAvailable()` for optional resolution.

**Profiles & properties**: `@Profile("dev")`, `Environment.getActiveProfiles()`, `@PropertySource`, `@Value("${prop}")` / `@Value("#{SpEL}")`.

**Top gotchas**:
- `@Value` on a `static` field stays null — write it via a non-static setter.
- Collection default-to-empty idiom: `@Value("${list:}#{T(Collections).emptyList()}")`.
- XML legacy: `<context:annotation-config>` (activates annotations on already-registered beans) vs `<context:component-scan>` (discovers + registers — a superset).

**Current (mid-2026)**: The DI/IoC programming model is "still valid as-is" — the durable core. On Spring 6/7, `javax.inject.@Inject` and `javax.annotation.@PostConstruct` become `jakarta.*`; Java 17 is the floor (Spring 6/7), with engineers targeting Java 21 or 25.

## Full content

The Inversion-of-Control container is the spine of Spring: an object whose lifecycle the container manages is a *bean*, declared via stereotypes, `@Bean` factory methods, or component-scan. `ApplicationContext` is the production container; the legacy `BeanFactory` is lazy and lacks auto-`BeanPostProcessor` registration, events, and i18n.

### Wiring mechanics

Injection resolves by type then name. `@Qualifier` disambiguates; `@Primary` designates a default among candidates. `@DependsOn` orders bean creation (it does NOT inject). Circular dependencies trigger `BeanCurrentlyInCreationException`, broken via setter injection, `@Lazy`, or an `ApplicationContextAware` + `InitializingBean` lazy lookup. `@Import` aggregates `@Configuration` classes; functional registration via `GenericApplicationContext.registerBean(Class, Supplier, customizer)` (default bean name = FQCN).

### Bean naming and composed annotations

Default names derive in camelCase from the class; override with `@Component("n")` / `@Bean("n")`. `@AliasFor` builds composed annotations (explicit meta-override `@AliasFor(annotation=, attribute=)` plus implicit intra-annotation aliases) — exactly how `@GetMapping` is built over `@RequestMapping`.

### Null-safety and i18n

`@NonNull`/`@Nullable`/`@NonNullApi`/`@NonNullFields` (package-level via `package-info.java`) document nullability for tooling. Internationalization: `MessageSource` / `ResourceBundleMessageSource` / `ReloadableResourceBundleMessageSource` with `LocaleChangeInterceptor` + `CookieLocaleResolver`/`SessionLocaleResolver`. The resource abstraction (`Resource`/`ClassPathResource`, `ResourceLoader.getResource("classpath:...")`, `@Value("classpath:...")`) loads files uniformly.

### Pitfalls

- A `@Value`-annotated `static` field is provably never injected — the indirection through a non-static setter is mandatory.
- A `@Component` outside any scanned base package is silently absent.
- Hardcoded credentials in source recur throughout the Baeldung corpus (JNDI props, OAuth keys, Vault tokens) — teaching artifacts, but the canonical "no secrets in source" anti-pattern.

### 2026 currency

The IoC/DI model is in the base doc's "still valid as-is (the durable core)" list and the 2026 Update confirms it "transfers 1:1." The migration is namespace-and-API, not conceptual:

- **`javax.* → jakarta.*` is THE dominant change.** Spring Framework 6.0 (Nov 2022) moved to a Jakarta EE 9 / Servlet 5.0 baseline; 6.2 is Jakarta EE 10; 7.0 is Jakarta EE 11. `javax.inject` / `javax.annotation` (`@PostConstruct`/`@PreDestroy`) become `jakarta.*`. [Spring Framework Versions (official wiki)](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-Versions)
- **Java 17 is the new baseline.** Spring 6.0 requires min JDK 17 (max tested 21) and 6.1 min JDK 17 (max tested 23); 6.2 supports JDK 17-25; 7.0 requires JDK 17 (recommends 25+). [Spring Framework Versions (official wiki)](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-Versions)
- **Current versions (mid-2026)**: Spring Framework 7.0.8 (2026-06-08); 6.2 (final 6.x) OSS EOL 2026-06-30. [Spring Framework | endoflife.date](https://endoflife.date/spring-framework)
- **Spring4Shell context.** CVE-2022-22965 (RCE via data-binding, CVSS 9.8) affected Spring 5.3.x < 5.3.18 / 5.2.x < 5.2.20; fixed in 5.3.18 / 5.2.20. The 2021-snapshot corpus pins Spring 5.3.7 — below the fix; never seed those pins as current. [NVD — CVE-2022-22965](https://nvd.nist.gov/vuln/detail/CVE-2022-22965)
