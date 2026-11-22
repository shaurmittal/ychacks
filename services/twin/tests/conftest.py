import json
import os
from pathlib import Path

# Force offline + no cost log BEFORE edsl/twin load .env (load_dotenv does not override).
os.environ["TWIN_MODEL"] = "test"
os.environ["TWIN_JUDGE_MODEL"] = "test"
os.environ["TWIN_COST_LOG"] = "off"

import pytest  # noqa: E402

from twin import InterviewGuide, PersonProfile, load_guide  # noqa: E402

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"
PROFILE_FILES = ["profile_a.json", "profile_b.json", "profile_c.json"]


def load_json(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


@pytest.fixture(scope="session")
def guide() -> InterviewGuide:
    return load_guide(FIXTURES / "guide.json")


@pytest.fixture(params=PROFILE_FILES)
def profile(request) -> PersonProfile:
    return PersonProfile.model_validate(load_json(request.param))
