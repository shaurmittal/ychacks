// Lane 04 owns this file. Report generation: metrics in code + Claude scorecard from the real timeline.
import Anthropic from "@anthropic-ai/sdk";
import type { Assessment, Metrics, Problem, Report, Session, TimelineEvent } from "../shared/types";
import { getProblem } from "../shared/problems";
import * as store from "./store";
import { computeMetrics, finalCodeOf } from "./metrics";

const MODEL = process.env.REPORT_MODEL ?? "claude-sonnet-5-5";
const MAX_TIMELINE_CHARS = 40_000; // ~12k tokens

const SYSTEM = `You are a fair, evidence-driven hiring panel reviewing an AI-assisted coding assessment. Candidates were allowed to use an AI assistant. Judge how effectively they built with AI, not whether they used it.
Rubric (1-5 each):
- problemSolving: correct, complete solution; handles edge cases; sensible approach.
- aiUsage: precise prompts with context; verifies AI output (tests after inserting, questions it); understands accepted code (can explain it to the interviewer); catches AI mistakes; doesn't over-rely (high aiCodeShare is fine only if verified and understood).
- codeQuality: readable, idiomatic, no dead code.
- communication: clear answers to the interviewer, thinks out loud, honest about uncertainty. If there were no voice turns at all, score communication from prompt clarity only and say so.
Every strength and concern must be backed by evidence with a timestamp (mm:ss) and a short quote from the timeline. Don't invent events; only quote text that appears in the timeline or final code. Keep the summary to 2-3 sentences, addressed to the hiring team.
Recommendation from overall: >= 4.3 strong_yes, >= 3.5 yes, >= 2.7 lean_no, else no.
Output JSON only, matching the schema (the server adds metrics).`;

const score = { type: "integer", minimum: 1, maximum: 5 };
const strArr = { type: "array", items: { type: "string" } };
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["scores", "overall", "recommendation", "summary", "strengths", "concerns", "evidence", "aiUsageNotes"],
  properties: {
    scores: {
      type: "object", additionalProperties: false,
      required: ["problemSolving", "aiUsage", "codeQuality", "communication"],
      properties: { problemSolving: score, aiUsage: score, codeQuality: score, communication: score },
    },
    overall: { type: "number" },
    recommendation: { type: "string", enum: ["strong_yes", "yes", "lean_no", "no"] },
    summary: { type: "string" },
    strengths: strArr,
    concerns: strArr,
    evidence: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["at", "quote", "why"],
        properties: { at: { type: "string" }, quote: { type: "string" }, why: { type: "string" } },
      },
    },
    aiUsageNotes: strArr,
  },
};

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const clip = (t: unknown, n = 300) => {
  const s = typeof t === "string" ? t : JSON.stringify(t ?? "");
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n) + "…" : one;
};
const lines = (code: unknown) => (typeof code === "string" ? code.split("\n").length : 0);

function describe(e: TimelineEvent): string {
  const d = e.data;
  switch (e.kind) {
    case "code": return `code snapshot (${lines(d.code)} lines)`;
    case "prompt": return `"${clip(d.text, 500)}"`;
    case "ai_reply": {
      const blocks = Array.isArray(d.codeBlocks) ? d.codeBlocks.length : 0;
      return `${clip(d.text, 400)}${blocks ? ` [${blocks} code block(s)]` : ""}`;
    }
    case "insert": return `inserted AI code (${lines(d.code)} lines): ${clip(d.code, 200)}`;
    case "paste": return `pasted ${d.fromAi ? "AI" : "non-AI"} text (${lines(d.text)} lines)`;
    case "test_run":
    case "submit": {
      const r = d.result as { passed?: number; total?: number; failures?: { name: string; message: string }[] } | undefined;
      const f = (r?.failures ?? []).slice(0, 3).map((x) => `${x.name}: ${clip(x.message, 80)}`).join("; ");
      return `${r?.passed ?? "?"}/${r?.total ?? "?"} passed${f ? ` — ${f}` : ""}`;
    }
    case "interviewer_said":
    case "candidate_said": return `"${clip(d.text, 500)}"`;
    case "flag": return `[${String(d.severity)}] ${clip(d.note)}`;
    default: return clip(d, 150);
  }
}

export function compactTimeline(session: Session, events: TimelineEvent[]): string {
  const t0 = new Date(session.startedAt).getTime();
  const out = events.map((e) => `${mmss(new Date(e.at).getTime() - t0)} ${e.kind}: ${describe(e)}`);
  let text = out.join("\n");
  if (text.length > MAX_TIMELINE_CHARS) {
    // Keep everything except code snapshots first; then trim the middle.
    const keep = out.filter((l) => !/ code: code snapshot/.test(l));
    text = keep.join("\n");
    if (text.length > MAX_TIMELINE_CHARS) {
      const half = MAX_TIMELINE_CHARS / 2;
      text = text.slice(0, half) + "\n… (timeline trimmed) …\n" + text.slice(-half);
    }
  }
  return text;
}

