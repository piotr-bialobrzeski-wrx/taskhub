// Jeden renderer dla wszystkich bloków. Nowa aplikacja zewnętrzna nie dodaje tu kodu.
import type { Block, Fact, Provenance } from "@/lib/schema";
import { appName, normalizeTool, openLabel, toolLabel } from "@/lib/schema";
import { answerBlockForm } from "@/app/actions";
import { Markdown } from "@/lib/markdown";
import { hasMarkdown } from "@/lib/format";
import { Icon, plural } from "@/components/canvas/ui";
import { GrowTextarea } from "@/components/GrowTextarea";
import { CopyButton } from "@/components/CopyButton";
import { isHttpUrl, isLocalPath, isMediaUrl, safeHref } from "@/lib/safeurl";
import { groupBlocks } from "@/lib/stepcard";

// gdzie blok pytania ma zapisać odpowiedź (panel kroku); bez tego pytanie jest tylko do odczytu
export type BlockForm = { taskId: string; stepId: string };

const TOOL_COLORS: Record<string, string> = { slack: "var(--t-slack)", gmail: "var(--t-mail)", clickup: "var(--t-clickup)", calendar: "var(--t-calendar)", claude: "var(--t-claude)", claudeapp: "var(--t-claude)", code: "var(--t-claude)", manual: "var(--t-manual)", github: "var(--t-github)", figma: "var(--t-figma)", mural: "var(--t-mural)" };
export const toolColor = (app: string) => TOOL_COLORS[app] ?? "var(--sub)";

// nagłówek klocka kontekstu: kropka aplikacji, nazwa, miejsce (ref), licznik, przycisk „Otwórz w <app>” gdy jest adres (jeden kształt
// dla wszystkich klocków źródłowych; open = własna etykieta, np. „Otwórz podgląd” dla zmian w kodzie); ten sam dla wątku, maila, komentarza, tabeli i wolnej treści
export function SrcHead({ s, title, meta, open }: { s?: Provenance; title?: string; meta?: string; open?: string }) {
  if (!s && !title && !meta) return null;
  const href = safeHref(s?.url);   // adresy z danych tylko przez safeHref: javascript:, file:, taskhub: zostają bez linku
  return (
    <div className="src-h">
      {s ? <><span className="tool-dot" style={{ ["--c" as string]: toolColor(s.app) }} /><b>{toolLabel(s.app)}</b></> : null}
      {title ? <span>{s ? " · " : ""}{title}</span> : s?.ref ? <span> · {s.ref}</span> : null}
      {meta ? <span> · {meta}</span> : null}
      <span className="sp" />
      {href && s ? <a className="btn ico sm" href={href} target="_blank" rel="noopener">{open ?? openLabel(normalizeTool(s.app))}<Icon k="ext" size={13} sw={1.6} /></a> : null}
    </div>
  );
}
// karta źródła tylko do odczytu (paczka 10, punkt 2): klocek free z adresem http(s) wygląda jak karta szkicu (nagłówek z aplikacją,
// tytuł, linia metadanych, treść na białym polu), ale bez paska formatowania; Piotr czyta ticket albo dokument, poprawia go w aplikacji źródłowej
function SourceDoc({ b, href }: { b: Extract<Block, { type: "free" }>; href: string }) {
  const app = b.source?.app ?? "", key = normalizeTool(app);   // openLabel oczekuje klucza: „ClickUp” od agenta -> „Otwórz w ClickUpie”
  return (
    <div className="block kctx srcdoc">
      <div className="src-h"><span className="tool-dot" style={{ ["--c" as string]: toolColor(key) }} /><b>{appName(app)}</b><span>· tylko do odczytu</span><span className="sp" />
        <a className="btn ico sm" href={href} target="_blank" rel="noopener">{openLabel(key)}<Icon k="ext" size={13} sw={1.6} /></a></div>
      {b.title ? <h4>{b.title}</h4> : null}
      {b.meta ? <div className="src-meta">{b.meta}</div> : null}
      <div className="msg doc"><Markdown text={b.markdown} /></div>
    </div>
  );
}
const SHOW_LAST = 3;   // długi wątek: ostatnie wiadomości od razu, wcześniejsze po rozwinięciu

