import pytest
from pydantic import ValidationError

from twin import ForbiddenFieldError, InterviewGuide, PersonProfile, build_twin
from twin.models import FORBIDDEN_PROFILE_FIELDS

from .conftest import PROFILE_FILES, load_json

BASE = load_json("profile_a.json")


@pytest.mark.parametrize("name", PROFILE_FILES)
def test_fixture_profiles_are_valid(name):
    PersonProfile.model_validate(load_json(name))


def test_forbidden_fixture_rejected():
    with pytest.raises(ValidationError, match="forbidden field"):
        build_twin(load_json("profile_forbidden.json"))


@pytest.mark.parametrize("field", sorted(FORBIDDEN_PROFILE_FIELDS) + ["Family-Status", "familyStatus", "EMAIL"])
def test_each_forbidden_field_rejected(field):
    with pytest.raises(ValidationError):
        PersonProfile.model_validate({**BASE, field: "x"})


def test_forbidden_error_type_is_exposed():
    with pytest.raises(ValidationError) as e:
        PersonProfile.model_validate({**BASE, "gender": "x"})
    assert "ForbiddenFieldError" in repr(e.value.errors()[0].get("ctx", {})) or "forbidden" in str(e.value)
    assert issubclass(ForbiddenFieldError, ValueError)


@pytest.mark.parametrize("smuggled", ["reach me at jo@example.com", "+1 (416) 555-0199"])
def test_contact_details_in_values_rejected(smuggled):
    with pytest.raises(ValidationError):
        PersonProfile.model_validate({**BASE, "skills": ["Python", smuggled]})


def test_date_ranges_are_not_mistaken_for_phones():
    PersonProfile.model_validate({**BASE, "skills": ["COBOL 2015-2020"]})


def test_unknown_fields_rejected():
    with pytest.raises(ValidationError):
        PersonProfile.model_validate({**BASE, "favourite_colour": "blue"})


def test_guide_validation():
    with pytest.raises(ValidationError):
        InterviewGuide.model_validate({"questions": [{"id": "x", "text": "?", "type": "single_choice", "options": ["only"]}]})
    with pytest.raises(ValidationError):
        InterviewGuide.model_validate({"questions": [{"id": "x", "text": "?", "type": "scale", "scale_min": 5, "scale_max": 1}]})
    with pytest.raises(ValidationError):
        InterviewGuide.model_validate({"questions": [{"id": "bad id", "text": "?", "type": "free_text"}]})
