# Semantic search part inspired by
# "Build a semantic search engine with LangChain" tutorial
# (https://docs.langchain.com/oss/python/langchain/knowledge-base)

import hashlib
import logging
import re
from pathlib import Path
from typing import Callable

import numpy as np
from langchain_chroma import Chroma
from langchain_community.document_loaders import PyPDFLoader
from langchain_core.documents import Document
from langchain_openai import OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from openai import OpenAI
from pydantic import BaseModel, Field
from sentence_transformers import CrossEncoder

from backend.app.core.paths import get_project_root
from backend.app.prompts.registry import load_prompt
from backend.app.schemas import ChunkWithMetadata, CitedChunk, DocumentItem, StreamProgressStage

logger = logging.getLogger(__name__)

# Compact, fixed-point output for NumPy arrays in console output.
np.set_printoptions(precision=2, suppress=True)


class AnswerWithCitations(BaseModel):
    """An answer to the question, grounded only in the provided context."""

    answer: str = Field(description="Short answer grounded only in provided context.")
    citations: list[int] = Field(
        description="1-based context block ids used to support the answer."
    )


ProgressCallback = Callable[[StreamProgressStage, str], None]


# Matches inline citations like "[1]" or "[12]" in the LLM answer.
CITATION_MARKER_PATTERN = re.compile(r"\[(\d+)\]")

# Single source of truth for the reranker model. Loaded once at startup
# via build_reranker() and reused across queries.
CROSS_ENCODER_MODEL_NAME = "cross-encoder/ms-marco-MiniLM-L6-v2"


class NoPdfFilesError(ValueError):
    """The default PDF directory exists but contains no ``*.pdf`` files."""


def build_reranker() -> CrossEncoder:
    """Load the cross-encoder model once (called at app startup).

    First run downloads weights from the HuggingFace Hub (~80MB) into the
    user's local cache. Subsequent runs load from disk.
    """
    logger.info("Loading cross-encoder model %s...", CROSS_ENCODER_MODEL_NAME)
    return CrossEncoder(CROSS_ENCODER_MODEL_NAME)


def get_default_pdf_dir() -> Path:
    """Default directory containing PDFs to index (single source of truth)."""
    return get_project_root() / "data" / "pdf_documents"


def get_default_pdf_paths() -> list[str]:
    """Return all PDF file paths in the default pdf_documents directory.

    Used by both the CLI and API so they index the same corpus.

    Raises:
        FileNotFoundError: If ``pdf_dir`` does not exist.
        NoPdfFilesError: If the directory exists but contains no ``*.pdf`` files.
    """
    pdf_dir = get_default_pdf_dir()
    if not pdf_dir.is_dir():
        raise FileNotFoundError(f"PDF directory not found: {pdf_dir}")

    pdf_paths = sorted(str(p) for p in pdf_dir.glob("*.pdf"))
    if not pdf_paths:
        try:
            pdf_dir_display = pdf_dir.relative_to(get_project_root())
        except ValueError:
            pdf_dir_display = pdf_dir
            logger.info("No .pdf files in %s. Return an empty list.", pdf_dir_display)
            return []

    return pdf_paths


def document_item_from_pdf_path(file_path: str) -> DocumentItem:
    """Build API metadata for a PDF on disk."""
    basename = Path(file_path).name
    return DocumentItem(
        document_id=basename,
        filename=basename,
    )


def build_index(file_paths: list[str]) -> Chroma:

    ###################################################
    ########      1. INDEXING STAGE            ########
    ###################################################
    logger.info("Indexing stage for %d PDF file(s)...", len(file_paths))

    # Get embeddings function
    embeddings = get_embedding_function(openai_model_name="text-embedding-3-large")

    # create or load existing vector store
    vector_store = create_or_load_vectorstore(
        collection_name="documents_collection",
        embedding_function=embeddings,
        persist_directory=str(get_project_root() / "data" / "chroma_langchain_db"),
    )

    # add documents (if any) to vector store
    if file_paths:
        vector_store, _ = add_documents_to_vectorstore(
            vector_store=vector_store,
            file_paths=file_paths,
        )

    return vector_store


