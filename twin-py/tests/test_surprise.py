import pytest

from twin import JudgeVerdict, SurpriseResult, TwinPrediction, score_surprise

PARAPHRASE_PRED = "Waiting a long time for code reviews from other teams slows me down."
PARAPHRASE_ACTUAL = "The thing that drags is that other groups take ages to look at my pull requests."
CONTRA_ACTUAL = "Nothing slows me down; our review process is instant and I love it."


class StubJudge:
    """Deterministic judge: contradiction if the answer contains a negation cue, else match."""

    def __init__(self):
        self.calls = 0

    def judge(self, question, predicted, actual):
        self.calls += 1
        if "Nothing" in actual or "love" in actual:
            return JudgeVerdict(kind="contradiction", suggested_probe="What makes reviews so fast on your team?")
        return JudgeVerdict(kind="match")


def pred(qid, answer, dist=None):
    return TwinPrediction(question_id=qid, n_samples=5, predicted_answer=answer, distribution=dist,
                          confidence=0.8, rationale="test")


AI_DIST = {"Never": 0.0, "Monthly": 0.0, "Weekly": 0.2, "Daily": 0.8}


def test_choice_identical_is_near_zero(guide):
    q = guide.get("ai_usage")
    r = score_surprise(q, pred("ai_usage", "Daily", AI_DIST), "Daily")
    SurpriseResult.model_validate(r.model_dump())
    assert r.score == pytest.approx(0.2) and r.kind == "match" and r.judged_by == "rule"
    assert r.suggested_probe is None
    certain = {"Never": 0.0, "Monthly": 0.0, "Weekly": 0.0, "Daily": 1.0}
    assert score_surprise(q, pred("ai_usage", "Daily", certain), "Daily").score == 0.0


def test_choice_opposite_is_near_one(guide):
    r = score_surprise(guide.get("ai_usage"), pred("ai_usage", "Daily", AI_DIST), "Never")
    assert r.score == 1.0 and r.kind == "contradiction" and r.suggested_probe


def test_scale(guide):
    q = guide.get("meeting_load")  # 1..5
    dist = {"1": 0, "2": 0, "3": 0, "4": 0.5, "5": 0.5}  # mean 4.5
    assert score_surprise(q, pred(q.id, 5, dist), 4.5).score == 0.0
    assert score_surprise(q, pred(q.id, 5, dist), 1).score == pytest.approx(3.5 / 4)
    assert score_surprise(q, pred(q.id, 5, dist), 4).score == pytest.approx(0.5 / 4)


def test_free_text_identical_uses_embedding_only(guide):
    judge = StubJudge()
    q = guide.get("tools_pain")
    r = score_surprise(q, pred(q.id, PARAPHRASE_PRED), PARAPHRASE_PRED, judge=judge)
    assert r.score < 0.05 and r.kind == "match" and r.judged_by == "embedding"
    assert judge.calls == 0


def test_free_text_paraphrase_scores_low(guide):
    q = guide.get("tools_pain")
    r = score_surprise(q, pred(q.id, PARAPHRASE_PRED), PARAPHRASE_ACTUAL, judge=StubJudge())
    assert r.score < 0.35 and r.kind == "match" and r.suggested_probe is None


def test_free_text_contradiction_scores_high_with_probe(guide):
    judge = StubJudge()
    q = guide.get("tools_pain")
    r = score_surprise(q, pred(q.id, PARAPHRASE_PRED), CONTRA_ACTUAL, judge=judge)
    assert judge.calls == 1
    assert r.score >= 0.7 and r.kind == "contradiction" and r.judged_by == "llm"
    assert r.suggested_probe == "What makes reviews so fast on your team?"
    assert r.should_probe


def test_edsl_judge_runs_offline(guide):
    # No judge passed -> EDSLJudge on the offline test model (canned: first option = "match").
    q = guide.get("tools_pain")
    r = score_surprise(q, pred(q.id, PARAPHRASE_PRED), CONTRA_ACTUAL)
    assert r.judged_by == "llm" and r.kind == "match"


def test_mismatched_question_rejected(guide):
    with pytest.raises(ValueError):
        score_surprise(guide.get("ai_usage"), pred("remote_pref", "Hybrid"), "Hybrid")
