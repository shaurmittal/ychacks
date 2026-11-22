"""Where profiles come from. Phase 1 only ships the JSON fixture source.

A Fiber AI adapter (phase 2) will implement ``ProfileSource`` and map Fiber's
person record onto ``PersonProfile`` (role, seniority, industry, tenure, region,
education level, skills), dropping everything else.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Protocol, runtime_checkable

from .models import InterviewGuide, PersonProfile


@runtime_checkable
class ProfileSource(Protocol):
    def get_profile(self, ref: str) -> PersonProfile:
        """Resolve ``ref`` (a path, record id, ...) to a validated profile."""
        ...


class JsonFileProfileSource:
    def __init__(self, base_dir: str | Path = ".") -> None:
        self.base_dir = Path(base_dir)

    def get_profile(self, ref: str) -> PersonProfile:
        return PersonProfile.model_validate(json.loads((self.base_dir / ref).read_text()))


def load_guide(path: str | Path) -> InterviewGuide:
    return InterviewGuide.model_validate(json.loads(Path(path).read_text()))
