---
kb_id: java-libraries/http-clients
version: 1
tags:
  - java-libraries
  - http-client
  - networking
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: httpclient, httpclient-2, libraries-http, libraries-http-2 (okhttp/retrofit)"
  - "The state of HTTP clients in Spring (spring.io, 2025)"
related:
  - java-libraries/bean-mapping
  - java-libraries/embedded-servers
  - java-libraries/web-rpc-serialization
status: active
---

## Summary

**Concept**: the crowded Java HTTP-client field — Apache HttpClient 4.x/5.x, JDK 11 `java.net.http.HttpClient`, OkHttp, Retrofit, Google HTTP Client, Unirest, async-http-client, Jetty reactive client — vs the JDK baseline and Spring `RestTemplate`/`RestClient`.
**Key APIs**: `HttpClients.custom()`→`CloseableHttpClient`/`RequestConfig`/`EntityUtils.toString`; `HttpClient.newHttpClient().send(req, BodyHandlers.ofString())`; OkHttp `OkHttpClient`/`Request.Builder`/interceptors; Retrofit `@GET`/`@Path`/`Retrofit.Builder().addConverterFactory`.
**Gotcha**: HttpClient responses/clients/connection-managers must be closed (pooled-connection leak); OkHttp 3→4 *flipped* `RequestBody.create(MediaType, body)` to `ResponseBody.create(body, MediaType)`; only OkHttp `addNetworkInterceptor` sees wire headers/redirects.
**2026-currency**: JDK `HttpClient` is the zero-dep default (now paired with virtual threads); `RestTemplate → RestClient` (Spring 6.1); OkHttp 5.x supersedes the 3→4 trap.
**Sources**: Baeldung `httpclient*` + `libraries-http*` modules.

## Quick Reference

**The field (read-response-as-String shown 5 ways side by side):**

- **JDK 11 `java.net.http.HttpClient`** (the 2026 default for simple cases) — zero-dependency.
- **Apache HttpClient 4.x** (`org.apache.http`) / **5.x** (`org.apache.hc.client5`).
- **OkHttp** / **Retrofit** (declarative, built on OkHttp).
- Google HTTP Client, Unirest, async-http-client (Netty-based), Jetty reactive client, Spring `RestTemplate`/`RestClient`.

**JDK 11 HttpClient (prefer for simple sync/async):**

```java
HttpResponse<String> r = HttpClient.newHttpClient()
    .send(req, BodyHandlers.ofString());
// async: .sendAsync(req, BodyHandlers.ofString()).thenApply(HttpResponse::body)
```

**Apache HttpClient 4.x lifecycle (close everything):**

```java
try (CloseableHttpClient c = HttpClients.custom()
         .setDefaultRequestConfig(RequestConfig.custom()
             .setConnectTimeout(5000).setSocketTimeout(5000).build())
         .build();
     CloseableHttpResponse r = c.execute(new HttpGet(url))) {
    EntityUtils.toString(r.getEntity());
}   // request.abort() to cancel
```
vs the dead pre-4.3 `DefaultHttpClient`/`HttpParams`. Connection management: `PoolingHttpClientConnectionManager` (`setMaxTotal`/`setDefaultMaxPerRoute`). Multipart: `MultipartEntityBuilder`+`FileBody`/`StringBody`.

**OkHttp interceptors (the key concept):**

```java
client.newBuilder()
    .addInterceptor(appI)          // application — runs once per call
    .addNetworkInterceptor(netI);  // network — sees ON-THE-WIRE headers/redirects
```
Sync `call.execute()` vs async `call.enqueue(Callback)`; `EventListener` lifecycle hooks for metrics; `MockWebServer` for hermetic tests. **API drift trap**: `RequestBody.create(MediaType, body)` (OkHttp 3) → arg order *flipped* to `ResponseBody.create(body, MediaType)` (OkHttp 4).

**Retrofit (declarative):**

```java
interface GitHub { @GET("users/{user}/repos") Call<List<Repo>> repos(@Path("user") String u); }
Retrofit r = new Retrofit.Builder().baseUrl(..)
    .addConverterFactory(GsonConverterFactory.create()).build();
```

**Top gotchas:**

- HttpClient responses/clients/connection-managers MUST be closed (pooled-connection leak otherwise).
- Only OkHttp `addNetworkInterceptor` sees on-the-wire headers and redirects.
- TLS "trust all" (`TrustStrategy -> true` + `NoopHostnameVerifier`) is a test-only anti-pattern — never prod.

