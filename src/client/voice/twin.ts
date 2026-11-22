// Lane 05 (twin): client side of predict-then-probe. See src/server/twin.ts.
import { api } from "wasp/client/api";

type BriefResponse = { status: "pending" | "ready" | "error"; briefing: string | null; error?: string };

/** Starts the twin brief for a session and polls until it is ready. Calls onReady(briefing) once.
 *  Returns a cancel function. Silently gives up on error (the interview works without the twin). */
export function watchTwinBrief(sessionId: string, onReady: (briefing: string) => void): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const poll = async (attempt: number) => {
    if (stopped) return;
    try {
      const r = await api.post("api/twin/brief", { json: { sessionId }, timeout: 15_000 }).json<BriefResponse>();
      if (stopped) return;
      if (r.status === "ready" && r.briefing) return onReady(r.briefing);
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
