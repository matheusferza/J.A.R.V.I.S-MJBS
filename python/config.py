"""Small .env loader that safely ignores human notes and malformed metadata lines."""

import os
import re
from pathlib import Path

_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def load_project_env() -> None:
    """Load valid KEY=VALUE pairs without printing or changing user notes in .env."""
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        clean = line.strip()
        if not clean or clean.startswith("#") or "=" not in clean:
            continue
        key, value = clean.split("=", 1)
        key = key.strip()
        if _NAME.fullmatch(key):
            os.environ.setdefault(key, value.strip().strip('"').strip("'"))
