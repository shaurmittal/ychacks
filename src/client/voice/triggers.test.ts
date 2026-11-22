import { describe, expect, it } from "vitest";
import type { TimelineEvent, TimelineKind } from "../../shared/types";
import { EVENT_PREFIX } from "./format";
import { InterviewerBrain, QUESTION_GAP_MS } from "./triggers";

function setup(opts: { minutes?: number } = {}) {
  let t = 1_000_000;
  let minutes = opts.minutes ?? 15;
  let speaking = false;
  const ctx: string[] = [];
  const trig: string[] = [];
  const closing: string[] = [];
  const code = { v: "function f(){}" };
  const brain = new InterviewerBrain({
    now: () => t,
    sendContext: (s) => ctx.push(s),
    sendTrigger: (s) => trig.push(s),
    getCode: () => code.v,
    minutesLeft: () => minutes,
    agentSpeaking: () => speaking,
    onClosing: (r) => closing.push(r),
  });
  const ev = (kind: TimelineKind, data: Record<string, unknown>): TimelineEvent => ({ sessionId: "s", at: new Date(t).toISOString(), kind, data });
  return {
    brain, ctx, trig, closing, code,
    advance(ms: number) { for (let i = 0; i < ms; i += 2000) { t += 2000; brain.tick(); } },
    emit(kind: TimelineKind, data: Record<string, unknown>) { brain.handleEvent(ev(kind, data)); },
    setMinutes(m: number) { minutes = m; },
    setSpeaking(s: boolean) { speaking = s; },
  };
}
const fail = { passed: 2, total: 4, failures: [{ name: "back-to-back", message: "expected x" }], ms: 3, hidden: false };

describe("InterviewerBrain", () => {
  it("asks about an untested AI insert after a short delay, with the real code", () => {
    const s = setup();
    s.emit("insert", { code: "return bookings.sort()" });
    expect(s.ctx.some((c) => c.includes("bookings.sort()"))).toBe(true);
    s.advance(10_000);
    expect(s.trig).toHaveLength(0);
    s.advance(6_000);
    expect(s.trig).toHaveLength(1);
    expect(s.trig[0].startsWith(EVENT_PREFIX)).toBe(true);
    expect(s.trig[0]).toContain("bookings.sort()");
    expect(s.trig[0]).toContain("NOT run the tests");
  });

  it("asks for an explanation instead when they tested after inserting", () => {
    const s = setup();
    s.emit("insert", { code: "x" });
    s.emit("test_run", { result: { ...fail, passed: 4, failures: [] } });
    s.advance(16_000);
    expect(s.trig[0]).toContain("ran the tests after inserting");
  });

  it("throttles triggers and waits while the agent speaks or the candidate talks", () => {
    const s = setup();
    s.emit("insert", { code: "a" });
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
  });

  it("checks in after 2 minutes of silence, once", () => {
    const s = setup();
    s.advance(118_000);
    expect(s.trig).toHaveLength(0);
    s.advance(4_000);
    expect(s.trig).toHaveLength(1);
    expect(s.trig[0]).toContain("quiet");
    s.advance(60_000);
    expect(s.trig).toHaveLength(1);
  });

  it("warns at 5 minutes and closes on submit, bypassing the throttle", () => {
    const s = setup();
    s.emit("insert", { code: "a" });
    s.advance(16_000);
    s.setMinutes(5);
    s.advance(2_000);
    expect(s.trig.at(-1)).toContain("time warning");
    s.emit("submit", { code: "a", result: fail });
    s.advance(2_000);
    expect(s.trig.at(-1)).toContain("Close the interview");
    expect(s.closing).toEqual(["submit"]);
    s.emit("insert", { code: "b" });
    s.advance(30_000);
    expect(s.trig.at(-1)).toContain("Close the interview");
  });

  it("closes when time is up", () => {
    const s = setup();
    s.setMinutes(0);
    s.advance(2_000);
    expect(s.closing).toEqual(["time"]);
    expect(s.trig[0]).toContain("Time is up");
  });

  it("sends code snapshots at most once a minute and only when changed", () => {
    const s = setup();
    s.advance(2_000);
    const snaps = () => s.ctx.filter((c) => c.startsWith("Code snapshot")).length;
    expect(snaps()).toBe(1);
    s.code.v = "changed";
    s.advance(30_000);
    expect(snaps()).toBe(1);
    s.advance(32_000);
    expect(snaps()).toBe(2);
    s.advance(62_000);
    expect(snaps()).toBe(2);
  });
});
