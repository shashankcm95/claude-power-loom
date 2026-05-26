---
kb_id: data-dev/orchestration-essentials
version: 1
tags: [data, orchestration, airflow, dags, idempotency, starter]
---

## Summary

Data orchestration essentials for HETS data-engineer personas: DAGs as code (versioned, code-reviewed); idempotent tasks (replays must produce identical results); explicit retry semantics with backoff; sensors for external dependencies (file arrival, upstream completion); task isolation via separate environments / containers; lineage tracking for impact analysis. Stub doc — expand on use.

## Full content (starter — expand when first persona uses)

### DAG design principles

- **Pure tasks** — no side effects beyond declared outputs (writing to a target table is a declared output; logging to stdout isn't)
- **Idempotent tasks** — running twice produces the same result. Write target tables with deterministic partition keys (date / hour) and use `INSERT OVERWRITE` semantics, not `INSERT INTO`.
- **Atomic tasks** — either fully succeed or fully fail. No partial state visible to downstream consumers.
- **Small tasks** — easier to retry, parallelize, and monitor. Split a 10-hour task into 10 1-hour tasks where possible.

### Retry semantics

Every task declares:
- `retries`: how many attempts (default 3)
- `retry_delay`: backoff (constant, exponential)
- `retry_exponential_backoff`: True for transient failures (network, rate limits)

For user-facing pipelines: also declare `sla` (alerts if breached) and `on_failure_callback` (notification or remediation).

### Sensors

Wait for an external condition before proceeding:
- File sensor (arrival in S3 / GCS)
- External task sensor (upstream DAG completed)
- HTTP sensor (API endpoint returns expected response)
- Time sensor (specific clock time, not interval)

Use `mode='reschedule'` (not `mode='poke'`) for long waits — releases the worker slot.

### Lineage

For impact analysis ("if I change column X, what breaks?"):
- Modern orchestrators capture lineage automatically (Dagster assets, Airflow OpenLineage)
- Lineage feeds into data catalogs (DataHub, Amundsen)
- Without lineage, every schema change is a manual audit

### Common pitfalls

- Side-effect tasks (mutate external state without declaring it as output)
- `INSERT INTO` instead of `INSERT OVERWRITE` (replays double-write)
- No retry on transient failures (one network blip kills the DAG)
- Sensors in `poke` mode for hours-long waits (worker slot held the entire time)
- DAG file imports heavy modules at top level (DAG parsing slowed for all DAGs in scheduler)
- Cross-DAG dependencies via shared variables (hidden coupling; use ExternalTaskSensor or Datasets)

### Related KB docs (planned)

- `kb:data-dev/data-modeling-basics`
- `kb:data-dev/dbt-patterns`
- `kb:data-dev/streaming-vs-batch`
