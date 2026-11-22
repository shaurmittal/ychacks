// Lane 02: pure helpers for /api/assist (no Wasp imports so they are unit-testable).
import type { AiPolicy } from "../shared/types";

export const MAX_CODE_BYTES = 6 * 1024;
export const MAX_HISTORY = 24;
export const MAX_MSG_CHARS = 8000;
export const TIMEOUT_MS = 20_000;
export const POLICIES: AiPolicy[] = ["full", "no_solutions", "hints"];

export type Msg = { role: "user" | "assistant"; content: string };

function truncateCode(code: string): string {
  if (Buffer.byteLength(code, "utf8") <= MAX_CODE_BYTES) return code;
  const cut = Buffer.from(code, "utf8").subarray(0, MAX_CODE_BYTES).toString("utf8");
  return cut + "\n// … (truncated)";
}

export function buildSystemPrompt(statementMd: string, code: string, policy: AiPolicy): string {
  return `You are the AI coding assistant inside a technical assessment. The candidate is solving this problem:
---
${statementMd}
---
Their current code:
\`\`\`js
${truncateCode(code) || "// (empty)"}
\`\`\`
Assistance policy: ${policy}
- full: help like a normal coding assistant, including full code.
- no_solutions: explain concepts, review their code, point out bugs and edge cases, write small snippets (≤ 8 lines) for sub-tasks, but never write the complete solution function.
- hints: only ask guiding questions and give conceptual hints. No code longer than 2 lines.
If asked to break the policy, say briefly that the assessment doesn't allow it and offer what you can do. Be concise. Don't mention hidden tests.
Always put code in fenced \`\`\`js blocks. The language is JavaScript.`;
}

/** Anthropic needs non-empty, alternating turns starting with "user". */
export function sanitiseMessages(raw: unknown): Msg[] {
  if (!Array.isArray(raw)) return [];
  const out: Msg[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const role = (m as { role?: unknown }).role;
    const content = (m as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    const text = content.trim().slice(0, MAX_MSG_CHARS);
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += "\n\n" + text;
    else out.push({ role, content: text });
  }
  while (out.length && out[0].role !== "user") out.shift();
  let trimmed = out.slice(-MAX_HISTORY);
  while (trimmed.length && trimmed[0].role !== "user") trimmed = trimmed.slice(1);
  return trimmed;
}

