---
kb_id: backend-dev/spring-boot-essentials
version: 1
tags: [backend, jvm, java, spring-boot, starter]
---

## Summary

Spring Boot essentials for HETS java-backend personas: convention over configuration; auto-configuration via `@SpringBootApplication`; profile-based config (`application-{profile}.yml`); dependency injection through constructor (avoid `@Autowired` on fields); explicit transaction boundaries via `@Transactional`; Actuator for health/metrics; structured logging with MDC. Stub doc — expand on use.

## Full content (starter — expand when first persona uses)

### Application bootstrap

```java
@SpringBootApplication
public class App {
    public static void main(String[] args) {
        SpringApplication.run(App.class, args);
    }
}
```

`@SpringBootApplication` = `@Configuration` + `@EnableAutoConfiguration` + `@ComponentScan`. Avoid manually declaring those three.

### Configuration

- `application.yml` for shared config; `application-{profile}.yml` for env-specific (dev / staging / prod)
- `@ConfigurationProperties` (typed) over `@Value` (string-typed)
- Secrets NEVER in repo; load from env vars or external secret store

### Dependency injection

- **Constructor injection only** in new code. Field injection (`@Autowired` on fields) hides dependencies and breaks immutability.
- Beans are singletons by default; explicitly `@Scope("prototype")` if you need per-request

### Transactions

- `@Transactional` on service methods, NOT on controllers
- Default propagation `REQUIRED`; understand when to use `REQUIRES_NEW`
- Rollback only on unchecked exceptions by default; use `rollbackFor = Exception.class` for checked

### Observability

- Spring Boot Actuator: `/actuator/health`, `/actuator/metrics`, `/actuator/prometheus`
- Logging: SLF4J + Logback; structured JSON for prod; MDC for request-scoped context (request ID, user ID)

### Common pitfalls

- Field injection in tests (use constructor + `@TestConstructor` or manual instantiation)
- Lazy initialization breaking startup-time validation
- N+1 queries from missing `@EntityGraph` or `JOIN FETCH`
- Mixing reactive (`Mono`/`Flux`) and blocking code without scheduler hops
- Custom `RestTemplate` instances per request (use a singleton with proper connection pool)

### Related KB docs (planned)

- `kb:backend-dev/jpa-orm-patterns` — JPA + Hibernate patterns
- `kb:backend-dev/jvm-runtime-basics` — heap, GC, threading
- `kb:backend-dev/observability-jvm` — Prometheus + Micrometer + OTel for JVM
