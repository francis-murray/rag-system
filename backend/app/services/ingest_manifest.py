"""SQLite-backed manifest tracking successful PDF ingests.

An entry is written only after Docling has run and all chunks have been added
to Chroma. This guarantees that a fingerprint match means a complete, successful
index — a crashed or partial run leaves no entry and will be retried.
"""

from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from backend.app.core.paths import get_project_root

logger = logging.getLogger(__name__)

_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS ingest_manifest (
    document_id        TEXT PRIMARY KEY,
    ingest_fingerprint TEXT NOT NULL,
    chunk_count        INTEGER NOT NULL,
    indexed_at         TEXT NOT NULL
);
"""


def get_manifest_path() -> Path:
    return get_project_root() / "data" / "index" / "ingest_manifest.db"


def init_manifest_db(db_path: Path) -> None:
    """Create the manifest table if it does not already exist."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        conn.execute(_CREATE_TABLE)


def get_manifest_entry(
    db_path: Path,
    document_id: str,
) -> tuple[str, int] | None:
    """Return ``(ingest_fingerprint, chunk_count)`` for *document_id*, or ``None``."""
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            "SELECT ingest_fingerprint, chunk_count FROM ingest_manifest WHERE document_id = ?",
            (document_id,),
        ).fetchone()
    return (row[0], row[1]) if row else None


def set_manifest_entry(
    db_path: Path,
    document_id: str,
    ingest_fingerprint: str,
    chunk_count: int,
) -> None:
    """Upsert a manifest entry, marking *document_id* as fully indexed."""
    indexed_at = datetime.now(timezone.utc).isoformat()
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO ingest_manifest (document_id, ingest_fingerprint, chunk_count, indexed_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(document_id) DO UPDATE SET
                ingest_fingerprint = excluded.ingest_fingerprint,
                chunk_count        = excluded.chunk_count,
                indexed_at         = excluded.indexed_at
            """,
            (document_id, ingest_fingerprint, chunk_count, indexed_at),
        )
    logger.debug(
        "Manifest updated: %s fingerprint=%s chunks=%d",
        document_id,
        ingest_fingerprint[:12],
        chunk_count,
    )
