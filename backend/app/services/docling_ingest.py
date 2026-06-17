"""Docling PDF ingestion: chunk with HybridChunker and extract provenance boxes."""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from pathlib import Path

import tiktoken
from docling.chunking import HybridChunker  # type: ignore[reportPrivateImportUsage]
from docling_core.transforms.chunker.tokenizer.openai import OpenAITokenizer
from langchain_core.documents import Document

from backend.app.config.rag_settings import RagSettings
from backend.app.schemas import BBoxNorm, PageLocation

logger = logging.getLogger(__name__)


class PermissiveOpenAITokenizer(OpenAITokenizer):
    """OpenAI tokenizer for chunk sizing when PDFs contain literal special-token strings.

    Uses ``disallowed_special=()`` so tiktoken encodes strings like ``<|endofprompt|>``
    as normal tokens instead of raising.
    """

    def count_tokens(self, text: str) -> int:
        return len(self.tokenizer.encode(text=text, disallowed_special=()))


def build_hybrid_chunker(settings: RagSettings):
    """Build a Docling HybridChunker aligned to the configured embedding tokenizer."""
    encoding = tiktoken.encoding_for_model(settings.models.embedding)
    tokenizer = PermissiveOpenAITokenizer(
        tokenizer=encoding,
        max_tokens=settings.index.docling.chunk_size,
    )
    return HybridChunker(tokenizer=tokenizer)


def extract_locations(dl_doc, chunk) -> list[PageLocation]:
    """Map chunk provenance to normalized highlight boxes per page (0–1, top-left, y-down)."""
    boxes_by_page: dict[int, list[BBoxNorm]] = defaultdict(list)

    meta = getattr(chunk, "meta", None)
    if meta is None:
        return []

    doc_items = getattr(meta, "doc_items", None) or []
    for doc_item in doc_items:
        prov_list = getattr(doc_item, "prov", None) or []
        for prov in prov_list:
            page_no = prov.page_no
            page_meta = dl_doc.pages.get(page_no)
            if page_meta is None:
                continue
            page_w = page_meta.size.width
            page_h = page_meta.size.height
            if page_w <= 0 or page_h <= 0:
                continue
            tl_bbox = prov.bbox.to_top_left_origin(page_height=page_h)
            page_idx = page_no - 1
            boxes_by_page[page_idx].append(
                BBoxNorm(
                    l=tl_bbox.l / page_w,
                    t=tl_bbox.t / page_h,
                    r=tl_bbox.r / page_w,
                    b=tl_bbox.b / page_h,
                )
            )

    return [
        PageLocation(page=page_idx, boxes=boxes)
        for page_idx, boxes in sorted(boxes_by_page.items())
    ]


def pdf_to_documents(file_path: str, settings: RagSettings) -> list[Document]:
    """Convert a PDF with Docling and emit LangChain Documents with geometry metadata."""
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption

    path = Path(file_path)
    if path.suffix.lower() != ".pdf":
        raise ValueError(
            f"Docling geometry ingestion supports PDF only; got {path.name!r}."
        )

    basename = path.name
    do_ocr = settings.index.docling.do_ocr
    do_table_structure = settings.index.docling.do_table_structure
    logger.info(
        "Parsing %s with Docling (ocr=%s, table_structure=%s)",
        basename,
        do_ocr,
        do_table_structure,
    )

    pipeline_options = PdfPipelineOptions()
    pipeline_options.do_ocr = do_ocr
    pipeline_options.do_table_structure = do_table_structure

    logger.info("Convert %s to a docling document...", basename)
    converter = DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options),
        }
    )
    result = converter.convert(str(path))
    dl_doc = result.document

    logger.info("Chunk %s docling document", basename)
    chunker = build_hybrid_chunker(settings)
    documents: list[Document] = []

    for chunk in chunker.chunk(dl_doc=dl_doc):
        locations = extract_locations(dl_doc, chunk)
        if not locations:
            raise RuntimeError(
                f"Chunk from {basename!r} has no provenance boxes; "
                "cannot store geometry for citation highlighting."
            )

        contextualized_chunk_text = chunker.contextualize(chunk)
        primary_page = locations[0].page

        metadata = {
            "source": basename,
            "document_id": basename,
            "page": primary_page,
            "locations_json": json.dumps([loc.model_dump() for loc in locations]),
            "headings_json": json.dumps(getattr(chunk.meta, "headings", None) or []),
        }
        documents.append(Document(page_content=contextualized_chunk_text, metadata=metadata))

    logger.info("Docling produced %d chunks for %s", len(documents), basename)
    return documents


def locations_from_metadata(metadata: dict) -> list[PageLocation]:
    """Deserialize ``locations_json`` from Chroma metadata."""
    raw = metadata.get("locations_json", "[]")
    parsed = json.loads(raw) if isinstance(raw, str) else raw
    return [PageLocation(**item) for item in parsed]


def headings_from_metadata(metadata: dict) -> list[str]:
    """Deserialize ``headings_json`` from Chroma metadata."""
    raw = metadata.get("headings_json", "[]")
    parsed = json.loads(raw) if isinstance(raw, str) else raw
    return parsed if isinstance(parsed, list) else []
