import logging
import os
from pathlib import Path

# Assume this file lives in project-root/backend/app/core/
PROJECT_ROOT = Path(__file__).resolve().parents[3]

# Logs go in the root-level "logs" directory.
LOG_DIR = PROJECT_ROOT / "logs"

# Third-party libraries that are too chatty at INFO/DEBUG.
# We pin them to WARNING so they only surface real problems.
NOISY_THIRD_PARTY_LOGGERS = (
    "httpx",
    "httpcore",
    "openai",
    "urllib3",
    "chromadb",
    "sentence_transformers",
)


def setup_logging() -> None:
    """Configure logging once for the application.

    Logs are written to:
      - logs/app.log (DEBUG and above)
      - Console / stdout (controlled by LOG_LEVEL env var, default INFO)

    LOG_LEVEL accepts: DEBUG, INFO, WARNING, ERROR, CRITICAL.
    Invalid values fall back to INFO.

    Log levels:
      DEBUG    - Detailed debug information, useful for development
      INFO     - General events confirming things are working as expected
      WARNING  - Unexpected events, but the program is still running
      ERROR    - Serious problems, parts of the app may not work
      CRITICAL - Very severe errors, the program may be unable to continue
    """
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    console_level_name = os.getenv("LOG_LEVEL", "INFO").upper()
    console_level = getattr(logging, console_level_name, logging.INFO)

    formatter = logging.Formatter(
        # Log format, e.g. "2025-07-22 13:45:12,345 - rag_system.cli - INFO - CLI started"
        fmt="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    file_handler = logging.FileHandler(LOG_DIR / "app.log")
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(formatter)

    stream_handler = logging.StreamHandler()
    stream_handler.setLevel(console_level)
    stream_handler.setFormatter(formatter)

    logging.basicConfig(
        level=logging.DEBUG,
        handlers=[file_handler, stream_handler],
        force=True,
    )

    # Silence chatty third-party loggers (e.g. httpx logs every HTTP request at INFO).
    for name in NOISY_THIRD_PARTY_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)
