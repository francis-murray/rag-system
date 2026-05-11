import json
from queue import Empty, Queue
from threading import Thread

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import StreamingResponse
from langchain_chroma import Chroma
from sentence_transformers import CrossEncoder

from backend.app.schemas import HealthResponse, QueryRequest, QueryResponse
from backend.app.services.rag_service import run_rag_query

router = APIRouter()


def get_vector_store(request: Request) -> Chroma:
    """Provide the shared vector store built once at app startup."""
    return request.app.state.vector_store


def get_reranker(request: Request) -> CrossEncoder:
    """Provide the shared cross-encoder reranker loaded once at app startup."""
    return request.app.state.reranker


@router.get("/")
async def root(request: Request) -> dict[str, str]:
    """Root endpoint returning minimal API metadata."""
    return {"name": request.app.title, "docs_url": request.app.docs_url or "/docs"}


@router.get("/health", status_code=status.HTTP_200_OK)
async def health() -> HealthResponse:
    """Health check endpoint for uptime and readiness probes."""
    return HealthResponse(status="ok")


@router.post("/query", status_code=status.HTTP_200_OK)
async def query(
    body: QueryRequest,
    vector_store: Chroma = Depends(get_vector_store),
    reranker: CrossEncoder = Depends(get_reranker),
) -> QueryResponse:
    """Run a RAG query and return the answer with its supporting chunks."""
    structured, cited_chunks = run_rag_query(
        query=body.query,
        vector_store=vector_store,
        reranker=reranker,
    )

    return QueryResponse(
        answer=structured.answer,
        cited_chunks=cited_chunks,
    )


@router.post("/query/stream", status_code=status.HTTP_200_OK)
async def query_stream(
    body: QueryRequest,
    vector_store: Chroma = Depends(get_vector_store),
    reranker: CrossEncoder = Depends(get_reranker),
) -> StreamingResponse:
    """Stream live RAG pipeline status updates, then the final result."""

    def event_stream():
        """Yield NDJSON status events during execution, then one terminal event."""
        # Thread-safe bridge between the RAG worker thread and this HTTP stream.
        status_queue: Queue[str] = Queue()
        done_marker = "__DONE__"

        final_payload: dict[str, object] = {}
        final_error: Exception | None = None

        def _on_status(message: str) -> None:
            """Receive stage updates from RAG and enqueue them for streaming."""
            status_queue.put(message)

        def _worker() -> None:
            """Run RAG in a background thread and store final result or error."""

            nonlocal final_payload, final_error
            try:
                structured, cited_chunks = run_rag_query(
                    query=body.query,
                    vector_store=vector_store,
                    reranker=reranker,
                    on_status=_on_status,
                )
                final_payload = {
                    "answer": structured.answer,
                    "cited_chunks": [chunk.model_dump() for chunk in cited_chunks],
                }
            except Exception as exc:  # pragma: no cover
                final_error = exc
            finally:
                status_queue.put(done_marker)

        # Start worker thread and stream queue messages as they arrive.
        worker = Thread(target=_worker, daemon=True)
        worker.start()

        # Streaming loop: waits for status messages from `status_queue`,
        # immediately `yield`s each one as an NDJSON line to the client, and exits when
        # the worker signals completion (`done_marker`) or has stopped with no queued messages.
        while True:
            try:
                # Short timeout lets us check both queue and worker liveness.
                message = status_queue.get(timeout=0.25)
            except Empty:
                if not worker.is_alive():
                    break
                continue

            if message == done_marker:
                break

            yield json.dumps({"type": "status", "message": message}) + "\n"

        if final_error is not None:
            yield json.dumps(
                {
                    "type": "error",
                    "message": "Could not complete the request.",
                }
            ) + "\n"
            return

        # Send one final event containing answer + citations.
        yield json.dumps({"type": "result", "data": final_payload}) + "\n"

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")
