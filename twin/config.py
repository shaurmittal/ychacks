"""Loads thresholds from config.toml (one file, all knobs)."""

from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_CONFIG_PATH = Path(__file__).with_name("config.toml")


@dataclass(frozen=True)
class FreeTextConfig:
    judge_below_similarity: float = 0.6
    score_match: float = 0.1
    score_emphasis_shift: float = 0.5
    score_novel_info: float = 0.65
    score_contradiction: float = 0.9


@dataclass(frozen=True)
class TwinConfig:
    n_samples: int = 5
    match_below: float = 0.35
    contradiction_at: float = 0.7
    probe_at: float = 0.5
    free_text: FreeTextConfig = field(default_factory=FreeTextConfig)
    scale_tolerance: int = 1
    default_model: str = "test"
    execution: str = "offload"  # offload | local | proxy
    remote_cache: bool = False

    @property
    def model(self) -> str:
        return os.environ.get("TWIN_MODEL", self.default_model)

    @property
    def model_service(self) -> str | None:
        return os.environ.get("TWIN_MODEL_SERVICE") or None

    @property
    def judge_model(self) -> str:
        return os.environ.get("TWIN_JUDGE_MODEL", self.model)

    @classmethod
    def load(cls, path: str | Path | None = None) -> "TwinConfig":
        path = Path(path or os.environ.get("TWIN_CONFIG") or DEFAULT_CONFIG_PATH)
        raw = tomllib.loads(path.read_text())
        s = raw.get("surprise", {})
        return cls(
            n_samples=raw.get("prediction", {}).get("n_samples", 5),
            match_below=s.get("match_below", 0.35),
            contradiction_at=s.get("contradiction_at", 0.7),
            probe_at=s.get("probe_at", 0.5),
            free_text=FreeTextConfig(**s.get("free_text", {})),
            scale_tolerance=raw.get("calibration", {}).get("scale_tolerance", 1),
            **{k: v for k, v in raw.get("engine", {}).items()},
        )


_cached: TwinConfig | None = None


def get_config() -> TwinConfig:
    global _cached
    if _cached is None:
        _cached = TwinConfig.load()
    return _cached
