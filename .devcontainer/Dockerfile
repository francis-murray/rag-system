# Use Python 3.12 slim base image
FROM python:3.12-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    build-essential \
    curl \
    iptables \
    ipset \
    iproute2 \
    dnsutils \
    aggregate \
    jq \
    sudo \
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

# Install Claude Code globally
RUN npm install -g @anthropic-ai/claude-code

# Install firewall script system-wide (root-owned) so appuser cannot modify
# a script it is allowed to run as root via passwordless sudo.
COPY init-firewall.sh /usr/local/bin/init-firewall.sh
RUN chmod 0755 /usr/local/bin/init-firewall.sh

# Create non-root user and set workspace ownership
RUN groupadd --gid 1000 appuser \
    && useradd --uid 1000 --gid 1000 --create-home --shell /bin/bash appuser \
    && mkdir -p /rag-system \
    && chown appuser:appuser /rag-system

# Allow appuser to run only the firewall script as root without a password
RUN echo 'appuser ALL=(root) NOPASSWD: /usr/local/bin/init-firewall.sh' \
    > /etc/sudoers.d/init-firewall \
    && chmod 0440 /etc/sudoers.d/init-firewall

USER appuser

# Set default working directory
WORKDIR /rag-system

# Pre-create mount points so the named volumes inherit appuser ownership
RUN mkdir -p frontend/node_modules \
    /home/appuser/.cache/uv \
    /home/appuser/.cache/huggingface \
    /home/appuser/.cache/tiktoken \
    /home/appuser/.claude
