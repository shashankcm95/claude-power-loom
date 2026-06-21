---
kb_id: testing/async-awaitility
version: 1
tags:
  - testing
  - awaitility
  - async
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: libraries-testing (awaitility), spring-testing (scheduled), testing-libraries (systemout), testing-libraries-2 (systemrules/systemstubs), testing-assertions (junit/log)"
  - "Awaitility 4.0.0 release notes — github.com/awaitility/awaitility (https://github.com/awaitility/awaitility/wiki/ReleaseNotes40)"
related:
  - testing/junit5-jupiter
  - testing/spring-testcontext
status: active
---

## Summary

**Concept**: Testing asynchronous / eventually-consistent behavior without `Thread.sleep` — **Awaitility** polls a condition until it holds or times out; companion cross-cutting concerns are JVM-global state control (System Stubs), log-output assertion, and (net-new) virtual-thread impact.
**Key APIs**: Awaitility `await().atMost(...).until(callable, matcher)` / `.untilAsserted(...)`, poll interval/delay/timeout, field polling, method-call proxy; System Stubs `@ExtendWith(SystemStubsExtension.class)` + `@SystemStub`, `withEnvironmentVariable(...).execute(...)`, `catchSystemExit`; Logback `ListAppender<ILoggingEvent>` capture.
**Gotcha**: Awaitility 3.x `Duration` is its own type (not `java.time.Duration`); timing-coupled assertions (`atLeast(10)` vs `fixedDelay=5ms`) flake on slow CI; `Thread.sleep`-based scheduled tests are inherently slow/flaky.
**2026-currency**: Awaitility 3.x → 4.x switched to `java.time.Duration` (constants moved to `org.awaitility.Durations`); System Rules/Lambda → System Stubs (reflection env-var mutation breaks on JDK 16+); virtual threads (Java 21) reshape async-testing assumptions.
**Sources**: Baeldung `libraries-testing`/`spring-testing`/`testing-libraries`(-2)/`testing-assertions`; Awaitility 4.0 release notes.

## Quick Reference

**Awaitility** (eventual conditions, no sleep):
```java
await().atMost(Duration.ofSeconds(5))
       .pollInterval(Duration.ofMillis(100))
       .untilAsserted(() -> verify(spy, atLeast(10)).run());

await().atMost(5, SECONDS).until(svc::isReady);   // condition + matcher form
```
Poll interval/delay/timeout; field polling; method-call proxy; `untilAsserted(...)` wraps any assertion. The recommended way to test async / `@Scheduled` work instead of `Thread.sleep`.

**Testing `@Scheduled`** (Spring): sleep+count (flaky) vs `@SpyBean` + Awaitility `untilAsserted` (robust) — see [testing/spring-testcontext](spring-testcontext.md).

**JVM-global state control** (three eras):
- **System Rules** (JUnit 4 `@Rule`): `SystemOutRule`, `ExpectedSystemExit`, `ProvideSystemProperty`, `TextFromStandardInputStream`.
- **System Lambda** (execute-around): `tapSystemOut(...)`, `withEnvironmentVariable(...).execute(...)`, `catchSystemExit`.
- **System Stubs** (newest): JUnit 4 rules + JUnit 5 `@ExtendWith(SystemStubsExtension.class)` + `@SystemStub` injection; env vars/properties/stdin/stdout/`System.exit`, custom `TestResource`.

**Asserting on logs**: subclass Logback `ListAppender<ILoggingEvent>` (an in-memory appender), then assert message/level/count.

**Top gotchas**:
- Awaitility 3.x `Duration` is `org.awaitility.Duration`, not `java.time.Duration` — easy to confuse.
- Timing-coupled assertions (`atLeast(10)` against a 5ms `fixedDelay`) flake on slow CI.
- System Stubs' reflection-based env-var mutation breaks/warns on JDK 16+ (strong encapsulation).

**Current (mid-2026)**: Awaitility 4.3.x uses `java.time.Duration`; virtual threads (Java 21 GA) shift polling/thread-pool assumptions.

## Full content

Time is the enemy of deterministic tests. `Thread.sleep` couples the test to an absolute duration — too short and it flakes, too long and the suite crawls. The async-testing toolkit replaces fixed waits with condition polling and controlled global state.

### Awaitility — poll, don't sleep

`await().atMost(...).until(...)` repeatedly evaluates a condition (a `Callable`+matcher, a field, a proxied method call, or an arbitrary assertion via `untilAsserted`) until it passes or the timeout fires. This converts "wait long enough" into "wait exactly until ready," eliminating both flakiness and dead time. The canonical Spring use is testing `@Scheduled` methods: rather than sleep and count, spy the bean and `await().untilAsserted(() -> verify(spy, atLeast(n)).run())`. The standing risk is timing-coupled bounds: asserting `atLeast(10)` invocations against a 5ms fixed delay will flake on a loaded CI runner.

### JVM-global state control

Tests that touch `System.out`, `System.exit`, environment variables, or system properties need those globals captured and restored. Three generations exist: **System Rules** (JUnit 4 only), **System Lambda** (execute-around lambdas), and **System Stubs** (the newest, with both JUnit 4 rules and a JUnit 5 extension). Their env-var mutation is reflection-based, which collides with JDK 16+ strong encapsulation.

### Asserting on logs

To assert that code logged the expected message/level, attach an in-memory Logback `ListAppender<ILoggingEvent>` and query the captured events — no log file or stdout scraping needed.

### 2026 currency

- **Awaitility 3.x → 4.x** switched from `org.awaitility.Duration` to `java.time.Duration` (constants moved to `org.awaitility.Durations`); v3 code won't compile against 4+. Current is the 4.3.x line. [Awaitility 4.0.0 release notes (GitHub wiki)](https://github.com/awaitility/awaitility/wiki/ReleaseNotes40)
- **System Rules 1.19 (JUnit-4-only) → System Stubs/Lambda.** System Stubs 1.1 → 2.x; its reflection-based env-var mutation breaks/warns on JDK 16+ (strong encapsulation). Abandoned System Rules receives no patches.
- **Virtual threads (Java 21 GA) reshape concurrency/async testing.** Awaitility-style polling and thread-pool assumptions shift; Java 24 removed `synchronized` pinning (JEP 491) so blocking-in-`synchronized` no longer starves the carrier pool — test code asserting platform-thread behavior needs re-thinking. [JEP 491: Synchronize Virtual Threads without Pinning (OpenJDK)](https://openjdk.org/jeps/491)
- Awaitility (the concept) carries forward as the current way to test async work.
