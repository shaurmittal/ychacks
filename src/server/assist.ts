// Lane 02 owns this file. POST /api/assist -> Claude Haiku (non-streaming).
// Body: {sessionId, policy, problemId, code, messages:[{role,content}]} -> {text}
// Errors: {error, code} with a 4xx/5xx status. Never sends hidden tests to the model.
import Anthropic from "@anthropic-ai/sdk";
import type { Assist } from "wasp/server/api";
import type { AiPolicy } from "../shared/types";
import { getProblem } from "../shared/problems";
import { policyForSession, problemIdForSession } from "./store";
import { POLICIES, TIMEOUT_MS, buildSystemPrompt, sanitiseMessages } from "./assistPrompt";

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  if (!client) client = new Anthropic({ apiKey: key, timeout: TIMEOUT_MS, maxRetries: 1 });
  return client;
}

export const assist: Assist = async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  // Policy and problem come from the session's assessment; the body is only a fallback for unknown sessions.
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const bodyPolicy: AiPolicy = POLICIES.includes(body.policy as AiPolicy) ? (body.policy as AiPolicy) : "hints";
  const policy: AiPolicy = policyForSession(sessionId) ?? bodyPolicy;
  const code = typeof body.code === "string" ? body.code : "";
  const problemId = problemIdForSession(sessionId) ?? (typeof body.problemId === "string" ? body.problemId : "");
  const messages = sanitiseMessages(body.messages);

  if (!messages.length || messages[messages.length - 1].role !== "user") {
    res.status(400).json({ error: "Send a message first.", code: "bad_request" });
    return;
  }
  const anthropic = getClient();
  if (!anthropic) {
    res.status(503).json({ error: "The AI assistant isn't configured (ANTHROPIC_API_KEY missing on the server).", code: "no_key" });
    return;
  }

  const problem = getProblem(problemId);
  const statement = problem ? `# ${problem.title}\n\n${problem.statementMd}\n\nFunction name: ${problem.functionName}` : "(Problem statement unavailable.)";

  try {
    const msg = await anthropic.messages.create(
      {
        model: process.env.ASSIST_MODEL ?? "claude-haiku-5-5",
        max_tokens: 1500,
        system: buildSystemPrompt(statement, code, policy),
        messages,
      },
      { timeout: TIMEOUT_MS },
    );
    const text = msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    res.json({ text: text || "(No reply. Try rephrasing.)" });
  } catch (err) {
    const e = err as { status?: number; name?: string; message?: string };
    const timedOut = e.name === "APIConnectionTimeoutError" || /timed? ?out/i.test(e.message ?? "");
    console.error("[assist] error", e.status, e.name, e.message);
    res.status(timedOut ? 504 : 502).json({
      error: timedOut ? "The AI assistant took too long. Try again." : "The AI assistant is unavailable right now. Try again.",
      code: timedOut ? "timeout" : "upstream",
    });
  }
};
