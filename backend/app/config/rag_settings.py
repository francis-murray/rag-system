from functools import lru_cache
from pathlib import Path

import yaml
from pydantic import BaseModel

RAG_CONFIG_FILE = Path(__file__).resolve().parent / "rag.yaml"


class RagModels(BaseModel):
    rag: str
    embedding: str
    reranker: str
    evaluation: str


class RagPrompt(BaseModel):
    name: str


class RagRetrieval(BaseModel):
    num_candidates: int
    top_k: int
    rerank_confidence_threshold: float


class RagDocling(BaseModel):
    chunk_size: int
    chunk_overlap: int
    do_ocr: bool
    do_table_structure: bool


class RagIndex(BaseModel):
    collection_name: str
    docling: RagDocling


class RagSettings(BaseModel):
    models: RagModels
    prompt: RagPrompt
    retrieval: RagRetrieval
    index: RagIndex


@lru_cache
def get_rag_settings() -> RagSettings:
    """Load shared RAG settings from ``backend/app/config/rag.yaml``."""
    with RAG_CONFIG_FILE.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    return RagSettings(**data)
