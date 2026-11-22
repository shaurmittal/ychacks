import re

import pytest

from twin import EDSLEngine, StubEngine, Twin, TwinPrediction, build_twin

from .conftest import PROFILE_FILES, load_json

CANNED = {"tools_pain": "Slow builds.", "ai_usage": "Weekly", "meeting_load": 4,
          "buying_role": "Recommend", "success_metric": "I shipped.", "remote_pref": "Hybrid",
          "learning_time": 6, "change_one_thing": "Fewer meetings."}

FORBIDDEN_WORDS = re.compile(
    r"\b(name|e-?mail|phone|age|gender|sex|ethnicity|race|religion|health|family status|marital)\b", re.I)
PII_VALUES = ["Zelda", "Quigley", "zelda.quigley@example.com", "female"]


def edsl_twin(profile) -> Twin:
    return build_twin(profile, engine=EDSLEngine(canned=CANNED))


def test_predictions_validate_for_all_fixtures(profile, guide):
    twin = edsl_twin(profile)
    preds = twin.predict(guide, n_samples=3)
    assert [p.question_id for p in preds] == [q.id for q in guide.questions]
    for q, p in zip(guide.questions, preds):
        TwinPrediction.model_validate(p.model_dump())
        assert p.n_samples == 3
        assert p.predicted_answer == CANNED[q.id]
        if q.type.value == "free_text":
            assert p.distribution is None
        else:
            assert p.distribution and abs(sum(p.distribution.values()) - 1) < 1e-9


def test_test_mode_is_deterministic(guide):
    profile = load_json("profile_b.json")
    a = [p.model_dump() for p in edsl_twin(profile).predict(guide, n_samples=2)]
    b = [p.model_dump() for p in edsl_twin(profile).predict(guide, n_samples=2)]
    assert a == b


@pytest.mark.parametrize("name", PROFILE_FILES)
def test_no_pii_or_protected_attributes_in_prompts(name, guide):
    twin = edsl_twin(load_json(name))
    twin.predict(guide, n_samples=1)
    texts = [twin.instruction(guide)] + [v for p in twin.last_prompts.values() for v in p.values()]
    assert twin.last_prompts, "EDSL prompts were captured"
    for text in texts:
        assert not FORBIDDEN_WORDS.search(text), FORBIDDEN_WORDS.search(text)
        for value in PII_VALUES:
            assert value.lower() not in text.lower()


def test_correction_appears_in_next_prompt(guide):
    twin = edsl_twin(load_json("profile_a.json"))
    twin.predict(guide, n_samples=1)
    assert "Fully in office" not in twin.last_prompts["remote_pref"]["system"]
    twin.apply_correction("remote_pref", "Fully in office", note="likes the whiteboard sessions")
    twin.predict(guide, n_samples=1)
    system = twin.last_prompts["remote_pref"]["system"]
    assert "Fully in office" in system
    assert "likes the whiteboard sessions" in system
    assert "Which way of working do you prefer?" in system  # question text resolved from guide


def test_correction_replaces_earlier_one_for_same_question():
    twin = build_twin(load_json("profile_a.json"), engine=StubEngine({}))
    twin.apply_correction("q", "first")
    twin.apply_correction("q", "second")
    assert [c.actual_answer for c in twin.corrections] == ["second"]


def test_distribution_from_multiple_samples(guide):
    engine = StubEngine({"ai_usage": ["Daily", "Daily", "Daily", "Weekly"],
                         "meeting_load": [2, 4],
                         "tools_pain": ["slow builds", "slow builds and flaky tests", "slow builds"]})
    preds = {p.question_id: p for p in build_twin(load_json("profile_a.json"), engine=engine).predict(guide, n_samples=4)}
    ai = preds["ai_usage"]
    assert ai.predicted_answer == "Daily"
    assert ai.distribution == {"Never": 0, "Monthly": 0, "Weekly": 0.25, "Daily": 0.75}
    assert ai.confidence == 0.75
    ml = preds["meeting_load"]
    assert ml.predicted_answer == 3 and ml.distribution["2"] == 0.5 and ml.distribution["4"] == 0.5
    assert ml.confidence == pytest.approx(0.5)  # std 1 over half-range 2
    assert preds["tools_pain"].predicted_answer == "slow builds"


def test_state_round_trip(guide):
    twin = build_twin(load_json("profile_c.json"), engine=StubEngine({}))
    twin.apply_correction("ai_usage", "Never", "no access at work")
    clone = Twin.from_state(twin.to_state(), engine=StubEngine({}))
    assert clone.profile == twin.profile and clone.corrections == twin.corrections
    assert clone.instruction(guide) == twin.instruction(guide)


def test_invalid_samples_give_zero_confidence(guide):
    engine = StubEngine({"ai_usage": ["Sometimes"], "meeting_load": ["lots"]})
    preds = {p.question_id: p for p in build_twin(load_json("profile_a.json"), engine=engine).predict(guide, n_samples=3)}
    for qid in ("ai_usage", "meeting_load"):
        assert preds[qid].confidence == 0.0 and preds[qid].distribution is None
