from twin.__main__ import main

from .conftest import FIXTURES


def test_demo_runs_offline(capsys):
    assert main(["demo", str(FIXTURES / "profile_a.json"), str(FIXTURES / "guide.json"),
                 "--n", "2", "--offline", "--answers", str(FIXTURES / "answers_a.json")]) == 0
    out = capsys.readouterr().out
    assert "model=test" in out and "calibration" in out and "[ai_usage]" in out
