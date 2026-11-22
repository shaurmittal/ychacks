"""Tiny HTTP service exposing the twin to the Wasp server. Standard library only.

    python -m twin serve --port 8765

POST /predict  {profile, guide, n_samples?}            -> {predictions: [TwinPrediction], usage}
POST /score    {question, prediction, answer, judge?}  -> SurpriseResult
POST /profile  {linkedinUrl}                           -> {found, profile?}  (Fiber AI, 1 credit if found)
GET  /health                                           -> {ok, model}

`judge` is "fast" (default: embedding only, no LLM, instant) or "llm" (EDSL judge,
~40 s on Expected Parrot offload, too slow for a live voice turn).
Logs carry no request bodies (no personal data).
"""

from __future__ import annotations

import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from pydantic import ValidationError

from .config import get_config
from .embedding import default_embedder
from .models import GuideQuestion, InterviewGuide, TwinPrediction
from .surprise import JudgeVerdict, score_surprise
from .twin import build_twin


class FastJudge:
    """Instant judge for live turns: uses embedding similarity only, never an LLM.
    The voice agent's own LLM writes the actual follow-up question."""

    def __init__(self, match_similarity: float = 0.35) -> None:
        self.match_similarity = match_similarity
        self.embedder = default_embedder()

    def judge(self, question, predicted, actual):
        sim = self.embedder.similarity(predicted, actual)
        return JudgeVerdict(kind="match" if sim >= self.match_similarity else "novel_info")


def handle_predict(body: dict) -> dict:
    twin = build_twin(body["profile"])
    guide = InterviewGuide.model_validate(body["guide"])
    preds = twin.predict(guide, n_samples=body.get("n_samples"))
    return {"predictions": [p.model_dump() for p in preds], "usage": twin.last_usage.model_dump()}


def handle_score(body: dict) -> dict:
    q = GuideQuestion.model_validate(body["question"])
    p = TwinPrediction.model_validate(body["prediction"])
    judge = None if body.get("judge") == "llm" else FastJudge()
    return score_surprise(q, p, body["answer"], judge=judge).model_dump()


def handle_profile(body: dict) -> dict:
    from .fiber import FiberProfileSource, ProfileNotFound

    try:
        profile = FiberProfileSource().get_profile(str(body.get("linkedinUrl", "")))
    except ProfileNotFound as e:
        return {"found": False, "error": str(e)}
    return {"found": True, "profile": profile.model_dump()}


ROUTES = {"/predict": handle_predict, "/score": handle_score, "/profile": handle_profile}


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, payload: dict) -> None:
        data = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._send(200, {"ok": True, "model": get_config().model})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        route = ROUTES.get(self.path)
        if route is None:
            return self._send(404, {"error": "not found"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
            self._send(200, route(body))
        except (ValidationError, KeyError, ValueError, TypeError) as e:
            self._send(400, {"error": f"{type(e).__name__}: {str(e)[:300]}"})
        except Exception as e:  # model/network failure
            self._send(502, {"error": f"{type(e).__name__}: {str(e)[:300]}"})

    def log_message(self, fmt: str, *args) -> None:  # method + path + status only
        sys.stderr.write(f"[twin] {self.command} {self.path} {args[1] if len(args) > 1 else ''}\n")


def serve(host: str = "127.0.0.1", port: int = 8765) -> None:
    srv = ThreadingHTTPServer((host, port), Handler)
    print(f"twin service on http://{host}:{port} (model={get_config().model})", flush=True)
    srv.serve_forever()
