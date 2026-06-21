---
kb_id: testing/rest-api-testing
version: 1
tags:
  - testing
  - rest-assured
  - http-mocking
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: rest-assured, rest-testing (wiremock), mockserver, zerocode"
  - "WireMock 3.13.1 released — wiremock.io (https://www.wiremock.io/post/wiremock-3-13-1-released)"
  - "Pact JVM releases — github.com/pact-foundation/pact-jvm (https://github.com/pact-foundation/pact-jvm/releases)"
related:
  - testing/json-xml-assertions
  - testing/testcontainers
  - testing/spring-testcontext
  - testing/bdd-acceptance
  - testing/load-performance-testing
status: active
---

## Summary

**Concept**: Testing HTTP/REST APIs — **REST-Assured** drives + asserts on a live API; **WireMock**/**MockServer** stand up stub HTTP servers so a SUT's downstream calls are deterministic; **ZeroCode** declares scenarios in JSON. Net-new: consumer-driven **contract testing** (Pact, Spring Cloud Contract).
**Key APIs**: REST-Assured `given().when().get(...).then().statusCode(200).body("gpath", equalTo(...))`, `matchesJsonSchemaInClasspath`, auth, `RestAssuredMockMvc`; WireMock `stubFor(get(urlEqualTo(...)).willReturn(aResponse()...))`, `verify(getRequestedFor(...))`, `atPriority`, Scenarios; MockServer `ClientAndServer.startClientAndServer`, `MockServerClient.when(...).respond(...)`.
**Gotcha**: WireMock stub priority — without `atPriority`, a more-specific stub is NOT guaranteed to win over a broader one.
**2026-currency**: WireMock 2.x → 3.x with new group `org.wiremock` + first-class JUnit 5 `WireMockExtension`/`@WireMockTest`; MockServer package paths relocated; Pact JVM + Spring Cloud Contract 5.0.x are the modern contract tools.
**Sources**: Baeldung `rest-assured`/`rest-testing`/`mockserver`/`zerocode`; WireMock 3.13.1; Pact JVM releases.

## Quick Reference

**REST-Assured** (drive + assert a live API):
```java
given().auth().basic(u, p)
.when().get("/odds")
.then().statusCode(200)
    .time(lessThan(2000L))
    .body("odds.findAll{it.status>0}.price", hasItems(...));  // Groovy GPath
```
JSON Schema validation `matchesJsonSchemaInClasspath("schema.json")`; XML/XPath `hasXPath`; params/headers/cookies; request logging `.log().ifValidationFails()`; auth (basic/preemptive/digest/oauth2/form); **Spring MockMvc module** `RestAssuredMockMvc.webAppContextSetup/standaloneSetup`.

**WireMock** (HTTP stub server):
```java
stubFor(get(urlEqualTo("/x")).atPriority(1)
    .willReturn(aResponse().withStatus(200).withBody("...")));
verify(getRequestedFor(urlEqualTo("/x")));
```
Programmatic `WireMockServer` or `@Rule WireMockRule`; matchers (`urlPathMatching`, body `containing`, header `matching`); **stateful Scenarios** (`inScenario`/`whenScenarioStateIs`/`willSetStateTo`).

**MockServer** (in-process mock/proxy):
`ClientAndServer.startClientAndServer(port)`; `MockServerClient.when(request()...).respond(response()...)`; forwarding + server-side callback classes; `verify(..., VerificationTimes.exactly(n))`.

**ZeroCode** (declarative JSON/YAML): thin host `@RunWith(ZeroCodeUnitRunner.class)` + `@TargetEnv` + `@Scenario`; logic in JSON (`steps[]`, `verify`/`assertions`, `$NOT.NULL`).

**Top gotchas**:
- WireMock stub priority is not implicit — set `atPriority` so a specific stub beats a broad one.
- REST-Assured *LiveTest*s hit real endpoints (GitHub API, etc.) — brittle/environment-dependent.

**Current (mid-2026)**: WireMock is `org.wiremock:wiremock:3.13.2` with a JUnit 5 `WireMockExtension`; for microservices, consumer-driven contract testing (Pact JVM, Spring Cloud Contract) is the standard not present in the 2021 corpus.

## Full content

API testing splits into two postures: testing *your* API (REST-Assured against a running service) and isolating a SUT from *its* downstream dependencies (WireMock/MockServer stubbing the HTTP calls it makes).

### REST-Assured — fluent client-side assertions

`given()/when()/then()` reads as a request-then-expectation DSL. Body assertions use Groovy **GPath** expressions over the parsed JSON/XML, combined with Hamcrest matchers. Beyond status/body it covers JSON Schema validation (`matchesJsonSchemaInClasspath`), response time, auth schemes, and a Spring MockMvc module (`RestAssuredMockMvc`) that runs the same DSL against the in-process MVC stack without a network hop.

### WireMock and MockServer — stub the downstream

When a SUT calls an external HTTP service, a stub server makes that dependency deterministic. **WireMock** registers stubs (`stubFor(...).willReturn(...)`) with flexible request matchers, verifies received requests, and models multi-step interactions with **Scenarios** (a state machine). Stub **priority** is explicit: without `atPriority`, overlapping stubs resolve nondeterministically. **MockServer** is similar (`when(...).respond(...)`) and adds proxy/forwarding and server-side callback classes.

### ZeroCode and contract testing

**ZeroCode** pushes the scenario entirely into JSON/YAML with a thin Java host. The major net-new category absent from the 2021 corpus is **consumer-driven contract testing**: the consumer's expectations become a contract the provider verifies (Pact), or a shared DSL generates both stubs and verification (Spring Cloud Contract) — the standard tools for keeping microservice boundaries honest.

### 2026 currency

- **WireMock 2.x → 3.x with a new group.** Migrated from `com.github.tomakehurst` (2.x) to `org.wiremock` (3.x), with a first-class JUnit 5 `WireMockExtension` / `@WireMockTest`. Current is `org.wiremock:wiremock:3.13.2`; 3.x is entering maintenance as the team works toward the first non-beta WireMock 4. [WireMock 3.13.1 released](https://www.wiremock.io/post/wiremock-3-13-1-released) · [WireMock JUnit Jupiter docs](https://wiremock.org/docs/junit-jupiter/)
- **MockServer** old package paths (`org.mockserver.client.server.MockServerClient`, `ClientAndProxy`, raw `ExpectationCallback`) relocated/reworked (`ExpectationResponseCallback`) — won't compile against current MockServer.
- **Consumer-driven contract testing** — **Pact JVM** (junit5 module) and **Spring Cloud Contract 5.0.x** (Groovy/YAML DSL + stub verifier) are the standard microservice contract tools, absent from the 2021 corpus. [Pact JVM releases (GitHub)](https://github.com/pact-foundation/pact-jvm/releases) · [Spring Cloud Contract releases](https://github.com/spring-cloud/spring-cloud-contract/releases)
- The `com.github.fge` JSON-schema validator is unmaintained → `networknt`/`everit`.
