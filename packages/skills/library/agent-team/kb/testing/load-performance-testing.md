---
kb_id: testing/load-performance-testing
version: 1
tags:
  - testing
  - load-testing
  - performance
sources_consulted:
  - "Baeldung tutorials (eugenp/tutorials) modules: gatling, load-testing-comparison"
  - "JMeter vs Gatling vs k6 2026 comparison — vervali.com (https://www.vervali.com/blog/jmeter-vs-gatling-vs-k6-the-complete-2026-comparison-benchmarks-ci-cd-scripting-and-use-cases/)"
related:
  - testing/architecture-coverage-quality
  - testing/rest-api-testing
status: active
---

## Summary

**Concept**: Load / performance testing drives concurrent simulated traffic against a system to measure throughput and latency under load — distinct from functional correctness tests. **Gatling** (code DSL), **JMeter** (GUI/XML), **The Grinder** (dead) are the corpus tools.
**Key APIs**: Gatling `Simulation` + HTTP protocol config + `scenario(...).exec(http(...).get/post).pause(...)` + injection profile `setUp(scn.inject(atOnceUsers(N)))`, `check(jsonPath("$.id").saveAs(...))`, `doIf`; Maven `gatling-maven-plugin`, Jenkins `gatlingArchive()`; JMeter binary `.jmx` Test Plans.
**Gotcha**: Gatling's Recorder generates simulations from captured traffic; `.jmx` plans are GUI-authored binary XML (hard to diff/review in version control).
**2026-currency**: The Grinder is dead (~2012, Jython) → **k6 1.0** (May 2025) is the modern default; Gatling went polyglot (Java/Kotlin/JS/TS via GraalVM, 3.12+; Java DSL since 3.7).
**Sources**: Baeldung `gatling`/`load-testing-comparison`; 2026 load-testing comparison.

## Quick Reference

**Gatling** (Scala DSL; Java DSL since 3.7):
```scala
class RecordedSimulation extends Simulation {
  val httpProtocol = http.baseUrl("https://api.example.com")
  val scn = scenario("Browse")
    .exec(http("get-odds").get("/odds")
       .check(jsonPath("$.id").saveAs("id")))
    .pause(2)
  setUp(scn.inject(atOnceUsers(100))).protocols(httpProtocol)
}
```
JSON capture `check(jsonPath(...).saveAs(...))`, conditional `doIf`, injection profiles (`atOnceUsers`, ramp). CI: `gatling-maven-plugin` (Maven), `gatlingArchive()` (Jenkins). The **Recorder** generates simulations from recorded traffic.

**JMeter**: GUI-authored binary `.jmx` Test Plans — strong protocol coverage, weak version-control ergonomics.

**The Grinder** (dead): Jython `TestRunner` + `HTTPRequest`.

*(The `load-testing-comparison` module expresses one scenario in all three against a shared Spring Boot SUT.)*

**Top gotchas**:
- `.jmx` plans are binary XML — painful to code-review and diff; Gatling/k6 scripts are plain code.
- Load tests are environment- and timing-sensitive; run them as a separate build-time perf harness, not in the unit phase.

**Current (mid-2026)**: **k6 1.0** is the modern default (Go-based, native TS scripting, browser module, Grafana/Kubernetes integration) — the realistic successor to the dead Grinder. Gatling itself went polyglot via GraalVM; Locust is a Python alternative.

## Full content

Load testing is a different discipline from functional testing: the question is not "is the answer correct" but "how does throughput/latency degrade as concurrent users climb." The corpus's `load-testing-comparison` module is a teaching artifact — the *same* scenario implemented in Gatling, JMeter, and The Grinder against one Spring Boot SUT to contrast the tools.

### Gatling — code-as-load-test

Gatling models a `Simulation` containing an HTTP protocol config, one or more `scenario`s (a sequence of `exec(http(...))` steps with `pause`s), and an injection profile (`setUp(scn.inject(atOnceUsers(N)))`) describing how virtual users arrive. Because the simulation is code, it diffs and reviews cleanly and integrates into Maven/Jenkins pipelines. The Recorder bootstraps a simulation from captured browser traffic.

### JMeter and The Grinder

**JMeter** is GUI-first: its `.jmx` Test Plans are binary XML, giving broad protocol support at the cost of version-control friendliness. **The Grinder** (Jython-based) is effectively dead.

### 2026 currency

- **The Grinder (dead, ~2012) → k6 1.0 (May 2025) is the modern load-testing default** — Go-based, native TypeScript scripting, a stable browser module, deep Grafana integration, and Kubernetes via the k6 Operator. Gatling itself went polyglot (Java/Kotlin/JS/TS via GraalVM, 3.12+); Locust is a Python option. [Load testing 2026 (k6 1.0)](https://www.vervali.com/blog/jmeter-vs-gatling-vs-k6-the-complete-2026-comparison-benchmarks-ci-cd-scripting-and-use-cases/) · [Gatling 2026 guide](https://qaskills.sh/blog/gatling-scala-load-testing-complete-guide)
- The Gatling **Java DSL** (since 3.7) means a Java team no longer needs Scala to author simulations.
- Load/perf tests are the build-time performance harness — they run through CI's perf stage rather than the unit-test phase (see [testing/architecture-coverage-quality](architecture-coverage-quality.md)).
