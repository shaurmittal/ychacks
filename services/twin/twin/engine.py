"""Prediction engines: the only place that talks to an LLM for predictions.

``PredictionEngine`` is a small protocol, so the twin can run on EDSL (default),
on a stub in tests, or on any other backend later without touching twin logic.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional, Protocol, Sequence, runtime_checkable

from .config import TwinConfig, get_config
from .models import Answer, GuideQuestion, QuestionType, Usage


@dataclass
class SampleRequest:
    instruction: str                 # fully assembled system instruction (profile + corrections)
    questions: Sequence[GuideQuestion]
    n: int


@dataclass
class SampleResult:
    answers: dict[str, list[Optional[Answer]]]           # qid -> one answer per sample
    comments: dict[str, list[Optional[str]]] = field(default_factory=dict)
    prompts: dict[str, dict[str, str]] = field(default_factory=dict)  # qid -> {system, user}
    usage: Usage = field(default_factory=Usage)


@runtime_checkable
class PredictionEngine(Protocol):
    def sample(self, request: SampleRequest) -> SampleResult: ...


# --------------------------------------------------------------------------- EDSL


def to_edsl_question(q: GuideQuestion):
    from edsl import QuestionFreeText, QuestionLinearScale, QuestionMultipleChoice

    if q.type is QuestionType.free_text:
        return QuestionFreeText(question_name=q.id, question_text=q.text)
    if q.type is QuestionType.single_choice:
        return QuestionMultipleChoice(question_name=q.id, question_text=q.text, question_options=list(q.options or []))
    return QuestionLinearScale(question_name=q.id, question_text=q.text, question_options=q.scale_values)


def _usage_from_results(results, qids: Sequence[str], model_name: str) -> Usage:
    usage = Usage(model=model_name)
    for qid in qids:
        def col(name: str) -> list[Any]:
            try:
                return results.select(f"raw_model_response.{qid}_{name}").to_list()
            except Exception:  # column absent for some services
                return []
        cost = [c for c in col("cost") if isinstance(c, (int, float))]
        tin = [t for t in col("input_tokens") if isinstance(t, (int, float))]
        tout = [t for t in col("output_tokens") if isinstance(t, (int, float))]
        usage = usage + Usage(
            model=model_name, n_calls=len(results), input_tokens=int(sum(tin)),
            output_tokens=int(sum(tout)), cost_usd=float(sum(cost)),
        )
    return usage


class EDSLEngine:
    """Runs the guide as an EDSL survey answered by one agent, ``n`` times.

    ``canned`` makes it use EDSL's offline test model with a fixed answer per
    question id: deterministic, free, no network.
    """

    def __init__(
        self,
        model: Optional[str] = None,
        service: Optional[str] = None,
        *,
        canned: Optional[dict[str, Answer]] = None,
        config: Optional[TwinConfig] = None,
        **model_params: Any,
    ) -> None:
        self.config = config or get_config()
        self.canned = canned
        self.model_name = "test" if canned is not None else (model or self.config.model)
        self.service = service if service is not None else self.config.model_service
        self.model_params = model_params

    @property
    def offline(self) -> bool:
        return self.model_name == "test"

    def _model(self, questions: Sequence[Any]):
        from edsl import Model

        if self.offline:
            canned = dict(self.canned or {})
            for q in questions:  # EDSL questions; defaults so every answer validates
                if q.question_name not in canned:
                    opts = getattr(q, "question_options", None)
                    canned[q.question_name] = opts[len(opts) // 2] if q.question_type == "linear_scale" \
                        else opts[0] if opts else "No canned response."
            return Model("test", canned_response=canned)
        kwargs = dict(self.model_params)
        if self.service:
            kwargs["service_name"] = self.service
        return Model(self.model_name, **kwargs)

    def run_survey(self, survey, agent=None, scenario=None, n: int = 1):
        from edsl import Cache

        job = survey
        if scenario is not None:
            job = job.by(scenario)
        if agent is not None:
            job = job.by(agent)
        job = job.by(self._model(getattr(survey, "questions", [])))
        mode = "local" if self.offline else self.config.execution
        return job.run(
            n=n,
            cache=Cache(),  # fresh in-memory cache: n samples are real, independent calls
            # EDSL 1.0.9: `disable_remote_inference` (deprecated in docs) still decides
            # whether the job is offloaded; `offload_execution=False` alone is not enough.
            disable_remote_inference=mode != "offload",
            offload_execution=mode == "offload",
            use_api_proxy=mode == "proxy",
            disable_remote_cache=not (self.config.remote_cache and not self.offline),
            progress_bar=False,
            print_exceptions=False,
            verbose=False,
        )

    def sample(self, request: SampleRequest) -> SampleResult:
        from edsl import Agent, Survey

        questions = list(request.questions)
        survey = Survey([to_edsl_question(q) for q in questions])
        agent = Agent(traits={}, instruction=request.instruction)
        results = self.run_survey(survey, agent=agent, n=request.n)

        qids = [q.id for q in questions]
        out = SampleResult(answers={}, usage=_usage_from_results(results, qids, self.model_name))
        for qid in qids:
            out.answers[qid] = results.select(f"answer.{qid}").to_list()
            try:
                out.comments[qid] = results.select(f"comment.{qid}_comment").to_list()
            except Exception:
                out.comments[qid] = [None] * len(out.answers[qid])
            system = results.select(f"prompt.{qid}_system_prompt").to_list()[0]
            user = results.select(f"prompt.{qid}_user_prompt").to_list()[0]
            out.prompts[qid] = {"system": str(getattr(system, "text", system)), "user": str(getattr(user, "text", user))}
        return out


# --------------------------------------------------------------------------- stub


class StubEngine:
    """Pure-Python engine for tests and demos. ``answers[qid]`` is a list that is
    cycled to produce ``n`` samples, so you can script a distribution."""

    def __init__(self, answers: dict[str, list[Answer]]) -> None:
        self.answers = answers
        self.requests: list[SampleRequest] = []

    def sample(self, request: SampleRequest) -> SampleResult:
        self.requests.append(request)
        out = SampleResult(answers={}, usage=Usage(model="stub"))
        for q in request.questions:
            pool = self.answers.get(q.id) or ["(no answer)"]
            out.answers[q.id] = [pool[i % len(pool)] for i in range(request.n)]
            out.comments[q.id] = [None] * request.n
            out.prompts[q.id] = {"system": request.instruction, "user": q.text}
        return out
