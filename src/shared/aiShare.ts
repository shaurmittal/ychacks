// Lane 02 owns this file. Fraction (0..1) of final code lines that come from AI code blocks.
// Spec (docs/ASSISTANT.md): normalise lines (trim, collapse whitespace, drop lines < 6 chars,
// comments and lone braces). Share = final lines found in any AI block's normalised line set
// / normalised final lines. 0 when the final code is empty.

const COMMENT = /^(\/\/|\/\*|\*\/|\*(\s|$)|#!)/;
const LONE_BRACES = /^[\s{}()[\];,]*$/;

export function normaliseLine(line: string): string | null {
  const l = line.trim().replace(/\s+/g, " ");
  if (l.length < 6) return null;
  if (COMMENT.test(l)) return null;
  if (LONE_BRACES.test(l)) return null;
  return l;
}

export function normaliseLines(code: string): string[] {
  const out: string[] = [];
  for (const raw of code.split(/\r?\n/)) {
    const n = normaliseLine(raw);
    if (n !== null) out.push(n);
  }
  return out;
}

export function aiCodeShare(finalCode: string, aiCodeBlocks: string[]): number {
  const finalLines = normaliseLines(finalCode ?? "");
  if (finalLines.length === 0) return 0;
  const aiSet = new Set<string>();
  for (const block of aiCodeBlocks ?? []) for (const l of normaliseLines(block)) aiSet.add(l);
  if (aiSet.size === 0) return 0;
  const hits = finalLines.filter((l) => aiSet.has(l)).length;
  return hits / finalLines.length;
}

/** Share (0..1) of a pasted text's normalised lines that appear in any AI block. Paste is "fromAi" at >= 0.6. */
export function overlapWithAi(text: string, aiCodeBlocks: string[]): number {
  return aiCodeShare(text, aiCodeBlocks);
}
