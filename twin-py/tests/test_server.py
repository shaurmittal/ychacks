import json
import threading
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

from twin.server import Handler

from .conftest import FIXTURES, load_json


@pytest.fixture(scope="module")
def base_url():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


def post(url, body):
    req = urllib.request.Request(url, json.dumps(body).encode(), {"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def test_predict_then_score(base_url):
    guide = json.loads((FIXTURES / "guide.json").read_text())
    code, out = post(base_url + "/predict", {"profile": load_json("profile_a.json"), "guide": guide, "n_samples": 2})
    assert code == 200 and len(out["predictions"]) == 8
    pred = next(p for p in out["predictions"] if p["question_id"] == "ai_usage")
    q = next(q for q in guide["questions"] if q["id"] == "ai_usage")
    code, res = post(base_url + "/score", {"question": q, "prediction": pred, "answer": "Daily"})
    assert code == 200 and res["question_id"] == "ai_usage" and 0 <= res["score"] <= 1


def test_fast_judge_free_text_is_instant_and_probes(base_url):
    q = {"id": "approach", "type": "free_text", "text": "How will you approach it?"}
    p = {"question_id": "approach", "n_samples": 3, "predicted_answer": "Sort the intervals then merge overlapping ones.",
         "confidence": 0.8, "rationale": "-"}
    code, res = post(base_url + "/score", {"question": q, "prediction": p, "answer": "I'd brute force every pair with a hash map."})
    assert code == 200 and res["kind"] == "novel_info" and res["suggested_probe"]


def test_forbidden_profile_is_400(base_url):
    code, out = post(base_url + "/predict", {"profile": load_json("profile_forbidden.json"),
                                              "guide": json.loads((FIXTURES / "guide.json").read_text())})
    assert code == 400 and "forbidden" in out["error"]
