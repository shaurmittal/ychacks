export type AiPolicy = "full" | "no_solutions" | "hints";
export type TestCase = { name: string; args: unknown[]; expected: unknown };
export type Problem = { id: string; title: string; statementMd: string; functionName: string; starterCode: string; visibleTests: TestCase[]; hiddenTests: TestCase[] };
export type Assessment = { id: string; title: string; company: string; problemId: string; aiPolicy: AiPolicy; durationMin: number; voice: boolean; practice: boolean };
export type TestResult = { passed: number; total: number; failures: { name: string; message: string }[]; ms: number; hidden: boolean };
export type TimelineKind =
  | "session_start" | "code" | "prompt" | "ai_reply" | "insert" | "paste"
  | "test_run" | "submit" | "interviewer_said" | "candidate_said" | "flag" | "session_end"
  | "interviewer_trigger";
export type TimelineEvent = { id?: number; sessionId: string; at: string; kind: TimelineKind; data: Record<string, unknown> };
// data shapes: code {code}  prompt {text}  ai_reply {text, codeBlocks: string[]}  insert {code}  paste {text, fromAi: boolean}
// test_run {result: TestResult}  submit {code, result: TestResult}  interviewer_said/candidate_said {text}  flag {note, severity: "positive"|"concern"}
// interviewer_trigger {reason: "insert"|"fails"|"code"|"warn5"|"close", summary} (why the voice interviewer was prompted to speak)
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
