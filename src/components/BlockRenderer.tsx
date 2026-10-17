// Jeden renderer dla wszystkich bloków. Nowa aplikacja zewnętrzna nie dodaje tu kodu.
import type { Block, Fact, Provenance } from "@/lib/schema";
import { toolLabel } from "@/lib/schema";
import { answerBlockForm } from "@/app/actions";
import { Markdown } from "@/lib/markdown";
import { plural } from "@/components/canvas/ui";

// gdzie blok pytania ma zapisać odpowiedź (panel kroku); bez tego pytanie jest tylko do odczytu
export type BlockForm = { taskId: string; stepId: string };

const TOOL_COLORS: Record<string, string> = { slack: "var(--t-slack)", gmail: "var(--t-mail)", clickup: "var(--t-clickup)", calendar: "var(--t-calendar)", claude: "var(--t-claude)", claudeapp: "var(--t-claude)", code: "var(--t-claude)", manual: "var(--t-manual)", github: "var(--t-github)", figma: "var(--t-figma)" };
export const toolColor = (app: string) => TOOL_COLORS[app] ?? "var(--sub)";

// nagłówek klocka kontekstu: kropka aplikacji, nazwa, miejsce (ref), licznik, „Otwórz” gdy jest adres; ten sam dla wątku, maila, komentarza, tabeli i wolnej treści
export function SrcHead({ s, title, meta }: { s?: Provenance; title?: string; meta?: string }) {
  if (!s && !title && !meta) return null;
  return (
    <div className="src-h">
      {s ? <><span className="tool-dot" style={{ ["--c" as string]: toolColor(s.app) }} /><b>{toolLabel(s.app)}</b></> : null}
      {title ? <span>{s ? " · " : ""}{title}</span> : s?.ref ? <span> · {s.ref}</span> : null}
      {meta ? <span> · {meta}</span> : null}
      <span className="sp" />
      {s?.url ? <a className="chip" href={s.url} target="_blank" rel="noopener">Otwórz</a> : null}
    </div>
  );
}
const SHOW_LAST = 3;   // długi wątek: ostatnie wiadomości od razu, wcześniejsze po rozwinięciu

export function Source({ s }: { s?: Provenance }) {
  if (!s) return null;
  const inner = <><span className="tool-dot" style={{ ["--c" as string]: toolColor(s.app) }} /> {toolLabel(s.app)}{s.ref ? ` · ${s.ref}` : ""}</>;
  return s.url ? <a className="src chip" href={s.url} target="_blank" rel="noopener">{inner}</a> : <span className="src chip">{inner}</span>;
}

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

export function Table({ columns, rows, highlightFrom }: { columns: string[]; rows: string[][]; highlightFrom?: number }) {
  return (
    <div className="tbwrap"><table className="tb">
      <thead><tr>{columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i} className={highlightFrom != null && i >= highlightFrom ? "new" : undefined}>{columns.map((_, j) => <td key={j}>{r[j] ?? ""}</td>)}</tr>)}</tbody>
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
    case "free":
      return <div className="block kctx"><SrcHead s={b.source} title={b.title} /><Markdown text={b.markdown} /></div>;
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
          <ul className="list">{b.items.map((it, i) => <li key={i} style={{ textDecoration: it.done ? "line-through" : "none" }}>{it.url ? <a href={it.url} target="_blank" rel="noopener">{it.title}</a> : it.title}{it.note ? <span className="sub"> · {it.note}</span> : null} <Source s={it.source} /></li>)}</ul>
        </div>
      );
    case "media":
      return (
        <div className="block">{b.title ? <h4>{b.title}</h4> : null}
          <div className="media">
            {b.items.map((m, i) => (
              <div key={i}>
                {m.kind === "image" ? <a href={m.url} target="_blank" rel="noopener"><img src={m.url} alt={m.caption ?? m.name ?? ""} /></a> : <a className="chip" href={m.url} target="_blank" rel="noopener">{m.kind === "file" ? "📎" : "🔗"} {m.name ?? m.url}</a>}
                {m.caption ? <div className="cap">{m.caption}</div> : null}
                {m.analysis ? <details><summary className="sub">Analiza agenta</summary><p className="sub" style={{ whiteSpace: "pre-wrap" }}>{m.analysis}</p></details> : null}
              </div>
            ))}
          </div>
        </div>
      );
    case "link":
      return <div className="links">{b.links.map((l, i) => <a key={i} className="btn" href={l.url} target="_blank" rel="noopener">{l.source ? <span className="tool-dot" style={{ ["--c" as string]: toolColor(l.source.app) }} /> : null}{l.title ?? l.url} ↗</a>)}</div>;
    case "question":
      if (b.answer || !form) {
        return (
          <div className="block q"><p>{b.text}</p>
            <div className="opts">{b.options.map((o, i) => <span key={i} className={"chip" + (b.answer === o.label ? " on" : "")} title={o.note}>{o.label}{b.answer === o.label ? " ✓" : ""}</span>)}</div>
            {b.answer && !b.options.some((o) => o.label === b.answer) ? <p className="sub" style={{ marginTop: 6 }}>Odpowiedź: {b.answer}</p> : null}
          </div>
        );
      }
      return (
        <form className="block q" action={answerBlockForm}>
          <input type="hidden" name="taskId" value={form.taskId} /><input type="hidden" name="stepId" value={form.stepId} /><input type="hidden" name="index" value={index ?? 0} />
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
          <p>{b.text}</p>
          <div className="opts">{b.options.map((o, i) => <button key={i} type="submit" name="option" value={o.label} className={"btn" + (b.recommended === i ? " primary" : "")} title={o.note}>{o.label}</button>)}</div>
          <div className="row" style={{ marginTop: 8 }}><input className="in" name="answer" placeholder="Albo odpowiedz własnymi słowami…" /><button className="btn" type="submit">Odpowiedz</button></div>
        </form>
      );
  }
}

export function BlocksView({ blocks, form }: { blocks: Block[]; form?: BlockForm }) {
  return <div className="stack">{blocks.map((b, i) => <BlockView key={i} b={b} form={form} index={i} />)}</div>;
}
