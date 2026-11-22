// Lane 04 owns this file.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "wasp/client/api";
import type { Assessment } from "../../shared/types";
import { Shell } from "../report/ui";

const BLURB: Record<string, { level: string; text: string }> = {
  "merge-bookings": { level: "Easy–medium", text: "Merge overlapping meeting-room bookings into busy intervals per room. The AI gets a draft right fast; the edge cases decide it." },
  "knight-ways": { level: "Medium", text: "Count the ways a knight can walk from a1 to h8 in exactly k moves. Brute-force DFS works for small k; k = 1000 needs DP." },
};

export function LandingPage() {
  const [practice, setPractice] = useState<Assessment[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.get("api/assessments").json<Assessment[]>()
      .then((all) => setPractice(all.filter((a) => a.practice)))
      .catch(() => setError(true));
  }, []);

  return (
    <Shell>
      <section className="ol-hero">
        <span className="ol-eyebrow">First-round interviews for the AI era</span>
        <h1>Code with AI. Get interviewed by voice. See how well you really build.</h1>
        <p>
          Overwatch is the online assessment where the AI assistant is allowed. A voice interviewer watches how you prompt,
          verify and explain the code you accept, then writes an evidence-backed report.
        </p>
      </section>

      <div className="ol-section-title">Take a practice OA · 15 minutes · free</div>
      <div className="ol-grid2">
        {practice?.map((a) => (
          <Link key={a.id} to={`/take/${a.id}`} className="ol-card ol-problem-card" style={{ color: "inherit", textDecoration: "none", marginTop: 0 }}>
            <div className="ol-row" style={{ justifyContent: "space-between" }}>
              <h3>{a.title}</h3>
              <span className="ol-chip ol-chip-plain">{BLURB[a.problemId]?.level ?? "Practice"}</span>
            </div>
            <p className="ol-muted" style={{ margin: 0 }}>{BLURB[a.problemId]?.text ?? "A short JavaScript problem solved with an AI assistant."}</p>
            <div className="ol-row ol-small ol-muted" style={{ gap: 14 }}>
              <span>JavaScript</span><span>·</span><span>{a.durationMin} min</span><span>·</span><span>AI assistant on</span><span>·</span><span>{a.voice ? "Voice interviewer" : "No voice"}</span>
            </div>
            <span className="ol-btn" style={{ alignSelf: "flex-start", marginTop: 6 }}>Start practice →</span>
          </Link>
        ))}
        {!practice && !error && <div className="ol-card ol-muted">Loading problems…</div>}
        {error && <div className="ol-card ol-muted">Couldn't reach the server. Refresh to try again.</div>}
        {practice && practice.length === 0 && <div className="ol-card ol-muted">No practice problems are available yet.</div>}
      </div>

      <div className="ol-card" style={{ marginTop: 32 }}>
        <div className="ol-section-title">How it works</div>
        <div className="ol-steps">
          <div className="ol-step"><strong>Solve with AI</strong><p className="ol-muted" style={{ margin: "4px 0 0" }}>Monaco editor, tests, and an AI assistant under the company's policy. Every prompt, insert and test run is logged.</p></div>
          <div className="ol-step"><strong>Talk it through</strong><p className="ol-muted" style={{ margin: "4px 0 0" }}>The voice interviewer asks about the code you actually accepted: why it works, what breaks it, what you'd test.</p></div>
          <div className="ol-step"><strong>Get the report</strong><p className="ol-muted" style={{ margin: "4px 0 0" }}>Scores for problem solving, AI usage, code quality and communication, each backed by timestamped evidence.</p></div>
        </div>
      </div>

      <div className="ol-card" style={{ marginTop: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ fontSize: 19 }}>For companies</h3>
          <p className="ol-muted" style={{ margin: "6px 0 0", maxWidth: 620 }}>
            Hire Overwatch as your first-round interviewer. Create an assessment, choose the AI policy, share the link, and read ranked, evidence-backed reports.
          </p>
        </div>
        <Link to="/company" className="ol-btn">Create an assessment</Link>
      </div>
    </Shell>
  );
}
