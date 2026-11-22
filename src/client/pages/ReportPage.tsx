// Lane 04 owns this file. /report/:sessionId — polls until the report is ready.
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router";
import Editor from "@monaco-editor/react";
import { api } from "wasp/client/api";
import type { Assessment, Report, Session, TimelineEvent } from "../../shared/types";
import { Shell, RecChip, ScoreBar, mmss, pct, scoreColor } from "../report/ui";

type ReportStatus = "ready" | "generating" | "pending" | "error" | "not_submitted";
type SessionPayload = {
  session: Session; assessment?: Assessment; events: TimelineEvent[];
  report?: Report; reportStatus: ReportStatus; reportError?: string;
};

const KIND_LABEL: Record<string, string> = {
  session_start: "start", code: "code", prompt: "prompt", ai_reply: "AI reply", insert: "AI insert", paste: "paste",
  test_run: "tests", submit: "submit", interviewer_said: "interviewer", candidate_said: "candidate", flag: "flag", session_end: "end",
};

function eventText(e: TimelineEvent): string {
  const d = e.data as Record<string, any>;
  switch (e.kind) {
    case "code": return `Code snapshot · ${String(d.code ?? "").split("\n").length} lines`;
    case "insert": return `Inserted ${String(d.code ?? "").split("\n").length} lines of AI code`;
    case "paste": return `Pasted ${String(d.text ?? "").split("\n").length} lines${d.fromAi ? " (from AI)" : ""}`;
    case "test_run":
    case "submit": {
      const r = d.result ?? {};
      return `${r.passed ?? "?"}/${r.total ?? "?"} tests passed${e.kind === "submit" ? " (incl. hidden)" : ""}`;
    }
    case "flag": return `${d.severity === "positive" ? "▲" : "▼"} ${d.note ?? ""}`;
    case "ai_reply": return String(d.text ?? "").slice(0, 400);
    case "session_start": return "Session started";
    case "session_end": return "Session ended";
    default: return String(d.text ?? "");
  }
}

const parseTs = (s: string) => {
  const m = /(\d+):(\d{2})/.exec(s);
  return m ? (Number(m[1]) * 60 + Number(m[2])) * 1000 : null;
};

export function ReportPage() {
  const { sessionId } = useParams();
  const [data, setData] = useState<SessionPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const d = await api.get(`api/sessions/${sessionId}`).json<SessionPayload>();
        if (stop) return;
        setData(d);
        setLoadError(null);
        if (d.reportStatus !== "ready" && d.reportStatus !== "error") timer = setTimeout(poll, 2000);
      } catch (e) {
        if (stop) return;
        setLoadError("Couldn't load this session.");
        timer = setTimeout(poll, 4000);
      }
    };
    poll();
    return () => { stop = true; clearTimeout(timer); };
  }, [sessionId, retrying]);

  const retry = async () => {
    await api.get(`api/sessions/${sessionId}?regenerate=1`).json().catch(() => null);
    setData((d) => (d ? { ...d, reportStatus: "generating", reportError: undefined } : d));
    setRetrying((r) => !r);
  };

  if (!data) {
    return <Shell narrow><div className="ol-center"><div>{loadError ? <p>{loadError}</p> : <div className="ol-spinner" />}</div></div></Shell>;
  }
  if (!data.report) return <Shell narrow><Pending data={data} onRetry={retry} /></Shell>;
  return <Shell><ReportView data={data} report={data.report} /></Shell>;
}

