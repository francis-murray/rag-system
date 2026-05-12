from pathlib import Path


def get_project_root(marker: str = "pyproject.toml") -> Path:
    """
    Return the project root: first ancestor of this file that contains ``marker``.
    """
    current = Path(__file__).resolve()
    for parent in (current.parent, *current.parents):
        if (parent / marker).is_file():
            return parent
    raise FileNotFoundError(f"{marker!r} not found when walking parents from {current}")