function buildPrompt(a: Assessment, p: Problem, session: Session, events: TimelineEvent[], metrics: Metrics, finalCode: string, sub?: store.Submission): string {
  const hidden = sub
    ? `${sub.hidden.passed}/${sub.hidden.total} hidden tests passed; ${sub.visible.passed}/${sub.visible.total} visible tests passed at submit.`
    : "No submission was graded (session ended without submit).";
  return [
    `# Problem: ${p.title}\n${p.statementMd}`,
    `# AI policy: ${a.aiPolicy}  ·  Duration limit: ${a.durationMin} min  ·  Voice interviewer: ${a.voice ? "on" : "off"}`,
    `# Candidate: ${session.candidateName}`,
    `# Metrics (computed from the timeline)\n${JSON.stringify(metrics, null, 2)}`,
    `# Hidden-test summary\n${hidden}`,
    `# Final code\n\`\`\`js\n${finalCode || "(empty)"}\n\`\`\``,
    `# Timeline (mm:ss kind: text)\n${compactTimeline(session, events)}`,
  ].join("\n\n");
}

type Draft = Omit<Report, "sessionId" | "generatedAt" | "metrics">;

function validate(x: unknown): Draft | null {
  const r = x as Draft;
  if (!r || typeof r !== "object" || !r.scores) return null;
  const s = r.scores;
  const ok = (n: unknown) => typeof n === "number" && n >= 1 && n <= 5;
  if (![s.problemSolving, s.aiUsage, s.codeQuality, s.communication].every(ok)) return null;
  if (typeof r.summary !== "string" || !Array.isArray(r.strengths) || !Array.isArray(r.concerns)) return null;
  if (!Array.isArray(r.evidence) || !Array.isArray(r.aiUsageNotes)) return null;
  // Overall + recommendation are derived deterministically so they always follow the rubric.
  const overall = Math.round(((s.problemSolving + s.aiUsage + s.codeQuality + s.communication) / 4) * 10) / 10;
  const recommendation: Report["recommendation"] =
    overall >= 4.3 ? "strong_yes" : overall >= 3.5 ? "yes" : overall >= 2.7 ? "lean_no" : "no";
  return {
    ...r, overall, recommendation,
    evidence: r.evidence.filter((e) => e && typeof e.at === "string" && typeof e.quote === "string"),
  };
}

function parseJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

async function callModel(client: Anthropic, prompt: string, retry: boolean): Promise<Draft | null> {
  const msg = await client.messages.create(
    {
      model: MODEL,
      max_tokens: 8000,
      // Sonnet 5.5 rejects non-default temperature, so the spec's 0.2 is not sent; low effort keeps it < 30 s.
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: retry ? `${prompt}\n\nReturn valid JSON only.` : prompt }],
    },
    { timeout: 60_000, maxRetries: 1 },
  );
  if (msg.stop_reason === "refusal") throw new Error("The report model declined this request.");
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return validate(parseJson(text));
}

const inFlight = new Set<string>();

export async function generateReport(sessionId: string): Promise<Report | null> {
  if (inFlight.has(sessionId)) return null;
  inFlight.add(sessionId);
  try {
    const session = store.getSession(sessionId);
    if (!session) throw new Error("Session not found.");
    const assessment = store.getAssessment(session.assessmentId);
    const problem = assessment && getProblem(assessment.problemId);
    if (!assessment || !problem) throw new Error("Assessment or problem not found.");
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set on the server, so the report can't be generated yet. Add it to .env.server and click Retry.");
    }
    store.setReportError(sessionId, null);

    const events = store.getEvents(sessionId);
    const sub = store.getSubmission(sessionId);
    const metrics = computeMetrics(session, events, sub);
    const finalCode = finalCodeOf(events, session, sub);
    const prompt = buildPrompt(assessment, problem, session, events, metrics, finalCode, sub);

    const client = new Anthropic();
    const draft = (await callModel(client, prompt, false)) ?? (await callModel(client, prompt, true));
    if (!draft) throw new Error("The report model returned invalid JSON twice.");

    const report: Report = { ...draft, sessionId, generatedAt: new Date().toISOString(), metrics };
    store.saveReport(report);
    return report;
  } catch (e) {
    const message = e instanceof Anthropic.AuthenticationError
      ? "ANTHROPIC_API_KEY was rejected by the API."
      : e instanceof Error ? e.message : String(e);
    console.error(`[report] ${sessionId}: ${message}`);
    store.setReportError(sessionId, message);
    return null;
  } finally {
    inFlight.delete(sessionId);
  }
}

export const isGenerating = (sessionId: string) => inFlight.has(sessionId);

/** Wait for the client to flush its final events (session_end) before generating, max ~8 s. */
export function scheduleReport(sessionId: string): void {
  const started = Date.now();
  const tick = () => {
    const ended = store.getEvents(sessionId).some((e) => e.kind === "session_end");
    if ((ended && Date.now() - started > 1500) || Date.now() - started > 8000) void generateReport(sessionId);
    else setTimeout(tick, 500);
  };
  setTimeout(tick, 500);
}
