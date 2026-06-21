---
kb_id: spring-boot/actuator
version: 1
tags:
  - spring-boot
  - actuator
  - observability
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-boot-actuator"
  - "Baeldung tutorials (eugenp/tutorials) module: spring-boot-admin"
  - "Spring Boot 4.0 Migration Guide (github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide)"
related:
  - spring-boot/error-handling
  - spring-boot/observability-logging
  - spring-boot/security
  - spring-boot/build-packaging
status: active
---

## Summary

**Concept**: Production-readiness endpoints — health, info, metrics, liveness/readiness probes, runtime log levels, and the management surface.
**Key APIs**: `HealthIndicator#health()` → `Health.up()/down()`, `InfoContributor#contribute`, `ApplicationAvailability`/`LivenessState`/`ReadinessState`/`AvailabilityChangeEvent`, Micrometer `MeterRegistry`, `management.endpoints.web.exposure.include`, `EndpointRequest.toAnyEndpoint()`.
**Gotcha**: `exposure.include=*` exposes `/shutdown` unauthenticated; CSRF must be ignored for state-changing endpoints.
**2026-currency**: HTTP Tracing (`HttpTraceRepository`) renamed in Boot 3 → `httpexchanges` (`HttpExchangeRepository`); probes/availability current; Boot-1 `Endpoint<T>` SPI gone.
**Sources**: Baeldung `spring-boot-actuator` / `-admin`; Spring Boot 4.0 migration guide.

## Quick Reference

**Endpoint model (Boot 2+)**: `management.endpoints.web.exposure.include=*` (or a list), per-endpoint `management.endpoint.<id>.enabled`, `management.server.port` for a separate management port. (The Boot-1 `management.port` / `endpoints.*` / `management.security.enabled` tree and the `Endpoint<T>` SPI are obsolete.)

**Custom health indicator**:

```java
@Component
class DownstreamHealth implements HealthIndicator {
    public Health health() {
        return reachable() ? Health.up().build()
                           : Health.down().withDetail("error", code).build();
    }
}
```

`@ConditionalOnEnabledHealthIndicator` gates it; `HttpCodeStatusMapper` + `management.endpoint.health.status.http-mapping.*` map status → HTTP code.

**Liveness/readiness probes (Boot 2.3+, K8s)**: `/actuator/health/{liveness,readiness}`; inject `ApplicationAvailability`; publish transitions with `AvailabilityChangeEvent.publish(ctx, LivenessState.BROKEN)` and react via `@EventListener`. Liveness DOWN → 503; readiness REFUSING → 503/OUT_OF_SERVICE. Enable with `management.endpoint.health.probes.enabled=true`.

**Info**: `InfoContributor#contribute(Info.Builder)` + static `info.*` props (placeholders like `${java.specification.vendor}`).

**Other endpoints**: `/beans`, `/mappings`, `/loggers` (runtime log-level POST), `/shutdown` (disabled by default), metrics via Micrometer `MeterRegistry`. HTTP Tracing's `HttpTraceRepository`/`HttpTrace` were renamed in Boot 3 to `HttpExchangeRepository`/`HttpExchange` (the `httpexchanges` endpoint).

**Securing the surface**: `EndpointRequest.toAnyEndpoint()` restricted to a role in the security config.

**Spring Boot Admin** (codecentric, third-party): `@EnableAdminServer` UI over Actuator, self-registering clients, CSRF carve-outs for the registration endpoints (`CookieCsrfTokenRepository.withHttpOnlyFalse`), notifier composition, Hazelcast clustering.

**Top gotchas**:
- `exposure.include=*` exposes `/shutdown` — dangerous unauthenticated; the `restart` endpoint is NOT standard Boot (needs Spring Cloud).
- CSRF must be disabled/ignored for state-changing Actuator endpoints.

**Current (mid-2026)**: HTTP Tracing was renamed in Boot 3 → the `httpexchanges` endpoint (`HttpExchangeRepository`). Availability/probes are current in Boot 3/4. Metrics remain Micrometer-based (Micrometer Tracing for distributed tracing).

## Full content

The Spring Boot Actuator exposes operational endpoints for monitoring and managing a running application. The corpus contrasts the obsolete Boot-1 model with the current Boot-2+ one, which is the foundation for everything since.

### Endpoint model

In Boot 2+ endpoints are exposed via `management.endpoints.web.exposure.include`, individually toggled with `management.endpoint.<id>.enabled`, and optionally served on a separate `management.server.port`. This replaced the Boot-1 property tree and the `Endpoint<T>` SPI (`getId`/`isSensitive`/`invoke`) entirely.

### Health, probes, and info

A custom `HealthIndicator` reports `Health.up()/down()/status(...)` with details, contributing to the aggregate `/actuator/health`. Kubernetes-aligned liveness/readiness probes (Boot 2.3+) split health into `/actuator/health/liveness` and `/readiness`, driven by `ApplicationAvailability` state and `AvailabilityChangeEvent` publications — a liveness failure tells the orchestrator to restart the pod, a readiness failure to stop routing traffic. `InfoContributor` and static `info.*` properties populate `/actuator/info`.

### Metrics and other endpoints

Metrics are collected through Micrometer's `MeterRegistry`, exportable to many backends. `/beans`, `/mappings`, and `/loggers` (which supports runtime log-level changes via POST) round out the diagnostic surface; `/shutdown` exists but is disabled by default.

### Operations tooling

Spring Boot Admin (a codecentric third-party project) layers a UI over Actuator with self-registering clients, notifier composition, and clustering. Chaos Monkey for Spring Boot injects faults (latency/exception/kill assaults) through a profile + Actuator for resilience testing.

### Security note

Exposing all endpoints (`include=*`) without authentication is dangerous — `/shutdown` and other state-changing endpoints must be protected, and CSRF disabled for them. See [spring-boot/security](security.md) for `EndpointRequest`-based lockdown.

### 2026 currency

- **HTTP Tracing renamed.** The `HttpTraceRepository`/`HttpTrace`/`HttpTraceFilter` API (`management.trace.http.*`) was renamed in Boot 3 → the `httpexchanges` endpoint backed by `HttpExchangeRepository` (in `org.springframework.boot.actuate.web.exchanges`). [Spring Boot 3.0 Migration Guide](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-3.0-Migration-Guide#actuator)
- **Availability/probes carry forward.** `ApplicationAvailability`, liveness/readiness, and `AvailabilityChangeEvent` are current in Boot 3/4 — confirmed still-true; the actuator-for-observability principle holds with only the HTTP-tracing endpoint name changed. [Spring Boot 4.0.0 available now](https://spring.io/blog/2025/11/20/spring-boot-4-0-0-available-now/)
- **Structured JSON logging (Boot 3.4)** complements Actuator observability — `ecs`/`gelf`/`logstash` console/file formats via `logging.structured.format.*`. See [spring-boot/observability-logging](observability-logging.md). [Spring Boot 3.4 Release Notes — Structured Logging](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-3.4-Release-Notes#structured-logging)
