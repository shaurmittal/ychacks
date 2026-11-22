// Fenced-code parsing for assistant replies.
export type Segment = { kind: "text"; text: string } | { kind: "code"; lang: string; code: string };

const FENCE = /```([\w+-]*)[^\n]*\n([\s\S]*?)(?:```|$)/g;

export function splitFences(md: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of md.matchAll(FENCE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ kind: "text", text: md.slice(last, idx) });
    out.push({ kind: "code", lang: m[1] || "js", code: m[2].replace(/\n$/, "") });
    last = idx + m[0].length;
  }
  if (last < md.length) out.push({ kind: "text", text: md.slice(last) });
  return out.filter((s) => s.kind === "code" || s.text.trim() !== "");
}

export function extractCodeBlocks(md: string): string[] {
  return splitFences(md)
    .filter((s): s is Extract<Segment, { kind: "code" }> => s.kind === "code")
    .map((s) => s.code)
    .filter((c) => c.trim() !== "");
}
