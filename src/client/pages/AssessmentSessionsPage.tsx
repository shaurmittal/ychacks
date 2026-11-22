// Lane 04 owns this file. /company/:assessmentId — candidates ranked by overall score.
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "wasp/client/api";
import type { Assessment, Report, Session } from "../../shared/types";
import { Shell, RecChip, pct, scoreColor } from "../report/ui";

type Row = { session: Session; report?: Report; reportError?: string };

export function AssessmentSessionsPage() {
  const { assessmentId } = useParams();
  const nav = useNavigate();
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let stop = false;
    api.get(`api/assessments/${assessmentId}`).json<{ assessment: Assessment }>().then((d) => !stop && setAssessment(d.assessment)).catch(() => {});
    const load = () => api.get(`api/assessments/${assessmentId}/sessions`).json<Row[]>().then((r) => !stop && setRows(r)).catch(() => {});
    load();
    const t = setInterval(load, 5000); // new candidates and reports show up live
    return () => { stop = true; clearInterval(t); };
  }, [assessmentId]);

  const link = `${window.location.origin}/take/${assessmentId}`;
  const copy = () => { navigator.clipboard?.writeText(link).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const done = rows?.filter((r) => r.report).length ?? 0;

  return (
    <Shell>
      <div className="ol-row" style={{ justifyContent: "space-between", flexWrap: "wrap", marginBottom: 18 }}>
        <div>
          <div className="ol-muted ol-small"><Link to="/company">Assessments</Link> / {assessment?.company}</div>
          <h1 style={{ fontSize: 28, marginTop: 4 }}>{assessment?.title ?? "…"}</h1>
          <div className="ol-muted ol-small" style={{ marginTop: 4 }}>
            {rows ? `${rows.length} candidate${rows.length === 1 ? "" : "s"} · ${done} report${done === 1 ? "" : "s"}` : "Loading…"}
            {assessment && ` · AI policy: ${assessment.aiPolicy} · ${assessment.durationMin} min`}
          </div>
        </div>
        <div className="ol-row" style={{ gap: 8 }}>
          <code className="ol-small ol-muted" style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px" }}>{link}</code>
          <button className="ol-btn ol-btn-ghost" onClick={copy}>{copied ? "Copied ✓" : "Copy link"}</button>
        </div>
      </div>

      <div className="ol-card" style={{ padding: 0 }}>
        {rows && rows.length === 0 ? (
          <p className="ol-muted" style={{ padding: 22, margin: 0 }}>No candidates yet. Share the link above.</p>
        ) : (
          <table className="ol-table">
            <thead>
              <tr><th>#</th><th>Candidate</th><th>Overall</th><th>Verdict</th><th>Problem</th><th>AI usage</th><th>Code</th><th>Comms</th><th>Hidden tests</th><th>AI code</th><th>Time</th><th /></tr>
            </thead>
            <tbody>
              {(rows ?? []).map(({ session, report, reportError }, i) => (
                <tr key={session.id} className="click" onClick={() => nav(`/report/${session.id}`)}>
                  <td><span className="ol-rank">{report ? i + 1 : "–"}</span></td>
                  <td><strong>{session.candidateName}</strong><div className="ol-muted ol-small">{new Date(session.startedAt).toLocaleString()}</div></td>
                  {report ? (
                    <>
                      <td><strong style={{ fontSize: 18, color: scoreColor(report.overall) }}>{report.overall.toFixed(1)}</strong></td>
                      <td><RecChip rec={report.recommendation} practice={!!assessment?.practice} /></td>
                      <td>{report.scores.problemSolving}</td>
                      <td>{report.scores.aiUsage}</td>
                      <td>{report.scores.codeQuality}</td>
                      <td>{report.scores.communication}</td>
                      <td>{pct(report.metrics.hiddenPassRate)}</td>
                      <td>{pct(report.metrics.aiCodeShare)}</td>
                      <td>{report.metrics.durationMin}m</td>
                    </>
                  ) : (
                    <td colSpan={9} className="ol-muted ol-small">{reportError ? "Report failed · open it to retry (interview log still available)" : session.endedAt ? "Report in progress…" : "In progress"}</td>
                  )}
                  <td style={{ whiteSpace: "nowrap", textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                    <Link to={`/report/${session.id}`} className="ol-small">Report</Link>
                    <span className="ol-muted"> · </span>
                    <Link to={`/report/${session.id}#interview-log`} className="ol-small">Interview log</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Shell>
  );
}
