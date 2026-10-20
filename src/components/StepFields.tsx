"use client";
// Edycja w miejscu: pole kroku zmienia się tam, gdzie je widać (tytuł, szczegóły, narzędzie, szacunek, czas, zgoda, zależności, link), bez osobnego formularza.
// Klik otwiera pole, Enter albo zejście z pola zapisuje, Esc cofa. Szczegóły: Ctrl/Cmd+Enter zapisuje (Enter robi nową linię).
import { useState, useTransition, type KeyboardEvent } from "react";
import { linkSteps, patchStep } from "@/app/actions";
import { Picker } from "@/components/canvas/widgets";
import { GrowTextarea } from "@/components/GrowTextarea";
import { Icon } from "@/components/canvas/ui";
import { isGoogleApp, TOOL_LABELS } from "@/lib/schema";
import { Q, fmtMin } from "@/lib/time";

type Patch = Parameters<typeof patchStep>[2];
type Field = "title" | "detail" | "link";

export function InlineText({ taskId, stepId, field, value, as, placeholder, shown }: { taskId: string; stepId: string; field: Field; value: string; as: "h3" | "bar" | "p" | "small"; placeholder: string; shown?: string }) {
  const [edit, setEdit] = useState(false);
  const [pending, start] = useTransition();
  const save = (v: string) => { setEdit(false); const n = v.trim(); if (n === value.trim() || (!n && field === "title")) return; start(() => patchStep(taskId, stepId, { [field]: n } as Patch)); };
  const key = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === "Escape") { e.preventDefault(); setEdit(false); }
    else if (e.key === "Enter" && (as !== "p" || e.ctrlKey || e.metaKey)) { e.preventDefault(); save(e.currentTarget.value); }
  };
  if (edit) {
    return as === "p"
      ? <GrowTextarea className="in" minRows={2} defaultValue={value} placeholder={placeholder} aria-label={placeholder} autoFocus onBlur={(e) => save(e.currentTarget.value)} onKeyDown={key} />
      : <input className={"in" + (as === "h3" ? " h3" : as === "bar" ? " ttl" : "")} defaultValue={value} placeholder={placeholder} aria-label={placeholder} autoFocus onFocus={(e) => e.currentTarget.select()} onBlur={(e) => save(e.currentTarget.value)} onKeyDown={key} />;
  }
  const cls = "il " + (as === "bar" ? "ttl" : as) + (value ? "" : " blank") + (pending ? " busy" : "");   // „ttl”, nie „bar”: .bar to pasek postępu kafelka
  const body = <><span className="il-t">{value ? shown ?? value : placeholder}</span><Icon k="pen" size={12} sw={1.8} /></>;
  if (as === "h3" || as === "bar") return <h3 className={cls} title="Kliknij, aby zmienić" onClick={() => setEdit(true)}>{body}</h3>;
  return <p className={cls} title="Kliknij, aby zmienić" onClick={() => setEdit(true)}>{body}</p>;
}

export type StepConnection = { id: string; label: string; app: string; account: string | null; company: string | null; sphere: "work" | "private"; active: boolean };

// z jakiego konta poleci wysyłka: wybór w nagłówku karty publikacji (jak priorytet w pasku panelu); tylko konta tej aplikacji
export function ConnectionHead({ taskId, stepId, app, connectionId, connections, company }: { taskId: string; stepId: string; app: string; connectionId: string | null; connections: StepConnection[]; company: string | null }) {
  const [, start] = useTransition();
  // konto Google („google-widelab”) obsługuje pocztę, kalendarz i Dysk, więc jest do wyboru także dla tych aplikacji
  const conns = connections.filter((c) => (c.app === app || (isGoogleApp(app) && c.app === "google")) && (c.active || c.id === connectionId));
  const cur = connections.find((c) => c.id === connectionId) ?? null;
  const auto = `agent wybierze konto${company ? ` · ${company}` : ""}`;
  const text = (c: StepConnection) => `${c.label}${c.account ? ` · ${c.account}` : ""}${c.company ? ` · ${c.company}` : c.sphere === "private" ? " · prywatne" : ""}`;
  if (!conns.length) return <span className="pub-acc" title="Brak konta tej aplikacji w rejestrze połączeń (Ustawienia → Połączenia)">{cur ? text(cur) : auto}</span>;
  return (
    <Picker cls="head" title="Z którego konta to poleci (rejestr połączeń w ustawieniach)" trigger={<span className="pp-t">{cur ? text(cur) : auto}</span>} onPick={(k) => start(() => patchStep(taskId, stepId, { connectionId: k || null }))}
      options={[...conns.map((c) => ({ key: c.id, on: c.id === connectionId, node: <span>{text(c)}{c.active ? "" : " · nie działa"}</span> })), { key: "", on: !connectionId, node: <span>agent wybierze (według firmy zadania)</span> }]} />
  );
}

