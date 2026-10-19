// Szkic publikacji trzyma treść w Markdown (to pisze agent i to zapisuje pole z formatowaniem). Przy wysyłce każda aplikacja dostaje swój format:
// ClickUp bierze Markdown wprost (markdown_description), Slack ma własny mrkdwn, mail idzie jako HTML (htmlBody) z tekstem bez znaczników obok.
// Celowo mały parser liniowy, ten sam zakres co edytor: nagłówki, akapity, listy (z wcięciem), pogrubienie, kursywa, przekreślenie, kod, linki.

type Line =
  | { k: "h"; level: number; text: string }
  | { k: "li"; ordered: boolean; depth: number; text: string; n: number }
  | { k: "p"; text: string }
  | { k: "code"; text: string }
  | { k: "blank" };

function lines(md: string): Line[] {
  const out: Line[] = [];
  let code: string[] | null = null;
  for (const raw of md.replace(/\r/g, "").split("\n")) {
    if (code) { if (/^\s*```/.test(raw)) { out.push({ k: "code", text: code.join("\n") }); code = null; } else code.push(raw); continue; }
    if (/^\s*```/.test(raw)) { code = []; continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (h) { out.push({ k: "h", level: h[1].length, text: h[2].trim() }); continue; }
    const li = /^(\s*)(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(raw);
    if (li) { out.push({ k: "li", ordered: !!li[3], depth: Math.floor(li[1].replace(/\t/g, "  ").length / 2), text: li[4], n: li[3] ? Number(li[3]) : 0 }); continue; }
    if (!raw.trim()) { out.push({ k: "blank" }); continue; }
    out.push({ k: "p", text: raw });
  }
  if (code) out.push({ k: "code", text: code.join("\n") });
  return out;
}

// nagłówek z pogrubieniem w środku („# **Opis**”) to i tak nagłówek: zdejmujemy podwójne znaczniki
const plainHeading = (t: string) => t.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1");

// ---------- Slack (mrkdwn) ----------
function slackInline(t: string): string {
  const keep: string[] = [];
  const hold = (s: string) => { keep.push(s); return `\u0000${keep.length - 1}\u0000`; };
  t = t.replace(/`[^`]+`/g, hold);
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, txt, u) => hold(`<${u}|${txt}>`));
  t = t.replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => hold(`*${a ?? b}*`));
  t = t.replace(/(^|[^*\w])\*(?!\s)([^*]+?)\*(?![*\w])/g, (_, pre, x) => `${pre}_${x}_`);
  t = t.replace(/~~(.+?)~~/g, "~$1~");
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[Number(i)]);
}
export function mdToSlack(md: string): string {
  return lines(md).map((l) => {
    switch (l.k) {
      case "h": return `*${slackInline(plainHeading(l.text))}*`;
      case "li": return `${"    ".repeat(l.depth)}${l.ordered ? `${l.n}.` : "•"} ${slackInline(l.text)}`;
      case "p": return slackInline(l.text);
      case "code": return "```\n" + l.text + "\n```";
      default: return "";
    }
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ---------- HTML (mail) ----------
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function htmlInline(t: string): string {
  const keep: string[] = [];
  const hold = (s: string) => { keep.push(s); return `\u0000${keep.length - 1}\u0000`; };
  t = t.replace(/`([^`]+)`/g, (_, c) => hold(`<code>${esc(c)}</code>`));
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, txt, u) => hold(`<a href="${esc(u)}">${esc(txt)}</a>`));
  t = esc(t);
  t = t.replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => `<b>${a ?? b}</b>`);
  t = t.replace(/(^|[^*\w])\*(?!\s)([^*]+?)\*(?![*\w])/g, "$1<i>$2</i>").replace(/(^|[^_\w])_(?!\s)([^_]+?)_(?![_\w])/g, "$1<i>$2</i>");
  t = t.replace(/~~(.+?)~~/g, "<s>$1</s>");
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[Number(i)]);
}
export function mdToHtml(md: string): string {
  const out: string[] = [];
  const open: { tag: "ul" | "ol"; depth: number }[] = [];
  let para: string[] = [];
  const flushP = () => { if (para.length) { out.push(`<p>${para.map(htmlInline).join("<br>")}</p>`); para = []; } };
  const closeTo = (depth: number) => { while (open.length && open[open.length - 1].depth >= depth) out.push(`</li></${open.pop()!.tag}>`); };
  for (const l of lines(md)) {
    if (l.k !== "li") closeTo(0);
    if (l.k !== "p") flushP();
    if (l.k === "h") out.push(`<h${Math.min(l.level + 1, 4)}>${htmlInline(plainHeading(l.text))}</h${Math.min(l.level + 1, 4)}>`);
    else if (l.k === "p") para.push(l.text);
    else if (l.k === "code") out.push(`<pre>${esc(l.text)}</pre>`);
    else if (l.k === "li") {
      const tag = l.ordered ? "ol" : "ul";
      closeTo(l.depth + 1);
      const top = open[open.length - 1];
      if (top && top.depth === l.depth && top.tag !== tag) closeTo(l.depth);
      const cur = open[open.length - 1];
      if (cur && cur.depth === l.depth) out.push(`</li><li>${htmlInline(l.text)}`);
      else { out.push(`<${tag}${l.ordered && l.n > 1 ? ` start="${l.n}"` : ""}><li>${htmlInline(l.text)}`); open.push({ tag, depth: l.depth }); }
    }
  }
  closeTo(0); flushP();
  return out.join("\n");
}

