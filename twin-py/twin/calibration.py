"""Calibration: how often the twin's prediction matched the real answer.

Match metric (published, so "I predicted N%" is a defined number):
  single_choice  actual option == predicted option
  scale          |actual - predicted| <= scale_tolerance (default 1 point)
  free_text      surprise.kind == "match" (embedding or judge says consistent)
"""

from __future__ import annotations

from typing import Iterable, Optional

from .config import TwinConfig, get_config
from .models import CalibrationRecord, CalibrationReport, QuestionType, TypeStats


def is_match(record: CalibrationRecord, config: Optional[TwinConfig] = None) -> bool:
    cfg = config or get_config()
    pred, actual = record.prediction.predicted_answer, record.actual_answer
    if record.question_type is QuestionType.single_choice:
        return str(pred) == str(actual)
    if record.question_type is QuestionType.scale:
        return abs(float(pred) - float(actual)) <= cfg.scale_tolerance
    if record.surprise is None:
        raise ValueError(f"free_text record {record.prediction.question_id} needs a surprise result")
    return record.surprise.kind == "match"


def calibration_report(records: Iterable[CalibrationRecord | dict], config: Optional[TwinConfig] = None) -> CalibrationReport:
    recs = [r if isinstance(r, CalibrationRecord) else CalibrationRecord.model_validate(r) for r in records]
    by: dict[str, list[bool]] = {}
    for r in recs:
        by.setdefault(r.question_type.value, []).append(is_match(r, config))
    total = sum(len(v) for v in by.values())
    hits = sum(sum(v) for v in by.values())
    return CalibrationReport(
        n=total, matches=hits, match_rate=(hits / total) if total else 0.0,
        by_type={t: TypeStats(n=len(v), matches=sum(v), match_rate=sum(v) / len(v)) for t, v in sorted(by.items())},
    )