// liczba minut w pigułce takiej jak wybory obok (pióro zamiast strzałki): klik → pole liczbowe w tym samym miejscu
function NumChip({ value, stepBy, min, label, onSave }: { value: number; stepBy: number; min: number; label: string; onSave: (v: number) => void }) {
  const [edit, setEdit] = useState(false);
  const done = (raw: string) => { setEdit(false); const v = Number(raw); if (Number.isFinite(v) && v !== value && raw !== "") onSave(Math.max(min, v)); };
  if (edit) return <input className="in num" type="number" min={min} step={stepBy} defaultValue={value} aria-label={label} autoFocus onFocus={(e) => e.currentTarget.select()} onBlur={(e) => done(e.currentTarget.value)}
    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); done(e.currentTarget.value); } else if (e.key === "Escape") { e.preventDefault(); setEdit(false); } }} />;
  return <button type="button" className="pp boxed num" title={label + ": kliknij, aby zmienić"} onClick={() => setEdit(true)}><span className="pp-t">{fmtMin(value)}</span><Icon k="pen" size={11} sw={1.8} /></button>;
}

export function StepMeta({ taskId, step, steps, calText, connections = [], showConnection = true }: {
  taskId: string;
  step: { id: string; tool: string; estMin: number; spentMin: number; needsApproval: boolean; dependsOn: string[]; estHint?: string | null; connectionId?: string | null };
  steps: { id: string; title: string; done: boolean }[]; calText?: string | null;
  connections?: StepConnection[]; showConnection?: boolean;   // wybór połączenia: w technikaliach tylko, gdy nie ma go w karcie publikacji
}) {
  const [, start] = useTransition();
  const patch = (p: Patch) => start(() => patchStep(taskId, step.id, p));
  const tools = [...Object.entries(TOOL_LABELS), ...(TOOL_LABELS[step.tool] ? [] : [[step.tool, step.tool] as [string, string]])];
  const free = steps.filter((x) => !step.dependsOn.includes(x.id));
  // do wyboru: połączenia tej aplikacji co narzędzie kroku (Slack → konta Slacka), a gdy takich nie ma, wszystkie działające
  const same = connections.filter((c) => c.app === step.tool || (step.tool === "gmail" && c.app === "gmail"));
  const conns = (same.length ? same : connections).filter((c) => c.active || c.id === step.connectionId);
  const cur = connections.find((c) => c.id === step.connectionId) ?? null;
  return (
    <>
      <div className="time-row">
        <div><div className="lbl">Narzędzie</div>
          <Picker cls="boxed" title="Narzędzie kroku" trigger={<span className="pp-t">{TOOL_LABELS[step.tool] ?? step.tool}</span>} onPick={(k) => patch({ tool: k })}
            options={tools.map(([k, v]) => ({ key: k, on: k === step.tool, node: <span>{v}</span> }))} /></div>
        <div><div className="lbl">Szacunek{step.estHint ? <span className="hint"> {step.estHint}</span> : null}</div><NumChip value={step.estMin} stepBy={Q} min={Q} label="Szacunek w minutach" onSave={(v) => patch({ estMin: v })} /></div>
        <div><div className="lbl">Rzeczywiście</div><NumChip value={step.spentMin} stepBy={5} min={0} label="Czas zrobiony w minutach" onSave={(v) => patch({ spentMin: v })} /></div>
        <div><div className="lbl">Zgoda</div>
          <Picker cls="boxed" title="Czy krok wysyła coś na zewnątrz i czeka na Twoją zgodę" trigger={<span className="pp-t">{step.needsApproval ? "wymaga zgody" : "bez zgody"}</span>} onPick={(k) => patch({ needsApproval: k === "1" })}
            options={[{ key: "1", on: step.needsApproval, node: <span>wymaga zgody: wysyła coś na zewnątrz</span> }, { key: "0", on: !step.needsApproval, node: <span>bez zgody: Claude robi od razu</span> }]} /></div>
        {showConnection && conns.length ? <div><div className="lbl">Połączenie</div>
          <Picker cls="boxed" title="Którym kontem zrobić ten krok (z rejestru połączeń w ustawieniach)" trigger={<span className="pp-t">{cur ? `${cur.label}${cur.company ? ` · ${cur.company}` : cur.sphere === "private" ? " · prywatne" : ""}` : "agent wybierze"}</span>} onPick={(k) => patch({ connectionId: k || null })}
            options={[{ key: "", on: !step.connectionId, node: <span>agent wybierze (według firmy zadania)</span> }, ...conns.map((c) => ({ key: c.id, on: c.id === step.connectionId, node: <span>{c.label}{c.account ? ` (${c.account})` : ""}{c.company ? ` · ${c.company}` : c.sphere === "private" ? " · prywatne" : ""}{c.active ? "" : " · nie działa"}</span> }))]} /></div> : null}
      </div>
      {calText ? <div className="calib">{calText}</div> : null}
      <div><div className="lbl">Czeka na</div>
        <div className="deps">
          {step.dependsOn.map((d) => { const x = steps.find((s) => s.id === d); return x ? (
            <button key={d} type="button" className="chip" title="Usuń tę zależność" onClick={() => start(() => linkSteps(taskId, d, step.id, false))}><span className="d" style={{ ["--c" as string]: x.done ? "var(--ok)" : "var(--sub)" }} /><span>{x.title}</span><span className="x">×</span></button>
          ) : null; })}
          {!step.dependsOn.length ? <span className="chip ghost">zaczyna od razu</span> : null}
          {free.length ? <Picker cls="add" title="Dodaj krok, po którym ten ma się zacząć" trigger={<span>+ po kroku</span>} onPick={(k) => start(() => linkSteps(taskId, k, step.id, true))}
            options={free.map((s) => ({ key: s.id, node: <span>{s.title}</span> }))} /> : null}
        </div>
      </div>
    </>
  );
}

