"""The Twin: a synthetic stand-in for one participant, built from a minimal profile."""

from __future__ import annotations

from collections import Counter
from functools import lru_cache
from pathlib import Path
from statistics import mean, pstdev
from string import Template
from typing import Iterable, Optional, Sequence

from .config import TwinConfig, get_config
from .costlog import log_usage
from .embedding import Embedder, default_embedder
from .engine import EDSLEngine, PredictionEngine, SampleRequest, SampleResult
from .models import (
    Answer, Correction, GuideQuestion, InterviewGuide, PersonProfile, QuestionType,
    TwinPrediction, Usage,
)

PROMPTS_DIR = Path(__file__).with_name("prompts")

_PROFILE_LABELS = {
    "role_title": "Role", "seniority": "Seniority", "industry": "Industry",
    "tenure_years": "Years in current role", "region": "Region",
    "education_level": "Education", "skills": "Skills",
}


@lru_cache(maxsize=None)
def load_prompt(name: str) -> Template:
    return Template((PROMPTS_DIR / name).read_text())


def render_profile(profile: PersonProfile) -> str:
    lines = []
    for key, label in _PROFILE_LABELS.items():
        value = getattr(profile, key)
        if value in (None, [], ""):
            continue
        if isinstance(value, list):
            value = ", ".join(value)
        lines.append(f"- {label}: {value}")
    return "\n".join(lines)


