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
