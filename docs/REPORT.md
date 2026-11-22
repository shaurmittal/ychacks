# Report

Generated on submit or time-up, asynchronously (report page polls until `reportReady`). Target < 30 s.

## Metrics (code, `src/server/metrics.ts`) — never asked to the LLM
- `durationMin`, `finalPassRate` (visible), `hiddenPassRate` (from submit), `timeToFirstPassMin` (first test_run with all visible passing).
- `promptCount`, `avgPromptWords`.
- `aiCodeShare` = `aiCodeShare(finalCode, all ai_reply codeBlocks)`.
- `insertsCount` (insert + AI-sourced paste), `testRunsTotal`, `testRunsAfterInsertRate` (inserts followed by a test_run within 2 min ÷ inserts).
- `interviewerQuestions` (interviewer_said lines ending in "?"), `candidateTurns`, flags by severity.

## Report LLM (`src/server/report.ts`, `claude-sonnet-5-5`, temperature 0.2, JSON only, 60 s timeout)
Input: problem statement, AI policy, metrics JSON, final code, hidden-test summary, and a compact timeline (one line per event: `mm:ss kind: short text`; code snapshots summarised as line counts except the final code; cap ~12k tokens).

System:
```
You are a fair, evidence-driven hiring panel reviewing an AI-assisted coding assessment. Candidates were allowed to use an AI assistant. Judge how effectively they built with AI, not whether they used it.
Rubric (1–5 each):
- problemSolving: correct, complete solution; handles edge cases; sensible approach.
- aiUsage: precise prompts with context; verifies AI output (tests after inserting, questions it); understands accepted code (can explain it to the interviewer); catches AI mistakes; doesn't over-rely (high aiCodeShare is fine only if verified and understood).
- codeQuality: readable, idiomatic, no dead code.
- communication: clear answers to the interviewer, thinks out loud, honest about uncertainty.
Every strength and concern must be backed by evidence with a timestamp (mm:ss) and a short quote from the timeline. Don't invent events. Recommendation from overall: ≥ 4.3 strong_yes, ≥ 3.5 yes, ≥ 2.7 lean_no, else no.
Output JSON matching the Report schema without metrics (the server adds them).
```
Schema = `Report` in `src/shared/types.ts`. Validate; on failure retry once with "Return valid JSON only."

## Report page
Header: candidate, assessment, overall score (big), recommendation chip (practice: "Interview-ready / Almost there / Keep practising"), 4 score bars. Then summary, strengths, concerns, **AI usage** section (metrics as tiles + notes), evidence list with timestamps (click → highlights the timeline item), final code (read-only Monaco), timeline (P1 replay).
