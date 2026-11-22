// In-browser registry of every code block the AI has produced this session.
// Lane 01: call `isPasteFromAi(text)` from Monaco's `editor.onDidPaste` and log
// `paste {text, fromAi}` (docs/ASSISTANT.md: fromAi = >= 60% line overlap with any AI block).
import { overlapWithAi } from "../../shared/aiShare";
import { subscribe } from "../timeline/bus";

const blocks: string[] = [];
const seen = new Set<string>();

export function addAiBlocks(codeBlocks: string[]): void {
  for (const b of codeBlocks) {
    if (!seen.has(b)) { seen.add(b); blocks.push(b); }
  }
}

export function getAiCodeBlocks(): string[] {
  return blocks.slice();
}

export function isPasteFromAi(text: string): boolean {
  return overlapWithAi(text, blocks) >= 0.6;
}

// Also pick up ai_reply events from the timeline bus (covers any other producer).
subscribe((e) => {
  if (e.kind === "ai_reply" && Array.isArray(e.data.codeBlocks)) {
    addAiBlocks(e.data.codeBlocks.filter((c): c is string => typeof c === "string"));
  }
});
