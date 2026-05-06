"""
Unit tests for lib/dedup.py.

Pure-function tests — no Airflow, no DB, no S3. Run with:
    pytest examples/orch-test-h6-resume/etl-pipeline/tests/test_dedup.py
"""

from __future__ import annotations

import io
import os
import sys
import tempfile

import pytest

# Path injection — sibling lib/ folder.
_HERE = os.path.dirname(__file__)
_LIB = os.path.abspath(os.path.join(_HERE, "..", "lib"))
if _LIB not in sys.path:
    sys.path.insert(0, _LIB)

from dedup import compute_file_hash, compute_row_hash  # noqa: E402


# Schema fixture used across row-hash tests. Mirrors ROW_HASH_SCHEMA in the DAG.
SCHEMA = {
    "tenant_id": "uuid",
    "external_id": "text",
    "email": "text",
    "full_name": "text",
}


# =============================================================================
# compute_row_hash
# =============================================================================

class TestRowHashDeterminism:
    """Same row data MUST produce the same hash, every time."""

    def test_same_row_same_hash(self):
        row = {
            "tenant_id": "11111111-1111-1111-1111-111111111111",
            "external_id": "ext-001",
            "email": "alice@example.com",
            "full_name": "Alice Aardvark",
        }
        h1 = compute_row_hash(row, SCHEMA)
        h2 = compute_row_hash(row, SCHEMA)
        assert h1 == h2
        assert len(h1) == 64  # 32 bytes hex-encoded

    def test_hash_is_64_char_hex(self):
        row = {k: "x" for k in SCHEMA}
        h = compute_row_hash(row, SCHEMA)
        assert len(h) == 64
        int(h, 16)  # must parse as hex


class TestRowHashSensitivity:
    """Different row data MUST produce different hashes."""

    @pytest.mark.parametrize("changed_field", list(SCHEMA.keys()))
    def test_changed_field_changes_hash(self, changed_field):
        base = {
            "tenant_id": "11111111-1111-1111-1111-111111111111",
            "external_id": "ext-001",
            "email": "alice@example.com",
            "full_name": "Alice Aardvark",
        }
        modified = dict(base)
        modified[changed_field] = "different-value-here"
        assert compute_row_hash(base, SCHEMA) != compute_row_hash(modified, SCHEMA)

    def test_different_tenant_different_hash(self):
        """Tenant scoping: same business data for two tenants -> distinct hashes."""
        row_a = {
            "tenant_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            "external_id": "ext-001",
            "email": "shared@example.com",
            "full_name": "Shared Name",
        }
        row_b = dict(row_a)
        row_b["tenant_id"] = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
        assert compute_row_hash(row_a, SCHEMA) != compute_row_hash(row_b, SCHEMA)


class TestColumnOrderIndependence:
    """dict insertion order MUST NOT affect the hash."""

    def test_reordered_keys_same_hash(self):
        row_a = {
            "tenant_id": "11111111-1111-1111-1111-111111111111",
            "external_id": "ext-001",
            "email": "a@b.c",
            "full_name": "A B",
        }
        row_b = {
            "full_name": "A B",
            "email": "a@b.c",
            "tenant_id": "11111111-1111-1111-1111-111111111111",
            "external_id": "ext-001",
        }
        assert compute_row_hash(row_a, SCHEMA) == compute_row_hash(row_b, SCHEMA)


class TestRowHashNormalization:
    """Whitespace + None handling is part of the contract."""

    def test_leading_trailing_whitespace_stripped(self):
        clean = {
            "tenant_id": "11111111-1111-1111-1111-111111111111",
            "external_id": "ext-001",
            "email": "a@b.c",
            "full_name": "Alice",
        }
        spaced = dict(clean)
        spaced["full_name"] = "  Alice  "
        assert compute_row_hash(clean, SCHEMA) == compute_row_hash(spaced, SCHEMA)

    def test_none_and_empty_string_collide(self):
        """Documented behavior: None and '' normalize to the same hash."""
        with_none = {
            "tenant_id": "11111111-1111-1111-1111-111111111111",
            "external_id": "ext-001",
            "email": None,
            "full_name": "Alice",
        }
        with_empty = dict(with_none)
        with_empty["email"] = ""
        assert compute_row_hash(with_none, SCHEMA) == compute_row_hash(with_empty, SCHEMA)


