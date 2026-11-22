import { describe, expect, it } from "vitest";
import type { Session, TimelineEvent } from "../shared/types";
import { computeMetrics } from "./metrics";

const t0 = Date.parse("2026-11-22T13:00:00Z");
const at = (sec: number) => new Date(t0 + sec * 1000).toISOString();
const ev = (sec: number, kind: TimelineEvent["kind"], data: Record<string, unknown> = {}): TimelineEvent => ({ sessionId: "s", at: at(sec), kind, data });
const session: Session = { id: "s", assessmentId: "a", candidateName: "T", startedAt: at(0), endedAt: at(600), reportReady: false };

describe("computeMetrics", () => {
  it("computes from the timeline", () => {
    const events = [
      ev(10, "prompt", { text: "merge intervals per room please" }),
      ev(20, "ai_reply", { text: "here", codeBlocks: ["function f(){}"] }),
      ev(30, "insert", { code: "function f(){}" }),
      ev(60, "test_run", { result: { passed: 2, total: 4, failures: [], ms: 1, hidden: false } }),
      ev(200, "insert", { code: "x" }),
      ev(400, "test_run", { result: { passed: 4, total: 4, failures: [], ms: 1, hidden: false } }),
      ev(410, "interviewer_said", { text: "Why sort first? Take your time." }),
      ev(420, "interviewer_said", { text: "Nice." }),
      ev(430, "candidate_said", { text: "Because merging needs order." }),
      ev(440, "flag", { note: "tested", severity: "positive" }),
    ];
    const sub = { at: at(600), code: "function f(){}", result: { passed: 9, total: 10, failures: [], ms: 1, hidden: true }, visible: { passed: 4, total: 4 }, hidden: { passed: 5, total: 6 } };
    const m = computeMetrics(session, events, sub);
    expect(m.durationMin).toBe(10);
    expect(m.promptCount).toBe(1);
    expect(m.avgPromptWords).toBe(5);
    expect(m.insertsCount).toBe(2);
    expect(m.testRunsTotal).toBe(2);
    expect(m.testRunsAfterInsertRate).toBe(0.5); // second insert verified 200 s later (> 2 min)
    expect(m.timeToFirstPassMin).toBe(6.7);
    expect(m.finalPassRate).toBe(1);
    expect(m.hiddenPassRate).toBe(0.83);
    expect(m.interviewerQuestions).toBe(1);
    expect(m.candidateTurns).toBe(1);
    expect(m.flagsPositive).toBe(1);
  });
});
