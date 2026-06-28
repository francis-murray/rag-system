# Use Python 3.12 slim base image
FROM python:3.12-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv and move to system path so all users can access it
RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
    && mv /root/.local/bin/uv /usr/local/bin/uv

# Install Node.js 22.x and npm
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs

# Configure uv and project virtual environment location
ENV UV_LINK_MODE=copy
ENV UV_PROJECT_ENVIRONMENT=.venv-docker

# Install Ruff as a standalone command-line tool on PATH (not the project venv)
RUN UV_TOOL_BIN_DIR=/usr/local/bin uv tool install ruff

# Create non-root user and set workspace ownership
RUN groupadd --gid 1000 appuser \
    && useradd --uid 1000 --gid 1000 --create-home --shell /bin/bash appuser \
    && mkdir -p /rag-system \
    && chown appuser:appuser /rag-system

USER appuser

# Set default working directory
WORKDIR /rag-system

# Pre-create mount points so the named volumes inherit appuser ownership
RUN mkdir -p frontend/node_modules \
    /home/appuser/.cache/uv \
    /home/appuser/.cache/huggingface
