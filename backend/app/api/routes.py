import json
import logging
import shutil
from pathlib import Path
from queue import Empty, Queue
from threading import Thread
from time import perf_counter, time
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse, StreamingResponse
from langchain_chroma import Chroma
from sentence_transformers import CrossEncoder

from backend.app.config.rag_settings import RagSettings
from backend.app.core.paths import get_project_root
from backend.app.schemas import (
    DocumentItem,
    DocumentsResponse,
    HealthResponse,
    QueryRequest,
    QueryResponse,
    StreamCompleteEvent,
    StreamDeltaEvent,
    StreamFailedEvent,
    StreamProgressEvent,
    StreamProgressStage,
    StreamStartEvent,
    UploadResponse,
)
from backend.app.services.rag_service import (
    add_document_to_vectorstore,
    document_item_from_pdf_path,
    get_default_pdf_dir,
    get_default_pdf_paths,
    run_rag_query,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def get_vector_store(request: Request) -> Chroma:
    """Provide the shared vector store built once at app startup."""
    return request.app.state.vector_store


def get_reranker(request: Request) -> CrossEncoder:
    """Provide the shared cross-encoder reranker loaded once at app startup."""
    return request.app.state.reranker


def get_rag_settings(request: Request) -> RagSettings:
    """Provide the RAG settings loaded once at app startup."""
    return request.app.state.rag_settings


@router.get("/")
async def root(request: Request) -> dict[str, str]:
    """Root endpoint returning minimal API metadata."""
    return {"name": request.app.title, "docs_url": request.app.docs_url or "/docs"}


@router.get("/documents", status_code=status.HTTP_200_OK)
async def documents() -> DocumentsResponse:
    pdf_paths = get_default_pdf_paths()
    if not pdf_paths:
        logger.info("No indexed documents — upload at least one PDF.")

    documents: list[DocumentItem] = [
        document_item_from_pdf_path(path) for path in pdf_paths
    ]
    return DocumentsResponse(documents=documents)


@router.get("/documents/{document_id}/file")
async def get_document_file(document_id: str) -> FileResponse:

    safe_name = Path(document_id).name
    if safe_name != document_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid document id.",
        )

    # Keep this extension policy explicit for now (PDF-only viewer step).
    if not safe_name.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF documents are supported.",
        )

    pdf_dir = get_default_pdf_dir()
    file_path = (pdf_dir / safe_name).resolve()

    # Extra safety: ensure resolved path stays under pdf_dir.
    if pdf_dir.resolve() not in file_path.parents:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid document path.",
        )

    if not file_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found.",
        )

    return FileResponse(
        path=file_path,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{safe_name}"'},
    )


