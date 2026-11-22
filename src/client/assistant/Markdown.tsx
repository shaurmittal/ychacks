// Minimal, safe markdown for assistant replies: fenced code (with Insert), paragraphs, lists,
// headings, `inline code`, **bold**. No HTML injection: everything renders as React text.
import { createContext, useContext, useState, type ReactNode } from "react";
import { splitFences } from "./codeBlocks";

export const InsertContext = createContext<(code: string) => void>(() => {});

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const tok = m[0];
    out.push(
      tok.startsWith("`") ? <code key={`${keyBase}-${i++}`} className="oa-icode">{tok.slice(1, -1)}</code>
        : <strong key={`${keyBase}-${i++}`}>{tok.slice(2, -2)}</strong>,
    );
    last = idx + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function TextBlock({ text, k }: { text: string; k: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <>
      {blocks.map((b, bi) => {
        const lines = b.split("\n");
        const key = `${k}-${bi}`;
        if (lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l))) {
          const ordered = /^\s*\d/.test(lines[0]);
          const items = lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ""), `${key}-${li}`)}</li>);
          return ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
        }
        const h = /^(#{1,4})\s+(.*)$/.exec(lines[0]);
        if (h && lines.length === 1) return <p key={key} className="oa-h">{inline(h[2], key)}</p>;
        return (
          <p key={key}>
            {lines.map((l, li) => (
              <span key={li}>{li > 0 && <br />}{inline(l.replace(/^#{1,4}\s+/, ""), `${key}-${li}`)}</span>
            ))}
          </p>
        );
      })}
    </>
  );
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const onInsert = useContext(InsertContext);
  const [state, setState] = useState<"" | "inserted" | "copied">("");
  const flash = (s: "inserted" | "copied") => { setState(s); setTimeout(() => setState(""), 1500); };
  return (
    <div className="oa-code">
      <div className="oa-code-head">
        <span className="oa-code-lang">{lang}</span>
        <span className="oa-code-actions">
          <button type="button" className="oa-btn-ghost" onClick={() => { void navigator.clipboard?.writeText(code); flash("copied"); }}>
            {state === "copied" ? "Copied" : "Copy"}
          </button>
          <button type="button" className="oa-btn-insert" onClick={() => { onInsert(code); flash("inserted"); }}>
            {state === "inserted" ? "Inserted ✓" : "Insert into editor"}
          </button>
        </span>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="oa-md">
      {splitFences(text).map((s, i) =>
        s.kind === "code" ? <CodeBlock key={i} lang={s.lang} code={s.code} /> : <TextBlock key={i} k={String(i)} text={s.text} />,
      )}
    </div>
  );
}
