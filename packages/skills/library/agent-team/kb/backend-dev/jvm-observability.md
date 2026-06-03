---
kb_id: backend-dev/jvm-observability
version: 1
tags:
  - backend
  - jvm
  - java
  - observability
  - metrics
  - tracing
  - logging
  - sre
  - reliability
sources_consulted:
  - "Micrometer — Application Observability facade (Micrometer / VMware-Broadcom, micrometer.io docs, 2026) — `MeterRegistry`, dimensional metrics, Micrometer Tracing as the successor to Spring Cloud Sleuth + the `micrometer-tracing-bridge-otel` bridge"
  - "OpenTelemetry — Signals + Java instrumentation (CNCF, opentelemetry.io docs, 2026; graduated CNCF project 2026-05-21; merger of OpenTracing + OpenCensus, May 2019) — traces/metrics/logs/baggage signals, `-javaagent` zero-code auto-instrumentation, `GlobalOpenTelemetry`, manual API spans"
  - "Tom Wilkie — The RED Method (Weaveworks, 2015; popularized via Grafana Labs blog 'The RED Method: how to instrument your services' + The New Stack, 2018) — Rate / Errors / Duration; derived from Google's Four Golden Signals for request-driven services"
  - "Brendan Gregg — The USE Method (brendangregg.com + ACM Queue 'Thinking Methodically about Performance', 2013) — Utilization / Saturation / Errors per resource; 'For every resource, check utilization, saturation, and errors.'"
  - "Site Reliability Engineering (Beyer / Jones / Petoff / Murphy, Google / O'Reilly, 2016) — ch 4 Service Level Objectives (SLI / SLO / error budget = 1 − SLO) + ch 6 Monitoring Distributed Systems (the Four Golden Signals: Latency / Traffic / Errors / Saturation)"
  - "JDK Flight Recorder / JFR (Oracle Java SE + JDK Mission Control docs, 2024) — built-in JVM event-collection + profiling framework; default profile < 1% overhead; `jcmd <pid> JFR.start` / `JFR.dump`"
related:
  - backend-dev/jvm-runtime-basics
  - backend-dev/spring-boot-essentials
  - infra-dev/observability-basics
  - architecture/discipline/reliability-scalability-maintainability
  - architecture/discipline/error-handling-discipline
  - architecture/crosscut/idempotency
status: active
---

## Summary

**Instinct (`observability-first`)**: instrument a JVM service for **metrics, logs, and traces from the first commit** — observability is a design input, not a post-incident retrofit. A service you cannot see is a service you cannot operate.
**Three pillars (OpenTelemetry signals)**: **metrics** (aggregatable numbers over time), **logs** (timestamped event records), **traces** (the path of one request across services). Plus **baggage** (context propagated between signals).
**Instrument once, export anywhere**: use **Micrometer** as the metrics facade (`MeterRegistry`, dimensional tags) and **Micrometer Tracing** / **OpenTelemetry (OTel)** for traces. OTel's `-javaagent` gives zero-code auto-instrumentation; the OTel API adds manual spans where the agent can't see intent.
**Pick signals by method**: **RED** (Rate / Errors / Duration — Tom Wilkie, 2015) for request-driven services; **USE** (Utilization / Saturation / Errors — Brendan Gregg) for resources (CPU, heap, pools); both descend from Google's **Four Golden Signals** (Latency / Traffic / Errors / Saturation).
**JVM-specific signals**: GC pause time + frequency, heap-by-generation, thread-pool saturation, and **JDK Flight Recorder (JFR)** for `<1%`-overhead production profiling. Tie it to **SLIs / SLOs** (SRE book ch 4): an SLO is a reliability target; the **error budget** is `1 − SLO`.
**Sources**: Micrometer + OpenTelemetry (CNCF) docs + Tom Wilkie/Grafana (RED) + Brendan Gregg (USE) + Google SRE book (golden signals, SLI/SLO) + Oracle JFR docs.

## Quick Reference

**The three pillars — instrument all three, not just one:**

| Pillar | What it answers | JVM tooling | Cardinality cost |
|--------|-----------------|-------------|------------------|
| **Metrics** | "Is it healthy *right now*? what's the trend?" | Micrometer `MeterRegistry` → Prometheus / OTLP | low (aggregated) — cheap to keep |
| **Logs** | "What exactly happened in *this* event?" | SLF4J + Logback/Log4j2, **structured JSON** | high — sample/retention-bound |
| **Traces** | "*Where* did this request spend time / fail across services?" | Micrometer Tracing / OTel spans | medium — usually sampled |

