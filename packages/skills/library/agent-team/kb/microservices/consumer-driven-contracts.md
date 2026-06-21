---
kb_id: microservices/consumer-driven-contracts
version: 1
tags:
  - microservices
  - contract-testing
  - spring-cloud-contract
  - testing
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-cloud-contract"
  - "Spring Cloud 2025.0.0 Northfields release (spring.io/blog/2025/05/29)"
related:
  - microservices/event-driven-streaming
  - microservices/declarative-http-clients
status: active
---

## Summary

**Concept**: Consumer-Driven Contracts make a single contract the source of truth for both sides of a service boundary — it generates the producer's verification tests AND a consumer-side stub, so the two stay in sync without an integrated environment.
**Key APIs**: Groovy DSL `Contract.make { request{...} response{...} }`; `spring-cloud-contract-maven-plugin` (producer test gen + WireMock stub jar); `@AutoConfigureStubRunner(stubsMode=, ids=)` (consumer); `BaseTestClass` + `RestAssuredMockMvc`.
**Gotcha**: the contract is authoritative for BOTH sides — drift between the two is impossible by construction (that is the whole point), but a hand-written `BaseTestClass` must wire `RestAssuredMockMvc.standaloneSetup` to the real controller or the generated producer tests test nothing.
**2026-currency**: Spring Cloud Contract is actively maintained and ages well as a concept; shipped in the 2025.0 train.
**Sources**: Baeldung `spring-cloud-contract`; Spring Cloud 2025.0.

## Quick Reference

**The contract** (Groovy DSL, the shared source of truth):
```groovy
Contract.make {
  request  { method GET(); url '/validate/prime-number?number=2' }
  response { body("Even"); status 200 }
}
```

**Producer side**: the `spring-cloud-contract-maven-plugin` generates verification tests from the contracts. Each generated test extends a hand-written `BaseTestClass` that sets up the controller under test (`RestAssuredMockMvc.standaloneSetup(new Controller())`). The plugin also packages a WireMock **stub jar** as a build artifact.

**Consumer side**: run the producer's stub jar as a local WireMock server:
```java
@AutoConfigureStubRunner(stubsMode = StubRunnerProperties.StubsMode.LOCAL,
    ids = "com.baeldung:spring-cloud-contract-producer:+:stubs:8090")
```
The consumer's tests hit `localhost:8090` and get exactly the responses the contract promises.

**Top gotchas**:
- The `BaseTestClass` must actually wire the real controller, or the producer's generated tests pass vacuously.
- `stubsMode=LOCAL` reads from the local Maven repo — the stub jar must be installed first; `REMOTE` pulls from a repo.

**Current (mid-2026)**: Spring Cloud Contract is listed as still-maintained and a concept that ages well; it ships in the Spring Cloud 2025.0.0 "Northfields" train. Consumer-Driven Contract testing remains the canonical way to keep producer/consumer API expectations aligned without a full integration environment.

## Full content

Consumer-Driven Contracts (CDC) solve the integration-testing problem at a service boundary: rather than spinning up both services together, a single declarative contract is the source of truth. From it, the framework generates the producer's verification tests (proving the producer honors the contract) and a stub the consumer runs locally (letting the consumer test against the promised behavior). Because both sides derive from the same artifact, they cannot silently drift.

### Producer and consumer flow

On the producer, the maven plugin reads the Groovy contracts and emits JUnit verification tests, each extending a hand-written `BaseTestClass` that stands up the controller via `RestAssuredMockMvc`. The plugin also builds a WireMock stub jar. On the consumer, `@AutoConfigureStubRunner` downloads and runs that stub jar as a local WireMock server, so the consumer's integration tests get contract-faithful responses without the real producer running. The contract — not either codebase — is authoritative.

### 2026 currency

- **Spring Cloud Contract is maintained and ages well.** The corpus freshness verdict explicitly lists Consumer-Driven Contracts (Spring Cloud Contract still maintained) among the abstractions that survive; it ships in the current Spring Cloud 2025.0.0 "Northfields" train. [Spring Cloud 2025.0.0 release](https://spring.io/blog/2025/05/29/spring-cloud-2025-0-0-is-abvailable/)
- **Test-client modernization.** Spring Framework 7 adds `RestTestClient`, complementing the contract-test surface for HTTP assertions. [Spring Framework 7.0 GA](https://spring.io/blog/2025/11/13/spring-framework-7-0-general-availability/)
- **API versioning is now first-class.** Spring Boot 4 / Framework 7 add built-in API versioning, which pairs naturally with contract testing for managing backward-compatible evolution — an area the 2021 corpus left to Avro registries only. [Spring Framework 7.0 GA](https://spring.io/blog/2025/11/13/spring-framework-7-0-general-availability/)
