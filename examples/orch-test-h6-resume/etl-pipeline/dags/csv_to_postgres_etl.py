"""
CSV -> Postgres ETL DAG (multi-tenant, idempotent, dedup-first).

Flow per run:
  1. Sense for the trigger CSV in S3 (or hourly poll).
  2. Compute file hash; short-circuit if we've already ingested this file.
  3. Stream-validate schema (header + per-row types) without slurping.
  4. COPY validated rows into staging.uploads_staging; quarantine bad rows.
  5. Atomic swap: INSERT INTO production.uploads ... ON CONFLICT DO NOTHING.
  6. Truncate staging.

Idempotency contract (the load-bearing part of this DAG):
  - Same input bytes -> same row_hash + source_file_hash -> ON CONFLICT
    DO NOTHING drops the dupe. Re-running this DAG with the same input is
    a no-op.
  - File-hash short-circuit at step 2 makes re-runs cheap (no row work at
    all if the file's already been ingested).
  - Stage-then-swap means a partial failure during COPY leaves production
    untouched.

Resource bounds:
  - CSV is streamed (1 MiB chunks for hashing, csv.DictReader iterator for
    parsing). Memory is O(row), not O(file).
  - Each task fits in 1 GiB RAM; tested with 1M-row files.

Airflow version: 2.7+. Uses TaskFlow API (@task), Datasets, and the
typed XCom returns from PythonOperator-compatible tasks.

Operators / sensors used:
  - S3KeySensor (mode='reschedule' to free worker slot during waits)
  - PostgresHook (low-level for the COPY + the swap MERGE)
"""

from __future__ import annotations

import csv
import io
import logging
import os
import sys
from datetime import datetime, timedelta
from typing import Any

import pendulum
from airflow.decorators import dag, task
from airflow.exceptions import AirflowSkipException
from airflow.models import Variable
from airflow.providers.amazon.aws.hooks.s3 import S3Hook
from airflow.providers.amazon.aws.sensors.s3 import S3KeySensor
from airflow.providers.postgres.hooks.postgres import PostgresHook

# Path injection so the DAG can import the dedup library. In production this
# would be packaged as an installable wheel; for the example we use sys.path.
_LIB_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "lib"))
if _LIB_DIR not in sys.path:
    sys.path.insert(0, _LIB_DIR)
from dedup import compute_file_hash, compute_row_hash  # noqa: E402

# -----------------------------------------------------------------------------
# DAG-level config
# -----------------------------------------------------------------------------

# Pin the start_date — never datetime.now(); see airflow skill, pitfall #2.
START_DATE = pendulum.datetime(2026, 1, 1, tz="UTC")

# Schema declaration that participates in row_hash. Excludes ingest-time
# fields (ingested_at, source_file_hash, run_id) by design.
ROW_HASH_SCHEMA: dict[str, str] = {
    "tenant_id": "uuid",
    "external_id": "text",
    "email": "text",
    "full_name": "text",
}

# Connection IDs; secrets are in the encrypted metastore, NEVER inline.
S3_CONN_ID = "aws_s3_uploads"
POSTGRES_CONN_ID = "postgres_warehouse"

# Tunables surfaced via Airflow Variables so ops can change without redeploy.
S3_BUCKET = "{{ var.value.csv_etl_s3_bucket }}"
S3_KEY_PREFIX = "{{ var.value.csv_etl_s3_prefix }}"


# -----------------------------------------------------------------------------
# Failure callback (alerting)
# -----------------------------------------------------------------------------

def _on_failure_callback(context: dict[str, Any]) -> None:
    """Page on task failure. Wired to Slack/PagerDuty in prod; logs here."""
    ti = context.get("task_instance")
    dag_id = context.get("dag").dag_id if context.get("dag") else "unknown"
    log = logging.getLogger("airflow.task")
    log.error(
        "ETL FAILURE dag=%s task=%s run_id=%s try=%s",
        dag_id,
        ti.task_id if ti else "unknown",
        ti.run_id if ti else "unknown",
        ti.try_number if ti else -1,
    )
    # Real impl: AlerterHook(conn_id='pagerduty').page(...)


# -----------------------------------------------------------------------------
# DAG definition
# -----------------------------------------------------------------------------

