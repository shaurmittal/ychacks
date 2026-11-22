"""Pydantic v2 data models: the contract between the twin and the rest of the system.

Everything that crosses the module boundary is one of these models, so callers can
serialise with ``.model_dump()`` / ``.model_dump_json()`` and rebuild with
``Model.model_validate(...)``.
"""

from __future__ import annotations

import re
from enum import Enum
from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# Fields that must never reach the twin. Keys are matched case-insensitively and
# with separators ignored, so "Family-Status", "familyStatus" and "family_status"
# are all rejected.
FORBIDDEN_PROFILE_FIELDS: frozenset[str] = frozenset(
    {
        "name", "first_name", "last_name", "full_name",
        "email", "email_address",
        "phone", "phone_number", "mobile",
        "age", "date_of_birth", "dob", "birthday",
        "gender", "sex",
        "ethnicity", "race",
        "religion",
        "health", "disability",
        "family_status", "marital_status", "children",
    }
)

_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE_RE = re.compile(r"\+?\d[\d\s().-]{7,}\d")


def _looks_like_contact(text: str) -> bool:
    if _EMAIL_RE.search(text):
        return True
    # phone: a digit run with separators and at least 9 digits (so "2015-2020" passes)
    return any(sum(c.isdigit() for c in m.group()) >= 9 for m in _PHONE_RE.finditer(text))


def _norm_key(key: str) -> str:
    return re.sub(r"[^a-z]", "", key.lower())


_FORBIDDEN_NORMALISED = {_norm_key(k) for k in FORBIDDEN_PROFILE_FIELDS}


class ForbiddenFieldError(ValueError):
    """Raised when a profile contains personal or protected-attribute data."""


# --------------------------------------------------------------------------- profile


class PersonProfile(BaseModel):
    """Minimal professional profile. Contains no identity or protected attributes."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    role_title: str
    seniority: str
    # Optional so a short form (role + seniority) is enough; blank fields are left out of the prompt.
    industry: Optional[str] = None
    tenure_years: Optional[float] = Field(default=None, ge=0, le=60)
    region: Optional[str] = None
    education_level: Optional[str] = None
    skills: list[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _reject_forbidden(cls, data: Any) -> Any:
        if isinstance(data, dict):
            bad = sorted(k for k in data if _norm_key(str(k)) in _FORBIDDEN_NORMALISED)
            if bad:
                raise ForbiddenFieldError(
                    f"profile contains forbidden field(s): {', '.join(bad)}"
                )
            for key, value in data.items():
                for text in value if isinstance(value, list) else [value]:
                    if isinstance(text, str) and _looks_like_contact(text):
                        raise ForbiddenFieldError(
                            f"profile field '{key}' looks like it contains an email or phone number"
                        )
        return data


# --------------------------------------------------------------------------- guide


class QuestionType(str, Enum):
    free_text = "free_text"
    single_choice = "single_choice"
    scale = "scale"


class GuideQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")  # must be a valid EDSL question_name
    text: str
    type: QuestionType
    options: Optional[list[str]] = None
    scale_min: Optional[int] = None
    scale_max: Optional[int] = None

    @model_validator(mode="after")
    def _check_type_fields(self) -> "GuideQuestion":
        if self.type is QuestionType.single_choice:
            if not self.options or len(self.options) < 2:
                raise ValueError(f"{self.id}: single_choice needs at least 2 options")
        if self.type is QuestionType.scale:
            if self.scale_min is None or self.scale_max is None or self.scale_max <= self.scale_min:
                raise ValueError(f"{self.id}: scale needs scale_min < scale_max")
        return self

    @property
    def scale_values(self) -> list[int]:
        assert self.scale_min is not None and self.scale_max is not None
        return list(range(self.scale_min, self.scale_max + 1))


class InterviewGuide(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    questions: list[GuideQuestion] = Field(min_length=1)

    @field_validator("questions")
    @classmethod
    def _unique_ids(cls, qs: list[GuideQuestion]) -> list[GuideQuestion]:
        ids = [q.id for q in qs]
        if len(ids) != len(set(ids)):
            raise ValueError("question ids must be unique")
        return qs

    def get(self, question_id: str) -> GuideQuestion:
        for q in self.questions:
            if q.id == question_id:
                return q
        raise KeyError(question_id)


Answer = Union[str, int, float]

# --------------------------------------------------------------------------- outputs


class TwinPrediction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question_id: str
    n_samples: int = Field(ge=1)
    predicted_answer: Answer
    # option (or scale value as str) -> probability. Only for single_choice and scale.
    distribution: Optional[dict[str, float]] = None
    confidence: float = Field(ge=0, le=1)
    rationale: str

    @field_validator("distribution")
    @classmethod
    def _sums_to_one(cls, d: Optional[dict[str, float]]) -> Optional[dict[str, float]]:
        if d is not None and d and abs(sum(d.values()) - 1.0) > 1e-6:
            raise ValueError("distribution must sum to 1")
        return d


SurpriseKind = Literal["match", "novel_info", "contradiction", "emphasis_shift"]
JudgedBy = Literal["rule", "embedding", "llm"]


class SurpriseResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question_id: str
    score: float = Field(ge=0, le=1)
    kind: SurpriseKind
    suggested_probe: Optional[str] = None
    judged_by: JudgedBy

    @property
    def should_probe(self) -> bool:
        """Convenience for the orchestrator: a probe was suggested."""
        return self.suggested_probe is not None


class Correction(BaseModel):
    """A real answer the participant gave, fed back as a few-shot example."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    question_id: str
    actual_answer: Answer
    note: str = ""


class Usage(BaseModel):
    """Token and cost accounting for one engine call. Never contains personal data."""

    model: str = "unknown"
    n_calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0

    def __add__(self, other: "Usage") -> "Usage":
        return Usage(
            model=self.model if self.model == other.model else f"{self.model}+{other.model}",
            n_calls=self.n_calls + other.n_calls,
            input_tokens=self.input_tokens + other.input_tokens,
            output_tokens=self.output_tokens + other.output_tokens,
            cost_usd=self.cost_usd + other.cost_usd,
        )


class CalibrationRecord(BaseModel):
    """One (prediction, real answer) pair. ``surprise`` is required for free_text."""

    question_type: QuestionType
    prediction: TwinPrediction
    actual_answer: Answer
    surprise: Optional[SurpriseResult] = None


class TypeStats(BaseModel):
    n: int
    matches: int
    match_rate: float


class CalibrationReport(BaseModel):
    n: int
    matches: int
    match_rate: float
    by_type: dict[str, TypeStats]
