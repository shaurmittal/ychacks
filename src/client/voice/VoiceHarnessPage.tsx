// Lane 03: dev-only harness at /dev/voice to exercise the interviewer without the full workspace.
// It emits REAL timeline events through the bus (same as the workspace would); nothing here is shown to candidates.
import { useMemo, useRef, useState } from "react";
import type { Assessment, Problem, TestResult } from "../../shared/types";
import { initTimeline, log, subscribe } from "../timeline/bus";
import { InterviewerWidget } from "./InterviewerWidget";

const problem: Omit<Problem, "hiddenTests"> = {
  id: "mergeBookings",
  title: "Meeting room bookings",
  functionName: "mergeBookings",
  statementMd:
    'Given an array of bookings `{start: "HH:MM", end: "HH:MM", room: string}`, return, per room, the merged busy intervals sorted by start, as `{ [room]: [["HH:MM","HH:MM"], ...] }`. Back-to-back bookings (end == next start) merge. Ignore bookings where `end <= start`. Rooms with only invalid bookings are omitted.',
  starterCode: "/** @param {{start:string,end:string,room:string}[]} bookings */\nfunction mergeBookings(bookings) {\n  \n}\n",
  visibleTests: [],
};
const assessment: Assessment = { id: "dev", title: "Voice harness", company: "Oarlock Practice", problemId: problem.id, aiPolicy: "full", durationMin: 15, voice: true, practice: true };

const AI_CODE = `function mergeBookings(bookings) {
  const byRoom = {};
  for (const b of bookings) (byRoom[b.room] ||= []).push(b);
  const out = {};
  for (const room in byRoom) {
    const list = byRoom[room].sort((a, b) => a.start.localeCompare(b.start));
    const merged = [];
    for (const b of list) {
      const last = merged[merged.length - 1];
      if (last && b.start < last[1]) last[1] = b.end > last[1] ? b.end : last[1];
      else merged.push([b.start, b.end]);
    }
    out[room] = merged;
  }
  return out;
}`;

export function VoiceHarnessPage() {
  const sessionId = useMemo(() => `dev-${Date.now()}`, []);
  const [code, setCode] = useState(problem.starterCode);
  const [started, setStarted] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [minutesOverride, setMinutesOverride] = useState<number | null>(null);
  const startAt = useRef(0);
  const minutesLeft = () => minutesOverride ?? assessment.durationMin - (Date.now() - startAt.current) / 60_000;

  function start() {
    initTimeline(sessionId);
    subscribe((e) => setLines((l) => [...l.slice(-60), `${e.at.slice(11, 19)} ${e.kind} ${JSON.stringify(e.data).slice(0, 160)}`]));
    startAt.current = Date.now();
    log("session_start", { assessmentId: assessment.id, candidateName: "Dev" });
    log("code", { code });
    setStarted(true);
  }
  const edit = (c: string) => { setCode(c); log("code", { code: c }); };
  const result = (passed: number): TestResult => ({ passed, total: 4, failures: passed < 4 ? [{ name: "back-to-back", message: 'expected {"A":[["09:00","11:00"]]} got {"A":[["09:00","10:00"],["10:00","11:00"]]}' }] : [], ms: 4, hidden: false });

  return (
    <main style={{ padding: 20, fontFamily: "system-ui", display: "grid", gridTemplateColumns: "1fr 320px", gap: 16 }}>
      <section style={{ minWidth: 0 }}>
        <h2 style={{ marginTop: 0 }}>Voice interviewer harness (dev)</h2>
        {!started ? <button onClick={start}>Start session</button> : (
          <>
            <textarea value={code} onChange={(e) => edit(e.target.value)} spellCheck={false}
              style={{ width: "100%", boxSizing: "border-box", height: 300, fontFamily: "ui-monospace, monospace", fontSize: 13, background: "#0d1117", color: "#e6edf3", padding: 10 }} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0" }}>
              <button onClick={() => { log("prompt", { text: "write mergeBookings for me" }); log("ai_reply", { text: "Here's a solution", codeBlocks: [AI_CODE] }); }}>Prompt AI</button>
              <button onClick={() => { setCode(AI_CODE); log("insert", { code: AI_CODE }); log("code", { code: AI_CODE }); }}>Insert AI code</button>
              <button onClick={() => log("test_run", { result: result(3) })}>Run tests (3/4)</button>
              <button onClick={() => log("test_run", { result: result(4) })}>Run tests (4/4)</button>
              <button onClick={() => setMinutesOverride(4.9)}>Jump to 5 min left</button>
              <button onClick={() => log("submit", { code, result: { ...result(9), total: 10, hidden: true } })}>Submit</button>
            </div>
            <pre style={{ fontSize: 11, background: "#f6f8fa", padding: 8, maxHeight: 260, overflow: "auto" }}>{lines.join("\n")}</pre>
          </>
        )}
      </section>
      <aside>
        {started && <InterviewerWidget sessionId={sessionId} assessment={assessment} problem={problem} candidateName="Dev" minutesLeft={minutesLeft} onEnd={() => setLines((l) => [...l, "-- onEnd fired --"])} />}
      </aside>
    </main>
  );
}
