// Lane 05 (twin). Predict-then-probe: an Expected Parrot "twin" predicts how a candidate
// will answer a few interviewer questions; when the real answer surprises the twin,
// the voice interviewer asks a follow-up. Talks to the Python twin service (twin-py/, TWIN_URL).
//
// FAIRNESS: twin predictions and surprise scores only steer follow-up questions.
// They are never logged to the timeline and never reach metrics or the report.
import type { TwinBrief, TwinCheck, TwinGet } from "wasp/server/api";
import { getProblem } from "../shared/problems";
import { getAssessment, getSession } from "./store";

const TWIN_URL = () => (process.env.TWIN_URL || "http://127.0.0.1:8765").replace(/\/$/, "");

type GuideQuestion = { id: string; text: string; type: "free_text" | "single_choice" | "scale"; options?: string[]; scale_min?: number; scale_max?: number };
type Prediction = { question_id: string; predicted_answer: string | number; confidence: number; distribution?: Record<string, number> | null };
type Surprise = { question_id: string; score: number; kind: string; suggested_probe?: string | null; judged_by: string };
type Brief = {
  status: "pending" | "ready" | "error";
  guide: GuideQuestion[];
  predictions: Prediction[];
  answers: { questionId: string; answer: string | number; surprise: Surprise }[];
  error?: string;
  startedAt: number;
};

// Baseline twin: no personal data exists in Oarlock, so the twin models a typical candidate
// for this OA. A Fiber AI profile (phase 2) would replace this with role/seniority/industry.
const BASELINE_PROFILE = {
  role_title: "Software engineering candidate",
  seniority: "Entry level",
  industry: "Software",
  tenure_years: 0,
  region: "North America",
  skills: ["JavaScript", "data structures", "algorithms"],
};

function guideFor(problemTitle: string): GuideQuestion[] {
  return [
    { id: "approach", type: "free_text", text: `In a sentence or two, how are you planning to approach "${problemTitle}"?` },
    { id: "ai_plan", type: "single_choice", text: "How are you planning to use the AI assistant on this problem?",
      options: ["Not at all", "Only to check my ideas", "For boilerplate and syntax", "To write most of the solution"] },
    { id: "confidence", type: "scale", scale_min: 1, scale_max: 5, text: "On a scale of 1 to 5, how confident are you that your solution will pass the hidden tests?" },
    { id: "edge_cases", type: "free_text", text: "Which edge case are you most worried about?" },
  ];
}

const briefs = new Map<string, Brief>();

async function twinPost<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  const res = await fetch(TWIN_URL() + path, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `twin ${path} ${res.status}`);
  return data;
}

function startBrief(sessionId: string): Brief | null {
  const existing = briefs.get(sessionId);
  if (existing && existing.status !== "error") return existing;
  const session = getSession(sessionId);
  const assessment = session && getAssessment(session.assessmentId);
  const problem = assessment && getProblem(assessment.problemId);
  if (!problem) return null;
  const brief: Brief = { status: "pending", guide: guideFor(problem.title), predictions: [], answers: [], startedAt: Date.now() };
  briefs.set(sessionId, brief);
  twinPost<{ predictions: Prediction[] }>("/predict", { profile: BASELINE_PROFILE, guide: { questions: brief.guide } }, 180_000)
    .then((r) => { brief.predictions = r.predictions; brief.status = "ready"; console.log(`[twin] ${sessionId}: brief ready`); })
    .catch((e) => { brief.status = "error"; brief.error = String(e?.message ?? e); console.error(`[twin] ${sessionId}: ${brief.error}`); });
  return brief;
}

// What the voice agent is told once predictions are ready (questions only; predictions stay server-side).
function agentBriefing(b: Brief): string {
  const qs = b.guide.map((q) => {
    const how = q.type === "single_choice" ? ` (answer must be one of: ${q.options!.join(" | ")})` : q.type === "scale" ? ` (answer: a number ${q.scale_min}-${q.scale_max})` : "";
    return `- id "${q.id}": ${q.text}${how}`;
  }).join("\n");
  return `TWIN QUESTIONS. During the session, at natural pauses (never while they are mid-thought, at most one per check-in), ask each of these once in your own words:\n${qs}\nAfter the candidate answers one, call check_answer with its id and their answer (for choice questions pick the closest option text; for scale questions the number). Follow the instruction it returns. Never mention predictions or a twin to the candidate.`;
}

const publicBrief = (b: Brief) => ({ status: b.status, guide: b.guide, error: b.error, answered: b.answers.map((a) => a.questionId), briefing: b.status === "ready" ? agentBriefing(b) : null });

// POST /api/twin/brief {sessionId} -> {status, guide, briefing?}  (starts prediction on first call)
export const twinBrief: TwinBrief = (req, res) => {
  const sessionId = String((req.body ?? {}).sessionId ?? "");
  const b = startBrief(sessionId);
  if (!b) { res.status(404).json({ error: "Unknown session." }); return; }
  res.json(publicBrief(b));
};

function normaliseAnswer(q: GuideQuestion, raw: unknown): string | number {
  const text = String(raw ?? "").trim();
  if (q.type === "scale") {
    const n = Number(text.match(/-?\d+(\.\d+)?/)?.[0]);
    return Number.isFinite(n) ? Math.min(q.scale_max!, Math.max(q.scale_min!, n)) : q.scale_min!;
  }
  if (q.type === "single_choice") {
    const lower = text.toLowerCase();
    return q.options!.find((o) => o.toLowerCase() === lower) ?? q.options!.find((o) => lower.includes(o.toLowerCase()) || o.toLowerCase().includes(lower)) ?? text;
  }
  return text;
}

// POST /api/twin/check {sessionId, questionId, answer} -> {instruction, kind, score}  (called by the voice client tool)
export const twinCheck: TwinCheck = async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const b = briefs.get(String(body.sessionId ?? ""));
  const q = b?.guide.find((g) => g.id === body.questionId);
  const pred = b?.predictions.find((p) => p.question_id === body.questionId);
  if (!b || !q) { res.json({ instruction: "Unknown question id; continue the interview normally." }); return; }
  if (!pred) { res.json({ instruction: "No prediction available yet; acknowledge briefly and continue." }); return; }
  const answer = normaliseAnswer(q, body.answer);
  try {
    const s = await twinPost<Surprise>("/score", { question: q, prediction: pred, answer }, 10_000);
    b.answers = [...b.answers.filter((a) => a.questionId !== q.id), { questionId: q.id, answer, surprise: s }];
    const instruction = s.kind === "match"
      ? "Their answer was expected. Acknowledge it in a few words and move on; do not ask a follow-up."
      : `Their answer was surprising (${s.kind.replace("_", " ")}). Ask ONE short, curious follow-up to understand their reasoning${s.suggested_probe && (s.judged_by === "llm" || q.type !== "free_text") ? `, e.g. along the lines of: "${s.suggested_probe}"` : " (for example, what led them to that or what it looks like in their code)"}. Do not reveal that anything was predicted.`;
    res.json({ kind: s.kind, score: s.score, instruction });
  } catch (e) {
    res.json({ instruction: "Scoring unavailable; acknowledge briefly and continue.", error: String((e as Error)?.message ?? e) });
  }
};

// GET /api/twin/:sessionId -> full brief incl. predictions vs answers (demo / Twin Reveal; not used by the report)
export const twinGet: TwinGet = (req, res) => {
  const b = briefs.get(String(req.params.sessionId));
  if (!b) { res.status(404).json({ error: "No twin brief for this session." }); return; }
  res.json({ ...publicBrief(b), predictions: b.predictions, answers: b.answers });
};
