"use client";
// Widok „Projekty” (z menu): firmy nad projektami. Każda firma ma wiersz nagłówka (nazwa, sfera, stan współpracy, statystyki) i pod nim swoje projekty;
// projekty bez firmy są prywatne i stoją w osobnej sekcji. Wiersz projektu: kolor, nazwa, firma, ważność, język, statystyki; pod nim lista zadań.
// Nowy projekt i nową firmę dodaje się w tej samej linii co tytuł widoku; usunięcie potwierdza się w dymku pod ikoną, więc wiersz się nie rozjeżdża.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fmtMin } from "@/lib/time";
import { Icon, Lvl, TS_LABEL, GCOL, plural, projColor, type CompanyRow, type ProjTask, type ProjectRow } from "./ui";
import { Picker } from "./widgets";

export const LANGS: Record<string, string> = { pl: "polski", en: "angielski", de: "niemiecki", uk: "ukraiński", fr: "francuski", es: "hiszpański" };
const WEIGHTS: Record<number, string> = { 5: "najwyższa", 4: "wysoka", 3: "zwykła", 2: "niska", 1: "najniższa" };
const SPHERE: Record<CompanyRow["sphere"], string> = { work: "sfera zawodowa", private: "sfera prywatna" };

export type ProjectPatch = { name?: string; weight?: number; language?: string; color?: number; companyId?: string | null };
export type CompanyPatch = { name?: string; sphere?: CompanyRow["sphere"]; ended?: boolean };
type Props = {
  projects: ProjectRow[]; companies: CompanyRow[]; tasks: ProjTask[]; focus?: string | null;
  onTask: (id: string) => void; onPatch: (id: string, patch: ProjectPatch) => void; onRemove: (id: string) => void; onNew: (name: string) => void;
  onCompanyNew: (name: string) => void; onCompanyPatch: (id: string, patch: CompanyPatch) => void; onCompanyRemove: (id: string) => void;
};

function Name({ name, label, onRename }: { name: string; label: string; onRename: (n: string) => void }) {
  const [edit, setEdit] = useState(false);
  if (!edit) return <button type="button" className="a-title p-name" title="Kliknij, aby zmienić nazwę" onClick={() => setEdit(true)}><span className="ct">{name}</span><Icon k="pen" size={12} sw={1.8} /></button>;
  const done = (v: string) => { setEdit(false); const n = v.trim(); if (n && n !== name) onRename(n); };
  // pole zajmuje dokładnie miejsce nazwy (ta sama szerokość i wysokość), więc reszta nagłówka stoi w miejscu
  return (
    <span className="a-title p-name edit">
      <input className="p-input" defaultValue={name} aria-label={label} autoFocus onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); done(e.currentTarget.value); } else if (e.key === "Escape") { e.preventDefault(); setEdit(false); } }}
        onBlur={(e) => done(e.currentTarget.value)} />
    </span>
  );
}

