from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request, status
from langchain_chroma import Chroma

from backend.app.core.config import load_and_validate_env
from backend.app.core.logging_config import setup_logging
from backend.app.schemas import QueryRequest, QueryResponse
from backend.app.services.rag_service import (
    build_index,
    get_default_pdf_path,
    run_rag_query,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # the code before yield will be executed once, before the 
    # application starts receiving requests.
    load_and_validate_env()
    setup_logging()
    app.state.vector_store = build_index(get_default_pdf_path())
    yield


app = FastAPI(
    title="RAG-System API",
    description="RAG system",
    lifespan=lifespan,
)


def get_vector_store(request: Request) -> Chroma:
    """Provide the shared vector store built once at app startup."""
    return request.app.state.vector_store


@app.get("/")
async def root() -> dict[str, str]:
    """Root endpoint to verify the API is reachable."""
    return {"message": "Hello World"}


@app.post("/query", status_code=status.HTTP_200_OK)
async def query(
    body: QueryRequest,
    vector_store: Chroma = Depends(get_vector_store),
) -> QueryResponse:
    """Run a RAG query and return the answer with its supporting chunks."""
    structured, cited_chunks = run_rag_query(
        query=body.query,
        vector_store=vector_store,
    )

    return QueryResponse(
        answer=structured.answer,
        cited_chunks=cited_chunks,
    )
