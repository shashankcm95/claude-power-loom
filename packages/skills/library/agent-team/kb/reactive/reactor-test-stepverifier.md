---
kb_id: reactive/reactor-test-stepverifier
version: 1
tags:
  - reactive
  - reactor
  - testing
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) module: spring-5-reactive-2"
  - "reactor-core releases (github.com/reactor/reactor-core/releases)"
related:
  - reactive/project-reactor-core
  - reactive/spring-webflux
status: active
---

## Summary

**Concept**: Reactor-Test verifies reactive pipelines deterministically — `StepVerifier` scripts the expected signal sequence, `TestPublisher` drives controlled (even spec-violating) sources, and virtual time removes wall-clock flakiness.
**Key APIs**: `StepVerifier.create(...)`.`expectNext`/`expectNextMatches`/`expectNextCount`/`thenRequest`/`thenCancel`/`verifyComplete`/`expectError`; `.verifyThenAssertThat().hasDropped(...).tookLessThan(...)`; `StepVerifier.withVirtualTime(...)`.`expectNoEvent`/`thenAwait`; `TestPublisher.create()`; `Hooks.onOperatorDebug()`/`checkpoint()`/`Flux.log()`.
**Gotcha**: time-based tests using `Thread.sleep` as an async gate are flaky — use virtual time or `StepVerifier` latches instead.
**2026-currency**: `StepVerifier`/`TestPublisher`/virtual time all current in Reactor 3.8; prod debugging via `ReactorDebugAgent` (reactor-tools) over the dev-only `Hooks.onOperatorDebug()`.
**Sources**: Baeldung `spring-5-reactive-2` module; reactor-core releases.

## Quick Reference

**`StepVerifier` — the core scripting API**:

```java
StepVerifier.create(publisher)
    .expectNext("a", "b")
    .expectNextMatches(s -> s.startsWith("c"))
    .expectNextCount(3)
    .thenRequest(2)        // drive backpressure
    .thenCancel()          // or .verifyComplete()
    .verify();
```

- Success: `expectNext` / `expectNextMatches(pred)` / `expectNextCount(n)` / `verifyComplete()`.
- Errors: `expectError(...)` / `expectErrorMatches(pred)`.
- Backpressure: `thenRequest(n)` drives demand; pair with `BaseSubscriber.hookOnNext` + `request(n)`/`cancel()` and `limitRate(n)`.
- Post-execution: `.verifyThenAssertThat().hasDropped(...).tookLessThan(...)`.

**Virtual time** (deterministic timer/interval/delay tests):

```java
StepVerifier.withVirtualTime(() -> Flux.interval(Duration.ofSeconds(1)).take(2))
    .expectSubscription()
    .expectNoEvent(Duration.ofSeconds(1))
    .thenAwait(Duration.ofSeconds(2))
    .expectNext(0L, 1L)
    .verifyComplete();
```

**`TestPublisher`** — drive a controlled source:
- `TestPublisher.create().next(...).error(...).flux()`.
- `createNoncompliant(Violation.ALLOW_NULL)` to test misbehaving / spec-violating sources.

**Debugging hooks**:
- `Flux.log()` — log all signals.
- `Hooks.onOperatorDebug()` — capture assembly-time stack traces (dev only; expensive).
- `checkpoint("label")` — lightweight per-operator traceback.

**Top gotchas**:
- `Thread.sleep`-as-async-gate is flaky; prefer virtual time / latches / `StepVerifier`.
- Hard-coded Rx/Reactor thread-name assertions break across environments.
- Mocking `WebClient` deep-stubs is brittle — prefer MockWebServer/WireMock + `StepVerifier`.

**Current (mid-2026)**: `StepVerifier` (incl. virtual time + post-execution assertions), `TestPublisher`, and backpressure scripting are all current in Reactor 3.8. For production operator debugging, prefer `ReactorDebugAgent` (reactor-tools, a Java agent) over the dev-only `Hooks.onOperatorDebug()`.

## Full content

Reactor-Test is the verification toolkit for reactive pipelines. Because a reactive type is an inert blueprint until subscribed and may emit on other threads or after delays, ordinary assertions don't work — you need a tool that subscribes, scripts the expected signal sequence, and (for time) substitutes a virtual clock. The Baeldung `spring-5-reactive-2` module covers the full surface (`stepverifier/{StepByStep,PostExecution,TimeBased,TestingTestPublisher}UnitTest.java`, `backpressure/BackpressureUnitTest.java`).

### StepVerifier

`StepVerifier.create(publisher)` subscribes and lets you assert each expected signal in order: `expectNext(values...)`, `expectNextMatches(predicate)`, `expectNextCount(n)`, then a terminal `verifyComplete()` or `expectError(...)`/`expectErrorMatches(...)`. The script fails if the actual sequence diverges. Backpressure is testable directly: `thenRequest(n)` issues demand to the upstream, so you can prove a producer respects `request(n)`. `thenCancel()` verifies cancellation behavior. Post-execution assertions (`.verifyThenAssertThat().hasDropped(...).tookLessThan(...)`) check dropped elements and elapsed time after the verification runs.

### Virtual time

Tests over `interval`, `timer`, or `delay` would otherwise block on the wall clock and be slow + flaky. `StepVerifier.withVirtualTime(supplier)` installs a virtual scheduler; `expectNoEvent(d)` asserts nothing happens for a duration and `thenAwait(d)` advances the virtual clock — so a one-hour interval test runs instantly and deterministically. (The RxJava analog is `TestScheduler.advanceTimeBy/advanceTimeTo`.)

### TestPublisher

When you need to drive a source under test (e.g. an operator), `TestPublisher.create().next(...).error(...).flux()` emits exactly the signals you script. `createNoncompliant(Violation.ALLOW_NULL)` deliberately produces a spec-violating source (e.g. a `null`), letting you verify your operator's defensive behavior against misbehaving upstreams.

### Backpressure verification

`BaseSubscriber.hookOnNext` calling `request(n)`/`cancel()`, combined with `limitRate(n)`, lets a test assert exact demand handling; `StepVerifier.thenRequest(n)` drives it from the consumer side (`BackpressureUnitTest.java`).

### Debugging

`Flux.log()` prints every signal. `Hooks.onOperatorDebug()` captures assembly-time stack traces so an error points back to the operator that introduced it — but it is expensive and dev-only. `checkpoint("label")` is the lightweight per-operator alternative. Common test smells to avoid: `Thread.sleep`-as-async-gate (e.g. `Thread.sleep(20000)`), hard-coded thread-name assertions, and live external endpoints — all flaky; use latches, `StepVerifier`, `TestScheduler`, or `vertx-unit`.

### 2026 currency

- **Reactor-Test is current.** `StepVerifier` (with virtual time + post-execution assertions), `TestPublisher`, and backpressure scripting all carry forward unchanged into Reactor 3.8.x. [reactor-core releases](https://github.com/reactor/reactor-core/releases)
- **Production debugging via `ReactorDebugAgent`.** The dev-only `Hooks.onOperatorDebug()` is superseded for production by `ReactorDebugAgent` (reactor-tools), a Java agent that instruments operators with low overhead. [reactor-core releases](https://github.com/reactor/reactor-core/releases)
- **Mocking `WebClient` remains brittle.** Every fluent step must be stubbed in exact order; a chain refactor breaks the test — prefer MockWebServer/WireMock + `StepVerifier`. This holds across Spring 6/WebFlux. [reactor-core releases](https://github.com/reactor/reactor-core/releases)
