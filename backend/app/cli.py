import logging

from backend.app.config.rag_settings import get_rag_settings
from backend.app.core.config import load_and_validate_env
from backend.app.core.logging_config import setup_logging
from backend.app.schemas import CitedChunk
from backend.app.services.docling_ingest import build_document_converter
from backend.app.services.rag_service import (
    build_index,
    build_reranker,
    get_default_pdf_paths,
    run_rag_query,
)

logger = logging.getLogger(__name__)


def get_query_from_user():
    query = input('\nWhat would you like to ask? (type "quit" to exit)\n> ')
    return query


def print_cited_chunks(cited_chunks: list[CitedChunk]):
    """Print the cited passages below the answer using their original ids.

    The numbers here match the inline [N] markers in the answer text.
    """

    if not cited_chunks:
        print("\nNo context block citations found in the response.")
        return

    print("\nCited passages:\n")
    for chunk in cited_chunks:
        print(f"[{chunk.citation_index}] {chunk.source} (page {chunk.page + 1})")
        print(f"{chunk.content}\n")


def main():
    print("Hello from rag-system!\n")

    load_and_validate_env()
    setup_logging()
    settings = get_rag_settings()

    # Build the index and load the reranker once before accepting queries.
    pdf_paths = get_default_pdf_paths()

    logger.info("pdf_paths %s", pdf_paths)

    if not pdf_paths:
        print(
            "There are no PDFs in the folder. \
            Please upload at least one before querying the knowledge base."
        )

    logger.info("Building document converter...")
    document_converter = build_document_converter(settings)

    logger.info("Building index...")
    vector_store = build_index(
        pdf_paths,
        settings,
        document_converter=document_converter,
    )

    logger.info("Building reranker...")
    reranker = build_reranker(settings)

    while True:
        query = get_query_from_user().strip()

        if query.lower() in {"quit", "exit"}:
            break

        if not query:
            continue

        logger.info("Run RAG query...")
        rag_result = run_rag_query(
            query=query,
            vector_store=vector_store,
            reranker=reranker,
            settings=settings,
        )
        print("=" * 80)
        print(f"Answer:\n\n{rag_result.answer_with_citations.answer}")
        print_cited_chunks(rag_result.cited_chunks)

    print("Goodbye! Thanks for using rag-system!")


if __name__ == "__main__":
    main()
