// Lane 01 owns this file. Name + consent + mic permission before the workspace.
import { useState } from "react";
import type { Assessment } from "../../shared/types";
import type { PublicProblem } from "./client";
import { POLICY_DETAIL, POLICY_LABEL } from "./format";

type MicState = "unknown" | "granted" | "denied";

export function StartScreen(props: {
  assessment: Assessment;
  problem: PublicProblem;
  busy: boolean;
  error: string | null;
  onStart: (name: string, voiceOk: boolean, linkedinUrl?: string) => void;
}) {
  const { assessment, problem, busy, error } = props;
  const [name, setName] = useState(() => localStorage.getItem("oarlock:name") ?? "");
  const [consent, setConsent] = useState(false);
  const [mic, setMic] = useState<MicState>("unknown");
  const [linkedin, setLinkedin] = useState(""); // lane 05 twin: optional, never stored client-side
  const linkedinOk = !linkedin.trim() || /linkedin\.com\/in\/[^/?#\s]+/i.test(linkedin);
  const ready = name.trim().length > 0 && consent && linkedinOk && !busy;

  async function requestMic(): Promise<MicState> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMic("granted");
      return "granted";
    } catch {
      setMic("denied");
      return "denied";
    }
  }

  async function start(force = false) {
    if (!ready) return;
    let m = mic;
    if (assessment.voice && m !== "granted" && !force) {
      m = await requestMic();
      if (m !== "granted") return;
    }
    localStorage.setItem("oarlock:name", name.trim());
    props.onStart(name.trim(), m === "granted", linkedin.trim() || undefined);
  }

  return (
    <div className="start-wrap">
      <div className="start-card">
        <div className="brand">Oarlock</div>
        <div className="start-company">
          {assessment.company}
          {assessment.practice && <span className="pill pill-muted">Practice</span>}
        </div>
        <h1 className="start-title">{assessment.title || problem.title}</h1>

        <div className="start-meta">
          <div><span className="meta-k">Time</span><span className="meta-v">{assessment.durationMin} min</span></div>
          <div><span className="meta-k">Language</span><span className="meta-v">JavaScript</span></div>
          <div><span className="meta-k">AI policy</span><span className="meta-v">{POLICY_LABEL[assessment.aiPolicy]}</span></div>
          <div><span className="meta-k">Interviewer</span><span className="meta-v">{assessment.voice ? "Voice, live" : "Off"}</span></div>
        </div>

        <ul className="start-how">
          <li>Solve one coding problem in the editor. <strong>Run tests</strong> checks the visible tests; <strong>Submit</strong> also runs hidden ones.</li>
          <li>{POLICY_DETAIL[assessment.aiPolicy]}</li>
          {assessment.voice && <li>A voice interviewer joins the call. It may ask about your approach and the code you accept from the AI. Think out loud.</li>}
          <li>When you submit (or time runs out) you get a report on problem solving, AI usage, code quality and communication.</li>
        </ul>

        <label className="field">
          <span>Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" maxLength={80} autoFocus onKeyDown={(e) => e.key === "Enter" && void start()} />
        </label>

        {assessment.voice && (
          <label className="field">
            <span>LinkedIn profile URL <span className="muted">(optional)</span></span>
            <input value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="https://www.linkedin.com/in/your-name" maxLength={200} />
            <small className="muted">
              {linkedinOk
                ? "If you add it, we look up your public professional profile (role, seniority, industry, tenure, region, education, skills) through Fiber AI so the interviewer can tailor a few questions. No contact details are requested, and it is never used in your report."
                : "That doesn't look like a LinkedIn profile URL (linkedin.com/in/…)."}
            </small>
          </label>
        )}

        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>Your session is recorded to generate your report. Delete anytime.</span>
        </label>

        {assessment.voice && (
          <div className={`mic mic-${mic}`}>
            {mic === "unknown" && <>Your microphone is needed for the voice interviewer. <button className="link" onClick={() => void requestMic()}>Allow microphone</button></>}
            {mic === "granted" && <>Microphone ready.</>}
            {mic === "denied" && (
              <>
                Microphone blocked. Allow it from the address bar and <button className="link" onClick={() => void requestMic()}>try again</button>, or{" "}
                <button className="link" disabled={!ready} onClick={() => void start(true)}>continue without voice</button>.
              </>
            )}
          </div>
        )}

        {error && <div className="error">{error}</div>}

        <button className="btn btn-primary btn-lg" disabled={!ready} onClick={() => void start()}>
          {busy ? "Starting…" : `Start assessment · ${assessment.durationMin} min`}
        </button>
      </div>
    </div>
  );
}