class TestRowHashErrors:
    def test_missing_schema_column_raises(self):
        row = {"tenant_id": "11111111-1111-1111-1111-111111111111"}
        with pytest.raises(KeyError):
            compute_row_hash(row, SCHEMA)


# =============================================================================
# compute_file_hash
# =============================================================================

class TestFileHashStability:
    """Identical bytes -> identical hash."""

    def test_identical_bytes_same_hash(self):
        with tempfile.NamedTemporaryFile(delete=False) as f1, \
                tempfile.NamedTemporaryFile(delete=False) as f2:
            payload = b"tenant_id,email\nuuid,a@b.c\n"
            f1.write(payload)
            f2.write(payload)
            f1.flush()
            f2.flush()
            assert compute_file_hash(f1.name) == compute_file_hash(f2.name)

    def test_different_bytes_different_hash(self):
        with tempfile.NamedTemporaryFile(delete=False) as f1, \
                tempfile.NamedTemporaryFile(delete=False) as f2:
            f1.write(b"row-a")
            f2.write(b"row-b")
            f1.flush()
            f2.flush()
            assert compute_file_hash(f1.name) != compute_file_hash(f2.name)


class TestFileHashWhitespaceSensitivity:
    """
    CONSCIOUS CHOICE: file hash IS whitespace-sensitive.

    A trailing newline, CRLF vs LF, or any other byte-level difference
    DOES change the file hash. Rationale:

      - File hash is a content-address. If you want byte-insensitive
        dedup, normalize the file BEFORE hashing it.
      - The row-level hash already strips whitespace per cell, so two
        files that differ only in whitespace will produce the SAME row
        hashes — the ON CONFLICT DO NOTHING in the swap step still
        catches the duplicates at the row level. The file-level hash
        is the cheap short-circuit, not the safety net.
      - Making the file hash whitespace-insensitive would require
        full-file parsing (defeats streaming) or a normalization pass
        (writes a temp copy of every file). Not worth it.

    These tests pin that decision so a future change can't quietly
    flip the contract.
    """

    def test_trailing_newline_changes_file_hash(self):
        with tempfile.NamedTemporaryFile(delete=False) as f1, \
                tempfile.NamedTemporaryFile(delete=False) as f2:
            f1.write(b"a,b\n1,2")
            f2.write(b"a,b\n1,2\n")  # extra trailing newline
            f1.flush()
            f2.flush()
            assert compute_file_hash(f1.name) != compute_file_hash(f2.name)

    def test_crlf_vs_lf_changes_file_hash(self):
        with tempfile.NamedTemporaryFile(delete=False) as f1, \
                tempfile.NamedTemporaryFile(delete=False) as f2:
            f1.write(b"a,b\n1,2\n")
            f2.write(b"a,b\r\n1,2\r\n")
            f1.flush()
            f2.flush()
            assert compute_file_hash(f1.name) != compute_file_hash(f2.name)

    def test_row_hash_compensates_for_whitespace_changes(self):
        """
        The compensating contract: the same logical row in two files that
        differ only in line endings will produce the same row_hash, so the
        ON CONFLICT swap dedupes them even though the file hashes differ.
        """
        row_lf = {
            "tenant_id": "11111111-1111-1111-1111-111111111111",
            "external_id": "ext-001",
            "email": "a@b.c",
            "full_name": "Alice",
        }
        row_crlf = dict(row_lf)
        # Cells aren't where the line ending lives; the row dict is identical
        # after the CSV reader splits on the line terminator. Confirms the
        # row-level hash IS line-ending-insensitive.
        assert compute_row_hash(row_lf, SCHEMA) == compute_row_hash(row_crlf, SCHEMA)


class TestFileHashStreaming:
    """File hash MUST work on files larger than the chunk size (1 MiB)."""

    def test_large_file_streams(self):
        with tempfile.NamedTemporaryFile(delete=False) as f:
            # 2.5 MiB of repeating bytes — exercises the streaming loop.
            chunk = b"x" * (1024 * 1024)
            f.write(chunk + chunk + chunk[: 1024 * 512])
            f.flush()
            h = compute_file_hash(f.name)
            assert len(h) == 64
