// Lane 04. The interview log: the raw record of what the voice interviewer asked and what the
// candidate said, built straight from the timeline. Never summarised or edited by an LLM.
import type { TimelineEvent } from "./types";

export type TriggerReason = "insert" | "fails" | "code" | "warn5" | "close" | string;
export type LogReply = { at: string; t: string; text: string; eventIndex: number };
export type LogFlag = { at: string; t: string; note: string; severity: "positive" | "concern" | string; eventIndex: number };
export type LogTurn = {
  at: string; t: string; text: string; isQuestion: boolean; eventIndex: number;
  trigger?: { reason: TriggerReason; summary: string };
  replies: LogReply[]; flags: LogFlag[];
};
export type InterviewLog = {
  /** Candidate speech / interviewer notes that came before the interviewer's first turn. */
  before: { replies: LogReply[]; flags: LogFlag[] };
  turns: LogTurn[];
  questionCount: number;
  hasVoice: boolean;
};

export const TRIGGER_KIND = "interviewer_trigger";
export const TRIGGER_LABEL: Record<string, string> = {
  insert: "AI code inserted", fails: "Repeated test failures", code: "Code change",
  warn5: "5-minute warning", close: "Session closing",
};

/** An interviewer turn counts as a question if it asks something. */
export const isQuestion = (text: string) => text.includes("?");

export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function buildInterviewLog(events: TimelineEvent[], startedAt: string): InterviewLog {
  const t0 = new Date(startedAt).getTime();
  const rel = (at: string) => mmss(new Date(at).getTime() - t0);
  const log: InterviewLog = { before: { replies: [], flags: [] }, turns: [], questionCount: 0, hasVoice: false };
  let pendingTrigger: LogTurn["trigger"];
  let current: { replies: LogReply[]; flags: LogFlag[] } = log.before;

  events.forEach((e, eventIndex) => {
    const kind = e.kind as string;
    const d = e.data ?? {};
    if (kind === TRIGGER_KIND) {
      // Why the interviewer is about to speak; applies to the next interviewer turn only.
      pendingTrigger = { reason: str(d.reason), summary: str(d.summary) };
    } else if (kind === "interviewer_said") {
      const text = str(d.text);
      const turn: LogTurn = {
        at: e.at, t: rel(e.at), text, isQuestion: isQuestion(text), eventIndex,
        trigger: pendingTrigger && (pendingTrigger.summary || pendingTrigger.reason) ? pendingTrigger : undefined,
        replies: [], flags: [],
      };
      pendingTrigger = undefined;
      log.turns.push(turn);
      current = turn;
    } else if (kind === "candidate_said") {
      current.replies.push({ at: e.at, t: rel(e.at), text: str(d.text), eventIndex });
    } else if (kind === "flag" && (d.source === undefined || d.source === "interviewer")) {
      current.flags.push({ at: e.at, t: rel(e.at), note: str(d.note), severity: str(d.severity) || "note", eventIndex });
    }
  });

  log.questionCount = log.turns.filter((t) => t.isQuestion).length;
  log.hasVoice = log.turns.length > 0 || log.before.replies.length > 0;
  return log;
}

export type LogMeta = { candidateName: string; assessmentTitle?: string; company?: string; sessionId: string; startedAt: string };

export function interviewLogText(log: InterviewLog, meta: LogMeta): string {
  const out: string[] = [
    "Overwatch interview log",
    `Candidate:  ${meta.candidateName}`,
    `Assessment: ${[meta.assessmentTitle, meta.company].filter(Boolean).join(" · ") || "-"}`,
    `Session:    ${meta.sessionId} (started ${meta.startedAt})`,
    "Raw record from the session timeline. Not summarised or edited. Times are mm:ss from session start.",
    "",
  ];
  if (!log.hasVoice) {
    out.push("No voice interview in this session.");
    return out.join("\n") + "\n";
  }
  out.push(`${log.turns.length} interviewer turn(s), ${log.questionCount} question(s).`, "");
  const replies = (rs: LogReply[]) => rs.forEach((r) => out.push(`  [${r.t}] CANDIDATE: ${r.text}`));
  const flags = (fs: LogFlag[]) => fs.forEach((f) => out.push(`  [${f.t}] INTERVIEWER NOTE (${f.severity}): ${f.note}`));
  if (log.before.replies.length || log.before.flags.length) {
    out.push("Before the interviewer's first turn:");
    replies(log.before.replies);
    flags(log.before.flags);
    out.push("");
  }
  log.turns.forEach((turn) => {
    out.push(`[${turn.t}] INTERVIEWER${turn.isQuestion ? " (question)" : ""}: ${turn.text}`);
    if (turn.trigger) {
      const label = TRIGGER_LABEL[turn.trigger.reason] ?? turn.trigger.reason;
      out.push(`  Why asked: ${[label, turn.trigger.summary].filter(Boolean).join(": ")}`);
    }
    if (!turn.replies.length && turn.isQuestion) out.push("  (no spoken reply)");
    replies(turn.replies);
    flags(turn.flags);
    out.push("");
  });
  return out.join("\n");
}

export function interviewLogJson(log: InterviewLog, meta: LogMeta): string {
  return JSON.stringify({ ...meta, generatedFrom: "session timeline (raw, unedited)", ...log }, null, 2);
}
