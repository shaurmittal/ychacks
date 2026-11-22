// Lane 05 (twin). Predict-then-probe: an Expected Parrot "twin" predicts how a candidate
// will answer a few interviewer questions; when the real answer surprises the twin,
// the voice interviewer asks a follow-up. Talks to the Python twin service (twin-py/, TWIN_URL).
//
// FAIRNESS: twin predictions and surprise scores only steer follow-up questions.
// They are never logged to the timeline and never reach metrics or the report.
import type { TwinBrief, TwinCheck, TwinGet } from "wasp/server/api";
import { getProblem } from "../shared/problems";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, getAssessment, getSession } from "./store";

// Twin training data: predicted vs actual answers, appended one JSON object per line.
// Never contains the candidate's name, LinkedIn URL or contact details. Not fed back into the twin.
const TRAINING_FILE = path.join(DATA_DIR, "twin_training.jsonl");
function saveTrainingRecord(rec: Record<string, unknown>): void {
  try {
    fs.mkdirSync(path.dirname(TRAINING_FILE), { recursive: true });
    fs.appendFileSync(TRAINING_FILE, JSON.stringify(rec) + "\n");
  } catch (e) {
    console.error("[twin] could not save training record", e);
  }
}

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
  profileSource: "linkedin" | "baseline";
  profileResolved: boolean;
  profile?: Record<string, unknown>; // minimal twin profile (no name, no URL), kept for training records
  intro?: string; // spoken in the agent's first message when the profile came from LinkedIn
};

function introFrom(p: Record<string, unknown>): string {
  const role = String(p.role_title ?? "").trim();
  const industry = String(p.industry ?? "").trim();
  if (!role || role === "Professional") return "";
  const article = /^[aeiou]/i.test(role) ? "an" : "a";
  const where = industry && industry !== "Unknown" ? ` in ${industry.toLowerCase()}` : "";
  return `I had a quick look at your LinkedIn: you work as ${article} ${role}${where}, nice to meet you. Before we start, give me a quick ten-second intro: what are you working on these days?`;
}

// Baseline twin used when the candidate gives no LinkedIn URL (or Fiber finds no match).
// With a LinkedIn URL, Fiber AI returns role/seniority/industry/tenure/region/education/skills only.
const BASELINE_PROFILE = {
  role_title: "Software engineering candidate",
  seniority: "Entry level",
  industry: "Software",
  tenure_years: 0,
  region: "North America",
  skills: ["JavaScript", "data structures", "algorithms"],
};

// Asked as a quick wrap-up right after submit (2-minute demo: 3 questions).
function guideFor(problemTitle: string): GuideQuestion[] {
  return [
    { id: "approach", type: "free_text", text: `In one sentence, how did you approach "${problemTitle}"?` },
    { id: "ai_plan", type: "single_choice", text: "How did you end up using the AI assistant?",
      options: ["Not at all", "Only to check my ideas", "For boilerplate and syntax", "To write most of the solution"] },
    { id: "difficulty", type: "scale", scale_min: 1, scale_max: 5, text: "On a scale of 1 to 5, how hard did that problem feel?" },
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

async function profileFor(linkedinUrl?: string): Promise<{ profile: Record<string, unknown>; source: Brief["profileSource"] }> {
  if (!linkedinUrl) return { profile: BASELINE_PROFILE, source: "baseline" };
  try {
    const r = await twinPost<{ found: boolean; profile?: Record<string, unknown> }>("/profile", { linkedinUrl }, 45_000);
    if (r.found && r.profile) return { profile: r.profile, source: "linkedin" };
  } catch (e) {
    console.warn(`[twin] Fiber lookup failed, using baseline: ${(e as Error)?.message ?? e}`);
  }
  return { profile: BASELINE_PROFILE, source: "baseline" };
}

function startBrief(sessionId: string, linkedinUrl?: string): Brief | null {
  const existing = briefs.get(sessionId);
  if (existing && existing.status !== "error") return existing;
  const session = getSession(sessionId);
  const assessment = session && getAssessment(session.assessmentId);
  const problem = assessment && getProblem(assessment.problemId);
  if (!problem) return null;
  const brief: Brief = { status: "pending", guide: guideFor(problem.title), predictions: [], answers: [], startedAt: Date.now(), profileSource: "baseline", profileResolved: false };
  briefs.set(sessionId, brief);
  profileFor(linkedinUrl)
    .then(({ profile, source }) => {
      brief.profileSource = source;
      brief.profileResolved = true;
      brief.profile = profile;
      if (source === "linkedin") brief.intro = introFrom(profile) || undefined;
      return twinPost<{ predictions: Prediction[] }>("/predict", { profile, guide: { questions: brief.guide } }, 180_000);
    })
    .then((r) => { brief.predictions = r.predictions; brief.status = "ready"; console.log(`[twin] ${sessionId}: brief ready (${brief.profileSource})`); })
    .catch((e) => { brief.status = "error"; brief.error = String(e?.message ?? e); console.error(`[twin] ${sessionId}: ${brief.error}`); });
  return brief;
}

const publicBrief = (b: Brief) => ({ status: b.status, guide: b.guide, error: b.error, profileSource: b.profileSource, profileResolved: b.profileResolved || b.status !== "pending", intro: b.intro ?? null, answered: b.answers.map((a) => a.questionId) });

// POST /api/twin/brief {sessionId, linkedinUrl?} -> {status, guide, profileSource}  (starts prediction on first call)
export const twinBrief: TwinBrief = (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const sessionId = String(body.sessionId ?? "");
  const linkedinUrl = typeof body.linkedinUrl === "string" && /linkedin\.com\/in\//i.test(body.linkedinUrl) ? body.linkedinUrl.slice(0, 200) : undefined;
  const b = startBrief(sessionId, linkedinUrl);
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
    const session = getSession(String(body.sessionId));
    saveTrainingRecord({
      at: new Date().toISOString(),
      sessionId: String(body.sessionId), // random id, not linked to identity in this file
      problemId: session ? getAssessment(session.assessmentId)?.problemId : undefined,
      profileSource: b.profileSource,
      profile: b.profile ?? BASELINE_PROFILE,
      question: q,
      predicted: pred.predicted_answer,
      distribution: pred.distribution ?? null,
      confidence: pred.confidence,
      actual: answer,
      surprise: { score: s.score, kind: s.kind, judged_by: s.judged_by },
    });
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
