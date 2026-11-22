// Lane 01 owns this file. /take/:assessmentId → start screen → workspace.
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import type { Assessment } from "../../shared/types";
import { initTimeline, log } from "../timeline/bus";
import { createSession, errorMessage, fetchAssessment, type PublicProblem } from "../workspace/client";
import { loadCode, loadSaved, saveSession, type SavedSession } from "../workspace/persist";
import { StartScreen } from "../workspace/StartScreen";
import { Workspace } from "../workspace/Workspace";
import "../workspace/workspace.css";

type Loaded = { assessment: Assessment; problem: PublicProblem };

export function TakePage() {
  const { assessmentId = "" } = useParams();
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [session, setSession] = useState<SavedSession | null>(null);
  const [resumable, setResumable] = useState<SavedSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAssessment(assessmentId)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        const saved = loadSaved(assessmentId);
        const deadline = saved ? new Date(saved.startedAt).getTime() + d.assessment.durationMin * 60_000 : 0;
        if (saved && deadline > Date.now()) setResumable(saved);
      })
      .catch(async (err) => !cancelled && setLoadError(await errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [assessmentId]);

  async function start(candidateName: string, voiceOk: boolean) {
    if (!data) return;
    setBusy(true);
    setStartError(null);
    try {
      const s = await createSession(assessmentId, candidateName);
      const saved: SavedSession = { sessionId: s.id, candidateName: s.candidateName || candidateName, startedAt: s.startedAt, voiceOk };
      saveSession(assessmentId, saved);
      initTimeline(s.id);
      log("session_start", {
        assessmentId,
        problemId: data.problem.id,
        candidateName: saved.candidateName,
        aiPolicy: data.assessment.aiPolicy,
        durationMin: data.assessment.durationMin,
        voice: data.assessment.voice && voiceOk,
        userAgent: navigator.userAgent,
      });
      log("code", { code: data.problem.starterCode });
      setSession(saved);
    } catch (err) {
      setStartError(`Couldn't start the session: ${await errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  function resume(saved: SavedSession) {
    initTimeline(saved.sessionId);
    setSession(saved);
  }

  if (loadError) {
    return (
      <div className="start-wrap">
        <div className="start-card">
          <div className="brand">Oarlock</div>
          <h1 className="start-title">Assessment not available</h1>
          <p className="error">{loadError}</p>
          <a className="btn" href="/">Back to home</a>
        </div>
      </div>
    );
  }
  if (!data) return <div className="start-wrap"><div className="muted">Loading assessment…</div></div>;

  if (session) {
    return (
      <Workspace
        assessment={data.assessment}
        problem={data.problem}
        sessionId={session.sessionId}
        candidateName={session.candidateName}
        startedAt={session.startedAt}
        initialCode={loadCode(session.sessionId) ?? data.problem.starterCode}
        voiceOk={session.voiceOk}
      />
    );
  }

  if (resumable) {
    return (
      <div className="start-wrap">
        <div className="start-card">
          <div className="brand">Oarlock</div>
          <h1 className="start-title">Resume your assessment?</h1>
          <p className="muted">You have an assessment in progress as {resumable.candidateName}. The timer kept running.</p>
          <div className="row">
            <button className="btn btn-primary btn-lg" onClick={() => resume(resumable)}>Resume</button>
            <button className="btn btn-lg" onClick={() => setResumable(null)}>Start over</button>
          </div>
        </div>
      </div>
    );
  }

  return <StartScreen assessment={data.assessment} problem={data.problem} busy={busy} error={startError} onStart={(n, v) => void start(n, v)} />;
}
