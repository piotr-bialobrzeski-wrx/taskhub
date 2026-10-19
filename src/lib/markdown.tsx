// Mały, bezpieczny markdown dla klocka „wolna treść”: nagłówki, akapity, listy, pogrubienie, kursywa, kod, linki i obrazki (tylko http/https).
// Bez surowego HTML: agent nie może wstrzyknąć skryptu ani stylu; wszystko, czego nie rozumiemy, zostaje zwykłym tekstem.
import type { ReactNode } from "react";

const SAFE_URL = /^https?:\/\/[^\s<>"')]+$/;
export const safeUrl = (u: string) => (SAFE_URL.test(u) ? u : null);

function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  // obrazek, link, pogrubienie, kursywa, kod, przekreślenie; kolejność ważna: ![..](..) przed [..](..)
  const re = /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|~~([^~]+)~~/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[1] !== undefined) { const u = safeUrl(m[2]); out.push(u ? <img key={k} src={u} alt={m[1]} /> : m[0]); }
    else if (m[3] !== undefined) { const u = safeUrl(m[4]); out.push(u ? <a key={k} href={u} target="_blank" rel="noopener">{m[3]}</a> : m[3]); }
    else if (m[5] !== undefined) out.push(<b key={k}>{m[5]}</b>);
    else if (m[6] !== undefined) out.push(<i key={k}>{m[6]}</i>);
    else if (m[7] !== undefined) out.push(<code key={k}>{m[7]}</code>);
    else if (m[8] !== undefined) out.push(<s key={k}>{m[8]}</s>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const nodes: ReactNode[] = [];
  let para: string[] = [], list: { ordered: boolean; items: string[] } | null = null, code: string[] | null = null, k = 0;
  const flush = () => {
    if (para.length) { nodes.push(<p key={k++}>{inline(para.join("\n"), k)}</p>); para = []; }
    if (list) { const L = list; nodes.push(L.ordered ? <ol key={k++}>{L.items.map((it, i) => <li key={i}>{inline(it, k * 100 + i)}</li>)}</ol> : <ul key={k++}>{L.items.map((it, i) => <li key={i}>{inline(it, k * 100 + i)}</li>)}</ul>); list = null; }
  };
  for (const raw of lines) {
    if (code) { if (/^```/.test(raw)) { nodes.push(<pre key={k++} className="code">{code.join("\n")}</pre>); code = null; } else code.push(raw); continue; }
    if (/^```/.test(raw)) { flush(); code = []; continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(raw);
    if (h) { flush(); nodes.push(h[1].length === 1 ? <h4 key={k++}>{inline(h[2], k)}</h4> : <h5 key={k++}>{inline(h[2], k)}</h5>); continue; }
    const li = /^\s*(?:[-*]|(\d+)[.)])\s+(.*)$/.exec(raw);
    if (li) { if (para.length) flush(); const ordered = !!li[1]; if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; } list.items.push(li[2]); continue; }
    if (!raw.trim()) { flush(); continue; }
    if (list) flush();
    para.push(raw);
  }
  if (code) nodes.push(<pre key={k++} className="code">{code.join("\n")}</pre>);
  flush();
  return <div className="md">{nodes}</div>;
}
