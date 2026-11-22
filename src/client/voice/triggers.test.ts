import { describe, expect, it } from "vitest";
import type { TimelineEvent, TimelineKind } from "../../shared/types";
import { EVENT_PREFIX } from "./format";
import { InterviewerBrain, QUESTION_GAP_MS, changedLines, isTrivialLine, lineRanges, type TriggerReason } from "./triggers";

const STARTER = "/** @param {object[]} bookings */\nfunction mergeBookings(bookings) {\n  \n}";

function setup(opts: { minutes?: number; code?: string } = {}) {
  let t = 1_000_000;
  let minutes = opts.minutes ?? 15;
  let speaking = false;
  const ctx: string[] = [];
  const trig: string[] = [];
  const logged: { reason: TriggerReason; summary: string }[] = [];
  const closing: string[] = [];
  const code = { v: opts.code ?? STARTER };
  const brain = new InterviewerBrain({
    now: () => t,
    sendContext: (s) => ctx.push(s),
    sendTrigger: (s) => trig.push(s),
    logTrigger: (reason, summary) => logged.push({ reason, summary }),
    getCode: () => code.v,
    minutesLeft: () => minutes,
    agentSpeaking: () => speaking,
    onClosing: (r) => closing.push(r),
  });
  const ev = (kind: TimelineKind, data: Record<string, unknown>): TimelineEvent => ({ sessionId: "s", at: new Date(t).toISOString(), kind, data });
  return {
    brain, ctx, trig, logged, closing, code,
    advance(ms: number) { for (let i = 0; i < ms; i += 1000) { t += 1000; brain.tick(); } },
    emit(kind: TimelineKind, data: Record<string, unknown>) { brain.handleEvent(ev(kind, data)); },
    setMinutes(m: number) { minutes = m; },
    setSpeaking(s: boolean) { speaking = s; },
  };
}
const fail = { passed: 2, total: 4, failures: [{ name: "back-to-back", message: "expected x" }], ms: 3, hidden: false };
const WRITTEN = `/** @param {object[]} bookings */
function mergeBookings(bookings) {
  const valid = bookings.filter((b) => b.end > b.start);
  valid.sort((a, b) => a.start.localeCompare(b.start));
  const out = {};
  for (const b of valid) {
    (out[b.room] ||= []).push([b.start, b.end]);
  }
  return out;
}`;

describe("diff helpers", () => {
  it("finds new and changed lines, ignoring indentation", () => {
    expect(changedLines("a\nb\nc", "a\n  b\nX\nc\nd")).toEqual([3, 5]);
    expect(changedLines("", "x\ny")).toEqual([1, 2]);
  });
  it("treats braces, blanks and comments as trivial", () => {
    expect(["  }", "", "  // note", "});", "* doc"].every(isTrivialLine)).toBe(true);
    expect(isTrivialLine("return out;")).toBe(false);
  });
  it("formats line ranges", () => {
    expect(lineRanges([3, 4, 5, 9, 11, 12])).toBe("3–5, 9, 11–12");
  });
});