// ---------- tekst bez znaczników (zapasowa wersja maila) ----------
export function mdToPlain(md: string): string {
  return lines(md).map((l) => {
    const strip = (t: string) => t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)").replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => a ?? b)
      .replace(/(^|[^*\w])\*(?!\s)([^*]+?)\*(?![*\w])/g, "$1$2").replace(/~~(.+?)~~/g, "$1").replace(/`([^`]+)`/g, "$1");
    switch (l.k) {
      case "h": return strip(plainHeading(l.text));
      case "li": return `${"  ".repeat(l.depth)}${l.ordered ? `${l.n}.` : "-"} ${strip(l.text)}`;
      case "p": return strip(l.text);
      case "code": return l.text;
      default: return "";
    }
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// czy treść w ogóle ma formatowanie (bez niego nie ma po co dawać agentowi drugiej wersji)
export const hasMarkdown = (md: string) => /(^|\n)\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|```)|\*\*|~~|\[[^\]]+\]\(https?:|(^|[^*\w])\*[^*\s][^*]*\*/.test(md);

// jak wysłać szkic do danej aplikacji: wskazówka dla agenta i gotowa treść w jej formacie
export function publishFormat(app: string, md: string): { how: string; text: string | null; label: string } | null {
  if (!md.trim()) return null;
  const a = app.toLowerCase();
  if (a === "clickup") return { label: "Markdown", how: "ClickUp przyjmuje Markdown: opis zadania przez markdown_description (create/update), komentarz w Markdown; nie wklejaj treści do zwykłego pola description.", text: null };
  if (a === "slack") return { label: "Slack mrkdwn", how: "Slack nie czyta Markdown: wyślij wersję mrkdwn poniżej (pogrubienie *tak*, kursywa _tak_, nagłówki jako pogrubiona linia).", text: hasMarkdown(md) ? mdToSlack(md) : null };
  if (a === "gmail" || a === "mail" || a === "email" || a === "outlook") return { label: "HTML", how: "Mail: htmlBody = wersja HTML poniżej, body = wersja bez znaczników (bez Markdown).", text: hasMarkdown(md) ? `${mdToHtml(md)}\n--- (body, bez znaczników) ---\n${mdToPlain(md)}` : null };
  return null;
}