// potwierdzenie usunięcia w dymku pod ikoną kosza (portal: lista ma własny scroll)
function Remove({ label, question, onYes }: { label: string; question: string; onYes: () => void }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  useEffect(() => {
    if (!open) return;
    const r = btn.current!.getBoundingClientRect();
    setPos({ left: Math.min(r.right - 260, window.innerWidth - 276), top: r.bottom + 6 });
    const close = (e: Event) => { if (!(e.target as HTMLElement).closest?.(".ppmenu")) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <>
      <button ref={btn} className="icobtn" type="button" aria-label={label} title={label} aria-expanded={open} onClick={() => setOpen((o) => !o)}><Icon k="trash" size={14} sw={1.7} /></button>
      {open ? createPortal(
        <div className="ppmenu glass pop" role="dialog" aria-label={label} style={{ position: "fixed", left: pos.left, top: pos.top, width: 260 }} onPointerDown={(e) => e.stopPropagation()}>
          <span className="sub">{question}</span>
          <div className="row" style={{ gap: "var(--s-2)", justifyContent: "flex-end" }}>
            <button className="btn" type="button" onClick={() => setOpen(false)}>Anuluj</button>
            <button className="btn danger" type="button" onClick={() => { setOpen(false); onYes(); }}>Tak, usuń</button>
          </div>
        </div>, document.body) : null}
    </>
  );
}

function TaskRow({ t, onOpen }: { t: ProjTask; onOpen: () => void }) {
  return (
    <button type="button" className="p-task" onClick={onOpen}>
      <Lvl base={t.base} eff={t.eff} />
      <span className="n-title">{t.title}</span>
      {t.due ? <span className={"st due " + t.due.cls}>{t.due.text}</span> : null}
      <span className={"st " + t.state}>{TS_LABEL[t.state]}</span>
    </button>
  );
}

function Stats({ list }: { list: ProjTask[] }) {
  const open = list.filter((t) => t.state !== "done"), remain = open.reduce((a, t) => a + t.remain, 0), spent = list.reduce((a, t) => a + t.spent, 0);
  return (
    <span className="a-stats">
      <span>{open.length} {plural(open.length, "otwarte", "otwarte", "otwartych")} · {list.length - open.length} ukończ.</span>
      {remain ? <span title="Pozostały szacunek">~{fmtMin(remain)} do zrobienia</span> : null}
      {spent ? <span title="Czas zmierzony">⏱ {fmtMin(spent)}</span> : null}
    </span>
  );
}

// dodawanie w linii tytułu: jedno pole, Enter albo „Dodaj”
function NewForm({ label, placeholder, onDone, onCancel }: { label: string; placeholder: string; onDone: (name: string) => void; onCancel: () => void }) {
  return (
    <form className="p-new" autoComplete="off" onSubmit={(e) => { e.preventDefault(); const v = (new FormData(e.currentTarget).get("name") as string).trim(); if (v) { onDone(v); onCancel(); } }}>
      <input className="in" name="name" type="text" aria-label={label} placeholder={placeholder} autoFocus onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }} />
      <button className="btn primary" type="submit">Dodaj</button>
      <button className="icobtn" type="button" aria-label="Anuluj" onClick={onCancel}><Icon k="x" size={12} sw={2} /></button>
    </form>
  );
}

