# Oarlock — Architecture, contracts, ownership

## Pages (routes)
| Route | Page | Lane |
| --- | --- | --- |
| `/` | Landing: "Take a practice OA" (2 problem cards) + "For companies" | 04 |
| `/take/:assessmentId` | Start screen → workspace (editor + assistant + interviewer + timer) | 01 (layout), 02 + 03 (components) |
| `/report/:sessionId` | Report | 04 |
| `/company` | Assessments list + create (P1) | 04 |
| `/company/:assessmentId` | Ranked candidates (P1) | 04 |
Check Wasp docs for route params syntax.

## Shared types — `src/shared/types.ts`
```ts
export type AiPolicy = "full" | "no_solutions" | "hints";
export type TestCase = { name: string; args: unknown[]; expected: unknown };
export type Problem = { id: string; title: string; statementMd: string; functionName: string; starterCode: string; visibleTests: TestCase[]; hiddenTests: TestCase[] };
export type Assessment = { id: string; title: string; company: string; problemId: string; aiPolicy: AiPolicy; durationMin: number; voice: boolean; practice: boolean };
export type TestResult = { passed: number; total: number; failures: { name: string; message: string }[]; ms: number; hidden: boolean };
export type TimelineKind =
  | "session_start" | "code" | "prompt" | "ai_reply" | "insert" | "paste"
  | "test_run" | "submit" | "interviewer_said" | "candidate_said" | "flag" | "session_end";
export type TimelineEvent = { id?: number; sessionId: string; at: string; kind: TimelineKind; data: Record<string, unknown> };
// data shapes: code {code}  prompt {text}  ai_reply {text, codeBlocks: string[]}  insert {code}  paste {text, fromAi: boolean}
// test_run {result: TestResult}  submit {code, result: TestResult}  interviewer_said/candidate_said {text}  flag {note, severity: "positive"|"concern"}
export type Session = { id: string; assessmentId: string; candidateName: string; startedAt: string; endedAt?: string; finalCode?: string; reportReady: boolean };
export type Metrics = {
  durationMin: number; finalPassRate: number; hiddenPassRate: number; timeToFirstPassMin: number | null;
  promptCount: number; avgPromptWords: number; aiCodeShare: number; insertsCount: number;
  testRunsTotal: number; testRunsAfterInsertRate: number; // share of inserts followed by a test run within 2 min
  interviewerQuestions: number; candidateTurns: number; flagsPositive: number; flagsConcern: number;
};
export type Report = {
  sessionId: string; generatedAt: string;
  scores: { problemSolving: number; aiUsage: number; codeQuality: number; communication: number }; // 1–5
  overall: number; // 1–5, one decimal
  recommendation: "strong_yes" | "yes" | "lean_no" | "no";
  summary: string; strengths: string[]; concerns: string[];
  evidence: { at: string; quote: string; why: string }[];
  aiUsageNotes: string[]; metrics: Metrics;
};
```

## Server endpoints
| Endpoint | Body → Response | Lane |
| --- | --- | --- |
| `GET /api/assessments` | → `Assessment[]` | 04 |
| `POST /api/assessments` | `Omit<Assessment,"id">` → `Assessment` | 04 |
| `GET /api/assessments/:id` | → `{assessment, problem: Omit<Problem,"hiddenTests">}` | 04 |
| `POST /api/sessions` | `{assessmentId, candidateName}` → `Session` | 04 |
| `POST /api/sessions/:id/events` | `TimelineEvent[]` → `{ok}` | 04 |
| `POST /api/sessions/:id/submit` | `{code}` → `{result: TestResult}` (server runs hidden tests in `node:vm` with 2 s timeout) then starts report generation | 04 |
| `GET /api/sessions/:id` | → `{session, assessment, events, report?}` | 04 |
| `GET /api/assessments/:id/sessions` | → `{session, report?}[]` ranked | 04 |
| `POST /api/assist` | `{sessionId, policy, problemId, code, messages:[{role,content}]}` → `{text}` | 02 |
Store: in-memory maps persisted to `data/db.json` (debounced write). Problems live in `src/shared/problems.ts` (hidden tests stripped before sending to the client).

## Client module contracts (stubs from the scaffold)
```ts
// src/client/timeline/bus.ts            (lane 01)
export function initTimeline(sessionId: string): void;          // batches POSTs every 2 s
export function log(kind: TimelineKind, data: Record<string, unknown>): void;
export function subscribe(fn: (e: TimelineEvent) => void): () => void; // live, in-browser
export function getCode(): string;                               // latest editor content
export function recent(n?: number): TimelineEvent[];

// src/client/workspace/runner.ts        (lane 01)
export function runTests(code: string, problem: { functionName: string }, tests: TestCase[]): Promise<TestResult>; // Web Worker, 2 s timeout

// src/client/assistant/AssistantPanel.tsx   (lane 02)
export function AssistantPanel(props: { sessionId: string; policy: AiPolicy; problemId: string; onInsert: (code: string) => void }): JSX.Element;
// src/shared/aiShare.ts                 (lane 02, used by lane 04's metrics)
export function aiCodeShare(finalCode: string, aiCodeBlocks: string[]): number; // 0..1

// src/client/voice/InterviewerWidget.tsx    (lane 03)
export function InterviewerWidget(props: { sessionId: string; assessment: Assessment; problem: Omit<Problem,"hiddenTests">; candidateName: string; minutesLeft: () => number; onEnd?: () => void }): JSX.Element;
```

## Ownership
| Lane | Owns |
| --- | --- |
| 00 scaffold | `main.wasp.ts` (first), `src/shared/types.ts`, stubs, env examples |
| 01 workspace | `src/client/pages/TakePage.tsx`, `src/client/workspace/**`, `src/client/timeline/**`, `src/shared/problems.ts`, `src/client/workspace/runner.worker.ts` |
| 02 assistant | `src/client/assistant/**`, `src/server/assist.ts`, `src/shared/aiShare.ts` |
| 03 voice | `src/client/voice/**`, ElevenLabs agent config (keep `docs/VOICE_INTERVIEWER.md` in sync) |
| 04 report+dash | `src/server/store.ts`, `src/server/sessions.ts`, `src/server/assessments.ts`, `src/server/metrics.ts`, `src/server/report.ts`, `src/server/grader.ts`, `src/client/pages/{Landing,Report,Company,AssessmentSessions}Page.tsx`, deploy, demo, merges |
Appending your own api/route to `main.wasp.ts` is allowed (say so in the commit).

## Schedule
12:35 scaffold pushed · 13:20 merge 1 (04 → 01 → 02 → 03) · **13:45 gate** · strangers 13:45–14:15 · 14:15 freeze + video · 14:55 submit.
