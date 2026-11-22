// Lane 03 owns this file (ElevenLabs voice interviewer). Contract: docs/ARCHITECTURE.md, behaviour: docs/VOICE_INTERVIEWER.md.
/// <reference types="vite/client" />
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Assessment, Problem } from "../../shared/types";
import { getCode, log, recent, subscribe } from "../timeline/bus";
import { EVENT_PREFIX, currentCodeBlock, describeEvent, policyText } from "./format";
import { InterviewerFace, type FaceLevels, type FaceState } from "./InterviewerFace";
import { InterviewerBrain } from "./triggers";
import { checkTwinAnswer, watchTwinBrief } from "./twin"; // lane 05 twin
import "./interviewer.css";

type Props = { sessionId: string; assessment: Assessment; problem: Omit<Problem, "hiddenTests">; candidateName: string; minutesLeft: () => number; onEnd?: () => void };
type Phase = "connecting" | "live" | "closing" | "ended" | "error";

const ENV_AGENT_ID = String((import.meta.env as Record<string, unknown>).REACT_APP_ELEVENLABS_AGENT_ID ?? "").trim();
/** Env first; `?voiceAgent=<id>` is a fallback for testing before the env is set (agent IDs are public). */
function agentId(): string {
  if (ENV_AGENT_ID) return ENV_AGENT_ID;
  try { return new URLSearchParams(window.location.search).get("voiceAgent")?.trim() ?? ""; } catch { return ""; }
}
const CLOSE_MAX_MS = 25_000;
const CLOSE_QUIET_MS = 1_500;

export function InterviewerWidget(props: Props) {
  if (!props.assessment.voice) return <VoiceOff title="Voice interviewer off" text="This assessment runs without a voice interviewer." onEnd={props.onEnd} />;
  const id = agentId();
  if (!id) return <VoiceOff title="Voice interviewer unavailable" text="No ElevenLabs agent is configured (REACT_APP_ELEVENLABS_AGENT_ID is empty). You can still complete the assessment." onEnd={props.onEnd} />;
  return (
    <ConversationProvider>
      <LiveInterviewer {...props} agentId={id} />
    </ConversationProvider>
  );
}

/** Voice disabled/unconfigured: still honour onEnd on submit so the page flow never waits on us. */
function VoiceOff({ title, text, onEnd }: { title: string; text: string; onEnd?: () => void }) {
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  useEffect(() => subscribe((e) => { if (e.kind === "submit") onEndRef.current?.(); }), []);
  return (
    <div className="oliv">
      <div className="oliv-head"><span className="oliv-dot off" /><b>{title}</b></div>
      <div className="oliv-face"><InterviewerFace state="off" /></div>
      <div className="oliv-caption muted">{text}</div>
    </div>
  );
}

function friendlyError(msg: string): string {
  if (/permission|notallowed|denied|microphone|getusermedia/i.test(msg)) return "Microphone access is blocked. Allow the mic for this site, then retry.";
  return `Couldn't reach the interviewer: ${msg || "unknown error"}`;
}

function sessionStartMs(): number {
  const s = recent(10_000).find((e) => e.kind === "session_start");
  return s ? new Date(s.at).getTime() : Date.now();
}

