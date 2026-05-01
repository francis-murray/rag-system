from backend.app.core.config import load_and_validate_env
from backend.app.schemas import CitedChunk
from backend.app.services.rag_service import (
    build_index,
    get_default_pdf_path,
    run_rag_query,
)


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
        print(chunk.content)
        print("-" * 50)


def main():
    print("Hello from rag-system!\n")

    load_and_validate_env()

    # Build the index once before accepting queries.
    vector_store = build_index(get_default_pdf_path())

    while True:
        query = get_query_from_user().strip()

        if query.lower() in {"quit", "exit"}:
            break

        if not query:
            continue

        structured, cited_chunks = run_rag_query(query=query, vector_store=vector_store)
        print("=" * 80)
        print(f"Response to the query {query}:\n {structured.answer}")
        print_cited_chunks(cited_chunks)

    print("Goodbye! Thanks for using rag-system!")


if __name__ == "__main__":
    main()
