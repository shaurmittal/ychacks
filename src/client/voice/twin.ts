// Lane 05 (twin): client side of predict-then-probe. See src/server/twin.ts.
import { api } from "wasp/client/api";
import type { TwinQuestion } from "./triggers";

type BriefResponse = { status: "pending" | "ready" | "error"; guide: TwinQuestion[]; answered: string[]; error?: string };

/** Starts the twin brief for a session and polls until it is ready. Calls onReady(unansweredQuestions) once.
 *  Returns a cancel function. Silently gives up on error (the interview works without the twin). */
export function watchTwinBrief(sessionId: string, onReady: (questions: TwinQuestion[]) => void): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const poll = async (attempt: number) => {
    if (stopped) return;
    try {
      const r = await api.post("api/twin/brief", { json: { sessionId }, timeout: 15_000 }).json<BriefResponse>();
      if (stopped) return;
      if (r.status === "ready") return onReady(r.guide.filter((q) => !r.answered.includes(q.id)));
      if (r.status === "error") return console.warn("[twin] brief failed:", r.error);
    } catch (e) {
      console.warn("[twin] brief unavailable:", e);
      if (attempt > 3) return;
    }
    timer = setTimeout(() => poll(attempt + 1), 5_000);
  };
  poll(0);
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

/** Client tool handler for the voice agent: scores the answer and returns an instruction string. */
export async function checkTwinAnswer(sessionId: string, params: Record<string, unknown>): Promise<string> {
  try {
    const r = await api.post("api/twin/check", {
      json: { sessionId, questionId: String(params?.question_id ?? ""), answer: params?.answer ?? "" },
      timeout: 12_000,
    }).json<{ instruction: string }>();
    return r.instruction;
  } catch {
    return "Scoring unavailable; acknowledge briefly and continue.";
  }
}

/** Called right after the candidate submits the start screen: starts the twin early, optionally from LinkedIn via Fiber AI. */
export function startTwinBrief(sessionId: string, linkedinUrl?: string): void {
  api.post("api/twin/brief", { json: { sessionId, linkedinUrl: linkedinUrl?.trim() || undefined }, timeout: 15_000 }).catch(() => {});
}

/** Waits up to `maxMs` for the LinkedIn profile lookup and returns the intro line, or null (baseline / slow / error). */
export async function getTwinIntro(sessionId: string, maxMs = 6_000): Promise<string | null> {
  const until = Date.now() + maxMs;
  while (Date.now() < until) {
    try {
      const r = await api.post("api/twin/brief", { json: { sessionId }, timeout: 4_000 }).json<{ profileResolved: boolean; intro: string | null }>();
      if (r.profileResolved) return r.intro;
    } catch { return null; }
    await new Promise((res) => setTimeout(res, 700));
  }
  return null;
}
