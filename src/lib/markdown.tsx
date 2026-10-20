// Mały, bezpieczny markdown dla klocka „wolna treść”: nagłówki, akapity, listy (także zadań), tabele, linia pozioma, pogrubienie, kursywa, kod,
// linki i obrazki (tylko http/https i pliki Task Hub).
// Bez surowego HTML: agent nie może wstrzyknąć skryptu ani stylu; wszystko, czego nie rozumiemy, zostaje zwykłym tekstem.
import type { ReactNode } from "react";
import { isMediaUrl, safeHref } from "./safeurl";
import { decodeEntities } from "./format";

// adresy przez wspólne sito (safeurl.ts): link to http(s), plik Task Hub albo kotwica, obrazek http(s) albo plik Task Hub; reszta zostaje tekstem
export const safeUrl = (u: string) => safeHref(u) ?? null;
const imgUrl = (u: string) => (isMediaUrl(u) ? u.trim() : null);

function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  // ucieczka (\* daje gwiazdkę), obrazek, link, pogrubienie, kursywa, kod, przekreślenie; kolejność ważna: ![..](..) przed [..](..)
  const re = /\\([\\`*_\[\]~|#<>&])|!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|~~([^~]+)~~/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  const txt = (t: string) => { if (t) out.push(decodeEntities(t)); };   // starsze szkice z „&amp;” pokazują „&”
  while ((m = re.exec(text))) {
    if (m.index > last) txt(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[1] !== undefined) out.push(m[1]);
    else if (m[2] !== undefined) { const u = imgUrl(m[3]); out.push(u ? <img key={k} src={u} alt={m[2]} /> : m[0]); }
    else if (m[4] !== undefined) { const u = safeUrl(m[5]); out.push(u ? <a key={k} href={u} target="_blank" rel="noopener">{decodeEntities(m[4])}</a> : decodeEntities(m[4])); }
    else if (m[6] !== undefined) out.push(<b key={k}>{decodeEntities(m[6])}</b>);
    else if (m[7] !== undefined) out.push(<i key={k}>{decodeEntities(m[7])}</i>);
    else if (m[8] !== undefined) out.push(<code key={k}>{m[8]}</code>);
    else if (m[9] !== undefined) out.push(<s key={k}>{decodeEntities(m[9])}</s>);
    last = m.index + m[0].length;
  }
  if (last < text.length) txt(text.slice(last));
  return out;
}

// tabela GFM: linia „| a | b |” i pod nią „| --- | --- |”; komórki dzieli nieucieczkowana kreska
const TROW = /^\s*\|.*\|\s*$/, TSEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const cells = (row: string) => row.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim());

// punkt listy zadań („- [ ] a”, „- [x] b”): pole wyboru tylko do odczytu, treść obok
function Item({ text, k }: { text: string; k: number }) {
  const t = /^\[([ xX])\]\s+(.*)$/.exec(text);
  if (!t) return <li>{inline(text, k)}</li>;
  return <li className="task"><input type="checkbox" disabled checked={t[1] !== " "} aria-label={t[1] !== " " ? "zrobione" : "do zrobienia"} /><span>{inline(t[2], k)}</span></li>;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const nodes: ReactNode[] = [];
  let para: string[] = [], list: { ordered: boolean; items: string[] } | null = null, code: string[] | null = null, k = 0;
  const flush = () => {
    if (para.length) { nodes.push(<p key={k++}>{inline(para.join("\n"), k)}</p>); para = []; }
    if (list) { const L = list; nodes.push(L.ordered ? <ol key={k++}>{L.items.map((it, i) => <li key={i}>{inline(it, k * 100 + i)}</li>)}</ol> : <ul key={k++}>{L.items.map((it, i) => <Item key={i} text={it} k={k * 100 + i} />)}</ul>); list = null; }
  };
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n];
    if (code) { if (/^```/.test(raw)) { nodes.push(<pre key={k++} className="code">{code.join("\n")}</pre>); code = null; } else code.push(raw); continue; }
    if (/^```/.test(raw)) { flush(); code = []; continue; }
    if (TROW.test(raw) && n + 1 < lines.length && TSEP.test(lines[n + 1])) {
      flush();
      const head = cells(raw), rows: string[][] = [];
      for (n += 2; n < lines.length && TROW.test(lines[n]); n++) rows.push(cells(lines[n]));
      n--;
      const kk = k++;
      nodes.push(<div key={kk} className="tbwrap"><table className="tb">
        <thead><tr>{head.map((c, i) => <th key={i}>{inline(c, kk * 100 + i)}</th>)}</tr></thead>
        <tbody>{rows.map((r, ri) => <tr key={ri}>{head.map((_, ci) => <td key={ci}>{inline(r[ci] ?? "", kk * 100 + 10 * (ri + 1) + ci)}</td>)}</tr>)}</tbody>
      </table></div>);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) { flush(); nodes.push(<hr key={k++} />); continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(raw);
    if (h) { flush(); nodes.push(h[1].length === 1 ? <h4 key={k++}>{inline(h[2], k)}</h4> : <h5 key={k++}>{inline(h[2], k)}</h5>); continue; }
    const li = /^\s*(?:[-*+]|(\d+)[.)])\s+(.*)$/.exec(raw);
    if (li) { if (para.length) flush(); const ordered = !!li[1]; if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; } list.items.push(li[2]); continue; }
    if (!raw.trim()) { flush(); continue; }
    if (list) flush();
    para.push(raw);
  }
  if (code) nodes.push(<pre key={k++} className="code">{code.join("\n")}</pre>);
  flush();
  return <div className="md">{nodes}</div>;
}
