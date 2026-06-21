---
kb_id: spring-core/rest-client
version: 1
tags:
  - spring-core
  - rest-client
  - http
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-resttemplate / spring-resttemplate-2 / spring-resttemplate-3"
  - "The state of HTTP clients in Spring (official blog, spring.io/blog/2025/09/30/the-state-of-http-clients-in-spring/)"
related:
  - spring-core/spring-mvc-web-tier
  - spring-core/spring-testing
status: active
---

## Summary

**Concept**: `RestTemplate` is Spring's synchronous HTTP client; in 2026 prefer `RestClient` (sync), `WebClient` (reactive), or declarative `@HttpExchange` interfaces.
**Key APIs**: `getForObject`/`postForEntity`/`exchange`/`execute`; `ParameterizedTypeReference`; `RestTemplateBuilder`; `ClientHttpRequestInterceptor`; `HttpComponentsClientHttpRequestFactory`; `MockRestServiceServer`.
**Gotcha**: PATCH is unsupported on the default JDK `HttpURLConnection` — set `HttpComponentsClientHttpRequestFactory`; generic-list deserialize loses element type to erasure unless you use `ParameterizedTypeReference` + `exchange`.
**2026-currency**: `RestTemplate` is in maintenance mode; deprecation announced in Spring 7.0; successors are `RestClient`/`WebClient`/`@HttpExchange`.
**Sources**: Baeldung `spring-resttemplate` ×3; spring.io HTTP-clients blog.

## Quick Reference

**Verb surface** (`RestTemplate`): `getForObject`/`getForEntity`, `headForHeaders`, `postForObject`/`postForLocation`/`postForEntity`, `optionsForAllow`, `exchange(url, HttpMethod, HttpEntity, Class)`, `execute(url, method, RequestCallback, ResponseExtractor)`, `patchForObject`, `delete`. Form submit via `MultiValueMap`/`LinkedMultiValueMap`.

**Generic responses**: `exchange(url, GET, null, new ParameterizedTypeReference<List<User>>(){})` is erasure-safe; `getForObject(..., List.class)` yields `List<LinkedHashMap>`; `Object[]` needs per-element `ObjectMapper.convertValue`.

**Configuration**: `RestTemplateBuilder` (`setConnectTimeout`/`setReadTimeout`/`errorHandler`), `RestTemplateCustomizer`, `ClientHttpRequestInterceptor` (logging/header-mod). Request factories: `SimpleClientHttpRequestFactory` (JDK; proxy via `setProxy`), `HttpComponentsClientHttpRequestFactory` (required for PATCH). Custom `ResponseErrorHandler` maps 4xx/5xx to domain exceptions.

**Patterns**: gzip request compression (interceptor + `Content-Encoding`), vendor-MIME versioning by `Accept`, multipart upload (`FileSystemResource` parts + `MULTIPART_FORM_DATA`), large-file streaming download (`execute` + `ResponseExtractor` + `StreamUtils.copy`; range/resume via `Range` header).

**Testing**: `MockRestServiceServer.createServer(restTemplate)` binds to that exact instance; `@RestClientTest`; `TestRestTemplate`; `server.verify()`.

**Top gotchas**:
- **PATCH** unsupported on default JDK `HttpURLConnection` — set `HttpComponentsClientHttpRequestFactory`.
- **"Not enough variables to expand"** — raw JSON braces in a URL string parse as URI template vars; use a `{placeholder}` + value or `UriComponentsBuilder`.
- **Generic-list erasure** — `getForObject(..., List.class)` → `List<LinkedHashMap>`; use `ParameterizedTypeReference` + `exchange`.
- **Interceptor consumes the stream** — reading the response body in an interceptor drains it; wrap with `BufferingClientHttpRequestFactory` so downstream can re-read.

**Current (mid-2026)**: For new code use `RestClient` (fluent sync, Spring 6.1 / Boot 3.2) or `WebClient` (reactive), or declarative `@HttpExchange` HTTP-interface clients (`HttpServiceProxyFactory`). `RestTemplate` is maintenance-mode; Spring 7.0 *announced* deprecation (not yet `@Deprecated`), formal marking planned 7.1, removal in Spring 8.0, OSS support to ~2029. Apache HttpClient 4.x → 5.x.

## Full content

`RestTemplate` exposes the full HTTP verb surface plus generic helpers, an interceptor chain, and pluggable request factories. The recurring traps all stem from its template-and-erasure design: URI template expansion treats `{...}` specially (so raw JSON braces break it), Java erasure means `List.class` deserializes to `LinkedHashMap`, and interceptors that read the body consume a one-shot stream.

### The successor landscape

Spring's HTTP-client story consolidated after 2021. `RestClient` is the fluent synchronous successor with a modern builder API; `WebClient` is the reactive client; and `@HttpExchange` declarative interfaces (Feign-style) back either one via `HttpServiceProxyFactory`. `RestTemplate` itself is not gone, but it is the legacy choice — new code should default to `RestClient` or `WebClient`.

### Testing the client

`MockRestServiceServer` binds to a *specific* `RestTemplate` instance and replays scripted responses, letting tests exercise interceptors and error handlers offline. Many Baeldung `*LiveTest` examples instead hit the real internet (`httpbin.org`, `google.com`), which makes them brittle and offline-failing — a corpus caveat, not a recommended pattern.

### 2026 currency

`RestTemplate` is "version-stale but concepts transfer" in the base doc and the 2026 Update sharpens the successor story:

- **`RestTemplate` → `RestClient` (sync) / `WebClient` (reactive).** `RestClient` arrived in Spring Framework 6.1 / Spring Boot 3.2. As of Spring 7.0 (Nov 2025) RestTemplate deprecation is *announced* (an intent, not yet `@Deprecated`); formal marking is planned for 7.1 (Nov 2026, provisional), removal in Spring 8.0, with OSS support "until at least 2029." [The state of HTTP clients in Spring (official blog, 2025-09-30)](https://spring.io/blog/2025/09/30/the-state-of-http-clients-in-spring/)
- **HTTP Interface clients (`@HttpExchange`)** — declarative, Feign-style typed clients over `HttpServiceProxyFactory`; Spring 7.0 adds HTTP Interface Groups via `@ImportHttpServices`. [The state of HTTP clients in Spring (official blog)](https://spring.io/blog/2025/09/30/the-state-of-http-clients-in-spring/)
- **API versioning (Spring 7.0)** is native across RestClient and request mapping — superseding the hand-rolled vendor-MIME `Accept` idiom. [The state of HTTP clients in Spring (official blog)](https://spring.io/blog/2025/09/30/the-state-of-http-clients-in-spring/)
- Apache HttpClient 4.x → 5.x; the `javax.* → jakarta.*` migration applies to the surrounding stack. [Spring Framework Versions (official wiki)](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-Versions)