// chip źródła: jedna linia, długie miejsce (ścieżka pliku, nazwa kanału) ucina się wielokropkiem, pełna treść w dymku
export function Source({ s }: { s?: Provenance }) {
  if (!s) return null;
  const label = `${toolLabel(s.app)}${s.ref ? ` · ${s.ref}` : ""}`;
  const inner = <><span className="tool-dot" style={{ ["--c" as string]: toolColor(s.app) }} /><span>{label}</span></>;
  const href = safeHref(s.url);
  return href ? <a className="src chip" href={href} target="_blank" rel="noopener" title={label}>{inner}</a> : <span className="src chip" title={label}>{inner}</span>;
}
const FILE_STATUS: Record<string, string> = { added: "nowy", modified: "zmieniony", deleted: "usunięty", renamed: "przeniesiony" };

export function Facts({ facts }: { facts: Fact[] }) {
  const shown = facts.filter((f) => !f.hidden);
  if (!shown.length) return null;
  return (
    <dl className="facts">
      {shown.map((f, i) => <FactRow key={f.id ?? i} f={f} />)}
    </dl>
  );
}
function FactRow({ f }: { f: Fact }) {
  return <><dt>{f.label}{f.pinned ? " 📌" : ""}</dt><dd><span>{f.value}</span><Source s={f.source} /></dd></>;
}

// md: komórka z formatowaniem albo kilkoma liniami (wiersze szkicu do arkusza) renderuje się jak treść, nie jako gołe gwiazdki
export function Table({ columns, rows, highlightFrom, md }: { columns: string[]; rows: string[][]; highlightFrom?: number; md?: boolean }) {
  const cell = (v: string) => (md && (v.includes("\n") || hasMarkdown(v)) ? <Markdown text={v} /> : v);
  return (
    <div className="tbwrap"><table className="tb">
      <thead><tr>{columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i} className={highlightFrom != null && i >= highlightFrom ? "new" : undefined}>{columns.map((_, j) => <td key={j}>{cell(r[j] ?? "")}</td>)}</tr>)}</tbody>
    </table></div>
  );
}

