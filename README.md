# RAG System

A Python retrieval-augmented generation (RAG) system for answering questions over local PDF documents. The system indexes PDFs into a persistent vector store, retrieves candidate chunks using embeddings, reranks results with a cross-encoder, and generates concise citation-aware answers with an LLM.

## Features

- PDF loading and chunking
- Persistent vector store with deterministic chunk IDs
- Embedding-based semantic search
- Cross-encoder reranking
- Citation-aware answer generation with supporting source chunks
- Versioned prompt configuration
- FastAPI endpoints for health checks, file uploads, and RAG queries
- Next.js frontend with a RAG query interface and file upload form
- Next.js API proxy routes for backend `/health`, `/upload`, `/query`, and `/query/stream`
- Interactive command-line query loop
- File and console logging

## Requirements

- Python 3.12 or higher
- `uv` package manager ([installation guide](https://docs.astral.sh/uv/getting-started/installation/))
- Node.js 20 or higher (for the frontend)
- `npm` (bundled with Node.js)
- An OpenAI API key
- At least one `.pdf` file in `data/pdf_documents/`

## Setup

Clone the repository:

```bash
git clone <repository-url>
cd rag-system
```

> Prefer using Dev Containers?
>
> Follow [`.devcontainer/README.md`](./.devcontainer/README.md) instead of the local setup steps below.

Install backend dependencies:

```bash
uv sync
```

By default, `uv sync` creates a local virtual environment at `.venv`.

_In the Dev Container workflow, dependencies are installed into `.venv-docker` inside the container to keep host and container environments separate._

Install frontend dependencies:

```bash
npm install --prefix frontend
```

### Environment

#### Backend environment

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Then edit `.env` and replace the placeholders with your API keys and other values. At minimum, set `OPENAI_API_KEY`.

#### Frontend environment

Copy `frontend/.env.example` to `frontend/.env.local`:

```bash
cp frontend/.env.example frontend/.env.local
```

Then edit `frontend/.env.local` as needed.

### PDF Documents

Add one or more `.pdf` files to:

```text
data/pdf_documents/
```

You can also upload files from the web UI (they are written to the same directory) or call `POST /upload` on the FastAPI app or `POST /api/upload` on the Next.js dev server. The vector index is built when the API process starts; restart the API after adding new PDFs so they are indexed and available to RAG queries.

## Usage

### Running the CLI

```bash
uv run python -m backend.app.cli
```

The CLI builds or reuses the vector index, loads the reranker, then prompts for questions. Type `quit` or `exit` to stop.

---

### Running the API

```bash
uv run uvicorn backend.app.main:app --reload
```

Open the interactive API docs at:

```text
http://127.0.0.1:8000/docs
```

---

### Running the Frontend

Start the Next.js frontend in a second terminal:

```bash
npm --prefix frontend run dev
```

Open:

```text
http://127.0.0.1:3000
```

The frontend calls internal Next.js API routes:

- `GET /api/health` → proxies to backend `GET /health`
- `POST /api/upload` → proxies multipart form-data to backend `POST /upload`
- `POST /api/query` → validates payload and proxies to backend `POST /query`
- `POST /api/query/stream` → validates payload and proxies to backend `POST /query/stream` (NDJSON stream)

---

### Notes

- The first time you run the CLI or API, the app downloads cross-encoder weights (about 80 MB) into your local Hugging Face Hub cache. By default that is `~/.cache/huggingface/hub` on macOS and Linux, and `%USERPROFILE%\.cache\huggingface\hub` on Windows. Set `HF_HUB_CACHE` or `HF_HOME` to use a different location.
- The vector store and reranker are created once when the process starts and reused for later queries. The HTTP server does this in the FastAPI `lifespan` hook; the CLI does it before the interactive loop.
- Uploading a PDF does not rebuild the index in memory. Restart `uvicorn` (or the CLI) after new files land in `data/pdf_documents/` if you need them in search results immediately.

## Backend API Endpoints

### `GET /health`

Returns service health:

```json
{
  "status": "ok"
}
```

---

### `POST /upload`

Accepts a single file as `multipart/form-data` with field name `file`. The file is saved under `data/pdf_documents/` using the original filename (the directory is created if missing). The request must include a filename.

Response (JSON):

```json
{
  "filename": "document.pdf",
  "save_path": "/absolute/path/to/rag-system/data/pdf_documents/document.pdf"
}
```

Example:

```bash
curl -X POST http://127.0.0.1:8000/upload \
  -F "file=@/path/to/document.pdf"
```

Example (Next.js proxy):

```bash
curl -X POST http://127.0.0.1:3000/api/upload \
  -F "file=@/path/to/document.pdf"
```

---

### `POST /query`

Runs a RAG query against the indexed PDFs.

Request:

```json
{
  "query": "What is this document about?"
}
```

Response:

```json
{
  "answer": "A concise answer with inline citation markers like [1].",
  "cited_chunks": [
    {
      "citation_index": 1,
      "document_id": "chunk-id",
      "source": "document.pdf",
      "page": 0,
      "start_index": 123,
      "content": "Supporting passage text..."
    }
  ]
}
```

Example:

```bash
curl -X POST http://127.0.0.1:8000/query \
  -H "Content-Type: application/json" \
  -d '{"query":"What is this document about?"}'
```

---

### `POST /query/stream`

Runs the same RAG query as `POST /query`, but streams newline-delimited JSON (`application/x-ndjson`) events.

Request:

```json
{
  "query": "What is this document about?"
}
```

Response (V1 NDJSON: one JSON object per line, `stream_version: 1`):

Every event shares an envelope: `stream_version`, `request_id`, `sequence` (monotonic), `timestamp_ms`, and `type`.

The JSON below is **pretty-printed** so the fields are easy to scan. On the wire, each event is **one line of compact JSON** (no indentation or extra newlines inside the object), then a newline before the next event—typical NDJSON style.

- **`start`** — first line; echoes the query text.

  ```json
  {
    "type": "start",
    "stream_version": 1,
    "request_id": "550e8400-e29b-41d4-a716-446655440000",
    "sequence": 1,
    "timestamp_ms": 1715000000000,
    "query": "What is this document about?"
  }
  ```

- **`progress`** — pipeline milestones while work runs. `stage` is one of `retrieval`, `rerank`, or `inference` (model call / streamed answer).

  ```json
  {
    "type": "progress",
    "stream_version": 1,
    "request_id": "550e8400-e29b-41d4-a716-446655440000",
    "sequence": 2,
    "timestamp_ms": 1715000000100,
    "stage": "retrieval",
    "message": "Retrieving candidate chunks from the vector store..."
  }
  ```

- **`delta`** — zero or more lines; each appends a chunk of the streamed answer text.

  ```json
  {
    "type": "delta",
    "stream_version": 1,
    "request_id": "550e8400-e29b-41d4-a716-446655440000",
    "sequence": 8,
    "timestamp_ms": 1715000001200,
    "delta": "A concise answer"
  }
  ```

- **`complete`** — final success line: canonical `data` (same shape as `POST /query`) plus `timings_ms` (e.g. first occurrence of each `stage`, `first_token_ms`, `total`).

  ```json
  {
    "type": "complete",
    "stream_version": 1,
    "request_id": "550e8400-e29b-41d4-a716-446655440000",
    "sequence": 42,
    "timestamp_ms": 1715000005000,
    "data": {
      "answer": "A concise answer with inline citation markers like [1].",
      "cited_chunks": [
        {
          "citation_index": 1,
          "document_id": "chunk-id",
          "source": "document.pdf",
          "page": 0,
          "start_index": 123,
          "content": "Supporting passage text..."
        }
      ]
    },
    "timings_ms": {
      "retrieval": 50,
      "rerank": 120,
      "inference": 200,
      "first_token_ms": 350,
      "total": 900
    }
  }
  ```

- **`failed`** — terminal error line with a stable `code` and user-safe `message`.

  ```json
  {
    "type": "failed",
    "stream_version": 1,
    "request_id": "550e8400-e29b-41d4-a716-446655440000",
    "sequence": 10,
    "timestamp_ms": 1715000002000,
    "code": "internal_error",
    "message": "Could not complete the request."
  }
  ```

Example (backend endpoint):

```bash
curl -N -X POST http://127.0.0.1:8000/query/stream \
  -H "Content-Type: application/json" \
  -d '{"query":"What is this document about?"}'
```

Example (Next.js proxy endpoint):

```bash
curl -N -X POST http://127.0.0.1:3000/api/query/stream \
  -H "Content-Type: application/json" \
  -d '{"query":"What is this document about?"}'
```

## How It Works

1. PDFs are loaded from `data/pdf_documents/`.
2. Pages are split into overlapping text chunks.
3. Chunks are embedded and stored in the vector database.
4. A query retrieves the top candidate chunks by vector similarity.
5. A cross-encoder reranks candidates and selects the top chunks.
6. The LLM answers using only the selected context.
7. The response includes inline citations and cited source chunks.

## Project Structure

```text
backend/
  app/
    api/                                   # FastAPI routes
    core/                                  # Environment, logging, project paths
    prompts/                               # Versioned prompt configuration
    services/                              # Indexing, retrieval, reranking, generation
    cli.py                                 # Interactive CLI entry point
    main.py                                # FastAPI app entry point
frontend/
  app/
    api/                                   # Next.js proxy routes (health, upload, query, stream)
    page.tsx                               # RAG query UI and file upload form
    layout.tsx                             # App shell and metadata
  lib/                                     # Frontend config + shared types
data/
  pdf_documents/                           # Add source PDFs here
  chroma_langchain_db/                     # Generated vector DB (local, at runtime)
logs/
  app.log                                  # Generated application logs
```

