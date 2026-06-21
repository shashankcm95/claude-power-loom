---
kb_id: microservices/client-load-balancing
version: 1
tags:
  - microservices
  - load-balancing
  - ribbon
  - spring-cloud
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-cloud-ribbon-client, spring-cloud-ribbon-retry"
  - "Spring Cloud 2025.0.0 Northfields release (spring.io/blog/2025/05/29)"
related:
  - microservices/service-discovery
  - microservices/declarative-http-clients
  - microservices/resilience-circuit-breaking
status: active
---

## Summary

**Concept**: Client-side load balancing — the caller (not a central proxy) picks which instance to hit, using a discovery-fed instance list plus a pluggable rule + ping. Netflix Ribbon is the legacy implementation; Spring Cloud LoadBalancer is the modern replacement.
**Key APIs**: `@RibbonClient(name=, configuration=)`, `@LoadBalanced RestTemplate`, `IPing`/`IRule` beans, static `listOfServers` (no Eureka); Ribbon retry via `MaxAutoRetries`/`MaxAutoRetriesNextServer`/`retryableStatusCodes` + Spring Retry backoff factories.
**Gotcha**: `@RibbonClient(name="ping-a-server")` must match the config/URL key (`ping-server`) exactly — a name mismatch silently breaks resolution (a real bug shipped in the corpus sample).
**2026-currency**: Ribbon is EOL (removed after Spring Cloud 2020.0.x) -> Spring Cloud LoadBalancer; `@LoadBalanced RestTemplate` survives but `RestTemplate` itself is in maintenance -> `RestClient`/`WebClient`.
**Sources**: Baeldung `spring-cloud-ribbon-client`/`-ribbon-retry`; Spring Cloud 2025.0 release.

## Quick Reference

**The client-side LB model**: unlike a server-side proxy (gateway), the caller holds the instance list and chooses. With a discovery client this list is dynamic; without one, a static `listOfServers` works for fixed topologies.

**Ribbon (legacy)**:
```java
@RibbonClient(name = "ping-server", configuration = RibbonConfiguration.class)
// RibbonConfiguration provides IPing + IRule beans
@LoadBalanced @Bean RestTemplate restTemplate() { return new RestTemplate(); }
```
- `IPing` — liveness check strategy (e.g. `PingUrl`).
- `IRule` — selection strategy (round-robin, availability-filtered, weighted-response).
- Static mode: `<client>.ribbon.listOfServers=host1:port,host2:port` (works without Eureka).

**Ribbon retry** (with `spring-retry` on the classpath):
- `MaxAutoRetries` — retries on the *same* instance.
- `MaxAutoRetriesNextServer` — retries on the *next* instance.
- `retryableStatusCodes` / `OkToRetryOnAllOperations`.
- Backoff via Spring Retry `BackOffPolicy` factory beans (fixed/exponential).

**Top gotchas**:
- Name-key mismatch — `@RibbonClient(name=...)` must match the property/URL key exactly; a typo silently disables LB (corpus shipped this bug).
- Retrying non-idempotent operations (POST) with `OkToRetryOnAllOperations=true` can duplicate side effects.

**Current (mid-2026)**: Ribbon is end-of-life — removed from the Spring Cloud train after 2020.0.x. The replacement is **Spring Cloud LoadBalancer** (`spring-cloud-starter-loadbalancer`), a non-blocking-capable LB that integrates with both `RestTemplate` (`@LoadBalanced`) and `WebClient`. `RestTemplate` itself is in maintenance — prefer `RestClient` (blocking) or `WebClient` (reactive).

## Full content

Client-side load balancing puts instance selection in the caller. Combined with service discovery, the caller fetches a live instance list for a logical name and applies a rule to pick one — no central bottleneck, and failover is local. This is the Netflix-era counterpart to a server-side gateway/proxy, and the two compose (a gateway can itself client-side-balance to backends).

### Ribbon's pluggable model

Ribbon's design is two pluggable strategies: `IPing` decides which instances are alive, and `IRule` decides which live instance to call. Defaults give round-robin over availability-filtered instances. A static `listOfServers` lets Ribbon work without a registry for fixed topologies — useful in tests and simple deployments.

### Retry semantics

Ribbon retry distinguishes same-instance retries (`MaxAutoRetries`) from next-instance failover (`MaxAutoRetriesNextServer`), gated by `retryableStatusCodes`. Layering Spring Retry adds backoff policies. The danger is retrying non-idempotent calls: enabling `OkToRetryOnAllOperations` will retry POSTs, risking duplicate writes.

### 2026 currency

- **Ribbon -> Spring Cloud LoadBalancer.** Ribbon is EOL and was removed from the Spring Cloud train after 2020.0.x "Ilford"; the live replacement is Spring Cloud LoadBalancer, which works with `@LoadBalanced RestTemplate` and `WebClient` and supports reactive backends. [Spring Cloud 2025.0.0 release](https://spring.io/blog/2025/05/29/spring-cloud-2025-0-0-is-abvailable/)
- **`RestTemplate` in maintenance** — the `@LoadBalanced RestTemplate` idiom still works, but new code should use `RestClient` (synchronous fluent, Spring 6.1+) or `WebClient` (reactive); Spring 7 adds a declarative HTTP-interface client. [Spring Framework 7.0 GA](https://spring.io/blog/2025/11/13/spring-framework-7-0-general-availability/)
- **Service mesh moves LB to the platform.** A mesh (Istio/Linkerd/Cilium) can do retries, traffic splitting, and load balancing at the data plane — an alternative to in-app client-side LB. Istio Ambient Mode (sidecarless) reached GA in v1.24 (Nov 7 2024). [Istio Ambient reaches GA](https://istio.io/latest/blog/2024/ambient-reaches-ga/)
