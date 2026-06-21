---
kb_id: reactive/spring-webclient
version: 1
tags:
  - reactive
  - spring
  - webclient
  - http-client
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-5-reactive-client"
  - "spring.io — CVE-2025-22227 (spring.io/security/cve-2025-22227)"
related:
  - reactive/project-reactor-core
  - reactive/spring-webflux
  - reactive/reactive-data-integrations
status: active
---

## Summary

**Concept**: `WebClient` is Spring's reactive, non-blocking HTTP client — `RestTemplate`'s successor — returning `Mono`/`Flux`, with filters, timeouts, fan-out, and Reactor-Netty under the hood.
**Key APIs**: `.create()`/`.builder()`, `.get()`/`.post()`, `.uri(...)`, `.retrieve()`, `.bodyToMono`/`.bodyToFlux`; `ExchangeFilterFunction`; Reactor-Netty `HttpClient` (`.responseTimeout`, `ReadTimeoutHandler`); `ReactorClientHttpConnector`; `Mono.zip`/`Flux.merge` for fan-out.
**Gotcha**: mocking `WebClient` is brittle — every fluent step must be deep-stubbed in exact order; prefer MockWebServer/WireMock.
**2026-currency**: `WebClient` remains the current reactive HTTP client; Spring 6 adds the higher-level declarative HTTP Interface (`@HttpExchange`); CVE-2025-22227 (Netty redirect credential leak) fixed in reactor-netty 1.0.49/1.1.32/1.2.8.
**Sources**: Baeldung `spring-5-reactive-client`/`spring-5-webflux` modules; spring.io CVE advisory.

## Quick Reference

**Construction**: `WebClient.create()` / `.builder()...build()`; `.get()`/`.post()`, `.uri(...)`, `.retrieve()`, then `.bodyToMono(Class)` / `.bodyToFlux(Class)`.

**URI building**: `uriBuilder.path(...).queryParam(...).build(...)`; `DefaultUriBuilderFactory` + `EncodingMode.URI_COMPONENT`; array params (`category=Phones&category=Tablets`), bracket params (`tag[]`).

**Filters** (`ExchangeFilterFunction`): counting, URL-rewrite (`ClientRequest.from(req).url(...).build()`), logging — composed via `.builder().filter(...)` / `ofRequestProcessor` / `ofResponseProcessor`.

**JSON list extraction**:
- `bodyToMono(Object[].class)` + Jackson `convertValue`.
- `bodyToMono(new ParameterizedTypeReference<List<Reader>>(){})`.
- `bodyToFlux(Reader.class)`.

**Fan-out / fan-in** (simultaneous calls):
- `Flux...parallel().runOn(Schedulers.boundedElastic()).flatMap(...).ordered(cmp)`.
- `Flux.merge(...)`.
- `Mono.zip(monoA, monoB, combiner)`.

**Timeouts** (Reactor-Netty `HttpClient`): `.responseTimeout(Duration)`, `ChannelOption.CONNECT_TIMEOUT_MILLIS`, `ReadTimeoutHandler`/`WriteTimeoutHandler` via `doOnConnected`; wired via `ReactorClientHttpConnector`.

**Logging**: Netty `HttpClient.wiretap(true)`, Jetty `JettyClientHttpConnector`, or an `ExchangeFilterFunction`.

**Retry** (5 variants, retry only `ServiceException` from 5xx, no retry on 4xx): use `reactor.util.retry.Retry` + `.onStatus(...)`; test with `okhttp3.mockwebserver.MockWebServer` (enqueue 3×503 + body to prove 4 requests) + `StepVerifier`.

**Top gotchas**:
- Mocking is brittle — deep-stub each fluent spec (`RequestHeadersUriSpec`/`RequestBodySpec`/`ResponseSpec`) in exact order; a refactor breaks the test. Prefer MockWebServer/WireMock.
- Live external endpoints in tests (`jsonplaceholder.typicode.com`) are flaky.

**Current (mid-2026)**: `WebClient` is the current reactive HTTP client (still in Spring 6). Spring 6 adds the higher-level **declarative HTTP Interface** (`@HttpExchange` + `HttpServiceProxyFactory`) over it. Keep reactor-netty current (1.2.x via Reactor BOM 2025.0.x) to clear the redirect-credential-leak and directory-traversal CVEs.

## Full content

