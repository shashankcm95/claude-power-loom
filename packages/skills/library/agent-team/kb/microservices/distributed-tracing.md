---
kb_id: microservices/distributed-tracing
version: 1
tags:
  - microservices
  - tracing
  - observability
  - opentelemetry
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-sleuth, spring-cloud-bootstrap (zipkin)"
  - "OpenTelemetry with Spring Boot (spring.io/blog/2025/11/18/opentelemetry-with-spring-boot)"
related:
  - microservices/api-gateway
  - microservices/cqrs-event-sourcing
  - microservices/alternative-runtimes
  - microservices/containers-orchestration
status: active
---

## Summary

**Concept**: Distributed tracing follows one request across many services by propagating a shared trace id + per-hop span ids, so a latency or error can be located across the call graph. Spring Cloud Sleuth was the legacy auto-instrumentation; Micrometer Tracing + OpenTelemetry is the modern stack.
**Key APIs**: Sleuth auto-attaches `[app, traceId, spanId, exportable]` to log MDC; manual child span via `tracer.nextSpan().name(...).start()` + `tracer.withSpanInScope(span)`; cross-thread propagation via `LazyTraceExecutor`; Zipkin reporting; Brave under the hood.
**Gotcha**: a plain executor DROPS the trace across threads — wrap it in `LazyTraceExecutor` (same for `@Async` and `@Scheduled`). This is the load-bearing lesson of the module.
**2026-currency**: Sleuth is EOL (deprecated in Spring Cloud 2022.0) -> Micrometer Tracing (`micrometer-tracing-bridge-brave`/`-otel`) bridged to OpenTelemetry (OTLP wire protocol).
**Sources**: Baeldung `spring-sleuth`; OpenTelemetry-with-Spring-Boot (spring.io 2025).

## Quick Reference

**Sleuth auto-instrumentation (legacy)**: adding `spring-cloud-starter-sleuth` attaches `[appName, traceId, spanId, exportable]` to the log MDC with no code — every log line is now correlatable.

**Manual child span**:
```java
Span span = tracer.nextSpan().name("newSpan").start();
try (SpanInScope ws = tracer.withSpanInScope(span)) {
    // work in the child span
} finally { span.finish(); }
```

**Cross-thread propagation (the load-bearing lesson)**:
- A plain `Executor` loses the trace context across the thread boundary — wrap it in `LazyTraceExecutor`.
- `@Async`: `@EnableAsync` + `getAsyncExecutor()` returning a `LazyTraceExecutor`.
- `@Scheduled`: `SchedulingConfigurer.setScheduler(...)` with a trace-aware scheduler.
- Brave (`brave.Tracer`/`Span`) is the underlying tracer; Zipkin is the reporter (discovery-resolved).

**Top gotchas**:
- Forgetting to wrap an executor silently breaks trace continuity across threads — traces look truncated.
- `exportable=false` lines are sampled out of reporting; don't mistake missing Zipkin data for missing instrumentation.

**Current (mid-2026)**: Spring Cloud Sleuth is EOL (deprecated in Spring Cloud 2022.0 "Kilburn", Boot 3.0). The replacement is **Micrometer Tracing** (`micrometer-tracing-bridge-brave` or `-otel`) + the Micrometer Observation API, bridged to **OpenTelemetry** (OTLP to Jaeger/Prometheus/Grafana/commercial backends, switchable without code changes). The OpenTelemetry Java agent (2.x) is stable, OTLP-exporting to `http://localhost:4318` by default.

## Full content

Distributed tracing is the observability primitive for microservices: a single user request fans out across many services, and tracing stitches the hops together with a propagated trace id and a tree of span ids. Without it, locating a slow or failing hop in a deep call graph is guesswork. The corpus teaches the legacy Sleuth stack, whose most durable lesson — trace propagation across asynchronous boundaries — carries straight into the modern tooling.

### Automatic and manual spans

Sleuth's headline feature is zero-code log correlation: it injects trace/span ids into the MDC so every log line is tagged. For finer granularity, code can open a manual child span (`nextSpan().start()` inside a `withSpanInScope` try-with-resources, finished in `finally`). Brave is the underlying tracer and Zipkin the reporter.

### Propagation across threads

The load-bearing lesson is that trace context lives in thread-local state, so it does not automatically cross a thread boundary. A plain executor drops it; the fix is `LazyTraceExecutor`. The same applies to `@Async` (return a `LazyTraceExecutor` from `getAsyncExecutor`) and `@Scheduled` (a trace-aware scheduler via `SchedulingConfigurer`). This concept is identical in the modern stack — only the wrapping API changes.

### 2026 currency

- **Sleuth EOL -> Micrometer Tracing.** Spring Cloud Sleuth was deprecated in Spring Cloud 2022.0 ("Kilburn", aligned with Boot 3.0); the replacement is Micrometer Tracing (`micrometer-tracing-bridge-brave` or `-otel`). [Why Sleuth was deprecated / Micrometer Tracing (Medium)](https://medium.com/dev-spring/why-spring-cloud-sleuth-was-deprecated-and-what-to-use-instead-e98cecd70c86) · [Observability with Spring Boot 3 (spring.io)](https://spring.io/blog/2022/10/12/observability-with-spring-boot-3/)
- **The modern stack is Micrometer + OpenTelemetry.** The Micrometer Observation API + Micrometer Tracing bridge to OpenTelemetry (CNCF, vendor-neutral; OTLP is the wire protocol) — one instrumentation emits metrics + traces + logs to Jaeger/Prometheus/Grafana/commercial backends, switchable without code changes. The OpenTelemetry Java agent is stable (2.x), OTLP-exporting by default to `http://localhost:4318`, with declarative config from agent 2.26.0+ and SLF4J/Logback/Log4j2 log bridging. [OpenTelemetry with Spring Boot (spring.io, Nov 2025)](https://spring.io/blog/2025/11/18/opentelemetry-with-spring-boot/) · [OpenTelemetry Java](https://opentelemetry.io/docs/languages/java/) · [OpenTelemetry Java instrumentation](https://github.com/open-telemetry/opentelemetry-java-instrumentation)
- **Service mesh can do tracing at the platform layer** — a mesh injects trace headers and reports spans without app instrumentation, complementing or replacing in-app tracing. Istio Ambient Mode reached GA in v1.24 (Nov 7 2024). [Istio Ambient reaches GA](https://istio.io/latest/blog/2024/ambient-reaches-ga/)
