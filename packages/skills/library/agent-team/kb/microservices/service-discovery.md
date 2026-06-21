---
kb_id: microservices/service-discovery
version: 1
tags:
  - microservices
  - service-discovery
  - eureka
  - spring-cloud
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-cloud-eureka, spring-cloud-eureka-self-preservation, spring-cloud-consul, spring-cloud-zookeeper, spring-cloud-kubernetes"
  - "Spring Cloud 2025.0.0 Northfields release (spring.io/blog/2025/05/29)"
related:
  - microservices/client-load-balancing
  - microservices/declarative-http-clients
  - microservices/api-gateway
  - microservices/containers-orchestration
  - microservices/centralized-config
status: active
---

## Summary

**Concept**: Services register a logical name in a registry; callers resolve `service-name` -> live instances instead of hard-coding host:port. Netflix Eureka is the canonical server; Consul, ZooKeeper, and Kubernetes DNS are alternatives behind one `DiscoveryClient` abstraction.
**Key APIs**: `@EnableEurekaServer`; `eureka.client.registerWithEureka/fetchRegistry=false` (server); auto-register via `spring.application.name` + `server.port=0` + `preferIpAddress` (client); `DiscoveryClient`; `EurekaClient.getApplication(name).getInstances()`.
**Gotcha**: self-preservation mode stops evicting stale instances when network renewals drop below `renewal-percent-threshold` (default 0.85) — protects against partitions but can serve dead instances.
**2026-currency**: Eureka survives in maintenance; Consul/ZooKeeper/Kubernetes integrations are actively maintained; the `DiscoveryClient` abstraction is the stable concept. Bootstrap context disabled by default since Spring Cloud 2020.0.
**Sources**: Baeldung `spring-cloud-eureka`/`-consul`/`-zookeeper`/`-kubernetes`; Spring Cloud 2025.0 release.

## Quick Reference

**Eureka server**: `@EnableEurekaServer` on the app; a server should not register with or fetch from itself — `eureka.client.registerWithEureka: false`, `eureka.client.fetchRegistry: false`, `server.port: 8761`.

**Eureka client**: auto-registers via the starter under `spring.application.name`. Key config:
```yaml
eureka.client.serviceUrl.defaultZone: ${EUREKA_URI:http://localhost:8761/eureka}
server.port: 0                          # ephemeral port; let the registry track it
eureka.instance.preferIpAddress: true
```
Callers reference the **logical name** (`spring-application-name`), never host:port.

**Two consumption styles**:
- Declarative — `@FeignClient("service-name")` (resolves through discovery + LB).
- Low-level — `EurekaClient.getApplication(name).getInstances().get(0)` + a `RestTemplate`. Use `@Lazy EurekaClient` injection to avoid startup-ordering issues.

**Self-preservation knobs**: `eureka.server.enable-self-preservation`, `renewal-percent-threshold=0.85`, `expected-client-renewal-interval-seconds=30` vs client `eureka.instance.lease-renewal-interval-in-seconds=30`.

**Alternatives behind `DiscoveryClient`**: Consul (KV + health checks + leadership election), ZooKeeper, and Kubernetes-native service DNS (no separate registry needed — the platform resolves `service.namespace.svc.cluster.local`).

**Top gotchas**:
- Self-preservation can mask dead instances during a real outage that looks like a network partition.
- Integration tests need real infra — the corpus uses Testcontainers `GenericContainer("springcloud/eureka")` + `TestPropertyValues`, WireMock for downstream, Awaitility for registration timing.

**Current (mid-2026)**: Eureka is in maintenance but still shipped in the Spring Cloud 2025.0 "Northfields" train. Consul and Kubernetes integrations are actively maintained. On Kubernetes, prefer native Service DNS over running Eureka. Bootstrap-context properties (`spring.cloud.consul.*` in `bootstrap.yml`) are disabled by default since Spring Cloud 2020.0 — migrate to `spring.config.import=consul:`.

## Full content

Service discovery solves the "where is service X right now" problem in a fleet where instances scale up/down and get ephemeral addresses. A service registers a logical name at startup; consumers resolve that name to a current set of healthy instances. This decouples callers from physical topology and is the precondition for client-side load balancing and dynamic routing.

### Eureka server and client

The canonical implementation is Netflix Eureka. The server (`@EnableEurekaServer`) hosts the registry; it must opt out of registering with itself. Clients auto-register through the starter using `spring.application.name`, request an ephemeral port (`server.port=0`), and advertise their IP. The load-bearing idiom is logical-name addressing: a caller asks for `payment-service`, never `10.0.3.7:8081`.

### The DiscoveryClient abstraction

Spring Cloud's `DiscoveryClient` interface decouples application code from the registry implementation. Consul (with its KV store, health checks, and leadership election), ZooKeeper, and Kubernetes all plug in behind it. On Kubernetes, discovery often disappears entirely into the platform — Service objects give every service a stable cluster-DNS name, so no Eureka is needed.

### Self-preservation

Eureka's self-preservation mode is a partition-tolerance feature: when the rate of lease renewals drops below `renewal-percent-threshold` (0.85 by default), Eureka stops evicting instances on the assumption that the network — not the instances — failed. The trade-off is that during a genuine mass outage it will keep serving entries for dead instances.

### 2026 currency

- **Netflix OSS successors are the live path, but Eureka survives.** Pivotal announced Netflix OSS maintenance in Dec 2018 and removed most of it after the 2020.0.x "Ilford" train — Hystrix/Ribbon/Zuul/Archaius are gone — but **Eureka remains shipped in maintenance** in the current Spring Cloud 2025.0.0 "Northfields" train (GA May 29 2025). [Spring Cloud 2025.0.0 release](https://spring.io/blog/2025/05/29/spring-cloud-2025-0-0-is-abvailable/)
- **Consul and Kubernetes integrations are actively maintained** — the corpus freshness verdict lists `spring-cloud-consul`/`-kubernetes` as still-current, unlike the Netflix tier. The `DiscoveryClient` abstraction ages well as a concept.
- **Bootstrap context disabled by default** since Spring Cloud 2020.0: `spring.cloud.consul.*` in `bootstrap.{yml,properties}` needs `spring-cloud-starter-bootstrap` or migration to `spring.config.import=consul:`. [Spring Cloud 2025.0.0 release](https://spring.io/blog/2025/05/29/spring-cloud-2025-0-0-is-abvailable/)
- **Service mesh is an alternative for discovery+routing** at the platform layer — Istio Ambient Mode reached GA in v1.24 (Nov 7 2024), handling mTLS/routing/retries without per-pod sidecars. [Istio Ambient reaches GA](https://istio.io/latest/blog/2024/ambient-reaches-ga/)