def run_rag_query(
    query: str,
    vector_store: Chroma,
    reranker: CrossEncoder,
    on_progress: ProgressCallback | None = None,
    on_delta: Callable[[str], None] | None = None,
) -> tuple[AnswerWithCitations, list[CitedChunk]]:

    ###################################################
    ########        2. RETRIEVAL STAGE         ########
    ###################################################

    # Size of initial set of retrieved chunks.
    num_candidates = 30

    # Mirror this stage to the client.
    if on_progress is not None:
        on_progress("retrieval", "Retrieving candidate chunks from the vector store...")
    logger.info("Retrieving %d candidates from the vector store...", num_candidates)
    # Vector-based semantic search.
    candidate_chunks = query_candidate_chunks_from_vectorstore(
        vector_store=vector_store, num_candidates=num_candidates, query=query
    )

    if not candidate_chunks:
        return (
            AnswerWithCitations(
                answer="No indexed documents — upload at least one PDF.",
                citations=[],
            ),
            [],
        )

    # Per-chunk details (verbose; only useful when debugging retrieval quality)
    if logger.isEnabledFor(logging.DEBUG):
        details = "\n".join(
            f"chunk id: {chunk.id}\n{chunk.page_content}\n"
            for chunk in candidate_chunks
        )
        logger.debug("Candidate chunks (%d):\n%s", len(candidate_chunks), details)

    ###################################################
    ########        3. RE-RANKING STAGE        ########
    ###################################################

    # Re-rank using Cross-Encoders for sentence pair scoring
    if on_progress is not None:
        on_progress("rerank", "Re-ranking retrieved chunks with a cross-encoder...")
    logger.info(
        "Re-ranking %d retrieved chunks with a cross-encoder...", len(candidate_chunks)
    )
    sentence_pairs = create_sentence_pairs(query, candidate_chunks)
    sorted_idx, sorted_scores = rerank_pairs(reranker, sentence_pairs)

    # Get top k results with metadata
    top_k_num = 5
    if on_progress is not None:
        on_progress("rerank", f"Selecting the top {top_k_num} chunks as context...")
    logger.info("Selecting the top %d chunks as context", top_k_num)
    top_k_chunks = get_top_k_chunks(candidate_chunks, sorted_idx, k=top_k_num)

    # Per-chunk details (verbose; only useful when debugging retrieval quality)
    if logger.isEnabledFor(logging.DEBUG):
        details = "\n".join(
            f"Rank {i} | doc_id={chunk.document_id}\n"
            f"source={chunk.source} page={chunk.page + 1} "
            f"start_index={chunk.start_index}\n"
            f"content=\n{chunk.content}\n"
            for i, chunk in enumerate(top_k_chunks, start=1)
        )
        logger.debug("Top %d chunks:\n%s", len(top_k_chunks), details)

    ###################################################
    ########        4. GENERATION STAGE        ########
    ###################################################
    logger.info("Generation stage...")

    # Answer the question using an LLM and the top k chunks as context.
    # If retrieval confidence is too low, avoid forcing a hallucinated answer.
    best_rerank_score = sorted_scores[0] if len(sorted_scores) > 0 else -1.0
    rerank_confidence_threshold = 0.2
    if best_rerank_score < rerank_confidence_threshold:
        logger.warning(
            "Skipping generation: best rerank score %.2f below threshold %.2f",
            best_rerank_score,
            rerank_confidence_threshold,
        )
        fallback = AnswerWithCitations(
            answer="I don't know (retrieved context confidence is too low).",
            citations=[],
        )
        return fallback, []

    citation_map, context_text = build_context_for_llm(top_k_chunks)
    logger.debug("Context text passed to LLM:\n%s", context_text)

    structured = generate_answer(
        query,
        context_text,
        on_progress=on_progress,
        on_delta=on_delta,
    )

    cited_indices = collect_cited_indices(
        structured.answer, structured.citations, citation_map
    )
    # Rewrite inline markers in answer.
    reindexed_answer, reindexed_citations, index_mapping = (
        reindex_citations_for_display(structured.answer, cited_indices)
    )
    structured.answer = reindexed_answer
    structured.citations = reindexed_citations

    # Rewrite citation metadata/chunk indices to match.
    cited_chunks = get_cited_chunks(citation_map, cited_indices, index_mapping)

    return structured, cited_chunks


