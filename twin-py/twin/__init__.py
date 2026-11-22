"""Twin module: predict a participant's interview answers and score surprise.

Public API (everything else is internal):

    from twin import build_twin, score_surprise, calibration_report
    twin = build_twin(profile_dict)              # validates; rejects PII / protected attributes
    preds = twin.predict(guide)                   # list[TwinPrediction]
    res = score_surprise(question, pred, answer)  # SurpriseResult -> res.should_probe, res.suggested_probe
    twin.apply_correction(qid, answer, note)      # next predict() uses it as a few-shot example
"""

from .calibration import calibration_report, is_match
from .config import TwinConfig, get_config
from .embedding import Embedder, NgramEmbedder
from .engine import EDSLEngine, PredictionEngine, SampleRequest, SampleResult, StubEngine
from .models import (
    Answer, CalibrationRecord, CalibrationReport, Correction, ForbiddenFieldError, GuideQuestion,
    InterviewGuide, PersonProfile, QuestionType, SurpriseResult, TwinPrediction, Usage,
)
from .sources import JsonFileProfileSource, ProfileSource, load_guide
from .surprise import EDSLJudge, Judge, JudgeVerdict, score_surprise
from .twin import Twin, build_twin

__all__ = [
    "build_twin", "Twin", "score_surprise", "calibration_report", "is_match",
    "PersonProfile", "InterviewGuide", "GuideQuestion", "QuestionType", "TwinPrediction",
    "SurpriseResult", "Correction", "CalibrationRecord", "CalibrationReport", "Usage", "Answer",
    "ForbiddenFieldError", "TwinConfig", "get_config",
    "PredictionEngine", "EDSLEngine", "StubEngine", "SampleRequest", "SampleResult",
    "Judge", "JudgeVerdict", "EDSLJudge", "Embedder", "NgramEmbedder",
    "ProfileSource", "JsonFileProfileSource", "load_guide",
]
