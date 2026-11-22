# Oarlock — Product spec

## One line
The first-round interviewer companies hire for the AI era: candidates code with AI, a voice interviewer probes how they use it, and the company gets an evidence-backed report.

## Why companies want it
Engineers use AI every day at work, but OAs still ban it, or allow it and learn nothing. What matters now is: do you prompt precisely, verify what the AI gives you, understand the code you accept, and catch its mistakes? Oarlock measures exactly that and saves engineers hours of first-round interviews.

## Users
- **Company** (recruiter/engineer): creates an assessment, shares a link, reads ranked reports.
- **Candidate:** takes the OA in the browser with an AI assistant and a voice interviewer.
- **Practice candidate (strangers today):** takes a practice OA and gets their own report.

## P0 (must work at 13:45)
1. **Take flow:** `/take/:assessmentId` → name + consent checkbox + mic permission → workspace.
2. **Workspace:** problem statement, Monaco editor with starter code, **Run tests** (visible tests) and **Submit** (visible + hidden), countdown timer (default 15 min practice, 25 min real).
3. **AI assistant panel** (assistant-ui) obeying the assessment's policy: `full` / `no_solutions` / `hints`. Code blocks in replies have an **Insert** button. Every prompt, reply and insert is logged.
4. **Voice interviewer** (ElevenLabs) starts with the session: greets, explains the format in 2 sentences, answers clarifying questions, **asks follow-up questions triggered by real events** (AI code inserted, repeated test failures, long silence, submit), gives a 5-minute warning, closes politely.
5. **Timeline logging** of all events to the server.
6. **Report** on submit/time-up: computed metrics + LLM scorecard with timestamped evidence; shown at `/report/:sessionId`.
7. **One seeded practice assessment per problem** (no company setup needed for the demo).

## P1
8. **Company view** `/company`: create an assessment (problem, policy, duration, voice on/off), copy link; `/company/:assessmentId`: candidates ranked by overall score.
9. **Timeline replay** on the report: scrub through code snapshots with prompts and questions marked.
10. Practice reports show "readiness" wording instead of a hire recommendation.

## P2 (pitch only)
Other languages, proctoring, ATS integrations, custom rubrics, team-calibrated scoring.

## Cut order if behind
Timeline replay → company create screen (use seeded assessments) → ranked list. Never cut voice questions, logging or the report.

## Success metrics for judges
Number of real students who completed an OA today · reports generated · example report with timestamped evidence · one ranked list.