def load_pdf(file_path: str) -> list[Document]:
    """Load a PDF as one LangChain ``Document`` per page.

    ``PyPDFLoader`` yields page-ordered documents.

    Returns:
        A list of ``Document`` instances, one per PDF page in order.
        Each instance has ``page_content`` and ``metadata`` attributes.
    """
    logger.info("Loading %s", Path(file_path).name)
    loader = PyPDFLoader(file_path)
    pages = loader.load()

    basename = Path(file_path).name
    for page in pages:
        page.metadata["source"] = basename
    return pages


def split_documents(documents, chunk_size, chunk_overlap, add_start_index):
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        add_start_index=add_start_index,
    )
    all_splits = text_splitter.split_documents(documents)

    return all_splits


def create_or_load_vectorstore(collection_name, embedding_function, persist_directory):
    # Instantiate vector store (loads existing persisted collection if present).
    vector_store = Chroma(
        collection_name=collection_name,
        embedding_function=embedding_function,
        persist_directory=persist_directory,
    )
    return vector_store


def split_pdfs_into_chunks(file_paths) -> list[Document]:
    all_chunks: list[Document] = []
    for file_path in file_paths:
        pdf_pages = load_pdf(file_path)
        logger.info("Number of pages in pdf: %d", len(pdf_pages))

        # Split our documents into chunks (keeps the metadata into each chunk)
        chunks = split_documents(
            pdf_pages, chunk_size=700, chunk_overlap=120, add_start_index=True
        )
        logger.info("Number of splits in pdf %d", len(chunks))
        all_chunks.extend(chunks)

    logger.info("Total chunks across all PDFs: %d", len(all_chunks))

    return all_chunks


def add_documents_to_vectorstore(vector_store, file_paths):

    # Split documents into chunks (keeps the metadata into each chunk)
    chunks = split_pdfs_into_chunks(file_paths)

    # Build deterministic ids so we can upsert only missing chunks.
    chunk_ids = [deterministic_chunk_id(chunk) for chunk in chunks]

    # Check which ids already exist to avoid re-embedding and duplicate indexing.
    existing = vector_store.get(ids=chunk_ids)
    existing_ids = set(existing.get("ids", []))

    chunks_to_add = []
    ids_to_add = []
    for chunk, chunk_id in zip(chunks, chunk_ids):
        if chunk_id in existing_ids:
            continue
        chunks_to_add.append(chunk)
        ids_to_add.append(chunk_id)

    if chunks_to_add:
        vector_store.add_documents(documents=chunks_to_add, ids=ids_to_add)
        logger.info("Indexed %d new chunks.", len(chunks_to_add))
    else:
        logger.info("No new chunks to index - using existing vector store.")

    return vector_store, chunk_ids


def deterministic_chunk_id(document: Document):
    metadata = document.metadata or {}
    source = metadata.get("source", "unknown_source")
    page = metadata.get("page", "unknown_page")
    start_index = metadata.get("start_index", "unknown_start")

    id_seed = f"{source}|{page}|{start_index}"
    # Keep IDs stable even if metadata is missing or duplicated.
    if "unknown_" in id_seed:
        content_hash = hashlib.sha256(
            document.page_content.encode("utf-8")
        ).hexdigest()[:16]
        id_seed = f"{id_seed}|{content_hash}"

    return hashlib.sha256(id_seed.encode("utf-8")).hexdigest()