function LiveInterviewer(p: Props & { agentId: string }) {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [attempt, setAttempt] = useState(0);

  const propsRef = useRef(p);
  propsRef.current = p;
  const phaseRef = useRef<Phase>("connecting");
  const setPhaseBoth = (ph: Phase) => { phaseRef.current = ph; setPhase(ph); };
  const brainRef = useRef<InterviewerBrain | null>(null);
  const speakingRef = useRef(false);
  const lastSpokeAtRef = useRef(0);
  const closingRef = useRef<{ at: number; sawSpeech: boolean } | null>(null);
  const startMsRef = useRef(Date.now());

  const clientTools = useMemo(() => ({
    get_current_code: () => currentCodeBlock(getCode()),
    get_recent_events: (params: Record<string, unknown>) => {
      const n = Math.min(40, Math.max(1, Number(params?.limit) || 15));
      const lines = recent(500).filter((e) => e.kind !== "code").slice(-n).map((e) => describeEvent(e, startMsRef.current));
      return lines.join("\n") || "No candidate actions yet.";
    },
    flag_observation: (params: Record<string, unknown>) => {
      const note = String(params?.note ?? "").trim();
      const severity = params?.severity === "positive" ? "positive" : "concern";
      if (note) log("flag", { note, severity, source: "interviewer" });
      return "recorded";
    },
    check_answer: (params: Record<string, unknown>) => checkTwinAnswer(propsRef.current.sessionId, params), // lane 05 twin
  }), []);

  const conv = useConversation({
    clientTools,
    onConnect: () => { setError(null); setPhaseBoth("live"); },
    onError: (message: string) => {
      console.error("[interviewer]", message);
      if (phaseRef.current === "ended") return;
      setError(friendlyError(message));
      setPhaseBoth("error");
    },
    onDisconnect: (details) => {
      brainRef.current = null;
      if (phaseRef.current === "ended") return;
      if (phaseRef.current === "closing" || details.reason === "agent") { finish(); return; }
      if (details.reason === "error") { setError(friendlyError(details.message)); setPhaseBoth("error"); }
    },
    onModeChange: ({ mode }) => {
      speakingRef.current = mode === "speaking";
      if (mode === "speaking") {
        lastSpokeAtRef.current = Date.now();
        if (closingRef.current) closingRef.current.sawSpeech = true;
      } else lastSpokeAtRef.current = Date.now();
    },
    onMessage: ({ message, role }) => {
      const text = (message ?? "").trim();
      if (!text) return;
      if (role === "agent") {
        log("interviewer_said", { text });
        setCaption(text);
        brainRef.current?.noteAgentSaid(text);
      } else {
        if (text.startsWith(EVENT_PREFIX)) return; // platform trigger, not the candidate
        log("candidate_said", { text });
        brainRef.current?.noteCandidateSpoke();
      }
    },
  });
  const convRef = useRef(conv);
  convRef.current = conv;
  // Real conversation audio for the face (read every animation frame; 0 when there is no session).
  const faceLevels = useMemo<FaceLevels>(() => ({
    output: () => convRef.current.getOutputVolume(),
    input: () => (convRef.current.isMuted ? 0 : convRef.current.getInputVolume()),
  }), []);

  function finish() {
    if (phaseRef.current === "ended") return;
    setPhaseBoth("ended");
    brainRef.current = null;
    closingRef.current = null;
    try { convRef.current.endSession(); } catch { /* already closed */ }
    propsRef.current.onEnd?.();
  }

  // Start (and restart on retry). Deferred a tick so React StrictMode's mount/unmount/mount doesn't race the provider's start lock.
  useEffect(() => {
    const { assessment, problem, candidateName } = propsRef.current;
    setError(null);
    setPhaseBoth("connecting");
    startMsRef.current = sessionStartMs();
    const timer = setTimeout(() => {
      convRef.current.startSession({
        agentId: p.agentId,
        connectionType: attempt % 2 === 0 ? "webrtc" : "websocket", // retry alternates transport
        dynamicVariables: {
          candidate_name: candidateName || "there",
          company: assessment.company || "Overwatch",
          problem_title: problem.title,
          problem_statement: problem.statementMd,
          function_name: problem.functionName,
          ai_policy: assessment.aiPolicy,
          ai_policy_text: policyText(assessment.aiPolicy),
          duration_min: assessment.durationMin,
        },
      });
    }, 0);
    return () => {
      clearTimeout(timer);
      brainRef.current = null;
      try { convRef.current.endSession(); } catch { /* not started */ }
    };
  }, [attempt, p.agentId]);

  // While connected: feed the timeline into the brain and tick it.
  const connected = conv.status === "connected";
  useEffect(() => {
    if (!connected) return;
    const brain = new InterviewerBrain({
      now: () => Date.now(),
      sendContext: (t) => convRef.current.sendContextualUpdate(t),
      sendTrigger: (t) => convRef.current.sendUserMessage(t),
      logTrigger: (reason, summary) => log("interviewer_trigger", { reason, summary }),
      getCode,
      minutesLeft: () => propsRef.current.minutesLeft(),
      agentSpeaking: () => speakingRef.current,
      onClosing: () => {
        closingRef.current = { at: Date.now(), sawSpeech: false };
        setPhaseBoth("closing");
      },
    });
    brainRef.current = brain;
    // Lane 05 twin: once predictions are ready, queue the twin questions in the brain (never the predictions).
    const stopTwin = watchTwinBrief(propsRef.current.sessionId, (questions) => {
      if (brainRef.current === brain) brain.setTwinQuestions(questions);
    });
    let lastActivitySignal = 0;
    const unsub = subscribe((e) => {
      if (brainRef.current !== brain) return;
      brain.handleEvent(e);
      if (e.kind === "code" && Date.now() - lastActivitySignal > 5_000) {
        lastActivitySignal = Date.now();
        convRef.current.sendUserActivity(); // candidate is typing: don't treat it as dead air
      }
    });
    const iv = setInterval(() => {
      if (brainRef.current === brain) brain.tick();
      const c = closingRef.current;
      if (c) {
        const now = Date.now();
        const doneTalking = c.sawSpeech && !speakingRef.current && now - lastSpokeAtRef.current > CLOSE_QUIET_MS;
        if (doneTalking || now - c.at > CLOSE_MAX_MS) finish();
      }
    }, 1_000);
    return () => { stopTwin(); unsub(); clearInterval(iv); if (brainRef.current === brain) brainRef.current = null; };
  }, [connected]);

  const speaking = conv.isSpeaking;
  const faceState: FaceState =
    phase === "error" ? "error" : phase === "ended" ? "ended" : phase === "connecting" ? "connecting" :
    speaking ? "speaking" : conv.isMuted ? "muted" : "listening";
  const dot = phase === "error" ? "err" : phase === "ended" ? "off" : phase === "connecting" ? "wait" : speaking ? "speak" : conv.isMuted ? "muted" : "listen";
  const label =
    phase === "connecting" ? "Connecting…" :
    phase === "error" ? "Disconnected" :
    phase === "ended" ? "Call ended" :
    phase === "closing" ? (speaking ? "Wrapping up" : "Ending call…") :
    speaking ? "Speaking" : conv.isMuted ? "Muted" : "Listening";

  return (
    <div className="oliv" aria-live="polite">
      <div className="oliv-head">
        <span className={`oliv-dot ${dot}`} />
        <b>Interviewer</b>
        <span className="oliv-status">{label}</span>
        {(phase === "live" || phase === "closing") && (
          <button className="oliv-btn" onClick={() => conv.setMuted(!conv.isMuted)} title={conv.isMuted ? "Unmute your mic" : "Mute your mic"}>
            {conv.isMuted ? "Unmute" : "Mute"}
          </button>
        )}
      </div>
      <div className="oliv-face"><InterviewerFace state={faceState} levels={faceLevels} /></div>
      {(caption || phase === "connecting" || phase === "live") && (
        <div className={`oliv-caption ${caption ? "" : "muted"}`}>
          {caption || (phase === "connecting" ? "Allow microphone access if your browser asks." : "The interviewer will speak shortly.")}
        </div>
      )}
      {phase === "error" && (
        <div className="oliv-err">
          <span>{error}</span>
          <button className="oliv-btn" onClick={() => setAttempt((a) => a + 1)}>Retry</button>
        </div>
      )}
    </div>
  );
}
