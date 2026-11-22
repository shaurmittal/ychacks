// Lane 04 owns this file. Metrics computed in code from the real timeline (never by the LLM).
import type { Metrics, Session, TestResult, TimelineEvent } from "../shared/types";
import { aiCodeShare } from "../shared/aiShare";
import type { Submission } from "./store";
import { isQuestion } from "../shared/interviewLog";

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const ms = (iso: string) => new Date(iso).getTime();
const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
const str = (v: unknown) => (typeof v === "string" ? v : "");

function asResult(v: unknown): TestResult | null {
  const r = v as TestResult | undefined;
  return r && typeof r.passed === "number" && typeof r.total === "number" ? r : null;
}

/** Latest code the candidate had: submission > last submit/code/insert snapshot. */
export function finalCodeOf(events: TimelineEvent[], session: Session, sub?: Submission): string {
  if (sub?.code) return sub.code;
  if (session.finalCode) return session.finalCode;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if ((e.kind === "submit" || e.kind === "code") && typeof e.data.code === "string") return e.data.code;
  }
  return "";
}

export function computeMetrics(session: Session, events: TimelineEvent[], sub?: Submission): Metrics {
  const start = ms(session.startedAt);
  const endIso = session.endedAt ?? sub?.at ?? events[events.length - 1]?.at ?? session.startedAt;
  const minutesFromStart = (iso: string) => (ms(iso) - start) / 60000;

  const prompts = events.filter((e) => e.kind === "prompt");
  const aiBlocks = events
    .filter((e) => e.kind === "ai_reply")
    .flatMap((e) => (Array.isArray(e.data.codeBlocks) ? (e.data.codeBlocks as unknown[]).filter((b): b is string => typeof b === "string") : []));
  const inserts = events.filter((e) => e.kind === "insert" || (e.kind === "paste" && e.data.fromAi === true));
  const testRuns = events.filter((e) => e.kind === "test_run");

  const firstPass = testRuns.find((e) => {
    const r = asResult(e.data.result);
    return r && r.total > 0 && r.passed === r.total;
  });

  // Visible pass rate at the end: from the server-graded submission if present, else the last test run.
  let finalPassRate = 0;
  if (sub && sub.visible.total > 0) finalPassRate = sub.visible.passed / sub.visible.total;
  else {
    const last = asResult(testRuns[testRuns.length - 1]?.data.result);
    if (last && last.total > 0) finalPassRate = last.passed / last.total;
  }
  const hiddenPassRate = sub && sub.hidden.total > 0 ? sub.hidden.passed / sub.hidden.total : 0;

  const verified = inserts.filter((ins) =>
    testRuns.some((t) => ms(t.at) >= ms(ins.at) && ms(t.at) - ms(ins.at) <= 2 * 60000),
  ).length;

  const interviewer = events.filter((e) => e.kind === "interviewer_said");
  const flags = events.filter((e) => e.kind === "flag");

  return {
    durationMin: round(Math.max(0, minutesFromStart(endIso)), 1),
    finalPassRate: round(finalPassRate),
    hiddenPassRate: round(hiddenPassRate),
    timeToFirstPassMin: firstPass ? round(minutesFromStart(firstPass.at), 1) : null,
    promptCount: prompts.length,
    avgPromptWords: prompts.length ? round(prompts.reduce((s, e) => s + words(str(e.data.text)), 0) / prompts.length, 1) : 0,
    aiCodeShare: round(aiCodeShare(finalCodeOf(events, session, sub), aiBlocks)),
    insertsCount: inserts.length,
    testRunsTotal: testRuns.length,
    testRunsAfterInsertRate: inserts.length ? round(verified / inserts.length) : 0,
    interviewerQuestions: interviewer.filter((e) => isQuestion(str(e.data.text))).length, // same rule as the interview log
    candidateTurns: events.filter((e) => e.kind === "candidate_said").length,
    flagsPositive: flags.filter((e) => e.data.severity === "positive").length,
    flagsConcern: flags.filter((e) => e.data.severity === "concern").length,
  };
}