def get_embedding_function(openai_model_name="text-embedding-3-large"):
    logger.info("Initializing embedding client with %s", openai_model_name)
    embeddings = OpenAIEmbeddings(model=openai_model_name)

    vector_1 = embeddings.embed_query("first chunk")
    vector_2 = embeddings.embed_query("This is another chunk")

    assert len(vector_1) == len(vector_2)
    logger.debug("Embedding dimension: %d", len(vector_1))

    return embeddings


def query_candidate_chunks_from_vectorstore(vector_store, num_candidates, query):
    base_retriever = vector_store.as_retriever(
        search_type="similarity",
        search_kwargs={"k": num_candidates},  # initial candidate pool
    )

    candidate_chunks = base_retriever.invoke(query)
    return candidate_chunks


def create_sentence_pairs(query, candidate_chunks):
    sentence_pairs = []

    for candidate_chunk in candidate_chunks:
        sentence_pairs.append([query, candidate_chunk.page_content])

    return sentence_pairs


def rerank_pairs(reranker: CrossEncoder, sentence_pairs):
    scores = reranker.predict(sentence_pairs)
    logger.debug("Rerank scores: %s", scores)

    sorted_idx = np.argsort(scores)[::-1]
    sorted_scores = scores[sorted_idx]
    logger.debug("Rerank sorted indices: %s", sorted_idx)
    logger.debug("Rerank sorted scores: %s", sorted_scores)

    return sorted_idx, sorted_scores


def get_top_k_chunks(candidate_chunks, sorted_idx, k) -> list[ChunkWithMetadata]:

    top_k_chunks: list[ChunkWithMetadata] = []

    for idx in sorted_idx[:k]:
        top_k_chunks.append(
            ChunkWithMetadata(
                document_id=candidate_chunks[idx].id,
                source=candidate_chunks[idx].metadata["source"],
                page=candidate_chunks[idx].metadata["page"],
                start_index=candidate_chunks[idx].metadata["start_index"],
                content=candidate_chunks[idx].page_content,
            )
        )
    return top_k_chunks


def build_context_for_llm(
    top_k_chunks: list[ChunkWithMetadata],
) -> tuple[dict[int, ChunkWithMetadata], str]:
    """Build a 1-indexed citation map and a single context string for the LLM.

    Each context block is prefixed with "[idx]" so the LLM can copy the same
    bracketed marker directly into the answer.
    """
    citation_map = {idx: chunk for idx, chunk in enumerate(top_k_chunks, start=1)}

    blocks = []
    for idx, chunk in citation_map.items():
        blocks.append(
            f"[{idx}] source={chunk.source} "
            f"page={chunk.page + 1} "
            f"start_index={chunk.start_index}\n"
            f"{chunk.content}"
        )
    return citation_map, "\n\n".join(blocks)


def generate_answer(
    query: str,
    context_text: str,
    model: str = "gpt-5-mini",
    on_progress: ProgressCallback | None = None,
    on_delta: Callable[[str], None] | None = None,
) -> AnswerWithCitations:
    """Ask the LLM to answer the question using only the provided context."""
    prompt = load_prompt("qa")
    system_msg, user_msg = prompt.render(query=query, context_text=context_text)

    client = OpenAI()

    if on_progress is not None:
        on_progress("inference", "Sending question and context to the LLM…")
    logger.info("Starting LLM stream request (model=%s)...", model)

    if on_delta is not None:
        answer_text = generate_answer_streaming(
            client=client,
            model=model,
            system_msg=system_msg,
            user_msg=user_msg,
            on_delta=on_delta,
            on_progress=on_progress,
        )
        # Streaming mode cannot use `responses.parse`, so collect citations from
        # inline markers in the final text.
        citations = [
            int(match.group(1))
            for match in CITATION_MARKER_PATTERN.finditer(answer_text)
        ]
        return AnswerWithCitations(answer=answer_text, citations=citations)

    response = client.responses.parse(
        model=model,
        input=[
            {"role": "system", "content": system_msg},
            {"role": "user", "content": user_msg},
        ],
        text_format=AnswerWithCitations,
    )
    parsed = response.output_parsed
    if parsed is None:
        raise RuntimeError("Model returned no structured output.")
    return parsed


