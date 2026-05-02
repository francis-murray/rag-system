from fastapi import APIRouter, Depends, Request, status
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
