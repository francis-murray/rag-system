from fastapi import FastAPI, status

from backend.app.core.config import load_and_validate_env
from backend.app.schemas import QueryRequest, QueryResponse
from backend.app.services.rag_service import run_rag_query

load_and_validate_env()

app = FastAPI(
    title="RAG-System API",
    description="RAG system",
)


@app.get("/")
async def root() -> dict[str, str]:
    """Root endpoint to verify the API is reachable."""
    return {"message": "Hello World"}


@app.post("/query", status_code=status.HTTP_200_OK)
async def query(request: QueryRequest) -> QueryResponse:
    """Run a RAG query and return the answer with its supporting chunks."""
    structured, cited_chunks = run_rag_query(request.query)

    return QueryResponse(
        answer=structured.answer,
        cited_chunks=cited_chunks,
    )
