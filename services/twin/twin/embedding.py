"""Cheap text similarity used before the LLM judge. Pluggable via the Embedder protocol.

The default is dependency-free (word + character-trigram bag cosine). Swap in a real
sentence-embedding model later by passing any object with ``similarity(a, b) -> float``.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from typing import Protocol, runtime_checkable

_STOP = frozenset("a an the and or but i i'm im to of in on for with at by it is are was be been my me we our that this so very really just".split())


@runtime_checkable
class Embedder(Protocol):
    def similarity(self, a: str, b: str) -> float:
        """Return similarity in [0, 1]."""
        ...


class NgramEmbedder:
    """Cosine similarity over content words and character trigrams. Deterministic."""

    def _vec(self, text: str) -> Counter:
        words = [w for w in re.findall(r"[a-z0-9']+", text.lower()) if w not in _STOP]
        v: Counter = Counter(f"w:{w}" for w in words)
        for w in words:
            padded = f" {w} "
            v.update(f"c:{padded[i:i + 3]}" for i in range(len(padded) - 2))
        return v

    def similarity(self, a: str, b: str) -> float:
        va, vb = self._vec(a), self._vec(b)
        if not va or not vb:
            return 1.0 if a.strip().lower() == b.strip().lower() else 0.0
        dot = sum(va[k] * vb[k] for k in va.keys() & vb.keys())
        norm = math.sqrt(sum(x * x for x in va.values())) * math.sqrt(sum(x * x for x in vb.values()))
        return max(0.0, min(1.0, dot / norm))


def default_embedder() -> Embedder:
    return NgramEmbedder()
