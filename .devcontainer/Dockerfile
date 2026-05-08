# Use Python 3.12 slim base image
FROM python:3.12-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv
RUN curl -LsSf https://astral.sh/uv/install.sh | sh

# Install Node.js 22.x and npm
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs

# Configure uv and project virtual environment location
ENV PATH="/root/.local/bin:$PATH"
ENV UV_LINK_MODE=copy
ENV UV_PROJECT_ENVIRONMENT=.venv-docker

# Set default working directory
WORKDIR /rag-system