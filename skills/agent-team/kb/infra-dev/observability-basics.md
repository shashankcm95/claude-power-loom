---
kb_id: infra-dev/observability-basics
version: 1
tags: [infra, devops, observability, monitoring, sre, starter]
---

## Summary

Observability basics for HETS devops-sre personas: three signals (logs, metrics, traces) — metrics for "what", logs for "why", traces for "where"; SLI / SLO / SLA cascade defines reliability targets; alert on user-felt symptoms not on causes; structured logs (JSON) over plain text; cardinality budget for metrics labels; sampling for traces in high-volume services. Stub doc — expand on use.

## Full content (starter — expand when first persona uses)

### Three signals

| Signal | Best for | Tools |
|--------|----------|-------|
| **Metrics** | Aggregate behavior over time | Prometheus, Datadog metrics, CloudWatch |
| **Logs** | Specific event detail | ELK, Loki, Datadog logs |
| **Traces** | Request flow across services | Jaeger, Tempo, OpenTelemetry |

Use metrics first (cheapest, most aggregable). Drill into logs for context. Use traces for cross-service flow debugging.

### SLI / SLO / SLA cascade

- **SLI** (Service Level Indicator): the metric (request latency, error rate, availability)
- **SLO** (Service Level Objective): internal target (e.g., 99.9% requests <500ms over 28 days)
- **SLA** (Service Level Agreement): contractual commitment to customers (always lower than SLO)

Error budget = `1 - SLO`. Burn rate = how fast budget is consumed.

### Alerting (the hard part)

Alert on **user-felt symptoms**, not causes:
- ✅ "p99 request latency >2s for 10 minutes"
- ❌ "CPU on instance i-abc123 > 80%"

Causes are diagnostic info you look up AFTER an alert fires.

Alert fatigue kills on-call. Tune for: ≥1% false positive rate is too high; aim for <0.1%.

### Cardinality budget

Each unique combination of metric + labels = a separate time series. High-cardinality labels (user_id, request_id, exact URL with params) explode storage:

```
http_requests_total{method="GET", path="/users", status="200"}  ← OK
http_requests_total{method="GET", path="/users/123", user_id="123"}  ← BAD
```

Rule of thumb: <100 unique values per label, <10K series per metric.

### Common pitfalls

- Plain-text logs (greppable but not structured-queryable; use JSON)
- High-cardinality labels (Prometheus storage explosion)
- 100% trace sampling in high-volume service (storage cost; sample at 1% in prod, 100% in staging)
- Alerts on causes (CPU, memory) instead of symptoms (latency, errors)
- No SLO defined ("we want it to be fast" is not actionable)
- Single dashboard with 50 graphs (information overload; use focused dashboards per use case)

### Related KB docs (planned)

- `kb:infra-dev/kubernetes-essentials`
- `kb:infra-dev/prometheus-patterns`
- `kb:infra-dev/incident-response-playbook`
