// Lane 04. Interview log on the report page: the raw interviewer/candidate record, for manual review.
// Built in code from the timeline (src/shared/interviewLog.ts); the LLM never touches it.
import { useEffect, useMemo } from "react";
import type { Assessment, Session, TimelineEvent } from "../../shared/types";
import { buildInterviewLog, interviewLogJson, interviewLogText, TRIGGER_LABEL, type LogFlag, type LogMeta, type LogReply } from "../../shared/interviewLog";

type Props = {
  session: Session; assessment?: Assessment; events: TimelineEvent[];
  /** Optional: jump to this event in the page's full timeline. */
  onFocusEvent?: (eventIndex: number) => void;
};

function download(filename: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "candidate";

export function InterviewLog({ session, assessment, events, onFocusEvent }: Props) {
  const log = useMemo(() => buildInterviewLog(events, session.startedAt), [events, session.startedAt]);
  const meta: LogMeta = { candidateName: session.candidateName, assessmentTitle: assessment?.title, company: assessment?.company, sessionId: session.id, startedAt: session.startedAt };
  const base = `overwatch-interview-log-${slug(session.candidateName)}-${session.id}`;

  // /report/:id#interview-log (linked from the ranked list) lands here.
  useEffect(() => {
    if (window.location.hash === "#interview-log") {
      const t = setTimeout(() => document.getElementById("interview-log")?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
      return () => clearTimeout(t);
    }
  }, []);

  const ts = (t: string, eventIndex: number) => onFocusEvent
    ? <button className="ol-ts ol-linkbtn" onClick={() => onFocusEvent(eventIndex)} title="Show in timeline">{t}</button>
    : <span className="ol-ts">{t}</span>;
  const Reply = ({ r }: { r: LogReply }) => (
    <div className="ol-il-sub">{ts(r.t, r.eventIndex)}<span className="ol-il-who">Candidate</span><span>{r.text}</span></div>
  );
  const Flag = ({ f }: { f: LogFlag }) => (
    <div className="ol-il-sub">{ts(f.t, f.eventIndex)}
      <span className="ol-il-note">
        <span className={`ol-chip ${f.severity === "positive" ? "ol-chip-good" : f.severity === "concern" ? "ol-chip-warn" : "ol-chip-plain"}`} style={{ height: 22, fontSize: 12 }}>
          Interviewer note · {f.severity}
        </span>
        <span className="ol-muted">{f.note}</span>
      </span>
    </div>
  );

  return (
    <div className="ol-card" id="interview-log">
      <div className="ol-row" style={{ justifyContent: "space-between", flexWrap: "wrap", marginBottom: 6 }}>
        <div className="ol-section-title" style={{ margin: 0 }}>
          Interview log{log.hasVoice ? ` · ${log.turns.length} interviewer turn${log.turns.length === 1 ? "" : "s"} · ${log.questionCount} question${log.questionCount === 1 ? "" : "s"}` : ""}
        </div>
        <div className="ol-row" style={{ gap: 8 }}>
          <button className="ol-btn ol-btn-ghost" style={{ height: 32 }} onClick={() => download(`${base}.txt`, interviewLogText(log, meta), "text/plain;charset=utf-8")}>Download log (.txt)</button>
          <button className="ol-btn ol-btn-ghost" style={{ height: 32 }} onClick={() => download(`${base}.json`, interviewLogJson(log, meta), "application/json")}>JSON</button>
        </div>
      </div>
      <p className="ol-muted ol-small" style={{ marginTop: 0 }}>The raw record of what the interviewer asked and what the candidate said, straight from the session. Not summarised or edited.</p>

      {!log.hasVoice ? (
        <p className="ol-muted" style={{ margin: "8px 0 0" }}>No voice interview in this session.</p>
      ) : (
        <div className="ol-il">
          {(log.before.replies.length > 0 || log.before.flags.length > 0) && (
            <div className="ol-il-turn">
              <div className="ol-il-head"><span className="ol-muted ol-small">Before the interviewer's first turn</span></div>
              {log.before.replies.map((r, i) => <Reply key={`b${i}`} r={r} />)}
              {log.before.flags.map((f, i) => <Flag key={`bf${i}`} f={f} />)}
            </div>
          )}
          {log.turns.map((turn, i) => (
            <div className="ol-il-turn" key={i}>
              <div className="ol-il-head">
                {ts(turn.t, turn.eventIndex)}
                <span className="ol-il-who">Interviewer</span>
                {turn.isQuestion && <span className="ol-chip ol-chip-ok" style={{ height: 22, fontSize: 12 }}>Question</span>}
              </div>
              {turn.trigger && (
                <div className="ol-il-why">
                  Why asked: {[TRIGGER_LABEL[turn.trigger.reason] ?? turn.trigger.reason, turn.trigger.summary].filter(Boolean).join(" — ")}
                </div>
              )}
              <div className="ol-il-text">{turn.text}</div>
              {turn.replies.map((r, j) => <Reply key={j} r={r} />)}
              {turn.isQuestion && turn.replies.length === 0 && <div className="ol-il-text ol-muted ol-small">No spoken reply.</div>}
              {turn.flags.map((f, j) => <Flag key={`f${j}`} f={f} />)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
