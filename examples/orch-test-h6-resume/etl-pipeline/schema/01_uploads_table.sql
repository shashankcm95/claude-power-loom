-- =============================================================================
-- Multi-tenant CSV uploads schema for the Airflow ETL pipeline.
--
-- Three tables, one role each:
--   uploads             - production fact table, queried by app + analytics
--   uploads_staging     - fast COPY target; truncated per run; no constraints
--   uploads_quarantine  - malformed rows, raw-line preserved for replay
--
-- Idempotency contract: the composite PK (tenant_id, row_hash) on `uploads`
-- guarantees that re-ingesting the same CSV is a no-op. See ../lib/dedup.py
-- for how row_hash is computed (BLAKE2b over normalized cell values, sorted
-- by column name; tenant_id folded in via the schema dict).
--
-- Run order: this file (01) is the only schema file at present. If you add
-- more (e.g. 02_indexes.sql, 03_views.sql), keep numeric prefixes for
-- ordering under flyway/sqitch/your migration tool of choice.
-- =============================================================================

-- ---- Schemas -----------------------------------------------------------------
-- Separate schemas keep `staging` invisible to read-only app roles by default.
CREATE SCHEMA IF NOT EXISTS production;
CREATE SCHEMA IF NOT EXISTS staging;

-- ---- Production table --------------------------------------------------------
-- Composite PK enforces row-level idempotency: ON CONFLICT DO NOTHING during
-- the staging->production swap drops duplicates that were already present.
-- tenant_id leads the PK so all rows for one tenant are co-located on disk
-- (Postgres orders by PK in the heap when the table is freshly inserted in
-- order, and the leading-column choice helps index range scans for tenant
-- queries even after fragmentation).
CREATE TABLE IF NOT EXISTS production.uploads (
    tenant_id          UUID         NOT NULL,
    row_hash           CHAR(64)     NOT NULL,
    -- Business payload columns. Add per-tenant variations via JSONB to avoid
    -- a schema migration per tenant; the strict columns are the contract.
    external_id        TEXT         NULL,
    email              TEXT         NULL,
    full_name          TEXT         NULL,
    payload            JSONB        NULL,
    -- Lineage fields. NOT part of the dedup hash (see dedup.py contract).
    source_file_hash   CHAR(64)     NOT NULL,
    source_file_path   TEXT         NOT NULL,
    ingested_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    run_id             TEXT         NOT NULL,
    CONSTRAINT pk_uploads PRIMARY KEY (tenant_id, row_hash)
);

COMMENT ON CONSTRAINT pk_uploads ON production.uploads IS
    'Composite PK (tenant_id, row_hash) is the idempotency contract: '
    'ON CONFLICT DO NOTHING on insert deduplicates re-uploads. '
    'row_hash is computed by lib/dedup.py:compute_row_hash, which '
    'normalizes whitespace + sorts keys before hashing. Do not change '
    'the hash algorithm without rehashing historical rows.';

COMMENT ON COLUMN production.uploads.source_file_hash IS
    'BLAKE2b-256 of the source CSV bytes. Allows file-level dedup '
    '(skip a re-uploaded identical file before any row processing).';

-- Tenant-first index for the common app query: "all rows for tenant X,
-- recent first." The PK already covers (tenant_id, row_hash) but the
-- ingested_at sort needs its own index.
CREATE INDEX IF NOT EXISTS ix_uploads_tenant_ingested
    ON production.uploads (tenant_id, ingested_at DESC);

-- File-hash lookup for "have we ingested this file before?" check at the
-- top of the DAG. BRIN works because rows for one file land in one batch
-- (temporally clustered).
CREATE INDEX IF NOT EXISTS ix_uploads_source_file_hash
    ON production.uploads USING BRIN (source_file_hash);

-- Optional GIN on payload for tenants that query JSONB attributes. Cheap
-- when payload is sparsely populated, expensive on writes — comment out
-- if write-heavy and analytics-light.
CREATE INDEX IF NOT EXISTS ix_uploads_payload_gin
    ON production.uploads USING GIN (payload jsonb_path_ops);

-- ---- Staging table -----------------------------------------------------------
-- No PK, no FKs, no indexes. The ONLY purpose is to be a fast COPY target.
-- Truncated at the start of each run to keep it bounded; the swap to
-- production is the single source of truth.
CREATE TABLE IF NOT EXISTS staging.uploads_staging (
    tenant_id          UUID         NOT NULL,
    row_hash           CHAR(64)     NOT NULL,
    external_id        TEXT         NULL,
    email              TEXT         NULL,
    full_name          TEXT         NULL,
    payload            JSONB        NULL,
    source_file_hash   CHAR(64)     NOT NULL,
    source_file_path   TEXT         NOT NULL,
    ingested_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    run_id             TEXT         NOT NULL
);

COMMENT ON TABLE staging.uploads_staging IS
    'Fast COPY target. No PK by design — duplicates within a single CSV are '
    'tolerated at COPY time and dropped during the staging->production swap '
    'via ON CONFLICT DO NOTHING. Truncated at the start of each DAG run.';

-- ---- Quarantine table --------------------------------------------------------
-- Malformed rows go here with the raw line + the parser error. Replayable:
-- once you fix the parser (or the CSV source), you can re-process from this
-- table.
CREATE TABLE IF NOT EXISTS production.uploads_quarantine (
    quarantine_id      BIGSERIAL    PRIMARY KEY,
    tenant_id          UUID         NOT NULL,
    raw_line           TEXT         NOT NULL,
    parser_error       TEXT         NOT NULL,
    source_file_hash   CHAR(64)     NOT NULL,
    source_file_path   TEXT         NOT NULL,
    ingested_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    run_id             TEXT         NOT NULL
);

COMMENT ON TABLE production.uploads_quarantine IS
    'Malformed CSV rows. raw_line is the original CSV line; parser_error is '
    'the validator message (missing column, type mismatch, etc.). Re-runnable: '
    'fix the parser, then SELECT FROM uploads_quarantine WHERE ... and replay.';

CREATE INDEX IF NOT EXISTS ix_quarantine_tenant_ingested
    ON production.uploads_quarantine (tenant_id, ingested_at DESC);
