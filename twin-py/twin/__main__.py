"""CLI demo:  python -m twin demo fixtures/profile_a.json fixtures/guide.json [--n 5] [--answers answers.json]

Uses TWIN_MODEL (default "test" = offline EDSL test model, free). With --answers
(a JSON object {question_id: answer}) it also scores surprise and prints a calibration report.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from . import CalibrationRecord, build_twin, calibration_report, load_guide, score_surprise
from .config import get_config


def demo(args: argparse.Namespace) -> int:
    cfg = get_config()
    if args.offline:
        os.environ["TWIN_MODEL"] = "test"
    twin = build_twin(json.loads(Path(args.profile).read_text()))
    guide = load_guide(args.guide)
    print(f"model={cfg.model} execution={'offline' if cfg.model == 'test' else cfg.execution} n={args.n}\n")
    preds = twin.predict(guide, n_samples=args.n)
    answers = json.loads(Path(args.answers).read_text()) if args.answers else {}
    records = []
    for q, p in zip(guide.questions, preds):
        print(f"[{q.id}] {q.text}")
        print(f"  predicted: {p.predicted_answer!r}  (confidence {p.confidence:.2f})")
        if p.distribution:
            print("  distribution:", {k: round(v, 2) for k, v in p.distribution.items() if v})
        print(f"  rationale: {p.rationale}")
        if q.id in answers:
            s = score_surprise(q, p, answers[q.id])
            print(f"  actual: {answers[q.id]!r} -> surprise {s.score:.2f} {s.kind} ({s.judged_by})")
            if s.suggested_probe:
                print(f"  probe: {s.suggested_probe}")
            records.append(CalibrationRecord(question_type=q.type, prediction=p, actual_answer=answers[q.id], surprise=s))
        print()
    u = twin.last_usage
    print(f"usage: {u.n_calls} calls, {u.input_tokens} in / {u.output_tokens} out tokens, ${u.cost_usd:.6f}")
    if records:
        print("calibration:", calibration_report(records).model_dump_json(indent=2))
    return 0


def main(argv: list[str] | None = None) -> int:
    from dotenv import find_dotenv, load_dotenv  # python-dotenv ships with edsl

    load_dotenv(find_dotenv(usecwd=True))
    ap = argparse.ArgumentParser(prog="python -m twin")
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("demo", help="predict a guide for one profile")
    d.add_argument("profile"); d.add_argument("guide")
    d.add_argument("--n", type=int, default=get_config().n_samples)
    d.add_argument("--answers", help="JSON {question_id: actual answer} to score surprise")
    d.add_argument("--offline", action="store_true", help="force EDSL's free offline test model")
    sv = sub.add_parser("serve", help="HTTP service for the Wasp server")
    sv.add_argument("--host", default="127.0.0.1"); sv.add_argument("--port", type=int, default=8765)
    sv.add_argument("--env-file", help="extra dotenv file to load, e.g. ../.env.server")
    args = ap.parse_args(argv)
    if args.cmd == "serve":
        if args.env_file:
            load_dotenv(args.env_file, override=True)
        from .server import serve
        serve(args.host, args.port)
        return 0
    return demo(args)


if __name__ == "__main__":
    sys.exit(main())
