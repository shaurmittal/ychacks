// Lane 01 owns this file. Decides whether pasted text came from the AI assistant:
// true when ≥ 60% of the pasted (normalised) lines appear in any one AI code block.
import { subscribe } from "../timeline/bus";

const aiBlocks: Set<string>[] = [];
let started = false;

export function normaliseLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim().replace(/\s+/g, " "))
    .filter((l) => l.length >= 6 && !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("/*") && !/^[{}()[\];,\s]*$/.test(l));
}

/** Start collecting AI code blocks from `ai_reply` (and `insert`) events on the bus. */
export function trackAiCode(): void {
  if (started) return;
  started = true;
  subscribe((e) => {
    if (e.kind === "ai_reply" && Array.isArray(e.data.codeBlocks)) {
      for (const block of e.data.codeBlocks) if (typeof block === "string") aiBlocks.push(new Set(normaliseLines(block)));
    } else if (e.kind === "insert" && typeof e.data.code === "string") {
      aiBlocks.push(new Set(normaliseLines(e.data.code)));
    }
  });
}

// Prefer lane 02's shared detector (src/client/assistant/aiBlocks.ts) when it exists.
// import.meta.glob keeps this compiling before lane 02 is merged.
const lane02 = import.meta.glob<{ isPasteFromAi?: (text: string) => boolean }>("../assistant/aiBlocks.ts", { eager: true });
const lane02IsPasteFromAi = Object.values(lane02)[0]?.isPasteFromAi;

export function isFromAi(pasted: string): boolean {
  if (lane02IsPasteFromAi) return lane02IsPasteFromAi(pasted);
  const lines = normaliseLines(pasted);
  if (lines.length === 0) return false;
  return aiBlocks.some((set) => lines.filter((l) => set.has(l)).length / lines.length >= 0.6);
}
