---
skill: airflow
status: active
domain: data-dev
canonical_source: https://airflow.apache.org/docs/
forged_via: H.6.7-canonical-source-registry-extension
related_kb: [data-dev/orchestration-essentials, data-dev/data-modeling-basics]
notes: Airflow 2.x docs are the canonical surface. Concepts (DAGs, tasks, sensors, executors) + Best Practices are load-bearing sections. Avoid Airflow 1.x docs (deprecated since 2021). For task-specific operators see https://airflow.apache.org/docs/apache-airflow-providers/.
---

# Airflow

Specialist skill for the `11-data-engineer` HETS persona (and any other persona that needs Airflow / workflow-orchestration expertise). Loaded on demand via the `Skill` tool when the spawn prompt lists `airflow` as required.

## When to use this skill

Trigger when:
- Authoring or modifying Airflow DAGs (Python files defining task graphs)
- Designing data-pipeline orchestration (ETL, ELT, batch + micro-batch)
- Debugging Airflow scheduler / executor issues, task retries, SLA misses
- Choosing operators (BashOperator, PythonOperator, KubernetesPodOperator, provider operators)
- Designing idempotency + dedup + backfill strategies for data pipelines

**Skip** when the orchestration is real-time / streaming (Kafka Streams, Flink, Spark Streaming — different paradigm); the task is pure SQL transforms in a warehouse (use dbt skill); or the pipeline is one-off and lives outside any orchestration system (~plain Python or shell script — no Airflow required).

## Core competencies

### DAG fundamentals

