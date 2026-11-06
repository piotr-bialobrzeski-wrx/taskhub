"use client";
// Edycja w miejscu: pole kroku zmienia się tam, gdzie je widać (tytuł, szczegóły, narzędzie, szacunek, czas, zgoda, zależności, link), bez osobnego formularza.
// Klik otwiera pole, Enter albo zejście z pola zapisuje, Esc cofa. Szczegóły: Ctrl/Cmd+Enter zapisuje (Enter robi nową linię).
import { useLayoutEffect, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { doneWithTime, linkSteps, patchStep, setDoneTime } from "@/app/actions";
import { DueControl, Picker } from "@/components/canvas/widgets";
import type { DueValue } from "@/lib/due";
import { dayKey } from "@/lib/clock";
import { GrowTextarea, refitOnWidth } from "@/components/GrowTextarea";
import { Icon } from "@/components/canvas/ui";
import { DECISION_TITLE_RE, isGoogleApp, TOOL_LABELS } from "@/lib/schema";
import { Q, SPENT_CHIPS, fmtHM, fmtMin, parseSpent } from "@/lib/time";

type Patch = Parameters<typeof patchStep>[2];
type Field = "title" | "detail" | "link";

// Nazwa kroku albo zadania w nagłówku karty (lewy górny róg). Pole edycji dostaje dokładnie szerokość i wysokość, jaką
// nazwa zajmowała przed kliknięciem (cała nazwa albo całe dostępne miejsce, gdy długa nazwa była zwężona), i zawija się
// jak ona, więc nic się nie ucina i układ nie skacze (paczka 49). Enter albo zejście z pola zapisuje, Esc cofa.
// wysokość jak nazwa przed kliknięciem (co do ułamka piksela); więcej tylko, gdy nowa treść naprawdę zajmuje więcej linii
function fitTitle(el: HTMLTextAreaElement, box: { h: number } | null) {
  el.style.height = "0";
  const h = el.scrollHeight;
  el.style.height = (box && h <= Math.ceil(box.h) ? box.h : h) + "px";
  el.scrollLeft = 0;
}
export function HeadTitle({ value, placeholder, save }: { value: string; placeholder: string; save: (v: string) => Promise<unknown> }) {
  const [edit, setEdit] = useState(false);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [pending, start] = useTransition();
  const shownRef = useRef<HTMLHeadingElement>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const open = () => { const r = shownRef.current?.getBoundingClientRect(); setBox(r ? { w: r.width, h: r.height } : null); setEdit(true); };
  const done = (v: string | null) => { setEdit(false); if (v == null) return; const n = v.trim(); if (!n || n === value.trim()) return; start(async () => { await save(n); }); };
  useLayoutEffect(() => {
    const el = ref.current; if (!edit || !el) return;
    const fit = () => fitTitle(el, box);
    fit(); el.focus(); el.select();
    return refitOnWidth(el, fit);
  }, [edit, box]);
  if (edit) {
    return <textarea ref={ref} className="in ttl" rows={1} defaultValue={value} placeholder={placeholder} aria-label={placeholder} spellCheck={false}
      style={box ? { width: box.w, flex: "0 1 auto" } : undefined}
      onInput={(e) => fitTitle(e.currentTarget, box)}
      onBlur={(e) => done(e.currentTarget.value)}
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); done(null); } else if (e.key === "Enter") { e.preventDefault(); done(e.currentTarget.value); } }} />;
  }
  return <h3 ref={shownRef} className={"il ttl" + (value ? "" : " blank") + (pending ? " busy" : "")} title="Kliknij, aby zmienić" onClick={open}>
    <span className="il-t">{value || placeholder}</span><Icon k="pen" size={12} sw={1.8} /></h3>;
}

