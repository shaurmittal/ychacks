// Lane 03: text formatting for what the voice agent sees (context updates, triggers, tool results).
import type { AiPolicy, TestResult, TimelineEvent } from "../../shared/types";

export const EVENT_PREFIX = "[OARLOCK EVENT]";

export function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max)}\n… (${t.length - max} more chars)`;
}

export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function codeBlock(code: string, max = 3000): string {
  return "```js\n" + clip(code, max) + "\n```";
}

/** Prefix each line with its editor line number ("12| ...") so the agent can cite real lines. */
export function numbered(code: string): string {
  const lines = code.replace(/\s+$/, "").split("\n");
  const w = String(lines.length).length;
  return lines.map((l, i) => `${String(i + 1).padStart(w, " ")}| ${l}`).join("\n");
}

/** The candidate's full current code, numbered, for triggers and the get_current_code tool. */
export function currentCodeBlock(code: string, max = 3500): string {
  return code.trim() ? codeBlock(numbered(code), max) : "(the editor is empty)";
}

export function describeResult(r: TestResult): string {
  const base = `${r.passed}/${r.total} ${r.hidden ? "tests (including hidden)" : "visible tests"} passed`;
  if (!r.failures.length) return base + ".";
  const fails = r.failures.slice(0, 4).map((f) => `"${f.name}": ${clip(f.message, 160)}`).join("; ");
  return `${base}. Failing: ${fails}`;
}

export function policyText(p: AiPolicy): string {
  switch (p) {
    case "full": return "the AI assistant may write full solutions; the candidate is judged on how well they verify and understand it";
    case "no_solutions": return "the AI assistant explains concepts and helps debug but will not write the full solution";
    case "hints": return "the AI assistant only gives hints and guiding questions, no code";
  }
}

/** One line per event, for the get_recent_events tool. Code snapshots are summarised. */
export function describeEvent(e: TimelineEvent, startMs: number): string {
  const t = mmss(new Date(e.at).getTime() - startMs);
  const d = e.data as Record<string, any>;
  switch (e.kind) {
    case "code": return `${t} edited code (${String(d.code ?? "").split("\n").length} lines)`;
    case "prompt": return `${t} asked the AI: "${clip(String(d.text ?? ""), 300)}"`;
    case "ai_reply": return `${t} AI replied (${(d.codeBlocks as string[] | undefined)?.length ?? 0} code blocks): "${clip(String(d.text ?? ""), 200)}"`;
    case "insert": return `${t} inserted AI code into the editor:\n${clip(String(d.code ?? ""), 1200)}`;
    case "paste": return `${t} pasted ${d.fromAi ? "code from the AI reply" : "text from outside"}:\n${clip(String(d.text ?? ""), 800)}`;
    case "test_run": return `${t} ran tests: ${d.result ? describeResult(d.result as TestResult) : "?"}`;
    case "submit": return `${t} submitted: ${d.result ? describeResult(d.result as TestResult) : "grading"}`;
    case "interviewer_said": return `${t} interviewer: "${clip(String(d.text ?? ""), 200)}"`;
    case "candidate_said": return `${t} candidate: "${clip(String(d.text ?? ""), 200)}"`;
    case "flag": return `${t} note (${d.severity}): ${d.note}`;
    default: return `${t} ${e.kind}`;
  }
}
