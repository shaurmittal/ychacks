import pytest

from twin.fiber import FiberProfileSource, profile_from_fiber_person

PERSON = {  # shape of a Fiber quickPersonResolve person (fake values)
    "name": "Should Be Dropped", "first_name": "X", "dob": "1990-01-01", "has_phone_on_file": True,
    "headline": "Engineer at Acme",
    "current_job": {"title": "Senior Software Engineer", "seniority": "Mid-Senior level", "industry": "Fintech",
                    "start_date": "2020-01-01T00:00:00.000Z", "is_current": True},
    "inferred_location": {"city": "Toronto", "state_name": "Ontario", "country_name": "Canada"},
    "education": [{"school_name": "Uni", "degree": "Bachelor of Applied Science"}],
    "skills": ["Python", {"name": "Go"}],
}


def test_mapping_keeps_only_allowed_fields():
    p = profile_from_fiber_person(PERSON)
    assert p.role_title == "Senior Software Engineer" and p.seniority == "Mid-Senior level"
    assert p.industry == "Fintech" and p.region == "Ontario, Canada"
    assert p.education_level == "Bachelor's" and p.skills == ["Python", "Go"] and p.tenure_years > 4
    dumped = str(p.model_dump())
    for leaked in ("Should Be Dropped", "1990", "Toronto", "Uni"):
        assert leaked not in dumped


def test_sparse_record_still_valid():
    p = profile_from_fiber_person({"headline": "Founder"})
    assert p.role_title == "Founder" and p.region == "Unknown" and p.tenure_years == 0


def test_rejects_non_linkedin_url():
    with pytest.raises(ValueError):
        FiberProfileSource(api_key="x").get_profile("https://example.com/me")
