"""Per-run token and cost log (JSON lines). Logs counts only, never profile or answer text."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

from .models import Usage


def log_path() -> Path | None:
    p = os.environ.get("TWIN_COST_LOG", "logs/twin_runs.jsonl")
    return None if p.lower() in ("", "off", "none") else Path(p)


def log_usage(op: str, usage: Usage, **counts: int) -> None:
    path = log_path()
    if path is None:
        return
    entry = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "op": op, **usage.model_dump(), **counts}
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as f:
        f.write(json.dumps(entry) + "\n")
