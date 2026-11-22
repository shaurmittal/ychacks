"""Surprise scoring: how far a real answer is from the twin's prediction.

The score only decides whether the interviewer asks a follow-up. It never judges
or rates the participant.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Protocol, runtime_checkable

from .config import TwinConfig, get_config
from .costlog import log_usage
from .embedding import Embedder, default_embedder
from .models import Answer, GuideQuestion, QuestionType, SurpriseKind, SurpriseResult, TwinPrediction, Usage

JUDGE_KINDS: tuple[SurpriseKind, ...] = ("match", "emphasis_shift", "novel_info", "contradiction")


@dataclass
class JudgeVerdict:
    kind: SurpriseKind
    suggested_probe: Optional[str] = None
    usage: Optional[Usage] = None


@runtime_checkable
class Judge(Protocol):
    def judge(self, question: GuideQuestion, predicted: str, actual: str) -> JudgeVerdict: ...


class EDSLJudge:
    """LLM judge via EDSL: one multiple-choice call for the kind, one free-text call for the probe."""

    def __init__(self, model: Optional[str] = None, *, config: Optional[TwinConfig] = None, **engine_kwargs) -> None:
        from .engine import EDSLEngine

        self.config = config or get_config()
        self.engine = EDSLEngine(model or self.config.judge_model, config=self.config, **engine_kwargs)

    def judge(self, question: GuideQuestion, predicted: str, actual: str) -> JudgeVerdict:
        from edsl import QuestionFreeText, QuestionMultipleChoice, Scenario, Survey

        from .engine import _usage_from_results
        from .twin import PROMPTS_DIR

        scenario = Scenario({"question_text": question.text, "predicted": predicted, "actual": actual})
        kind_q = QuestionMultipleChoice(question_name="kind", question_text=(PROMPTS_DIR / "judge_kind.txt").read_text(),
                                        question_options=list(JUDGE_KINDS))
        probe_q = QuestionFreeText(question_name="probe", question_text=(PROMPTS_DIR / "judge_probe.txt").read_text())
        # One job for both questions: each remote job carries ~40 s of queueing.
        results = self.engine.run_survey(Survey([kind_q, probe_q]), scenario=scenario)
        kind = results.select("answer.kind").to_list()[0]
        usage = _usage_from_results(results, ["kind", "probe"], self.engine.model_name)
        if kind not in JUDGE_KINDS:
            kind = "novel_info"  # unparseable verdict: be curious rather than skip
        probe = None if kind == "match" else ((results.select("answer.probe").to_list()[0] or "").strip() or None)
        return JudgeVerdict(kind=kind, suggested_probe=probe, usage=usage)


def _kind_for_score(score: float, cfg: TwinConfig) -> SurpriseKind:
    if score < cfg.match_below:
        return "match"
    if score >= cfg.contradiction_at:
        return "contradiction"
    return "emphasis_shift"


def _rule_probe(question: GuideQuestion, actual: Answer) -> str:
    from .twin import load_prompt

    return load_prompt("rule_probe.txt").substitute(actual=actual).strip()


def score_surprise(
    question: GuideQuestion,
    prediction: TwinPrediction,
    actual_answer: Answer,
    *,
    judge: Optional[Judge] = None,
    embedder: Optional[Embedder] = None,
    config: Optional[TwinConfig] = None,
) -> SurpriseResult:
    """Compare a real answer with the prediction.

    single_choice: 1 - P(actual option).  scale: |actual - mean| / range.
    free_text: embedding similarity; LLM judge only when similarity is below the threshold.
    The judge is created lazily (EDSLJudge) only if it is actually needed.
    """
    cfg = config or get_config()
    if prediction.question_id != question.id:
        raise ValueError(f"prediction is for {prediction.question_id}, question is {question.id}")

    if question.type is QuestionType.single_choice:
        dist = prediction.distribution or {str(prediction.predicted_answer): 1.0}
        score = 1.0 - dist.get(str(actual_answer), 0.0)
        return _rule_result(question, actual_answer, score, cfg)

    if question.type is QuestionType.scale:
        actual = float(actual_answer)
        if prediction.distribution:
            mu = sum(float(k) * p for k, p in prediction.distribution.items())
        else:
            mu = float(prediction.predicted_answer)
        span = float(question.scale_max - question.scale_min)  # type: ignore[operator]
        score = min(1.0, abs(actual - mu) / span)
        return _rule_result(question, actual_answer, score, cfg)

    # free text
    ft = cfg.free_text
    emb = embedder or default_embedder()
    predicted, actual = str(prediction.predicted_answer), str(actual_answer)
    sim = emb.similarity(predicted, actual)
    if sim >= ft.judge_below_similarity:
        score = round(max(0.0, min(1.0, 1.0 - sim)), 4)
        kind = _kind_for_score(score, cfg)
        probe = _rule_probe(question, actual_answer) if score >= cfg.probe_at else None
        return SurpriseResult(question_id=question.id, score=score, kind=kind,
                              suggested_probe=probe, judged_by="embedding")
    judge = judge or EDSLJudge(config=cfg)
    verdict = judge.judge(question, predicted, actual)
    if verdict.usage is not None:
        log_usage("judge", verdict.usage, n_questions=1)
    score = {"match": ft.score_match, "emphasis_shift": ft.score_emphasis_shift,
             "novel_info": ft.score_novel_info, "contradiction": ft.score_contradiction}[verdict.kind]
    probe = verdict.suggested_probe if score >= cfg.probe_at else None
    if score >= cfg.probe_at and not probe:
        probe = _rule_probe(question, actual_answer)
    return SurpriseResult(question_id=question.id, score=score, kind=verdict.kind,
                          suggested_probe=probe, judged_by="llm")


def _rule_result(question: GuideQuestion, actual: Answer, score: float, cfg: TwinConfig) -> SurpriseResult:
    score = round(max(0.0, min(1.0, score)), 4)
    probe = _rule_probe(question, actual) if score >= cfg.probe_at else None
    return SurpriseResult(question_id=question.id, score=score, kind=_kind_for_score(score, cfg),
                          suggested_probe=probe, judged_by="rule")
