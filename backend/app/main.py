import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from backend.app.api.routes import router
from backend.app.config.rag_settings import get_rag_settings
from backend.app.core.config import load_and_validate_env
from backend.app.core.logging_config import setup_logging
from backend.app.services.rag_service import (
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

    settings = get_rag_settings()
    app.state.rag_settings = settings

    pdf_paths = get_default_pdf_paths()
    if not pdf_paths:
        logger.info("No indexed documents — upload at least one PDF.")

    logger.info("Building index...")
    app.state.vector_store = build_index(pdf_paths, settings)

    logger.info("Building reranker...")
    app.state.reranker = build_reranker(settings)
    yield


app = FastAPI(
    title="RAG-System API",
    description="RAG system",
    lifespan=lifespan,
)

app.include_router(router)
