from pydantic import BaseModel, Field


class ChunkWithMetadata(BaseModel):
    """A retrieved document chunk with its source metadata."""

    document_id: str = Field(description="Unique chunk identifier.")
    source: str = Field(description="Source document path.")
    page: int = Field(description="Zero-based page index.")
    start_index: int = Field(description="Chunk start offset in page.")
    content: str = Field(description="Chunk text content.")


class CitedChunk(ChunkWithMetadata):
    """A chunk that supports an answer, paired with its inline citation index.

    Extends ChunkWithMetadata with citation_index, which matches
    the inline [N] marker rendered in the answer text.
    """

    citation_index: int = Field(description="Inline [N] marker in the answer.")


class QueryRequest(BaseModel):
    """Request body for the /query endpoint."""

    query: str = Field(min_length=1, description="User question to answer.")


class QueryResponse(BaseModel):
    """Response body for the /query endpoint."""

    answer: str = Field(description="Answer text with inline [N] citation markers.")
    cited_chunks: list[CitedChunk] = Field(
        description="Chunks supporting the answer, in citation order."
    )
