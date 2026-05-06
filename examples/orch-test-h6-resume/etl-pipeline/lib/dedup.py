"""
Dedup primitives for the CSV->Postgres ETL pipeline.

Pure functions only. No Airflow imports. No DB calls. No network. This module is
the contract that makes the pipeline idempotent: same input bytes -> same hashes
-> ON CONFLICT DO NOTHING in Postgres -> zero duplicate rows.

Two concerns:
  1. Row-level dedup: hash(tenant_id, normalized-cell-values) -> row_hash.
     Used as part of the composite PK (tenant_id, row_hash) on `uploads`.
  2. File-level dedup: hash(content-bytes-of-csv) -> source_file_hash.
     Allows skipping ingestion entirely when an identical file is re-uploaded,
     and tags every row with its source file for lineage.

Hash choice: BLAKE2b-256. Faster than SHA-256 on modern x86, cryptographic
quality, deterministic across Python versions. Hex output is 64 chars.

Determinism rules (the contract):
  - Column order independence: row hash sorts keys before hashing
  - Whitespace handling: cells are .strip()ed BEFORE hashing
  - Type coercion: all cell values stringified via str() before hashing; the
    schema dict declares which columns participate (callers exclude ingest-time
    fields like ingested_at, source_file_hash, run_id from the schema dict)
  - Tenant scoping: tenant_id is folded into the hash, so the same row content
    for two tenants produces two different hashes (no cross-tenant collision)

Whitespace-only changes to the CSV file (trailing newline, CRLF vs LF) DO
change the file hash. This is a conscious choice — see test_dedup.py. Use the
row hash, not the file hash, if you need byte-insensitive dedup at the row
level.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any, Mapping

# Algorithm pinned for cross-version reproducibility. Do not change without
# a coordinated re-hash of historical data.
_HASH_ALGO = "blake2b"
_HASH_DIGEST_SIZE = 32  # 32 bytes -> 64 hex chars
_FIELD_SEP = b"\x1f"  # ASCII unit separator; never appears in normal CSV cells
_KV_SEP = b"\x1e"     # ASCII record separator; same rationale
_STREAM_CHUNK = 1024 * 1024  # 1 MiB; bounded RAM for huge files


def compute_row_hash(row: Mapping[str, Any], schema: Mapping[str, str]) -> str:
    """
    Compute a deterministic 64-char hex hash for one row.

    Args:
        row: dict of column-name -> cell-value for one CSV row. Cell values
            may be str, int, float, bool, or None. Must include all columns
            that appear in `schema` (extras in `row` are ignored).
        schema: dict of column-name -> declared-type (e.g. {"email": "text",
            "tenant_id": "uuid"}). Only columns listed here participate in
            the hash. This is how callers exclude ingestion-time fields
            (ingested_at, source_file_hash, run_id) from the dedup key.

    Returns:
        64-character lowercase hex string.

    Raises:
        KeyError: if `schema` declares a column that's missing from `row`.

    Determinism guarantees:
        - Column order in `row` does not matter (we sort by column name).
        - Cell whitespace is stripped before hashing.
        - None and empty-string normalize to the same hash (both -> b"").
        - Different tenants with identical row content get different hashes
          (tenant_id is part of the schema; callers include it).
    """
    h = hashlib.new(_HASH_ALGO, digest_size=_HASH_DIGEST_SIZE)
    # Sorted iteration -> column-order independence
    for col in sorted(schema.keys()):
        if col not in row:
            raise KeyError(f"row missing schema column: {col!r}")
        cell = row[col]
        normalized = _normalize_cell(cell)
        h.update(col.encode("utf-8"))
        h.update(_KV_SEP)
        h.update(normalized)
        h.update(_FIELD_SEP)
    return h.hexdigest()


def compute_file_hash(s3_path: str | Path, *, _local_open=None) -> str:
    """
    Compute a 64-char hex hash of the CSV file content.

    Streams the file in 1 MiB chunks — bounded RAM regardless of file size.
    The `_local_open` injection point is for tests; production code passes
    a real S3 path.

    Args:
        s3_path: path or URI to the CSV. For unit tests this is a local
            path. For prod, the caller wraps an S3 GetObject stream as a
            file-like and passes a stand-in path; see the DAG for the wiring.
        _local_open: test-only injection for the open() call. Production
            code does NOT pass this; it goes through the local-path branch.

    Returns:
        64-character lowercase hex string.

    Note: byte-identical files produce the same hash. Whitespace-only changes
    (trailing newline, line-ending differences) DO produce different hashes.
    See test_dedup.py for the rationale. If you need whitespace-insensitive
    file-level dedup, normalize the file BEFORE calling this function.
    """
    h = hashlib.new(_HASH_ALGO, digest_size=_HASH_DIGEST_SIZE)
    opener = _local_open if _local_open is not None else open
    with opener(str(s3_path), "rb") as f:
        while True:
            chunk = f.read(_STREAM_CHUNK)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def _normalize_cell(value: Any) -> bytes:
    """
    Normalize one cell to bytes for hashing.

    Rules:
      - None -> b""
      - str -> stripped, UTF-8 encoded
      - bool -> b"true" / b"false" (NOT "1"/"0", to avoid colliding with int 1/0)
      - int / float -> str(value).encode("utf-8")
      - everything else -> str(value).strip().encode("utf-8")
    """
    if value is None:
        return b""
    if isinstance(value, bool):
        # Must come before int — bool is a subclass of int in Python
        return b"true" if value else b"false"
    if isinstance(value, (int, float)):
        return str(value).encode("utf-8")
    if isinstance(value, str):
        return value.strip().encode("utf-8")
    return str(value).strip().encode("utf-8")
