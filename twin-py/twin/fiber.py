"""Fiber AI profile source (phase 2): LinkedIn URL -> minimal PersonProfile.

Uses quickPersonResolve (POST /v1/person-resolve, 1 credit, only charged when found).
Only the 7 PersonProfile fields are kept. Everything else Fiber returns (names, date of
birth, contact flags, photos, etc.) is discarded immediately and never logged.
"""

from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

from .models import PersonProfile

FIBER_URL = "https://api.fiber.ai/v1/person-resolve"
_LINKEDIN_RE = re.compile(r"^https?://([a-z]{2,3}\.)?linkedin\.com/in/[^/?#\s]+/?", re.I)


class ProfileNotFound(LookupError):
    pass


def _years_since(iso: Optional[str]) -> float:
    if not iso:
        return 0.0
    try:
        start = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return 0.0
    return round(max(0.0, (datetime.now(timezone.utc) - start).days / 365.25), 1)


def _education_level(edu: list[dict[str, Any]]) -> Optional[str]:
    degrees = " ".join(str(e.get("degree") or "") for e in edu).lower()
    for key, label in (("phd", "Doctorate"), ("doctor", "Doctorate"), ("mba", "MBA"), ("master", "Master's"),
                       ("m.s", "Master's"), ("bachelor", "Bachelor's"), ("b.s", "Bachelor's"), ("b.a", "Bachelor's"),
                       ("associate", "Associate"), ("diploma", "Diploma")):
        if key in degrees:
            return label
    return "University (degree not listed)" if edu else None


def profile_from_fiber_person(person: dict[str, Any]) -> PersonProfile:
    """Map a Fiber person record to the minimal profile. Pure function (tested offline)."""
    job = person.get("current_job") or next((e for e in person.get("experiences") or [] if e.get("is_current")), None) or {}
    loc = person.get("inferred_location") or {}
    region = ", ".join(x for x in (loc.get("state_name"), loc.get("country_name")) if x) or "Unknown"
    skills = [str(s.get("name") if isinstance(s, dict) else s) for s in (person.get("skills") or [])][:10]
    return PersonProfile(
        role_title=str(job.get("title") or person.get("headline") or "Professional")[:120],
        seniority=str(job.get("seniority") or "Unknown"),
        industry=str(job.get("industry") or person.get("industry_name") or job.get("job_function_v2") or "Unknown"),
        tenure_years=min(60.0, _years_since(job.get("start_date"))),
        region=region,
        education_level=_education_level(person.get("education") or []),
        skills=[s for s in skills if s and s != "None"],
    )


class FiberProfileSource:
    """ProfileSource backed by Fiber AI. ``ref`` is a LinkedIn profile URL."""

    def __init__(self, api_key: Optional[str] = None, timeout: float = 30.0) -> None:
        self.api_key = api_key or os.environ.get("FIBER_API_KEY")
        if not self.api_key:
            raise RuntimeError("FIBER_API_KEY is not set")
        self.timeout = timeout

    def get_profile(self, ref: str) -> PersonProfile:
        url = ref.strip()
        if not _LINKEDIN_RE.match(url):
            raise ValueError("expected a LinkedIn profile URL (https://www.linkedin.com/in/...)")
        r = httpx.post(FIBER_URL, timeout=self.timeout,
                       json={"apiKey": self.api_key, "people": [{"identifier": "linkedinUrl", "value": url}]})
        if r.status_code == 402:
            raise RuntimeError("Fiber AI: out of credits")
        r.raise_for_status()
        items = (r.json().get("output") or {}).get("data") or []
        if not items or not items[0].get("found") or not items[0].get("person"):
            raise ProfileNotFound("no Fiber AI match for that LinkedIn URL")
        return profile_from_fiber_person(items[0]["person"])