**Current (mid-2026):** JDK `HttpClient` is the zero-dependency default, routinely paired with virtual threads. `RestTemplate → RestClient` (Spring 6.1 sync successor; RestTemplate slated for deprecation in Spring 7.1). OkHttp **5.x** (5.2.0+) supersedes the 3→4 arg-flip; DoH stable; separate JVM/Android artifacts.

## Full content

The corpus teaches an unusually thorough HTTP-client comparison — reading a response body as a String is shown five ways side by side across the libraries. The field divides into the **JDK baseline** (`HttpURLConnection`, legacy; `java.net.http.HttpClient`, Java 11+), the **Apache line** (HttpClient 4.x under `org.apache.http`, 5.x under `org.apache.hc.client5`), the **OkHttp family** (OkHttp itself plus Retrofit, which builds a declarative interface on top of it), and the **also-rans** (Google HTTP Client with pluggable transport and `ExponentialBackOff`, Unirest's fluent one-liners, async-http-client over Netty with WebSocket support, the Jetty reactive client returning a Reactive-Streams `Publisher`), plus Spring's `RestTemplate`/`RestClient`/`WebClient`.

**Apache HttpClient 4.x** is the heavyweight: `HttpClients.custom()` builds a `CloseableHttpClient`, `RequestConfig` controls connect/socket/connection-request timeouts, and `EntityUtils.toString`/`consume` drains the response. The crucial discipline is *resource hygiene* — clients, responses, and connection managers are all `Closeable` and leak pooled connections if not closed (the try-with-resources idiom above). Connection management uses `PoolingHttpClientConnectionManager` with `setMaxTotal`/`setDefaultMaxPerRoute`; multipart uses `MultipartEntityBuilder`. TLS-version control is available three ways, BASIC auth several. The pre-4.3 `DefaultHttpClient`/`HttpParams` API is dead.

**OkHttp**'s distinctive concept is its two-tier interceptor model: *application* interceptors (`addInterceptor`) run once per call and don't see redirects, while *network* interceptors (`addNetworkInterceptor`) sit on the wire and observe actual headers and redirect hops — the right place for logging, response rewriting, and metrics. OkHttp also ships `EventListener` lifecycle hooks (callStart → dns → connect → … → callEnd) and `MockWebServer` for hermetic testing. The notorious API drift: `RequestBody.create(MediaType, body)` in OkHttp 3 had its argument order flipped to `ResponseBody.create(body, MediaType)` in OkHttp 4. **Retrofit** layers a declarative annotated interface (`@GET("users/{user}/repos")`, `@Path`, `@Url`) over OkHttp, configured via `Retrofit.Builder().baseUrl(..).addConverterFactory(GsonConverterFactory.create())`.

For new code in 2026, the JDK's own `java.net.http.HttpClient` is the zero-dependency default for simple synchronous and asynchronous cases, and is now routinely paired with virtual threads so that blocking-style code scales without reactive plumbing. The shown TLS "trust all" patterns (`TrustStrategy -> true`, `NoopHostnameVerifier`) are test-only anti-patterns that must never reach production.

### 2026 currency

- **JDK `java.net.http.HttpClient`** is the default zero-dependency choice (Java 11+), now routinely paired with virtual threads (GA Java 21) — blocking-style code on virtual threads replaces much reactive plumbing. [The state of HTTP clients in Spring (2025)](https://spring.io/blog/2025/09/30/the-state-of-http-clients-in-spring/)
- **`RestTemplate → RestClient`** (Spring Framework 6.1 / Boot 3.2): RestClient is the *synchronous* successor (WebClient's fluent API over RestTemplate's infrastructure). RestTemplate is slated for deprecation in Spring 7.1 (~Nov 2026) and removal in Spring 8.0; WebClient remains the async/streaming choice. [New in Spring 6.1: RestClient](https://spring.io/blog/2023/07/13/new-in-spring-6-1-restclient/)
- **OkHttp 5.x** (5.2.0+ current) supersedes the OkHttp 3→4 `RequestBody.create` arg-flip trap; DoH is stable; 5.x publishes separate JVM (JAR) and Android (AAR) artifacts. [OkHttp Change Log](https://square.github.io/okhttp/changelogs/changelog/)
- Retrofit's `rx.Observable` return type used RxJava 1 (EOL) — modern Retrofit uses RxJava 3 / coroutines / `CompletableFuture` adapters.
