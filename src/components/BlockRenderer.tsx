// Jeden renderer dla wszystkich bloków. Nowa aplikacja zewnętrzna nie dodaje tu kodu.
import type { Block, Fact, Provenance } from "@/lib/schema";
import { toolLabel } from "@/lib/schema";
import { answerBlockForm } from "@/app/actions";

// gdzie blok pytania ma zapisać odpowiedź (panel kroku); bez tego pytanie jest tylko do odczytu
export type BlockForm = { taskId: string; stepId: string };

const TOOL_COLORS: Record<string, string> = { slack: "var(--t-slack)", gmail: "var(--t-mail)", clickup: "var(--t-clickup)", calendar: "var(--t-calendar)", claude: "var(--t-claude)", claudeapp: "var(--t-claude)", code: "var(--t-claude)", manual: "var(--t-manual)", github: "var(--t-github)", figma: "var(--t-figma)" };
export const toolColor = (app: string) => TOOL_COLORS[app] ?? "var(--sub)";

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

export function BlockView({ b, form, index }: { b: Block; form?: BlockForm; index?: number }) {
  switch (b.type) {
    case "text":
      return <div className="block">{b.title ? <h4>{b.title}</h4> : null}<p>{b.body}</p></div>;
    case "facts":
      return <div className="block">{b.title ? <h4>{b.title}</h4> : null}<Facts facts={b.facts} /></div>;
    case "thread":
      return (
        <div className="block">
          <div className="row" style={{ justifyContent: "space-between" }}><h4 style={{ margin: 0 }}>{b.title ?? "Wątek"}</h4><Source s={b.source} /></div>
          <div className="thread" style={{ marginTop: 8 }}>
            {b.messages.map((m, i) => <div key={i} className={"msg" + (m.mine ? " mine" : "")}><div className="who">{m.author}{m.at ? ` · ${m.at}` : ""}</div><p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{m.text}</p></div>)}
          </div>
        </div>
      );
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
        <div className="block">{b.title ? <h4>{b.title}</h4> : null}
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
