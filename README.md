# RAG System

A Python retrieval-augmented generation (RAG) system for answering questions over local PDF documents. The system indexes PDFs into a persistent vector store, retrieves candidate chunks using embeddings, reranks results with a cross-encoder, and generates concise citation-aware answers with an LLM.

## Features

- PDF loading and chunking
- Persistent vector store with deterministic chunk IDs
- Embedding-based semantic search
- Cross-encoder reranking
- Citation-aware answer generation with supporting source chunks
- Versioned prompt configuration
- FastAPI endpoints for health checks and RAG queries
- Next.js frontend with a RAG query interface
- Next.js API proxy routes for backend `/health` and `/query`
- Interactive command-line query loop
- File and console logging

## Requirements

- Python 3.12 or higher
- `uv` package manager ([installation guide](https://docs.astral.sh/uv/getting-started/installation/))
- Node.js 20 or higher (for the frontend)
- npm (bundled with Node.js)
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

In the Dev Container workflow, dependencies are installed into `.venv-docker` inside the container to keep host and container environments separate.

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
- `POST /api/query` → validates payload and proxies to backend `POST /query`

---

### Notes

- The first time you run the CLI or API, the app downloads cross-encoder weights (about 80 MB) into your local Hugging Face Hub cache. By default that is `~/.cache/huggingface/hub` on macOS and Linux, and `%USERPROFILE%\.cache\huggingface\hub` on Windows. Set `HF_HUB_CACHE` or `HF_HOME` to use a different location.
- The vector store and reranker are created once when the process starts and reused for later queries. The HTTP server does this in the FastAPI `lifespan` hook; the CLI does it before the interactive loop.

## Backend API Endpoints

### `GET /health`

Returns service health:

```json
{
  "status": "ok"
}
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
    core/                                  # Environment + logging setup
    prompts/                               # Versioned prompt configuration
    services/                              # Indexing, retrieval, reranking, generation
    cli.py                                 # Interactive CLI entry point
    main.py                                # FastAPI app entry point
frontend/
  app/
    api/                                   # Next.js health/query proxy routes
    page.tsx                               # RAG query UI
    layout.tsx                             # App shell and metadata
  lib/                                     # Frontend config + shared types
data/
  pdf_documents/                           # Add source PDFs here
  chroma_langchain_db/                     # Generated vector DB (local, at runtime)
logs/
  app.log                                  # Generated application logs
```

