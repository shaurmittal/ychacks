// Lane 04 owns this file.
import type { CreateSession, PostEvents, SubmitSession, GetSession } from "wasp/server/api";
import type { TimelineEvent, TimelineKind } from "../shared/types";
import { getProblem } from "../shared/problems";
import * as store from "./store";
import { grade } from "./grader";
import { generateReport, isGenerating, scheduleReport } from "./report";

const KINDS: TimelineKind[] = [
  "session_start", "code", "prompt", "ai_reply", "insert", "paste",
  "test_run", "submit", "interviewer_said", "candidate_said", "flag", "session_end",
  "interviewer_trigger", // lane 03: {reason, summary}: why the interviewer is about to speak
];

export const createSession: CreateSession = (req, res) => {
  const { assessmentId, candidateName } = (req.body ?? {}) as { assessmentId?: string; candidateName?: string };
  if (!assessmentId || !store.getAssessment(assessmentId)) return void res.status(404).json({ error: "Assessment not found." });
  const name = String(candidateName ?? "").trim().slice(0, 80) || "Anonymous";
  res.json(store.createSession(assessmentId, name));
};

export const postEvents: PostEvents = (req, res) => {
  const id = String(req.params.id);
  if (!store.getSession(id)) return void res.status(404).json({ error: "Session not found." });
  const body = req.body as unknown;
  const list = (Array.isArray(body) ? body : [body]) as TimelineEvent[];
  const valid = list.filter((e) => e && KINDS.includes(e.kind));
  store.addEvents(id, valid);
  res.json({ ok: true, added: valid.length });
};

export const submitSession: SubmitSession = (req, res) => {
  const id = String(req.params.id);
  const session = store.getSession(id);
  if (!session) return void res.status(404).json({ error: "Session not found." });
  const assessment = store.getAssessment(session.assessmentId);
  const problem = assessment && getProblem(assessment.problemId);
  if (!problem) return void res.status(404).json({ error: "Problem not found." });

  const code = String((req.body as { code?: unknown } | undefined)?.code ?? "");
  const outcome = grade(code, problem);
  const at = new Date().toISOString();
  store.saveSubmission(id, { at, code, ...outcome });
  store.updateSession(id, { endedAt: session.endedAt ?? at, finalCode: code });
  res.json({ result: outcome.result });
  scheduleReport(id); // async, after the client's final timeline flush
};

export const getSession: GetSession = (req, res) => {
  const id = String(req.params.id);
  const session = store.getSession(id);
  if (!session) return void res.status(404).json({ error: "Session not found." });
  const assessment = store.getAssessment(session.assessmentId);
  const report = store.getReport(id);
  // ?regenerate=1 retries a failed report (e.g. once the API key is added).
  if (req.query.regenerate && !isGenerating(id) && store.getSubmission(id)) void generateReport(id);
  const status = report ? "ready" : isGenerating(id) ? "generating" : store.getReportError(id) ? "error" : store.getSubmission(id) ? "pending" : "not_submitted";
  res.json({ session, assessment, events: store.getEvents(id), report, reportStatus: status, reportError: store.getReportError(id) });
};
