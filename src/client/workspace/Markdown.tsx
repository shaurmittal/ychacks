// Lane 01 owns this file. Tiny markdown renderer for problem statements
// (headings, paragraphs, bullet lists, fenced code, `inline code`, **bold**).
import type { ReactNode } from "react";

export function Markdown({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  const lines = source.split("\n");
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={key++} className="md-pre"><code>{body.join("\n")}</code></pre>);
    } else if (/^#{1,3} /.test(line)) {
      const level = line.match(/^#+/)![0].length;
      const text = inline(line.replace(/^#+ /, ""));
      blocks.push(level === 1 ? <h1 key={key++}>{text}</h1> : level === 2 ? <h2 key={key++}>{text}</h2> : <h3 key={key++}>{text}</h3>);
      i++;
    } else if (/^\s*[-*] /.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*[-*] /.test(lines[i])) items.push(<li key={items.length}>{inline(lines[i++].replace(/^\s*[-*] /, ""))}</li>);
      blocks.push(<ul key={key++}>{items}</ul>);
    } else if (line.trim() === "") {
      i++;
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() !== "" && !lines[i].startsWith("```") && !/^#{1,3} /.test(lines[i]) && !/^\s*[-*] /.test(lines[i])) para.push(lines[i++]);
      blocks.push(<p key={key++}>{inline(para.join(" "))}</p>);
    }
  }
  return <div className="md">{blocks}</div>;
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    out.push(tok.startsWith("`") ? <code key={m.index}>{tok.slice(1, -1)}</code> : <strong key={m.index}>{tok.slice(2, -2)}</strong>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
