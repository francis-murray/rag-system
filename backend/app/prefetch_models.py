"""Pre-download model weights into the local caches during environment setup.

Run this in the open setup phase (e.g. devcontainer ``postCreateCommand``) so that
later, locked-down/firewalled runs never need to reach out to the HuggingFace Hub
or the tiktoken blob endpoint, both of which are CDN-backed with rotating IPs that
are impractical to allowlist on an egress firewall. It deliberately triggers only
the *downloads* (skipping index building), so it can run during container setup
before any secrets or documents are configured:

  - reranker cross-encoder weights  -> HuggingFace Hub  (~/.cache/huggingface)
  - Docling PDF pipeline model(s)   -> HuggingFace Hub  (~/.cache/huggingface)
  - tiktoken encoding for the embedding tokenizer -> Azure blob (TIKTOKEN_CACHE_DIR)

Invoke with::

    uv run python -m backend.app.prefetch_models
"""

from __future__ import annotations

import logging

from backend.app.config.rag_settings import get_rag_settings
from backend.app.core.logging_config import setup_logging
from backend.app.services.docling_ingest import (
    build_document_converter,
    build_hybrid_chunker,
)
from backend.app.services.rag_service import build_reranker

logger = logging.getLogger(__name__)


def prefetch_models() -> None:
    """Force every network-backed model asset into its on-disk cache."""
    setup_logging()
    settings = get_rag_settings()

    logger.info("Prefetch: reranker weights (%s)...", settings.models.reranker)
    build_reranker(settings)

    logger.info("Prefetch: Docling PDF pipeline model(s)...")
    build_document_converter(settings)

    logger.info(
        "Prefetch: tiktoken encoding for embedding tokenizer (%s)...",
        settings.models.embedding,
    )
    build_hybrid_chunker(settings)

    logger.info("Prefetch complete; model caches are warm.")


if __name__ == "__main__":
    prefetch_models()