- **DAG = Directed Acyclic Graph of tasks**. The scheduler turns it into runs; runs are bounded by `start_date` + `schedule_interval` (or `schedule` in 2.4+).
- **`start_date`** is past-only (cannot be in the future); pin it explicitly (don't use `datetime.now()` or `days_ago()`). Mutable start dates cause unexpected backfills.
- **`schedule`** is cron syntax or a preset (`@daily`, `@hourly`). For irregular triggers use `Dataset` (2.4+) for data-aware scheduling instead.
- **`catchup=False`** is almost always what you want for new DAGs — prevents the scheduler from running every interval since `start_date`. Set `catchup=True` only when you genuinely need backfill of historical runs.
- **`max_active_runs`** caps concurrent runs of the same DAG (defaults: 16). Lower for resource-heavy DAGs.

### Task design

- **Idempotency is the contract**: every task must be safe to retry without side effects. Use deterministic IDs, transactional writes, dedup keys.
- **Atomicity per task**: one task = one logical unit (load_table, transform, validate). Don't pack 5 steps into one task — failures lose granularity.
- **Templating**: Jinja2 templating over `params` + `ds` + `data_interval_start/end` macros. Renders at runtime, not DAG-parse time.
- **Operators vs TaskFlow API**:
  - **TaskFlow (2.0+)**: `@task` decorator on Python functions; cleaner for Python-heavy DAGs; XCom passing is implicit.
  - **Operators**: `BashOperator`, `PythonOperator`, provider-specific (`PostgresOperator`, `S3ToRedshiftOperator`, etc.); use when the work is "call this external system."
- **Sensors**: tasks that wait for an external condition (`S3KeySensor`, `ExternalTaskSensor`, `FileSensor`). Use `mode='reschedule'` not `mode='poke'` for long waits — frees the worker slot between checks.

### Executors + scaling

- **LocalExecutor**: dev / single-machine; serial within DAG run.
- **CeleryExecutor**: distributed via Celery + Redis/RabbitMQ; standard for production.
- **KubernetesExecutor**: each task runs in its own pod; resource isolation + horizontal scale; preferred for varying-workload pipelines.
- **CeleryKubernetesExecutor**: hybrid (Celery for short tasks, K8s for big).
- **Picking**: K8s if you're already on k8s + tasks have heterogeneous resource needs; Celery if you have a stable worker pool + most tasks are similar shape.

### Idempotency + dedup patterns (load-bearing for ETL)

- **MERGE pattern** (Postgres 15+ or via `INSERT ... ON CONFLICT`): upsert keyed by natural primary key OR by `(source_system, source_id)` composite. Re-runs of the same task with the same input produce the same output.
- **Stage table + atomic swap**: load into `staging.x`, validate, then `BEGIN; TRUNCATE production.x; INSERT INTO production.x SELECT * FROM staging.x; COMMIT;` (or rename-table swap). Atomic per-batch.
- **Deletion-aware sync**: when source can delete, use `MERGE INTO ... WHEN NOT MATCHED BY SOURCE DELETE` (snowflake/postgres-15) OR full-table replace via stage swap.
- **Hash-based dedup**: when natural PK doesn't exist, compute `MD5(...)` over relevant columns and use as dedup key. Good for fact tables with no obvious unique constraint.
- **Dedup window**: when source emits duplicate events (kafka at-least-once), use `ROW_NUMBER() OVER (PARTITION BY dedup_key ORDER BY event_time DESC) = 1` in the load.

### Backfill + catch-up

- **Backfill** is replaying historical runs after a DAG change. `airflow dags backfill <dag_id> -s <start> -e <end>`.
- **Idempotency makes backfill safe** — same input, same output, no double-counting.
- **`depends_on_past=True`** prevents a task from running until its prior run succeeded; useful for time-series transforms that depend on yesterday's state.
- **Avoid backfilling into prod tables without staging** — a buggy DAG silently corrupts history if the load is non-idempotent.

### Error handling + retries

- **`retries`** + **`retry_delay`** on tasks: default 0 retries; set 1-3 for transient-failure-tolerant tasks (network, external APIs).
- **`retry_exponential_backoff=True`** for retries on rate-limited APIs.
- **`on_failure_callback`** for paging / alerting; `on_success_callback` for downstream notifications.
- **SLA misses** (`sla=timedelta(...)` on tasks) emit alerts when a task takes longer than expected — DOESN'T kill the task; just notifies. Use SLA for "this should finish by X" semantics.
- **`trigger_rule`** controls when a task runs based on upstream state: `all_success` (default), `all_done`, `one_success`, `one_failed`, `none_skipped`. Use `all_done` for cleanup tasks that should run regardless of upstream success.

### Connections + secrets

- **Connections** stored in metastore (encrypted) or external secret backend (Vault, AWS Secrets Manager) — connection ID resolved at task execution.
- **Variables** for non-sensitive config; **Connections** for credentials. Never embed secrets in DAG code.
- **`SecretsManagerBackend`** rotates credentials externally — DAG just references the connection ID.

### Observability

- **Logs**: per-task, retained in `LOGGING_FOLDER` or a remote backend (S3, GCS) for long-term retention.
- **Metrics**: scheduler health, task duration, queue depth via StatsD or Prometheus exporter.
- **DAG-level monitoring**: parse times (DAGs that take long to parse slow the scheduler — keep imports light), task duration trends.
- **Alerts**: SLA misses + task failures + DAG-parse errors. Don't alert on every retry — that's noise.

### Production checklist

- DAG `catchup=False` unless backfill is intended
- Tasks idempotent (re-runnable without side effects)
- Retries set on transient-failure tasks (network, external APIs)
- SLA on critical-path tasks
- Connections via encrypted backend, never in code
- DAG-parse time < 30s (heavy imports go inside task functions, not module-level)
- Test DAG locally with `airflow dags test <dag_id> <execution_date>` before deploying
- Resource requests on KubernetesExecutor pods (memory + CPU)
- Logs persisted to remote backend (S3, GCS) — local logs disappear when worker pod recycles

## Common pitfalls

1. **Top-level imports of heavy libraries** — DAG file is parsed every scheduler iteration; importing pandas/torch at module-top kills scheduler perf. Move heavy imports inside task functions.
2. **`datetime.now()` in DAG definition** — `start_date` becomes mutable; scheduler behavior is unpredictable. Pin to a fixed past date.
3. **Non-idempotent tasks** — task that appends without dedup; re-run on retry doubles the data. Always design for re-runnability.
4. **`depends_on_past` + `catchup=False`** — DAG can't catch up past failures because the dependency chain blocks new runs. One has to give.
5. **Sensor `mode='poke'` for long waits** — holds a worker slot for hours. Use `mode='reschedule'` (frees the slot between pokes).
6. **Templating in non-templated fields** — `bash_command` and `sql` are templated; arbitrary task args usually aren't. Check operator docs.
7. **XCom for large data** — XCom is metastore-backed (Postgres/MySQL); large payloads kill scheduler perf. Pass references (S3 URLs) not data.
8. **Cron syntax confusion** — `0 5 * * *` runs at 5 AM in the timezone the scheduler is configured with (default UTC). Use `pendulum.timezone(...)` for clarity.

## Sources

- Apache Airflow docs: https://airflow.apache.org/docs/ (canonical source — should be added to `kb:hets/canonical-skill-sources` registry on next H.6.7 audit)
- Airflow 2.x core concepts: https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/
- Best practices: https://airflow.apache.org/docs/apache-airflow/stable/best-practices.html
- Provider operators: https://airflow.apache.org/docs/apache-airflow-providers/

## When to forge specialized sub-skills

If a task surfaces a sub-domain not adequately covered above (specific provider operators — AWS / GCP / Snowflake idioms beyond the basics; dbt integration patterns; data-quality libraries — Great Expectations, Soda; lineage tracking — OpenLineage), surface a `request: forge-skill` via missing-capability-signal back to root. This skill is the Airflow baseline; sub-skills go in their own files.
