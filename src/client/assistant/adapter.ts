// assistant-ui ChatModelAdapter -> POST /api/assist. Logs `prompt` and `ai_reply` to the timeline.
import type { ChatModelAdapter, ThreadMessage } from "@assistant-ui/react";
import { api } from "wasp/client/api";
import type { AiPolicy } from "../../shared/types";
import { getCode, log } from "../timeline/bus";
import { extractCodeBlocks } from "./codeBlocks";
import { addAiBlocks } from "./aiBlocks";

export type AssistCtx = { sessionId: string; policy: AiPolicy; problemId: string };
type Msg = { role: "user" | "assistant"; content: string };

function toText(m: ThreadMessage): string {
  return m.content
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("\n")
    .trim();
}

async function errorMessage(err: unknown): Promise<string> {
  const e = err as { name?: string; data?: unknown; response?: Response; message?: string };
  if (e?.name === "AbortError") return "Cancelled.";
  if (e?.name === "TimeoutError") return "The AI assistant took too long. Try again.";
  let body = e?.data as { error?: string } | undefined;
  if (!body && e?.response) body = await e.response.clone().json().catch(() => undefined);
  if (body?.error) return body.error;
  return "Couldn't reach the AI assistant. Check your connection and try again.";
}

export function createAssistAdapter(getCtx: () => AssistCtx, onBusy: (busy: boolean) => void): ChatModelAdapter {
  return {
    async run({ messages, abortSignal }) {
      const history: Msg[] = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as Msg["role"], content: toText(m) }))
        .filter((m) => m.content !== "");
      const last = history[history.length - 1];
      if (!last || last.role !== "user") throw new Error("Type a message first.");

      const ctx = getCtx();
      log("prompt", { text: last.content });
      onBusy(true);
      try {
        const res = await api
          .post("/api/assist", {
            json: { sessionId: ctx.sessionId, policy: ctx.policy, problemId: ctx.problemId, code: getCode(), messages: history },
            signal: abortSignal,
            timeout: 25_000,
            retry: 0,
          })
          .json<{ text: string }>();
        const text = res.text ?? "";
        const codeBlocks = extractCodeBlocks(text);
        addAiBlocks(codeBlocks);
        log("ai_reply", { text, codeBlocks });
        return { content: [{ type: "text", text }] };
      } catch (err) {
        throw new Error(await errorMessage(err));
      } finally {
        onBusy(false);
      }
    },
  };
}