export function Projects({ projects, companies, tasks, focus, onTask, onPatch, onRemove, onNew, onCompanyNew, onCompanyPatch, onCompanyRemove }: Props) {
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<"project" | "company" | null>(null);
  const toggle = (id: string) => setFolded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const of = (id: string | null) => tasks.filter((t) => t.projectId === id);
  const loose = of(null);
  const company = (id: string | null) => companies.find((c) => c.id === id) ?? null;

  // wynik szukania: przewiń do projektu albo firmy i podświetl na chwilę
  useEffect(() => {
    if (!focus) return;
    const el = document.getElementById("proj-" + focus); if (!el) return;
    el.scrollIntoView({ block: "center" }); el.classList.add("hl");
    const t = setTimeout(() => el.classList.remove("hl"), 3000); return () => clearTimeout(t);
  }, [focus]);

  const card = (pr: ProjectRow | null) => {
    const id = pr ? pr.id : "none", list = of(pr ? pr.id : null), open = !folded.has(id);
    const co = pr ? company(pr.companyId) : null;
    return (
      <div key={id} id={"proj-" + id} className="lrow arow prow">
        <div className="p-head">
          {pr ? (
            <Picker cls="dot" menuCls="palette" title="Kolor projektu" onPick={(k) => onPatch(pr.id, { color: Number(k) })} trigger={<span className="pdot" style={{ ["--c" as string]: projColor(pr.color) }} />}
              options={GCOL.map((c, i) => ({ key: String(i), on: pr.color % GCOL.length === i, node: <span className="pdot" style={{ ["--c" as string]: c }} /> }))} />
          ) : <span className="pp dot" aria-hidden="true"><span className="pdot" style={{ ["--c" as string]: "var(--sub)" }} /></span>}
          {pr ? <Name name={pr.name} label="Nazwa projektu" onRename={(n) => onPatch(pr.id, { name: n })} /> : <span className="a-title p-name"><span className="ct">Bez projektu</span></span>}
          {pr ? (
            <>
              {companies.length ? (
                <Picker cls="boxed" title="Firma projektu: jej zasady i sfera (zawodowa albo prywatna) przechodzą na zadania" onPick={(k) => onPatch(pr.id, { companyId: k || null })}
                  trigger={<span className="pp-t">{co?.name ?? "prywatny"}</span>}
                  options={[{ key: "", on: !co, node: <span>prywatny (bez firmy)</span> }, ...companies.map((c) => ({ key: c.id, on: c.id === co?.id, node: <span>{c.name}</span> }))]} />
              ) : null}
              <Picker cls="boxed" title="Ważność projektu: podnosi albo obniża priorytet jego zadań" onPick={(k) => onPatch(pr.id, { weight: Number(k) })}
                trigger={<><Lvl base={pr.weight} eff={pr.weight} /><span className="pp-t">{WEIGHTS[pr.weight] ?? pr.weight}</span></>}
                options={[5, 4, 3, 2, 1].map((w) => ({ key: String(w), on: w === pr.weight, node: <><Lvl base={w} eff={w} />{WEIGHTS[w]}</> }))} />
              <Picker cls="boxed" title="Język, w którym agent pisze w tym projekcie" onPick={(k) => onPatch(pr.id, { language: k })}
                trigger={<span className="pp-t">{LANGS[pr.language] ?? pr.language}</span>}
                options={Object.entries(LANGS).map(([k, v]) => ({ key: k, on: k === pr.language, node: <span>{v}</span> }))} />
            </>
          ) : null}
          <Stats list={list} />
          <span className="p-act">
            {pr ? <Remove label="Usuń projekt (zadania zostaną)" question="Usunąć projekt? Jego zadania zostaną, tylko bez projektu." onYes={() => onRemove(pr.id)} /> : null}
            <button className="icobtn" type="button" aria-label={open ? "Zwiń zadania" : "Rozwiń zadania"} aria-expanded={open} onClick={() => toggle(id)} style={{ transform: open ? "rotate(180deg)" : "none" }}><Icon k="chev" size={12} sw={2.2} /></button>
          </span>
        </div>
        {open ? <div className="p-tasks">{list.length ? list.map((t) => <TaskRow key={t.id} t={t} onOpen={() => onTask(t.id)} />) : <span className="sub">Brak zadań. Przypisz je w panelu zadania albo zaznaczając kilka na kanwie.</span>}</div> : null}
      </div>
    );
  };

  // nagłówek firmy (albo sekcji „Prywatne” dla projektów bez firmy) i jej projekty pod spodem
  const section = (c: CompanyRow | null) => {
    const id = c ? "c-" + c.id : "private", list = projects.filter((p) => (c ? p.companyId === c.id : !p.companyId)), open = !folded.has(id);
    const all = list.flatMap((p) => of(p.id)).concat(c ? [] : loose);
    return (
      <div key={id} id={"proj-" + id} className="crow">
        <div className={"lrow arow prow c-head" + (c?.ended ? " ended" : "")}>
          <div className="p-head">
            <span className="c-ico" aria-hidden="true"><Icon k={c ? "company" : "manual"} size={16} sw={1.7} /></span>
            {c ? <Name name={c.name} label="Nazwa firmy" onRename={(n) => onCompanyPatch(c.id, { name: n })} /> : <span className="a-title p-name"><span className="ct">Prywatne</span></span>}
            {c ? (
              <>
                <Picker cls="boxed" title="Sfera: zawodowa albo prywatna; przechodzi na projekty tej firmy" onPick={(k) => onCompanyPatch(c.id, { sphere: k as CompanyRow["sphere"] })}
                  trigger={<span className="pp-t">{SPHERE[c.sphere]}</span>}
                  options={(Object.keys(SPHERE) as CompanyRow["sphere"][]).map((k) => ({ key: k, on: k === c.sphere, node: <span>{SPHERE[k]}</span> }))} />
                <Picker cls="boxed" title="Stan współpracy: po zakończeniu projekty i zasady zostają, firma schodzi na dół" onPick={(k) => onCompanyPatch(c.id, { ended: k === "ended" })}
                  trigger={<span className="pp-t">{c.ended ? "współpraca zakończona" : "współpraca trwa"}</span>}
                  options={[{ key: "on", on: !c.ended, node: <span>współpraca trwa</span> }, { key: "ended", on: c.ended, node: <span>współpraca zakończona</span> }]} />
              </>
            ) : <span className="chip" title="Projekty bez firmy: sprawy prywatne">bez firmy</span>}
            <Stats list={all} />
            <span className="p-act">
              {c ? <Remove label="Usuń firmę (projekty zostaną)" question="Usunąć firmę? Jej projekty zostaną jako prywatne, zasady firmy znikną." onYes={() => onCompanyRemove(c.id)} /> : null}
              <button className="icobtn" type="button" aria-label={open ? "Zwiń projekty" : "Rozwiń projekty"} aria-expanded={open} onClick={() => toggle(id)} style={{ transform: open ? "rotate(180deg)" : "none" }}><Icon k="chev" size={12} sw={2.2} /></button>
            </span>
          </div>
        </div>
        {open ? (
          <div className="c-projects">
            {list.map((pr) => card(pr))}
            {!c && loose.length ? card(null) : null}
            {!list.length && !(!c && loose.length) ? <p className="sub" style={{ margin: 0 }}>{c ? "Brak projektów. Przypisz projekt do firmy w jego wierszu." : "Brak prywatnych projektów."}</p> : null}
          </div>
        ) : null}
      </div>
    );
  };

  const active = companies.filter((c) => !c.ended), ended = companies.filter((c) => c.ended);
  return (
    <div className="listview wide" aria-label="Projekty">
      <div className="arch-head">
        <div className="arch-tabs">
          <b>Projekty</b><span className="n-num">{projects.length}</span>
          {companies.length ? <><span className="sub" style={{ marginLeft: 6 }}>w {companies.length} {plural(companies.length, "firmie", "firmach", "firmach")}</span></> : null}
          <span className="sp" />
          {adding === "project" ? <NewForm label="Nazwa nowego projektu" placeholder="Nazwa projektu" onDone={onNew} onCancel={() => setAdding(null)} />
            : adding === "company" ? <NewForm label="Nazwa nowej firmy" placeholder="Nazwa firmy" onDone={onCompanyNew} onCancel={() => setAdding(null)} />
            : <><button className="btn" type="button" onClick={() => setAdding("company")}>Nowa firma</button><button className="btn primary" type="button" onClick={() => setAdding("project")}>Nowy projekt</button></>}
        </div>
        <p>Firma stoi nad projektami: jej zasady i sfera (zawodowa albo prywatna) przechodzą na zadania. Projekt to etykieta zadania; ważność projektu podnosi albo obniża priorytet jego zadań, w jego języku agent pisze teksty.</p>
      </div>
      <div className="stage-grp">
        {companies.length ? (
          <>
            {active.map((c) => section(c))}
            {section(null)}
            {ended.map((c) => section(c))}
          </>
        ) : (
          <>
            {projects.map((pr) => card(pr))}
            {loose.length ? card(null) : null}
          </>
        )}
        {!projects.length && !loose.length && !companies.length ? <p className="sub">Jeszcze nie ma projektów ani zadań.</p> : null}
      </div>
    </div>
  );
}
