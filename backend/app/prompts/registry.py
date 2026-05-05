"""Versioned prompt loader.

Prompts live as YAML files under ``backend/app/prompts/<name>/<version>.yaml``.
The active version per prompt is selected by ``backend/app/prompts/active.yaml``.
"""

from functools import lru_cache
from pathlib import Path

import yaml
from pydantic import BaseModel

PROMPTS_DIR = Path(__file__).parent
ACTIVE_FILE = PROMPTS_DIR / "active.yaml"


class Prompt(BaseModel):
    """A single prompt version, loaded from a ``vN.yaml`` file."""

    name: str
    version: str
    description: str | None = None
    system: str
    user: str

    def render(self, **variables: object) -> tuple[str, str]:
        """Return the ``(system, user)`` messages with ``{vars}`` substituted in user."""
        return self.system, self.user.format(**variables)


def _load_active_versions() -> dict[str, str]:
    """Return the active prompt-version mapping from ``active.yaml``.

    Returns:
        dict[str, str]: Mapping of prompt name to active version.

    Raises:
        ValueError: If ``active.yaml`` is not a mapping.

    Example return value:
        {"qa": "v1", "prompt_name_2": "v2"}
    """
    with ACTIVE_FILE.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data, dict):
        raise ValueError(
            f"{ACTIVE_FILE} must be a mapping of 'prompt_name: version'."
        )
    return data


@lru_cache(maxsize=None)
def load_prompt(name: str, version: str | None = None) -> Prompt:
    """Load and parse a prompt file into a ``Prompt`` model.

    Uses the active version when ``version`` is omitted.

    Args:
        name: Prompt name (folder name under ``backend/app/prompts/``), e.g. ``"qa"``.
        version: Optional explicit version (without file extension), e.g. ``"v1"``.
            If omitted, the value is read from ``active.yaml``.

    Returns:
        Prompt: Parsed prompt model for the selected name and version.

    Raises:
        KeyError: If ``version`` is omitted and ``name`` is missing in ``active.yaml``.
        FileNotFoundError: If the resolved ``<name>/<version>.yaml`` file does not exist.

    Example return value:
        Prompt(
            name="qa",
            version="v1",
            description="Answer a question grounded only in provided context.",
            system="You are an assistant for question-answering tasks. ...",
            user="QUESTION:\\n{query}\\n\\nCONTEXT:\\n{context_text}\\n\\n...",
        )
    """
    if version is None:
        active = _load_active_versions()
        if name not in active:
            raise KeyError(
                f"No active version configured for prompt {name!r} in {ACTIVE_FILE}."
            )
        version = active[name]

    path = PROMPTS_DIR / name / f"{version}.yaml"
    if not path.is_file():
        raise FileNotFoundError(f"Prompt file not found: {path}")

    with path.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f)

    return Prompt(**data)
