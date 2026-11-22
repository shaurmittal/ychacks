# Lane 01 — Workspace (take flow, editor, test runner, timeline bus, problems)

**Own:** `src/client/pages/TakePage.tsx`, `src/client/workspace/**` (including `runner.worker.ts`), `src/client/timeline/**`, `src/shared/problems.ts`.
**Read:** `docs/SPEC.md` (P0 1, 2, 5), `docs/PROBLEMS.md`, `docs/ARCHITECTURE.md`.

## Deliver
1. **`src/shared/problems.ts` first** (lanes 02 and 04 depend on it): both problems from `docs/PROBLEMS.md` with statement markdown, starter code (signature + JSDoc only), 4 visible + 6 hidden tests each. Keep `problems`, `getProblem` and `publicProblem`. Commit and push this as soon as it's done.
2. **Timeline bus** (`timeline/bus.ts`): same exports as the stub. `log` stamps `at`, keeps events in memory, notifies subscribers, and batches `POST /api/sessions/:id/events` every 2 s (flush on `pagehide` too). Code snapshots: log `code {code}` debounced (~3 s after typing stops), not every keystroke.
3. **Runner** (`workspace/runner.ts` + `runner.worker.ts`): Web Worker, `new Function(code + "\nreturn " + functionName)`, deep-equal, kill the worker after 2 s → failure "timeout". `rateLimiter` tests are call scripts (see PROBLEMS.md). Vite worker import: `new Worker(new URL("./runner.worker.ts", import.meta.url), { type: "module" })`.
4. **TakePage** `/take/:assessmentId`:
   - Start screen: fetch `GET /api/assessments/:id`, then name + consent checkbox ("Your session is recorded to generate your report. Delete anytime.") + request mic permission. Then `POST /api/sessions`, `initTimeline`, log `session_start`.
   - Workspace layout: problem statement (left), Monaco editor (dark, centre) with Run tests / Submit, countdown timer (from `assessment.durationMin`), `<AssistantPanel>` on the right, and `<InterviewerWidget>` (when `assessment.voice`) in the top bar or above the assistant.
   - **Run tests** runs visible tests and logs `test_run {result}`. **Submit** POSTs `/api/sessions/:id/submit {code}`, logs `submit {code, result}` and `session_end`, flushes the timeline, then navigates to `/report/:sessionId`. Time-up auto-submits.
   - Pass `onInsert` to AssistantPanel: replace the selection or append at the cursor in Monaco, then log `insert {code}`.
   - Monaco paste: `editor.onDidPaste` → `log("paste", {text, fromAi})`. Use `aiCodeShare`-style overlap against AI code blocks seen so far on the bus (subscribe to `ai_reply`). `docs/ASSISTANT.md` describes it; the logging lives here because the editor is yours.
   - Clean, professional UI: light chrome, dark editor, clear timer (red under 5 min).

Until lane 04 merges, the API returns 501, so mock locally if you need to. Never show hidden test contents.