export function InlineText({ taskId, stepId, field, value, as, placeholder, shown }: { taskId: string; stepId: string; field: Field; value: string; as: "h3" | "bar" | "p" | "small"; placeholder: string; shown?: string }) {
  const [edit, setEdit] = useState(false);
  const [pending, start] = useTransition();
  if (as === "bar") return <HeadTitle value={value} placeholder={placeholder} save={(n) => patchStep(taskId, stepId, { [field]: n } as Patch)} />;
  const save = (v: string) => { setEdit(false); const n = v.trim(); if (n === value.trim() || (!n && field === "title")) return; start(() => patchStep(taskId, stepId, { [field]: n } as Patch)); };
  const key = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === "Escape") { e.preventDefault(); setEdit(false); }
    else if (e.key === "Enter" && (as !== "p" || e.ctrlKey || e.metaKey)) { e.preventDefault(); save(e.currentTarget.value); }
  };
  if (edit) {
    return as === "p"
      ? <GrowTextarea className="in" minRows={2} defaultValue={value} placeholder={placeholder} aria-label={placeholder} autoFocus onBlur={(e) => save(e.currentTarget.value)} onKeyDown={key} />
      : <input className={"in" + (as === "h3" ? " h3" : "")} defaultValue={value} placeholder={placeholder} aria-label={placeholder} autoFocus onFocus={(e) => e.currentTarget.select()} onBlur={(e) => save(e.currentTarget.value)} onKeyDown={key} />;
  }
  const cls = "il " + as + (value ? "" : " blank") + (pending ? " busy" : "");
  const body = <><span className="il-t">{value ? shown ?? value : placeholder}</span><Icon k="pen" size={12} sw={1.8} /></>;
  if (as === "h3") return <h3 className={cls} title="Kliknij, aby zmienić" onClick={() => setEdit(true)}>{body}</h3>;
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

// liczba minut w pigułce takiej jak wybory obok (pióro zamiast strzałki): klik → pole w tym samym miejscu.
// hm (czas Piotra, paczka 32): pole tekstowe „godziny:minuty” jak przy „Ile to zajęło?” (2:15, 45, 1,5 h), zapis w minutach
function NumChip({ value, stepBy, min, label, onSave, hm = false }: { value: number; stepBy: number; min: number; label: string; onSave: (v: number) => void; hm?: boolean }) {
  const [edit, setEdit] = useState(false);
  const done = (raw: string) => {
    setEdit(false);
    const v = hm ? parseSpent(raw) : raw === "" ? null : Number(raw);
    if (v !== null && Number.isFinite(v) && v !== value) onSave(Math.max(min, v));
  };
  const key = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") { e.preventDefault(); done(e.currentTarget.value); } else if (e.key === "Escape") { e.preventDefault(); setEdit(false); } };
  if (edit) return hm
    ? <input className="in num" type="text" inputMode="numeric" placeholder="g:mm" defaultValue={value ? fmtHM(value) : ""} aria-label={label + " (godziny:minuty)"} autoFocus onFocus={(e) => e.currentTarget.select()} onBlur={(e) => done(e.currentTarget.value)} onKeyDown={key} />
    : <input className="in num" type="number" min={min} step={stepBy} defaultValue={value} aria-label={label} autoFocus onFocus={(e) => e.currentTarget.select()} onBlur={(e) => done(e.currentTarget.value)} onKeyDown={key} />;
  return <button type="button" className="pp boxed num" title={label + ": kliknij, aby zmienić"} onClick={() => setEdit(true)}><span className="pp-t">{fmtMin(value)}</span><Icon k="pen" size={11} sw={1.8} /></button>;
}

// model kroku agenta: „auto” (poziom kroku → model i wysiłek z Ustawień) albo wybór Piotra; obok, czym zrobił go ostatni bieg
export type StepModelInfo = { auto: string; pick: string | null; choices: { key: string; label: string }[]; last: string | null };