def generate_answer_streaming(
    client: OpenAI,
    model: str,
    system_msg: str,
    user_msg: str,
    on_delta: Callable[[str], None],
    on_progress: ProgressCallback | None = None,
) -> str:
    """Stream answer text deltas from OpenAI and return the full text."""
    chunks: list[str] = []
    with client.responses.stream(
        model=model,
        input=[
            {"role": "system", "content": system_msg},
            {"role": "user", "content": user_msg},
        ],
    ) as stream:
        if on_progress is not None:
            on_progress("inference", "Generating answer...")
        for event in stream:
            if event.type != "response.output_text.delta":
                continue
            delta = event.delta
            if not delta:
                continue
            chunks.append(delta)
            on_delta(delta)

        # Fail fast if the stream ended with an error state.
        stream.get_final_response()

    return "".join(chunks)


def collect_cited_indices(answer, structured_citations, citation_map):
    """Return the unique, valid citation indices in display order.

    Indices that appear inline in the answer come first (in appearance order);
    any remaining valid structured citations are appended at the end.
    """
    ordered = []

    for match in CITATION_MARKER_PATTERN.finditer(answer):
        idx = int(match.group(1))
        if idx in citation_map and idx not in ordered:
            ordered.append(idx)

    for idx in structured_citations:
        if idx in citation_map and idx not in ordered:
            ordered.append(idx)

    return ordered


def reindex_citations_for_display(
    answer: str, cited_indices: list[int]
) -> tuple[str, list[int], dict[int, int]]:
    """Remap cited indices to contiguous ``[1..N]`` in first-appearance order.

    Args:
        answer: Answer text that may contain inline citation markers, e.g.
            ``"BERT uses MLM [4] and NSP. [5]"``.
        cited_indices: Ordered original citation ids to display, e.g. ``[4, 5]``.

    Returns:
        tuple[str, list[int], dict[int, int]]:
            - reindexed_answer: Answer with rewritten inline markers, e.g.
              ``"BERT uses MLM [1] and NSP. [2]"``.
            - reindexed_citations: Sequential citation ids for structured output,
              e.g. ``[1, 2]``.
            - index_mapping: Original id -> displayed id mapping, e.g.
              ``{4: 1, 5: 2}``.

    Example:
        ``answer="... [4] ... [5]"`` and ``cited_indices=[4, 5]`` returns:
        ``("... [1] ... [2]", [1, 2], {4: 1, 5: 2})``.
    """
    # Build old -> new mapping.
    index_mapping = {
        old_idx: new_idx for new_idx, old_idx in enumerate(cited_indices, 1)
    }

    def _replace_marker(match: re.Match[str]) -> str:
        """Rewrite one inline citation marker using ``index_mapping``.

        Example:
            If ``index_mapping`` is ``{4: 1, 5: 2}``, then ``"[4]"`` becomes
            ``"[1]"`` and ``"[5]"`` becomes ``"[2]"``. Markers without a
            mapping are returned unchanged.
        """
        old_idx = int(match.group(1))
        new_idx = index_mapping.get(old_idx)
        if new_idx is None:
            return match.group(0)
        return f"[{new_idx}]"

    # Replace each citation marker in `answer` with its renumbered display index.
    reindexed_answer = CITATION_MARKER_PATTERN.sub(_replace_marker, answer)

    # Structured citation ids mirror the rewritten inline markers: [1, 2, ..., N].
    reindexed_citations = list(range(1, len(cited_indices) + 1))

    return reindexed_answer, reindexed_citations, index_mapping


def get_cited_chunks(
    citation_map,
    cited_indices,
    index_mapping: dict[int, int] | None = None,
) -> list[CitedChunk]:
    """Return the chunks corresponding to the cited indices."""
    if index_mapping is None:
        index_mapping = {idx: idx for idx in cited_indices}

    return [
        CitedChunk(
            citation_index=index_mapping[idx],
            **citation_map[idx].model_dump(),
        )
        for idx in cited_indices
    ]