`WebClient` is the reactive, non-blocking HTTP client that supersedes the blocking `RestTemplate`. Every call returns a reactive type, so a controller can fan out to several backends without tying up threads. The Baeldung corpus covers the full surface across `spring-5-reactive-client` and `spring-5-webflux`: filters, timeouts, logging, JSON extraction, fan-out, mocking, and retry.

### Request building

Build with `WebClient.create()` or `.builder()`. A call chains `.get()`/`.post()` → `.uri(...)` → `.retrieve()` → `.bodyToMono(Class)`/`.bodyToFlux(Class)`. URI construction uses `uriBuilder.path(...).queryParam(...).build(...)`; `DefaultUriBuilderFactory` with `EncodingMode.URI_COMPONENT` controls encoding, and the corpus shows array params (`category=Phones&category=Tablets`) and bracket params (`tag[]`). Tests capture the outgoing request with a mocked `ExchangeFunction` + `ArgumentCaptor<ClientRequest>` (`WebClientRequestsUnitTest.java`).

### Filters

`ExchangeFilterFunction` intercepts requests/responses — counting, URL rewriting (`ClientRequest.from(req).url(...).build()`), logging — composed via `.builder().filter(...)` or the `ofRequestProcessor`/`ofResponseProcessor` factories (`WebClientFilters.java`).

### JSON extraction and fan-out

Three idioms extract a list: `bodyToMono(Object[].class)` + Jackson `convertValue`; `bodyToMono(new ParameterizedTypeReference<List<Reader>>(){})`; or `bodyToFlux`. For simultaneous calls (fan-out/fan-in), the corpus shows `Flux...parallel().runOn(Schedulers...).flatMap(...).ordered(cmp)`, `Flux.merge`, and `Mono.zip(monoA, monoB, combiner)` to combine results from parallel requests (`simultaneous/Client.java`).

### Timeouts and logging

Timeouts are configured on the Reactor-Netty `HttpClient` and wired via `ReactorClientHttpConnector`: `.responseTimeout(Duration)`, `ChannelOption.CONNECT_TIMEOUT_MILLIS`, and `ReadTimeoutHandler`/`WriteTimeoutHandler` added in `doOnConnected` (`WebClientTimeoutProvider.java`). Logging is via Netty `HttpClient.wiretap(true)`, a Jetty connector, or a logging filter.

### Retry and testing

Retry (`ExternalConnector.java`) demonstrates five variants that retry only a `ServiceException` raised from 5xx and never retry 4xx; the test enqueues three `503`s plus a final body in `MockWebServer` and proves exactly four requests via `StepVerifier`. The recurring testing lesson: mocking `WebClient` by deep-stubbing each fluent spec (`RequestHeadersUriSpec`/`RequestBodySpec`/`ResponseSpec`) is brittle — any chain refactor breaks the test — so MockWebServer/WireMock is preferred.

### 2026 currency

- **`WebClient` is still the current reactive HTTP client** into Spring 6; the base-doc APIs remain valid. [reactor-core releases](https://github.com/reactor/reactor-core/releases)
- **Spring 6 declarative HTTP Interface complements `WebClient`.** `@HttpExchange` + `HttpServiceProxyFactory` build a typed client proxy over `WebClient`, a higher-level alternative to hand-written calls. [Spring Framework REST Clients reference (HTTP Interface)](https://docs.spring.io/spring-framework/reference/integration/rest-clients.html)
- **CVE-2025-22227 — Reactor Netty HTTP client credential leak on redirect (Medium).** Leaks `Authorization` credentials across chained redirects when redirect-following is explicitly enabled; affects reactor-netty 1.0.0–1.0.48, 1.1.0–1.1.31, 1.2.0–1.2.7. **Fixed in 1.0.49 / 1.1.32 / 1.2.8** (Reactor BOM 2020.0.48 / 2022.0.27 / 2023.0.20 / 2024.0.8), July 15, 2025. [spring.io — CVE-2025-22227](https://spring.io/security/cve-2025-22227/)
- **CVE-2023-34062 — Reactor Netty HTTP Server directory traversal (HIGH, CVSS 7.5).** reactor-netty-http 1.1.x < 1.1.13 / 1.0.x < 1.0.39 serving static resources; **fixed in 1.1.13 / 1.0.39.** Keep the Reactor BOM current (2025.0.x → reactor-netty 1.2.x). [spring.io — CVE-2023-34062](https://spring.io/security/cve-2023-34062/)
