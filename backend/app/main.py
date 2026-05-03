import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from backend.app.api.routes import router
from backend.app.core.config import load_and_validate_env
from backend.app.core.logging_config import setup_logging
from backend.app.services.rag_service import (
    NoPdfFilesError,
    build_index,
    build_reranker,
    get_default_pdf_paths,
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Build shared runtime dependencies once at startup.
    load_and_validate_env()
    setup_logging()
    try:
        pdf_paths = get_default_pdf_paths()
    except NoPdfFilesError as err:
        logger.error("API startup aborted: %s", err)
        raise
    app.state.vector_store = build_index(pdf_paths)
    app.state.reranker = build_reranker()
    yield


app = FastAPI(
    title="RAG-System API",
    description="RAG system",
    lifespan=lifespan,
)

app.include_router(router)