// ramka z promptem (awaryjnie: gdy Claude z konektora nie może zrobić kroku) z ikoną kopiowania w rogu
export function PromptBox({ text, openUrl }: { text: string; openUrl?: string }) {
  const [ok, setOk] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* brak schowka */ } };
  return (
    <div className="prompt">
      <pre>{text}</pre>
      <button className="icobtn copy" type="button" aria-label="Kopiuj prompt" title={ok ? "Skopiowano" : "Kopiuj do schowka"} onClick={copy}><Icon k={ok ? "check" : "copy"} size={14} sw={1.8} /></button>
      {openUrl ? <div className="actions" style={{ marginTop: 8 }}><a className="pill" href={openUrl} target="_blank" rel="noopener">Otwórz w Claude<Icon k="ext" size={12} sw={1.6} /></a></div> : null}
    </div>
  );
}

// przycisk niebezpieczny z pytaniem w tym samym miejscu (bez okna systemowego)
export function ConfirmButton({ label, question, yes, action }: { label: string; question: string; yes: string; action: () => Promise<void> }) {
  const [ask, setAsk] = useState(false);
  const [pending, start] = useTransition();
  if (!ask) return <button type="button" className="btn danger" onClick={() => setAsk(true)}>{label}</button>;
  return (
    <span className="actions">
      <span className="rb-t">{question}</span>
      <button type="button" className="btn danger" disabled={pending} onClick={() => start(() => action())}>{pending ? "Trwa…" : yes}</button>
      <button type="button" className="btn" onClick={() => setAsk(false)}>Anuluj</button>
    </span>
  );
}
