# Lane 04 — Server store, sessions, grader, metrics, report, pages, merges

**Own:** `src/server/{store,sessions,assessments,metrics,report,grader}.ts`, `src/client/pages/{Landing,Report,Company,AssessmentSessions}Page.tsx`, deploy, demo, merges.
**Read:** `docs/ARCHITECTURE.md` (endpoints), `docs/REPORT.md`, `docs/PROBLEMS.md` (grader rules), `docs/SPEC.md`, `docs/DEMO.md`, `docs/SETUP.md`.

## Deliver (in this order)
1. **Store:** in-memory maps (assessments, sessions, events per session, reports), persisted to `data/db.json` with a debounced write; create `data/` if it's missing. Seed **one practice assessment per problem** (stable IDs, e.g. `practice-mergeBookings`, `practice-rateLimiter`; policy `full`, 15 min, voice on, practice true).
2. **Endpoints** already wired in `main.wasp.ts` (replace the 501 stubs, keep the export names). `GET /api/assessments/:id` strips hidden tests via `publicProblem`.
3. **Grader:** hidden + visible tests in `node:vm`, `timeout: 2000`, deep equal; failures say only "hidden test N failed". Submit returns `{result}` straight away, then starts report generation asynchronously.
4. **Metrics** (`metrics.ts`) computed in code per REPORT.md; use `aiCodeShare` from `src/shared/aiShare.ts`.
5. **Report** (`report.ts`): Sonnet (`process.env.REPORT_MODEL ?? "claude-sonnet-5-5"`), temperature 0.2, compact timeline input, validate, retry once. Set `reportReady`.
6. **Pages:** Landing (2 practice problem cards → `/take/practice-…`, plus "For companies"), Report (polls `GET /api/sessions/:id` until ready; layout per REPORT.md; practice wording "Interview-ready / Almost there / Keep practising"), then P1 Company + ranked list.

`src/shared/problems.ts` (lane 01) is empty until lane 01 pushes it; code against `getProblem`. Never fake data: no hardcoded reports.

## Merges
At **13:20** merge into `main` in the order 04 → 01 → 02 → 03 (fetch each lane's pushed branch), fix any conflicts, check that `wasp start` boots and the take flow works end to end, then push `main`. Do the same for later merges.
