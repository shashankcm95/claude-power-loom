---
kb_id: build-devops/metrics-observability
version: 1
tags:
  - build-devops
  - metrics
  - observability
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: metrics, spf4j, jmeter"
  - "spring.io — OpenTelemetry with Spring Boot (https://spring.io/blog/2025/11/18/opentelemetry-with-spring-boot/)"
related:
  - build-devops/jmh-benchmarking
  - build-devops/kubernetes-iac
  - build-devops/jvm-runtime-modernization
status: active
---

## Summary

**Concept**: runtime application/JVM metrics, profiling, and load testing — the measurement layer that runs against a deployed app (vs JMH which measures code in isolation).
**Key APIs**: Dropwizard (`Meter`/`Counter`/`Histogram`/`Timer`/`Gauge`, `MetricRegistry`, `ConsoleReporter`, `HealthCheck`); Micrometer (`MeterRegistry`, `CompositeMeterRegistry`, `@Timed`); SPF4J (`MeasurementRecorder.record`, `@PerformanceMonitor`); JMeter (`jmeter-maven-plugin`, `.jmx` plan, `JSONPostProcessor`).
**Gotcha**: Micrometer counters ignore negative increments; SPF4J/`@Timed` rely on AspectJ weaving; JMeter `WorkBench` and `BeanShellPostProcessor` are removed/deprecated.
**2026-currency**: Micrometer + Micrometer Tracing is the live facade (the "SLF4J for metrics"); tracing bridges to OTLP via `micrometer-tracing-bridge-otel`; Netflix Servo and SPF4J are dead.
**Sources**: Baeldung `metrics`/`spf4j`/`jmeter`; spring.io OpenTelemetry-with-Spring-Boot.

## Quick Reference

**Dropwizard Metrics**:
- `MetricRegistry` → `.meter/.counter/.histogram/.timer(name)`; `Timer.Context` via `time()` then `stop()`/`close()`.
- `RatioGauge`/`CachedGauge`/`DerivativeGauge` (override `getRatio`/`loadValue`/`transform`).
- `ConsoleReporter.forRegistry(r).build().start(p,unit)`.
- `HealthCheck.check()` → `Result.healthy/unhealthy`; `HealthCheckRegistry.runHealthChecks()`.

**Micrometer** (the vendor-neutral facade — "SLF4J for metrics"):
- `Counter.builder(...).tags(...).register(reg)` (negative increments ignored), `Timer.record(Runnable)`, `LongTaskTimer`, `Gauge.builder("name", obj, List::size)`, `DistributionSummary`.
- `CompositeMeterRegistry` fan-out across multiple backends; `@Timed` via AspectJ weaving.

**Netflix Servo** — monitor types + poll/observe pipeline + Atlas (now dead → spectator/Micrometer).

**SPF4J profiling**: low-overhead method timing via programmatic `MeasurementRecorder.record(ms)` or annotation-driven `@PerformanceMonitor` (AspectJ LTW + `aop.xml`); writes a `.tsdb2` time-series DB.

**JMeter load testing**: `jmeter-maven-plugin`; `.jmx` plan anatomy = Test Plan → Thread Group → Loop Controller → HTTP Sampler → Listeners/Assertions; JSON extraction via `JSONPostProcessor`; file writes via BeanShell + ResultSaver; `DurationAssertion`.

**Test conventions**: `*IntegrationTest` run in CI; `*ManualTest`/`*LiveTest` excluded (real clocks / external infra).

**Top gotchas**:
- Micrometer counters silently ignore negative increments.
- `@Timed`/SPF4J need AspectJ weaving wired correctly or the annotation is inert.
- JMeter `WorkBench` (removed 4.0) and `BeanShellPostProcessor` (deprecated → JSR223/Groovy) are stale.

**Current (mid-2026)**: Micrometer + **Micrometer Tracing** is the facade; tracing uses `micrometer-tracing-bridge-otel` (OTLP); Spring Boot 3's **Observation API** unifies metrics + tracing. Servo and SPF4J are dead.

## Full content

This is the runtime measurement layer — metrics, profiling, and load testing against a deployed application — distinct from JMH, which measures code in isolation. The corpus covers four metrics libraries with real tests; Micrometer is the modern survivor and the one to seed.

### Metrics libraries

Dropwizard Metrics is the most thorough: a `MetricRegistry` of meters/counters/histograms/timers/gauges, several gauge variants, a `ConsoleReporter`, and a `HealthCheck` registry. Micrometer is the vendor-neutral facade ("SLF4J for metrics") — the same instrument types behind a `MeterRegistry` that fans out to multiple backends via `CompositeMeterRegistry`, plus `@Timed` via AspectJ. Netflix Servo (with Atlas) is the dead predecessor.

### Profiling and load testing

SPF4J does low-overhead method timing either programmatically or via `@PerformanceMonitor` (AspectJ load-time weaving), writing a `.tsdb2` time series. JMeter does HTTP load testing via a `.jmx` plan (Thread Group → samplers → assertions/listeners) driven by `jmeter-maven-plugin`, with JSON extraction and result-saving post-processors. The durable testing convention is the naming split that keeps real-clock/external-infra tests (`*ManualTest`/`*LiveTest`) out of CI.

### 2026 currency

- **Observability successors**: **Micrometer + Micrometer Tracing** is the current facade; tracing uses the **`micrometer-tracing-bridge-otel`** OTLP bridge, and Spring Boot 3's **Observation API** unifies metrics + tracing. Netflix Servo / SPF4J (base-corpus libs) are dead (→ spectator/Micrometer, and JFR / async-profiler for profiling). [spring.io — OpenTelemetry with Spring Boot](https://spring.io/blog/2025/11/18/opentelemetry-with-spring-boot/) · [Uptrace — OpenTelemetry vs Micrometer](https://uptrace.dev/comparisons/opentelemetry-vs-micrometer)
- **JMeter stale parts**: `WorkBench` (removed JMeter 4.0) and `BeanShellPostProcessor` (deprecated → JSR223/Groovy). Old pins (Micrometer 0.12 pre-1.0, Dropwizard metrics 3.1) should be bumped. [spring.io — OpenTelemetry with Spring Boot](https://spring.io/blog/2025/11/18/opentelemetry-with-spring-boot/)
- **`javax.* → jakarta.*`** for the validation/annotation imports the `metrics`/`jmeter` modules use under Jakarta EE 9+ / Spring 6 / Boot 3. [spring.io — OpenTelemetry with Spring Boot](https://spring.io/blog/2025/11/18/opentelemetry-with-spring-boot/)