describe("InterviewerBrain", () => {
  it("asks about an untested AI insert after a short delay, with the real code, and logs why", () => {
    const s = setup();
    s.advance(2_000);
    s.emit("insert", { code: "return bookings.sort()" });
    expect(s.ctx.some((c) => c.includes("bookings.sort()"))).toBe(true);
    s.advance(10_000);
    expect(s.trig).toHaveLength(0);
    s.advance(6_000);
    expect(s.trig).toHaveLength(1);
    expect(s.trig[0].startsWith(EVENT_PREFIX)).toBe(true);
    expect(s.trig[0]).toContain("bookings.sort()");
    expect(s.trig[0]).toContain("NOT run the tests");
    expect(s.logged).toEqual([{ reason: "insert", summary: expect.stringContaining("not tested") }]);
  });

  it("asks for an explanation instead when they tested after inserting", () => {
    const s = setup();
    s.emit("insert", { code: "x = 1" });
    s.emit("test_run", { result: { ...fail, passed: 4, failures: [] } });
    s.advance(16_000);
    expect(s.trig[0]).toContain("ran the tests after inserting");
    expect(s.logged[0].summary).toContain("tested since");
  });

  it("never speaks just because the candidate is silent", () => {
    const s = setup();
    s.advance(10 * 60_000);
    expect(s.trig).toHaveLength(0);
  });

  it("asks about meaningful code the candidate wrote, with numbered new lines", () => {
    const s = setup();
    s.advance(2_000); // baseline = starter
    s.code.v = WRITTEN;
    s.advance(3_000);
    expect(s.trig).toHaveLength(0); // still settling (they may be mid-typing)
    s.advance(4_000);
    expect(s.trig).toHaveLength(1);
    expect(s.trig[0]).toContain("wrote new code themselves");
    expect(s.trig[0]).toMatch(/ 3\| {3}const valid = bookings\.filter/);
    expect(s.logged[0]).toEqual({ reason: "code", summary: expect.stringMatching(/^Candidate wrote new code at lines 3–7, 9/) });
    // no new code since → nothing more, however long they stay quiet
    s.advance(5 * 60_000);
    expect(s.trig).toHaveLength(1);
  });

  it("ignores trivial edits and tiny changes", () => {
    const s = setup();
    s.advance(2_000);
    s.code.v = STARTER.replace("  \n", "  // TODO\n\n  return {};\n");
    s.advance(120_000);
    expect(s.trig).toHaveLength(0);
  });

  it("a single new branch plus one more line is enough", () => {
    const s = setup();
    s.advance(2_000);
    s.code.v = STARTER.replace("  \n", "  if (!bookings.length) return {};\n  const out = {};\n");
    s.advance(10_000);
    expect(s.logged.map((l) => l.reason)).toEqual(["code"]);
  });

  it("does not interrupt while code keeps changing", () => {
    const s = setup();
    s.advance(2_000);
    for (let i = 0; i < 30; i++) { s.code.v = WRITTEN + `\n// ${i}`.repeat(i % 2); s.advance(2_000); }
    expect(s.trig).toHaveLength(0);
    s.advance(6_000);
    expect(s.trig).toHaveLength(1);
  });

  it("does not count AI-inserted lines as code the candidate wrote", () => {
    const s = setup();
    s.advance(2_000);
    s.emit("insert", { code: WRITTEN });
    s.code.v = WRITTEN;
    s.advance(16_000);
    expect(s.logged.map((l) => l.reason)).toEqual(["insert"]);
    s.advance(QUESTION_GAP_MS * 2);
    expect(s.logged.map((l) => l.reason)).toEqual(["insert"]);
  });

  it("throttles code questions and resets the baseline when the agent asks something", () => {
    const s = setup();
    s.advance(2_000);
    s.brain.noteAgentSaid("What does line 2 do?"); // baseline = starter, throttle starts
    s.code.v = WRITTEN;
    s.advance(30_000);
    expect(s.trig).toHaveLength(0); // throttled by the agent's own question
    s.advance(QUESTION_GAP_MS);
    expect(s.logged.map((l) => l.reason)).toEqual(["code"]); // new code since that question

    const t2 = setup();
    t2.advance(2_000);
    t2.code.v = WRITTEN;
    t2.brain.noteAgentSaid("Why filter first?"); // asked after the code was written → baseline includes it
    t2.advance(QUESTION_GAP_MS * 3);
    expect(t2.trig).toHaveLength(0);
  });

  it("throttles triggers and waits while the agent speaks or the candidate talks", () => {
    const s = setup();
    s.emit("insert", { code: "a = 1" });
    s.advance(16_000);
    expect(s.trig).toHaveLength(1);
    s.emit("test_run", { result: fail });
    s.emit("test_run", { result: fail });
    s.advance(10_000);
    expect(s.trig).toHaveLength(1); // throttled
    s.setSpeaking(true);
    s.advance(QUESTION_GAP_MS);
    expect(s.trig).toHaveLength(1); // agent speaking
    s.setSpeaking(false);
    s.brain.noteCandidateSpoke();
    s.advance(4_000);
    expect(s.trig).toHaveLength(1); // candidate just talked
    s.advance(6_000);
    expect(s.trig).toHaveLength(2);
    expect(s.trig[1]).toContain("2 test runs in a row");
    expect(s.logged[1]).toEqual({ reason: "fails", summary: expect.stringContaining("failing: back-to-back") });
  });

  it("warns at 5 minutes and closes on submit, bypassing the throttle", () => {
    const s = setup();
    s.emit("insert", { code: "a = 1" });
    s.advance(16_000);
    s.setMinutes(5);
    s.advance(1_000);
    expect(s.trig.at(-1)).toContain("time warning");
    s.emit("submit", { code: "a", result: fail });
    s.advance(1_000);
    expect(s.trig.at(-1)).toContain("Close the interview");
    expect(s.closing).toEqual(["submit"]);
    expect(s.logged.map((l) => l.reason)).toEqual(["insert", "warn5", "close"]);
    expect(s.logged[2].summary).toBe("Submitted (2/4 passed); closing the interview");
    s.emit("insert", { code: "b = 2" });
    s.advance(30_000);
    expect(s.trig.at(-1)).toContain("Close the interview");
  });

  it("closes when time is up", () => {
    const s = setup();
    s.setMinutes(0);
    s.advance(1_000);
    expect(s.closing).toEqual(["time"]);
    expect(s.trig[0]).toContain("Time is up");
  });

  it("sends code snapshots at most once a minute and only when changed", () => {
    const s = setup();
    s.advance(1_000);
    const snaps = () => s.ctx.filter((c) => c.startsWith("Code snapshot")).length;
    expect(snaps()).toBe(1);
    s.code.v = STARTER + "\n";
    s.advance(30_000);
    expect(snaps()).toBe(1);
    s.advance(32_000);
    expect(snaps()).toBe(2);
    s.advance(62_000);
    expect(snaps()).toBe(2);
  });
});