function Pending({ data, onRetry }: { data: SessionPayload; onRetry: () => void }) {
  const practice = data.assessment?.practice ?? true;
  if (data.reportStatus === "error") {
    return (
      <div className="ol-center"><div style={{ maxWidth: 520 }}>
        <h2 style={{ marginBottom: 10 }}>The report couldn't be generated</h2>
        <p className="ol-muted">{data.reportError}</p>
        <p className="ol-muted ol-small">Your session ({data.events.length} timeline events) is saved, so nothing is lost.</p>
        <button className="ol-btn" onClick={onRetry} style={{ marginTop: 12 }}>Retry</button>
      </div></div>
    );
  }
  if (data.reportStatus === "not_submitted") {
    return <div className="ol-center"><div><h2>No submission yet</h2><p className="ol-muted">This session hasn't been submitted, so there's no report.</p></div></div>;
  }
  return (
    <div className="ol-center"><div>
      <div className="ol-spinner" />
      <h2 style={{ marginBottom: 8 }}>{practice ? "Writing your report…" : "Writing the report…"}</h2>
      <p className="ol-muted">Reviewing {data.events.length} timeline events: your prompts, the AI's replies, test runs and interviewer answers. Usually under 30 seconds.</p>
    </div></div>
  );
}

function ReportView({ data, report }: { data: SessionPayload; report: Report }) {
  const { session, assessment, events } = data;
  const practice = assessment?.practice ?? true;
  const t0 = new Date(session.startedAt).getTime();
  const rel = (e: TimelineEvent) => new Date(e.at).getTime() - t0;
  const m = report.metrics;

  const [hl, setHl] = useState<number | null>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const focusAt = (ts: string) => {
    const ms = parseTs(ts);
    if (ms == null || !events.length) return;
    let best = 0;
    events.forEach((e, i) => { if (Math.abs(rel(e) - ms) < Math.abs(rel(events[best]) - ms)) best = i; });
    setHl(best);
    itemRefs.current[best]?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => setHl((h) => (h === best ? null : h)), 2500);
  };

  // Replay: code snapshots over time (code + submit events), ending with the final code.
  const snapshots = useMemo(() => {
    const s = events
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => (e.kind === "code" || e.kind === "submit") && typeof (e.data as any).code === "string");
    return s;
  }, [events]);
  const [snap, setSnap] = useState<number>(-1); // -1 = final
  const shownCode = snap < 0 || !snapshots[snap] ? session.finalCode ?? (snapshots.at(-1)?.e.data as any)?.code ?? "" : (snapshots[snap].e.data as any).code;
  const selIdx = snap >= 0 ? snapshots[snap]?.i : undefined;

  const tiles: [string, string][] = [
    [pct(m.hiddenPassRate), "hidden tests passed"],
    [pct(m.finalPassRate), "visible tests passed"],
    [m.timeToFirstPassMin == null ? "—" : `${m.timeToFirstPassMin}m`, "time to first green"],
    [pct(m.aiCodeShare), "of final code from AI"],
    [String(m.promptCount), "prompts to the AI"],
    [String(m.avgPromptWords), "avg words per prompt"],
    [String(m.insertsCount), "AI code inserts"],
    [m.insertsCount ? pct(m.testRunsAfterInsertRate) : "—", "inserts verified by tests ≤2 min"],
    [String(m.testRunsTotal), "test runs"],
    [String(m.interviewerQuestions), "interviewer questions"],
    [String(m.candidateTurns), "spoken answers"],
    [`${m.durationMin}m`, "duration"],
  ];

  return (
    <>
      <div className="ol-card">
        <div className="ol-report-head">
          <div>
            <div className="ol-muted ol-small">{assessment?.company} · {assessment?.title} · AI policy: {assessment?.aiPolicy}</div>
            <h1 style={{ fontSize: 30, margin: "6px 0 10px" }}>{session.candidateName}</h1>
            <div className="ol-row" style={{ gap: 10 }}>
              <RecChip rec={report.recommendation} practice={practice} />
              <span className="ol-muted ol-small">{practice ? "Practice OA" : "First-round OA"} · {new Date(session.startedAt).toLocaleString()}</span>
            </div>
          </div>
          <div className="ol-overall">
            <div className="ol-overall-num" style={{ color: scoreColor(report.overall) }}>{report.overall.toFixed(1)}<small> /5</small></div>
            <div className="ol-muted ol-small">overall</div>
          </div>
        </div>
        <div className="ol-bars">
          <ScoreBar label="Problem solving" value={report.scores.problemSolving} />
          <ScoreBar label="AI usage" value={report.scores.aiUsage} />
          <ScoreBar label="Code quality" value={report.scores.codeQuality} />
          <ScoreBar label="Communication" value={report.scores.communication} />
        </div>
        <p style={{ marginTop: 22, marginBottom: 0, fontSize: 16, color: "var(--ink-2)" }}>{report.summary}</p>
      </div>

      <div className="ol-grid2" style={{ marginTop: 16 }}>
        <div className="ol-card">
          <div className="ol-section-title">Strengths</div>
          <ul className="ol-list good">{report.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
          {!report.strengths.length && <p className="ol-muted">None noted.</p>}
        </div>
        <div className="ol-card" style={{ marginTop: 0 }}>
          <div className="ol-section-title">Concerns</div>
          <ul className="ol-list bad">{report.concerns.map((s, i) => <li key={i}>{s}</li>)}</ul>
          {!report.concerns.length && <p className="ol-muted">None noted.</p>}
        </div>
      </div>

      <div className="ol-card" style={{ marginTop: 16 }}>
        <div className="ol-section-title">How they used AI</div>
        <div className="ol-tiles">
          {tiles.map(([v, k]) => <div className="ol-tile" key={k}><div className="ol-tile-v">{v}</div><div className="ol-tile-k">{k}</div></div>)}
        </div>
        {report.aiUsageNotes.length > 0 && <ul className="ol-list" style={{ marginTop: 16 }}>{report.aiUsageNotes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        <p className="ol-muted ol-small" style={{ marginTop: 12, marginBottom: 0 }}>Metrics are computed directly from the session timeline; scores and notes are written by the reviewer model from the same timeline.</p>
      </div>

      <div className="ol-card">
        <div className="ol-section-title">Evidence</div>
        <div className="ol-evidence">
          {report.evidence.map((ev, i) => (
            <button key={i} onClick={() => focusAt(ev.at)} title="Show in timeline">
              <span className="ol-ts">{ev.at}</span>
              <span><div className="ol-quote">“{ev.quote}”</div><div className="ol-why">{ev.why}</div></span>
            </button>
          ))}
          {!report.evidence.length && <p className="ol-muted">No evidence items.</p>}
        </div>
      </div>

      <div className="ol-grid2" style={{ marginTop: 16, alignItems: "start" }}>
        <div className="ol-card">
          <div className="ol-row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <div className="ol-section-title" style={{ margin: 0 }}>{snap < 0 ? "Final code" : `Code at ${mmss(rel(snapshots[snap].e))}`}</div>
            {snapshots.length > 1 && (
              <input type="range" min={0} max={snapshots.length} value={snap < 0 ? snapshots.length : snap}
                onChange={(e) => { const v = Number(e.target.value); setSnap(v >= snapshots.length ? -1 : v); if (v < snapshots.length) itemRefs.current[snapshots[v].i]?.scrollIntoView({ block: "nearest" }); }}
                style={{ width: 180 }} title="Replay code snapshots" />
            )}
          </div>
          <div className="ol-code">
            <Editor height="460px" language="javascript" theme="vs-dark" value={shownCode}
              options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, lineNumbers: "on", domReadOnly: true }} />
          </div>
        </div>
        <div className="ol-card" style={{ marginTop: 0 }}>
          <div className="ol-section-title">Timeline · {events.length} events</div>
          <div className="ol-timeline">
            {events.map((e, i) => (
              <div key={e.id ?? i} ref={(el) => { itemRefs.current[i] = el; }}
                className={`ol-tl-item ol-k-${e.kind}${hl === i ? " hl" : ""}${selIdx === i ? " sel" : ""}`}>
                <span className="ol-ts">{mmss(rel(e))}</span>
                <span className="ol-tl-kind">{KIND_LABEL[e.kind] ?? e.kind}</span>
                <span className="ol-tl-text">{eventText(e)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="ol-muted ol-small" style={{ textAlign: "center", marginTop: 24 }}>Report generated {new Date(report.generatedAt).toLocaleString()} by Oarlock.</p>
    </>
  );
}
