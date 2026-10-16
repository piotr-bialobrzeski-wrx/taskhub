"use client";
// Widok „Projekty” (z menu): każdy projekt w jednym wierszu nagłówka (kolor, nazwa, ważność, język, statystyki, akcje) i lista jego zadań poniżej.
// Nowy projekt dodaje się w tej samej linii co tytuł widoku; usunięcie potwierdza się w dymku pod ikoną, więc wiersz się nie rozjeżdża.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fmtMin } from "@/lib/time";
import { Icon, Lvl, TS_LABEL, GCOL, plural, projColor, type ProjTask, type ProjectRow } from "./ui";
import { Picker } from "./widgets";

export const LANGS: Record<string, string> = { pl: "polski", en: "angielski", de: "niemiecki", uk: "ukraiński", fr: "francuski", es: "hiszpański" };
const WEIGHTS: Record<number, string> = { 5: "najwyższa", 4: "wysoka", 3: "zwykła", 2: "niska", 1: "najniższa" };

export type ProjectPatch = { name?: string; weight?: number; language?: string; color?: number };
type Props = {
  projects: ProjectRow[]; tasks: ProjTask[]; focus?: string | null;
  onTask: (id: string) => void; onPatch: (id: string, patch: ProjectPatch) => void; onRemove: (id: string) => void; onNew: (name: string) => void;
};

function Name({ name, onRename }: { name: string; onRename: (n: string) => void }) {
  const [edit, setEdit] = useState(false);
  if (!edit) return <button type="button" className="a-title p-name" title="Kliknij, aby zmienić nazwę" onClick={() => setEdit(true)}><span className="ct">{name}</span><Icon k="pen" size={12} sw={1.8} /></button>;
  const done = (v: string) => { setEdit(false); const n = v.trim(); if (n && n !== name) onRename(n); };
  return (
    <input className="p-input" defaultValue={name} aria-label="Nazwa projektu" autoFocus onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); done(e.currentTarget.value); } else if (e.key === "Escape") { e.preventDefault(); setEdit(false); } }}
      onBlur={(e) => done(e.currentTarget.value)} />
  );
}

// potwierdzenie usunięcia w dymku pod ikoną kosza (portal: lista ma własny scroll)
function Remove({ onYes }: { onYes: () => void }) {
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
      <button ref={btn} className="icobtn" type="button" aria-label="Usuń projekt" title="Usuń projekt (zadania zostaną)" aria-expanded={open} onClick={() => setOpen((o) => !o)}><Icon k="trash" size={14} sw={1.7} /></button>
      {open ? createPortal(
        <div className="ppmenu glass pop" role="dialog" aria-label="Usunąć projekt?" style={{ position: "fixed", left: pos.left, top: pos.top, width: 260 }} onPointerDown={(e) => e.stopPropagation()}>
          <span className="sub">Usunąć projekt? Jego zadania zostaną, tylko bez projektu.</span>
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

export function Projects({ projects, tasks, focus, onTask, onPatch, onRemove, onNew }: Props) {
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const toggle = (id: string) => setFolded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const of = (id: string | null) => tasks.filter((t) => t.projectId === id);
  const loose = of(null);

  // wynik szukania: przewiń do projektu i podświetl go na chwilę
  useEffect(() => {
    if (!focus) return;
    const el = document.getElementById("proj-" + focus); if (!el) return;
    el.scrollIntoView({ block: "center" }); el.classList.add("hl");
    const t = setTimeout(() => el.classList.remove("hl"), 3000); return () => clearTimeout(t);
  }, [focus]);

  const card = (pr: ProjectRow | null) => {
    const id = pr ? pr.id : "none", list = of(pr ? pr.id : null), open = !folded.has(id);
    return (
      <div key={id} id={"proj-" + id} className="lrow arow prow">
        <div className="p-head">
          {pr ? (
            <Picker cls="dot" menuCls="palette" title="Kolor projektu" onPick={(k) => onPatch(pr.id, { color: Number(k) })} trigger={<span className="pdot" style={{ ["--c" as string]: projColor(pr.color) }} />}
              options={GCOL.map((c, i) => ({ key: String(i), on: pr.color % GCOL.length === i, node: <span className="pdot" style={{ ["--c" as string]: c }} /> }))} />
          ) : <span className="pp dot" aria-hidden="true"><span className="pdot" style={{ ["--c" as string]: "var(--sub)" }} /></span>}
          {pr ? <Name name={pr.name} onRename={(n) => onPatch(pr.id, { name: n })} /> : <span className="a-title p-name"><span className="ct">Bez projektu</span></span>}
          {pr ? (
            <>
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
            {pr ? <Remove onYes={() => onRemove(pr.id)} /> : null}
            <button className="icobtn" type="button" aria-label={open ? "Zwiń zadania" : "Rozwiń zadania"} aria-expanded={open} onClick={() => toggle(id)} style={{ transform: open ? "rotate(180deg)" : "none" }}><Icon k="chev" size={12} sw={2.2} /></button>
          </span>
        </div>
        {open ? <div className="p-tasks">{list.length ? list.map((t) => <TaskRow key={t.id} t={t} onOpen={() => onTask(t.id)} />) : <span className="sub">Brak zadań. Przypisz je w panelu zadania albo zaznaczając kilka na kanwie.</span>}</div> : null}
      </div>
    );
  };

  return (
    <div className="listview wide" aria-label="Projekty">
      <div className="arch-head">
        <div className="arch-tabs">
          <b>Projekty</b><span className="n-num">{projects.length}</span><span className="sp" />
          {adding ? (
            <form className="p-new" autoComplete="off" onSubmit={(e) => { e.preventDefault(); const v = (new FormData(e.currentTarget).get("name") as string).trim(); if (v) { onNew(v); setAdding(false); } }}>
              <input className="in" name="name" type="text" aria-label="Nazwa nowego projektu" placeholder="Nazwa projektu" autoFocus onKeyDown={(e) => { if (e.key === "Escape") setAdding(false); }} />
              <button className="btn primary" type="submit">Dodaj</button>
              <button className="icobtn" type="button" aria-label="Anuluj" onClick={() => setAdding(false)}><Icon k="x" size={12} sw={2} /></button>
            </form>
          ) : <button className="btn primary" type="button" onClick={() => setAdding(true)}>Nowy projekt</button>}
        </div>
        <p>Projekt to etykieta zadania: przypiszesz go w panelu zadania albo kilku zaznaczonym naraz. Ważność projektu podnosi albo obniża priorytet jego zadań; w jego języku agent pisze teksty.</p>
      </div>
      <div className="stage-grp">
        {projects.map((pr) => card(pr))}
        {loose.length ? card(null) : null}
        {!projects.length && !loose.length ? <p className="sub">Jeszcze nie ma projektów ani zadań.</p> : null}
      </div>
    </div>
  );
}