export function BlockView({ b, form, index }: { b: Block; form?: BlockForm; index?: number }) {
  switch (b.type) {
    case "text":
      return <div className="block kctx">{b.title ? <h4>{b.title}</h4> : null}<p>{b.body}</p></div>;
    case "facts":
      return <div className="block kctx">{b.title ? <SrcHead title={b.title} /> : null}<Facts facts={b.facts} /></div>;
    case "thread": {
      const n = b.messages.length, older = b.messages.slice(0, Math.max(0, n - SHOW_LAST)), last = b.messages.slice(-SHOW_LAST);
      const bubble = (m: (typeof b.messages)[number], i: number) => <div key={i} className={"msg" + (m.mine ? " mine" : "")}><div className="who"><b>{m.author}</b>{m.at ? <span>{m.at}</span> : null}</div><p>{m.text}</p></div>;
      return (
        <div className="block kctx">
          <SrcHead s={b.source} title={b.title} meta={`${n} ${plural(n, "wiadomość", "wiadomości", "wiadomości")}`} />
          <div className="thread">
            {older.length ? <details className="more"><summary>Pokaż wcześniejsze ({older.length})</summary><div className="thread">{older.map(bubble)}</div></details> : null}
            {last.map((m, i) => bubble(m, older.length + i))}
          </div>
        </div>
      );
    }
    case "mail": {
      const n = b.messages.length, older = b.messages.slice(0, Math.max(0, n - 2)), last = b.messages.slice(-2);
      const env = (m: (typeof b.messages)[number], i: number, old: boolean) => (
        <div key={i} className={"msg mail" + (m.mine ? " mine" : "") + (old ? " old" : "")}>
          <div className="env"><span>Od</span><b>{m.from}</b>{m.to ? <><span>Do</span><b>{m.to}</b></> : null}{m.at ? <><span>Kiedy</span><b>{m.at}</b></> : null}</div>
          {m.subject ? <h5>{m.subject}</h5> : null}
          <p>{m.text}</p>
        </div>
      );
      return (
        <div className="block kctx">
          <SrcHead s={b.source ?? { app: "gmail" }} title={b.title} meta={`${n} ${plural(n, "mail", "maile", "maili")}`} />
          <div className="thread">
            {older.length ? <details className="more"><summary>Pokaż wcześniejsze ({older.length})</summary><div className="thread">{older.map((m, i) => env(m, i, true))}</div></details> : null}
            {last.map((m, i) => env(m, older.length + i, i < last.length - 1))}
          </div>
        </div>
      );
    }
    case "comment":
      return (
        <div className="block kctx">
          <SrcHead s={b.source} title={b.source?.ref ? undefined : "Komentarz"} />
          <div className="thread"><div className="msg"><div className="who"><b>{b.author}</b>{b.at ? <span>{b.at}</span> : null}</div><p>{b.text}</p></div></div>
        </div>
      );
    case "table":
      return (
        <div className="block kctx">
          <SrcHead s={b.source} title={b.title} meta={`${b.rows.length} ${plural(b.rows.length, "wiersz", "wiersze", "wierszy")}`} />
          <Table columns={b.columns} rows={b.rows} highlightFrom={b.highlightFrom} />
        </div>
      );
    case "free": {
      // z adresem http(s) = karta źródła tylko do odczytu; bez adresu jak dotąd (notatka agenta)
      const url = b.source?.url;
      return isHttpUrl(url) ? <SourceDoc b={b} href={url.trim()} /> : <div className="block kctx"><SrcHead s={b.source} title={b.title} /><Markdown text={b.markdown} /></div>;
    }
    case "draft":
      return (
        <div className="block draft">
          <div className="target"><span className="tool-dot" style={{ ["--c" as string]: toolColor(b.target.app) }} /> {b.status === "sent" ? "Wysłano" : b.status === "approved" ? "Zatwierdzone, poleci" : "Szkic, poleci"} do {toolLabel(b.target.app)}{b.target.where ? ` · ${b.target.where}` : ""} ({b.target.action})</div>
          {b.subject ? <h4>{b.subject}</h4> : null}
          <p>{b.body}</p>
          {b.fields?.length ? <div style={{ marginTop: 10 }}><div className="lbl">Pola przy wysyłce</div><Facts facts={b.fields} /></div> : null}
        </div>
      );
    case "list":
      return (
        <div className="block kctx">{b.title ? <SrcHead title={b.title} /> : null}
          <ul className="list">{b.items.map((it, i) => { const href = safeHref(it.url); return <li key={i} style={{ textDecoration: it.done ? "line-through" : "none" }}>{href ? <a href={href} target="_blank" rel="noopener">{it.title}</a> : it.title}{it.note ? <span className="sub"> · {it.note}</span> : null} <Source s={it.source} /></li>; })}</ul>
        </div>
      );
    case "media":
      return (
        <div className="block">{b.title ? <h4>{b.title}</h4> : null}
          <div className="media">
            {b.items.map((m, i) => {
              // obrazek tylko z http(s) albo pliku Task Hub; SVG nie jest wyświetlany w miejscu (serwer oddaje go jako plik do pobrania)
              const href = safeHref(m.url), img = m.kind === "image" && isMediaUrl(m.url) && !/\.svg$/i.test(m.name ?? m.url);
              const chip = <span>{m.kind === "file" ? "📎" : "🔗"} {m.name ?? m.url}</span>;
              return (
              <div key={i}>
                {img ? <a href={href} target="_blank" rel="noopener"><img src={m.url.trim()} alt={m.caption ?? m.name ?? ""} /></a> : href ? <a className="chip" href={href} target="_blank" rel="noopener" title={m.name ?? m.url}>{chip}</a> : <span className="chip" title={m.name ?? m.url}>{chip}</span>}
                {m.caption ? <div className="cap">{m.caption}</div> : null}
                {m.analysis ? <details><summary className="sub">Analiza agenta</summary><p className="sub" style={{ whiteSpace: "pre-wrap" }}>{m.analysis}</p></details> : null}
              </div>
              );
            })}
          </div>
        </div>
      );
    case "link":
      return <div className="links">{b.links.map((l, i) => {
        const href = safeHref(l.url), dot = l.source ? <span className="tool-dot" style={{ ["--c" as string]: toolColor(l.source.app) }} /> : null;
        return href ? <a key={i} className="btn" href={href} target="_blank" rel="noopener">{dot}{l.title ?? l.url} ↗</a> : <span key={i} className="btn" title={l.url}>{dot}{l.title ?? l.url}</span>;
      })}</div>;
    case "changes": {
      // zmiany w kodzie: repozytorium i gałąź, podgląd, lista plików z diffem po rozwinięciu (karta publikacji prowadzi tu przez „Zobacz zmiany”)
      const n = b.files.length, http = isHttpUrl(b.preview) ? b.preview.trim() : undefined;
      const place = [b.repo, b.branch].filter(Boolean).join(" · ") || undefined;
      return (
        <div className="block kctx" id={form ? "zm-" + form.stepId : undefined}>
          <SrcHead s={{ app: "github", ref: place, url: http }} title={b.title ?? "Zmiany w kodzie"} meta={`${n} ${plural(n, "plik", "pliki", "plików")}`} open="Otwórz podgląd" />
          {b.summary ? <p>{b.summary}</p> : null}
          {b.preview && !http ? <p className="sub">Podgląd: <code>{b.preview}</code>{isLocalPath(b.preview) ? <> <CopyButton text={b.preview.trim()} label="Kopiuj ścieżkę" /></> : null}</p> : null}
          {n ? (
            <div className="files">{b.files.map((f, i) => (
              <details key={i} className="file">
                <summary><span className={"fst " + (f.status ?? "modified")}>{FILE_STATUS[f.status ?? "modified"]}</span><code title={f.path}>{f.path}</code>{f.note ? <span className="sub">{f.note}</span> : null}</summary>
                {f.diff ? <pre className="code diff">{f.diff}</pre> : <p className="sub">Bez diffu.</p>}
              </details>
            ))}</div>
          ) : null}
        </div>
      );
    }
    case "question":
      if (b.answer || !form) {
        return (
          <div className="block q"><p>{b.text}</p>
            <div className="opts">{b.options.map((o, i) => <span key={i} className={"chip" + (b.answer === o.label ? " on" : "")} title={o.note}>{o.label}{b.answer === o.label ? " ✓" : ""}</span>)}</div>
            {b.answer && !b.options.some((o) => o.label === b.answer) ? <p className="sub" style={{ marginTop: 6 }}>Odpowiedź: {b.answer}</p> : null}
          </div>
        );
      }
      // q = treść pytania: gdy kartka zmieni się między wyświetleniem a kliknięciem, odpowiedź i tak trafi do tego pytania, nie do klocka pod tym indeksem
      return (
        <form className="block q" action={answerBlockForm}>
          <input type="hidden" name="taskId" value={form.taskId} /><input type="hidden" name="stepId" value={form.stepId} /><input type="hidden" name="index" value={index ?? 0} /><input type="hidden" name="q" value={b.text} />
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
          <p>{b.text}</p>
          <div className="opts">{b.options.map((o, i) => <button key={i} type="submit" name="option" value={o.label} className={"btn" + (b.recommended === i ? " primary" : "")} title={o.note}>{o.label}</button>)}</div>
          <div className="row q-own" style={{ marginTop: 8 }}>
            <GrowTextarea name="answer" minRows={1} placeholder="Albo odpowiedz własnymi słowami…" submitOnModEnter />
            <button className="btn" type="submit">Odpowiedz</button>
          </div>
        </form>
      );
  }
}

// indexOf: pozycja klocka na całej kartce (formularz pytania zapisuje odpowiedź pod tym indeksem), gdy blocks to tylko jej część.
// 2+ kolejne klocki źródłowe z adresem (dwa tickety, wątki, maile) stoją obok siebie w siatce .cmp (paczka 10, punkt 1); klucz i indeks
// to pozycja klocka w blocks, ta sama co bez grupowania
export function BlocksView({ blocks, form, indexOf }: { blocks: Block[]; form?: BlockForm; indexOf?: (b: Block) => number }) {
  let i = 0;
  const view = (b: Block) => { const k = i++; return <BlockView key={k} b={b} form={form} index={indexOf ? indexOf(b) : k} />; };
  return <div className="stack">{groupBlocks(blocks).map((g) => { if (!Array.isArray(g)) return view(g); const k = "cmp" + i; return <div key={k} className="cmp">{g.map(view)}</div>; })}</div>;
}
