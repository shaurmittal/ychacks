import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "./types";
import { buildInterviewLog, interviewLogText } from "./interviewLog";

const t0 = Date.parse("2026-11-22T13:00:00Z");
const ev = (sec: number, kind: string, data: Record<string, unknown> = {}): TimelineEvent =>
  ({ sessionId: "s", at: new Date(t0 + sec * 1000).toISOString(), kind: kind as TimelineEvent["kind"], data });
const start = new Date(t0).toISOString();

describe("buildInterviewLog", () => {
  it("groups replies and flags under the preceding interviewer turn, attaches triggers to the next turn", () => {
    const log = buildInterviewLog([
      ev(5, "interviewer_said", { text: "Hi, I'm your interviewer. Ready?" }),
      ev(9, "candidate_said", { text: "Yes." }),
      ev(60, "insert", { code: "x" }),
      ev(61, "interviewer_trigger", { reason: "insert", summary: "Inserted 30 lines of AI code" }),
      ev(64, "interviewer_said", { text: "What happens when two bookings share an end time?" }),
      ev(70, "candidate_said", { text: "They merge." }),
      ev(72, "candidate_said", { text: "Because end equals start." }),
      ev(73, "flag", { note: "Explained back-to-back merge", severity: "positive", source: "interviewer" }),
      ev(90, "interviewer_said", { text: "Good. Keep going." }),
      ev(95, "flag", { note: "not from interviewer", severity: "concern", source: "system" }),
    ], start);
    expect(log.turns).toHaveLength(3);
    expect(log.questionCount).toBe(2);
    expect(log.turns[0].trigger).toBeUndefined();
    expect(log.turns[1].trigger).toEqual({ reason: "insert", summary: "Inserted 30 lines of AI code" });
    expect(log.turns[1].t).toBe("01:04");
    expect(log.turns[1].replies.map((r) => r.text)).toEqual(["They merge.", "Because end equals start."]);
    expect(log.turns[1].flags[0]).toMatchObject({ note: "Explained back-to-back merge", severity: "positive" });
    expect(log.turns[2].trigger).toBeUndefined();
    expect(log.turns[2].flags).toHaveLength(0);
    const txt = interviewLogText(log, { candidateName: "Ada", sessionId: "s", startedAt: start });
    expect(txt).toContain("[01:04] INTERVIEWER (question): What happens when two bookings share an end time?");
    expect(txt).toContain("Why asked: AI code inserted: Inserted 30 lines of AI code");
    expect(txt).toContain("[01:13] INTERVIEWER NOTE (positive): Explained back-to-back merge");
    expect(txt).not.toContain("(no spoken reply)"); // only printed under unanswered questions
  });

  it("handles voice-off sessions and speech before the first interviewer turn", () => {
    const off = buildInterviewLog([ev(1, "prompt", { text: "hi" })], start);
    expect(off.hasVoice).toBe(false);
    expect(interviewLogText(off, { candidateName: "A", sessionId: "s", startedAt: start })).toContain("No voice interview in this session.");
    const early = buildInterviewLog([ev(1, "candidate_said", { text: "Hello?" }), ev(3, "interviewer_said", { text: "Hi!" })], start);
    expect(early.before.replies).toHaveLength(1);
    expect(early.turns[0].replies).toHaveLength(0);
  });
});