class Twin:
    """Create with :func:`build_twin`. Holds the profile, stored corrections and engine.

    State that should be persisted between sessions is ``profile`` + ``corrections``;
    use :meth:`to_state` / :meth:`from_state`.
    """

    def __init__(
        self,
        profile: PersonProfile,
        corrections: Iterable[Correction] = (),
        *,
        engine: Optional[PredictionEngine] = None,
        embedder: Optional[Embedder] = None,
        config: Optional[TwinConfig] = None,
    ) -> None:
        self.profile = profile
        self.corrections: list[Correction] = list(corrections)
        self.config = config or get_config()
        self.engine: PredictionEngine = engine or EDSLEngine(config=self.config)
        self.embedder = embedder or default_embedder()
        self.last_usage: Usage = Usage()
        self.last_prompts: dict[str, dict[str, str]] = {}

    # ------------------------------------------------------------------ prompts

    def instruction(self, guide: Optional[InterviewGuide] = None) -> str:
        """The full system instruction sent to the model (profile + corrections)."""
        corrections = ""
        if self.corrections:
            items = []
            for c in self.corrections:
                text = c.question_id
                if guide is not None:
                    try:
                        text = guide.get(c.question_id).text
                    except KeyError:
                        pass
                note = f"\n  Their note: {c.note}" if c.note else ""
                items.append(load_prompt("correction_item.txt").substitute(
                    question_text=text, actual_answer=c.actual_answer, note=note).rstrip())
            corrections = load_prompt("corrections_header.txt").template + "\n".join(items)
        return load_prompt("twin_instruction.txt").substitute(
            profile=render_profile(self.profile), corrections=corrections
        ).strip()

    # ------------------------------------------------------------------ predict

    def predict(self, guide: InterviewGuide, n_samples: Optional[int] = None) -> list[TwinPrediction]:
        """Sample the twin ``n_samples`` times per question and aggregate."""
        n = n_samples or self.config.n_samples
        request = SampleRequest(instruction=self.instruction(guide), questions=guide.questions, n=n)
        result = self.engine.sample(request)
        self.last_usage = result.usage
        self.last_prompts = result.prompts
        log_usage("predict", result.usage, n_questions=len(guide.questions), n_samples=n)
        return [self._aggregate(q, result) for q in guide.questions]

    def _aggregate(self, q: GuideQuestion, result: SampleResult) -> TwinPrediction:
        raw = [a for a in result.answers.get(q.id, []) if a is not None]
        if q.type is QuestionType.single_choice:
            raw = [a for a in raw if str(a) in (q.options or [])]
        elif q.type is QuestionType.scale:
            raw = [a for a in raw if _is_number(a) and q.scale_min <= float(a) <= q.scale_max]
        comments = [c for c in result.comments.get(q.id, []) if c]
        if not raw:
            return TwinPrediction(question_id=q.id, n_samples=len(result.answers.get(q.id, [])) or 1,
                                  predicted_answer="", confidence=0.0,
                                  rationale="The model returned no valid answer.")
        n = len(raw)
        if q.type is QuestionType.single_choice:
            counts = Counter(str(a) for a in raw)
            dist = {opt: counts.get(opt, 0) / n for opt in (q.options or [])}
            top = max(dist, key=dist.get)
            return TwinPrediction(question_id=q.id, n_samples=n, predicted_answer=top,
                                  distribution=dist, confidence=round(dist[top], 4),
                                  rationale=_first_sentence(comments) or f"{counts[top]} of {n} samples chose this option.")
        if q.type is QuestionType.scale:
            vals = [float(a) for a in raw]
            counts = Counter(int(v) for v in vals)
            dist = {str(v): counts.get(v, 0) / n for v in q.scale_values}
            mu = mean(vals)
            span = (q.scale_max - q.scale_min) or 1  # type: ignore[operator]
            # 1 when all samples agree; 0 when spread is maximal (half the range)
            confidence = max(0.0, 1 - pstdev(vals) / (span / 2))
            return TwinPrediction(question_id=q.id, n_samples=n, predicted_answer=round(mu),
                                  distribution=dist, confidence=round(confidence, 4),
                                  rationale=_first_sentence(comments) or f"Mean of {n} samples is {mu:.2f}.")
        # free text: pick the medoid (most representative sample); confidence = agreement
        texts = [str(a) for a in raw]
        if n == 1:
            return TwinPrediction(question_id=q.id, n_samples=1, predicted_answer=texts[0],
                                  confidence=0.5, rationale="Single sample; agreement unknown.")
        sims = [[self.embedder.similarity(a, b) for b in texts] for a in texts]
        avg = [(sum(row) - 1.0) / (n - 1) for row in sims]
        best = max(range(n), key=lambda i: avg[i])
        return TwinPrediction(question_id=q.id, n_samples=n, predicted_answer=texts[best],
                              confidence=round(max(0.0, min(1.0, avg[best])), 4),
                              rationale=f"Most representative of {n} samples (mean similarity {avg[best]:.2f}).")

    # ------------------------------------------------------------------ learning

    def apply_correction(self, question_id: str, actual_answer: Answer, note: str = "") -> Correction:
        """Store a real answer. Later predictions include it as a few-shot example."""
        c = Correction(question_id=question_id, actual_answer=actual_answer, note=note)
        self.corrections = [x for x in self.corrections if x.question_id != question_id] + [c]
        return c

    # ------------------------------------------------------------------ persistence

    def to_state(self) -> dict:
        return {"profile": self.profile.model_dump(),
                "corrections": [c.model_dump() for c in self.corrections]}

    @classmethod
    def from_state(cls, state: dict, **kwargs) -> "Twin":
        return build_twin(PersonProfile.model_validate(state["profile"]),
                          [Correction.model_validate(c) for c in state.get("corrections", [])], **kwargs)


def build_twin(
    profile: PersonProfile | dict,
    corrections: Sequence[Correction | dict] = (),
    *,
    engine: Optional[PredictionEngine] = None,
    embedder: Optional[Embedder] = None,
    config: Optional[TwinConfig] = None,
) -> Twin:
    """Build a twin. ``profile`` may be a dict; it is validated (forbidden fields rejected)."""
    if not isinstance(profile, PersonProfile):
        profile = PersonProfile.model_validate(profile)
    corr = [c if isinstance(c, Correction) else Correction.model_validate(c) for c in corrections]
    return Twin(profile, corr, engine=engine, embedder=embedder, config=config)


def _is_number(x) -> bool:
    try:
        float(x)
        return True
    except (TypeError, ValueError):
        return False


def _first_sentence(comments: list[str]) -> str:
    if not comments:
        return ""
    text = " ".join(comments[0].split()).lstrip("#").strip()
    for end in (". ", "! ", "? "):
        if end in text:
            return text.split(end)[0] + end.strip()
    return text[:200]