export function StepMeta({ taskId, step, steps, calText, connections = [], showConnection = true, model = null }: {
  taskId: string;
  step: { id: string; tool: string; own: boolean; agentMin: number; estMin: number; spentMin: number; needsApproval: boolean; dependsOn: string[]; estHint?: string | null; connectionId?: string | null; due?: DueValue };
  steps: { id: string; title: string; done: boolean }[]; calText?: string | null;
  connections?: StepConnection[]; showConnection?: boolean;   // wybór połączenia: w technikaliach tylko, gdy nie ma go w karcie publikacji
  model?: StepModelInfo | null;
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
        {/* paczka 56: „Kto robi” (dawne Narzędzie): jedyny przełącznik, którym Piotr oddaje krok agentowi albo go przejmuje */}
        <div><div className="lbl">Kto robi</div>
          <Picker cls="boxed" title="Kto robi ten krok: Ty albo agent" trigger={<span className="pp-t">{TOOL_LABELS[step.tool] ?? step.tool}</span>} onPick={(k) => patch({ tool: k })}
            options={tools.map(([k, v]) => ({ key: k, on: k === step.tool, node: <span>{v}</span> }))} /></div>
        {step.own ? <>
          <div><div className="lbl">Szacunek{step.estHint ? <span className="hint"> {step.estHint}</span> : null}</div><NumChip value={step.estMin} stepBy={Q} min={Q} label="Szacunek w minutach" onSave={(v) => patch({ estMin: v })} /></div>
          {/* paczka 56: tylko do odczytu; czas ustawia się przy zamykaniu kroku, pomyłkę poprawia „Zmień” na dole kartki */}
          <div><div className="lbl">Twój czas</div><span className="pp boxed" title="Ustawia się przy zamykaniu kroku"><span className="pp-t">{step.spentMin ? fmtMin(step.spentMin) : "przy zamykaniu"}</span></span></div>
        </> : <>
          <div><div className="lbl">Czas Claude'a</div><span className="pp boxed" title="Liczy się sam: od chwili, gdy Claude zaczął krok, do jego zamknięcia"><span className="pp-t">{step.agentMin ? fmtMin(step.agentMin) : "jeszcze nic"}</span></span></div>
          {step.spentMin ? <div><div className="lbl">Twój czas</div><span className="pp boxed" title="Twój czas przy zatwierdzeniu"><span className="pp-t">{fmtMin(step.spentMin)}</span></span></div> : null}
        </>}
        {step.due ? <div><div className="lbl">Termin</div><DueControl of="kroku" value={step.due} min={dayKey(new Date())} onChange={(v) => patch({ due: v })} /></div> : null}
        {model ? <div><div className="lbl">Model{model.last ? <span className="hint"> ostatnio: {model.last}</span> : null}</div>
          <Picker cls="boxed" title="Którym modelem Claude ma zrobić ten krok: auto dobiera model i wysiłek do poziomu kroku (Ustawienia → Agent)" trigger={<span className="pp-t">{model.pick ? model.choices.find((c) => c.key === model.pick)?.label ?? model.pick : `auto · ${model.auto}`}</span>} onPick={(k) => patch({ modelPick: k || null })}
            options={[{ key: "", on: !model.pick, node: <span>auto · {model.auto}</span> }, ...model.choices.map((c) => ({ key: c.key, on: c.key === model.pick, node: <span>{c.label}</span> }))]} /></div> : null}
        {/* paczka 56: przy kroku Piotra Zgoda nic nie zmienia (agent i tak go nie robi); wraca po oddaniu kroku agentowi */}
        {step.own ? null : <div><div className="lbl">Zgoda</div>
          <Picker cls="boxed" title="Czy krok wysyła coś na zewnątrz i czeka na Twoją zgodę" trigger={<span className="pp-t">{step.needsApproval ? "wymaga zgody" : "bez zgody"}</span>} onPick={(k) => patch({ needsApproval: k === "1" })}
            options={[{ key: "1", on: step.needsApproval, node: <span>wymaga zgody: wysyła coś na zewnątrz</span> }, { key: "0", on: !step.needsApproval, node: <span>bez zgody: Claude robi od razu</span> }]} /></div>}
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

// „Zrobione” kroku Piotra poza aplikacją. Paczka 56: krok zamyka się od razu (kroki po nim ruszają), a „Ile czasu to zajęło?” stoi potem na dole
// kartki (TimeAsk). Krok-wybór bez pytania na kartce („Wybierz…”, „Zdecyduj…”) pyta najpierw, co Piotr wybrał: wpis idzie do wyniku kroku,
// żeby agent go widział (paczka 9)
export function DoneAsk({ taskId, stepId, title = "", primary = true }: { taskId: string; stepId: string; title?: string; primary?: boolean }) {
  const [ask, setAsk] = useState(false);
  const [result, setResult] = useState("");
  const [pending, start] = useTransition();
  const decision = DECISION_TITLE_RE.test(title.trim());
  const finish = () => start(() => doneWithTime(taskId, stepId, null, decision ? result : undefined));
  if (!decision || !ask) return <button type="button" className={primary ? "btn primary" : "btn"} disabled={pending} onClick={() => (decision ? setAsk(true) : finish())}>{pending ? "Zapisuję…" : "Zrobione"}</button>;
  return (
    <div className="actions ask-time" role="group" aria-label="Co wybrałeś?">
      <GrowTextarea className="in" minRows={1} placeholder="Co wybrałeś? (agent zobaczy to w wyniku kroku)" value={result} onChange={(e) => setResult(e.target.value)} disabled={pending} aria-label="Co wybrałeś?" style={{ width: "100%" }} autoFocus />
      <button type="button" className="btn primary" disabled={pending} onClick={finish}>{pending ? "Zapisuję…" : "Zrobione"}</button>
      <button type="button" className="btn" disabled={pending} onClick={() => setAsk(false)}>Anuluj</button>
    </div>
  );
}

// paczka 56 (zadanie „Czas pracy przy zamykaniu kroku”): sekcja na dole kartki po zamknięciu kroku Piotra albo po jego zgodzie na szkic.
// Przyciski co 15 minut (wyróżniony najbliższy szacunkowi), licznik +/- 15 min, pole „g:mm” i „Pomiń”. Zapisany czas: jedna linia z „Zmień”.
export function TimeAsk({ taskId, stepId, est, spent, saved, approval = false }: { taskId: string; stepId: string; est: number; spent: number; saved: boolean; approval?: boolean }) {
  const [edit, setEdit] = useState(false);
  const near = SPENT_CHIPS.reduce((a, c) => (Math.abs(c.min - (est || 15)) < Math.abs(a.min - (est || 15)) ? c : a)).min;
  const [step, setStep] = useState(Math.max(15, near));
  const [picked, setPicked] = useState<number | null | undefined>(undefined);
  const [typed, setTyped] = useState("");
  const [pending, start] = useTransition();
  if (saved && !edit) return (
    <div className="time-ask saved" role="group" aria-label="Twój czas">
      <div className="ta-h">Twój czas: {fmtMin(spent)}<small>zapisany przy zamknięciu kroku</small></div>
      <div className="actions"><button type="button" className="btn" onClick={() => setEdit(true)}>Zmień</button></div>
    </div>
  );
  const finish = (min: number | null) => { setPicked(min); start(async () => { await setDoneTime(taskId, stepId, min); setEdit(false); }); };
  const p = parseSpent(typed), own = p && p < 24 * 60 ? p : null, bad = !!typed.trim() && own === null;   // 0 i doba lub więcej: nie zapisujemy
  const label = (m: number | null, txt: string) => (pending && picked === m ? "Zapisuję…" : txt);
  const what = approval ? "Ile zajęło Ci przeczytanie i zatwierdzenie?" : "Ile czasu to zajęło?";
  const sub = [est ? `szacunek ~${fmtMin(est)}` : null, spent ? `zmierzone na kartce ${fmtMin(spent)}` : null].filter(Boolean).join(", ");
  return (
    <div className="time-ask" role="group" aria-label={what}>
      <div className="ta-h">{what}{sub ? <small>{sub}</small> : null}</div>
      <div className="actions">{SPENT_CHIPS.map((c) => <button key={c.min} type="button" className={"btn" + (c.min === near ? " primary" : "")} disabled={pending} onClick={() => finish(c.min)}>{label(c.min, c.label)}</button>)}</div>
      <div className="actions">
        <span className="ta-step" title="Co 15 minut">
          <button type="button" aria-label="Mniej o 15 minut" disabled={pending || step <= 15} onClick={() => setStep(Math.max(15, step - 15))}>−</button>
          <span>{fmtMin(step)}</span>
          <button type="button" aria-label="Więcej o 15 minut" disabled={pending || step >= 600} onClick={() => setStep(Math.min(600, step + 15))}>+</button>
        </span>
        <button type="button" className="btn" disabled={pending} onClick={() => finish(step)}>{label(step, `Zapisz ${fmtMin(step)}`)}</button>
        <span className="ask-own">
          <input className={"in" + (bad ? " bad" : "")} type="text" inputMode="numeric" placeholder="g:mm" value={typed} disabled={pending} aria-label="Własny czas (godziny:minuty, np. 2:15)" title="Własny czas: godziny:minuty, np. 2:15"
            aria-invalid={bad || undefined} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && own !== null) { e.preventDefault(); finish(own); } }} />
          {own !== null ? <button type="button" className="btn" disabled={pending} onClick={() => finish(own)}>{label(own, `Zapisz ${fmtMin(own)}`)}</button> : null}
        </span>
        {edit ? <button type="button" className="btn" disabled={pending} onClick={() => setEdit(false)}>Anuluj</button>
          : <button type="button" className="btn" disabled={pending} title={spent ? "Zostaje czas zmierzony na kartce" : "Krok zostaje bez Twojego czasu"} onClick={() => finish(null)}>{label(null, "Pomiń")}</button>}
      </div>
    </div>
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