@router.post("/upload")
async def upload(request: Request, file: UploadFile = File(...)) -> UploadResponse:
    """Accept a multipart/form-data file, save it to `data/pdf_documents`, and return file metadata."""

    UPLOAD_DIR = get_project_root() / "data" / "pdf_documents"
    UPLOAD_DIR.mkdir(exist_ok=True)
    filename = file.filename
    if not filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file must include a filename.",
        )

    # Use only the final path segment so crafted names like "../../../tmp/x.pdf"
    # cannot escape UPLOAD_DIR (path traversal). Parent directories in the string
    # are discarded; the file is always written directly under UPLOAD_DIR.
    safe_name = Path(filename).name

    if not safe_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid filename; expected a non-empty base name.",
        )

    if not safe_name.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file must be a PDF.",
        )

    save_path = UPLOAD_DIR / safe_name

    logger.info(f"/upload endpoint: Saving {safe_name} to disk")
    with open(save_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    app = request.app  # FastAPI instance

    # TODO: offload add_document_to_vectorstore to a thread pool; save+index is CPU/IO heavy.
    logger.info(f"/upload endpoint: Add {safe_name} to vector store")
    _, _ = add_document_to_vectorstore(
        vector_store=app.state.vector_store,
        file_path=str(save_path),
        settings=app.state.rag_settings,
    )

    return UploadResponse(
        document_id=safe_name,
        filename=safe_name,
    )


@router.get("/health", status_code=status.HTTP_200_OK)
async def health() -> HealthResponse:
    """Health check endpoint for uptime and readiness probes."""
    return HealthResponse(status="ok")


@router.post("/query", status_code=status.HTTP_200_OK)
async def query(
    body: QueryRequest,
    vector_store: Chroma = Depends(get_vector_store),
    reranker: CrossEncoder = Depends(get_reranker),
    settings: RagSettings = Depends(get_rag_settings),
) -> QueryResponse:
    """Run a RAG query and return the answer with its supporting chunks."""

    rag_results = run_rag_query(
        query=body.query,
        vector_store=vector_store,
        reranker=reranker,
        settings=settings,
    )

    return QueryResponse(
        answer=rag_results.answer_with_citations.answer,
        cited_chunks=rag_results.cited_chunks,
        usage=rag_results.usage,
    )


@router.post("/query/stream", status_code=status.HTTP_200_OK)
async def query_stream(
    body: QueryRequest,
    vector_store: Chroma = Depends(get_vector_store),
    reranker: CrossEncoder = Depends(get_reranker),
    settings: RagSettings = Depends(get_rag_settings),
) -> StreamingResponse:
    """V1 stream contract: start/progress/delta/complete|failed lifecycle events."""

    def event_stream():
        event_queue: Queue[dict[str, object]] = Queue()
        done_marker: dict[str, object] = {"_stream_worker_done": True}

        request_id = str(uuid4())
        sequence = 0
        final_payload: QueryResponse | None = None
        final_usage = None
        final_error: Exception | None = None
        timings_ms: dict[str, int] = {}
        started_at = perf_counter()

        def _next_sequence() -> int:
            nonlocal sequence
            sequence += 1
            return sequence

        def _timestamp_ms() -> int:
            return int(time() * 1000)

        def _queue_event(payload: dict[str, object]) -> None:
            event_queue.put(payload)

        def _emit_progress(stage: StreamProgressStage, message: str) -> None:
            # Track first progress timestamp per stage for lightweight observability.
            if stage not in timings_ms:
                timings_ms[stage] = int((perf_counter() - started_at) * 1000)
            _queue_event(
                StreamProgressEvent(
                    request_id=request_id,
                    sequence=_next_sequence(),
                    timestamp_ms=_timestamp_ms(),
                    stage=stage,
                    message=message,
                ).model_dump()
            )

        def _emit_delta(delta: str) -> None:
            if not delta:
                return
            # Time to first token: ms from stream start until first answer text chunk.
            if "first_token_ms" not in timings_ms:
                timings_ms["first_token_ms"] = int((perf_counter() - started_at) * 1000)
            _queue_event(
                StreamDeltaEvent(
                    request_id=request_id,
                    sequence=_next_sequence(),
                    timestamp_ms=_timestamp_ms(),
                    delta=delta,
                ).model_dump()
            )

        _queue_event(
            StreamStartEvent(
                request_id=request_id,
                sequence=_next_sequence(),
                timestamp_ms=_timestamp_ms(),
                query=body.query,
            ).model_dump()
        )

        def _worker() -> None:
            nonlocal final_payload, final_usage, final_error, timings_ms
            try:
                rag_results = run_rag_query(
                    query=body.query,
                    vector_store=vector_store,
                    reranker=reranker,
                    settings=settings,
                    on_progress=_emit_progress,
                    on_delta=_emit_delta,
                )

                final_payload = QueryResponse(
                    answer=rag_results.answer_with_citations.answer,
                    cited_chunks=rag_results.cited_chunks,
                    usage=rag_results.usage,
                )
                final_usage = rag_results.usage
                timings_ms["total"] = int((perf_counter() - started_at) * 1000)
            except Exception as exc:  # pragma: no cover
                final_error = exc
            finally:
                event_queue.put(done_marker)

        worker = Thread(target=_worker, daemon=True)
        worker.start()

        while True:
            try:
                item = event_queue.get(timeout=0.25)
            except Empty:
                if not worker.is_alive():
                    break
                continue

            if item is done_marker:
                break

            yield json.dumps(item) + "\n"

        if final_error is not None:
            logger.warning("/query/stream endpoint exception: %s", final_error)
            yield (
                json.dumps(
                    StreamFailedEvent(
                        request_id=request_id,
                        sequence=_next_sequence(),
                        timestamp_ms=_timestamp_ms(),
                        message="Could not complete the request.",
                    ).model_dump()
                )
                + "\n"
            )
            return

        if final_payload is None:
            yield (
                json.dumps(
                    StreamFailedEvent(
                        request_id=request_id,
                        sequence=_next_sequence(),
                        timestamp_ms=_timestamp_ms(),
                        message="The request completed without a final payload.",
                    ).model_dump()
                )
                + "\n"
            )
            return

        yield (
            json.dumps(
                StreamCompleteEvent(
                    request_id=request_id,
                    sequence=_next_sequence(),
                    timestamp_ms=_timestamp_ms(),
                    data=final_payload,
                    timings_ms=timings_ms,
                    usage=final_usage,
                ).model_dump()
            )
            + "\n"
        )

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")
