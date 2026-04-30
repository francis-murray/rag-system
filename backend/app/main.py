from backend.app.core.config import load_and_validate_env
from backend.app.services.rag_service import run_rag_query


def get_query_from_user():
    query = input("Please enter your query: ")
    return query


def print_cited_passages(citation_map, cited_indices):
    """Print the cited passages below the answer using their original ids.

    The numbers here match the inline [N] markers in the answer text.
    """
    if not cited_indices:
        print("\nNo context block citations found in the response.")
        return

    print("\nCited passages:")
    for idx in cited_indices:
        chunk = citation_map[idx]
        print("-" * 50)
        print(f"[{idx}] {chunk['source']} (page {chunk['page'] + 1})")
        print(chunk["content"])


def main():
    print("Hello from rag-system!\n")

    load_and_validate_env()

    # 2.1 Get query from user
    query = get_query_from_user()

    structured, citation_map, cited_indices = run_rag_query(query)
    print("=" * 50)
    print(f"Response:\n {structured.answer}")
    print_cited_passages(citation_map, cited_indices)


if __name__ == "__main__":
    main()
