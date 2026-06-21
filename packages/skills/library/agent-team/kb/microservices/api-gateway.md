---
kb_id: microservices/api-gateway
version: 1
tags:
  - microservices
  - api-gateway
  - spring-cloud-gateway
  - zuul
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-cloud-gateway, spring-cloud-zuul, spring-cloud-zuul-fallback, spring-cloud-zuul-eureka-integration"
  - "Spring Cloud Gateway 2025-05-29 releases + CVE-2025-41243 (spring.io/security/cve-2025-41243)"
related:
  - microservices/service-discovery
  - microservices/microservice-security
  - microservices/resilience-circuit-breaking
  - microservices/distributed-tracing
status: active
---

## Summary

**Concept**: An edge gateway is the single front door — it routes, relays tokens, rate-limits, and aggregates. Two eras: Zuul 1 (servlet, blocking) and Spring Cloud Gateway (reactive WebFlux, the modern replacement).
**Key APIs**: Zuul `@EnableZuulProxy`, `ZuulFilter` (pre/route/post/error) + `RequestContext`; Gateway `RouteLocatorBuilder` DSL, `AbstractGatewayFilterFactory`/`GlobalFilter`/`AbstractRoutePredicateFactory`, Redis-backed `RequestRateLimiter` + `KeyResolver`.
**Gotcha**: a Gateway filter's pre-logic runs before `chain.filter(exchange)`, post-logic in `.then(Mono.fromRunnable(...))`; a Zuul post-filter must re-set the one-shot response stream (`setResponseBody`) after reading it.
**2026-currency**: Zuul 1 EOL -> Spring Cloud Gateway. 2025.0 forks a servlet WebMVC variant alongside reactive; multiple CRITICAL SpEL CVEs (CVE-2022-22947, CVE-2025-41243) — WebMVC flavor is NOT vulnerable to the latter.
**Sources**: Baeldung `spring-cloud-gateway`/`spring-cloud-zuul`; Spring Cloud Gateway 2025 releases + CVEs.

## Quick Reference

**Spring Cloud Gateway (modern, reactive)** — a route is `predicate(s) + filter(s) + uri`, on Netty/WebFlux (`Mono`/`Flux`, `ServerWebExchange`):
```java
@Bean RouteLocator routes(RouteLocatorBuilder b) {
  return b.routes()
    .route("svc", r -> r.path("/api/**")
       .filters(f -> f.rewritePath("/api/(?<s>.*)", "/${s}").addRequestHeader("X-Edge","1"))
       .uri("lb://service-name"))
    .build();
}
```
Or declaratively under `spring.cloud.gateway.routes[n]`.

- **Custom filter**: extend `AbstractGatewayFilterFactory<Config>`, `shortcutFieldOrder()` for positional config (`Logging=msg,true,true`), return an `OrderedGatewayFilter`. Pre-logic before `chain.filter(exchange)`; post-logic in `.then(Mono.fromRunnable(...))`.
- **Global filter**: `GlobalFilter implements Ordered` (every route).
- **Custom predicate**: extend `AbstractRoutePredicateFactory<Config>` -> `Predicate<ServerWebExchange>`.
- **Built-ins**: `AddRequestHeader`, `RewritePath`, `StripPrefix`, `SetStatus`, `Retry` (w/ backoff), `RequestRateLimiter` (Redis-backed + `KeyResolver` bean), `modifyRequestBody`/`modifyResponseBody`.

**Zuul 1 (legacy)** — `@EnableZuulProxy`; a `ZuulFilter` overrides `filterType()` (pre/route/post/error), `filterOrder()`, `shouldFilter()`, `run()` via `RequestContext.getCurrentContext()`. Pre-filter token relay (`ctx.addZuulRequestHeader`, remove `"authorization"` from `ignoredHeaders`). Route fallback via `FallbackProvider.fallbackResponse(route, cause)` -> `ClientHttpResponse`.

**Top gotchas**:
- Zuul one-shot stream — a post-filter must `setResponseBody(...)` after reading `getResponseDataStream()` (re-set required).
- Pre/post ordering in Gateway filters is the `.then(...)` boundary, easy to invert.