**Correlation is the multiplier**: stamp the **`trace_id`** (and `span_id`) into every log line via MDC so a trace links to its logs and a log links back to its trace. One ID joins all three pillars.

**Two complementary method-lenses — apply BOTH:**

| Method | Axes | Best for | Source |
|--------|------|----------|--------|
| **RED** | **R**ate, **E**rrors, **D**uration | request-driven services / endpoints (the *caller's* view) | Tom Wilkie, Weaveworks 2015 |
| **USE** | **U**tilization, **S**aturation, **E**rrors | resources: CPU, heap, thread pools, connection pools | Brendan Gregg |
| Four Golden Signals | Latency, Traffic, Errors, Saturation | the shared ancestor both specialize | Google SRE book ch 6 |

> Brendan Gregg: *"For every resource, check utilization, saturation, and errors."*

**JVM-specific signals worth a dashboard row each:**

| Signal | Why it matters | Micrometer meter / source |
|--------|----------------|---------------------------|
| **GC pause time + frequency** | stop-the-world pauses = latency spikes at the tail | `jvm.gc.pause`, `jvm.gc.concurrent.phase.time` |
| **Heap used / committed / max, by generation** | rising old-gen after GC = a leak; near-max = imminent OOM | `jvm.memory.used{area=heap}`, `jvm.gc.live.data.size` |
| **Thread-pool active / queue depth** | a saturated pool is the USE "saturation" axis made concrete | `executor.active`, `executor.queued`, `tomcat.threads.busy` |
| **Allocation rate** | high churn drives GC frequency | `jvm.gc.memory.allocated` |
| **Class load / metaspace** | dynamic class growth → metaspace OOM | `jvm.classes.loaded`, `jvm.memory.used{area=nonheap}` |
| **JFR events** | method/alloc/lock profiling in prod, `<1%` overhead | `jcmd <pid> JFR.start` |

**SLI / SLO basics (SRE book ch 4):** an **SLI** is a measured indicator (e.g. fraction of requests `<300ms`); an **SLO** is the target for that SLI (e.g. `99.9%` over 30 days); the **error budget** = `1 − SLO` (a `99.9%` SLO buys a `0.1%` budget to spend on releases/risk). Pick RED-derived SLIs (success rate, p99 latency) — they are what users feel.

**Top smells:**

- Only logs, no metrics/traces — you can read one event but can't see the trend or the cross-service path.
- `System.out.println` / unstructured text logs — unsearchable, no `trace_id`, no fields to aggregate.
- Metrics with an **unbounded-cardinality tag** (user id, request id, full URL as a label) — a Prometheus/registry cardinality explosion.
- Instrumentation "added later" after an incident — the outage you needed it for already happened.
- An SLO with no SLI behind it (a target nobody is actually measuring).

## Intent

A backend service is opaque by default: it accepts requests, mutates state, and calls dependencies, all invisibly. The single most common operational failure is discovering — *during* an incident — that the signal you need to diagnose the problem was never instrumented. By then it is too late: you cannot retroactively observe an outage that already happened.

The `observability-first` instinct inverts the default. Observability is treated as a **first-class design input**, decided alongside the API and the data model, not bolted on after the first page. Concretely, a JVM service is born with all three OpenTelemetry pillars — metrics, logs, traces — wired from the first commit, correlated by a shared trace id, and shaped by an explicit method (RED for requests, USE for resources) so the dashboards answer real diagnostic questions instead of accreting whatever was easy to emit. The payoff is that when something breaks, the data to understand it already exists.

## The Principle

> "The path of a request through your application [traces] … a measurement captured at runtime [metrics] … a recording of an event [logs]." — OpenTelemetry, *Signals* (CNCF)

> "For every resource, check utilization, saturation, and errors." — Brendan Gregg, *The USE Method*

> "An SLO is a service level objective: a target value or range of values for a service level that is measured by an SLI. … An error budget is 1 minus the SLO of the service." — *Site Reliability Engineering* (Google, 2016), ch 4

Reformulated for a JVM backend:

- **Instrument all three pillars, not one.** Logs alone answer "what happened in this event" but not "is the trend bad" (metrics) or "where across services did the request fail" (traces). The pillars are complementary, not substitutable.
- **Instrument once, export anywhere.** Depend on a facade (Micrometer for metrics, Micrometer Tracing / OTel for traces) the way you depend on SLF4J for logs — so the backend choice (Prometheus, OTLP collector, a vendor) is a deployment decision, not a code rewrite.
- **Shape signals by an explicit method.** RED for the caller's view of a request; USE for the resource's own view. A dashboard built from a method answers questions; one built from convenience just accumulates noise.
- **Make it correlatable.** A `trace_id` in every log line (MDC) is what turns three separate streams into one joinable story.
- **Tie signals to objectives.** Raw graphs don't tell you if you're *meeting the bar*. An SLI + SLO + error budget converts "the latency graph looks spiky" into "we've burned 60% of this month's budget — slow down releases."

## The three pillars in practice (JVM)

**Metrics — Micrometer.** Micrometer is a dimensional-metrics **facade** ("SLF4J for metrics"): you instrument once against a `MeterRegistry` and choose the backend (Prometheus, OTLP, etc.) at wiring time. Spring Boot Actuator auto-configures a registry and exposes `/actuator/prometheus`. JVM and pool meters (`jvm.*`, `executor.*`, `tomcat.*`) bind automatically. **Keep tag cardinality bounded** — tags are dimensions, and a high-cardinality tag (user id, request id) multiplies time-series count and can OOM the scrape.

**Traces — Micrometer Tracing + OpenTelemetry.** **OpenTelemetry (OTel)** is the CNCF observability standard (graduated 2026; the 2019 merger of OpenTracing + OpenCensus) defining the signals and the wire protocol (OTLP). Two instrumentation modes, used together:

```bash
# Zero-code auto-instrumentation: the agent wires HTTP/JDBC/Kafka/... spans for you.
java -javaagent:opentelemetry-javaagent.jar \
     -Dotel.service.name=orders-api \
     -Dotel.exporter.otlp.endpoint=http://collector:4317 \
     -jar orders-api.jar
```

```java
// Manual instrumentation: the agent makes spans, your code adds business meaning.
import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.Tracer;

Tracer tracer = GlobalOpenTelemetry.getTracer("orders-api");
Span span = tracer.spanBuilder("reserveInventory").startSpan();
try (var scope = span.makeCurrent()) {
    span.setAttribute("order.id", orderId);   // bounded, business-meaningful attribute
    reserveInventory(orderId);
} catch (Exception e) {
    span.recordException(e);
    throw e;
} finally {
    span.end();
}
```

In a Spring Boot 3 service, **Micrometer Tracing** (the successor to Spring Cloud Sleuth) is the in-app facade; the `micrometer-tracing-bridge-otel` dependency bridges the Micrometer **Observation API** to OpenTelemetry so one `@Observed` / `Observation` emits both a metric and a span with consistent metadata.

**Logs — structured + correlated.** Emit **structured JSON** logs (Logback/Log4j2 with a JSON encoder), not free text, so fields are queryable. Put the request context — request id, user id, and crucially the **`trace_id`/`span_id`** — into **MDC** so each line carries it. With tracing wired, the trace id is auto-populated, making the trace ↔ logs join automatic.

## RED, USE, and the Four Golden Signals

These are **dashboard-design methods**, not metrics libraries — they tell you *which* signals to emit.

- **Four Golden Signals** (Google SRE book ch 6, *Monitoring Distributed Systems*): **Latency, Traffic, Errors, Saturation** — "if you can only measure four metrics of your user-facing system, focus on these." The shared ancestor.
- **RED** (Tom Wilkie, Weaveworks 2015): **Rate** (requests/sec), **Errors** (failed requests/sec), **Duration** (latency distribution — track percentiles, p99 not just mean). RED is the *caller's* view and applies uniformly to every request-driven service, which is exactly why it "reduces the cognitive load of on-call." Per-endpoint RED is the backbone of an API service dashboard.
- **USE** (Brendan Gregg): for **every resource**, **Utilization** (busy fraction), **Saturation** (queued/extra work it can't service — *the* leading indicator), **Errors**. USE is the *resource's* view: apply it to CPU, heap, the Tomcat thread pool, the JDBC connection pool. Gregg's key insight: a resource at 60% utilization *with* saturation is worse than 90% utilization *without* it — utilization alone hides the queue.

**They compose**: RED tells you the *symptom* (p99 latency on `/checkout` is up, error rate climbing); USE on the JVM resources tells you the *cause* (the JDBC pool is saturated, GC pause time spiked). Symptom-based alerting (RED/golden) + resource-based diagnosis (USE) is the standard pairing.

## JVM-specific signals

A generic three-pillars setup misses the runtime underneath. Add the JVM's own signals (most are auto-bound by Micrometer's JVM/Tomcat meter binders):

- **Garbage collection** — pause **duration** and **frequency** (`jvm.gc.pause`), allocation rate (`jvm.gc.memory.allocated`), and live-data size after GC (`jvm.gc.live.data.size`). Long or frequent stop-the-world pauses show up as tail-latency in your RED Duration; old-gen that keeps rising after each GC is the classic leak signature.
- **Heap & memory** — used/committed/max per area and generation (`jvm.memory.used`, `jvm.memory.max`). Heap trending toward max = imminent `OutOfMemoryError`; pair with `-XX:+HeapDumpOnOutOfMemoryError`.
- **Threads & pools** — live/daemon thread count (`jvm.threads.live`) and, per the USE method, **pool saturation**: `executor.active` / `executor.queued`, `tomcat.threads.busy` vs max. A saturated request pool is a latency cliff.
- **JDK Flight Recorder (JFR)** — JFR is the JDK's built-in low-overhead event-collection + profiling framework. The default profile runs at **`<1%` overhead**, so it is safe to leave armed in production; capture on demand or continuously:

```bash
# Start a 60s recording on a running JVM and dump it for analysis (e.g. in JDK Mission Control).
jcmd <pid> JFR.start name=diag settings=profile duration=60s filename=/tmp/diag.jfr
jcmd <pid> JFR.dump  name=diag filename=/tmp/diag.jfr
```

JFR fills the gap metrics/traces leave for *why was the JVM itself slow* — method hot spots, allocation pressure, lock contention, and GC internals — without attaching an external profiler.

## SLIs, SLOs, and error budgets

Signals describe behavior; **objectives** describe the bar. From the SRE book (ch 4):

- **SLI** — a Service Level *Indicator*: a measured quantity, ideally a good/total ratio (e.g. fraction of requests served `<300ms`, or success rate). Build SLIs from your **RED** signals — they reflect what users experience.
- **SLO** — a Service Level *Objective*: the target for an SLI over a window (e.g. `99.9%` of requests `<300ms` over 30 days). The SLO, not the raw graph, is what you alert and decide against.
- **Error budget** — `1 − SLO`. A `99.9%` SLO grants a `0.1%` budget of allowed unreliability per window — a concrete, shared currency for trading reliability against release velocity. Burn it fast → freeze risky changes; budget healthy → ship.

The instinct closes the loop: instrument RED/USE/JVM signals → define SLIs from the user-facing ones → set SLOs → alert on **budget burn rate**, not on every transient blip.

## Substrate-Specific Examples

The Power Loom toolkit is a Node/CLI substrate, not a JVM service, so this doc carries **no JVM substrate instances** — fabricating one would violate the evidence-discipline this KB enforces. The transferable patterns the substrate *does* embody:

- **Structured-over-freeform logging** — substrate hooks log via the shared `_log.js` with structured fields and an honored `LOOM_LOG_DIR` / `LOOM_SPAWN_STATE_DIR`, the same discipline as JSON-over-`println` here (commit `7e7fa5d`, "stop tests polluting `~/.claude/logs`"). One structured logger, no scattered ad-hoc prints — the cross-language form of the logs pillar.
- **Provenance records as traces** — the kernel's per-spawn transaction records (`transaction_id`, `idempotency_key`, `post_state_hash`) form a walkable causal chain to genesis. That is the *trace* idea (a correlated id linking the path of one operation) applied to spawn provenance rather than HTTP requests.
- **Method-shaped signals** — the kernel's idempotent replay (`appendRecord` de-dups on a verified content-address `idempotency_key`) mirrors why RED/USE matter: emit a small set of *load-bearing*, joinable signals rather than everything that's easy to capture.

When this persona instruments an actual JVM service, the Substrate examples should be replaced with that service's real meters, dashboards, and SLOs.

## Tension with Other Principles

### Observability cost vs YAGNI

Wiring three pillars + JFR + SLOs upfront looks like building infrastructure before it's needed. **Resolution**: the *minimum* viable observability (a metrics registry, structured logs with a trace id, RED on the public endpoints) is cheap, mostly auto-configured (Actuator, the OTel agent), and pays back on the **first** incident — it is the case YAGNI explicitly does not cover, because you cannot retrofit an outage. Elaborate custom dashboards or exotic exporters *are* YAGNI until a need is real.

### Cardinality vs detail (metrics) — and the metrics/logs boundary

High-cardinality detail (per-user, per-request) is invaluable but explodes metric time-series. **Resolution**: this is `single-responsibility` for telemetry — put **bounded dimensions** (status, route, method) on **metrics**; put **high-cardinality detail** (user id, request id, payload) on **logs and trace attributes**, where retention/sampling — not a Cartesian product of series — bounds the cost.

### Instrumentation overhead vs fidelity

Tracing every span and recording every JFR event has a runtime cost. **Resolution**: **sample** traces (head/tail sampling), run JFR at the `<1%`-overhead default profile (Oracle's documented bar), and reserve the heavier `profile` template for on-demand diagnosis. Fidelity is a dial, not a switch — see `reliability-scalability-maintainability`.

### Vendor-specific SDK vs the OTel standard

A vendor agent can be richer out of the box than vendor-neutral OTel. **Resolution**: prefer the **facade/standard** (Micrometer + OpenTelemetry/OTLP) so the backend stays a swappable deployment choice; reach for a vendor SDK only where its added value outweighs the lock-in — and articulate that trade-off (`error-handling-discipline` / trade-off articulation) rather than defaulting into it.

## When to use this principle

- **At project bootstrap** — wire the metrics registry, structured+correlated logging, and the OTel agent *before* the first feature. Cheapest moment; highest leverage.
- **For every public/request-driven endpoint** — add RED (rate, errors, p99 duration) and derive an SLI/SLO from it.
- **For every bounded resource** — apply USE (utilization, saturation, errors) to the thread pool, connection pool, heap, CPU.
- **When a latency or error regression appears** — RED localizes the symptom; USE + JFR localize the cause.
- **When defining reliability targets** — turn the user-facing SLIs into SLOs with an explicit error budget.

## When NOT to use this principle (or apply with caveat)

- **Throwaway scripts / one-shot batch jobs** — a short-lived job with no users and no SLA doesn't need three pillars; exit code + a structured log line is proportionate.
- **The full stack on a greenfield prototype** — don't block a day-one spike on JFR continuous recording, tail-sampling infra, and formal SLOs. Start with the cheap minimum (registry + correlated logs + endpoint RED) and add depth as the service earns real traffic. Over-instrumenting a prototype is its own YAGNI failure.
- **Unbounded-cardinality metrics** — never; this isn't "use with caveat," it's a hard "don't." Route that detail to logs/traces.

## Failure modes when applied incorrectly

- **Logs-only observability** — readable per-event, blind to trends and cross-service paths. Counter: add the metrics and traces pillars; correlate by trace id.
- **Cardinality explosion** — a user id / request id / raw URL used as a *metric tag* multiplies time-series until the scrape or registry OOMs. Counter: bounded dimensions on metrics; high-cardinality detail on logs/traces only.
- **Uncorrelated pillars** — metrics, logs, and traces exist but share no id, so you can't pivot from a bad metric to the offending trace to its logs. Counter: propagate `trace_id`/`span_id` via MDC into every log line.
- **Mean-only latency** — reporting average duration hides the tail where users actually hurt. Counter: track percentiles (p95/p99) in RED Duration; a healthy mean with a p99 cliff is a real outage for some users.
- **SLO without an SLI** — a reliability target nobody is actually measuring. Counter: every SLO must name the SLI (the good/total ratio) it is computed from.
- **Retrofit-after-incident** — the most expensive mode: the data needed to diagnose the outage was never emitted. Counter: the whole instinct — instrument from the first commit.

## Tests / verification

- **Three-pillar presence check**: a new service exposes metrics (`/actuator/prometheus` or an OTLP exporter), emits structured JSON logs, and produces traces (agent attached or Micrometer Tracing wired) — before it ships.
- **Correlation check**: pick a log line in prod and confirm it carries a `trace_id`; follow it to the trace; from the trace, jump back to its logs. If the pivot fails, MDC propagation is broken.
- **RED-per-endpoint check**: every public endpoint has rate, error-rate, and a *percentile* (not just mean) duration on a dashboard.
- **USE-per-resource check**: thread pool, connection pool, heap, and CPU each have utilization, saturation (queue depth), and error signals.
- **Cardinality audit**: grep meter registrations for tags sourced from user/request/URL values; each such tag is a potential explosion — confirm it's bounded or moved to logs/traces.
- **SLO ↔ SLI binding**: each declared SLO names its SLI and window; alerting fires on **budget burn rate**, not on isolated spikes.
- **JFR availability**: confirm `jcmd <pid> JFR.start` works against a prod-shaped JVM and the recording is analyzable, so the tool is ready *before* the incident that needs it.

## Related Patterns

- [backend-dev/jvm-runtime-basics](jvm-runtime-basics.md) — the heap/GC/thread-pool internals whose signals (GC pause, generation sizes, pool saturation) this doc tells you to surface.
- [backend-dev/spring-boot-essentials](spring-boot-essentials.md) — Actuator auto-configures the Micrometer registry, `/actuator/prometheus`, and MDC-based structured logging referenced here.
- [infra-dev/observability-basics](../infra-dev/observability-basics.md) — the platform/infra view of the same metrics-logs-traces pillars and SRE signals.
- [architecture/discipline/reliability-scalability-maintainability](../architecture/discipline/reliability-scalability-maintainability.md) — observability is the readout for reliability; sampling/overhead trade-offs live on the R/S/M axes.
- [architecture/discipline/error-handling-discipline](../architecture/discipline/error-handling-discipline.md) — the Errors axis of both RED and USE; failures must be observable, not swallowed.
- [architecture/crosscut/idempotency](../architecture/crosscut/idempotency.md) — correlation/trace ids are the request-scoped keys that also underpin idempotent retry semantics.

## Sources

Authored by multi-source synthesis of:

1. **Micrometer — Application Observability** (Micrometer project / VMware-Broadcom, `micrometer.io` docs, 2026) — the dimensional-metrics facade (`MeterRegistry`); **Micrometer Tracing** as the successor to Spring Cloud Sleuth and a facade over Brave + OpenTelemetry; the `micrometer-tracing-bridge-otel` bridge from the Observation API to OTel.
2. **OpenTelemetry** (CNCF, `opentelemetry.io` docs + *Signals* concept page; CNCF graduation announcement 2026-05-21; the May-2019 OpenTracing + OpenCensus merger) — the traces/metrics/logs/baggage signal model, the `-javaagent` zero-code auto-instrumentation, `GlobalOpenTelemetry`, and the manual span API.
3. **Tom Wilkie — The RED Method** (introduced at Weaveworks, 2015; popularized via the Grafana Labs blog *"The RED Method: how to instrument your services"* and The New Stack, 2018) — Rate / Errors / Duration, specialized from Google's Four Golden Signals for request-driven services.
4. **Brendan Gregg — The USE Method** (`brendangregg.com/usemethod.html` + ACM Queue *"Thinking Methodically about Performance"*, 2013) — Utilization / Saturation / Errors per resource; the checklist framing and the "60% with saturation beats 90% without" insight.
5. **Site Reliability Engineering** (Beyer / Jones / Petoff / Murphy, Google / O'Reilly, 2016) — ch 4 *Service Level Objectives* (SLI / SLO; error budget = `1 − SLO`) and ch 6 *Monitoring Distributed Systems* (the Four Golden Signals: Latency / Traffic / Errors / Saturation).
6. **JDK Flight Recorder / JFR** (Oracle Java SE + JDK Mission Control documentation, 2024) — the built-in JVM event-collection + profiling framework; the default profile's documented `<1%` overhead; `jcmd <pid> JFR.start` / `JFR.dump` usage.

Each source was verified to exist via WebSearch/WebFetch during authoring (Micrometer + Spring Boot tracing docs; the OpenTelemetry *Signals* page + CNCF graduation/merger announcements; Grafana/The New Stack RED articles attributing Tom Wilkie/Weaveworks 2015; `brendangregg.com` USE page quoted verbatim; the Google SRE book ch 4 + ch 6 pages on `sre.google`; Oracle JFR docs on `<1%` overhead and `jcmd JFR.start`). No JVM substrate instance is asserted — the Power Loom substrate is a Node/CLI toolkit, so only transferable structured-logging / provenance-as-trace patterns are cited, per this KB's evidence discipline.

## Phase

Authored: kb-gaps single-lens authoring batch (v3.1-era, post-Phase-2 / Runtime Foundation). Serves the **java-backend** HETS persona's `observability-first` named instinct — instrument JVM services for metrics, logs, and distributed traces from the start. Multi-source synthesis from 6 verifiable sources spanning the metrics facade (Micrometer), the CNCF tracing standard (OpenTelemetry), the two dashboard-design methods (RED — Wilkie/Weaveworks; USE — Gregg) and their golden-signals ancestor (Google SRE book), reliability objectives (SLI/SLO/error budget, SRE book ch 4), and JVM-native profiling (Oracle JFR). Substrate section deliberately carries no fabricated JVM instance — only transferable patterns (structured `_log.js` logging, provenance records as traces) drawn from the actual Node/CLI substrate.