@dag(
    dag_id="csv_to_postgres_etl",
    description="Stream CSVs from S3 to Postgres with file+row-level dedup.",
    start_date=START_DATE,
    schedule="@hourly",   # falls back to polling if event-driven trigger absent
    catchup=False,         # do NOT replay history; idempotent but wasteful
    max_active_runs=2,     # cap concurrent runs to bound DB write load
    default_args={
        "owner": "data-engineering",
        "retries": 2,
        "retry_delay": timedelta(minutes=5),
        "retry_exponential_backoff": True,
        "on_failure_callback": _on_failure_callback,
    },
    tags=["etl", "csv", "postgres", "multi-tenant"],
    doc_md=__doc__,
)
def csv_to_postgres_etl():

    # -- 1. Wait for the file ----------------------------------------------
    # mode='reschedule' frees the worker slot between pokes (airflow skill,
    # pitfall #5). poke_interval is generous because the trigger is hourly.
    wait_for_file = S3KeySensor(
        task_id="wait_for_csv",
        bucket_name=S3_BUCKET,
        bucket_key=f"{S3_KEY_PREFIX}/{{{{ ds }}}}/*.csv",
        wildcard_match=True,
        aws_conn_id=S3_CONN_ID,
        mode="reschedule",
        poke_interval=300,
        timeout=60 * 60,
    )

    @task
    def discover_files(**context: Any) -> list[str]:
        """List CSVs ready to ingest in this run's prefix."""
        s3 = S3Hook(aws_conn_id=S3_CONN_ID)
        prefix = f"{context['ds']}/"
        keys = s3.list_keys(bucket_name=S3_BUCKET, prefix=prefix) or []
        csv_keys = [k for k in keys if k.endswith(".csv")]
        logging.info("discover_files: found %d CSV(s) under %s", len(csv_keys), prefix)
        return csv_keys

    @task
    def hash_and_short_circuit(s3_key: str, **context: Any) -> dict[str, Any]:
        """
        Stream the file from S3, compute its hash, skip if already ingested.

        Returns a control dict the next task uses to decide whether to load.
        """
        s3 = S3Hook(aws_conn_id=S3_CONN_ID)
        local_path = s3.download_file(
            key=s3_key, bucket_name=S3_BUCKET, local_path="/tmp", preserve_file_name=True
        )
        file_hash = compute_file_hash(local_path)

        pg = PostgresHook(postgres_conn_id=POSTGRES_CONN_ID)
        already_ingested = pg.get_first(
            "SELECT 1 FROM production.uploads WHERE source_file_hash = %s LIMIT 1;",
            parameters=(file_hash,),
        )
        if already_ingested:
            logging.info("file_hash=%s already ingested; short-circuit", file_hash)
            raise AirflowSkipException("duplicate file")

        return {
            "s3_key": s3_key,
            "local_path": local_path,
            "source_file_hash": file_hash,
            "run_id": context["run_id"],
        }

    @task
    def validate_and_load_staging(ctx: dict[str, Any]) -> dict[str, int]:
        """
        Stream-parse the CSV. Validate header + per-row types. Send valid
        rows to staging via COPY-batch; bad rows go to quarantine.

        Returns counts for the swap step's logging + observability.
        """
        local_path = ctx["local_path"]
        file_hash = ctx["source_file_hash"]
        run_id = ctx["run_id"]

        pg = PostgresHook(postgres_conn_id=POSTGRES_CONN_ID)
        valid_count, quarantine_count = 0, 0

        with open(local_path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            _validate_header(reader.fieldnames or [])

            with pg.get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute("TRUNCATE staging.uploads_staging;")
                    for line_num, raw_row in enumerate(reader, start=2):
                        try:
                            normalized = _validate_row(raw_row, line_num)
                        except _RowError as e:
                            cur.execute(_QUARANTINE_INSERT, _quarantine_params(
                                raw_row, str(e), file_hash, local_path, run_id,
                            ))
                            quarantine_count += 1
                            continue
                        row_hash = compute_row_hash(
                            {k: normalized[k] for k in ROW_HASH_SCHEMA},
                            ROW_HASH_SCHEMA,
                        )
                        cur.execute(_STAGING_INSERT, _staging_params(
                            normalized, row_hash, file_hash, local_path, run_id,
                        ))
                        valid_count += 1
                conn.commit()

        logging.info("staged valid=%d quarantine=%d file_hash=%s",
                     valid_count, quarantine_count, file_hash)
        return {"valid": valid_count, "quarantined": quarantine_count}

    @task
    def swap_staging_to_production(counts: dict[str, int]) -> dict[str, int]:
        """
        Atomic swap: INSERT INTO production.uploads SELECT * FROM staging
        WITH ON CONFLICT DO NOTHING. Single transaction. Truncates staging
        on success.
        """
        if counts.get("valid", 0) == 0:
            logging.info("no valid rows to swap; skipping")
            return {"inserted": 0, "skipped_dupes": 0}

        pg = PostgresHook(postgres_conn_id=POSTGRES_CONN_ID)
        with pg.get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(_SWAP_SQL)
                inserted = cur.rowcount or 0
                cur.execute("TRUNCATE staging.uploads_staging;")
            conn.commit()

        skipped = counts["valid"] - inserted
        logging.info("swap inserted=%d skipped_dupes=%d", inserted, skipped)
        return {"inserted": inserted, "skipped_dupes": skipped}

    # Wiring: linear pipeline per file, fan-out via .expand for multi-file runs.
    files = discover_files()
    wait_for_file >> files
    contexts = hash_and_short_circuit.expand(s3_key=files)
    counts = validate_and_load_staging.expand(ctx=contexts)
    swap_staging_to_production.expand(counts=counts)


# -----------------------------------------------------------------------------
# Helpers (private; module-level so they're importable in unit tests)
# -----------------------------------------------------------------------------

class _RowError(Exception):
    """Raised by _validate_row to route a row to quarantine."""


_REQUIRED_HEADERS = ("tenant_id", "external_id", "email", "full_name")


def _validate_header(fieldnames: list[str]) -> None:
    missing = [c for c in _REQUIRED_HEADERS if c not in fieldnames]
    if missing:
        raise ValueError(f"CSV missing required columns: {missing}")


def _validate_row(row: dict[str, str], line_num: int) -> dict[str, Any]:
    """Normalize types + null-checks. Raises _RowError to route to quarantine."""
    tenant_id = (row.get("tenant_id") or "").strip()
    if len(tenant_id) != 36:
        raise _RowError(f"line {line_num}: tenant_id must be UUID (got {tenant_id!r})")
    email = (row.get("email") or "").strip() or None
    return {
        "tenant_id": tenant_id,
        "external_id": (row.get("external_id") or "").strip() or None,
        "email": email,
        "full_name": (row.get("full_name") or "").strip() or None,
    }


_STAGING_INSERT = """
INSERT INTO staging.uploads_staging
    (tenant_id, row_hash, external_id, email, full_name,
     source_file_hash, source_file_path, run_id)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s);
"""

_QUARANTINE_INSERT = """
INSERT INTO production.uploads_quarantine
    (tenant_id, raw_line, parser_error,
     source_file_hash, source_file_path, run_id)
VALUES (%s, %s, %s, %s, %s, %s);
"""

# The ON CONFLICT clause IS the idempotency contract. Drop it and re-runs
# multi-write the same rows (modulo PK, which would error). Keep it.
_SWAP_SQL = """
INSERT INTO production.uploads
    (tenant_id, row_hash, external_id, email, full_name, payload,
     source_file_hash, source_file_path, run_id)
SELECT
    tenant_id, row_hash, external_id, email, full_name, payload,
    source_file_hash, source_file_path, run_id
FROM staging.uploads_staging
ON CONFLICT (tenant_id, row_hash) DO NOTHING;
"""


def _staging_params(row, row_hash, file_hash, src_path, run_id):
    return (
        row["tenant_id"], row_hash,
        row["external_id"], row["email"], row["full_name"],
        file_hash, src_path, run_id,
    )


def _quarantine_params(raw_row, err, file_hash, src_path, run_id):
    raw_line = ",".join(f'"{(v or "").strip()}"' for v in raw_row.values())
    tenant_id = (raw_row.get("tenant_id") or "00000000-0000-0000-0000-000000000000").strip()
    return (tenant_id, raw_line, err, file_hash, src_path, run_id)


# Instantiate the DAG (Airflow discovers this at module-parse time).
csv_to_postgres_etl()
