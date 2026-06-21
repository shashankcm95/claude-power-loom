---
kb_id: microservices/declarative-http-clients
version: 1
tags:
  - microservices
  - rpc
  - feign
  - grpc
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: feign, spring-cloud-openfeign, spring-cloud-netflix-feign, grpc, dubbo"
  - "Spring Framework 7.0 GA — declarative HTTP-interface client (spring.io/blog/2025/11/13)"
related:
  - microservices/service-discovery
  - microservices/client-load-balancing
  - microservices/microservice-security
  - microservices/resilience-circuit-breaking
  - microservices/consumer-driven-contracts
status: active
---

## Summary

**Concept**: Inter-service calls expressed as an interface, not hand-rolled HTTP — Feign (declarative REST), gRPC (protobuf RPC with codegen), and Dubbo (Java-interface RPC). The proxy handles encoding, transport, and (with discovery) instance resolution.
**Key APIs**: Feign `@FeignClient`/`@EnableFeignClients` (Spring) vs `@RequestLine`/`@Param`/`@Headers` + `Feign.builder()` (standalone OpenFeign); gRPC `.proto` (proto3) + `ServerBuilder`/`ManagedChannelBuilder`/`StreamObserver`; Dubbo `ServiceConfig`/`ReferenceConfig`.
**Gotcha**: THREE `@FeignClient`/`@RequestLine` flavors that look alike and are NOT interchangeable — Netflix Feign (removed), Spring Cloud OpenFeign (reuses Spring MVC annotations), and standalone OpenFeign. Feign logs only at DEBUG even with `Logger.Level.FULL`.
**2026-currency**: Netflix Feign removed; Spring Cloud OpenFeign current; Spring 7 adds a built-in declarative HTTP-interface client (a Feign alternative); gRPC proto3 current.
**Sources**: Baeldung `feign`/`spring-cloud-openfeign`/`grpc`/`dubbo`; Spring 7.0 GA.

## Quick Reference

**Spring Cloud OpenFeign** (the mainstream choice):
```java
@EnableFeignClients
@FeignClient(name = "payment-service", configuration = FeignConfig.class)
interface PaymentClient { @GetMapping("/charge/{id}") Receipt charge(@PathVariable Long id); }
```
Per-client config class can set logger level, `ErrorDecoder` (-> typed exceptions), the underlying client (OkHttp), and `RequestInterceptor`s. With discovery, `name` resolves to a logical service. Hystrix fallback via `@FeignClient(fallback=...)`; multipart upload via `SpringFormEncoder`.

**Standalone OpenFeign** (no Spring): `Feign.builder().client(new OkHttpClient()).encoder(new GsonEncoder()).decoder(...).logger(...).target(MyApi.class, url)` with JAX-RS-like `@RequestLine("GET /path")` / `@Param` / `@Headers`.

**gRPC** (protobuf RPC):
- `.proto` (proto3, `option java_multiple_files=true`) -> `protoc` via `protobuf-maven-plugin` + `os-maven-plugin` (supplies `${os.detected.classifier}`).
- Server: `ServerBuilder.forPort(8080).addService(new HelloServiceImpl()).build().start()`; impl extends generated `HelloServiceGrpc.HelloServiceImplBase`, emits via `StreamObserver` (`onNext` then `onCompleted`).
- Client: `ManagedChannelBuilder.forAddress(host,port).usePlaintext().build()` -> `HelloServiceGrpc.newBlockingStub(channel)`.

**Dubbo** (Java-interface RPC): programmatic `ServiceConfig`/`ReferenceConfig` vs Spring-XML; registries (multicast/ZooKeeper); cluster fault-tolerance (`failover`/`failsafe`), `loadbalance="roundrobin"`, `cache="lru"`.

**Top gotchas**:
- Three Feign flavors look identical, are not interchangeable — easy to conflate.
- Feign logs ONLY at DEBUG — `Logger.Level.FULL` produces nothing unless the client package log level is DEBUG.
- gRPC corpus shows unary RPC only — no streaming, deadlines, or interceptors.

**Current (mid-2026)**: Netflix Feign (`spring-cloud-starter-feign`, `org.springframework.cloud.netflix.feign`) is removed; use Spring Cloud OpenFeign. Spring Framework 7 ships a built-in **declarative HTTP-interface client** (`@HttpExchange` on an interface + `HttpServiceProxyFactory`) — a first-party Feign alternative. gRPC proto3 is current; only version pins go stale.

## Full content

The three families here trade off contract style and transport. Feign expresses a REST contract as a Java interface and generates the client at runtime. gRPC defines the contract in a language-neutral `.proto` and code-generates strongly-typed stubs over HTTP/2. Dubbo treats a plain Java interface as the remote contract over its own protocol. All hide hand-rolled HTTP/serialization behind a typed proxy.

### The Feign trichotomy

The single biggest confusion is that "Feign" names three different things: (1) **Netflix Feign** (`spring-cloud-starter-feign`), the removed predecessor; (2) **Spring Cloud OpenFeign**, which reuses Spring MVC annotations (`@GetMapping`, `@PathVariable`); and (3) **standalone OpenFeign**, which uses its own `@RequestLine`/`@Param`/`@Headers` and a `Feign.builder()`. Their annotation sets look similar and are not interchangeable. Spring Cloud OpenFeign also integrates with discovery (name -> instance) and circuit breakers (fallback classes).

### gRPC codegen pipeline

gRPC's build-time codegen is the notable part: the `protobuf-maven-plugin` invokes `protoc` plus the grpc-java plugin, and `os-maven-plugin` supplies the platform classifier so the right native `protoc` is fetched. The generated `...ImplBase` is extended on the server; `StreamObserver` carries responses even for unary calls (`onNext` then `onCompleted`).

### 2026 currency

- **Netflix Feign removed; Spring Cloud OpenFeign is current.** The `org.springframework.cloud.netflix.feign` package and `spring-cloud-starter-feign` are gone with the rest of Netflix OSS after 2020.0.x; `spring-cloud-starter-openfeign` is the maintained path. [Spring Cloud 2025.0.0 release](https://spring.io/blog/2025/05/29/spring-cloud-2025-0-0-is-abvailable/)
- **Spring 7 adds a first-party declarative HTTP client.** Spring Framework 7.0 (GA Nov 13 2025) ships a declarative HTTP-interface client (annotate an interface, get a proxy backed by `RestClient`/`WebClient`) plus `RestTestClient` — a built-in alternative to Feign for Spring apps. [Spring Framework 7.0 GA](https://spring.io/blog/2025/11/13/spring-framework-7-0-general-availability/)
- **gRPC proto3 stays current**; the corpus only shows unary RPC (no streaming/deadlines/interceptors), and reactive gRPC stubs remain a concept-level pattern with no single canonical version pin. [Spring Cloud Supported Versions](https://github.com/spring-cloud/spring-cloud-release/wiki/Supported-Versions)
- **Dubbo** — the corpus's `com.alibaba` 2.5.7 is the pre-Apache legacy namespace; the maintained line is `org.apache.dubbo` 3.x with annotation config (`@DubboService`/`@DubboReference`) the corpus predates.
