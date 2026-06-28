# Development Containers

This repository includes a development container configuration for contributors who want a more consistent and reproducible development environment.

## Setup

Development Containers integrate seamlessly with the VS Code Dev Containers extension, which can automatically build, configure, and start the development environment.

The Docker configuration can also be used manually with other IDEs that do not fully support the Dev Containers workflow or directly from the terminal using Docker commands.

Choose one of the following setup paths:

- **VS Code Dev Containers** — recommended for the simplest setup experience
- **Manual Docker setup** — recommended for other IDEs and terminal-based workflows

If you prefer a standard local installation without containers, follow the setup instructions in the root [README.md](../README.md).

---

# Requirements

Install:

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

Optional:

- [Visual Studio Code](https://code.visualstudio.com/)
- [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)

---

# Option 1 — VS Code Dev Containers

## 1. Start Docker Desktop

On macOS:

```bash
open -a Docker
```

Wait until Docker Desktop shows the Docker engine is running.

Optional verify:

```bash
docker version
```

---

## 2. Open the project in VS Code

From the project root:

```bash
code .
```

---

## 3. Reopen in Container

When prompted, select:

> Reopen in Container

Or open the command palette:

```text
Cmd/Ctrl + Shift + P
```

Then run:

```text
Dev Containers: Reopen in Container
```

The Dev Containers extension automatically:

- builds the image from `.devcontainer/Dockerfile`
- starts the container
- mounts the workspace and persistent volumes
- installs backend and frontend dependencies
- pre-downloads model weights into the persistent cache
- applies the egress firewall (see [Egress Firewall](#egress-firewall) below)

---

## 4. Configure environment variables

Copy the environment templates:

```bash
cp .env.example .env
cp frontend/.env.example frontend/.env.local
```

Then configure:

- `OPENAI_API_KEY`
- additional environment variables as needed

---

## 5. Add PDF documents

Place one or more `.pdf` files into:

```text
data/pdf_documents/
```

---

## 6. Run backend

Inside the container terminal:

```bash
uv run uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000
```

Backend available at:

```text
http://localhost:8000
```

---

## 7. Run frontend

Open a second terminal inside the container:

```bash
npm --prefix frontend run dev -- --hostname 0.0.0.0 --port 3000
```

Frontend available at:

```text
http://localhost:3000
```

---

## 8. Stop services

Press `Ctrl + C` in each terminal.

To exit the Dev Container environment and return to your local workspace:

Open the command palette:

```text
Cmd/Ctrl + Shift + P
```

Then run:

```text
Dev Containers: Reopen Folder Locally
```

---

# Option 2 — Manual Docker Setup

## 1. Start Docker Desktop

On macOS:

```bash
open -a Docker
```

Wait until Docker Desktop shows the Docker engine is running.

Optional verify:

```bash
docker version
```

---

## 2. Build the image

From the project root:

```bash
docker build -t rag-system-image -f .devcontainer/Dockerfile .
```

This builds the development image from `.devcontainer/Dockerfile`.

The image includes:

- Python 3.12
- Node.js 22.x
- npm
- uv
- ruff
- git
- build-essential
- curl
- iptables, ipset, dnsutils, aggregate, jq, sudo (for the egress firewall)
- Claude Code (`@anthropic-ai/claude-code`)

The image runs as a non-root user (`appuser`, UID 1000) rather than root.

Rebuild the image when:

- `.devcontainer/Dockerfile` changes
- system-level dependencies change

---

## 3. Start the container

First-time setup:

```bash
docker run -d \
  --name rag-system-container \
  --cap-drop=ALL \
  --cap-add=NET_ADMIN \
  --cap-add=NET_RAW \
  --cap-add=SETUID \
  --cap-add=SETGID \
  -p 3000:3000 \
  -p 8000:8000 \
  -v "$(pwd):/rag-system" \
  -v rag_uv_cache:/home/appuser/.cache/uv \
  -v rag_huggingface_cache:/home/appuser/.cache/huggingface \
  -v rag_tiktoken_cache:/home/appuser/.cache/tiktoken \
  -v rag_frontend_node_modules:/rag-system/frontend/node_modules \
  -v claude-code-config:/home/appuser/.claude \
  -e TIKTOKEN_CACHE_DIR=/home/appuser/.cache/tiktoken \
  -e HF_HUB_OFFLINE=1 \
  -e CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
  -e DISABLE_AUTOUPDATER=1 \
  -w /rag-system \
  rag-system-image \
  sleep infinity
```

This command:

- creates and starts the container
- mounts the project directory into the container
- exposes frontend and backend ports
- persists dependency and model caches across sessions
- keeps the container running in the background
- grants `NET_ADMIN`, `NET_RAW`, `SETUID`, and `SETGID` capabilities required by the egress firewall

After starting the container, apply the egress firewall manually (see [Egress Firewall](#egress-firewall) below):

```bash
docker exec rag-system-container sudo /usr/local/bin/init-firewall.sh
```

For later sessions, if the container already exists but is stopped:

```bash
docker start rag-system-container
```

Optional verify:

```bash
docker ps --filter "name=rag-system-container"
```

---

## 4. Open a shell inside the container

```bash
docker exec -it rag-system-container bash
```

---

## 5. Install backend dependencies

Inside the container:

```bash
uv sync
```

Run again when:

- `pyproject.toml` changes
- `uv.lock` changes

The container uses:

```text
UV_PROJECT_ENVIRONMENT=.venv-docker
```

to keep the container virtual environment separate from any local `.venv`.

---

## 6. Install frontend dependencies

Inside the container:

```bash
npm --prefix frontend ci
```

Run again when:

- `frontend/package-lock.json` changes
- frontend dependencies are reset or removed

---

## 7. Configure environment variables

Copy the environment templates:

```bash
cp .env.example .env
cp frontend/.env.example frontend/.env.local
```

Then configure:

- `OPENAI_API_KEY`
- additional environment variables as needed

---

## 8. Add PDF documents

Place one or more `.pdf` files into:

```text
data/pdf_documents/
```

---

## 9. Run backend

Inside the container:

```bash
uv run uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000
```

Backend available at:

```text
http://localhost:8000
```

---

## 10. Run frontend

Open a second terminal on your host machine.

Then open another shell inside the container:

```bash
docker exec -it rag-system-container bash
```

Run:

```bash
npm --prefix frontend run dev -- --hostname 0.0.0.0 --port 3000
```

Frontend available at:

```text
http://localhost:3000
```

---

## 11. Stop services

Press `Ctrl + C` in each terminal.

Close container shell sessions with:

```bash
exit
```

or press:

```text
Ctrl + D
```

---

## 12. Stop the container

```bash
docker stop rag-system-container
```

---

# Egress Firewall

The devcontainer runs an `iptables`-based default-deny egress firewall, applied automatically on every container start via `postStartCommand`. This prevents arbitrary outbound connections from the container (e.g. from an agent session) while still allowing the tools and services the project actually needs.

## What is allowed

| Destination | Purpose |
|---|---|
| DNS (UDP 53) | Name resolution |
| Loopback | Local inter-process communication |
| SSH (TCP 22) | git over SSH |
| Host network (`/24`) | VS Code server, port forwards |
| `api.anthropic.com` | Claude Code |
| `api.openai.com` | Embeddings, chat, and eval at runtime |
| `registry.npmjs.org` | `npm install` |
| `pypi.org`, `files.pythonhosted.org` | `uv`/`pip install` |
| `download.pytorch.org` | CPU torch on aarch64 |
| GitHub IP ranges (from `api.github.com/meta`) | `git`, `gh` CLI |

Everything else is immediately rejected (`icmp-admin-prohibited`), giving a clear error rather than a silent hang.

## Why model weights do not need to be allowlisted

HuggingFace Hub and the tiktoken blob endpoint are CDN-backed with rotating IPs that are impractical to allowlist reliably. Instead, weights are downloaded during `postCreateCommand` (before the firewall is applied) into persisted volumes, so runtime and agent sessions never need to reach those endpoints.

## Re-applying the firewall

iptables rules do not survive container restarts. The firewall is re-applied automatically on each start via `postStartCommand`.

## Linux capabilities

The firewall requires four Linux capabilities beyond the hardened `--cap-drop=ALL` baseline:

- `NET_ADMIN` — needed to modify iptables rules and ipsets
- `NET_RAW` — needed by iptables for raw socket operations
- `SETUID` — needed by `sudo` to switch from `appuser` to root
- `SETGID` — needed by `sudo` to switch the group to root

`NET_ADMIN` is the most significant of these — it allows rewriting firewall rules. The firewall itself is the compensating control for granting it. `SETUID`/`SETGID` are constrained by the sudoers entry, which limits passwordless sudo to the firewall script path only.

## Firewall script location

The script is baked into the image at `/usr/local/bin/init-firewall.sh` as a root-owned file. `appuser` is granted passwordless `sudo` for that exact path only (via `/etc/sudoers.d/init-firewall`). Because the script is image-resident rather than sourced from the bind-mounted workspace, `appuser` cannot modify it.

---

# Optional Cleanup

The commands below apply to the **Manual Docker Setup** path, where the container and image are named explicitly.

If you used the **VS Code Dev Containers** path, use Docker Desktop to remove the generated dev container resources, or remove them from VS Code using the Dev Containers commands.

## Remove container

```bash
docker rm rag-system-container
```

Use this for a full container reset.

---

## Remove image

```bash
docker rmi rag-system-image
```

Use this to force a full rebuild or reclaim disk space.

---

## Remove persistent volumes

```bash
docker volume rm \
  rag_uv_cache \
  rag_huggingface_cache \
  rag_tiktoken_cache \
  rag_frontend_node_modules \
  claude-code-config
```

Use this for a completely clean reset, including:

- cached Python packages
- Hugging Face model cache
- tiktoken encoding cache
- frontend `node_modules`
- Claude Code configuration

