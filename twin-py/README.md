# Twin module (phase 1)

Predicts how one participant will answer an interview guide, then scores how
*surprising* each real answer is so the interviewer knows where to ask a follow-up.
Built on Expected Parrot's EDSL. The surprise score decides follow-up questions
only; it never judges or ranks the participant.

## Setup

```bash
uv venv -p 3.12 .venv            # EDSL 1.0.9 does not install on Python 3.14 (numpy build)
uv pip install -p .venv -e ".[dev]"
cp .env.example .env              # fill in EXPECTED_PARROT_API_KEY
```

## Demo

```bash
# real model, billed to Expected Parrot credits (~$0.005 for 8 questions x 5 samples)
python -m twin demo fixtures/profile_a.json fixtures/guide.json --answers fixtures/answers_a.json
# free and offline (EDSL test model)
python -m twin demo fixtures/profile_a.json fixtures/guide.json --offline
```

## Using it from other code

The whole surface is in `twin/__init__.py`. Every input and output is a pydantic
model, so it serialises with `.model_dump()` / `.model_validate()`.

```python
from twin import Twin, build_twin, score_surprise, load_guide

twin = build_twin(profile_dict)            # rejects name/email/phone/age/gender/... (ForbiddenFieldError)
guide = load_guide("fixtures/guide.json")
preds = {p.question_id: p for p in twin.predict(guide)}   # one EDSL job for the whole guide

# during the interview, per answer:
q = guide.get("ai_usage")
result = score_surprise(q, preds[q.id], "Daily")
if result.should_probe:
    ask(result.suggested_probe)

# Twin Reveal: the participant corrects the twin
twin.apply_correction("remote_pref", "Fully in office", note="likes whiteboard sessions")

# persist between sessions
state = twin.to_state()                  # {"profile": ..., "corrections": [...]}
twin = Twin.from_state(state)
```

Calibration: `calibration_report([CalibrationRecord(...), ...])` returns the overall
match rate and the rate for each question type.

### Integration points (swap without touching twin logic)

| Protocol | Default | What to plug in later |
|---|---|---|
| `PredictionEngine.sample(SampleRequest) -> SampleResult` | `EDSLEngine` | another LLM backend; `StubEngine` for tests |
| `Judge.judge(question, predicted, actual) -> JudgeVerdict` | `EDSLJudge` (created only when needed) | any LLM judge |
| `Embedder.similarity(a, b) -> float` | `NgramEmbedder` (no dependencies) | a sentence-embedding model |
| `ProfileSource.get_profile(ref) -> PersonProfile` | `JsonFileProfileSource` | Fiber AI adapter (phase 2) |

## Config

- Thresholds are in `twin/config.toml`. Point `TWIN_CONFIG` at another file, or pass `config=TwinConfig(...)`.
- Models are set by env vars: `TWIN_MODEL`, `TWIN_MODEL_SERVICE` and `TWIN_JUDGE_MODEL`.
- `TWIN_MODEL=test` means offline.
- `engine.execution` picks how jobs run. `offload` (the default) runs them on Expected Parrot servers, billed to `EXPECTED_PARROT_API_KEY`. `local` calls the model provider directly with your own provider keys.

## Surprise rules

| Type | Score | Match metric (calibration) |
|---|---|---|
| single_choice | `1 - P(actual option)` | same option |
| scale | `abs(actual - mean) / (max - min)` | within `scale_tolerance` (1) |
| free_text | `1 - embedding similarity` if similarity is at least `judge_below_similarity`; otherwise the LLM judge's `kind` maps to a score from config | the judge or embedding says `match` |

The `kind` is set by score: below `match_below` it is `match`; at or above `contradiction_at` it is `contradiction`; anything in between is `emphasis_shift`. The free-text judge can also return `novel_info`. A probe is suggested when the score is at least `probe_at`.

## Privacy

- `PersonProfile` accepts only the fields role, seniority, industry, tenure, region, education level and skills.
- Identity fields and protected attributes are rejected, as are values that look like an email address or a phone number.
- Tests check that none of these appear in any assembled prompt.
- The cost log (`logs/twin_runs.jsonl`) records model, call counts, tokens and cost only, never profile or answer text.
- Corrections are free text from the participant and go into prompts as they are. The orchestrator should only store them if the participant consented.

## Tests

```bash
.venv/bin/python -m pytest      # offline, deterministic, ~4 s
```

## Running with Overwatch (the Wasp app)

```bash
# once: Python 3.12 venv with the twin installed
uv venv -p 3.12 twin-py/.venv && uv pip install -p twin-py/.venv -e "twin-py[dev]"
# .env.server needs EXPECTED_PARROT_API_KEY, TWIN_MODEL=gpt-4.1-mini, TWIN_MODEL_SERVICE=openai, TWIN_URL=http://127.0.0.1:8765
cd twin-py && .venv/bin/python -m twin serve --port 8765 --env-file ../.env.server   # terminal 1
wasp start                                                                            # terminal 2
```

How it fits together:
1. When the candidate clicks Start, the server begins the twin brief. If they pasted a LinkedIn URL, it first runs a Fiber `/profile` lookup. Then the twin predicts answers to 3 wrap-up questions (approach, AI use, difficulty) through Expected Parrot, in about 10 s.
2. If Fiber found the profile, the interviewer opens with a one-line LinkedIn intro.
3. When the candidate submits, the interviewer brain runs a debrief. It asks each twin question in turn, the agent calls `check_answer` (`POST /api/twin/check`, then `/score`), and the agent either acknowledges the answer or asks one follow-up. Then it says goodbye. The debrief is capped at 100 s.
4. Each answer is appended to `data/twin_training.jsonl` with the minimal profile, the question, the prediction, the actual answer and the surprise score. It contains no name or URL. This is saved as research data and is not fed back into the twin.
5. `GET /api/twin/:sessionId` shows predicted vs actual answers.

The twin uses a baseline profile (a typical entry-level candidate), because Overwatch collects no profile data. Twin results are never written to the timeline, the metrics or the report. If the service is down, the interview runs as normal.
