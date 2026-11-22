// Lane 04 owns this file.
import type { ListAssessments, CreateAssessment, GetAssessment, ListAssessmentSessions } from "wasp/server/api";
import type { AiPolicy, Assessment } from "../shared/types";
import { getProblem, publicProblem } from "../shared/problems";
import * as store from "./store";

const POLICIES: AiPolicy[] = ["full", "no_solutions", "hints"];

export const listAssessments: ListAssessments = (_req, res) => {
  res.json(store.listAssessments());
};

export const createAssessment: CreateAssessment = (req, res) => {
  const b = (req.body ?? {}) as Partial<Assessment>;
  const problem = typeof b.problemId === "string" ? getProblem(b.problemId) : undefined;
  if (!problem) return void res.status(400).json({ error: "Unknown problemId." });
  const durationMin = Number(b.durationMin);
  const created = store.createAssessment({
    title: String(b.title || problem.title).slice(0, 120),
    company: String(b.company || "Your company").slice(0, 80),
    problemId: problem.id,
    aiPolicy: POLICIES.includes(b.aiPolicy as AiPolicy) ? (b.aiPolicy as AiPolicy) : "full",
    durationMin: Number.isFinite(durationMin) && durationMin >= 5 && durationMin <= 120 ? Math.round(durationMin) : 25,
    voice: b.voice !== false,
    practice: b.practice === true,
  });
  res.json(created);
};

export const getAssessment: GetAssessment = (req, res) => {
  const assessment = store.getAssessment(String(req.params.id));
  if (!assessment) return void res.status(404).json({ error: "Assessment not found." });
  const problem = getProblem(assessment.problemId);
  if (!problem) return void res.status(404).json({ error: `Problem ${assessment.problemId} is not available yet.` });
  res.json({ assessment, problem: publicProblem(problem) });
};

export const listAssessmentSessions: ListAssessmentSessions = (req, res) => {
  const rows = store.sessionsForAssessment(String(req.params.id)).map((session) => ({ session, report: store.getReport(session.id), reportError: store.getReportError(session.id) }));
  rows.sort((a, b) => {
    const sa = a.report?.overall ?? -1;
    const sb = b.report?.overall ?? -1;
    return sb - sa || b.session.startedAt.localeCompare(a.session.startedAt);
  });
  res.json(rows);
};