**Current (mid-2026)**: Zuul 1 is EOL -> Spring Cloud Gateway. The 2025.0 train ships BOTH the reactive `spring-cloud-starter-gateway-server-webflux` AND a servlet `spring-cloud-starter-gateway-server-webmvc` (Boot 3.2+), and migrated property prefixes to `spring.cloud.gateway.server.webflux.*`. The WebMVC flavor dodges the WebFlux SpEL CVE class.

## Full content

The API gateway is the edge of a microservice system — one address clients hit, behind which routing, security, rate limiting, and aggregation happen. The corpus captures the generational shift from Zuul 1 (a blocking servlet filter chain) to Spring Cloud Gateway (a reactive route/predicate/filter model on WebFlux).

### Zuul 1's filter model

Zuul filters are categorized by `filterType()` — pre (before routing), route (the proxy call), post (after the response), error — and ordered by `filterOrder()`. They read and mutate the thread-bound `RequestContext`. Token and session relay happen in pre-filters (adding headers, un-ignoring `authorization`). The sharp edge is the one-shot response stream: a post-filter that reads `getResponseDataStream()` must re-set the body with `setResponseBody(...)`, or the client gets nothing.

### Spring Cloud Gateway's reactive model

Gateway models a route as predicates (when to match) plus filters (how to transform) plus a target uri. Filters extend `AbstractGatewayFilterFactory`; the reactive idiom places pre-logic before `chain.filter(exchange)` and post-logic inside `.then(Mono.fromRunnable(...))`. Predicates extend `AbstractRoutePredicateFactory`. Built-in filters cover header manipulation, path rewriting, retry with backoff, and Redis-backed rate limiting keyed by a `KeyResolver`. Tests assert filter execution order with a logback list appender + `WebTestClient`.

### Security note

The gateway is a high-value attack surface — it has had multiple CRITICAL SpEL injection CVEs. Lock down the Actuator gateway endpoint and prefer the WebMVC flavor where reactive isn't needed.

### 2026 currency

- **Zuul 1 -> Spring Cloud Gateway** is the canonical migration; Gateway is current and the modern Zuul replacement in the 2025.0.0 "Northfields" train. [Spring Cloud 2025.0.0 release](https://spring.io/blog/2025/05/29/spring-cloud-2025-0-0-is-abvailable/)
- **Servlet (WebMVC) gateway variant.** Since Boot 3.2: `spring-cloud-starter-gateway-server-webmvc` — a non-reactive gateway with simpler Spring Security integration, and it is NOT vulnerable to the WebFlux SpEL CVE class. Property prefixes moved to `spring.cloud.gateway.server.webflux.*`. [SCG Server WebMVC starter (docs)](https://docs.spring.io/spring-cloud-gateway/reference/spring-cloud-gateway-server-webmvc/starter.html) · [SCG MVC migration (Medium)](https://medium.com/att-israel/spring-cloud-gateway-mvc-migration-from-reactive-one-ed2025efc165)
- **CVE-2022-22947 (CRITICAL)** — SpEL code injection via the Actuator gateway endpoint; affected 3.1.0/3.0.0-3.0.6; fixed in 3.1.1+ and 3.0.7+. Mitigate by securing/disabling the gateway actuator endpoint. [spring.io CVE-2022-22947](https://spring.io/security/cve-2022-22947/)
- **CVE-2025-41235 (HIGH)** — Gateway forwarded `X-Forwarded-*`/`Forwarded` from untrusted proxies (May 27 2025); fixed in 3.1.10, 4.0.12, 4.1.8, 4.2.3, 4.3.0; the 2025.0 train now disables these headers by default unless trusted proxies are configured. [spring.io CVE-2025-41235](https://spring.io/security/cve-2025-41235/)
- **CVE-2025-41243 (CRITICAL)** — Gateway Server WebFlux SpEL property modification (Sep 8 2025); affects 3.1.x and 4.0.x-4.3.x WebFlux. **WebMVC is NOT vulnerable** — a concrete reason to prefer the servlet flavor. [spring.io CVE-2025-41243](https://spring.io/security/cve-2025-41243/)
