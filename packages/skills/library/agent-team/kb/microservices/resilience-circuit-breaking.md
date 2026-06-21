---
kb_id: microservices/resilience-circuit-breaking
version: 1
tags:
  - microservices
  - resilience
  - circuit-breaker
  - resilience4j
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: hystrix, spring-cloud-hystrix, spring-cloud-circuit-breaker, spring-cloud-sentinel"
  - "Spring Cloud 2025.0.0 Northfields — Circuit Breaker reactive bulkheads (spring.io/blog/2025/05/29)"
related:
  - microservices/client-load-balancing
  - microservices/declarative-http-clients
  - microservices/api-gateway
status: active
---

## Summary

**Concept**: Stop cascading failures — a circuit breaker trips open after a failure threshold and serves a fallback instead of hammering a dead dependency; bulkheads isolate resources. Three eras: raw Hystrix, the vendor-neutral Spring Cloud Circuit Breaker (Resilience4j), and Alibaba Sentinel.
**Key APIs**: Hystrix `HystrixCommand<T>` + `@HystrixCommand(fallbackMethod=)`; `CircuitBreakerFactory.run(supplier, fallback)` + `Customizer<Resilience4JCircuitBreakerFactory>`; Sentinel `@SentinelResource(value=, fallback=)` + `FlowRule`/`DegradeRule`/`SystemRule`.
**Gotcha**: `@HystrixCommand`/`@SentinelResource` are AOP-proxied — calling the annotated method from within the same bean (self-invocation) bypasses the breaker entirely.
**2026-currency**: Hystrix is EOL -> Resilience4j via Spring Cloud Circuit Breaker (the current direction, now with reactive bulkheads); Sentinel maintained.
**Sources**: Baeldung `hystrix`/`spring-cloud-circuit-breaker`/`spring-cloud-sentinel`; Spring Cloud 2025.0.

## Quick Reference

**Spring Cloud Circuit Breaker + Resilience4j (the modern path)**:
```java
@Autowired CircuitBreakerFactory cbFactory;
String r = cbFactory.create("albums").run(
    () -> restClient.get().uri("/albums").retrieve().body(String.class),
    throwable -> "fallback");
```
Configure globally/named via a `Customizer<Resilience4JCircuitBreakerFactory>`:
```java
factory.configureDefault(id -> new Resilience4JConfigBuilder(id)
   .circuitBreakerConfig(CircuitBreakerConfig.custom()
       .failureRateThreshold(50).waitDurationInOpenState(...).slidingWindowSize(2).build())
   .timeLimiterConfig(TimeLimiterConfig.custom()...build()).build());
```

**Raw Hystrix (legacy)**: extend `HystrixCommand<T>`, implement `run()`, call `.execute()`. Tune via `HystrixCommand.Setter.withGroupKey(...).andCommandPropertiesDefaults(HystrixCommandProperties.Setter().withExecutionTimeoutInMilliseconds(...).withCircuitBreakerSleepWindowInMilliseconds(...).withCircuitBreakerRequestVolumeThreshold(...))` + `HystrixThreadPoolProperties` (thread-pool isolation = the bulkhead). Default exec timeout ~1000ms. Metrics: `HystrixMetricsStreamServlet` + `@EnableHystrixDashboard`.

**Spring Cloud Hystrix annotation**: `@EnableCircuitBreaker` + `@HystrixCommand(fallbackMethod="defaultGreeting")`; Feign variant `@FeignClient(fallback=...)` + `feign.hystrix.enabled`.

**Alibaba Sentinel**: `@SentinelResource(value="greeting", fallback="...")` + a `SentinelResourceAspect` bean; rules loaded in `@PostConstruct` — `FlowRule` (QPS), `DegradeRule` (count/timeWindow), `SystemRule` (load).

**Top gotchas**:
- AOP self-invocation bypasses `@HystrixCommand`/`@SentinelResource` — the call must cross a proxy boundary.
- Sentinel string-keyed coupling — `@SentinelResource(value="greeting")` must match `RESOURCE_NAME` in every rule; a typo silently leaves the resource unprotected.
- Hystrix props are cached per command group key — each test needs a distinct group key.

**Current (mid-2026)**: Hystrix is in maintenance/EOL -> Resilience4j is the recommended implementation behind the Spring Cloud Circuit Breaker abstraction. The 2025.0 train adds reactive bulkheads to Circuit Breaker. Resilience4j 2.4.0 (`resilience4j-spring-boot3`) supports Boot 4 / Spring Cloud 5.

## Full content

Resilience patterns prevent one failing dependency from taking down a whole call graph. The circuit breaker is the headline: it monitors failures, and once a threshold is crossed it "opens" — short-circuiting calls to a fallback for a cooldown window, then half-opening to probe recovery. Bulkheads (resource isolation) keep one slow dependency from exhausting the shared thread pool. The corpus shows three implementations side by side, which is its best teaching value.

### Three implementations

Raw Hystrix wraps a call in a `HystrixCommand` and isolates it in its own thread pool (the bulkhead) with a timeout and circuit mechanics. The vendor-neutral Spring Cloud Circuit Breaker abstraction (`CircuitBreakerFactory.run(supplier, fallback)`) decouples app code from the engine, backed by Resilience4j. Sentinel takes a rule-driven approach (`@SentinelResource` + flow/degrade/system rules) and adds QPS-based flow control.

### The AOP trap

Both `@HystrixCommand` and `@SentinelResource` work via AOP proxies, so an in-bean self-invocation of the annotated method bypasses the breaker — a classic Spring AOP pitfall. Sentinel additionally couples by string: the resource name in the annotation must exactly match the name in every rule.

### 2026 currency

- **Hystrix -> Resilience4j via Spring Cloud Circuit Breaker** is the live path. Netflix Hystrix is EOL (announced maintenance Dec 2018, removed from the Spring Cloud train after 2020.0.x); Resilience4j is the recommended implementation, and the 2025.0.0 "Northfields" train even adds reactive bulkheads to the Circuit Breaker abstraction. [Spring Cloud 2025.0.0 release](https://spring.io/blog/2025/05/29/spring-cloud-2025-0-0-is-abvailable/)
- **Resilience4j 2.4.0** (Mar 14 2026) ships the `resilience4j-spring-boot3` starter and adds Boot 4 / Spring Cloud 5 support. [Resilience4j releases](https://github.com/resilience4j/resilience4j/releases)
- **Sentinel is maintained** — listed in the corpus freshness verdict as a still-current option for flow control / circuit breaking.
- **Service mesh as a platform alternative.** A mesh (Istio/Linkerd) can do retries and circuit breaking at the data plane instead of in-app Resilience4j — Istio Ambient Mode reached GA in v1.24 (Nov 7 2024). [Istio Ambient reaches GA](https://istio.io/latest/blog/2024/ambient-reaches-ga/)
- **Spring Boot 4 / Framework 7 add a new resilience core** (`RetryTemplate`, concurrency limits) at the framework level, complementing the dedicated circuit-breaker libraries. [Spring Framework 7.0 GA](https://spring.io/blog/2025/11/13/spring-framework-7-0-general-availability/)
