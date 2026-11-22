// Lane 01 owns this file.
import type { AiPolicy } from "../../shared/types";

export const POLICY_LABEL: Record<AiPolicy, string> = {
  full: "Full AI help allowed",
  no_solutions: "AI allowed, no full solutions",
  hints: "AI hints only",
};

export const POLICY_DETAIL: Record<AiPolicy, string> = {
  full: "Use the AI assistant like you would at work, including generating code. You'll be judged on how well you direct and verify it.",
  no_solutions: "The AI assistant can explain, review and write small snippets, but won't write the full solution.",
  hints: "The AI assistant only gives hints and guiding questions.",
};

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
