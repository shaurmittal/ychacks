import pytest

from twin import CalibrationRecord, SurpriseResult, TwinPrediction, calibration_report


def rec(qtype, predicted, actual, kind=None):
    p = TwinPrediction(question_id="q", n_samples=1, predicted_answer=predicted, confidence=1, rationale="-")
    s = SurpriseResult(question_id="q", score=0, kind=kind, judged_by="llm") if kind else None
    return CalibrationRecord(question_type=qtype, prediction=p, actual_answer=actual, surprise=s)


def test_hand_computed_example():
    records = [
        rec("single_choice", "Daily", "Daily"),        # match
        rec("single_choice", "Daily", "Weekly"),       # miss
        rec("single_choice", "Hybrid", "Hybrid"),      # match
        rec("scale", 3, 4),                             # within 1 -> match
        rec("scale", 3, 5),                             # miss
        rec("free_text", "a", "b", kind="match"),       # match
        rec("free_text", "a", "c", kind="contradiction"),  # miss
        rec("free_text", "a", "d", kind="novel_info"),  # miss
    ]
    r = calibration_report(records)
    # by hand: choice 2/3, scale 1/2, free_text 1/3 -> overall 4/8
    assert (r.n, r.matches, r.match_rate) == (8, 4, 0.5)
    assert r.by_type["single_choice"].match_rate == pytest.approx(2 / 3)
    assert r.by_type["scale"].matches == 1 and r.by_type["scale"].n == 2
    assert r.by_type["free_text"].match_rate == pytest.approx(1 / 3)


def test_free_text_without_surprise_is_an_error():
    with pytest.raises(ValueError):
        calibration_report([rec("free_text", "a", "b")])


def test_empty():
    assert calibration_report([]).match_rate == 0.0
